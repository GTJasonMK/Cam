// ============================================================
// 标签页切换组件
// 水平排列标签，底部线条指示活跃态，支持数量角标
// ============================================================

'use client';

interface Tab {
  key: string;
  label: string;
  /** 右侧数量角标 */
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, activeKey, onChange }: TabsProps) {
  return (
    <div className="flex gap-0 border-b border-border">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count != null ? (
              <span
                className={`ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded px-1 text-xs ${
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
            {/* 活跃态底部指示线 */}
            {active ? (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
