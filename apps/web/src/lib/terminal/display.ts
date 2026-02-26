import { formatDateTimeZhCn, toSafeTimestamp } from '../time/format.ts';

export function truncateText(value: string, length = 12): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
}

export { formatDateTimeZhCn, toSafeTimestamp };
