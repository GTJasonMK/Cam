// ============================================================
// OAuth 登录按钮组件
// 根据 setup-status 返回的 oauthProviders 渲染对应按钮
// ============================================================

'use client';

import { Github } from 'lucide-react';

interface OAuthProvider {
  id: string;
  displayName: string;
}

// GitLab SVG 图标（lucide-react 未内置）
function GitLabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  github: <Github size={16} aria-hidden="true" />,
  gitlab: <GitLabIcon size={16} />,
};

const PROVIDER_COLORS: Record<string, string> = {
  github: 'bg-[#24292f] hover:bg-[#24292f]/90 text-white border-transparent',
  gitlab: 'bg-[#fc6d26] hover:bg-[#fc6d26]/90 text-white border-transparent',
};

export function OAuthButtons({ providers }: { providers: OAuthProvider[] }) {
  if (providers.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-3 text-muted-foreground">或使用</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
          <a
            key={provider.id}
            href={`/api/auth/oauth/${provider.id}`}
            className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-all duration-150 ${
              PROVIDER_COLORS[provider.id] || 'bg-muted text-muted-foreground border border-border hover:text-foreground hover:bg-card-elevated'
            }`}
          >
            {PROVIDER_ICONS[provider.id]}
            {provider.displayName} 登录
          </a>
        ))}
      </div>
    </div>
  );
}
