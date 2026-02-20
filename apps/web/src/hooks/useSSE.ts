// ============================================================
// SSE 客户端 Hook
// 连接 /api/events/stream，接收实时事件
// ============================================================

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface UseSSEOptions {
  onEvent?: (event: SSEEvent) => void;
}

interface UseSSEReturn {
  connected: boolean;
  lastEvent: SSEEvent | null;
}

export function useSSE(options?: UseSSEOptions): UseSSEReturn {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(options?.onEvent);

  // 保持 onEvent 回调的最新引用
  onEventRef.current = options?.onEvent;

  const connect = useCallback(() => {
    // 清理旧连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/events/stream');
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as SSEEvent;

        // 忽略连接确认事件
        if (data.type === 'connected') return;

        setLastEvent(data);
        onEventRef.current?.(data);
      } catch {
        // 忽略解析失败的消息
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // 3 秒后重连
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    // 延迟 2 秒再建立 SSE 连接，让首屏渲染先完成
    const delay = setTimeout(() => connect(), 2000);

    return () => {
      clearTimeout(delay);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  return { connected, lastEvent };
}
