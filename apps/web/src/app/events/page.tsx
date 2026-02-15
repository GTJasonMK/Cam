// ============================================================
// 事件管理页面
// 使用 DataTable + Toolbar 筛选，支持行展开查看 payload
// ============================================================

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { EVENT_TYPE_COLORS, getColorVar } from '@/lib/constants';
import { useFeedback } from '@/components/providers/feedback-provider';
import { EVENTS_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { Download, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

// ---- 类型定义 ----

interface EventItem {
  id: string;
  type: string;
  actor?: string | null;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface EventsResponse {
  success: boolean;
  data?: {
    events: EventItem[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
    availablePrefixes: string[];
    availableActors?: string[];
  };
  error?: { message?: string };
}

function prettyPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '{}';
  }
}

export default function EventsPage() {
  const { notify } = useFeedback();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [actorInput, setActorInput] = useState('');
  const [actor, setActor] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [from, setFrom] = useState('');
  const [toInput, setToInput] = useState('');
  const [to, setTo] = useState('');
  const [typePrefix, setTypePrefix] = useState('');
  const [availablePrefixes, setAvailablePrefixes] = useState<string[]>([]);
  const [availableActors, setAvailableActors] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (typePrefix) params.set('typePrefix', typePrefix);
      if (query) params.set('q', query);
      if (actor) params.set('actor', actor);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await fetch(`/api/events?${params.toString()}`);
      const json: EventsResponse = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success || !json.data) {
        setError(json.error?.message || EVENTS_UI_MESSAGES.requestFailedWithStatus(res.status));
        return;
      }

      setEvents(json.data.events);
      setPagination(json.data.pagination);
      setAvailablePrefixes(json.data.availablePrefixes);
      setAvailableActors(json.data.availableActors || []);
      if (expandedId && !json.data.events.some((e) => e.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actor, expandedId, from, page, pageSize, query, to, typePrefix]);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (typePrefix) params.set('typePrefix', typePrefix);
    if (query) params.set('q', query);
    if (actor) params.set('actor', actor);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params;
  }, [actor, from, page, pageSize, query, to, typePrefix]);

  const handleExportCsv = useCallback(async () => {
    try {
      const params = buildQueryParams();
      params.set('format', 'csv');
      params.set('limit', '5000');
      const res = await fetch(`/api/events?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as { error?: { message?: string } }));
        notify({ type: 'error', title: EVENTS_UI_MESSAGES.exportFailed, message: json?.error?.message || EVENTS_UI_MESSAGES.exportFailedWithStatus(res.status) });
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename=\"?([^"]+)\"?/i);
      anchor.href = objectUrl;
      anchor.download = match?.[1] || `events-export-${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
      notify({ type: 'success', title: EVENTS_UI_MESSAGES.exportSuccess, message: EVENTS_UI_MESSAGES.exportSuccessMessage });
    } catch (err) {
      notify({ type: 'error', title: EVENTS_UI_MESSAGES.exportFailed, message: (err as Error).message });
    }
  }, [buildQueryParams, notify]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const hasPrev = pagination.page > 1;
  const hasNext = pagination.totalPages > 0 && pagination.page < pagination.totalPages;

  const typeOptions = useMemo(
    () => [{ value: '', label: EVENTS_UI_MESSAGES.typeAll }, ...availablePrefixes.map((p) => ({ value: p, label: p }))],
    [availablePrefixes]
  );
  const actorOptions = useMemo(
    () => [{ value: '', label: EVENTS_UI_MESSAGES.actorAll }, ...availableActors.map((a) => ({ value: a, label: a }))],
    [availableActors]
  );

  const handleSearch = () => {
    setPage(1);
    setQuery(queryInput.trim());
    setActor(actorInput.trim());
    setFrom(fromInput);
    setTo(toInput);
  };

  const handleReset = () => {
    setPage(1);
    setTypePrefix('');
    setQuery('');
    setQueryInput('');
    setActor('');
    setActorInput('');
    setFrom('');
    setFromInput('');
    setTo('');
    setToInput('');
  };

  // 表格列定义
  const columns: Column<EventItem>[] = [
    {
      key: 'expand',
      header: '',
      className: 'w-[40px]',
      cell: (row) => (
        <button
          type="button"
          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expandedId === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ),
    },
    {
      key: 'timestamp',
      header: '时间',
      className: 'w-[160px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{new Date(row.timestamp).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      key: 'type',
      header: '事件类型',
      className: 'w-[200px]',
      cell: (row) => {
        const prefix = row.type.split('.')[0] || 'other';
        const token = EVENT_TYPE_COLORS[prefix] || 'muted-foreground';
        return (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: getColorVar(token) }} />
            <span className="truncate text-sm font-medium">{row.type}</span>
          </div>
        );
      },
    },
    {
      key: 'actor',
      header: EVENTS_UI_MESSAGES.actorPrefix,
      className: 'w-[120px]',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{row.actor || EVENTS_UI_MESSAGES.actorSystem}</span>
      ),
    },
    {
      key: 'summary',
      header: '摘要',
      cell: (row) => {
        const keys = Object.keys(row.payload).slice(0, 3);
        const preview = keys.map((k) => `${k}: ${String(row.payload[k]).slice(0, 30)}`).join(', ');
        return <span className="text-xs text-muted-foreground/70 truncate block max-w-[300px]">{preview || '-'}</span>;
      },
    },
  ];

  // 自定义行渲染：展开时显示 payload
  const renderExpandedRow = (row: EventItem) => {
    if (expandedId !== row.id) return null;
    return (
      <tr key={`${row.id}-expanded`} className="border-t border-border/30">
        <td colSpan={columns.length} className="px-4 py-3 bg-muted/20">
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-[11px] text-muted-foreground font-mono">
            {prettyPayload(row.payload)}
          </pre>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title={EVENTS_UI_MESSAGES.pageTitle} subtitle={EVENTS_UI_MESSAGES.pageSubtitle}>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={loading}>
            <Download size={14} className="mr-1" />
            {EVENTS_UI_MESSAGES.exportCsv}
          </Button>
          <Button variant="secondary" size="sm" onClick={fetchEvents} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin mr-1' : 'mr-1'} />
            {EVENTS_UI_MESSAGES.refresh}
          </Button>
        </div>
      </PageHeader>

      {/* 紧凑筛选工具栏 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Select
            label={EVENTS_UI_MESSAGES.typeLabel}
            value={typePrefix}
            onChange={(e) => { setTypePrefix(e.target.value); setPage(1); }}
            options={typeOptions}
          />
          <Select
            label={EVENTS_UI_MESSAGES.actorLabel}
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            options={actorOptions}
          />
          <Input
            label={EVENTS_UI_MESSAGES.queryLabel}
            placeholder={EVENTS_UI_MESSAGES.queryPlaceholder}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <Select
            label={EVENTS_UI_MESSAGES.pageSizeLabel}
            value={String(pageSize)}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            options={[{ value: '20', label: '20' }, { value: '50', label: '50' }, { value: '100', label: '100' }]}
          />
          <Input label={EVENTS_UI_MESSAGES.fromLabel} type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          <Input label={EVENTS_UI_MESSAGES.toLabel} type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} />
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Button size="sm" onClick={handleSearch}>{EVENTS_UI_MESSAGES.queryAction}</Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>{EVENTS_UI_MESSAGES.resetAction}</Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => { notify({ type: 'error', title: EVENTS_UI_MESSAGES.loadingFailed, message: error }); fetchEvents(); }}>
            {EVENTS_UI_MESSAGES.retryAction}
          </Button>
        </div>
      ) : null}

      {/* 事件数据表格 */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {columns.map((col) => (
                  <th key={col.key} className={`px-4 py-3 ${col.className || ''}`}>{col.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 ? (
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-t border-border">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-4 rounded bg-muted animate-pulse w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">{EVENTS_UI_MESSAGES.noRecords}</p>
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <>
                    <tr key={event.id} className="border-t border-border transition-colors hover:bg-muted/30">
                      {columns.map((col) => (
                        <td key={col.key} className={`px-4 py-3 ${col.className || ''}`}>{col.cell(event)}</td>
                      ))}
                    </tr>
                    {renderExpandedRow(event)}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页控件 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {EVENTS_UI_MESSAGES.paginationSummary(pagination.total, pagination.page, pagination.totalPages)}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={!hasPrev || loading}>
            {EVENTS_UI_MESSAGES.prevPage}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || loading}>
            {EVENTS_UI_MESSAGES.nextPage}
          </Button>
        </div>
      </div>
    </div>
  );
}
