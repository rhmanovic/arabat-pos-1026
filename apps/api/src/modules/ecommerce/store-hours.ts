import { WEEKDAYS, type StoreHours, type Weekday } from '@arabat/contracts';
import { addDays, localDayStart, todayIn } from '../../kernel/time/period.js';

/** How many days ahead a shopper may schedule an order (ADR-0123). */
export const SCHEDULE_DAYS = 7;

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return h! * 60 + m!;
};

/** The weekday of a local calendar day (YYYY-MM-DD). */
export function weekdayOf(date: string): Weekday {
  // 0 = Sunday in JavaScript; the week here starts on Monday.
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(js + 6) % 7]!;
}

/** The minute of the local day (0–1439) of `now` in `tz`. */
function localMinute(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get('hour') * 60 + get('minute');
}

/** Whether the hours allow an order placed right now; null hours = always open. */
export function isOpenAt(hours: StoreHours, tz: string, now: Date): boolean {
  if (!hours) return true;
  const today = todayIn(tz, now);
  const minute = localMinute(tz, now);
  return hours[weekdayOf(today)].some(
    (r) => minute >= minutesOf(r.open) && minute < minutesOf(r.close),
  );
}

export type Slot = { start: Date; end: Date };

/**
 * The time slots of the next `days` local days: each opening range cut into `slotMinutes`
 * pieces; slots starting before `now + preparationMinutes` are gone. Without hours the store
 * is open around the clock.
 */
export function slotsFrom(
  hours: StoreHours,
  tz: string,
  options: { slotMinutes: number; preparationMinutes: number; now: Date; days?: number },
): Slot[] {
  const out: Slot[] = [];
  const earliest = options.now.getTime() + options.preparationMinutes * 60_000;
  const first = todayIn(tz, options.now);
  for (let d = 0; d < (options.days ?? SCHEDULE_DAYS); d++) {
    const date = addDays(first, d);
    const dayStart = localDayStart(tz, date).getTime();
    const ranges = hours ? hours[weekdayOf(date)] : [{ open: '00:00', close: '24:00' }];
    for (const range of ranges) {
      const open = range.open === '24:00' ? 1440 : minutesOf(range.open);
      const close = range.close === '24:00' ? 1440 : minutesOf(range.close);
      for (let m = open; m + options.slotMinutes <= close; m += options.slotMinutes) {
        const start = dayStart + m * 60_000;
        if (start < earliest) continue;
        out.push({ start: new Date(start), end: new Date(start + options.slotMinutes * 60_000) });
      }
    }
  }
  return out;
}
