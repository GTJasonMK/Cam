// ============================================================
// WebSocket 消息路由
// 解析客户端 JSON 消息，分发到 PTY 管理器 + Agent 会话管理器
// ============================================================

import type { WebSocket } from 'ws';
import { ptyManager } from './pty-manager';
import { agentSessionManager } from './agent-session-manager';
import type { ClientMessage, ServerMessage } from './protocol';
import type { WsUser } from './ws-auth';

/** 向 WebSocket 发送 JSON 消息 */
function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Attach Agent 会话到 WebSocket（PTY 输出 + 退出处理 + 流水线推进）
 * 提取为辅助函数以便 agent-create 和 pipeline-create 复用
 */
function attachAgentSession(
  ws: WebSocket,
  meta: { sessionId: string; startedAt: number; pipelineId?: string },
  attachedSessions: Set<string>,
  user: { id: string; username: string },
): void {
  ptyManager.attach(meta.sessionId, {
    onData: (data) => send(ws, { type: 'output', sessionId: meta.sessionId, data }),
    onExit: (exitCode) => {
      // 更新 Agent 状态
      agentSessionManager.handleAgentExit(meta.sessionId, exitCode);
      const updatedMeta = agentSessionManager.getMeta(meta.sessionId);
      send(ws, {
        type: 'agent-status',
        sessionId: meta.sessionId,
        status: updatedMeta?.status ?? (exitCode === 0 ? 'completed' : 'failed'),
        exitCode,
        elapsedMs: updatedMeta ? Date.now() - updatedMeta.startedAt : undefined,
      });
      send(ws, { type: 'exited', sessionId: meta.sessionId, exitCode });
      attachedSessions.delete(meta.sessionId);

      // 流水线步骤退出后，尝试推进下一步
      const pipelineId = updatedMeta?.pipelineId ?? meta.pipelineId;
      if (pipelineId) {
        handlePipelineAdvancement(ws, pipelineId, attachedSessions, user).catch((err) => {
          console.error(`[Pipeline] 推进失败: ${(err as Error).message}`);
        });
      }
    },
  });
  attachedSessions.add(meta.sessionId);
}

/** 流水线步骤完成后的推进逻辑 */
async function handlePipelineAdvancement(
  ws: WebSocket,
  pipelineId: string,
  attachedSessions: Set<string>,
  user: { id: string; username: string },
): Promise<void> {
  const pipeline = agentSessionManager.getPipeline(pipelineId);
  if (!pipeline) return;

  // 发送当前步骤的状态更新
  const currentStep = pipeline.steps[pipeline.currentStepIndex];
  if (currentStep) {
    send(ws, {
      type: 'pipeline-step-status',
      pipelineId,
      stepIndex: pipeline.currentStepIndex,
      taskId: currentStep.taskId,
      status: currentStep.status,
    });
  }

  // 流水线已终止（失败/取消）
  if (pipeline.status !== 'running') {
    send(ws, {
      type: 'pipeline-completed',
      pipelineId,
      finalStatus: pipeline.status as 'completed' | 'failed' | 'cancelled',
    });
    return;
  }

  // 尝试推进到下一步
  const nextMeta = await agentSessionManager.advancePipeline(pipelineId, user);

  if (nextMeta) {
    // 新步骤已启动 → attach 并通知前端
    attachAgentSession(ws, nextMeta, attachedSessions, user);

    const updatedPipeline = agentSessionManager.getPipeline(pipelineId);
    const nextStep = updatedPipeline?.steps[updatedPipeline.currentStepIndex];

    send(ws, {
      type: 'pipeline-step-status',
      pipelineId,
      stepIndex: updatedPipeline?.currentStepIndex ?? 0,
      taskId: nextStep?.taskId ?? '',
      status: 'running',
      sessionId: nextMeta.sessionId,
    });

    // 同时发送 agent-created 让前端感知新会话
    send(ws, {
      type: 'agent-created',
      sessionId: nextMeta.sessionId,
      shell: 'agent',
      agentDefinitionId: nextMeta.agentDefinitionId,
      agentDisplayName: nextMeta.agentDisplayName,
      workBranch: nextMeta.workBranch,
      status: 'running',
      repoPath: nextMeta.repoPath,
      mode: nextMeta.mode,
      claudeSessionId: nextMeta.claudeSessionId,
    });
  } else {
    // 没有下一步 → 流水线完成
    const finalPipeline = agentSessionManager.getPipeline(pipelineId);
    send(ws, {
      type: 'pipeline-completed',
      pipelineId,
      finalStatus: finalPipeline?.status as 'completed' | 'failed' | 'cancelled' ?? 'completed',
    });
  }
}

