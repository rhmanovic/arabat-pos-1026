import type { SessionInfo } from '@arabat/contracts';
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Section } from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

const sessionsKey = ['auth', 'sessions'] as const;

/**
 * My account (BR-193): change the password with the current one (every other session ends)
 * and see / end the devices signed in with this account.
 */
export function AccountPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const sessions = useQuery({ queryKey: sessionsKey, queryFn: () => api.auth.sessions() });
  const change = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
      notify.ok(t('account.passwordChanged'));
    },
    onError: notify.fail,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
      notify.ok(t('account.sessionEnded'));
    },
    onError: notify.fail,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.auth.revokeOtherSessions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
      notify.ok(t('account.othersEnded'));
    },
    onError: notify.fail,
  });
  const valid = current.length > 0 && next.length >= 10 && next === confirm && next !== current;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('account.title')}
        description={`${session.actor.fullName} · ${session.actor.email}`}
      />
      <Section title={t('account.password')} description={t('account.passwordHint')}>
        <form
          className="grid gap-4 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) change.mutate();
          }}
        >
          <Field label={t('account.currentPassword')}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('account.newPassword')} hint={t('account.newPasswordHint')}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('account.confirmPassword')}
            error={confirm && confirm !== next ? t('account.mismatch') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <div className="md:col-span-3">
            <Button type="submit" disabled={!valid} loading={change.isPending}>
              {t('account.changePassword')}
            </Button>
          </div>
        </form>
      </Section>
      <Section
        title={t('account.sessions')}
        description={t('account.sessionsHint')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={revokeOthers.isPending}
            disabled={(sessions.data?.sessions.length ?? 0) < 2}
            onClick={() => revokeOthers.mutate()}
          >
            {t('account.endOthers')}
          </Button>
        }
      >
        <DataTable<SessionInfo>
          caption={t('account.sessions')}
          loading={sessions.isPending}
          error={
            sessions.isError ? (
              <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
            ) : null
          }
          rows={sessions.data?.sessions}
          rowKey={(s) => s.id}
          columns={[
            {
              key: 'where',
              header: t('account.device'),
              cell: (s) => (
                <span>
                  <span className="flex items-center gap-2">
                    <Badge tone={s.interface === 'pos' ? 'warning' : 'primary'}>
                      {t(`account.interface_${s.interface}`)}
                    </Badge>
                    {s.current ? <Badge tone="success">{t('account.thisDevice')}</Badge> : null}
                    {s.merchantName}
                  </span>
                  <span className="block text-xs text-fg-muted" dir="ltr">
                    {s.userAgent ?? '—'}
                  </span>
                </span>
              ),
            },
            { key: 'ip', header: t('account.ip'), hideBelow: 'sm', cell: (s) => s.ip ?? '—' },
            {
              key: 'seen',
              header: t('account.lastSeen'),
              hideBelow: 'md',
              cell: (s) => formatDateTime(s.lastSeenAt, i18n.language),
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('common.actions')}</span>,
              cell: (s) =>
                s.current ? null : (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    {t('account.endSession')}
                  </Button>
                ),
            },
          ]}
        />
      </Section>
      <Alert tone="info">{t('account.lockHint')}</Alert>
    </div>
  );
}
