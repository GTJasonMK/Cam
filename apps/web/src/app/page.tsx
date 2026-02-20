// ============================================================
// 仪表盘页面 — Server Component
// 服务端预取数据，传递给客户端交互层
// 未认证用户在服务端直接重定向，避免客户端二次跳转拖慢 LCP
// ============================================================

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthMode } from '@/lib/auth/config';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth/constants';
import { fetchDashboardData } from '@/lib/dashboard/queries';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  // 服务端认证检查：根据认证模式判断是否需要重定向
  const authMode = await getAuthMode();
  if (authMode !== 'none') {
    const cookieStore = await cookies();
    const hasSession = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const hasLegacy = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!hasSession && !hasLegacy) {
      redirect('/login?next=/');
    }
  }

  ensureSchedulerStarted();
  const data = await fetchDashboardData();
  return <DashboardClient initialData={data} />;
}
