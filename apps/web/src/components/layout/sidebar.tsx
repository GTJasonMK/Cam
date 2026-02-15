// 侧边栏导航组件 - 使用 lucide-react 图标

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ListTodo,
  FileText,
  Activity,
  Bot,
  Server,
  GitFork,
  Settings,
  LogOut,
  X,
  Menu,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SIDEBAR_UI_MESSAGES } from '@/lib/i18n/ui-messages';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: SIDEBAR_UI_MESSAGES.nav.dashboard, icon: LayoutDashboard },
  { href: '/tasks', label: SIDEBAR_UI_MESSAGES.nav.tasks, icon: ListTodo },
  { href: '/templates', label: SIDEBAR_UI_MESSAGES.nav.templates, icon: FileText },
  { href: '/events', label: SIDEBAR_UI_MESSAGES.nav.events, icon: Activity },
  { href: '/agents', label: SIDEBAR_UI_MESSAGES.nav.agents, icon: Bot },
  { href: '/workers', label: SIDEBAR_UI_MESSAGES.nav.workers, icon: Server },
  { href: '/repos', label: SIDEBAR_UI_MESSAGES.nav.repos, icon: GitFork },
  { href: '/settings', label: SIDEBAR_UI_MESSAGES.nav.settings, icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // 路由切换后自动收起移动端抽屉
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // 登录页不展示侧边栏
  if (pathname === '/login') {
    return null;
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 忽略退出接口失败，仍然跳转登录页
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground md:hidden"
        aria-label={SIDEBAR_UI_MESSAGES.openMenuAria}
      >
        <Menu size={18} />
      </button>

      {/* 移动端遮罩 */}
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label={SIDEBAR_UI_MESSAGES.closeMenuAria}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-52 flex-col border-r border-border bg-card transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <span className="text-xs font-bold text-white">C</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">CAM</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            aria-label={SIDEBAR_UI_MESSAGES.closeMenuAria}
          >
            <X size={16} />
          </button>
        </div>

        {/* 分隔线 */}
        <div className="mx-3 h-px bg-border" />

        {/* 导航 */}
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
            {SIDEBAR_UI_MESSAGES.navTitle}
          </p>
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-muted/50 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                }`}
              >
                {/* 活跃态左侧指示条 */}
                {isActive ? (
                  <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary" />
                ) : null}
                <Icon size={18} className={isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 底部分隔线 */}
        <div className="mx-3 h-px bg-border" />

        {/* 底部状态 */}
        <div className="space-y-2 px-3 py-3">
          <div className="flex items-center gap-2 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            <span className="text-[11px] text-muted-foreground">{SIDEBAR_UI_MESSAGES.version}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            <LogOut size={14} />
            {SIDEBAR_UI_MESSAGES.signOut}
          </button>
        </div>
      </aside>
    </>
  );
}
