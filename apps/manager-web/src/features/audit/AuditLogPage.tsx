import type { AuditEntry, AuditListQuery } from '@arabat/contracts';
import { Badge, Button, DataTable, Input, PageHeader, Select } from '@arabat/ui';
import { ErrorState, useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager } from '../inventory/shared.js';
import { downloadText, toCsv } from '../reports/shared.js';

export const auditKey = ['manager', 'audit'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

/** Audit details in one readable line: `price: 1.000 → 1.250 · reason: damaged`. */
export function summarizeDetails(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      if ('from' in v || 'to' in v) {
        parts.push(`${key}: ${String(v['from'] ?? '—')} → ${String(v['to'] ?? '—')}`);
        continue;
      }
      parts.push(`${key}: ${JSON.stringify(v)}`);
      continue;
    }
    parts.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return parts.join(' · ');
}

const ACTOR_TONE = {
  user: 'primary',
  operator: 'warning',
  system: 'neutral',
  anonymous: 'neutral',
} as const;

/**
 * The company's own audit trail (BR-163): who did what and when, with filters and a CSV
 * export built from the displayed rows (ADR-0071). Entries can never be edited or deleted.
 */
export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actionText, setActionText] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAction(actionText.trim()), 300);
    return () => clearTimeout(id);
  }, [actionText]);
  const filterKey = JSON.stringify([from, to, action, targetType]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query: AuditListQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(DATE.test(from) ? { from } : {}),
    ...(DATE.test(to) ? { to } : {}),
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
  };
  const list = useQuery({
    queryKey: [...auditKey, query],
    queryFn: () => api.audit.list(query),
    placeholderData: keepPreviousData,
  });
  const actorLabel = (e: AuditEntry) =>
    e.actorType === 'user'
      ? (e.actorName ?? t('audit.unknownUser'))
      : t(`audit.actor_${e.actorType}`);
  const targetTypes = Array.from(
    new Set(
      (list.data?.entries ?? [])
        .map((e) => e.targetType)
        .filter((x): x is string => Boolean(x))
        .concat(targetType ? [targetType] : []),
    ),
  ).sort();
  const exportCsv = () => {
    const rows = (list.data?.entries ?? []).map((e) => [
      formatDateTime(e.occurredAt, i18n.language),
      actorLabel(e),
      e.action,
      e.targetType ?? '',
      e.targetId ?? '',
      e.ip ?? '',
      summarizeDetails(e.details),
    ]);
    downloadText(
      `audit-${from || 'all'}-${to || 'all'}-p${page}.csv`,
      toCsv(
        [
          t('audit.when'),
          t('audit.actor'),
          t('audit.action'),
          t('audit.targetType'),
          t('audit.targetId'),
          t('audit.ip'),
          t('audit.details'),
        ],
        rows,
      ),
    );
  };
  return (
    <div>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!list.data?.entries.length}>
            {t('audit.export')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.from')}
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.to')}
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Input
          type="search"
          className="max-w-xs"
          list="audit-actions"
          aria-label={t('audit.filterAction')}
          placeholder={t('audit.filterAction')}
          value={actionText}
          onChange={(e) => setActionText(e.target.value)}
        />
        <datalist id="audit-actions">
          {(list.data?.actions ?? []).map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <Select
          className="max-w-48"
          aria-label={t('audit.targetType')}
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
        >
          <option value="">{t('audit.allTargets')}</option>
          {targetTypes.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        caption={t('audit.title')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.entries}
        rowKey={(e) => e.id}
        empty={t('audit.empty')}
        columns={[
          {
            key: 'when',
            header: t('audit.when'),
            cell: (e) => <span dir="ltr">{formatDateTime(e.occurredAt, i18n.language)}</span>,
          },
          {
            key: 'actor',
            header: t('audit.actor'),
            cell: (e) => (
              <span className="flex flex-wrap items-center gap-1">
                <span>{actorLabel(e)}</span>
                {e.actorType !== 'user' ? (
                  <Badge tone={ACTOR_TONE[e.actorType]}>{t(`audit.actor_${e.actorType}`)}</Badge>
                ) : null}
              </span>
            ),
          },
          {
            key: 'action',
            header: t('audit.action'),
            cell: (e) => (
              <span dir="ltr" className="font-mono text-xs" data-testid="audit-action">
                {e.action}
              </span>
            ),
          },
          {
            key: 'target',
            header: t('audit.target'),
            hideBelow: 'md',
            cell: (e) =>
              e.targetType ? (
                <span dir="ltr" className="font-mono text-xs">
                  {e.targetType}
                  {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'details',
            header: t('audit.details'),
            hideBelow: 'lg',
            cell: (e) => (
              <span dir="ltr" className="font-mono text-xs break-all">
                {summarizeDetails(e.details)}
                {e.ip ? ` · ${e.ip}` : ''}
              </span>
            ),
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={PAGE_SIZE}
        onPage={(p) => setPaging({ key: filterKey, page: p })}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
    </div>
  );
}
