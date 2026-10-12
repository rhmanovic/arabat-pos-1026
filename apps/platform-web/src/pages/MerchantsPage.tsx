import type { PlatformMerchantQuery } from '@arabat/contracts';
import { Badge, Button, DataTable, Input, PageHeader, Select } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MERCHANT_TONE, SUB_TONE, platformKey, useFormat, useRole } from '../shared.js';
import { NewMerchantDialog } from './NewMerchantDialog.js';

const PAGE = 25;

export function MerchantsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const navigate = useNavigate();
  const { can } = useRole();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended' | 'closed'>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);
  const query: PlatformMerchantQuery = {
    page,
    pageSize: PAGE,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  };
  const list = useQuery({
    queryKey: [...platformKey, 'merchants', query],
    queryFn: () => api.platform.merchants(query),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.total ?? 0;
  return (
    <div>
      <PageHeader
        title={t('merchants.title')}
        description={t('merchants.subtitle')}
        actions={
          can('platform.super_admin', 'platform.support') ? (
            <Button onClick={() => setCreating(true)}>{t('merchants.new')}</Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('merchants.search')}
          placeholder={t('merchants.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="w-44"
          aria-label={t('merchants.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="">{t('merchants.allStatuses')}</option>
          {(['active', 'suspended', 'closed'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        caption={t('merchants.title')}
        loading={list.isPending}
        rows={list.data?.merchants}
        rowKey={(m) => m.id}
        empty={t('merchants.empty')}
        onRowClick={(m) => void navigate(`/merchants/${m.id}`)}
        columns={[
          {
            key: 'name',
            header: t('merchants.name'),
            cell: (m) => <span className="font-medium">{f.name(m)}</span>,
          },
          {
            key: 'owner',
            header: t('merchants.owner'),
            hideBelow: 'md',
            cell: (m) => (
              <span dir="ltr" className="text-xs">
                {m.ownerEmail ?? '—'}
              </span>
            ),
          },
          {
            key: 'plan',
            header: t('merchants.plan'),
            cell: (m) => (
              <span className="flex flex-wrap items-center gap-1">
                {m.planNameEn
                  ? f.planName({ nameEn: m.planNameEn, nameAr: m.planNameAr ?? m.planNameEn })
                  : '—'}
                {m.subscriptionStatus ? (
                  <Badge tone={SUB_TONE[m.subscriptionStatus]}>
                    {t(`sub.${m.subscriptionStatus}`)}
                  </Badge>
                ) : null}
              </span>
            ),
          },
          {
            key: 'branches',
            header: t('merchants.branches'),
            hideBelow: 'lg',
            cell: (m) => m.branchCount,
          },
          {
            key: 'employees',
            header: t('merchants.employees'),
            hideBelow: 'lg',
            cell: (m) => m.employeeCount,
          },
          {
            key: 'lastSale',
            header: t('merchants.lastSale'),
            hideBelow: 'lg',
            cell: (m) => f.date(m.lastSaleAt),
          },
          {
            key: 'status',
            header: t('merchants.status'),
            cell: (m) => <Badge tone={MERCHANT_TONE[m.status]}>{t(`status.${m.status}`)}</Badge>,
          },
        ]}
      />
      {total > PAGE ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </Button>
          <span className="tabular-nums">
            {page} / {Math.ceil(total / PAGE)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page * PAGE >= total}
            onClick={() => setPage(page + 1)}
          >
            ›
          </Button>
        </div>
      ) : null}
      {creating ? (
        <NewMerchantDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => void navigate(`/merchants/${id}`)}
        />
      ) : null}
    </div>
  );
}
