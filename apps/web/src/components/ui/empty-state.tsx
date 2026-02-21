// 空数据占位组件 - 支持 ReactNode 图标

import { type ReactNode } from 'react';
import { Card } from './card';

interface EmptyStateProps {
  message: string;
  hint?: string;
  /** 图标：支持 lucide-react 组件或任意 ReactNode */
  icon?: ReactNode;
}

export function EmptyState({ message, hint, icon }: EmptyStateProps) {
  return (
    <Card padding="lg" className="animate-fade-in py-24 text-center">
      {icon ? (
        <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-muted/60 text-muted-foreground/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-medium text-muted-foreground">{message}</p>
      {hint ? <p className="mt-2.5 text-sm text-muted-foreground/60">{hint}</p> : null}
    </Card>
  );
}
