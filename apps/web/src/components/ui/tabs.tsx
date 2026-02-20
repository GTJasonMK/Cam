// shadcn/ui Tabs — Radix Tabs + 滑动指示线

'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('relative flex gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1.5', className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
      'text-muted-foreground hover:text-foreground',
      'data-[state=active]:bg-white/[0.08] data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

/* ---- 便捷的旧 API 兼容封装 ---- */

interface Tab {
  key: string;
  label: string;
  count?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
}

/**
 * 向后兼容的 TabBar（基于 Radix Tabs + 滑动指示线）
 * 供旧代码使用：<TabBar tabs={[...]} activeKey="x" onChange={fn} />
 */
function TabBar({ tabs, activeKey, onChange }: TabBarProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });

  const updateIndicator = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('[data-state="active"]');
    if (!activeBtn) return;
    setIndicator({ left: activeBtn.offsetLeft, width: activeBtn.offsetWidth });
  }, []);

  React.useLayoutEffect(() => {
    updateIndicator();
  }, [activeKey, updateIndicator]);

  React.useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <Tabs value={activeKey} onValueChange={onChange}>
      <TabsList ref={containerRef}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
            {tab.count != null ? (
              <span
                className={cn(
                  'ml-2 inline-flex min-w-[20px] items-center justify-center rounded px-1.5 text-[0.78rem]',
                  tab.key === activeKey
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
        {/* 滑动指示线 */}
        <span
          className="absolute bottom-[3px] h-[2px] rounded-full bg-primary transition-all duration-300 ease-out"
          style={{
            left: indicator.left + 4,
            width: Math.max(indicator.width - 8, 0),
          }}
        />
      </TabsList>
    </Tabs>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabBar };

// 旧名兼容导出
export { TabBar as default };
