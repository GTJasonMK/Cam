// 状态徽章 - 带微妙光晕

import { cn } from '@/lib/utils';
import { getColorVar, getBadgeBg, getBadgeBorder, getStatusDisplayLabel } from '@/lib/constants';

interface StatusBadgeProps {
  status: string;
  colorToken: string;
  label?: string;
  size?: 'sm' | 'md';
  pulse?: boolean;
}

export function StatusBadge({ status, colorToken, label, size = 'sm', pulse = false }: StatusBadgeProps) {
  const textColor = getColorVar(colorToken);
  const bgColor = getBadgeBg(colorToken);
  const borderColor = getBadgeBorder(colorToken);
  const showPulse = pulse || status === 'running';
  const displayLabel = label || getStatusDisplayLabel(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap leading-none',
        size === 'sm' ? 'px-3.5 py-1.5 text-[0.8125rem]' : 'px-4 py-1.5 text-sm',
      )}
      style={{ background: bgColor, color: textColor, border: `1px solid ${borderColor}` }}
    >
      {showPulse && (
        <span className="relative flex h-2 w-2">
          <span
            className="absolute inline-flex h-full w-full animate-ping-slow rounded-full opacity-75"
            style={{ background: textColor }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ background: textColor }}
          />
        </span>
      )}
      {displayLabel}
    </span>
  );
}
