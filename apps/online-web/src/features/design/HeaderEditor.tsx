import {
  HEADER_LAYOUTS,
  type HeaderAction,
  type HeaderLayout,
  type NavItem,
  type StoreDesign,
} from '@arabat/contracts';
import { Button, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableList, SortableRow } from '../sortable.js';
import { Choice, LinkPicker, LocalizedField, Panel, SocialFields, Toggle } from './fields.js';
import { newId } from './SectionEditor.js';

type Set = (next: StoreDesign) => void;

// ------------------------------------------------------------- layout thumbnails
/** A small drawing of each header layout, so the merchant picks by looks. */
function LayoutThumb({ layout }: { layout: HeaderLayout }) {
  const bar = 'fill-current opacity-15';
  const ink = 'fill-current opacity-60';
  const logo = 'fill-primary';
  const dot = (x: number, y = 16) => <circle key={x} cx={x} cy={y} r="3" className={ink} />;
  const line = (x: number, w: number, y = 15) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={w} height="3" rx="1.5" className={ink} />
  );
  const body = {
    classic: (
      <>
        <rect x="6" y="9" width="14" height="14" rx="7" className={logo} />
        {line(42, 12)}
        {line(58, 12)}
        {line(74, 12)}
        {dot(100)}
        {dot(110)}
      </>
    ),
    centered: (
      <>
        {dot(10)}
        <rect x="53" y="5" width="14" height="14" rx="7" className={logo} />
        {dot(100)}
        {dot(110)}
        {line(34, 12, 25)}
        {line(54, 12, 25)}
        {line(74, 12, 25)}
      </>
    ),
    split: (
      <>
        {line(8, 12)}
        {line(24, 12)}
        <rect x="53" y="9" width="14" height="14" rx="7" className={logo} />
        {line(80, 12)}
        {dot(102)}
        {dot(112)}
      </>
    ),
    stacked: (
      <>
        <rect x="6" y="5" width="12" height="12" rx="6" className={logo} />
        <rect
          x="26"
          y="6"
          width="62"
          height="9"
          rx="4.5"
          className={bar}
          stroke="currentColor"
          strokeOpacity="0.4"
        />
        {dot(100, 11)}
        {dot(110, 11)}
        {line(8, 12, 25)}
        {line(24, 12, 25)}
        {line(40, 12, 25)}
      </>
    ),
    minimal: (
      <>
        {line(6, 10, 12)}
        {line(6, 10, 18)}
        <rect x="53" y="9" width="14" height="14" rx="7" className={logo} />
        {dot(110)}
      </>
    ),
    floating: (
      <>
        <rect
          x="4"
          y="5"
          width="112"
          height="22"
          rx="11"
          className="fill-surface stroke-current"
          strokeOpacity="0.25"
        />
        <rect x="10" y="10" width="12" height="12" rx="6" className={logo} />
        {line(44, 10)}
        {line(58, 10)}
        {line(72, 10)}
        {dot(104)}
      </>
    ),
    bold: (
      <>
        <rect x="0" y="0" width="120" height="22" className="fill-primary" />
        <rect x="8" y="5" width="12" height="12" rx="6" className="fill-white" />
        <rect x="24" y="9" width="26" height="4" rx="2" className="fill-white/80" />
        {line(30, 12, 26)}
        {line(50, 12, 26)}
        {line(70, 12, 26)}
      </>
    ),
  }[layout];
  return (
    <svg
      viewBox="0 0 120 32"
      className="h-12 w-full overflow-hidden rounded-md bg-surface-muted text-fg"
      aria-hidden
    >
      {body}
    </svg>
  );
}

