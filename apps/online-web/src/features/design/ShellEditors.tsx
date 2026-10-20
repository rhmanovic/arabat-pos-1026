import { type DesignTemplate, type StoreDesign, templateDesign } from '@arabat/contracts';
import { Button, cn } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Choice, Group } from './fields.js';

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
      </Group>
    </div>
  );
}
