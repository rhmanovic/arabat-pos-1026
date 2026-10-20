import { WEEKDAYS, type StoreHours, type Weekday } from '@arabat/contracts';
import { Checkbox, Input } from '@arabat/ui';
import { useTranslation } from 'react-i18next';

const DEFAULT_RANGE = { open: '09:00', close: '22:00' };
const everyDay = (): NonNullable<StoreHours> =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, [{ ...DEFAULT_RANGE }]])) as NonNullable<StoreHours>;

/**
 * Opening hours per weekday (ADR-0123): one range a day, or closed. `null` means always
 * open; the "set hours" switch turns it into a week of defaults to edit.
 */
export function HoursEditor({
  value,
  onChange,
  alwaysLabel,
}: {
  value: StoreHours;
  onChange: (next: StoreHours) => void;
  /** What `null` means here ("Always open" for the store, "Store hours" for a branch). */
  alwaysLabel: string;
}) {
  const { t } = useTranslation();
  const setDay = (day: Weekday, ranges: { open: string; close: string }[]) =>
    onChange({ ...(value ?? everyDay()), [day]: ranges });
  return (
    <div className="flex flex-col gap-2">
      <Checkbox
        label={alwaysLabel}
        checked={value === null}
        onChange={(e) => onChange(e.target.checked ? null : everyDay())}
      />
      {value ? (
        <table className="w-full text-sm">
          <tbody>
            {WEEKDAYS.map((day) => {
              const range = value[day][0] ?? null;
              return (
                <tr key={day} className="border-t border-border">
                  <th scope="row" className="py-1 pe-3 text-start font-medium">
                    {t(`hours.${day}`)}
                  </th>
                  <td className="py-1 pe-3">
                    <Checkbox
                      label={t('hours.closed')}
                      checked={range === null}
                      onChange={(e) => setDay(day, e.target.checked ? [] : [{ ...DEFAULT_RANGE }])}
                    />
                  </td>
                  <td className="py-1">
                    {range ? (
                      <span className="flex items-center gap-2" dir="ltr">
                        <Input
                          type="time"
                          aria-label={t('hours.open', { day: t(`hours.${day}`) })}
                          value={range.open}
                          className="w-32"
                          onChange={(e) => setDay(day, [{ ...range, open: e.target.value }])}
                        />
                        <span>–</span>
                        <Input
                          type="time"
                          aria-label={t('hours.close', { day: t(`hours.${day}`) })}
                          value={range.close === '24:00' ? '23:59' : range.close}
                          className="w-32"
                          onChange={(e) => setDay(day, [{ ...range, close: e.target.value }])}
                        />
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
