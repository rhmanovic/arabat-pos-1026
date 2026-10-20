import {
  type DesignTemplate,
  type FooterBlock,
  type StoreDesign,
  templateDesign,
} from '@arabat/contracts';
import { Button, Field, Input, Select, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Choice, Group, LinkPicker, LocalizedField, Toggle } from './fields.js';
import { newId } from './SectionEditor.js';

type Set = (next: StoreDesign) => void;

// ------------------------------------------------------------------- template + style
export function ThemeEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<DesignTemplate | null>(null);
  const style = (p: Partial<StoreDesign['style']>) =>
    set({ ...design, style: { ...design.style, ...p } });
  return (
    <div className="flex flex-col gap-5">
      <Group title={t('design.template')}>
        <p className="text-sm text-fg-muted">{t('design.templateHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['retail', 'restaurant'] as const).map((tpl) => (
            <div
              key={tpl}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-4',
                design.template === tpl ? 'border-primary bg-primary-soft' : 'border-border',
              )}
            >
              <p className="text-2xl" aria-hidden>
                {tpl === 'retail' ? '🛍️' : '🍽️'}
              </p>
              <p className="font-bold">{t(`design.template_${tpl}`)}</p>
              <p className="text-xs text-fg-muted">{t(`design.template_${tpl}Hint`)}</p>
              {confirm === tpl ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      // Keeps the merchant's social accounts; replaces layout and sections.
                      set({ ...templateDesign(tpl), social: design.social });
                      setConfirm(null);
                    }}
                  >
                    {t('design.applyConfirm')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-fit"
                  onClick={() => setConfirm(tpl)}
                >
                  {t('design.applyTemplate')}
                </Button>
              )}
            </div>
          ))}
        </div>
        {confirm ? <p className="text-xs text-warning">{t('design.applyWarning')}</p> : null}
      </Group>
      <Group title={t('design.style')}>
        <p className="text-sm text-fg-muted">
          {t('design.colorHint')}{' '}
          <Link to="/settings" className="text-primary hover:underline">
            {t('nav.settings')}
          </Link>
        </p>
        <Choice
          label={t('design.radius')}
          value={design.style.radius}
          options={(['sharp', 'soft', 'round'] as const).map((v) => ({
            value: v,
            label: t(`design.radius_${v}`),
          }))}
          onChange={(v) => style({ radius: v })}
        />
        <Choice
          label={t('design.background')}
          value={design.style.background}
          options={(['white', 'tinted', 'dark'] as const).map((v) => ({
            value: v,
            label: t(`design.background_${v}`),
          }))}
          onChange={(v) => style({ background: v })}
        />
        <Choice
          label={t('design.cards')}
          value={design.style.cards}
          options={(['bordered', 'shadow', 'flat'] as const).map((v) => ({
            value: v,
            label: t(`design.cards_${v}`),
          }))}
          onChange={(v) => style({ cards: v })}
        />
        <Choice
          label={t('design.buttons')}
          value={design.style.buttons}
          options={(['solid', 'pill'] as const).map((v) => ({
            value: v,
            label: t(`design.buttons_${v}`),
          }))}
          onChange={(v) => style({ buttons: v })}
        />
        <Choice
          label={t('design.announcement')}
          value={design.announcement.style}
          options={(['brand', 'dark', 'soft'] as const).map((v) => ({
            value: v,
            label: t(`design.announcement_${v}`),
          }))}
          onChange={(v) => set({ ...design, announcement: { style: v } })}
        />
      </Group>
    </div>
  );
}

