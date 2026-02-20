import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/sidebar';
import { RouteTransition } from '@/components/layout/route-transition';
import { FeedbackProvider } from '@/components/providers/feedback-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SSEListener } from '@/components/providers/sse-provider';
import { LazyToaster } from '@/components/providers/lazy-toaster';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'CodingAgentsManager',
  description: 'Coding Agent CI/CD 编排平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body className="relative min-h-screen overflow-hidden antialiased">
        <div className="ambient-blobs" aria-hidden="true">
          <div className="ambient-blob ambient-blob-primary" />
          <div className="ambient-blob ambient-blob-secondary" />
          <div className="ambient-blob ambient-blob-tertiary" />
          <div className="ambient-blob ambient-blob-bottom" />
        </div>
        <div className="relative z-10 flex h-screen w-full overflow-hidden">
          <FeedbackProvider>
            <SSEListener />
            <Suspense>
              <AuthProvider>
                <Sidebar />
                <main className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                  <div className="mx-auto max-w-[82rem] px-8 py-14 sm:px-12 lg:px-16 lg:py-16">
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
