import {
  COLUMN_BLOCKS,
  COLUMN_LAYOUTS,
  type ColumnBlock,
  type ColumnBlockType,
  type SectionOf,
  columnCount,
} from '@arabat/contracts';
import { Button, Field, Input, cn } from '@arabat/ui';
import { useTranslation } from 'react-i18next';
import {
  Choice,
  Group,
  ImagePicker,
  Items,
  LinkPicker,
  LocalizedField,
  Toggle,
  empty,
  useOpts,
  useVariants,
} from './fields.js';

/*
 * Editors of the layout and motion sections (ADR-0128 amendment 7): divider, columns, split,
 * cards, tabs, ticker, numbers and steps.
 */

type Patch<T> = (patch: Partial<T>) => void;
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Emoji({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Field label={t('design.icon')} hint={t('design.iconHint')}>
      {(p) => (
        <Input
          {...p}
          className="w-24"
          maxLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------- divider
export function DividerEditor({
  s,
  set,
}: {
  s: SectionOf<'divider'>;
  set: Patch<SectionOf<'divider'>>;
}) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants([
          'line',
          'dashed',
          'dotted',
          'double',
          'gradient',
          'dots',
          'wave',
          'zigzag',
        ] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Choice
        label={t('design.thickness')}
        value={s.thickness}
        options={opts('thickness', ['thin', 'regular', 'thick'] as const)}
        onChange={(thickness) => set({ thickness })}
      />
      <Choice
        label={t('design.length')}
        value={s.length}
        options={opts('length', ['short', 'half', 'full'] as const)}
        onChange={(length) => set({ length })}
      />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={opts('align', ['start', 'center', 'end'] as const)}
        onChange={(align) => set({ align })}
      />
      <Choice
        label={t('design.dividerColor')}
        value={s.color}
        options={opts('dividerColor', ['border', 'brand', 'fg'] as const)}
        onChange={(color) => set({ color })}
      />
      <LocalizedField
        label={t('design.dividerLabel')}
        value={s.label}
        max={60}
        onChange={(label) => set({ label })}
      />
      <Emoji value={s.icon} onChange={(icon) => set({ icon })} />
    </div>
  );
}

// ---------------------------------------------------------------------------- columns
const newBlock = (type: ColumnBlockType): ColumnBlock => ({
  id: uid('block'),
  type,
  text: empty(),
  size: 'regular',
  align: 'start',
  imageId: null,
  link: null,
  style: 'solid',
  icon: type === 'icon' ? '✨' : type === 'list' ? '✓' : '',
});

function BlockFields({ b, set }: { b: ColumnBlock; set: (p: Partial<ColumnBlock>) => void }) {
  const { t } = useTranslation();
  const opts = useOpts();
  const textField = (label: string, max: number, multiline = false) => (
    <LocalizedField
      label={label}
      value={b.text}
      max={max}
      multiline={multiline}
      onChange={(text) => set({ text })}
    />
  );
  return (
    <>
      {b.type === 'heading' ? textField(t('design.title'), 120) : null}
      {b.type === 'text' ? textField(t('design.text'), 1000, true) : null}
      {b.type === 'list' ? (
        <>
          {textField(t('design.listLines'), 1000, true)}
          <Emoji value={b.icon} onChange={(icon) => set({ icon })} />
        </>
      ) : null}
      {b.type === 'button' ? (
        <>
          {textField(t('design.button'), 30)}
          <LinkPicker label={t('design.link')} value={b.link} onChange={(link) => set({ link })} />
          <Choice
            label={t('design.buttonStyle')}
            value={b.style}
            options={opts('blockButton', ['solid', 'outline', 'soft', 'link'] as const)}
            onChange={(style) => set({ style })}
          />
        </>
      ) : null}
      {b.type === 'image' ? (
        <>
          <ImagePicker
            label={t('design.image')}
            value={b.imageId}
            onChange={(imageId) => set({ imageId })}
          />
          {textField(t('design.altText'), 120)}
          <LinkPicker label={t('design.link')} value={b.link} onChange={(link) => set({ link })} />
          <Toggle
            label={t('design.roundImage')}
            checked={b.style === 'soft'}
            onChange={(round) => set({ style: round ? 'soft' : 'solid' })}
          />
        </>
      ) : null}
      {b.type === 'icon' ? <Emoji value={b.icon} onChange={(icon) => set({ icon })} /> : null}
      {b.type !== 'divider' ? (
        <Choice
          label={t('design.blockSize')}
          value={b.size}
          options={opts('blockSize', ['small', 'regular', 'large'] as const)}
          onChange={(size) => set({ size })}
        />
      ) : null}
      {b.type !== 'divider' && b.type !== 'spacer' && b.type !== 'image' ? (
        <Choice
          label={t('design.align')}
          value={b.align}
          options={opts('align', ['start', 'center', 'end'] as const)}
          onChange={(align) => set({ align })}
        />
      ) : null}
    </>
  );
}

export function ColumnsEditor({
  s,
  set,
}: {
  s: SectionOf<'columns'>;
  set: Patch<SectionOf<'columns'>>;
}) {
  const { t } = useTranslation();
  const opts = useOpts();
  // The layout decides how many columns there are; extra ones are kept until removed by hand.
  const setLayout = (layout: SectionOf<'columns'>['layout']) => {
    const count = columnCount(layout);
    const columns = [...s.columns];
    while (columns.length < count) columns.push({ id: uid('col'), blocks: [] });
    set({ layout, columns: columns.slice(0, Math.max(count, 1)) });
  };
  const setColumn = (i: number, blocks: ColumnBlock[]) =>
    set({ columns: s.columns.map((c, j) => (j === i ? { ...c, blocks } : c)) });
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(title) => set({ title })}
      />
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('design.columnsLayout')}</p>
        <div
          role="radiogroup"
          aria-label={t('design.columnsLayout')}
          className="grid grid-cols-4 gap-2"
        >
          {COLUMN_LAYOUTS.map((layout) => (
            <button
              key={layout}
              type="button"
              role="radio"
              aria-checked={s.layout === layout}
              aria-label={t(`design.layout_${layout}`)}
              title={t(`design.layout_${layout}`)}
              onClick={() => setLayout(layout)}
              className={cn(
                'flex h-10 gap-1 rounded-lg border p-1.5',
                s.layout === layout
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              {layout.split('-').map((part, i) => (
                <span
                  key={i}
                  className="rounded bg-current opacity-30"
                  style={{ flexGrow: Number(part) }}
                />
              ))}
            </button>
          ))}
        </div>
      </div>
      <Choice
        label={t('design.gap')}
        value={s.gap}
        options={opts('gap', ['none', 'small', 'regular', 'large'] as const)}
        onChange={(gap) => set({ gap })}
      />
      <Choice
        label={t('design.verticalAlign')}
        value={s.verticalAlign}
        options={opts('vAlign', ['top', 'center', 'bottom', 'stretch'] as const)}
        onChange={(verticalAlign) => set({ verticalAlign })}
      />
      <Choice
        label={t('design.columnStyle')}
        value={s.columnStyle}
        options={opts('columnStyle', ['plain', 'card', 'soft', 'outline', 'glass'] as const)}
        onChange={(columnStyle) => set({ columnStyle })}
      />
      <Choice
        label={t('design.onPhones')}
        value={s.phone}
        options={opts('phone', ['stack', 'reverse', 'scroll'] as const)}
        onChange={(phone) => set({ phone })}
      />
      <Toggle
        label={t('design.columnDividers')}
        checked={s.dividers}
        onChange={(dividers) => set({ dividers })}
      />
      {s.columns.slice(0, columnCount(s.layout)).map((column, i) => (
        <Group key={column.id} title={t('design.columnN', { n: i + 1 })}>
          <Items
            items={column.blocks}
            max={10}
            title={(n) => `${n}. ${t(`design.block_${column.blocks[n - 1]!.type}`)}`}
            addLabel=""
            make={() => newBlock('text')}
            onChange={(blocks) => setColumn(i, blocks)}
            render={(b, setBlock) => <BlockFields b={b} set={setBlock} />}
          />
          {column.blocks.length < 10 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-fg-muted">{t('design.addColumnBlock')}</p>
              <div className="flex flex-wrap gap-1.5">
                {COLUMN_BLOCKS.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="secondary"
                    onClick={() => setColumn(i, [...column.blocks, newBlock(type)])}
                  >
                    + {t(`design.block_${type}`)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </Group>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------ split
export function SplitEditor({ s, set }: { s: SectionOf<'split'>; set: Patch<SectionOf<'split'>> }) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <ImagePicker
        label={t('design.image')}
        value={s.imageId}
        onChange={(imageId) => set({ imageId })}
      />
      <Choice
        label={t('design.imagePosition')}
        value={s.imagePosition}
        options={opts('imagePosition', ['start', 'end'] as const)}
        onChange={(imagePosition) => set({ imagePosition })}
      />
      <Choice
        label={t('design.imageShape')}
        value={s.imageShape}
        options={opts('imageShape', ['rect', 'rounded', 'circle', 'arch', 'blob'] as const)}
        onChange={(imageShape) => set({ imageShape })}
      />
      <Choice
        label={t('design.ratio')}
        value={s.ratio}
        options={opts('ratio', ['even', 'image', 'text'] as const)}
        onChange={(ratio) => set({ ratio })}
      />
      <Choice
        label={t('design.verticalAlign')}
        value={s.verticalAlign}
        options={opts('vAlign', ['top', 'center'] as const)}
        onChange={(verticalAlign) => set({ verticalAlign })}
      />
      <LocalizedField
        label={t('design.eyebrow')}
        value={s.eyebrow}
        max={60}
        onChange={(eyebrow) => set({ eyebrow })}
      />
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={120}
        onChange={(title) => set({ title })}
      />
      <LocalizedField
        label={t('design.text')}
        value={s.body}
        max={1500}
        multiline
        onChange={(body) => set({ body })}
      />
      <LocalizedField
        label={t('design.button')}
        value={s.button}
        max={30}
        onChange={(button) => set({ button })}
      />
      <LinkPicker label={t('design.link')} value={s.link} onChange={(link) => set({ link })} />
      <LocalizedField
        label={t('design.button2')}
        value={s.button2}
        max={30}
        onChange={(button2) => set({ button2 })}
      />
      <LinkPicker label={t('design.link2')} value={s.link2} onChange={(link2) => set({ link2 })} />
    </div>
  );
}

// ------------------------------------------------------------------------------ cards
export function CardsEditor({ s, set }: { s: SectionOf<'cards'>; set: Patch<SectionOf<'cards'>> }) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(title) => set({ title })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['bordered', 'shadow', 'plain', 'overlay', 'glass'] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Choice
        label={t('design.columns')}
        value={s.columns}
        options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
        onChange={(columns) => set({ columns })}
      />
      <Choice
        label={t('design.mobileColumns')}
        value={s.mobileColumns}
        options={([1, 2] as const).map((n) => ({ value: n, label: String(n) }))}
        onChange={(mobileColumns) => set({ mobileColumns })}
      />
      <Choice
        label={t('design.pictureShape')}
        value={s.aspect}
        options={opts('pictureShape', ['landscape', 'square', 'portrait'] as const)}
        onChange={(aspect) => set({ aspect })}
      />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={opts('align', ['start', 'center'] as const)}
        onChange={(align) => set({ align })}
      />
      <Choice
        label={t('design.hover')}
        value={s.hover}
        options={opts('hover', ['none', 'lift', 'zoom', 'glow'] as const)}
        onChange={(hover) => set({ hover })}
      />
      <Items
        items={s.items}
        max={12}
        title={(n) => t('design.cardN', { n })}
        addLabel={t('design.addCard')}
        make={() => ({
          id: uid('card'),
          imageId: null,
          icon: '',
          title: empty(),
          text: empty(),
          button: empty(),
          link: null,
        })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <ImagePicker
              label={t('design.image')}
              value={item.imageId}
              onChange={(imageId) => setItem({ imageId })}
            />
            <Emoji value={item.icon} onChange={(icon) => setItem({ icon })} />
            <LocalizedField
              label={t('design.title')}
              value={item.title}
              max={80}
              onChange={(title) => setItem({ title })}
            />
            <LocalizedField
              label={t('design.text')}
              value={item.text}
              max={300}
              multiline
              onChange={(text) => setItem({ text })}
            />
            <LocalizedField
              label={t('design.button')}
              value={item.button}
              max={30}
              onChange={(button) => setItem({ button })}
            />
            <LinkPicker
              label={t('design.link')}
              value={item.link}
              onChange={(link) => setItem({ link })}
            />
          </>
        )}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------- tabs
export function TabsEditor({ s, set }: { s: SectionOf<'tabs'>; set: Patch<SectionOf<'tabs'>> }) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(title) => set({ title })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['pills', 'underline', 'boxed', 'vertical'] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Choice
        label={t('design.align')}
        value={s.align}
        options={opts('align', ['start', 'center'] as const)}
        onChange={(align) => set({ align })}
      />
      <Choice
        label={t('design.imagePosition')}
        value={s.imagePosition}
        options={opts('imagePosition', ['start', 'end', 'top'] as const)}
        onChange={(imagePosition) => set({ imagePosition })}
      />
      <Items
        items={s.tabs}
        max={8}
        title={(n) => t('design.tabN', { n })}
        addLabel={t('design.addTab')}
        make={() => ({
          id: uid('tab'),
          label: empty(),
          title: empty(),
          text: empty(),
          imageId: null,
          button: empty(),
          link: null,
        })}
        onChange={(tabs) => set({ tabs })}
        render={(tab, setTab) => (
          <>
            <LocalizedField
              label={t('design.tabLabel')}
              value={tab.label}
              max={30}
              onChange={(label) => setTab({ label })}
            />
            <LocalizedField
              label={t('design.title')}
              value={tab.title}
              max={80}
              onChange={(title) => setTab({ title })}
            />
            <LocalizedField
              label={t('design.text')}
              value={tab.text}
              max={1000}
              multiline
              onChange={(text) => setTab({ text })}
            />
            <ImagePicker
              label={t('design.image')}
              value={tab.imageId}
              onChange={(imageId) => setTab({ imageId })}
            />
            <LocalizedField
              label={t('design.button')}
              value={tab.button}
              max={30}
              onChange={(button) => setTab({ button })}
            />
            <LinkPicker
              label={t('design.link')}
              value={tab.link}
              onChange={(link) => setTab({ link })}
            />
          </>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------- marquee
export function MarqueeEditor({
  s,
  set,
}: {
  s: SectionOf<'marquee'>;
  set: Patch<SectionOf<'marquee'>>;
}) {
  const { t } = useTranslation();
  const opts = useOpts();
  return (
    <div className="flex flex-col gap-4">
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['brand', 'dark', 'plain', 'outline', 'tilted'] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Choice
        label={t('design.speed')}
        value={s.speed}
        options={opts('speed', ['slow', 'normal', 'fast'] as const)}
        onChange={(speed) => set({ speed })}
      />
      <Choice
        label={t('design.direction')}
        value={s.direction}
        options={opts('direction', ['start', 'end'] as const)}
        onChange={(direction) => set({ direction })}
      />
      <Choice
        label={t('design.textSize')}
        value={s.size}
        options={opts('blockSize', ['small', 'regular', 'large'] as const)}
        onChange={(size) => set({ size })}
      />
      <Field label={t('design.separator')} hint={t('design.iconHint')}>
        {(p) => (
          <Input
            {...p}
            className="w-24"
            maxLength={8}
            value={s.separator}
            onChange={(e) => set({ separator: e.target.value })}
          />
        )}
      </Field>
      <Toggle
        label={t('design.pauseOnHover')}
        checked={s.pauseOnHover}
        onChange={(pauseOnHover) => set({ pauseOnHover })}
      />
      <Items
        items={s.items}
        max={10}
        title={(n) => t('design.itemN', { n })}
        addLabel={t('design.addItem')}
        make={() => ({ id: uid('word'), text: empty() })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <LocalizedField
            label={t('design.text')}
            value={item.text}
            max={80}
            onChange={(text) => setItem({ text })}
          />
        )}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------ stats
export function StatsEditor({ s, set }: { s: SectionOf<'stats'>; set: Patch<SectionOf<'stats'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(title) => set({ title })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['row', 'cards', 'boxed'] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Toggle
        label={t('design.countUp')}
        checked={s.countUp}
        onChange={(countUp) => set({ countUp })}
      />
      <Items
        items={s.items}
        max={6}
        title={(n) => t('design.itemN', { n })}
        addLabel={t('design.addItem')}
        make={() => ({ id: uid('stat'), value: 0, prefix: null, suffix: null, label: empty() })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('design.prefix')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={6}
                    value={item.prefix ?? ''}
                    onChange={(e) => setItem({ prefix: e.target.value || null })}
                  />
                )}
              </Field>
              <Field label={t('design.statValue')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    max={999_999_999}
                    dir="ltr"
                    value={item.value}
                    onChange={(e) =>
                      setItem({
                        value: Math.min(
                          999_999_999,
                          Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        ),
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t('design.suffix')}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={6}
                    value={item.suffix ?? ''}
                    onChange={(e) => setItem({ suffix: e.target.value || null })}
                  />
                )}
              </Field>
            </div>
            <LocalizedField
              label={t('design.statLabel')}
              value={item.label}
              max={60}
              onChange={(label) => setItem({ label })}
            />
          </>
        )}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------ steps
export function StepsEditor({ s, set }: { s: SectionOf<'steps'>; set: Patch<SectionOf<'steps'>> }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <LocalizedField
        label={t('design.title')}
        value={s.title}
        max={80}
        onChange={(title) => set({ title })}
      />
      <Choice
        label={t('design.shape')}
        value={s.variant}
        options={useVariants(['numbers', 'timeline', 'cards'] as const)}
        onChange={(variant) => set({ variant })}
      />
      <Items
        items={s.items}
        max={8}
        title={(n) => t('design.stepN', { n })}
        addLabel={t('design.addStep')}
        make={() => ({ id: uid('step'), icon: '', title: empty(), text: empty() })}
        onChange={(items) => set({ items })}
        render={(item, setItem) => (
          <>
            <Emoji value={item.icon} onChange={(icon) => setItem({ icon })} />
            <LocalizedField
              label={t('design.title')}
              value={item.title}
              max={60}
              onChange={(title) => setItem({ title })}
            />
            <LocalizedField
              label={t('design.text')}
              value={item.text}
              max={240}
              onChange={(text) => setItem({ text })}
            />
          </>
        )}
      />
    </div>
  );
}
