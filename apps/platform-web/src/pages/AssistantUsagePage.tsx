import type { AssistantRequestRecord, AssistantUsageQuery } from '@arabat/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  PageHeader,
  Section,
  Select,
  StatCard,
  buttonVariants,
} from '@arabat/ui';
import { AssistantMarkup, ErrorState, useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat } from '../shared.js';

/** Micro-USD as a dollar figure with four decimals (an estimate at list price). */
export function usd(micro: number | null): string {
  if (micro === null) return '—';
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / 1_000_000);
  const frac = Math.round((abs % 1_000_000) / 100);
  return `${sign}$${whole.toLocaleString('en-US')}.${String(frac).padStart(4, '0')}`;
}

const tokens = (n: number) => n.toLocaleString('en-US');

const OUTCOME_TONE = {
  answered: 'success',
  fallback: 'warning',
  refused: 'warning',
  failed: 'danger',
} as const;

/**
 * The system owner's record of every assistant question (ADR-0105 amendment): conversations,
 * tokens and estimated cost per company, with a JSONL export for review and training.
 */
export function AssistantUsagePage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const [surface, setSurface] = useState<'' | 'pos' | 'manager'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AssistantRequestRecord | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const query: AssistantUsageQuery = {
    page,
    pageSize: 50,
    ...(surface ? { surface } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(merchantId ? { merchantId } : {}),
    ...(q ? { q } : {}),
  };
  const usage = useQuery({
    queryKey: [...platformKey, 'assistant', query],
    queryFn: () => api.platform.assistantUsage(query),
    placeholderData: keepPreviousData,
  });
  const totals = usage.data?.totals;
  const pages = usage.data ? Math.max(1, Math.ceil(usage.data.total / usage.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('assistant.title')}
        description={t('assistant.subtitle')}
        actions={
          <a
            className={buttonVariants({ variant: 'secondary' })}
            href={api.platform.assistantExportUrl(query)}
            download
          >
            {t('assistant.export')}
          </a>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('assistant.requests')} value={totals ? tokens(totals.requests) : '…'} />
        <StatCard
          label={t('assistant.cost')}
          value={totals ? usd(totals.costMicroUsd) : '…'}
          hint={t('assistant.costHint')}
        />
        <StatCard
          label={t('assistant.tokensInOut')}
          value={totals ? `${tokens(totals.inputTokens)} / ${tokens(totals.outputTokens)}` : '…'}
        />
        <StatCard
          label={t('assistant.tokensCache')}
          value={
            totals ? `${tokens(totals.cacheWriteTokens)} / ${tokens(totals.cacheReadTokens)}` : '…'
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          aria-label={t('assistant.surface')}
          value={surface}
          onChange={(e) => {
            setSurface(e.target.value as '' | 'pos' | 'manager');
            setPage(1);
          }}
        >
          <option value="">{t('assistant.allSurfaces')}</option>
          <option value="pos">{t('assistant.surfacePos')}</option>
          <option value="manager">{t('assistant.surfaceManager')}</option>
        </Select>
        <Input
          type="date"
          aria-label={t('assistant.from')}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <Input
          type="date"
          aria-label={t('assistant.to')}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label={t('assistant.merchant')}
          value={merchantId}
          onChange={(e) => {
            setMerchantId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('assistant.allMerchants')}</option>
          {(usage.data?.byMerchant ?? []).map((m) => (
            <option key={m.merchantId} value={m.merchantId}>
              {f.name({ nameEn: m.merchantNameEn, nameAr: m.merchantNameAr })}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          aria-label={t('assistant.search')}
          placeholder={t('assistant.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {!merchantId && usage.data && usage.data.byMerchant.length > 1 ? (
        <Section title={t('assistant.byMerchant')}>
          <DataTable
            caption={t('assistant.byMerchant')}
            rows={usage.data.byMerchant}
            rowKey={(m) => m.merchantId}
            onRowClick={(m) => {
              setMerchantId(m.merchantId);
              setPage(1);
            }}
            columns={[
              {
                key: 'merchant',
                header: t('assistant.merchant'),
                cell: (m) => f.name({ nameEn: m.merchantNameEn, nameAr: m.merchantNameAr }),
              },
              { key: 'requests', header: t('assistant.requests'), cell: (m) => tokens(m.requests) },
              { key: 'users', header: t('assistant.users'), cell: (m) => tokens(m.users) },
              {
                key: 'tokens',
                header: t('assistant.tokensInOut'),
                hideBelow: 'md',
                cell: (m) => `${tokens(m.inputTokens)} / ${tokens(m.outputTokens)}`,
              },
              { key: 'cost', header: t('assistant.cost'), cell: (m) => usd(m.costMicroUsd) },
              {
                key: 'last',
                header: t('assistant.last'),
                hideBelow: 'lg',
                cell: (m) => f.date(m.lastAt),
              },
            ]}
          />
        </Section>
      ) : null}
      <DataTable
        caption={t('assistant.conversations')}
        loading={usage.isPending}
        error={
          usage.isError ? (
            <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
          ) : null
        }
        rows={usage.data?.requests}
        rowKey={(r) => r.id}
        empty={t('assistant.empty')}
        onRowClick={(r) => setOpen(r)}
        columns={[
          { key: 'when', header: t('assistant.when'), cell: (r) => f.date(r.createdAt) },
          {
            key: 'merchant',
            header: t('assistant.merchant'),
            hideBelow: 'md',
            cell: (r) => f.name({ nameEn: r.merchantNameEn, nameAr: r.merchantNameAr }),
          },
          { key: 'user', header: t('assistant.user'), hideBelow: 'lg', cell: (r) => r.userName },
          {
            key: 'surface',
            header: t('assistant.surface'),
            hideBelow: 'lg',
            cell: (r) =>
              t(r.surface === 'pos' ? 'assistant.surfacePos' : 'assistant.surfaceManager'),
          },
          {
            key: 'question',
            header: t('assistant.question'),
            cell: (r) => <span className="line-clamp-2">{r.question}</span>,
          },
          {
            key: 'outcome',
            header: t('assistant.outcome'),
            cell: (r) => (
              <Badge tone={OUTCOME_TONE[r.outcome]}>{t(`assistant.outcomes.${r.outcome}`)}</Badge>
            ),
          },
          {
            key: 'tokens',
            header: t('assistant.tokensInOut'),
            hideBelow: 'md',
            cell: (r) => `${tokens(r.inputTokens)} / ${tokens(r.outputTokens)}`,
          },
          { key: 'cost', header: t('assistant.cost'), cell: (r) => usd(r.costMicroUsd) },
        ]}
      />
      {usage.data && pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('assistant.previous')}
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('assistant.next')}
          </Button>
        </div>
      ) : null}
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={t('assistant.conversation')}
          size="lg"
        >
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-fg-muted">{t('assistant.merchant')}</dt>
            <dd>{f.name({ nameEn: open.merchantNameEn, nameAr: open.merchantNameAr })}</dd>
            <dt className="text-fg-muted">{t('assistant.user')}</dt>
            <dd>
              {open.userName} <span className="text-fg-muted">({open.userEmail})</span>
            </dd>
            <dt className="text-fg-muted">{t('assistant.branch')}</dt>
            <dd>
              {open.branchNameEn || open.branchNameAr
                ? f.name({ nameEn: open.branchNameEn, nameAr: open.branchNameAr })
                : t('assistant.allBranches')}
            </dd>
            <dt className="text-fg-muted">{t('assistant.when')}</dt>
            <dd>{f.date(open.createdAt)}</dd>
            <dt className="text-fg-muted">{t('assistant.model')}</dt>
            <dd dir="ltr" className="font-mono text-xs">
              {open.model}
            </dd>
            <dt className="text-fg-muted">{t('assistant.tools')}</dt>
            <dd dir="ltr" className="font-mono text-xs">
              {open.toolsUsed.join(', ') || '—'}
            </dd>
            <dt className="text-fg-muted">{t('assistant.tokensAll')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {tokens(open.inputTokens)} / {tokens(open.outputTokens)} /{' '}
              {tokens(open.cacheWriteTokens)} / {tokens(open.cacheReadTokens)}
            </dd>
            <dt className="text-fg-muted">{t('assistant.cost')}</dt>
            <dd className="tabular-nums">
              {usd(open.costMicroUsd)} · {open.durationMs} ms · {open.rounds}{' '}
              {t('assistant.rounds')}
              {open.error ? ` · ${open.error}` : ''}
            </dd>
          </dl>
          <div
            className="max-h-[50dvh] space-y-2 overflow-y-auto rounded-md bg-surface-muted p-3"
            dir={open.language === 'ar' ? 'rtl' : 'ltr'}
          >
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-fg">
                {open.question}
              </p>
            </div>
            {open.reply ? (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm leading-relaxed text-fg">
                  <AssistantMarkup text={open.reply} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{t('assistant.noReply')}</p>
            )}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
