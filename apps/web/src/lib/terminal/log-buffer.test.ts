import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTerminalLogLine, splitTerminalLogChunk } from './log-buffer.ts';

test('splitTerminalLogChunk: 处理 CRLF/CR 与 partialLine 拼接', () => {
  const result = splitTerminalLogChunk('abc', 'def\r\nghi\rjkl\n\nm');
  assert.deepEqual(result.lines, ['abcdef', 'ghi', 'jkl']);
  assert.equal(result.nextPartialLine, 'm');
});

test('appendTerminalLogLine: 超过队列上限时丢弃最旧日志', () => {
  const result = appendTerminalLogLine({
    pendingLines: ['line-1', 'line-2'],
    droppedLines: 0,
    line: 'line-3',
    maxLineLength: 20,
    maxPendingLines: 2,
  });

  assert.deepEqual(result.pendingLines, ['line-2', 'line-3']);
  assert.equal(result.droppedLines, 1);
});

test('appendTerminalLogLine: 按最大行长截断日志行', () => {
  const result = appendTerminalLogLine({
    pendingLines: [],
    droppedLines: 0,
    line: '123456789',
    maxLineLength: 5,
    maxPendingLines: 10,
  });

  assert.deepEqual(result.pendingLines, ['12345']);
  assert.equal(result.droppedLines, 0);
});
