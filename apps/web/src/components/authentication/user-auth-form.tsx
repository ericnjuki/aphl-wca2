import * as React from 'react';
import { cn } from '@/lib/utils';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { useMultiNamespaceTranslation } from '@/i18n/hooks';

export function UserAuthForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const login = useAuthStore((s) => s.login);
  const { t } = useMultiNamespaceTranslation(['common', 'app']);

  const [loginValue, setLoginValue] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    const result = await login(loginValue, password);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
    }
  }

  return (
    <div className={cn('grid gap-6', className)} {...props}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-login" className="text-sm font-medium">
            {t('app:auth.username')}
          </label>
          <input
            id="auth-login"
            type="text"
            autoComplete="username"
            autoFocus
            required
            placeholder="Username or email"
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-password" className="text-sm font-medium">
            {t('app:auth.password')}
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={isLoading} className="mt-1 rounded-xs">
          {isLoading && <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />}
          {t('app:authentication.login')}
        </Button>
      </form>
    </div>
  );
}
