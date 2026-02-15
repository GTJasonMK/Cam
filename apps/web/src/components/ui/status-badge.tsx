// 状态徽章 - 带微妙光晕

import { getColorVar, getBadgeBg, getStatusDisplayLabel } from '@/lib/constants';

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
  const showPulse = pulse || status === 'running';
  const displayLabel = label || getStatusDisplayLabel(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'
      }`}
      style={{ background: bgColor, color: textColor }}
    >
      {showPulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: textColor }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: textColor }}
          />
        </span>
      )}
      {displayLabel}
    </span>
  );
}
