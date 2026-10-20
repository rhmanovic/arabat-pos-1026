import {
  FOOTER_BLOCK_TYPES,
  FOOTER_LAYOUTS,
  FOOTER_PRESETS,
  type FooterBlock,
  type FooterBlockType,
  type FooterLayout,
  type FooterLink,
  type FooterPreset,
  type StoreDesign,
  footerPreset,
  suggestedBadges,
} from '@arabat/contracts';
import { Alert, Button, Field, Input, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableList, SortableRow } from '../sortable.js';
import { Choice, LinkPicker, LocalizedField, Panel, SocialFields, Toggle } from './fields.js';
import { newId } from './SectionEditor.js';

type Set = (next: StoreDesign) => void;
type Footer = StoreDesign['footer'];

const BLOCK_ICON: Record<FooterBlockType, string> = {
  about: '📝',
  links: '🔗',
  categories: '🗂️',
  contact: '📞',
  hours: '🕒',
  branches: '📍',
  social: '💬',
  payments: '💳',
  text: '✏️',
};
const PRESET_ICON: Record<FooterPreset, string> = {
  shop: '🛍️',
  restaurant: '🍽️',
  brand: '✨',
  minimal: '➖',
};

// ------------------------------------------------------------- layout thumbnails
/** A small drawing of each footer layout, so the merchant picks by looks. */
function FooterThumb({ layout }: { layout: FooterLayout }) {
  const ink = 'fill-current opacity-50';
  const soft = 'fill-current opacity-15';
  const logo = 'fill-primary';
  const line = (x: number, y: number, w: number) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={w} height="2.5" rx="1.25" className={ink} />
  );
  const column = (x: number) => [line(x, 8, 16), line(x, 14, 12), line(x, 19, 14)];
  const bottom = <rect x="6" y="27" width="108" height="1" className={soft} />;
  const body = {
    columns: [...column(8), ...column(36), ...column(64), ...column(92), bottom],
    split: [
      <circle key="l" cx="14" cy="11" r="5" className={logo} />,
      line(8, 19, 26),
      ...column(50),
      ...column(78),
      bottom,
    ],
    stacked: [
      <circle key="l" cx="14" cy="8" r="4" className={logo} />,
      line(22, 7, 26),
      <rect key="sep" x="6" y="14" width="108" height="1" className={soft} />,
      line(8, 19, 18),
      line(44, 19, 18),
      line(80, 19, 18),
      bottom,
    ],
    centered: [
      <circle key="l" cx="60" cy="8" r="4" className={logo} />,
      line(44, 15, 32),
      line(30, 21, 16),
      line(52, 21, 16),
      line(74, 21, 16),
      bottom,
    ],
    cards: [
      <rect key="c1" x="6" y="5" width="34" height="19" rx="3" className={soft} />,
      <rect key="c2" x="43" y="5" width="34" height="19" rx="3" className={soft} />,
      <rect key="c3" x="80" y="5" width="34" height="19" rx="3" className={soft} />,
      <circle key="l" cx="14" cy="12" r="3.5" className={logo} />,
      line(49, 11, 20),
      line(86, 11, 20),
      bottom,
    ],
    simple: [line(8, 12, 22), line(40, 12, 22), line(92, 12, 20)],
    minimal: [
      <rect key="bar" x="6" y="12" width="108" height="8" rx="4" className={soft} />,
      line(12, 15, 24),
      line(70, 15, 12),
      line(90, 15, 18),
    ],
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
  value: FooterLayout;
  onChange: (v: FooterLayout) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t('design.footerLayout')} className="grid grid-cols-2 gap-2">
      {FOOTER_LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          aria-label={t(`design.footerLayout_${l}`)}
          onClick={() => onChange(l)}
          className={cn(
            'flex flex-col gap-2 rounded-xl border p-2 text-start transition-colors',
            value === l
              ? 'border-primary bg-primary-soft ring-2 ring-primary/30'
              : 'border-border hover:border-border-strong',
          )}
        >
          <FooterThumb layout={l} />
          <span className="px-1">
            <span className="block text-sm font-semibold">{t(`design.footerLayout_${l}`)}</span>
            <span className="block text-xs text-fg-muted">{t(`design.footerLayoutHint_${l}`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- presets
function Presets({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2">
      {FOOTER_PRESETS.map((p) => (
        <li
          key={p}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
        >
          <span className="relative w-24 shrink-0">
            <FooterThumb layout={footerPreset(p).layout} />
            <span aria-hidden className="absolute -top-1.5 -start-1.5 text-lg">
              {PRESET_ICON[p]}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{t(`design.footerPreset_${p}`)}</span>
            <span className="block text-xs text-fg-muted">{t(`design.footerPresetHint_${p}`)}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('design.applyPreset', { name: t(`design.footerPreset_${p}`) })}
            onClick={() => set({ ...design, footer: footerPreset(p) })}
          >
            {t('design.applyTemplate')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------- recommendations
type Tip = { key: string; done: boolean; fix?: () => void };

/** What a shop footer usually needs, each with a one-tap fix where one exists. */
function Recommendations({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const f = design.footer;
  const footer = (p: Partial<Footer>) => set({ ...design, footer: { ...f, ...p } });
  const has = (type: FooterBlockType) => f.blocks.some((b) => b.type === type);
  const addBlock = (type: FooterBlockType) =>
    f.blocks.length < 6 ? () => footer({ blocks: [...f.blocks, blankBlock(type)] }) : undefined;
  const social = Object.values(design.social).some(Boolean);
  const tips: Tip[] = [
    {
      key: 'contact',
      done: has('contact') || Boolean(design.social.whatsapp),
      fix: addBlock('contact'),
    },
    { key: 'social', done: social },
    {
      key: 'payments',
      done: has('payments') || f.bottom.showPayments,
      fix: () => footer({ bottom: { ...f.bottom, showPayments: true } }),
    },
    {
      key: 'badges',
      done: f.badges.length > 0,
      fix: () => footer({ badges: suggestedBadges(design.template) }),
    },
    { key: 'policies', done: f.bottom.links.length > 0 },
    {
      key: 'cta',
      done: f.cta.enabled,
      fix: () =>
        footer({
          cta: {
            enabled: true,
            title:
              design.template === 'restaurant'
                ? { en: 'Hungry?', ar: 'جوعان؟' }
                : { en: 'New arrivals every week', ar: 'جديدنا كل أسبوع' },
            text: { en: null, ar: null },
            button:
              design.template === 'restaurant'
                ? { en: 'Order now', ar: 'اطلب الآن' }
                : { en: 'Shop now', ar: 'تسوّق الآن' },
            link: { kind: 'page', page: 'products' },
          },
        }),
    },
    ...(design.template === 'restaurant'
      ? [{ key: 'hours', done: has('hours'), fix: addBlock('hours') }]
      : []),
  ];
  const done = tips.filter((x) => x.done).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round((done / tips.length) * 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-fg-muted" data-testid="footer-score">
          {t('design.tipsDone', { done, total: tips.length })}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {tips.map((tip) => (
          <li
            key={tip.key}
            className={cn(
              'flex items-start gap-3 rounded-lg p-3 text-sm',
              tip.done ? 'bg-surface-muted' : 'border border-dashed border-border-strong',
            )}
          >
            <span aria-hidden>{tip.done ? '✅' : '💡'}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t(`design.tip_${tip.key}`)}</span>
              <span className="block text-xs text-fg-muted">{t(`design.tipHint_${tip.key}`)}</span>
            </span>
            {!tip.done && tip.fix ? (
              <Button size="sm" variant="secondary" onClick={tip.fix}>
                {t(`design.tipFix_${tip.key}`)}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Titles a new block starts with, in both languages (the merchant can change them). */
const BLOCK_TITLE: Record<FooterBlockType, { en: string | null; ar: string | null }> = {
  about: { en: 'About us', ar: 'من نحن' },
  links: { en: 'Quick links', ar: 'روابط سريعة' },
  categories: { en: 'Shop', ar: 'تسوّق' },
  contact: { en: 'Contact us', ar: 'تواصل معنا' },
  hours: { en: 'Opening hours', ar: 'أوقات العمل' },
  branches: { en: 'Our branches', ar: 'فروعنا' },
  social: { en: null, ar: null },
  payments: { en: null, ar: null },
  text: { en: null, ar: null },
};

function blankBlock(type: FooterBlockType): FooterBlock {
  return {
    id: newId(type),
    type,
    title: BLOCK_TITLE[type],
    text: { en: null, ar: null },
    links: [],
  };
}

// -------------------------------------------------------------------- links
function LinksEditor({
  links,
  max,
  onChange,
}: {
  links: FooterLink[];
  max: number;
  onChange: (next: FooterLink[]) => void;
}) {
  const { t } = useTranslation();
  const setLink = (i: number, p: Partial<FooterLink>) =>
    onChange(links.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-2">
      {links.map((l, i) => (
        <div key={l.id} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
          <LocalizedField
            label={t('design.label')}
            value={l.label}
            max={30}
            onChange={(v) => setLink(i, { label: v })}
          />
          <LinkPicker
            label={t('design.link')}
            value={l.link}
            optional={false}
            onChange={(v) => v && setLink(i, { link: v })}
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => onChange(links.filter((_, j) => j !== i))}
          >
            {t('design.remove')}
          </Button>
        </div>
      ))}
      {links.length < max ? (
        <Button
          size="sm"
          variant="secondary"
          className="w-fit"
          onClick={() =>
            onChange([
              ...links,
              {
                id: newId('link'),
                label: { en: null, ar: null },
                link: { kind: 'page', page: 'products' },
              },
            ])
          }
        >
          {t('design.addLink')}
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- blocks
function BlocksEditor({
  footer,
  onChange,
}: {
  footer: Footer;
  onChange: (b: FooterBlock[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const blocks = footer.blocks;
  const setBlock = (i: number, p: Partial<FooterBlock>) =>
    onChange(blocks.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-3">
      {blocks.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('design.noBlocks')}</p>
      ) : (
        <SortableList
          ids={blocks.map((b) => b.id)}
          onOrder={(ids) => onChange(ids.map((id) => blocks.find((b) => b.id === id)!))}
        >
          {blocks.map((block, i) => {
            const label = t(`design.block_${block.type}`);
            const expanded = open === block.id;
            return (
              <SortableRow
                key={block.id}
                id={block.id}
                label={label}
                first={i === 0}
                last={i === blocks.length - 1}
                onMove={(by) => {
                  const next = [...blocks];
                  next.splice(i, 1);
                  next.splice(i + by, 0, block);
                  onChange(next);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm font-semibold"
                      aria-expanded={expanded}
                      aria-label={t('design.editBlock', { name: label })}
                      onClick={() => setOpen(expanded ? null : block.id)}
                    >
                      <span aria-hidden>{BLOCK_ICON[block.type]}</span>
                      <span className="truncate">
                        {label}
                        {block.title.ar || block.title.en
                          ? ` · ${block.title.ar || block.title.en}`
                          : ''}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('design.removeBlock', { name: label })}
                      onClick={() => onChange(blocks.filter((_, j) => j !== i))}
                    >
                      {t('design.remove')}
                    </Button>
                  </div>
                  {expanded ? (
                    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                      <LocalizedField
                        label={t('design.title')}
                        value={block.title}
                        max={40}
                        onChange={(v) => setBlock(i, { title: v })}
                      />
                      {block.type === 'about' || block.type === 'text' ? (
                        <LocalizedField
                          label={t('design.text')}
                          value={block.text}
                          max={400}
                          multiline
                          onChange={(v) => setBlock(i, { text: v })}
                        />
                      ) : null}
                      {block.type === 'links' ? (
                        <LinksEditor
                          links={block.links}
                          max={10}
                          onChange={(links) => setBlock(i, { links })}
                        />
                      ) : null}
                      <p className="text-xs text-fg-muted">{t(`design.block_${block.type}Hint`)}</p>
                    </div>
                  ) : null}
                </div>
              </SortableRow>
            );
          })}
        </SortableList>
      )}
      {blocks.length < 6 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('design.addBlock')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FOOTER_BLOCK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                title={t(`design.block_${type}Hint`)}
                onClick={() => {
                  const block = blankBlock(type);
                  onChange([...blocks, block]);
                  setOpen(block.id);
                }}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-start text-sm font-medium transition-colors hover:border-primary hover:bg-primary-soft"
              >
                <span aria-hidden>{BLOCK_ICON[type]}</span>
                {t(`design.block_${type}`)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{t('design.blocksFull')}</p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- badges
function BadgesEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const badges = design.footer.badges;
  const onChange = (next: Footer['badges']) =>
    set({ ...design, footer: { ...design.footer, badges: next } });
  return (
    <div className="flex flex-col gap-3">
      {badges.map((b, i) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
          <Field label={t('design.icon')} hint={t('design.iconHint')}>
            {(p) => (
              <Input
                {...p}
                className="w-24"
                maxLength={8}
                value={b.icon}
                onChange={(e) =>
                  onChange(badges.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)))
                }
              />
            )}
          </Field>
          <LocalizedField
            label={t('design.badgeTitle')}
            value={b.title}
            max={40}
            onChange={(v) => onChange(badges.map((x, j) => (j === i ? { ...x, title: v } : x)))}
          />
          <LocalizedField
            label={t('design.badgeText')}
            value={b.text}
            max={80}
            onChange={(v) => onChange(badges.map((x, j) => (j === i ? { ...x, text: v } : x)))}
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => onChange(badges.filter((_, j) => j !== i))}
          >
            {t('design.remove')}
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {badges.length < 4 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onChange([
                ...badges,
                {
                  id: newId('badge'),
                  icon: '⭐',
                  title: { en: null, ar: null },
                  text: { en: null, ar: null },
                },
              ])
            }
          >
            {t('design.addBadge')}
          </Button>
        ) : null}
        {badges.length === 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(suggestedBadges(design.template))}
          >
            {t('design.useSuggestedBadges')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- editor
export function FooterEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const f = design.footer;
  const footer = (p: Partial<Footer>) => set({ ...design, footer: { ...f, ...p } });
  const opts = <T extends string>(prefix: string, values: readonly T[]) =>
    values.map((v) => ({ value: v, label: t(`design.${prefix}_${v}`) }));
  const bare = f.layout === 'minimal' || f.layout === 'simple';
  return (
    <div className="flex flex-col gap-3">
      <Panel icon="🪄" title={t('design.footerPresets')} hint={t('design.footerPresetsHint')}>
        <Presets design={design} set={set} />
      </Panel>

      <Panel icon="💡" title={t('design.footerTips')} hint={t('design.footerTipsHint')}>
        <Recommendations design={design} set={set} />
      </Panel>

      <Panel icon="🧭" title={t('design.footerLayout')} hint={t('design.footerLayoutHint')}>
        <LayoutGallery value={f.layout} onChange={(layout) => footer({ layout })} />
        {bare ? <Alert tone="info">{t(`design.footerBareHint_${f.layout}`)}</Alert> : null}
      </Panel>

      <Panel icon="🎨" title={t('design.footerLook')} hint={t('design.footerLookHint')}>
        <Choice
          label={t('design.footerBackground')}
          value={f.background}
          options={opts('footerBg', ['light', 'tinted', 'brand', 'dark'] as const)}
          onChange={(background) => footer({ background })}
        />
        <Choice
          label={t('design.topEdge')}
          value={f.topEdge}
          options={opts('topEdge', ['none', 'line', 'wave', 'curve'] as const)}
          onChange={(topEdge) => footer({ topEdge })}
        />
        <Choice
          label={t('design.footerColumns')}
          value={f.columns}
          options={opts('footerColumns', ['auto', '2', '3', '4'] as const)}
          onChange={(columns) => footer({ columns })}
        />
        <Choice
          label={t('design.footerSpacing')}
          value={f.spacing}
          options={opts('spacing', ['compact', 'regular', 'roomy'] as const)}
          onChange={(spacing) => footer({ spacing })}
        />
        <Choice
          label={t('design.headerWidth')}
          value={f.width}
          options={opts('width', ['contained', 'full'] as const)}
          onChange={(width) => footer({ width })}
        />
      </Panel>

      <Panel icon="🏷️" title={t('design.footerBrand')} hint={t('design.footerBrandHint')}>
        <Toggle
          label={t('design.brandLogo')}
          checked={f.brand.showLogo}
          onChange={(v) => footer({ brand: { ...f.brand, showLogo: v } })}
        />
        <Toggle
          label={t('design.showName')}
          checked={f.brand.showName}
          onChange={(v) => footer({ brand: { ...f.brand, showName: v } })}
        />
        <Toggle
          label={t('design.showTagline')}
          checked={f.brand.showTagline}
          onChange={(v) => footer({ brand: { ...f.brand, showTagline: v } })}
        />
        <LocalizedField
          label={t('design.brandText')}
          value={f.brand.text}
          max={300}
          multiline
          onChange={(text) => footer({ brand: { ...f.brand, text } })}
        />
      </Panel>

      <Panel icon="📣" title={t('design.footerCta')} hint={t('design.footerCtaHint')}>
        <Toggle
          label={t('design.ctaOn')}
          checked={f.cta.enabled}
          onChange={(enabled) => footer({ cta: { ...f.cta, enabled } })}
        />
        {f.cta.enabled ? (
          <>
            <LocalizedField
              label={t('design.title')}
              value={f.cta.title}
              max={80}
              onChange={(title) => footer({ cta: { ...f.cta, title } })}
            />
            <LocalizedField
              label={t('design.text')}
              value={f.cta.text}
              max={200}
              onChange={(text) => footer({ cta: { ...f.cta, text } })}
            />
            <LocalizedField
              label={t('design.button')}
              value={f.cta.button}
              max={30}
              onChange={(button) => footer({ cta: { ...f.cta, button } })}
            />
            <LinkPicker
              label={t('design.link')}
              value={f.cta.link}
              onChange={(link) => footer({ cta: { ...f.cta, link } })}
            />
          </>
        ) : null}
      </Panel>

      <Panel icon="🛡️" title={t('design.footerBadges')} hint={t('design.footerBadgesHint')}>
        <BadgesEditor design={design} set={set} />
      </Panel>

      <Panel icon="🧱" title={t('design.footerBlocks')} hint={t('design.footerBlocksHint')}>
        <BlocksEditor footer={f} onChange={(blocks) => footer({ blocks })} />
      </Panel>

      <Panel icon="💬" title={t('design.social')} hint={t('design.socialHint')}>
        <Choice
          label={t('design.socialStyle')}
          value={f.socialStyle}
          options={opts('socialStyle', ['icons', 'filled', 'labels'] as const)}
          onChange={(socialStyle) => footer({ socialStyle })}
        />
        <SocialFields design={design} set={set} />
      </Panel>

      <Panel icon="📄" title={t('design.footerBottom')} hint={t('design.footerBottomHint')}>
        <Toggle
          label={t('design.showCopyright')}
          checked={f.bottom.showCopyright}
          onChange={(v) => footer({ bottom: { ...f.bottom, showCopyright: v } })}
        />
        {f.bottom.showCopyright ? (
          <LocalizedField
            label={t('design.copyright')}
            value={f.bottom.copyright}
            max={120}
            onChange={(copyright) => footer({ bottom: { ...f.bottom, copyright } })}
          />
        ) : null}
        <p className="text-sm font-medium">{t('design.bottomLinks')}</p>
        <p className="-mt-2 text-xs text-fg-muted">{t('design.bottomLinksHint')}</p>
        <LinksEditor
          links={f.bottom.links}
          max={6}
          onChange={(links) => footer({ bottom: { ...f.bottom, links } })}
        />
        <Toggle
          label={t('design.bottomPayments')}
          checked={f.bottom.showPayments}
          onChange={(v) => footer({ bottom: { ...f.bottom, showPayments: v } })}
        />
        <Toggle
          label={t('design.bottomLanguage')}
          checked={f.bottom.showLanguage}
          onChange={(v) => footer({ bottom: { ...f.bottom, showLanguage: v } })}
        />
        <Toggle
          label={t('design.backToTop')}
          checked={f.bottom.showBackToTop}
          onChange={(v) => footer({ bottom: { ...f.bottom, showBackToTop: v } })}
        />
        <Toggle
          label={t('design.poweredBy')}
          checked={f.showPoweredBy}
          onChange={(v) => footer({ showPoweredBy: v })}
        />
      </Panel>

      <Panel icon="📱" title={t('design.mobile')} hint={t('design.footerMobileHint')}>
        <Toggle
          label={t('design.mobileCollapse')}
          checked={f.mobileCollapse}
          onChange={(mobileCollapse) => footer({ mobileCollapse })}
        />
      </Panel>
    </div>
  );
}
