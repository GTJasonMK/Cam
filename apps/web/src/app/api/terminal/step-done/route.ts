// ============================================================
// 流水线步骤完成回调端点
// Claude Code Stop hook 通过 HTTP POST 通知步骤完成
// 不需要用户认证（使用一次性回调令牌鉴权）
// ============================================================

import { NextResponse } from 'next/server';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';

export async function POST(req: Request) {
  let body: { token?: string; pipelineId?: string; taskId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '无效的 JSON' }, { status: 400 });
  }

  const { token, pipelineId, taskId } = body;

  if (!token || !pipelineId || !taskId) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  const success = agentSessionManager.notifyStepCompleted(token, pipelineId, taskId);

  if (!success) {
    return NextResponse.json({ error: '无效的回调令牌或流水线不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
