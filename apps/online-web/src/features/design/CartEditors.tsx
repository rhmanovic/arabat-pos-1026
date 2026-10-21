import {
  CART_PRESETS,
  type CartPageDesign,
  type CartPreset,
  type CheckoutPageDesign,
  type StoreDesign,
  cartPreset,
  suggestedHighlights,
} from '@arabat/contracts';
import { Button, Field, Select, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Choice, LinkPicker, LocalizedField, Panel, Toggle } from './fields.js';
import { HighlightsField } from './ProductPageEditor.js';

/*
 * The cart and checkout pages of the store design (ADR-0128 amendment 5): ready pages (both
 * set together), recommendations and every setting. Prices, fees and offers are never designed:
 * they come from the server.
 */

type Set = (next: StoreDesign) => void;

const PRESET_ICON: Record<CartPreset, string> = {
  classic: '🛍️',
  express: '⚡',
  food: '🍔',
  minimal: '➖',
};

const secureHighlights = () => [
  {
    id: 'secure',
    icon: '🔒',
    title: { en: 'Secure checkout', ar: 'دفع آمن' },
    text: { en: 'Your details stay private', ar: 'بياناتك محمية' },
  },
];

function Presets({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const [applied, setApplied] = useState<CartPreset | null>(null);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {CART_PRESETS.map((p) => (
          <li
            key={p}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
          >
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-muted text-2xl"
            >
              {PRESET_ICON[p]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{t(`cartDesign.preset_${p}`)}</span>
              <span className="block text-xs text-fg-muted">{t(`cartDesign.presetHint_${p}`)}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('design.applyPreset', { name: t(`cartDesign.preset_${p}`) })}
              onClick={() => {
                set({ ...design, ...cartPreset(p) });
                setApplied(p);
              }}
            >
              {t('design.applyTemplate')}
            </Button>
          </li>
        ))}
      </ul>
      {applied ? (
        <p className="text-xs text-success" role="status">
          {t('productDesign.presetApplied', { name: t(`cartDesign.preset_${applied}`) })}
        </p>
      ) : null}
    </>
  );
}

type Tip = { key: string; done: boolean; fix?: () => void };

