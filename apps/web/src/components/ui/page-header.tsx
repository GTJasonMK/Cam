// 页面标题栏

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl" style={{ fontFamily: 'var(--font-heading), var(--font-body), sans-serif' }}>
            {title}
          </h1>
          {subtitle ? <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">{subtitle}</p> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-4">{children}</div> : null}
      </div>
      <div className="mt-7 h-px w-full bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
    </div>
  );
}
