import { Alert, Button, Field, Input } from '@arabat/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from './api-context.js';
import { authQueryKey } from './auth.js';
import { LanguageSwitcher, useErrorMessage } from './components.js';

/**
 * POS lock screen (AUTH.md §2.1). The server refuses the session until its user enters the
 * password again; another person can only end the session and sign in themselves.
 */
export function LockScreen() {
  const { t } = useTranslation('common');
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const message = useErrorMessage();
  const [password, setPassword] = useState('');
  const unlock = useMutation({
    mutationFn: () => api.auth.posUnlock(password),
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries();
    },
    onError: () => {
      setPassword('');
      // Too many wrong passwords end the session: re-read it (it becomes anonymous).
      void queryClient.invalidateQueries({ queryKey: authQueryKey('pos') });
    },
  });
  const signOut = useMutation({
    mutationFn: () => api.auth.posLockedSignOut(),
    onSettled: async () => {
      queryClient.setQueryData(authQueryKey('pos'), null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      await navigate('/login', { replace: true });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) unlock.mutate();
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-console p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-surface p-6 shadow-xl"
        aria-labelledby="lock-title"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 id="lock-title" className="text-xl font-semibold">
              {t('lock.title')}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">{t('lock.body')}</p>
          </div>
          <LanguageSwitcher />
        </div>
        <Field label={t('auth.password')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {unlock.isError ? <Alert tone="danger">{message(unlock.error)}</Alert> : null}
        <Button type="submit" size="lg" loading={unlock.isPending} disabled={!password}>
          {t('lock.unlock')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          loading={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {t('lock.otherUser')}
        </Button>
      </form>
    </main>
  );
}
