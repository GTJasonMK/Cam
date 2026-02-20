'use client';

// ============================================================
// 认证 Provider：挂载时自动获取当前用户
// ============================================================

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const initialized = useAuthStore((s) => s.initialized);
  const statusCode = useAuthStore((s) => s.statusCode);
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    // 登录页不需要获取用户信息
    if (pathname === '/login') return;
    if (!initialized) {
      fetchCurrentUser();
    }
  }, [pathname, initialized, fetchCurrentUser]);

  useEffect(() => {
    if (pathname === '/login') return;
    if (!initialized) return;
    if (user) return;
    if (statusCode !== 401) return;

    const qs = searchParams?.toString();
    const next = `${pathname}${qs ? `?${qs}` : ''}`;
    const target = `/login?next=${encodeURIComponent(next)}`;
    router.replace(target);
  }, [pathname, initialized, statusCode, user, router, searchParams]);

  return <>{children}</>;
}
