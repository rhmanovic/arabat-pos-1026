import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../errors/app-error.js';

/**
 * One cut-off rule (BR-184, remediation R4.1): every list, statement and report cuts its
 * periods on the merchant's local calendar days, computed from the merchant's single time
 * zone. Nothing uses the server clock's zone or the branch time zone.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kuwait';

/** True when `zone` is an IANA name this runtime knows. */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function assertTimezone(zone: string): string {
  if (!isValidTimezone(zone))
    throw new AppError(400, 'VALIDATION_FAILED', 'Unknown time zone.', [
      { path: 'timezone', code: 'invalid', message: 'Not a known IANA time zone.' },
    ]);
  return zone;
}

interface Executor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/** The merchant's time zone inside a merchant transaction (RLS limits the row). */
export async function merchantTimezone(tx: Executor, merchantId: string): Promise<string> {
  const [m] = (await tx.execute(sql`select timezone from merchants where id = ${merchantId}`))
    .rows as { timezone: string }[];
  return m?.timezone ?? DEFAULT_TIMEZONE;
}

/** Start of the local day `date` (YYYY-MM-DD) as a timestamptz expression. */
export function dayStart(tz: string, date: string): SQL {
  return sql`((${date}::date)::timestamp at time zone ${tz})`;
}

/** Start of the day after the local day `date`, i.e. the exclusive end of that day. */
export function dayEnd(tz: string, date: string): SQL {
  return sql`((${date}::date + 1)::timestamp at time zone ${tz})`;
}

/**
 * `column` within the local days [from, to]; either bound may be omitted. Always true when
 * both are omitted, so it can be and-ed into any where clause.
 */
export function withinLocalDays(tz: string, column: SQL, from?: string, to?: string): SQL {
  const parts: SQL[] = [];
  if (from) parts.push(sql`${column} >= ${dayStart(tz, from)}`);
  if (to) parts.push(sql`${column} < ${dayEnd(tz, to)}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/** The local calendar day of `column` as 'YYYY-MM-DD'. */
export function localDay(tz: string, column: SQL): SQL {
  return sql`to_char((${column} at time zone ${tz})::date, 'YYYY-MM-DD')`;
}

/** Today's date (YYYY-MM-DD) in `tz`, from the given instant. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The instant at which the local day `date` starts in `tz` (JavaScript side of `dayStart`).
 * Resolved by probing the zone offset at that wall-clock time; exact for every zone whose
 * offset is a whole minute, which IANA zones are.
 */
export function localDayStart(tz: string, date: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return asUtc - instant;
  };
  // Two passes handle a DST transition at the probe.
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return new Date(instant);
}

/** `date` (YYYY-MM-DD) shifted by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