function LayoutGallery({
  value,
  onChange,
}: {
  value: HeaderLayout;
  onChange: (v: HeaderLayout) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t('design.headerLayout')} className="grid grid-cols-2 gap-2">
      {HEADER_LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          aria-label={t(`design.layout_${l}`)}
          onClick={() => onChange(l)}
          className={cn(
            'flex flex-col gap-2 rounded-xl border p-2 text-start transition-colors',
            value === l
              ? 'border-primary bg-primary-soft ring-2 ring-primary/30'
              : 'border-border hover:border-border-strong',
          )}
        >
          <LayoutThumb layout={l} />
          <span className="px-1">
            <span className="block text-sm font-semibold">{t(`design.layout_${l}`)}</span>
            <span className="block text-xs text-fg-muted">{t(`design.layoutHint_${l}`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------- editor
export function HeaderEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const header = (p: Partial<StoreDesign['header']>) =>
    set({ ...design, header: { ...design.header, ...p } });
  const navbar = (p: Partial<StoreDesign['navbar']>) =>
    set({ ...design, navbar: { ...design.navbar, ...p } });
  const drawer = (p: Partial<StoreDesign['drawer']>) =>
    set({ ...design, drawer: { ...design.drawer, ...p } });
  const bar = (p: Partial<StoreDesign['announcement']>) =>
    set({ ...design, announcement: { ...design.announcement, ...p } });
  const h = design.header;
  const opts = <T extends string>(prefix: string, values: readonly T[]) =>
    values.map((v) => ({ value: v, label: t(`design.${prefix}_${v}`) }));
  return (
    <div className="flex flex-col gap-3">
      <Panel icon="🧭" title={t('design.headerLayout')} hint={t('design.headerLayoutHint')}>
        <LayoutGallery value={h.layout} onChange={(layout) => header({ layout })} />
      </Panel>

      <Panel icon="📣" title={t('design.topBar')} hint={t('design.topBarHint')}>
        <Choice
          label={t('design.announcement')}
          value={design.announcement.style}
          options={opts('announcement', ['brand', 'dark', 'soft'] as const)}
          onChange={(style) => bar({ style })}
        />
        {design.announcement.messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
            <LocalizedField
              label={t('design.messageN', { n: i + 1 })}
              value={m}
              max={120}
              onChange={(v) =>
                bar({ messages: design.announcement.messages.map((x, j) => (j === i ? v : x)) })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              onClick={() =>
                bar({ messages: design.announcement.messages.filter((_, j) => j !== i) })
              }
            >
              {t('design.remove')}
            </Button>
          </div>
        ))}
        {design.announcement.messages.length < 3 ? (
          <Button
            variant="secondary"
            className="w-fit"
            onClick={() =>
              bar({ messages: [...design.announcement.messages, { en: null, ar: null }] })
            }
          >
            {t('design.addMessage')}
          </Button>
        ) : null}
        <Toggle
          label={t('design.topBarContact')}
          checked={design.announcement.showContact}
          onChange={(v) => bar({ showContact: v })}
        />
        <Toggle
          label={t('design.topBarSocial')}
          checked={design.announcement.showSocial}
          onChange={(v) => bar({ showSocial: v })}
        />
      </Panel>

      <Panel icon="🏷️" title={t('design.logo')} hint={t('design.logoHint')}>
        <Choice
          label={t('design.logoSize')}
          value={h.logoSize}
          options={opts('logoSize', ['small', 'medium', 'large'] as const)}
          onChange={(logoSize) => header({ logoSize })}
        />
        <Toggle
          label={t('design.showName')}
          checked={h.showName}
          onChange={(v) => header({ showName: v })}
        />
        <Toggle
          label={t('design.showTagline')}
          checked={h.showTagline}
          onChange={(v) => header({ showTagline: v })}
        />
      </Panel>

      <Panel icon="☰" title={t('design.navbar')} hint={t('design.navbarHint')}>
        <Choice
          label={t('design.navbarStyle')}
          value={design.navbar.style}
          options={opts('nav', ['links', 'underline', 'pills', 'boxed', 'hidden'] as const)}
          onChange={(style) => navbar({ style })}
        />
        <Choice
          label={t('design.navAlign')}
          value={design.navbar.align}
          options={opts('align', ['start', 'center', 'end'] as const)}
          onChange={(align) => navbar({ align })}
        />
        <Choice
          label={t('design.menuStyle')}
          value={design.navbar.menuStyle}
          options={opts('menuStyle', ['dropdown', 'mega'] as const)}
          onChange={(menuStyle) => navbar({ menuStyle })}
        />
        <NavItemsEditor items={design.navbar.items} onChange={(items) => navbar({ items })} />
      </Panel>

      <Panel icon="🛒" title={t('design.headerItems')} hint={t('design.headerItemsHint')}>
        <ActionsEditor actions={h.actions} onChange={(actions) => header({ actions })} />
        <Choice
          label={t('design.cartStyle')}
          value={h.cartStyle}
          options={opts('cartStyle', ['pill', 'icon', 'text'] as const)}
          onChange={(cartStyle) => header({ cartStyle })}
        />
        <Choice
          label={t('design.searchStyle')}
          value={h.searchStyle}
          options={opts('searchStyle', ['icon', 'bar'] as const)}
          onChange={(searchStyle) => header({ searchStyle })}
        />
        <Choice
          label={t('design.languageStyle')}
          value={h.languageStyle}
          options={opts('languageStyle', ['compact', 'full'] as const)}
          onChange={(languageStyle) => header({ languageStyle })}
        />
      </Panel>

      <Panel icon="🎨" title={t('design.headerLook')} hint={t('design.headerLookHint')}>
        <Choice
          label={t('design.headerBackground')}
          value={h.background}
          options={opts('headerBg', ['light', 'brand', 'dark', 'glass'] as const)}
          onChange={(background) => header({ background })}
        />
        <Choice
          label={t('design.headerBorder')}
          value={h.border}
          options={opts('border', ['none', 'line', 'shadow'] as const)}
          onChange={(border) => header({ border })}
        />
        <Choice
          label={t('design.headerHeight')}
          value={h.height}
          options={opts('height', ['compact', 'regular', 'tall'] as const)}
          onChange={(height) => header({ height })}
        />
        <Choice
          label={t('design.headerWidth')}
          value={h.width}
          options={opts('width', ['contained', 'full'] as const)}
          onChange={(width) => header({ width })}
        />
        <Toggle
          label={t('design.sticky')}
          checked={h.sticky}
          onChange={(v) => header({ sticky: v })}
        />
        {h.sticky ? (
          <Toggle
            label={t('design.hideOnScroll')}
            checked={h.hideOnScroll}
            onChange={(v) => header({ hideOnScroll: v })}
          />
        ) : null}
      </Panel>

      <Panel icon="📱" title={t('design.mobile')} hint={t('design.mobileHint')}>
        <Choice
          label={t('design.mobileLayout')}
          value={h.mobileLayout}
          options={opts('mobileLayout', ['start', 'center'] as const)}
          onChange={(mobileLayout) => header({ mobileLayout })}
        />
        <Toggle
          label={t('design.mobileSearch')}
          checked={h.mobileSearch}
          onChange={(v) => header({ mobileSearch: v })}
        />
        <Toggle
          label={t('design.mobileBarOn')}
          checked={design.mobileBar.enabled}
          onChange={(v) => set({ ...design, mobileBar: { enabled: v } })}
        />
      </Panel>

      <Panel icon="🗂️" title={t('design.drawer')} hint={t('design.drawerHint')}>
        <Choice
          label={t('design.drawerStyle')}
          value={design.drawer.style}
          options={opts('drawerStyle', ['side', 'full'] as const)}
          onChange={(style) => drawer({ style })}
        />
        <Toggle
          label={t('design.drawerOnDesktop')}
          checked={design.drawer.enabled}
          onChange={(v) => drawer({ enabled: v })}
        />
        <Toggle
          label={t('design.drawerCategories')}
          checked={design.drawer.showCategories}
          onChange={(v) => drawer({ showCategories: v })}
        />
        <Toggle
          label={t('design.drawerContact')}
          checked={design.drawer.showContact}
          onChange={(v) => drawer({ showContact: v })}
        />
        <Toggle
          label={t('design.drawerSocial')}
          checked={design.drawer.showSocial}
          onChange={(v) => drawer({ showSocial: v })}
        />
      </Panel>

      <Panel icon="💬" title={t('design.social')} hint={t('design.socialHint')}>
        <SocialFields design={design} set={set} />
      </Panel>
    </div>
  );
}

/** Header items in order (drag or ▲▼), each shown or hidden; the cart always stays. */
function ActionsEditor({
  actions,
  onChange,
}: {
  actions: StoreDesign['header']['actions'];
  onChange: (next: StoreDesign['header']['actions']) => void;
}) {
  const { t } = useTranslation();
  const icon: Record<HeaderAction, string> = {
    search: '🔎',
    account: '👤',
    branch: '📍',
    language: '🌐',
    whatsapp: '💬',
    cart: '🛍️',
  };
  return (
    <SortableList
      ids={actions.map((a) => a.type)}
      onOrder={(ids) => onChange(ids.map((id) => actions.find((a) => a.type === id)!))}
    >
      {actions.map((a, i) => {
        const label = t(`design.action_${a.type}`);
        return (
          <SortableRow
            key={a.type}
            id={a.type}
            label={label}
            first={i === 0}
            last={i === actions.length - 1}
            onMove={(by) => {
              const next = [...actions];
              next.splice(i, 1);
              next.splice(i + by, 0, a);
              onChange(next);
            }}
          >
            <span aria-hidden className="text-lg">
              {icon[a.type]}
            </span>
            <span
              className={cn(
                'flex-1 text-sm font-medium',
                !a.visible && 'text-fg-subtle line-through',
              )}
            >
              {label}
            </span>
            {a.type === 'cart' ? (
              <span className="text-xs text-fg-muted">{t('design.alwaysShown')}</span>
            ) : (
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={a.visible}
                  aria-label={t('design.showAction', { name: label })}
                  onChange={(e) =>
                    onChange(
                      actions.map((x) =>
                        x.type === a.type ? { ...x, visible: e.target.checked } : x,
                      ),
                    )
                  }
                />
                {t('design.shown')}
              </label>
            )}
          </SortableRow>
        );
      })}
    </SortableList>
  );
}

/** Navigation items with their kind (a link or the categories menu) and sub-menus. */
function NavItemsEditor({
  items,
  onChange,
}: {
  items: NavItem[];
  onChange: (next: NavItem[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const setItem = (i: number, p: Partial<NavItem>) =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg-muted">
        {items.length === 0 ? t('design.navDefault') : t('design.navItems')}
      </p>
      {items.map((item, i) => {
        const title = item.label.ar || item.label.en || t('design.untitled');
        const expanded = open === item.id;
        return (
          <div key={item.id} className="rounded-lg border border-border">
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-1 text-start text-sm font-semibold"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : item.id)}
              >
                {item.kind === 'categories' ? '🗂️ ' : ''}
                {title}
                {item.children.length > 0
                  ? ` · ${t('design.subCount', { count: item.children.length })}`
                  : ''}
              </button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                aria-label={t('design.moveUp')}
                onClick={() => move(i, -1)}
              >
                ▲
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === items.length - 1}
                aria-label={t('design.moveDown')}
                onClick={() => move(i, 1)}
              >
                ▼
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                {t('design.remove')}
              </Button>
            </div>
            {expanded ? (
              <div className="flex flex-col gap-3 border-t border-border bg-surface-muted p-3">
                <LocalizedField
                  label={t('design.label')}
                  value={item.label}
                  max={30}
                  onChange={(v) => setItem(i, { label: v })}
                />
                <Choice
                  label={t('design.navKind')}
                  value={item.kind}
                  options={[
                    { value: 'link', label: t('design.navKind_link') },
                    { value: 'categories', label: t('design.navKind_categories') },
                  ]}
                  onChange={(kind) => setItem(i, { kind })}
                />
                <LinkPicker
                  label={t('design.link')}
                  value={item.link}
                  optional={false}
                  onChange={(v) => v && setItem(i, { link: v })}
                />
                {item.kind === 'link' ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{t('design.subItems')}</p>
                    {item.children.map((c, ci) => (
                      <div key={c.id} className="flex flex-col gap-2 rounded-lg bg-surface p-3">
                        <LocalizedField
                          label={t('design.label')}
                          value={c.label}
                          max={30}
                          onChange={(v) =>
                            setItem(i, {
                              children: item.children.map((x, j) =>
                                j === ci ? { ...x, label: v } : x,
                              ),
                            })
                          }
                        />
                        <LinkPicker
                          label={t('design.link')}
                          value={c.link}
                          optional={false}
                          onChange={(v) =>
                            v &&
                            setItem(i, {
                              children: item.children.map((x, j) =>
                                j === ci ? { ...x, link: v } : x,
                              ),
                            })
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-fit"
                          onClick={() =>
                            setItem(i, { children: item.children.filter((_, j) => j !== ci) })
                          }
                        >
                          {t('design.remove')}
                        </Button>
                      </div>
                    ))}
                    {item.children.length < 10 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-fit"
                        onClick={() =>
                          setItem(i, {
                            children: [
                              ...item.children,
                              {
                                id: newId('sub'),
                                label: { en: null, ar: null },
                                link: { kind: 'page', page: 'products' },
                              },
                            ],
                          })
                        }
                      >
                        {t('design.addSubItem')}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-fg-muted">{t('design.navKind_categoriesHint')}</p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {items.length < 8 ? (
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => {
            const id = newId('nav');
            onChange([
              ...items,
              {
                id,
                label: { en: null, ar: null },
                link: { kind: 'page', page: 'products' },
                kind: 'link',
                children: [],
              },
            ]);
            setOpen(id);
          }}
        >
          {t('design.addNavItem')}
        </Button>
      ) : null}
    </div>
  );
}
