import type {
  BranchLayout,
  DiningTable,
  KitchenStation,
  MenuItem,
  ModifierGroup,
} from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
} from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext } from '../../app/context.js';
import { CashTabs } from '../cash/shared.js';
import { formatAmount } from '../catalog/ProductsPage.js';

const key = ['manager', 'restaurant'] as const;
type Tab = 'setup' | 'floor' | 'modifiers' | 'menu';

/** Restaurant configuration (Prompt 15): module switch, floor and stations, modifiers, menu. */
export function RestaurantPage() {
  const { t } = useTranslation();
  const api = useApi();
  // Branch scope and merchant-wide settings are enforced by the API (the client only
  // knows the union of permissions).
  const settings = useQuery({
    queryKey: [...key, 'settings'],
    queryFn: () => api.restaurant.settings(),
  });
  const [tab, setTab] = useState<Tab>('setup');
  const tabs = (['setup', 'floor', 'modifiers', 'menu'] as const).map((k) => ({
    key: k,
    label: t(`restaurant.tab${k[0]!.toUpperCase()}${k.slice(1)}`),
  }));
  return (
    <div>
      <PageHeader title={t('restaurant.title')} description={t('restaurant.subtitle')} />
      {settings.data && !settings.data.enabled ? (
        <Alert tone="info" className="mb-4">
          {t('restaurant.disabledHint')}
        </Alert>
      ) : null}
      <CashTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'setup' && settings.data ? <SetupTab settings={settings.data} /> : null}
      {tab === 'floor' ? <FloorTab /> : null}
      {tab === 'modifiers' ? <ModifiersTab /> : null}
      {tab === 'menu' ? <MenuTab /> : null}
    </div>
  );
}

