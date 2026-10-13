import { type Product, moneyAmountSchema, saveProductSchema } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Spinner,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { categoriesKey } from './CategoriesPage.js';
import { formatAmount } from './ProductsPage.js';
import { productsKey } from './ProductsPage.js';

interface VariantDraft {
  id?: string;
  nameAr: string;
  nameEn: string;
  sku: string;
  barcodes: string;
  price: string;
  cost: string;
}

interface Draft {
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  categoryId: string;
  type: 'standard' | 'service';
  hasVariants: boolean;
  trackInventory: boolean;
  availableInAllBranches: boolean;
  branchIds: string[];
  variants: VariantDraft[];
}

const emptyVariant = (): VariantDraft => ({
  nameAr: '',
  nameEn: '',
  sku: '',
  barcodes: '',
  price: '',
  cost: '',
});

function toDraft(p: Product | undefined): Draft {
  if (!p) {
    return {
      nameAr: '',
      nameEn: '',
      descriptionAr: '',
      descriptionEn: '',
      categoryId: '',
      type: 'standard',
      hasVariants: false,
      trackInventory: true,
      availableInAllBranches: true,
      branchIds: [],
      variants: [emptyVariant()],
    };
  }
  return {
    nameAr: p.nameAr ?? '',
    nameEn: p.nameEn ?? '',
    descriptionAr: p.descriptionAr ?? '',
    descriptionEn: p.descriptionEn ?? '',
    categoryId: p.categoryId ?? '',
    type: p.type,
    hasVariants: p.hasVariants,
    trackInventory: p.trackInventory,
    availableInAllBranches: p.availableInAllBranches,
    branchIds: p.branchIds,
    variants: p.variants
      .filter((v) => v.status === 'active')
      .map((v) => ({
        id: v.id,
        nameAr: v.nameAr ?? '',
        nameEn: v.nameEn ?? '',
        sku: v.sku ?? '',
        barcodes: v.barcodes.join(', '),
        price: v.price.amount,
        cost: v.cost?.amount ?? '',
      })),
  };
}

export function ProductEditorPage() {
  const { productId } = useParams();
  const api = useApi();
  const product = useQuery({
    queryKey: [...productsKey, 'detail', productId],
    queryFn: () => api.catalog.product(productId!),
    enabled: Boolean(productId),
  });
  if (productId && product.isPending) return <Spinner />;
  if (productId && product.isError)
    return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  return <Editor product={product.data} key={product.data?.version ?? 'new'} />;
}

