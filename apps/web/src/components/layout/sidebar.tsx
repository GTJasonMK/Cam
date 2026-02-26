// 侧边栏导航组件 - 使用 lucide-react 图标

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ListTodo,
  FileText,
  Activity,
  Bot,
  Server,
  Database,
  GitFork,
  TerminalSquare,
  User,
  Users,
  Settings,
  LogOut,
  X,
  Menu,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SIDEBAR_UI_MESSAGES } from '@/lib/i18n/ui-messages';
import { useAuthStore, useNavigationStore, useDashboardStore } from '@/stores';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  exact?: boolean;
  /** 动态 badge 值（> 0 时显示） */
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '核心',
    items: [
      { href: '/', label: SIDEBAR_UI_MESSAGES.nav.dashboard, icon: LayoutDashboard },
      { href: '/tasks', label: SIDEBAR_UI_MESSAGES.nav.tasks, icon: ListTodo },
      { href: '/terminal', label: SIDEBAR_UI_MESSAGES.nav.terminal, icon: TerminalSquare },
      { href: '/templates', label: SIDEBAR_UI_MESSAGES.nav.templates, icon: FileText },
      { href: '/pipelines', label: SIDEBAR_UI_MESSAGES.nav.pipelines, icon: GitFork },
    ],
  },
  {
    title: '运维',
    items: [
      { href: '/events', label: SIDEBAR_UI_MESSAGES.nav.events, icon: Activity },
      { href: '/agents', label: SIDEBAR_UI_MESSAGES.nav.agents, icon: Bot },
      { href: '/workers', label: SIDEBAR_UI_MESSAGES.nav.workersTasks, icon: Server, exact: true },
      { href: '/workers/terminal', label: SIDEBAR_UI_MESSAGES.nav.workersTerminal, icon: TerminalSquare },
      { href: '/workers/sessions', label: SIDEBAR_UI_MESSAGES.nav.workersSessions, icon: Database },
      { href: '/repos', label: SIDEBAR_UI_MESSAGES.nav.repos, icon: GitFork },
    ],
  },
  {
    title: '账户',
    items: [
      { href: '/profile', label: SIDEBAR_UI_MESSAGES.nav.profile, icon: User },
      { href: '/users', label: SIDEBAR_UI_MESSAGES.nav.users, icon: Users, adminOnly: true },
      { href: '/settings', label: SIDEBAR_UI_MESSAGES.nav.settings, icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const authInitialized = useAuthStore((s) => s.initialized);
  const clearUser = useAuthStore((s) => s.clearUser);
  const setPendingPath = useNavigationStore((s) => s.setPendingPath);
  const pendingPath = useNavigationStore((s) => s.pendingPath);
  const dashboardData = useDashboardStore((s) => s.data);

  // 活跃 Agent 会话数（用于终端 badge）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeSessionCount = (dashboardData as any)?.agentSessionSummary?.activeCount ?? 0;

  // 路由切换后自动收起移动端抽屉
  useEffect(() => {
    setMobileOpen(false);
    setPendingPath(null);
  }, [pathname, setPendingPath]);

  const filteredGroups = useMemo(() => {
    const isAdmin = user?.role === 'admin';
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items
        .filter((item) => !item.adminOnly || isAdmin)
        .map((item) => ({
          ...item,
          // 终端导航项注入活跃会话数 badge
          badge: item.href === '/terminal' ? activeSessionCount : item.badge,
        })),
    })).filter((group) => group.items.length > 0);
  }, [user?.role, activeSessionCount]);

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 忽略退出接口失败，仍然跳转登录页
    } finally {
      clearUser();
      window.location.href = '/login';
    }
  };

  // 登录页不展示侧边栏
  if (pathname === '/login') {
    return null;
  }

  return (
    <>
      {/* 移动端菜单按钮 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-[var(--shadow-card)] backdrop-blur-xl transition-all duration-200 hover:border-border-light hover:bg-card-elevated hover:text-foreground md:hidden"
        aria-label={SIDEBAR_UI_MESSAGES.openMenuAria}
      >
        <Menu size={19} />
      </button>

      {/* 移动端遮罩 */}
      {mobileOpen ? (
        <div
          role="presentation"
          className="fixed inset-0 z-40 cursor-pointer bg-background/85 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(var(--sidebar-width),85vw)] flex-col border-r border-sidebar-border bg-sidebar shadow-[0_18px_36px_rgba(6,11,17,0.48)] backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:static md:z-auto md:w-[var(--sidebar-width)] md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" />

        {/* Logo */}
        <div className="flex h-[4.5rem] items-center gap-3 px-[1.125rem]">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/45 bg-primary shadow-[0_8px_20px_rgba(47,111,237,0.28)]">
            <span className="text-base font-bold text-white">C</span>
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold tracking-tight text-foreground" style={{ fontFamily: 'var(--font-heading), var(--font-body), sans-serif' }}>CAM</p>
            <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Control Center</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground md:hidden"
            aria-label={SIDEBAR_UI_MESSAGES.closeMenuAria}
          >
            <X size={16} />
          </button>
        </div>

        {/* 分隔线 */}
        <div className="mx-3 h-px bg-border" />

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {filteredGroups.map((group, groupIdx) => (
            <div key={group.title} className={cn(groupIdx > 0 && 'mt-5')}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  // 点击后立即高亮：优先使用 pendingPath，页面加载完成后回退到 pathname
                  const activePath = pendingPath ?? pathname;
                  const isActive = item.href === '/'
                    ? activePath === '/'
                    : item.exact
                      ? activePath === item.href
                      : activePath === item.href || activePath.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => {
                        setPendingPath(item.href);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-[0.95rem] font-medium transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                        isActive
                          ? 'border-primary/40 bg-primary/12 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(47,111,237,0.18)]'
                          : 'border-transparent text-muted-foreground hover:border-border hover:bg-card-elevated/70 hover:text-foreground',
                      )}
                    >
                      {/* 活跃态左侧指示条 + 发光 */}
                      {isActive ? (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
                          style={{ boxShadow: '0 0 12px rgba(47, 111, 237, 0.42)' }}
                        />
                      ) : null}
                      <Icon
                        size={19}
                        className={cn(
                          'transition-colors',
                          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                        )}
                      />
                      {item.label}
                      {item.badge != null && item.badge > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/18 px-1.5 text-[10px] font-semibold tabular-nums text-primary">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 底部分隔线 */}
        <div className="mx-3 h-px bg-border" />

        {/* 底部状态 */}
        <div className="space-y-3 px-3 py-4">
          {/* 当前用户 */}
          {authLoading && !authInitialized ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">加载账户中...</div>
          ) : user ? (
            <Link
              href="/profile"
              onClick={() => {
                setPendingPath('/profile');
                setMobileOpen(false);
              }}
              className="flex items-center gap-2.5 rounded-xl border border-transparent bg-card/35 px-2.5 py-3.5 transition-all duration-200 hover:border-border hover:bg-card-elevated/70"
              title="进入个人设置"
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/14">
                  <span className="text-xs font-semibold text-primary">
                    {(user.displayName || user.username || '?')[0]?.toUpperCase()}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{user.displayName || user.username}</p>
                <p className="truncate text-xs text-muted-foreground/85">@{user.username} · {user.role}</p>
              </div>
            </Link>
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground">未登录</div>
          )}

          <div className="flex items-center gap-2 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_rgba(38,194,129,0.9)]" />
            <span className="text-xs text-muted-foreground/85">{SIDEBAR_UI_MESSAGES.version}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut size={14} />
            {SIDEBAR_UI_MESSAGES.signOut}
          </button>
        </div>
      </aside>
    </>
  );
}
