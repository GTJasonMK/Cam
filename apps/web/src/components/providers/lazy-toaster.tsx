// Toaster 延迟加载包装器
// sonner 的 Toaster 渲染组件较重，首屏无 toast 需要渲染时不必同步加载

'use client';

import dynamic from 'next/dynamic';

const SonnerToaster = dynamic(
  () => import('sonner').then((m) => ({ default: m.Toaster })),
  { ssr: false },
);

export function LazyToaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      toastOptions={{
        style: {
          background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--foreground)',
          backdropFilter: 'blur(14px)',
          boxShadow: 'var(--shadow-card)',
        },
      }}
    />
  );
}