/** 处理单个 WebSocket 连接的生命周期 */
export function handleTerminalConnection(ws: WebSocket, user: WsUser): void {
  // 跟踪该连接 attach 的所有会话，断开时批量 detach
  const attachedSessions = new Set<string>();

  ws.on('message', async (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
    } catch {
      send(ws, { type: 'error', message: '无效的 JSON 消息' });
      return;
    }

    switch (msg.type) {
      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }

      case 'create': {
        try {
          const { sessionId, shell } = ptyManager.create({
            cols: msg.cols,
            rows: msg.rows,
            shell: msg.shell,
            userId: user.id,
          });

          // 自动 attach
          ptyManager.attach(sessionId, {
            onData: (data) => send(ws, { type: 'output', sessionId, data }),
            onExit: (exitCode) => {
              send(ws, { type: 'exited', sessionId, exitCode });
              attachedSessions.delete(sessionId);
            },
          });
          attachedSessions.add(sessionId);

          send(ws, { type: 'created', sessionId, shell });
        } catch (err) {
          send(ws, { type: 'error', message: (err as Error).message });
        }
        break;
      }

      case 'attach': {
        if (!ptyManager.has(msg.sessionId)) {
          send(ws, { type: 'error', message: '会话不存在', sessionId: msg.sessionId });
          break;
        }
        if (!ptyManager.isOwnedBy(msg.sessionId, user.id)) {
          send(ws, { type: 'error', message: '无权访问该会话', sessionId: msg.sessionId });
          break;
        }

        const scrollback = ptyManager.attach(msg.sessionId, {
          onData: (data) => send(ws, { type: 'output', sessionId: msg.sessionId, data }),
          onExit: (exitCode) => {
            send(ws, { type: 'exited', sessionId: msg.sessionId, exitCode });
            attachedSessions.delete(msg.sessionId);
          },
        });
        attachedSessions.add(msg.sessionId);

        // 回放滚动缓冲
        if (scrollback) {
          send(ws, { type: 'output', sessionId: msg.sessionId, data: scrollback });
        }
        break;
      }

      case 'input': {
        if (!ptyManager.isOwnedBy(msg.sessionId, user.id)) {
          send(ws, { type: 'error', message: '无权访问该会话', sessionId: msg.sessionId });
          break;
        }
        ptyManager.write(msg.sessionId, msg.data);
        break;
      }

      case 'resize': {
        if (!ptyManager.isOwnedBy(msg.sessionId, user.id)) break;
        ptyManager.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      }

      case 'destroy': {
        if (!ptyManager.isOwnedBy(msg.sessionId, user.id)) {
          send(ws, { type: 'error', message: '无权访问该会话', sessionId: msg.sessionId });
          break;
        }
        ptyManager.destroy(msg.sessionId);
        attachedSessions.delete(msg.sessionId);
        break;
      }

      case 'list': {
        const sessions = ptyManager.listByUser(user.id);
        send(ws, { type: 'sessions', sessions });
        break;
      }

      // ---- Agent 编排消息 ----

      case 'agent-create': {
        try {
          const meta = await agentSessionManager.createAgentSession(
            {
              agentDefinitionId: msg.agentDefinitionId,
              prompt: msg.prompt,
              repoUrl: msg.repoUrl,
              baseBranch: msg.baseBranch,
              workDir: msg.workDir,
              cols: msg.cols,
              rows: msg.rows,
              mode: msg.mode,
              resumeSessionId: msg.resumeSessionId,
            },
            { id: user.id, username: user.username },
          );

          attachAgentSession(ws, meta, attachedSessions, user);

          send(ws, {
            type: 'agent-created',
            sessionId: meta.sessionId,
            shell: 'agent',
            agentDefinitionId: meta.agentDefinitionId,
            agentDisplayName: meta.agentDisplayName,
            workBranch: meta.workBranch,
            status: 'running',
            repoPath: meta.repoPath,
            mode: meta.mode,
            claudeSessionId: meta.claudeSessionId,
          });
        } catch (err) {
          send(ws, { type: 'error', message: (err as Error).message });
        }
        break;
      }

      case 'agent-cancel': {
        const agentMeta = agentSessionManager.getMeta(msg.sessionId);
        if (!agentMeta) {
          send(ws, { type: 'error', message: 'Agent 会话不存在', sessionId: msg.sessionId });
          break;
        }
        if (agentMeta.userId !== user.id) {
          send(ws, { type: 'error', message: '无权操作该 Agent 会话', sessionId: msg.sessionId });
          break;
        }
        agentSessionManager.cancelAgentSession(msg.sessionId);
        send(ws, {
          type: 'agent-status',
          sessionId: msg.sessionId,
          status: 'cancelled',
          elapsedMs: Date.now() - agentMeta.startedAt,
        });
        break;
      }

      case 'agent-list': {
        const agentSessions = agentSessionManager.listByUser(user.id);
        send(ws, { type: 'agent-sessions', sessions: agentSessions });
        break;
      }

      // ---- 流水线编排消息 ----

      case 'pipeline-create': {
        try {
          const { pipeline, firstSessionMeta } = await agentSessionManager.createPipeline(
            {
              agentDefinitionId: msg.agentDefinitionId,
              workDir: msg.workDir,
              repoUrl: msg.repoUrl,
              baseBranch: msg.baseBranch,
              cols: msg.cols,
              rows: msg.rows,
              steps: msg.steps,
            },
            { id: user.id, username: user.username },
          );

          // Attach 第一步的 Agent 会话
          attachAgentSession(ws, firstSessionMeta, attachedSessions, user);

          send(ws, {
            type: 'pipeline-created',
            pipelineId: pipeline.pipelineId,
            steps: pipeline.steps.map((s) => ({
              taskId: s.taskId,
              title: s.title,
              status: s.status,
            })),
            currentStep: 0,
            sessionId: firstSessionMeta.sessionId,
            shell: 'agent',
            agentDisplayName: pipeline.agentDisplayName,
            workBranch: firstSessionMeta.workBranch,
            repoPath: pipeline.repoPath,
          });

          // 同时发送 agent-created 让前端添加会话条目
          send(ws, {
            type: 'agent-created',
            sessionId: firstSessionMeta.sessionId,
            shell: 'agent',
            agentDefinitionId: firstSessionMeta.agentDefinitionId,
            agentDisplayName: firstSessionMeta.agentDisplayName,
            workBranch: firstSessionMeta.workBranch,
            status: 'running',
            repoPath: firstSessionMeta.repoPath,
            mode: firstSessionMeta.mode,
          });
        } catch (err) {
          send(ws, { type: 'error', message: (err as Error).message });
        }
        break;
      }

      case 'pipeline-cancel': {
        const pipeline = agentSessionManager.getPipeline(msg.pipelineId);
        if (!pipeline) {
          send(ws, { type: 'error', message: '流水线不存在' });
          break;
        }
        if (pipeline.userId !== user.id) {
          send(ws, { type: 'error', message: '无权操作该流水线' });
          break;
        }
        agentSessionManager.cancelPipeline(msg.pipelineId);
        send(ws, {
          type: 'pipeline-completed',
          pipelineId: msg.pipelineId,
          finalStatus: 'cancelled',
        });
        break;
      }

      default: {
        send(ws, { type: 'error', message: `未知消息类型: ${(msg as { type: string }).type}` });
      }
    }
  });

  ws.on('close', () => {
    // 断开 WebSocket 时，detach 所有会话（不销毁 PTY，保留会话持久化）
    for (const sessionId of attachedSessions) {
      ptyManager.detach(sessionId);
    }
    attachedSessions.clear();
  });

  ws.on('error', (err) => {
    console.error('[Terminal] WebSocket 错误:', err.message);
  });
}