// --------------------------------------------------------------------- header + nav
export function HeaderEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const header = (p: Partial<StoreDesign['header']>) =>
    set({ ...design, header: { ...design.header, ...p } });
  const navbar = (p: Partial<StoreDesign['navbar']>) =>
    set({ ...design, navbar: { ...design.navbar, ...p } });
  const drawer = (p: Partial<StoreDesign['drawer']>) =>
    set({ ...design, drawer: { ...design.drawer, ...p } });
  const items = design.navbar.items;
  const setItem = (i: number, p: Partial<(typeof items)[number]>) =>
    navbar({ items: items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    navbar({ items: next });
  };
  return (
    <div className="flex flex-col gap-5">
      <Group title={t('design.header')}>
        <Choice
          label={t('design.headerLayout')}
          value={design.header.layout}
          options={(['classic', 'centered', 'minimal'] as const).map((v) => ({
            value: v,
            label: t(`design.layout_${v}`),
          }))}
          onChange={(v) => header({ layout: v })}
        />
        <Choice
          label={t('design.headerBackground')}
          value={design.header.background}
          options={(['light', 'brand', 'dark'] as const).map((v) => ({
            value: v,
            label: t(`design.headerBg_${v}`),
          }))}
          onChange={(v) => header({ background: v })}
        />
        <Toggle
          label={t('design.sticky')}
          checked={design.header.sticky}
          onChange={(v) => header({ sticky: v })}
        />
        <Toggle
          label={t('design.showTagline')}
          checked={design.header.showTagline}
          onChange={(v) => header({ showTagline: v })}
        />
        <Toggle
          label={t('design.showSearchIcon')}
          checked={design.header.showSearch}
          onChange={(v) => header({ showSearch: v })}
        />
      </Group>
      <Group title={t('design.navbar')}>
        <Choice
          label={t('design.navbarStyle')}
          value={design.navbar.style}
          options={(['links', 'underline', 'pills', 'hidden'] as const).map((v) => ({
            value: v,
            label: t(`design.nav_${v}`),
          }))}
          onChange={(v) => navbar({ style: v })}
        />
        <p className="text-sm text-fg-muted">
          {items.length === 0 ? t('design.navDefault') : t('design.navItems')}
        </p>
        {items.map((item, i) => (
          <div key={item.id} className="flex flex-col gap-3 rounded-lg bg-surface-muted p-3">
            <LocalizedField
              label={t('design.label')}
              value={item.label}
              max={30}
              onChange={(v) => setItem(i, { label: v })}
            />
            <LinkPicker
              label={t('design.link')}
              value={item.link}
              optional={false}
              onChange={(v) => v && setItem(i, { link: v })}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>
                {t('design.moveUp')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                {t('design.moveDown')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navbar({ items: items.filter((_, j) => j !== i) })}
              >
                {t('design.remove')}
              </Button>
            </div>
          </div>
        ))}
        {items.length < 8 ? (
          <Button
            variant="secondary"
            className="w-fit"
            onClick={() =>
              navbar({
                items: [
                  ...items,
                  {
                    id: newId('nav'),
                    label: { en: null, ar: null },
                    link: { kind: 'page', page: 'products' },
                  },
                ],
              })
            }
          >
            {t('design.addNavItem')}
          </Button>
        ) : null}
      </Group>
      <Group title={t('design.drawer')}>
        <p className="text-sm text-fg-muted">{t('design.drawerHint')}</p>
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
      </Group>
      <Group title={t('design.mobileBar')}>
        <Toggle
          label={t('design.mobileBarOn')}
          checked={design.mobileBar.enabled}
          onChange={(v) => set({ ...design, mobileBar: { enabled: v } })}
        />
      </Group>
      <SocialEditor design={design} set={set} />
    </div>
  );
}

function SocialEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const keys = ['instagram', 'tiktok', 'snapchat', 'x', 'youtube', 'whatsapp'] as const;
  return (
    <Group title={t('design.social')}>
      <p className="text-sm text-fg-muted">{t('design.socialHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((k) => (
          <Field key={k} label={t(`design.social_${k}`)}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                placeholder={k === 'whatsapp' ? '+96550000000' : 'username'}
                value={design.social[k]}
                onChange={(e) =>
                  set({
                    ...design,
                    social: { ...design.social, [k]: e.target.value.replace(/^@/, '').trim() },
                  })
                }
              />
            )}
          </Field>
        ))}
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------------------- footer
const BLOCK_TYPES = [
  'about',
  'links',
  'categories',
  'contact',
  'hours',
  'social',
  'payments',
] as const;