function Editor({ product }: { product: Product | undefined }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { branches } = useBranchContext();
  const canManage = can('catalog.manage');
  const canPrice = can('catalog.prices.manage');
  const [draft, setDraft] = useState<Draft>(() => toDraft(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const categories = useQuery({ queryKey: categoriesKey, queryFn: () => api.catalog.categories() });
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateVariant = (index: number, patch: Partial<VariantDraft>) =>
    setDraft((d) => ({
      ...d,
      variants: d.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));

  const afterSave = async (saved: Product, message: string) => {
    await queryClient.invalidateQueries({ queryKey: productsKey });
    queryClient.setQueryData([...productsKey, 'detail', saved.id], saved);
    notify.ok(message);
    if (!product) await navigate(`/products/${saved.id}`, { replace: true });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        nameAr: draft.nameAr,
        nameEn: draft.nameEn,
        descriptionAr: draft.descriptionAr,
        descriptionEn: draft.descriptionEn,
        categoryId: draft.categoryId || null,
        type: draft.type,
        hasVariants: draft.hasVariants,
        trackInventory: draft.type === 'service' ? false : draft.trackInventory,
        availableInAllBranches: draft.availableInAllBranches,
        branchIds: draft.availableInAllBranches ? [] : draft.branchIds,
        variants: (draft.hasVariants ? draft.variants : draft.variants.slice(0, 1)).map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          nameAr: draft.hasVariants ? v.nameAr : null,
          nameEn: draft.hasVariants ? v.nameEn : null,
          sku: v.sku.trim() || null,
          barcodes: v.barcodes
            .split(/[,\s]+/)
            .map((b) => b.trim())
            .filter(Boolean),
          price: v.price.trim(),
          cost: canPrice ? v.cost.trim() || null : null,
        })),
        ...(product ? { version: product.version } : {}),
      };
      const parsed = saveProductSchema.safeParse(body);
      if (!parsed.success) {
        setErrors(
          Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
        );
        throw new Error('invalid');
      }
      setErrors({});
      return product
        ? api.catalog.updateProduct(product.id, body)
        : api.catalog.createProduct(body);
    },
    onSuccess: (saved) => afterSave(saved, product ? t('catalog.saved') : t('catalog.created')),
    onError: (error) => {
      if ((error as Error).message !== 'invalid') notify.fail(error);
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      api.catalog.setProductStatus(product!.id, status),
    onSuccess: (saved) =>
      afterSave(
        saved,
        saved.status === 'archived' ? t('catalog.archivedToast') : t('catalog.restoredToast'),
      ),
    onError: notify.fail,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.catalog.uploadImage(product!.id, file),
    onSuccess: (saved) => afterSave(saved, t('catalog.uploaded')),
    onError: notify.fail,
  });
  const removeImage = useMutation({
    mutationFn: (imageId: string) => api.catalog.deleteImage(product!.id, imageId),
    onSuccess: (saved) => afterSave(saved, t('common.saved')),
    onError: notify.fail,
  });

  const priceError = (value: string) =>
    value && !moneyAmountSchema.safeParse(value).success
      ? t('common:errors.INVALID_PRICE')
      : undefined;
  const visibleVariants = draft.hasVariants ? draft.variants : draft.variants.slice(0, 1);

  return (
    <div className="flex flex-col gap-6">
      <Link to="/products" className="text-sm text-primary hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {product ? localizedName(product, i18n.language) : t('catalog.newProduct')}
            {product?.status === 'archived' ? <Badge>{t('catalog.archived')}</Badge> : null}
          </span>
        }
        actions={
          canManage ? (
            <>
              {product ? (
                product.status === 'active' ? (
                  <Button variant="secondary" onClick={() => setArchiving(true)}>
                    {t('catalog.archive')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    loading={setStatus.isPending}
                    onClick={() => setStatus.mutate('active')}
                  >
                    {t('catalog.restore')}
                  </Button>
                )
              ) : null}
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </>
          ) : null
        }
      />
      {canManage && !canPrice ? <Alert tone="info" title={t('catalog.noPriceRights')} /> : null}

      <fieldset disabled={!canManage} className="flex flex-col gap-6">
        <Section title={t('catalog.basics')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('common.nameAr')} error={errors['nameAr']}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.nameAr}
                  onChange={(e) => update({ nameAr: e.target.value })}
                  dir="rtl"
                />
              )}
            </Field>
            <Field label={t('common.nameEn')}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.nameEn}
                  onChange={(e) => update({ nameEn: e.target.value })}
                  dir="ltr"
                />
              )}
            </Field>
            <Field label={t('catalog.descriptionAr')}>
              {(p) => (
                <Textarea
                  {...p}
                  value={draft.descriptionAr}
                  onChange={(e) => update({ descriptionAr: e.target.value })}
                  dir="rtl"
                />
              )}
            </Field>
            <Field label={t('catalog.descriptionEn')}>
              {(p) => (
                <Textarea
                  {...p}
                  value={draft.descriptionEn}
                  onChange={(e) => update({ descriptionEn: e.target.value })}
                  dir="ltr"
                />
              )}
            </Field>
            <Field label={t('catalog.category')}>
              {(p) => (
                <Select
                  {...p}
                  value={draft.categoryId}
                  onChange={(e) => update({ categoryId: e.target.value })}
                >
                  <option value="">{t('catalog.noCategory')}</option>
                  {categories.data?.categories
                    .filter((c) => c.status === 'active' || c.id === draft.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {localizedName(c, i18n.language)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label={t('catalog.type')}>
              {(p) => (
                <Select
                  {...p}
                  value={draft.type}
                  onChange={(e) => update({ type: e.target.value as Draft['type'] })}
                >
                  <option value="standard">{t('catalog.typeStandard')}</option>
                  <option value="service">{t('catalog.typeService')}</option>
                </Select>
              )}
            </Field>
          </div>
        </Section>

        <Section title={t('catalog.variants')} description={t('catalog.priceHint')}>
          <div className="flex flex-col gap-4">
            <Checkbox
              label={t('catalog.hasVariants')}
              checked={draft.hasVariants}
              onChange={(e) => update({ hasVariants: e.target.checked })}
            />
            {errors['variants'] ? <Alert tone="danger" title={errors['variants']} /> : null}
            {visibleVariants.map((v, index) => (
              <div
                key={v.id ?? `new-${index}`}
                className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-2 xl:grid-cols-3"
                data-testid="variant-row"
              >
                {draft.hasVariants ? (
                  <>
                    <Field label={`${t('catalog.variantName')} (${t('common.nameAr')})`}>
                      {(p) => (
                        <Input
                          {...p}
                          value={v.nameAr}
                          onChange={(e) => updateVariant(index, { nameAr: e.target.value })}
                          dir="rtl"
                        />
                      )}
                    </Field>
                    <Field label={`${t('catalog.variantName')} (${t('common.nameEn')})`}>
                      {(p) => (
                        <Input
                          {...p}
                          value={v.nameEn}
                          onChange={(e) => updateVariant(index, { nameEn: e.target.value })}
                          dir="ltr"
                        />
                      )}
                    </Field>
                  </>
                ) : null}
                <Field label={t('catalog.sku')} error={errors[`variants.${index}.sku`]}>
                  {(p) => (
                    <Input
                      {...p}
                      value={v.sku}
                      onChange={(e) => updateVariant(index, { sku: e.target.value })}
                      dir="ltr"
                    />
                  )}
                </Field>
                <Field
                  label={t('catalog.barcodes')}
                  hint={t('catalog.barcodesHint')}
                  error={errors[`variants.${index}.barcodes.0`]}
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={v.barcodes}
                      onChange={(e) => updateVariant(index, { barcodes: e.target.value })}
                      dir="ltr"
                      inputMode="numeric"
                    />
                  )}
                </Field>
                <Field
                  label={`${t('catalog.price')} (KWD)`}
                  error={priceError(v.price) ?? errors[`variants.${index}.price`]}
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={v.price}
                      disabled={!canPrice && Boolean(v.id)}
                      onChange={(e) => updateVariant(index, { price: e.target.value })}
                      dir="ltr"
                      inputMode="decimal"
                      placeholder="0.000"
                    />
                  )}
                </Field>
                {canPrice ? (
                  <Field
                    label={`${t('catalog.cost')} (KWD)`}
                    error={priceError(v.cost)}
                    hint={
                      draft.trackInventory && !v.cost.trim()
                        ? t('catalog.costMissingHint')
                        : t('catalog.costHint')
                    }
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={v.cost}
                        onChange={(e) => updateVariant(index, { cost: e.target.value })}
                        dir="ltr"
                        inputMode="decimal"
                        placeholder="0.000"
                      />
                    )}
                  </Field>
                ) : null}
                {draft.hasVariants && draft.variants.length > 1 ? (
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          variants: d.variants.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      {t('catalog.removeVariant')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {draft.hasVariants ? (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDraft((d) => ({ ...d, variants: [...d.variants, emptyVariant()] }))
                  }
                >
                  {t('catalog.addVariant')}
                </Button>
              </div>
            ) : null}
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={t('catalog.inventory')} description={t('catalog.trackInventoryHint')}>
            <Checkbox
              label={t('catalog.trackInventory')}
              checked={draft.type === 'standard' && draft.trackInventory}
              disabled={draft.type === 'service'}
              onChange={(e) => update({ trackInventory: e.target.checked })}
            />
          </Section>
          <Section title={t('catalog.availability')}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="availability"
                  checked={draft.availableInAllBranches}
                  onChange={() => update({ availableInAllBranches: true })}
                  className="accent-primary"
                />
                {t('catalog.allBranches')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="availability"
                  checked={!draft.availableInAllBranches}
                  onChange={() => update({ availableInAllBranches: false })}
                  className="accent-primary"
                />
                {t('catalog.selectedBranches')}
              </label>
              {!draft.availableInAllBranches ? (
                <div className="ms-6 flex flex-col gap-2">
                  {branches.map((b) => (
                    <Checkbox
                      key={b.id}
                      label={localizedName(b, i18n.language)}
                      checked={draft.branchIds.includes(b.id)}
                      onChange={(e) =>
                        update({
                          branchIds: e.target.checked
                            ? [...draft.branchIds, b.id]
                            : draft.branchIds.filter((id) => id !== b.id),
                        })
                      }
                    />
                  ))}
                  {errors['branchIds'] ? (
                    <p className="text-sm text-danger">{errors['branchIds']}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Section>
        </div>
      </fieldset>

      {product ? <PriceHistorySection productId={product.id} /> : null}

      <Section title={t('catalog.images')} description={t('catalog.imagesHint')}>
        {product ? (
          <div className="flex flex-wrap gap-4">
            {product.images.map((image) => (
              <figure key={image.id} className="flex flex-col items-center gap-2">
                <img
                  src={image.url}
                  alt=""
                  className="size-28 rounded-md border border-border object-cover"
                />
                {canManage ? (
                  <Button size="sm" variant="ghost" onClick={() => removeImage.mutate(image.id)}>
                    {t('catalog.removeImage')}
                  </Button>
                ) : null}
              </figure>
            ))}
            {canManage ? (
              <div className="flex items-center">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-label={t('catalog.upload')}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  loading={upload.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('catalog.upload')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t('catalog.imagesAfterSave')}</p>
        )}
      </Section>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t('catalog.archive')}
        confirmLabel={t('catalog.archive')}
        cancelLabel={t('common.cancel')}
        loading={setStatus.isPending}
        onConfirm={() => {
          setArchiving(false);
          setStatus.mutate('archived');
        }}
      />
    </div>
  );
}

/** Price and cost history of the product (BR-191): who changed what, from what, when. */
function PriceHistorySection({ productId }: { productId: string }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const history = useQuery({
    queryKey: [...productsKey, 'price-history', productId],
    queryFn: () => api.catalog.priceHistory(productId),
  });
  const amount = (m: { amount: string; currency: string } | null) =>
    m ? formatAmount(m, i18n.language) : '—';
  return (
    <Section title={t('catalog.priceHistory')} description={t('catalog.priceHistoryHint')}>
      <DataTable
        caption={t('catalog.priceHistory')}
        loading={history.isPending}
        rows={history.data?.entries}
        rowKey={(e) => e.id}
        empty={t('catalog.noPriceHistory')}
        columns={[
          {
            key: 'when',
            header: t('catalog.changedAt'),
            cell: (e) => formatDateTime(e.changedAt, i18n.language),
          },
          {
            key: 'what',
            header: t('catalog.changedWhat'),
            cell: (e) => (
              <span>
                {t(`catalog.history_${e.kind}`)}
                {e.variantNameEn || e.variantNameAr ? (
                  <span className="block text-xs text-fg-muted">
                    {localizedName(
                      { nameEn: e.variantNameEn, nameAr: e.variantNameAr },
                      i18n.language,
                    )}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'change',
            header: t('catalog.fromTo'),
            cell: (e) => (
              <span dir="ltr" className="tabular-nums">
                {e.source === 'created' ? amount(e.to) : `${amount(e.from)} → ${amount(e.to)}`}
              </span>
            ),
          },
          {
            key: 'who',
            header: t('catalog.changedBy'),
            hideBelow: 'sm',
            cell: (e) => e.changedBy ?? '—',
          },
        ]}
      />
    </Section>
  );
}
