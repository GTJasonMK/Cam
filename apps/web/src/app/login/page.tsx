import { Card } from '@/components/ui/card';
import { AUTH_ERROR_QUERY_CODE, AUTH_MESSAGES } from '@/lib/i18n/messages';
import { LoginScreen } from './login-screen';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const raw = searchParams ? await searchParams : {};
  const nextRaw = normalizeParam(raw.next);
  const errorRaw = normalizeParam(raw.error);

  const nextPath = nextRaw.startsWith('/') ? nextRaw : '/';
  const initialError = errorRaw
    ? (errorRaw === AUTH_ERROR_QUERY_CODE.notConfigured ? AUTH_MESSAGES.notConfiguredGuide : errorRaw.slice(0, 240))
    : '';

  return (
    <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center overflow-hidden px-4">
      {/* 背景装饰层 */}
      {/* 右上角主光晕 — 使用自然柔和渐变代替高开销 blur(130px) */}
      <div
        className="pointer-events-none fixed right-[-22%] top-[-16%] h-[680px] w-[680px] rounded-full opacity-18"
        style={{ background: 'radial-gradient(circle, rgba(94,106,210,0.55) 0%, rgba(94,106,210,0.12) 50%, transparent 85%)' }}
      />
      {/* 左下角次级光晕 */}
      <div
        className="pointer-events-none fixed bottom-[-20%] left-[-18%] h-[560px] w-[560px] rounded-full opacity-14"
        style={{ background: 'radial-gradient(circle, rgba(104,114,217,0.45) 0%, rgba(104,114,217,0.08) 50%, transparent 85%)' }}
      />
      {/* 网格背景 */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      {/* 中心辐射光效 */}
      <div
        className="pointer-events-none fixed left-1/2 top-1/3 h-[440px] w-[860px] -translate-x-1/2 -translate-y-1/2 opacity-12"
        style={{ background: 'radial-gradient(ellipse, rgba(94,106,210,0.4) 0%, rgba(94,106,210,0.06) 50%, transparent 85%)' }}
      />

      <div className="relative z-10 w-full animate-fade-in-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/45 bg-[linear-gradient(150deg,rgba(104,114,217,0.95)_0%,rgba(94,106,210,0.9)_58%,rgba(75,84,168,0.9)_100%)] shadow-[0_0_0_1px_rgba(94,106,210,0.42),0_10px_32px_rgba(94,106,210,0.35)] animate-glow-pulse">
            <span className="text-xl font-bold text-white">C</span>
          </div>
          <span className="bg-gradient-to-b from-white via-white/95 to-white/70 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">CAM</span>
          <p className="mt-1 text-sm text-muted-foreground">Coding Agents Manager</p>
        </div>
        <Card
          padding="lg"
          className="w-full border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0.035)_100%)] shadow-[var(--shadow-card-hover)]"
        >
          <LoginScreen nextPath={nextPath} initialError={initialError} />
        </Card>
      </div>
    </div>
  );
}
