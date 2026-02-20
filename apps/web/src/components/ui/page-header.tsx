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
          <h1 className="bg-gradient-to-b from-white via-white/95 to-white/70 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
            {title}
          </h1>
          {subtitle ? <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-4">{children}</div> : null}
      </div>
      <div className="mt-7 h-px w-full bg-gradient-to-r from-transparent via-white/16 to-transparent" />
    </div>
  );
}
