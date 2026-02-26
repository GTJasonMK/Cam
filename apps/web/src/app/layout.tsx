import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Noto_Sans_SC } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/sidebar';
import { RouteTransition } from '@/components/layout/route-transition';
import { FeedbackProvider } from '@/components/providers/feedback-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SSEListener } from '@/components/providers/sse-provider';
import { LazyToaster } from '@/components/providers/lazy-toaster';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const notoSansSc = Noto_Sans_SC({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CodingAgentsManager',
  description: 'Coding Agent CI/CD 编排平台',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // 虚拟键盘弹出时缩小布局视口，使 100dvh 自动适应（Chrome Android 108+）
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${plusJakartaSans.variable} ${notoSansSc.variable}`}>
      <body className="relative min-h-screen overflow-hidden antialiased">
        <div className="ambient-blobs" aria-hidden="true">
          <div className="ambient-blob ambient-blob-primary" />
          <div className="ambient-blob ambient-blob-secondary" />
          <div className="ambient-blob ambient-blob-tertiary" />
          <div className="ambient-blob ambient-blob-bottom" />
        </div>
        <div className="relative z-10 flex h-dvh w-full overflow-hidden">
          <FeedbackProvider>
            <SSEListener />
            <Suspense>
              <AuthProvider>
                <Sidebar />
                <main className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                  <div className="mx-auto max-w-[82rem] px-4 py-6 sm:px-8 sm:py-14 lg:px-16 lg:py-16">
                    <RouteTransition>{children}</RouteTransition>
                  </div>
                </main>
              </AuthProvider>
            </Suspense>
            <LazyToaster />
          </FeedbackProvider>
        </div>
      </body>
    </html>
  );
}
