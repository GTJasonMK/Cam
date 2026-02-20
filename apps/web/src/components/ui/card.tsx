// shadcn/ui Card — 子组件 API + 旧 padding/hover/variant 兼容

import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---- 子组件 API（shadcn 标准） ---- */

const CardRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] text-card-foreground shadow-[var(--shadow-card)] before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent',
        className,
      )}
      {...props}
    />
  ),
);
CardRoot.displayName = 'CardRoot';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-2 p-7', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-7 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-7 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

/* ---- 便捷 Card（向后兼容旧 padding/hover/glow/variant props） ---- */

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  glow?: string;
  variant?: 'default' | 'accent-top' | 'accent-left';
  accentColor?: string;
}

const PADDING: Record<string, string> = {
  none: '',
  sm: 'p-5',
  md: 'p-6',
  lg: 'p-8',
};

function Card({ children, className, padding = 'md', hover = false, glow, variant = 'default', accentColor }: CardProps) {
  const accent = accentColor || 'var(--color-primary)';
  const accentStyle: React.CSSProperties | undefined =
    variant === 'accent-top'
      ? { borderTop: `3px solid ${accent}` }
      : variant === 'accent-left'
        ? { borderLeft: `3px solid ${accent}` }
        : undefined;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] shadow-[var(--shadow-card)]',
        'before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent',
        PADDING[padding],
        hover && 'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-white/14 hover:bg-card-elevated hover:shadow-[var(--shadow-card-hover)]',
        className,
      )}
      style={{
        ...accentStyle,
        boxShadow: glow || 'var(--shadow-card)',
      }}
    >
      {children}
    </div>
  );
}

export { Card, CardRoot, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
