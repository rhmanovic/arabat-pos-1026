import {
  DESIGN_PAGES,
  type DesignPage as PageKey,
  type DesignSection,
  type StoreDesign,
  type StoreDesignState,
  storeDesignSchema,
} from '@arabat/contracts';
import { Alert, Badge, Button, Icon, PageHeader, Segmented, cn } from '@arabat/ui';
import { AccessDenied, ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Ref, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';
import { Panel, designKey, useStoreCatalog } from './fields.js';
import { PageLayouts, PageTips, SectionPicker, isEmptySection } from './PageTools.js';
import {
  SECTION_ICON,
  SectionEditor,
  isRequired,
  newId,
  useSectionSummary,
} from './SectionEditor.js';
import { HeaderEditor } from './HeaderEditor.js';
import { FooterEditor } from './FooterEditor.js';
import { ThemeEditor } from './ShellEditors.js';
import { ProductPageEditor } from './ProductPageEditor.js';
import { SaleEditor } from './SaleEditor.js';
import { CartPageEditor, CheckoutPageEditor } from './CartEditors.js';

/** The preview frame's name: the storefront shows the draft when it runs inside it. */
const PREVIEW_FRAME_NAME = 'arabat-design-preview';

/** The width the store is laid out at in each preview: a real desktop and a real phone. */
const PREVIEW_WIDTH = { desktop: 1280, phone: 390 } as const;

/**
 * The store at a true device width, scaled down to fit the column. Without it the "desktop"
 * preview would be as narrow as the column and the store would show its phone layout, hiding
 * every large-screen header setting.
 */
function PreviewFrame({
  ref,
  device,
  name,
  title,
  src,
}: {
  ref: Ref<HTMLIFrameElement>;
  device: 'desktop' | 'phone';
  name: string;
  title: string;
  src: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = PREVIEW_WIDTH[device];
  const scale = size.width > 0 ? Math.min(1, size.width / width) : 1;
  const offset = Math.max(0, (size.width - width * scale) / 2);
  return (
    <div ref={box} className="relative h-[75dvh] overflow-hidden rounded-lg">
      <iframe
        ref={ref}
        name={name}
        title={title}
        src={src}
        className="absolute top-0 block rounded-lg bg-white"
        style={{
          // Physical left: the frame is placed by measured pixels, the same in both directions.
          left: offset,
          width,
          height: size.height > 0 ? size.height / scale : '100%',
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
        data-testid="design-preview"
        data-device={device}
      />
    </div>
  );
}
type Tab = 'pages' | 'theme' | 'header' | 'footer' | 'sale';
/** The pages the editor shows: the designed ones, and the checkout (settings only, no sections). */
type EditorPage = PageKey | 'checkout';
const EDITOR_PAGES: readonly EditorPage[] = [...DESIGN_PAGES, 'checkout'];

/**
 * Store design (ADR-0128): the merchant shapes the header, navigation, side menu, footer and the
 * sections of the home, products and categories pages, watches them in a live preview, saves a
 * draft and publishes it.
 */
export function DesignPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const api = useApi();
  const store = useQuery({ queryKey: [...key, 'store'], queryFn: () => api.online.store() });
  const state = useQuery({ queryKey: designKey, queryFn: () => api.online.design() });
  if (!can('online.manage')) return <AccessDenied />;
  if (store.isPending || state.isPending) return null;
  if (state.isError) return <ErrorState error={state.error} onRetry={() => void state.refetch()} />;
  if (store.isError || !store.data)
    return (
      <div>
        <PageHeader title={t('nav.design')} />
        <Alert tone="warning">
          {t('design.needStore')}{' '}
          <Link to="/settings" className="text-primary hover:underline">
            {t('nav.settings')}
          </Link>
        </Alert>
      </div>
    );
  return (
    <Editor
      state={state.data}
      slug={store.data.slug}
      ready={Boolean(store.data.fulfillmentBranchId)}
      storeUrl={store.data.url}
    />
  );
}

function Editor({
  state,
  slug,
  ready,
  storeUrl,
}: {
  state: StoreDesignState;
  slug: string;
  ready: boolean;
  storeUrl: string;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StoreDesign>(state.draft);
  // A new server version (saved, published, discarded) restarts the local draft from it.
  const [seen, setSeen] = useState(state.version);
  if (seen !== state.version) {
    setSeen(state.version);
    setDraft(state.draft);
  }
  const [tab, setTab] = useState<Tab>('pages');
  const [page, setPage] = useState<EditorPage>('home');
  // The product the preview opens while the product page is edited (the first one by default).
  const { products } = useStoreCatalog();
  const [chosenProduct, setChosenProduct] = useState<string | null>(null);
  const previewProduct = chosenProduct ?? products[0]?.productId ?? null;
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const frame = useRef<HTMLIFrameElement>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(state.draft);
  const valid = storeDesignSchema.safeParse(draft);

  // ---------------------------------------------------------------- live preview
  const post = useCallback((message: unknown) => {
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  const where = useRef({ page, productId: previewProduct });
  useEffect(() => {
    where.current = { page, productId: previewProduct };
  }, [page, previewProduct]);
  // The footer sits at the bottom of the store: while it is edited, the preview shows it.
  const onFooter = useRef(false);
  useEffect(() => {
    onFooter.current = tab === 'footer';
    if (tab === 'footer' || tab === 'header')
      post({ type: 'arabat:scroll', to: tab === 'footer' ? 'footer' : 'top' });
  }, [tab, post]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'arabat:design-ready') {
        post({ type: 'arabat:design', design: latest.current });
        if (onFooter.current) post({ type: 'arabat:scroll', to: 'footer' });
        // A reloaded frame goes back to the page being edited.
        if (where.current.page !== 'home') post({ type: 'arabat:navigate', ...where.current });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);
  useEffect(() => {
    const timer = setTimeout(() => {
      post({ type: 'arabat:design', design: draft });
      if (onFooter.current) post({ type: 'arabat:scroll', to: 'footer' });
    }, 150);
    return () => clearTimeout(timer);
  }, [draft, post]);
  useEffect(
    () => post({ type: 'arabat:navigate', page, productId: previewProduct }),
    [page, previewProduct, post],
  );

  // -------------------------------------------------------------------- saving
  const done = async (next: StoreDesignState, message: string) => {
    queryClient.setQueryData(designKey, next);
    notify.ok(message);
  };
  const save = useMutation({
    mutationFn: () => api.online.saveDesign({ design: draft, version: state.version }),
    onSuccess: (next) => done(next, t('design.saved')),
    onError: notify.fail,
  });
  const publish = useMutation({
    mutationFn: async () => {
      const saved = changed
        ? await api.online.saveDesign({ design: draft, version: state.version })
        : state;
      return api.online.publishDesign(saved.version);
    },
    onSuccess: (next) => done(next, t('design.publishedToast')),
    onError: notify.fail,
  });
  const discard = useMutation({
    mutationFn: () => api.online.discardDesign(state.version),
    onSuccess: (next) => done(next, t('design.discarded')),
    onError: notify.fail,
  });
  const busy = save.isPending || publish.isPending || discard.isPending;
  const status = changed
    ? { tone: 'warning' as const, label: t('design.status_unsaved') }
    : state.dirty
      ? { tone: 'primary' as const, label: t('design.status_draft') }
      : { tone: 'success' as const, label: t('design.status_live') };

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-16">
      <PageHeader title={t('nav.design')} description={t('design.hint')} />
      {/*
        Floats over the whole window so saving and publishing never scroll away (under the
        editor column on large screens, clear of the preview's device switch). Rendered in the
        body: the page's entrance animation would otherwise pin it inside the page.
      */}
      {createPortal(
        <div
          role="toolbar"
          aria-label={t('design.actions')}
          data-testid="design-actions"
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-surface/90 p-2 shadow-xl backdrop-blur-md lg:inset-x-auto lg:start-[19rem] lg:bottom-6 lg:mx-0"
        >
          <Segmented
            label={t('design.view')}
            className="lg:hidden"
            value={mobileView}
            options={[
              { value: 'edit', label: t('design.edit') },
              { value: 'preview', label: t('design.preview') },
            ]}
            onChange={setMobileView}
          />
          <Badge tone={status.tone} data-testid="design-status" title={status.label}>
            <span aria-hidden className="size-2 rounded-full bg-current sm:hidden" />
            <span className="max-sm:sr-only">{status.label}</span>
          </Badge>
          <a
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t('design.viewStore')}
            title={t('design.viewStore')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-surface-muted"
          >
            <Icon name="external" className="size-4" />
            <span className="max-sm:hidden">{t('design.viewStore')}</span>
          </a>
          {state.version > 0 && (state.dirty || changed) ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('design.discard')}
              title={t('design.discard')}
              disabled={busy}
              loading={discard.isPending}
              onClick={() => (changed && !state.dirty ? setDraft(state.draft) : discard.mutate())}
            >
              <span aria-hidden className="sm:hidden">
                ↺
              </span>
              <span className="max-sm:hidden">{t('design.discard')}</span>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={!changed || busy || !valid.success}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('design.save')}
          </Button>
          <Button
            size="sm"
            disabled={(!changed && !state.dirty) || busy || !valid.success}
            loading={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {t('design.publish')}
          </Button>
        </div>,
        document.body,
      )}
      {!valid.success ? (
        <Alert tone="danger" title={t('design.invalid')}>
          {valid.error.issues.map((i) => i.message).join(' ')}
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div
          className={cn('flex min-w-0 flex-col gap-4', mobileView === 'preview' && 'max-lg:hidden')}
        >
          <div
            role="tablist"
            aria-label={t('design.parts')}
            className="grid grid-cols-5 gap-1 rounded-xl bg-surface-muted p-1"
          >
            {(['pages', 'theme', 'header', 'footer', 'sale'] as const).map((x) => (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={tab === x}
                onClick={() => setTab(x)}
                className={cn(
                  'rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm',
                  tab === x ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t(`design.tab_${x}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={t(`design.tab_${tab}`)}>
            {tab === 'pages' ? (
              <PagesEditor
                design={draft}
                set={setDraft}
                page={page}
                setPage={setPage}
                previewProduct={previewProduct}
                onPreviewProduct={setChosenProduct}
                onFocus={(id) => post({ type: 'arabat:focus', sectionId: id })}
              />
            ) : tab === 'theme' ? (
              <ThemeEditor design={draft} set={setDraft} />
            ) : tab === 'header' ? (
              <HeaderEditor design={draft} set={setDraft} />
            ) : tab === 'sale' ? (
              <SaleEditor design={draft} set={setDraft} />
            ) : (
              <FooterEditor design={draft} set={setDraft} />
            )}
          </div>
        </div>
        <div
          className={cn('flex min-w-0 flex-col gap-2', mobileView === 'edit' && 'max-lg:hidden')}
        >
          <p className="text-sm font-semibold">{t('design.livePreview')}</p>
          {ready ? (
            <div className="sticky top-20 rounded-xl border border-border bg-surface-muted p-2">
              {/* The device switch floats inside the preview, so it stays at hand. */}
              <Segmented
                label={t('design.device')}
                className="absolute inset-x-0 bottom-4 z-10 mx-auto w-fit shadow-lg"
                value={device}
                options={[
                  { value: 'desktop', label: t('design.desktop') },
                  { value: 'phone', label: t('design.phone') },
                ]}
                onChange={setDevice}
              />
              <PreviewFrame
                ref={frame}
                device={device}
                name={PREVIEW_FRAME_NAME}
                title={t('design.livePreview')}
                src={`/store/${slug}`}
              />
            </div>
          ) : (
            <Alert tone="warning">
              {t('design.needBranch')}{' '}
              <Link to="/settings" className="text-primary hover:underline">
                {t('nav.settings')}
              </Link>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- page sections
function PagesEditor({
  design,
  set,
  page,
  setPage,
  previewProduct,
  onPreviewProduct,
  onFocus,
}: {
  design: StoreDesign;
  set: (d: StoreDesign) => void;
  page: EditorPage;
  setPage: (p: EditorPage) => void;
  previewProduct: string | null;
  onPreviewProduct: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const { t } = useTranslation();
  const summary = useSectionSummary();
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const sections = page === 'checkout' ? [] : design.pages[page];
  const setSections = (next: DesignSection[]) =>
    page === 'checkout' ? undefined : set({ ...design, pages: { ...design.pages, [page]: next } });
  const replace = (id: string, next: DesignSection) =>
    setSections(sections.map((s) => (s.id === id ? next : s)));
  const current = sections.find((s) => s.id === editing) ?? null;

  if (current)
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setEditing(null)}>
          ← {t('design.backToSections')}
        </Button>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden>{SECTION_ICON[current.type]}</span>
          {t(`design.type_${current.type}`)}
        </h2>
        <SectionEditor section={current} onChange={(next) => replace(current.id, next)} />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t('design.page')} className="grid grid-cols-3 gap-2">
        {EDITOR_PAGES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={page === p}
            onClick={() => setPage(p)}
            className={cn(
              'whitespace-nowrap rounded-lg border px-1.5 py-2 text-sm font-semibold',
              page === p ? 'vibe-gradient border-transparent' : 'border-border bg-surface',
            )}
          >
            {t(`design.page_${p}`)}
          </button>
        ))}
      </div>
      <p className="text-sm text-fg-muted">{t(`design.pageHint_${page}`)}</p>
      {page === 'product' ? (
        <>
          <ProductPageEditor
            design={design}
            set={set}
            previewProductId={previewProduct}
            onPreviewProduct={onPreviewProduct}
          />
          <div>
            <h3 className="text-sm font-bold">{t('productDesign.sections')}</h3>
            <p className="text-xs text-fg-muted">{t('productDesign.sectionsHint')}</p>
          </div>
        </>
      ) : page === 'cart' ? (
        <>
          <CartPageEditor design={design} set={set} />
          <div>
            <h3 className="text-sm font-bold">{t('cartDesign.sections')}</h3>
            <p className="text-xs text-fg-muted">{t('cartDesign.sectionsHint')}</p>
          </div>
        </>
      ) : page === 'checkout' ? (
        <CheckoutPageEditor design={design} set={set} />
      ) : null}
      {page === 'home' || page === 'categories' ? (
        <>
          <Panel
            icon="🪄"
            title={t(page === 'home' ? 'design.homeLayouts' : 'design.categoryLayouts')}
            hint={t(page === 'home' ? 'design.homeLayoutsHint' : 'design.categoryLayoutsHint')}
            defaultOpen={false}
          >
            <PageLayouts page={page} onApply={setSections} />
          </Panel>
          <Panel
            icon="💡"
            title={t('design.pageTips')}
            hint={t(page === 'home' ? 'design.pageTipsHint' : 'design.categoryTipsHint')}
          >
            <PageTips
              design={design}
              page={page}
              sections={sections}
              onChange={setSections}
              onEdit={(id) => {
                setEditing(id);
                onFocus(id);
              }}
            />
          </Panel>
        </>
      ) : null}
      {page === 'checkout' ? null : sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          {t('design.noSections')}
        </p>
      ) : (
        <SortableList
          ids={sections.map((s) => s.id)}
          onOrder={(ids) => setSections(ids.map((id) => sections.find((s) => s.id === id)!))}
        >
          {sections.map((s, i) => {
            const label = t(`design.type_${s.type}`);
            const required = isRequired(page, s, sections);
            return (
              <SortableRow
                key={s.id}
                id={s.id}
                label={label}
                first={i === 0}
                last={i === sections.length - 1}
                onMove={(by) => {
                  const next = [...sections];
                  next.splice(i, 1);
                  next.splice(i + by, 0, s);
                  setSections(next);
                }}
              >
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-3 text-start',
                    !s.visible && 'opacity-50',
                  )}
                  onClick={() => {
                    setEditing(s.id);
                    onFocus(s.id);
                  }}
                  aria-label={t('design.editSection', { name: label })}
                >
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-lg"
                  >
                    {SECTION_ICON[s.type]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {isEmptySection(s) ? `⚠️ ${t('design.needsContent')} · ` : ''}
                      {summary(s)}
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-sm hover:bg-surface-muted"
                    aria-label={
                      s.visible
                        ? t('design.hide', { name: label })
                        : t('design.show', { name: label })
                    }
                    aria-pressed={!s.visible}
                    onClick={() => replace(s.id, { ...s, visible: !s.visible })}
                  >
                    <span aria-hidden>{s.visible ? '👁️' : '🚫'}</span>
                  </button>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-sm hover:bg-surface-muted"
                    aria-label={t('design.duplicate', { name: label })}
                    onClick={() => {
                      const copy = { ...structuredClone(s), id: newId(s.type) };
                      const next = [...sections];
                      next.splice(i + 1, 0, copy);
                      setSections(next);
                    }}
                  >
                    <span aria-hidden>⧉</span>
                  </button>
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-sm hover:bg-danger-soft disabled:opacity-30"
                    aria-label={t('design.delete', { name: label })}
                    title={required ? t('design.required') : undefined}
                    disabled={required}
                    onClick={() => setSections(sections.filter((x) => x.id !== s.id))}
                  >
                    <span aria-hidden>🗑️</span>
                  </button>
                </span>
              </SortableRow>
            );
          })}
        </SortableList>
      )}
      {page !== 'checkout' &&
      sections.length < (page === 'home' ? 30 : page === 'cart' ? 10 : 15) ? (
        <Button onClick={() => setPicker(true)}>{t('design.addSection')}</Button>
      ) : null}
      {picker ? (
        <SectionPicker
          design={design}
          exclude={page === 'product' || page === 'cart' ? ['catalog', 'menu'] : []}
          onClose={() => setPicker(false)}
          onPick={(s) => {
            setSections([...sections, s]);
            setPicker(false);
            setEditing(s.id);
            setTimeout(() => onFocus(s.id), 300);
          }}
        />
      ) : null}
    </div>
  );
}
