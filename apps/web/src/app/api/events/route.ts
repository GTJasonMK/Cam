// ============================================================
// API: 系统事件查询
// GET /api/events - 分页查询系统事件（支持类型前缀与关键词过滤）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, like, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { systemEvents } from '@/lib/db/schema';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_EXPORT_LIMIT = 5000;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTypePrefix(value: string | null): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function normalizeQuery(value: string | null): string {
  if (!value) return '';
  return value.trim();
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function escapeCsvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function buildEventsCsv(
  rows: Array<{ id: string; type: string; actor: string | null; payload: Record<string, unknown>; timestamp: string }>
): string {
  const header = ['id', 'type', 'actor', 'timestamp', 'payload'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.type,
        row.actor || '',
        row.timestamp,
        JSON.stringify(row.payload || {}),
      ]
        .map((cell) => escapeCsvCell(cell))
        .join(',')
    );
  }
  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  ensureSchedulerStarted();
  try {
    const { searchParams } = new URL(request.url);
    const format = normalizeQuery(searchParams.get('format')).toLowerCase();
    const page = parsePositiveInt(searchParams.get('page'), DEFAULT_PAGE);
    const pageSize = Math.min(parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const exportLimit = Math.min(parsePositiveInt(searchParams.get('limit'), DEFAULT_EXPORT_LIMIT), DEFAULT_EXPORT_LIMIT);
    const typePrefix = normalizeTypePrefix(searchParams.get('typePrefix'));
    const query = normalizeQuery(searchParams.get('q'));
    const actor = normalizeQuery(searchParams.get('actor'));
    const from = normalizeTimestamp(searchParams.get('from'));
    const to = normalizeTimestamp(searchParams.get('to'));

    const whereConditions: SQL[] = [];
    if (typePrefix) {
      whereConditions.push(like(systemEvents.type, `${typePrefix}%`));
    }
    if (actor) {
      whereConditions.push(like(systemEvents.actor, `%${actor}%`));
    }
    if (query) {
      const pattern = `%${query}%`;
      whereConditions.push(
        sql`(${systemEvents.type} like ${pattern} OR cast(${systemEvents.payload} as text) like ${pattern})`
      );
    }
    if (from) {
      whereConditions.push(sql`${systemEvents.timestamp} >= ${from}`);
    }
    if (to) {
      whereConditions.push(sql`${systemEvents.timestamp} <= ${to}`);
    }
    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    if (format === 'csv') {
      const rows = await db
        .select()
        .from(systemEvents)
        .where(whereClause)
        .orderBy(desc(systemEvents.timestamp))
        .limit(exportLimit);

      const csv = buildEventsCsv(rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="events-export-${Date.now()}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const offset = (page - 1) * pageSize;
    const [events, totalRows, prefixRows] = await Promise.all([
      db
        .select()
        .from(systemEvents)
        .where(whereClause)
        .orderBy(desc(systemEvents.timestamp))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`cast(count(*) as integer)` })
        .from(systemEvents)
        .where(whereClause),
      db
        .select({ type: systemEvents.type, actor: systemEvents.actor })
        .from(systemEvents)
        .orderBy(desc(systemEvents.timestamp))
        .limit(300),
    ]);

    const total = totalRows[0]?.count ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    const prefixSet = new Set<string>();
    for (const row of prefixRows) {
      const prefix = row.type.split('.')[0];
      if (prefix) prefixSet.add(prefix);
    }
    const actorSet = new Set<string>();
    for (const row of prefixRows) {
      const actorValue = row.actor?.trim();
      if (!actorValue) continue;
      actorSet.add(actorValue);
      if (actorSet.size >= 100) break;
    }

    return NextResponse.json({
      success: true,
      data: {
        events,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        },
        availablePrefixes: Array.from(prefixSet).sort(),
        availableActors: Array.from(actorSet).sort(),
      },
    });
  } catch (err) {
    console.error('[API] 查询系统事件失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.querySystemEventsFailed } },
      { status: 500 }
    );
  }
}