export function FooterEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<FooterBlock['type']>('links');
  const footer = (p: Partial<StoreDesign['footer']>) =>
    set({ ...design, footer: { ...design.footer, ...p } });
  const blocks = design.footer.blocks;
  const setBlock = (i: number, p: Partial<FooterBlock>) =>
    footer({ blocks: blocks.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...blocks];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    footer({ blocks: next });
  };
  return (
    <div className="flex flex-col gap-5">
      <Group title={t('design.footer')}>
        <Choice
          label={t('design.footerStyle')}
          value={design.footer.style}
          options={(['simple', 'columns', 'centered', 'dark'] as const).map((v) => ({
            value: v,
            label: t(`design.footer_${v}`),
          }))}
          onChange={(v) => footer({ style: v })}
        />
        <Toggle
          label={t('design.poweredBy')}
          checked={design.footer.showPoweredBy}
          onChange={(v) => footer({ showPoweredBy: v })}
        />
      </Group>
      {blocks.map((block, i) => (
        <Group key={block.id} title={`${i + 1}. ${t(`design.block_${block.type}`)}`}>
          <LocalizedField
            label={t('design.title')}
            value={block.title}
            max={40}
            onChange={(v) => setBlock(i, { title: v })}
          />
          {block.type === 'about' ? (
            <LocalizedField
              label={t('design.text')}
              value={block.text}
              max={400}
              multiline
              onChange={(v) => setBlock(i, { text: v })}
            />
          ) : null}
          {block.type === 'links' ? (
            <div className="flex flex-col gap-3">
              {block.links.map((l, li) => (
                <div key={l.id} className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3">
                  <LocalizedField
                    label={t('design.label')}
                    value={l.label}
                    max={30}
                    onChange={(v) =>
                      setBlock(i, {
                        links: block.links.map((x, j) => (j === li ? { ...x, label: v } : x)),
                      })
                    }
                  />
                  <LinkPicker
                    label={t('design.link')}
                    value={l.link}
                    optional={false}
                    onChange={(v) =>
                      v &&
                      setBlock(i, {
                        links: block.links.map((x, j) => (j === li ? { ...x, link: v } : x)),
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-fit"
                    onClick={() => setBlock(i, { links: block.links.filter((_, j) => j !== li) })}
                  >
                    {t('design.remove')}
                  </Button>
                </div>
              ))}
              {block.links.length < 8 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-fit"
                  onClick={() =>
                    setBlock(i, {
                      links: [
                        ...block.links,
                        {
                          id: newId('link'),
                          label: { en: null, ar: null },
                          link: { kind: 'page', page: 'products' },
                        },
                      ],
                    })
                  }
                >
                  {t('design.addLink')}
                </Button>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-fg-muted">{t(`design.block_${block.type}Hint`)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>
              {t('design.moveUp')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={i === blocks.length - 1}
              onClick={() => move(i, 1)}
            >
              {t('design.moveDown')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => footer({ blocks: blocks.filter((_, j) => j !== i) })}
            >
              {t('design.remove')}
            </Button>
          </div>
        </Group>
      ))}
      {blocks.length < 6 ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('design.blockType')}>
            {(p) => (
              <Select
                {...p}
                value={adding}
                onChange={(e) => setAdding(e.target.value as FooterBlock['type'])}
              >
                {BLOCK_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {t(`design.block_${b}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="secondary"
            onClick={() =>
              footer({
                blocks: [
                  ...blocks,
                  {
                    id: newId(adding),
                    type: adding,
                    title: { en: null, ar: null },
                    text: { en: null, ar: null },
                    links: [],
                  },
                ],
              })
            }
          >
            {t('design.addBlock')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
