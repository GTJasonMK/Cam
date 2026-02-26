export function splitTerminalLogChunk(partialLine: string, chunk: string): {
  lines: string[];
  nextPartialLine: string;
} {
  const normalizedChunk = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const merged = partialLine + normalizedChunk;
  const segments = merged.split('\n');
  const nextPartialLine = segments.pop() ?? '';
  const lines = segments.filter((line) => line.length > 0);
  return { lines, nextPartialLine };
}

export function appendTerminalLogLine(input: {
  pendingLines: string[];
  droppedLines: number;
  line: string;
  maxLineLength: number;
  maxPendingLines: number;
}): {
  pendingLines: string[];
  droppedLines: number;
} {
  const normalizedLine = input.line.length > input.maxLineLength
    ? input.line.slice(0, input.maxLineLength)
    : input.line;

  const pendingLines = [...input.pendingLines, normalizedLine];
  let droppedLines = input.droppedLines;

  if (pendingLines.length > input.maxPendingLines) {
    const overflow = pendingLines.length - input.maxPendingLines;
    pendingLines.splice(0, overflow);
    droppedLines += overflow;
  }

  return { pendingLines, droppedLines };
}
