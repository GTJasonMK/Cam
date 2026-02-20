// ============================================================
// SSE 监听器
// 全局 SSE 连接，接收服务端事件并刷新对应的 Zustand Store
// 纯副作用组件，不渲染任何 DOM
// ============================================================

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSSE, type SSEEvent } from '@/hooks/useSSE';
import { useTaskStore, useAgentStore, useWorkerStore, useDashboardStore } from '@/stores';

export function SSEListener() {
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchDashboard = useDashboardStore((s) => s.fetchDashboard);
  const applyDashboardRealtimeEvent = useDashboardStore((s) => s.applyRealtimeEvent);
  const setDashboardSseConnected = useDashboardStore((s) => s.setSseConnected);

  // 防抖计时器
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshRef = useRef<Set<string>>(new Set());

  const flushRefresh = useCallback(() => {
    const pending = pendingRefreshRef.current;
    if (pending.has('task')) fetchTasks();
    if (pending.has('worker')) fetchWorkers();
    if (pending.has('agent')) fetchAgents();
    if (pending.has('dashboard')) fetchDashboard({ silent: true });
    pending.clear();
  }, [fetchTasks, fetchWorkers, fetchAgents, fetchDashboard]);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      // 根据事件类型前缀决定需要刷新哪个 Store
      const prefix = event.type.split('.')[0]; // task / worker / agent
      if (prefix === 'task' || prefix === 'worker' || prefix === 'agent') {
        pendingRefreshRef.current.add(prefix);
      }

      // agent.session.* 事件同时刷新 Dashboard（活跃会话数变化）
      if (event.type.startsWith('agent.session.')) {
        pendingRefreshRef.current.add('dashboard');
      }

      if (applyDashboardRealtimeEvent(event)) {
        pendingRefreshRef.current.add('dashboard');
      }

      // 防抖 500ms，合并多个快速到达的事件
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushRefresh, 500);
    },
    [applyDashboardRealtimeEvent, flushRefresh]
  );

  const { connected } = useSSE({ onEvent: handleEvent });

  useEffect(() => {
    setDashboardSseConnected(connected);
  }, [connected, setDashboardSseConnected]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return null;
}
