import { Card } from '@/components/ui/card';
import { AUTH_ERROR_QUERY_CODE, AUTH_MESSAGES } from '@/lib/i18n/messages';
import { LoginForm } from './login-form';

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
  const initialError =
    errorRaw === AUTH_ERROR_QUERY_CODE.notConfigured ? AUTH_MESSAGES.notConfiguredGuide : '';

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4">
      <Card padding="lg" className="w-full">
        <LoginForm nextPath={nextPath} initialError={initialError} />
      </Card>
    </div>
  );
}
