import {
  type DesignPage as PageKey,
  type DesignSection,
  type SectionType,
  type StoreDesign,
  type StoreDesignState,
  newSection,
  storeDesignSchema,
} from '@arabat/contracts';
import { Alert, Badge, Button, Dialog, PageHeader, Segmented, cn } from '@arabat/ui';
import { AccessDenied, ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';
import { designKey } from './fields.js';
import {
  SECTION_ICON,
  SectionEditor,
  isRequired,
  newId,
  sectionOrder,
  useSectionSummary,
} from './SectionEditor.js';
import { FooterEditor, HeaderEditor, ThemeEditor } from './ShellEditors.js';

/** The preview frame's name: the storefront shows the draft when it runs inside it. */
const PREVIEW_FRAME_NAME = 'arabat-design-preview';
type Tab = 'pages' | 'theme' | 'header' | 'footer';

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
  const [page, setPage] = useState<PageKey>('home');
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
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'arabat:design-ready')
        post({ type: 'arabat:design', design: latest.current });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);
  useEffect(() => {
    const timer = setTimeout(() => post({ type: 'arabat:design', design: draft }), 150);
    return () => clearTimeout(timer);
  }, [draft, post]);
  useEffect(() => post({ type: 'arabat:navigate', page }), [page, post]);

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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('nav.design')}
        description={t('design.hint')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} data-testid="design-status">
              {status.label}
            </Badge>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm">
                {t('design.viewStore')}
              </Button>
            </a>
            {state.version > 0 && (state.dirty || changed) ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                loading={discard.isPending}
                onClick={() => (changed && !state.dirty ? setDraft(state.draft) : discard.mutate())}
              >
                {t('design.discard')}
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
          </div>
        }
      />
      {!valid.success ? (
        <Alert tone="danger" title={t('design.invalid')}>
          {valid.error.issues.map((i) => i.message).join(' ')}
        </Alert>
      ) : null}
      <Segmented
        label={t('design.view')}
        className="self-start lg:hidden"
        value={mobileView}
        options={[
          { value: 'edit', label: t('design.edit') },
          { value: 'preview', label: t('design.preview') },
        ]}
        onChange={setMobileView}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div
          className={cn('flex min-w-0 flex-col gap-4', mobileView === 'preview' && 'max-lg:hidden')}
        >
          <div
            role="tablist"
            aria-label={t('design.parts')}
            className="grid grid-cols-4 gap-1 rounded-xl bg-surface-muted p-1"
          >
            {(['pages', 'theme', 'header', 'footer'] as const).map((x) => (
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
                onFocus={(id) => post({ type: 'arabat:focus', sectionId: id })}
              />
            ) : tab === 'theme' ? (
              <ThemeEditor design={draft} set={setDraft} />
            ) : tab === 'header' ? (
              <HeaderEditor design={draft} set={setDraft} />
            ) : (
              <FooterEditor design={draft} set={setDraft} />
            )}
          </div>
        </div>
        <div
          className={cn('flex min-w-0 flex-col gap-2', mobileView === 'edit' && 'max-lg:hidden')}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('design.livePreview')}</p>
            <Segmented
              label={t('design.device')}
              value={device}
              options={[
                { value: 'desktop', label: t('design.desktop') },
                { value: 'phone', label: t('design.phone') },
              ]}
              onChange={setDevice}
            />
          </div>
          {ready ? (
            <div className="rounded-xl border border-border bg-surface-muted p-2 lg:sticky lg:top-20">
              <iframe
                ref={frame}
                name={PREVIEW_FRAME_NAME}
                title={t('design.livePreview')}
                src={`/store/${slug}`}
                className={cn(
                  'mx-auto block h-[75dvh] rounded-lg bg-white',
                  device === 'phone' ? 'w-[390px] max-w-full' : 'w-full',
                )}
                data-testid="design-preview"
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
  onFocus,
}: {
  design: StoreDesign;
  set: (d: StoreDesign) => void;
  page: PageKey;
  setPage: (p: PageKey) => void;
  onFocus: (id: string) => void;
}) {
  const { t } = useTranslation();
  const summary = useSectionSummary();
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const sections = design.pages[page];
  const setSections = (next: DesignSection[]) =>
    set({ ...design, pages: { ...design.pages, [page]: next } });
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
      <div role="radiogroup" aria-label={t('design.page')} className="flex gap-2">
        {(['home', 'products', 'categories'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={page === p}
            onClick={() => setPage(p)}
            className={cn(
              'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold',
              page === p ? 'vibe-gradient border-transparent' : 'border-border bg-surface',
            )}
          >
            {t(`design.page_${p}`)}
          </button>
        ))}
      </div>
      <p className="text-sm text-fg-muted">{t(`design.pageHint_${page}`)}</p>
      {sections.length === 0 ? (
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
                    <span className="block truncate text-xs text-fg-muted">{summary(s)}</span>
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
      {sections.length < (page === 'home' ? 30 : 15) ? (
        <Button onClick={() => setPicker(true)}>{t('design.addSection')}</Button>
      ) : null}
      {picker ? (
        <SectionPicker
          template={design.template}
          onClose={() => setPicker(false)}
          onPick={(type) => {
            const s = newSection(type, newId(type));
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

function SectionPicker({
  template,
  onClose,
  onPick,
}: {
  template: StoreDesign['template'];
  onClose: () => void;
  onPick: (type: SectionType) => void;
}) {
  const { t } = useTranslation();
  const order = sectionOrder(template);
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={t('design.addSection')}
      description={t(`design.pickerHint_${template}`)}
      size="lg"
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {order.map((type, i) => (
          <li key={type}>
            <button
              type="button"
              onClick={() => onPick(type)}
              className="vibe-lift flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-3 text-start"
            >
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-xl"
              >
                {SECTION_ICON[type]}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {t(`design.type_${type}`)}
                  {i < 2 ? <Badge tone="primary">{t('design.suggested')}</Badge> : null}
                </span>
                <span className="block text-xs text-fg-muted">{t(`design.typeHint_${type}`)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
