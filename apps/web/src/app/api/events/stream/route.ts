// ============================================================
// API: SSE 事件流
// GET /api/events/stream  - 建立 SSE 连接，接收实时事件
// ============================================================

import { NextResponse } from 'next/server';
import { sseManager } from '@/lib/sse/manager';
import { v4 as uuidv4 } from 'uuid';

import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';

export async function GET() {
  // 建立 SSE 时启动调度循环（避免在 next build 阶段产生副作用）
  ensureSchedulerStarted();

  const clientId = uuidv4();

  const stream = new ReadableStream({
    start(controller) {
      // 注册客户端
      sseManager.addClient(clientId, controller);

      // 发送初始连接确认
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`));
    },
    cancel() {
      // 客户端断开时清理
      sseManager.removeClient(clientId);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