function SetupTab({
  settings,
}: {
  settings: { enabled: boolean; autoSendOnPayment: boolean; version: number };
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState(settings);
  const save = useMutation({
    mutationFn: () => api.restaurant.updateSettings(v),
    onSuccess: async (next) => {
      setV(next);
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  return (
    <Section title={t('restaurant.tabSetup')}>
      <div className="grid gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setV({ ...v, enabled: e.target.checked })}
          />
          {t('restaurant.enable')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.autoSendOnPayment}
            onChange={(e) => setV({ ...v, autoSendOnPayment: e.target.checked })}
          />
          {t('restaurant.autoSend')}
        </label>
        <p className="text-sm text-fg-muted">{t('restaurant.stockPolicy')}</p>
        <div>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function FloorTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const context = useBranchContext();
  const branches = context.branches.filter((b) => b.status === 'active');
  const [branchId, setBranchId] = useState(context.branchId ?? branches[0]?.id ?? '');
  const layout = useQuery({
    queryKey: [...key, 'layout', branchId],
    enabled: Boolean(branchId),
    queryFn: () => api.restaurant.layout(branchId),
  });
  const categories = useQuery({
    queryKey: ['manager', 'categories'],
    queryFn: () => api.catalog.categories(),
  });
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    | { kind: 'area'; id: string | null }
    | { kind: 'table'; table: DiningTable | null }
    | { kind: 'station'; station: KitchenStation | null }
    | null
  >(null);
  const done = (next: BranchLayout) => {
    queryClient.setQueryData([...key, 'layout', branchId], next);
    setDialog(null);
    notify.ok(t('common.saved'));
  };
  const l = layout.data;
  return (
    <div className="grid gap-6">
      <Field label={t('restaurant.branch')}>
        {(p) => (
          <Select
            {...p}
            className="max-w-xs"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {localizedName(b, i18n.language)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Section
        title={t('restaurant.areasTables')}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog({ kind: 'area', id: null })}
            >
              {t('restaurant.newArea')}
            </Button>
            <Button
              size="sm"
              disabled={!l?.areas.length}
              onClick={() => setDialog({ kind: 'table', table: null })}
            >
              {t('restaurant.newTable')}
            </Button>
          </div>
        }
      >
        {l?.areas.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('restaurant.noAreas')}</p>
        ) : null}
        {l?.areas.map((a) => (
          <div key={a.id} className="mb-4">
            <h3 className="mb-2 font-medium">
              {localizedName(a, i18n.language)}{' '}
              {a.status === 'inactive' ? (
                <Badge tone="neutral">{t('common.inactive')}</Badge>
              ) : null}
            </h3>
            <div className="flex flex-wrap gap-2">
              {l.tables
                .filter((x) => x.areaId === a.id)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    data-testid="manager-table"
                    onClick={() => setDialog({ kind: 'table', table: x })}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:border-primary"
                  >
                    <span className="font-semibold" dir="ltr">
                      {x.code}
                    </span>{' '}
                    · {t('restaurant.seatsCount', { count: x.seats })}
                    {x.status === 'inactive' ? ` · ${t('common.inactive')}` : ''}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </Section>
      <Section
        title={t('restaurant.stations')}
        description={t('restaurant.stationsHint')}
        actions={
          <Button size="sm" onClick={() => setDialog({ kind: 'station', station: null })}>
            {t('restaurant.newStation')}
          </Button>
        }
      >
        <DataTable<KitchenStation>
          caption={t('restaurant.stations')}
          rows={l?.stations}
          rowKey={(s) => s.id}
          empty={t('restaurant.noStations')}
          onRowClick={(s) => setDialog({ kind: 'station', station: s })}
          columns={[
            { key: 'name', header: t('common.name'), cell: (s) => localizedName(s, i18n.language) },
            {
              key: 'categories',
              header: t('restaurant.routedCategories'),
              cell: (s) =>
                s.isDefault
                  ? t('restaurant.defaultStation')
                  : s.categoryIds
                      .map((c) => {
                        const cat = categories.data?.categories.find((x) => x.id === c);
                        return cat ? localizedName(cat, i18n.language) : '';
                      })
                      .join(', ') || '—',
            },
            {
              key: 'status',
              header: t('common.status'),
              cell: (s) => (s.status === 'active' ? t('common.active') : t('common.inactive')),
            },
          ]}
        />
      </Section>
      {dialog?.kind === 'area' ? (
        <NameDialog
          title={t('restaurant.newArea')}
          onClose={() => setDialog(null)}
          onSave={(names) => api.restaurant.saveArea(null, { branchId, ...names }).then(done)}
        />
      ) : null}
      {dialog?.kind === 'table' && l ? (
        <TableDialog
          layout={l}
          table={dialog.table}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
      {dialog?.kind === 'station' ? (
        <StationDialog
          branchId={branchId}
          station={dialog.station}
          categories={categories.data?.categories ?? []}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
    </div>
  );
}

function NameDialog({
  title,
  onClose,
  onSave,
}: {
  title: string;
  onClose: () => void;
  onSave: (names: { nameEn: string | null; nameAr: string | null }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const notify = useNotify();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const save = useMutation({
    mutationFn: () => onSave({ nameAr: nameAr || null, nameEn: nameEn || null }),
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <Button
          disabled={!nameAr && !nameEn}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label={t('common.nameAr')}>
          {(p) => (
            <Input {...p} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          )}
        </Field>
        <Field label={t('common.nameEn')}>
          {(p) => (
            <Input {...p} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function TableDialog({
  layout,
  table,
  onClose,
  onSaved,
}: {
  layout: BranchLayout;
  table: DiningTable | null;
  onClose: () => void;
  onSaved: (l: BranchLayout) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState({
    areaId: table?.areaId ?? layout.areas[0]?.id ?? '',
    code: table?.code ?? '',
    seats: String(table?.seats ?? 4),
    status: table?.status ?? ('active' as const),
  });
  const save = useMutation({
    mutationFn: () =>
      api.restaurant.saveTable(table?.id ?? null, {
        areaId: v.areaId,
        code: v.code,
        seats: Number(v.seats),
        status: v.status,
        ...(table ? { version: table.version } : {}),
      }),
    onSuccess: onSaved,
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={table ? `${t('restaurant.table')} ${table.code}` : t('restaurant.newTable')}
      footer={
        <Button
          disabled={!v.code.trim() || !/^\d+$/.test(v.seats)}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('restaurant.area')}>
          {(p) => (
            <Select
              {...p}
              value={v.areaId}
              onChange={(e) => setV({ ...v, areaId: e.target.value })}
            >
              {layout.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {localizedName(a, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('restaurant.tableCode')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.code}
              onChange={(e) => setV({ ...v, code: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('restaurant.seatsLabel')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="numeric"
              value={v.seats}
              onChange={(e) => setV({ ...v, seats: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => setV({ ...v, status: e.target.value as 'active' })}
            >
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function StationDialog({
  branchId,
  station,
  categories,
  onClose,
  onSaved,
}: {
  branchId: string;
  station: KitchenStation | null;
  categories: { id: string; nameEn: string | null; nameAr: string | null }[];
  onClose: () => void;
  onSaved: (l: BranchLayout) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState({
    nameAr: station?.nameAr ?? '',
    nameEn: station?.nameEn ?? '',
    isDefault: station?.isDefault ?? false,
    status: station?.status ?? ('active' as const),
    categoryIds: station?.categoryIds ?? [],
  });
  const save = useMutation({
    mutationFn: () =>
      api.restaurant.saveStation(station?.id ?? null, {
        branchId,
        nameAr: v.nameAr || null,
        nameEn: v.nameEn || null,
        isDefault: v.isDefault,
        status: v.status,
        categoryIds: v.categoryIds,
        ...(station ? { version: station.version } : {}),
      }),
    onSuccess: onSaved,
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={station ? localizedName(station, i18n.language) : t('restaurant.newStation')}
      footer={
        <Button
          disabled={!v.nameAr && !v.nameEn}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.nameAr')}>
            {(p) => (
              <Input
                {...p}
                dir="rtl"
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('common.nameEn')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.isDefault}
            onChange={(e) => setV({ ...v, isDefault: e.target.checked })}
          />
          {t('restaurant.defaultStationLabel')}
        </label>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('restaurant.routedCategories')}</legend>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.categoryIds.includes(c.id)}
                  onChange={(e) =>
                    setV({
                      ...v,
                      categoryIds: e.target.checked
                        ? [...v.categoryIds, c.id]
                        : v.categoryIds.filter((x) => x !== c.id),
                    })
                  }
                />
                {localizedName(c, i18n.language)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function ModifiersTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const menu = useQuery({ queryKey: [...key, 'menu'], queryFn: () => api.restaurant.menu() });
  const [editing, setEditing] = useState<ModifierGroup | 'new' | null>(null);
  return (
    <Section
      title={t('restaurant.modifierGroups')}
      description={t('restaurant.modifierGroupsHint')}
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          {t('restaurant.newGroup')}
        </Button>
      }
    >
      <DataTable<ModifierGroup>
        caption={t('restaurant.modifierGroups')}
        rows={menu.data?.groups}
        rowKey={(g) => g.id}
        loading={menu.isPending}
        empty={t('restaurant.noGroups')}
        onRowClick={setEditing}
        columns={[
          { key: 'name', header: t('common.name'), cell: (g) => localizedName(g, i18n.language) },
          {
            key: 'rule',
            header: t('restaurant.selection'),
            cell: (g) =>
              g.minSelect > 0
                ? t('restaurant.requiredRule', { min: g.minSelect, max: g.maxSelect })
                : t('restaurant.optionalRule', { max: g.maxSelect }),
          },
          {
            key: 'mods',
            header: t('restaurant.options'),
            cell: (g) =>
              g.modifiers
                .filter((m) => m.status === 'active')
                .map(
                  (m) =>
                    `${localizedName(m, i18n.language)}${m.price.amount !== '0.000' ? ` (+${m.price.amount})` : ''}`,
                )
                .join(', '),
          },
        ]}
      />
      {editing ? (
        <GroupDialog
          group={editing === 'new' ? null : editing}
          items={menu.data?.items ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

function GroupDialog({
  group,
  items,
  onClose,
}: {
  group: ModifierGroup | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    nameAr: group?.nameAr ?? '',
    nameEn: group?.nameEn ?? '',
    minSelect: String(group?.minSelect ?? 0),
    maxSelect: String(group?.maxSelect ?? 1),
    status: group?.status ?? ('active' as const),
  });
  const [mods, setMods] = useState(
    group?.modifiers
      .filter((m) => m.status === 'active')
      .map((m) => ({
        id: m.id as string | undefined,
        nameAr: m.nameAr ?? '',
        nameEn: m.nameEn ?? '',
        price: m.price.amount,
        componentVariantId: m.componentVariantId ?? '',
        componentQuantity: m.componentQuantity ?? '',
      })) ?? [
      {
        id: undefined,
        nameAr: '',
        nameEn: '',
        price: '0.000',
        componentVariantId: '',
        componentQuantity: '',
      },
    ],
  );
  const ingredients = items
    .filter((i) => i.trackInventory)
    .flatMap((i) =>
      i.variants.map((x) => ({
        id: x.id,
        label: `${localizedName(i, i18n.language)}${x.nameEn || x.nameAr ? ` — ${localizedName(x, i18n.language)}` : ''}`,
      })),
    );
  const save = useMutation({
    mutationFn: () =>
      api.restaurant.saveGroup(group?.id ?? null, {
        nameAr: v.nameAr || null,
        nameEn: v.nameEn || null,
        minSelect: Number(v.minSelect),
        maxSelect: Number(v.maxSelect),
        status: v.status,
        modifiers: mods.map((m) => ({
          ...(m.id ? { id: m.id } : {}),
          nameAr: m.nameAr || null,
          nameEn: m.nameEn || null,
          price: m.price || '0',
          componentVariantId: m.componentVariantId || null,
          componentQuantity: m.componentVariantId ? m.componentQuantity || null : null,
        })),
        ...(group ? { version: group.version } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...key, 'menu'] });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const set = (i: number, patch: Partial<(typeof mods)[number]>) =>
    setMods((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={group ? localizedName(group, i18n.language) : t('restaurant.newGroup')}
      footer={
        <Button
          disabled={(!v.nameAr && !v.nameEn) || mods.some((m) => !m.nameAr && !m.nameEn)}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.nameAr')}>
            {(p) => (
              <Input
                {...p}
                dir="rtl"
                value={v.nameAr}
                onChange={(e) => setV({ ...v, nameAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('common.nameEn')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('restaurant.minSelect')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="numeric"
                value={v.minSelect}
                onChange={(e) => setV({ ...v, minSelect: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('restaurant.maxSelect')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="numeric"
                value={v.maxSelect}
                onChange={(e) => setV({ ...v, maxSelect: e.target.value })}
              />
            )}
          </Field>
        </div>
        <h3 className="font-medium">{t('restaurant.options')}</h3>
        {mods.map((m, i) => (
          <div
            key={m.id ?? `new-${i}`}
            className="grid items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1fr_6rem]"
            data-testid="modifier-row"
          >
            <Field label={t('common.nameAr')}>
              {(p) => (
                <Input
                  {...p}
                  dir="rtl"
                  value={m.nameAr}
                  onChange={(e) => set(i, { nameAr: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('common.nameEn')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  value={m.nameEn}
                  onChange={(e) => set(i, { nameEn: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('restaurant.extraPrice')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={m.price}
                  onChange={(e) => set(i, { price: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('restaurant.ingredient')} className="sm:col-span-2">
              {(p) => (
                <Select
                  {...p}
                  value={m.componentVariantId}
                  onChange={(e) => set(i, { componentVariantId: e.target.value })}
                >
                  <option value="">{t('restaurant.noIngredient')}</option>
                  {ingredients.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('restaurant.ingredientQty')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  disabled={!m.componentVariantId}
                  value={m.componentQuantity}
                  onChange={(e) => set(i, { componentQuantity: e.target.value })}
                />
              )}
            </Field>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMods((ms) => ms.filter((_, j) => j !== i))}
              disabled={mods.length === 1}
            >
              {t('restaurant.removeOption')}
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setMods((ms) => [
                ...ms,
                {
                  id: undefined,
                  nameAr: '',
                  nameEn: '',
                  price: '0.000',
                  componentVariantId: '',
                  componentQuantity: '',
                },
              ])
            }
          >
            {t('restaurant.addOption')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function MenuTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const menu = useQuery({ queryKey: [...key, 'menu'], queryFn: () => api.restaurant.menu() });
  const [editing, setEditing] = useState<MenuItem | null>(null);
  return (
    <Section title={t('restaurant.menuItems')} description={t('restaurant.menuHint')}>
      <DataTable<MenuItem>
        caption={t('restaurant.menuItems')}
        rows={menu.data?.items}
        rowKey={(i) => i.productId}
        loading={menu.isPending}
        onRowClick={setEditing}
        columns={[
          { key: 'name', header: t('common.name'), cell: (i) => localizedName(i, i18n.language) },
          {
            key: 'price',
            header: t('restaurant.price'),
            cell: (i) => <span dir="ltr">{formatAmount(i.variants[0]?.price, i18n.language)}</span>,
          },
          {
            key: 'groups',
            header: t('restaurant.modifierGroups'),
            cell: (i) =>
              i.modifierGroupIds
                .map((id) => {
                  const g = menu.data?.groups.find((x) => x.id === id);
                  return g ? localizedName(g, i18n.language) : '';
                })
                .join(', ') || '—',
          },
          {
            key: 'stock',
            header: t('restaurant.stockRule'),
            cell: (i) =>
              i.variants.some((v) => v.recipe.length)
                ? t('restaurant.byRecipe')
                : i.trackInventory
                  ? t('restaurant.byItem')
                  : t('restaurant.noStock'),
          },
        ]}
      />
      {editing && menu.data ? (
        <MenuItemDialog
          item={editing}
          groups={menu.data.groups}
          items={menu.data.items}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

function MenuItemDialog({
  item,
  groups,
  items,
  onClose,
}: {
  item: MenuItem;
  groups: ModifierGroup[];
  items: MenuItem[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [groupIds, setGroupIds] = useState(item.modifierGroupIds);
  const [recipes, setRecipes] = useState(
    Object.fromEntries(
      item.variants.map((v) => [
        v.id,
        v.recipe.map((r) => ({
          componentVariantId: r.componentVariantId,
          quantity: r.quantity.replace(/\.?0+$/, ''),
        })),
      ]),
    ),
  );
  const ingredients = items
    .filter((i) => i.trackInventory && i.productId !== item.productId)
    .flatMap((i) =>
      i.variants.map((x) => ({
        id: x.id,
        label: `${localizedName(i, i18n.language)}${x.nameEn || x.nameAr ? ` — ${localizedName(x, i18n.language)}` : ''}`,
      })),
    );
  const save = useMutation({
    mutationFn: () =>
      api.restaurant.saveMenuItem(item.productId, {
        modifierGroupIds: groupIds,
        recipes: Object.entries(recipes).map(([variantId, components]) => ({
          variantId,
          components: components.filter((c) => c.componentVariantId && c.quantity),
        })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...key, 'menu'] });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={localizedName(item, i18n.language)}
      footer={
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-1 font-medium">{t('restaurant.modifierGroups')}</legend>
          <div className="grid grid-cols-2 gap-1">
            {groups
              .filter((g) => g.status === 'active')
              .map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={groupIds.includes(g.id)}
                    onChange={(e) =>
                      setGroupIds(
                        e.target.checked ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id),
                      )
                    }
                  />
                  {localizedName(g, i18n.language)}
                </label>
              ))}
          </div>
        </fieldset>
        <div>
          <h3 className="mb-1 font-medium">{t('restaurant.recipe')}</h3>
          {item.trackInventory ? (
            <Alert tone="info">{t('restaurant.recipeTracked')}</Alert>
          ) : (
            <p className="mb-2 text-sm text-fg-muted">{t('restaurant.recipeHint')}</p>
          )}
          {!item.trackInventory
            ? item.variants.map((variant) => (
                <div key={variant.id} className="mb-3 grid gap-2">
                  {item.variants.length > 1 ? (
                    <p className="text-sm font-medium">
                      {localizedName(variant, i18n.language) || variant.sku}
                    </p>
                  ) : null}
                  {(recipes[variant.id] ?? []).map((c, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_7rem_auto] items-end gap-2"
                      data-testid="recipe-row"
                    >
                      <Field label={t('restaurant.ingredient')}>
                        {(p) => (
                          <Select
                            {...p}
                            value={c.componentVariantId}
                            onChange={(e) =>
                              setRecipes((r) => ({
                                ...r,
                                [variant.id]: r[variant.id]!.map((x, j) =>
                                  j === i ? { ...x, componentVariantId: e.target.value } : x,
                                ),
                              }))
                            }
                          >
                            <option value="" />
                            {ingredients.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label={t('restaurant.ingredientQty')}>
                        {(p) => (
                          <Input
                            {...p}
                            dir="ltr"
                            inputMode="decimal"
                            value={c.quantity}
                            onChange={(e) =>
                              setRecipes((r) => ({
                                ...r,
                                [variant.id]: r[variant.id]!.map((x, j) =>
                                  j === i ? { ...x, quantity: e.target.value } : x,
                                ),
                              }))
                            }
                          />
                        )}
                      </Field>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRecipes((r) => ({
                            ...r,
                            [variant.id]: r[variant.id]!.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        {t('restaurant.removeOption')}
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setRecipes((r) => ({
                          ...r,
                          [variant.id]: [
                            ...(r[variant.id] ?? []),
                            { componentVariantId: '', quantity: '1' },
                          ],
                        }))
                      }
                    >
                      {t('restaurant.addIngredient')}
                    </Button>
                  </div>
                </div>
              ))
            : null}
        </div>
      </div>
    </Dialog>
  );
}
