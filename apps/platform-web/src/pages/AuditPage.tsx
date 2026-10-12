import { DataTable, Input, PageHeader } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat } from '../shared.js';

export function AuditPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const [filter, setFilter] = useState('');
  const [action, setAction] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAction(filter.trim()), 300);
    return () => clearTimeout(id);
  }, [filter]);
  const query = { page: 1, pageSize: 100, ...(action ? { action } : {}) };
  const audit = useQuery({
    queryKey: [...platformKey, 'audit', query],
    queryFn: () => api.platform.audit(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} />
      <Input
        className="mb-4 max-w-xs"
        type="search"
        aria-label={t('audit.filter')}
        placeholder={t('audit.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <DataTable
        caption={t('audit.title')}
        loading={audit.isPending}
        rows={audit.data?.entries}
        rowKey={(e) => e.id}
        empty={t('audit.empty')}
        columns={[
          { key: 'when', header: t('audit.when'), cell: (e) => f.date(e.occurredAt) },
          { key: 'actor', header: t('audit.actor'), cell: (e) => e.actorName ?? e.actorType },
          {
            key: 'action',
            header: t('audit.action'),
            cell: (e) => (
              <span dir="ltr" className="font-mono text-xs">
                {e.action}
              </span>
            ),
          },
          {
            key: 'merchant',
            header: t('audit.merchant'),
            hideBelow: 'md',
            cell: (e) =>
              e.merchantId ? f.name({ nameEn: e.merchantNameEn, nameAr: e.merchantNameAr }) : '—',
          },
          {
            key: 'details',
            header: t('audit.details'),
            hideBelow: 'lg',
            cell: (e) => (
              <span dir="ltr" className="font-mono text-xs break-all">
                {typeof e.details['reason'] === 'string' ? e.details['reason'] : ''}
                {e.ip ? ` · ${e.ip}` : ''}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