function Tips({ tips, testId }: { tips: Tip[]; testId: string }) {
  const { t } = useTranslation();
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
        <span className="text-xs font-semibold text-fg-muted" data-testid={testId}>
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
              <span className="block font-semibold">{t(`cartDesign.tip_${tip.key}`)}</span>
              <span className="block text-xs text-fg-muted">
                {t(`cartDesign.tipHint_${tip.key}`)}
              </span>
            </span>
            {!tip.done && tip.fix ? (
              <Button size="sm" variant="secondary" onClick={tip.fix}>
                {t('cartDesign.tipFix')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------- cart
export function CartPageEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const c = design.cartPage;
  const update = (patch: Partial<CartPageDesign>) =>
    set({ ...design, cartPage: { ...c, ...patch } });
  const upsell = (patch: Partial<CartPageDesign['upsell']>) =>
    update({ upsell: { ...c.upsell, ...patch } });
  const empty = (patch: Partial<CartPageDesign['empty']>) =>
    update({ empty: { ...c.empty, ...patch } });
  const kind = design.template === 'restaurant' ? 'food' : 'shop';
  const tips: Tip[] = [
    {
      key: 'cartHighlights',
      done: c.highlights.length > 0,
      fix: () => update({ highlights: suggestedHighlights(kind) }),
    },
    { key: 'upsell', done: c.upsell.enabled, fix: () => upsell({ enabled: true }) },
    { key: 'sticky', done: c.stickyCheckout, fix: () => update({ stickyCheckout: true }) },
    { key: 'minimum', done: c.minimumBar, fix: () => update({ minimumBar: true }) },
    {
      key: 'emptyProducts',
      done: c.empty.showProducts,
      fix: () => empty({ showProducts: true }),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Panel
        icon="🪄"
        title={t('cartDesign.presets')}
        hint={t('cartDesign.presetsHint')}
        defaultOpen={false}
      >
        <Presets design={design} set={set} />
      </Panel>
      <Panel icon="💡" title={t('productDesign.tips')} hint={t('cartDesign.tipsHint')}>
        <Tips tips={tips} testId="cart-page-score" />
      </Panel>
      <Panel icon="🧩" title={t('cartDesign.look')} hint={t('cartDesign.lookHint')}>
        <Choice
          label={t('cartDesign.layout')}
          value={c.layout}
          options={[
            { value: 'split' as const, label: t('cartDesign.layout_split') },
            { value: 'stacked' as const, label: t('cartDesign.layout_stacked') },
          ]}
          onChange={(layout) => update({ layout })}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            label={t('cartDesign.images')}
            checked={c.images}
            onChange={(images) => update({ images })}
          />
          <Toggle
            label={t('cartDesign.minimumBar')}
            checked={c.minimumBar}
            onChange={(minimumBar) => update({ minimumBar })}
          />
          <Toggle
            label={t('cartDesign.stickyCheckout')}
            checked={c.stickyCheckout}
            onChange={(stickyCheckout) => update({ stickyCheckout })}
          />
          <Toggle
            label={t('cartDesign.continueShopping')}
            checked={c.continueShopping}
            onChange={(continueShopping) => update({ continueShopping })}
          />
        </div>
        <LocalizedField
          label={t('cartDesign.message')}
          value={c.message}
          max={200}
          onChange={(message) => update({ message })}
        />
        <LocalizedField
          label={t('cartDesign.checkoutLabel')}
          value={c.checkoutLabel}
          max={30}
          onChange={(checkoutLabel) => update({ checkoutLabel })}
        />
        <p className="-mt-2 text-xs text-fg-muted">{t('cartDesign.checkoutLabelHint')}</p>
      </Panel>
      <Panel
        icon="✅"
        title={t('productDesign.highlights')}
        hint={t('cartDesign.highlightsHint')}
        defaultOpen={false}
      >
        <HighlightsField
          items={c.highlights}
          suggested={() => suggestedHighlights(kind)}
          onChange={(highlights) => update({ highlights })}
        />
      </Panel>
      <Panel
        icon="🛍️"
        title={t('cartDesign.upsell')}
        hint={t('cartDesign.upsellHint')}
        defaultOpen={false}
      >
        <Toggle
          label={t('cartDesign.upsellOn')}
          checked={c.upsell.enabled}
          onChange={(enabled) => upsell({ enabled })}
        />
        {c.upsell.enabled ? (
          <>
            <LocalizedField
              label={t('design.title')}
              value={c.upsell.title}
              max={80}
              onChange={(title) => upsell({ title })}
            />
            <Choice
              label={t('productDesign.relatedSource')}
              value={c.upsell.source}
              options={[
                { value: 'featured' as const, label: t('productDesign.relatedSource_featured') },
                { value: 'all' as const, label: t('productDesign.relatedSource_all') },
              ]}
              onChange={(source) => upsell({ source })}
            />
            <Choice
              label={t('productDesign.relatedVariant')}
              value={c.upsell.variant}
              options={[
                { value: 'carousel' as const, label: t('design.variant_carousel') },
                { value: 'grid' as const, label: t('design.variant_grid') },
              ]}
              onChange={(variant) => upsell({ variant })}
            />
            <Field label={t('productDesign.relatedLimit')}>
              {(props) => (
                <Select
                  {...props}
                  value={String(c.upsell.limit)}
                  onChange={(e) => upsell({ limit: Number(e.target.value) })}
                >
                  {[2, 3, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}
      </Panel>
      <Panel
        icon="🫙"
        title={t('cartDesign.empty')}
        hint={t('cartDesign.emptyHint')}
        defaultOpen={false}
      >
        <LocalizedField
          label={t('design.title')}
          value={c.empty.title}
          max={80}
          onChange={(title) => empty({ title })}
        />
        <LocalizedField
          label={t('design.text')}
          value={c.empty.text}
          max={200}
          multiline
          onChange={(text) => empty({ text })}
        />
        <Toggle
          label={t('cartDesign.emptyProducts')}
          checked={c.empty.showProducts}
          onChange={(showProducts) => empty({ showProducts })}
        />
      </Panel>
    </div>
  );
}

// --------------------------------------------------------------------- checkout
export function CheckoutPageEditor({ design, set }: { design: StoreDesign; set: Set }) {
  const { t } = useTranslation();
  const k = design.checkoutPage;
  const update = (patch: Partial<CheckoutPageDesign>) =>
    set({ ...design, checkoutPage: { ...k, ...patch } });
  const tips: Tip[] = [
    { key: 'steps', done: k.steps, fix: () => update({ steps: true }) },
    { key: 'cards', done: k.choices === 'cards', fix: () => update({ choices: 'cards' }) },
    {
      key: 'checkoutHighlights',
      done: k.highlights.length > 0,
      fix: () => update({ highlights: secureHighlights() }),
    },
    { key: 'email', done: k.email !== 'required', fix: () => update({ email: 'optional' }) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Panel
        icon="🪄"
        title={t('cartDesign.presets')}
        hint={t('cartDesign.presetsHint')}
        defaultOpen={false}
      >
        <Presets design={design} set={set} />
      </Panel>
      <Panel icon="💡" title={t('productDesign.tips')} hint={t('cartDesign.checkoutTipsHint')}>
        <Tips tips={tips} testId="checkout-page-score" />
      </Panel>
      <Panel icon="🧩" title={t('cartDesign.look')} hint={t('cartDesign.checkoutLookHint')}>
        <Choice
          label={t('cartDesign.layout')}
          value={k.layout}
          options={[
            { value: 'split' as const, label: t('cartDesign.checkoutLayout_split') },
            { value: 'stacked' as const, label: t('cartDesign.checkoutLayout_stacked') },
          ]}
          onChange={(layout) => update({ layout })}
        />
        <Choice
          label={t('cartDesign.choices')}
          value={k.choices}
          options={[
            { value: 'cards' as const, label: t('cartDesign.choices_cards') },
            { value: 'list' as const, label: t('cartDesign.choices_list') },
          ]}
          onChange={(choices) => update({ choices })}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle
            label={t('cartDesign.steps')}
            checked={k.steps}
            onChange={(steps) => update({ steps })}
          />
          <Toggle
            label={t('cartDesign.summaryImages')}
            checked={k.images}
            onChange={(images) => update({ images })}
          />
        </div>
        <LocalizedField
          label={t('cartDesign.message')}
          value={k.message}
          max={200}
          onChange={(message) => update({ message })}
        />
        <LocalizedField
          label={t('cartDesign.submitLabel')}
          value={k.submitLabel}
          max={30}
          onChange={(submitLabel) => update({ submitLabel })}
        />
        <p className="-mt-2 text-xs text-fg-muted">{t('cartDesign.submitLabelHint')}</p>
      </Panel>
      <Panel
        icon="📝"
        title={t('cartDesign.fields')}
        hint={t('cartDesign.fieldsHint')}
        defaultOpen={false}
      >
        <Choice
          label={t('cartDesign.email')}
          value={k.email}
          options={[
            { value: 'optional' as const, label: t('cartDesign.email_optional') },
            { value: 'required' as const, label: t('cartDesign.email_required') },
            { value: 'hidden' as const, label: t('cartDesign.email_hidden') },
          ]}
          onChange={(email) => update({ email })}
        />
        <Toggle
          label={t('cartDesign.noteOn')}
          checked={k.note.enabled}
          onChange={(enabled) => update({ note: { ...k.note, enabled } })}
        />
        {k.note.enabled ? (
          <LocalizedField
            label={t('cartDesign.noteLabel')}
            value={k.note.label}
            max={60}
            onChange={(label) => update({ note: { ...k.note, label } })}
          />
        ) : null}
        <Toggle
          label={t('cartDesign.promo')}
          checked={k.promo}
          onChange={(promo) => update({ promo })}
        />
        <p className="-mt-2 text-xs text-fg-muted">{t('cartDesign.promoHint')}</p>
      </Panel>
      <Panel
        icon="📜"
        title={t('cartDesign.terms')}
        hint={t('cartDesign.termsHint')}
        defaultOpen={false}
      >
        <Toggle
          label={t('cartDesign.termsOn')}
          checked={k.terms.enabled}
          onChange={(enabled) => update({ terms: { ...k.terms, enabled } })}
        />
        {k.terms.enabled ? (
          <>
            <LocalizedField
              label={t('cartDesign.termsText')}
              value={k.terms.text}
              max={200}
              onChange={(text) => update({ terms: { ...k.terms, text } })}
            />
            <LinkPicker
              label={t('cartDesign.termsLink')}
              value={k.terms.link}
              onChange={(link) => update({ terms: { ...k.terms, link } })}
            />
          </>
        ) : null}
      </Panel>
      <Panel
        icon="✅"
        title={t('productDesign.highlights')}
        hint={t('cartDesign.checkoutHighlightsHint')}
        defaultOpen={false}
      >
        <HighlightsField
          items={k.highlights}
          suggested={secureHighlights}
          onChange={(highlights) => update({ highlights })}
        />
      </Panel>
    </div>
  );
}
