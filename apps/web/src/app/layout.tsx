import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/sidebar';
import { SSEProvider } from '@/components/providers/sse-provider';
import { FeedbackProvider } from '@/components/providers/feedback-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'CodingAgentsManager',
  description: 'Coding Agent CI/CD 编排平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body className="flex h-screen overflow-hidden">
        <FeedbackProvider>
          <SSEProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8">
                {children}
              </div>
            </main>
          </SSEProvider>
        </FeedbackProvider>
      </body>
    </html>
  );
}
