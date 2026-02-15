import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDurationMs, formatTaskElapsed, getTaskDurationMs } from './duration.ts';

test('formatDurationMs: 正确格式化秒/分/小时', () => {
  assert.equal(formatDurationMs(500), '<1s');
  assert.equal(formatDurationMs(4_000), '4s');
  assert.equal(formatDurationMs(65_000), '1m 5s');
  assert.equal(formatDurationMs(3_720_000), '1h 2m');
});

test('formatTaskElapsed: started/completed 与进行中分支', () => {
  const start = '2026-01-01T00:00:00.000Z';
  const end = '2026-01-01T00:01:30.000Z';
  const done = formatTaskElapsed({ startedAt: start, completedAt: end });
  assert.equal(done.text, '1m 30s');
  assert.equal(done.ongoing, false);

  const running = formatTaskElapsed(
    { startedAt: start, completedAt: null },
    { nowMs: new Date('2026-01-01T00:00:45.000Z').getTime() }
  );
  assert.equal(running.text, '45s');
  assert.equal(running.ongoing, true);

  const notStarted = formatTaskElapsed({ startedAt: null, completedAt: null });
  assert.equal(notStarted.text, '-');
  assert.equal(notStarted.ongoing, false);
});

test('getTaskDurationMs: 支持 completed 约束与进行中计算', () => {
  const start = '2026-01-01T00:00:00.000Z';
  const end = '2026-01-01T00:00:20.000Z';

  assert.equal(getTaskDurationMs({ startedAt: start, completedAt: end }), 20_000);
  assert.equal(
    getTaskDurationMs({ startedAt: start, completedAt: null }, {
      nowMs: new Date('2026-01-01T00:00:08.000Z').getTime(),
    }),
    8_000
  );
  assert.equal(
    getTaskDurationMs({ startedAt: start, completedAt: null }, { requireCompleted: true }),
    null
  );
});
