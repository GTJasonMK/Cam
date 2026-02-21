// ============================================================
// WebSocket 管理 Hook
// 单连接多会话，自动重连，消息路由到 Store/回调
// ============================================================

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTerminalStore } from '@/stores/terminal';
import type { ClientMessage, ServerMessage } from '@/lib/terminal/protocol';

const RECONNECT_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 25000;

type OutputCallback = (sessionId: string, data: string) => void;
type ExitCallback = (sessionId: string, exitCode: number) => void;

function isSessionAccessError(message: string): boolean {
  return message.includes('无权访问该会话') || message.includes('会话不存在');
}

interface UseTerminalWsReturn {
  /** 发送消息到服务器，返回是否发送成功 */
  send: (msg: ClientMessage) => boolean;
  /** 注册终端输出回调 */
  onOutput: React.MutableRefObject<OutputCallback | null>;
  /** 注册终端退出回调 */
  onExit: React.MutableRefObject<ExitCallback | null>;
}

export function useTerminalWs(): UseTerminalWsReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const onOutputRef = useRef<OutputCallback | null>(null);
  const onExitRef = useRef<ExitCallback | null>(null);

  const setConnected = useTerminalStore((s) => s.setConnected);
  const addSession = useTerminalStore((s) => s.addSession);
  const removeSession = useTerminalStore((s) => s.removeSession);
  const setSessions = useTerminalStore((s) => s.setSessions);
  const addAgentSession = useTerminalStore((s) => s.addAgentSession);
  const updateAgentStatus = useTerminalStore((s) => s.updateAgentStatus);
  const setAgentSessions = useTerminalStore((s) => s.setAgentSessions);
  const addPipeline = useTerminalStore((s) => s.addPipeline);
  const updatePipelineStep = useTerminalStore((s) => s.updatePipelineStep);
  const completePipeline = useTerminalStore((s) => s.completePipeline);
  const pausePipeline = useTerminalStore((s) => s.pausePipeline);
  const resumePipeline = useTerminalStore((s) => s.resumePipeline);

  const send = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/terminal/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);

      // 启动心跳
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        send({ type: 'ping' });
      }, PING_INTERVAL_MS);

      // 请求已有会话列表（页面切换后重新 attach）
      send({ type: 'list' });
      // 同时请求 Agent 会话列表
      send({ type: 'agent-list' });
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'created':
          addSession({ sessionId: msg.sessionId, shell: msg.shell });
          break;

        case 'output':
          onOutputRef.current?.(msg.sessionId, msg.data);
          break;

        case 'exited':
          onExitRef.current?.(msg.sessionId, msg.exitCode);
          removeSession(msg.sessionId);
          break;

        case 'sessions':
          setSessions(msg.sessions);
          break;

        case 'error':
          if (msg.sessionId && isSessionAccessError(msg.message)) {
            // 会话已失效/无权限：自动清理本地状态并重拉会话列表，避免持续报错
            removeSession(msg.sessionId);
            send({ type: 'list' });
            send({ type: 'agent-list' });
            console.warn('[Terminal WS] 已清理无效会话:', msg.message, msg.sessionId);
            break;
          }
          console.error('[Terminal WS] 服务端错误:', msg.message, msg.sessionId);
          break;

        case 'pong':
          // 心跳响应，无需处理
          break;

        // ---- Agent 编排消息 ----
        case 'agent-created':
          addAgentSession({
            sessionId: msg.sessionId,
            shell: msg.shell,
            agentDefinitionId: msg.agentDefinitionId,
            agentDisplayName: msg.agentDisplayName,
            workBranch: msg.workBranch,
            prompt: '',
            repoPath: msg.repoPath,
            claudeSessionId: msg.claudeSessionId,
            mode: msg.mode,
          });
          break;

        case 'agent-status':
          updateAgentStatus(msg.sessionId, msg.status, msg.exitCode, msg.elapsedMs);
          break;

        case 'agent-sessions':
          setAgentSessions(msg.sessions);
          break;

        // ---- 流水线编排消息 ----
        case 'pipeline-created':
          addPipeline({
            pipelineId: msg.pipelineId,
            steps: msg.steps.map((s) => ({
              taskIds: s.taskIds,
              title: s.title,
              status: s.status,
              sessionIds: s.sessionIds,
            })),
            currentStep: msg.currentStep,
            status: 'running',
          });
          break;

        case 'pipeline-step-status':
          updatePipelineStep(msg.pipelineId, msg.stepIndex, msg.status, msg.sessionIds, msg.taskIds);
          break;

        case 'pipeline-completed':
          completePipeline(msg.pipelineId, msg.finalStatus);
          break;

        case 'pipeline-paused':
          pausePipeline(msg.pipelineId);
          break;

        case 'pipeline-resumed':
          resumePipeline(msg.pipelineId, msg.currentStep, msg.sessionIds);
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      // 自动重连
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_INTERVAL_MS);
      }
    };

    ws.onerror = () => {
      // onclose 会随后触发，在那里处理重连
    };
  }, [setConnected, addSession, removeSession, setSessions, addAgentSession, updateAgentStatus, setAgentSessions, addPipeline, updatePipelineStep, completePipeline, pausePipeline, resumePipeline, send]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { send, onOutput: onOutputRef, onExit: onExitRef };
}
