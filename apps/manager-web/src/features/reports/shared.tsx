import type { ReportExport, ReportQuery } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Alert, Button, DataTable, Section, Spinner, StatCard } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '../catalog/ProductsPage.js';

/**
 * Which report (and period) the tables on screen belong to, so a CSV export can be written
 * to the audit log (BR-187). Provided by the reports page around the active tab.
 */
export const ReportExportContext = createContext<Omit<ReportExport, 'section' | 'rows'> | null>(
  null,
);

export type MoneyValue = { amount: string; currency: string };
export const minorOf = (m: MoneyValue) => Money.parse(m.amount, 'KWD').minor;

// ------------------------------------------------------------ CSV
/** One CSV cell: quoted when needed; formula-like text is neutralised (CSV injection). */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v))) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(headers: string[], rows: string[][]): string {
  // BOM so spreadsheet apps read Arabic text as UTF-8.
  return `\uFEFF${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------ tables
export interface ReportColumn<T> {
  key: string;
  header: string;
  /** The exported value; also what is displayed unless `money` or `display` is set. */
  value: (row: T) => string;
  /** The value is a KWD decimal: shown formatted, exported as the plain decimal. */
  money?: boolean;
  display?: (row: T) => ReactNode;
  hideBelow?: 'sm' | 'md' | 'lg';
}

/** Report table whose CSV export is built from exactly the same values it displays. */
export function ReportTable<T>({
  title,
  filename,
  columns,
  rows,
  rowKey,
  loading,
  empty,
  description,
}: {
  title: string;
  filename: string;
  columns: ReportColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: string;
  description?: string;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const exportScope = useContext(ReportExportContext);
  const exportCsv = () => {
    downloadText(
      `${filename}.csv`,
      toCsv(
        columns.map((c) => (c.money ? `${c.header} (KWD)` : c.header)),
        (rows ?? []).map((r) => columns.map((c) => c.value(r))),
      ),
    );
    // The export happened in the browser; the server only records that it did (BR-187).
    if (exportScope)
      void api.reports
        .logExport({
          ...exportScope,
          section: filename.replace(/-\d{4}-\d{2}-\d{2}.*$/, ''),
          rows: rows?.length ?? 0,
        })
        .catch(() => undefined);
  };
  return (
    <Section
      title={title}
      description={description}
      actions={
        <Button size="sm" variant="secondary" disabled={!rows?.length} onClick={exportCsv}>
          {t('reports.exportCsv')}
        </Button>
      }
    >
      <DataTable<T>
        caption={title}
        loading={loading}
        rows={rows}
        rowKey={rowKey}
        empty={empty ?? t('reports.noData')}
        columns={columns.map((c) => ({
          key: c.key,
          header: c.header,
          hideBelow: c.hideBelow,
          cell: (r: T) =>
            c.display ? (
              c.display(r)
            ) : c.money ? (
              <span dir="ltr" className="tabular-nums">
                {formatAmount({ amount: c.value(r), currency: 'KWD' }, i18n.language)}
              </span>
            ) : (
              c.value(r)
            ),
        }))}
      />
    </Section>
  );
}

// ------------------------------------------------------------ KPIs
/** Percentage change (one decimal, half-up) or null when there is no previous value. */
export function change(current: bigint, previous: bigint): string | null {
  if (previous === 0n) return null;
  const diff = (current - previous) * 1000n;
  const abs = diff < 0n ? -diff : diff;
  const p = previous < 0n ? -previous : previous;
  const tenths = (2n * abs + p) / (2n * p);
  return `${diff < 0n ? '-' : '+'}${tenths / 10n}.${tenths % 10n}`;
}

export function Kpi({
  label,
  value,
  current,
  previous,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  current?: bigint;
  previous?: bigint;
  hint?: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const delta =
    current !== undefined && previous !== undefined ? change(current, previous) : undefined;
  return (
    <div data-testid={testId}>
      <StatCard
        label={label}
        value={value}
        hint={
          delta === undefined ? (
            hint
          ) : delta === null ? (
            t('reports.noPrevious')
          ) : (
            <span className={delta.startsWith('-') ? 'text-danger' : 'text-success'} dir="ltr">
              {delta}% {t('reports.vsPrevious')}
            </span>
          )
        }
      />
    </div>
  );
}

export function Amount({ value }: { value: MoneyValue | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

// ------------------------------------------------------------ charts
export interface ChartPoint {
  key: string;
  label: string;
  value: bigint;
  secondary?: bigint;
}

/**
 * Accessible SVG bar chart: each bar is focusable and announces its value; hovering or
 * focusing shows the exact amounts. Time runs left to right in both languages.
 */
export function BarChart({
  title,
  points,
  format,
  primaryLabel,
  secondaryLabel,
}: {
  title: string;
  points: ChartPoint[];
  format: (v: bigint) => string;
  primaryLabel: string;
  secondaryLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = points.reduce((m, p) => {
    const v = p.value > (p.secondary ?? 0n) ? p.value : (p.secondary ?? 0n);
    return v > m ? v : m;
  }, 0n);
  const W = 600;
  const H = 180;
  const slot = points.length ? W / points.length : W;
  const bar = Math.max(2, Math.min(28, slot * (secondaryLabel ? 0.38 : 0.7)));
  const height = (v: bigint) =>
    (max > 0n && v > 0n ? Number((v * 1000n) / max) / 1000 : 0) * (H - 10);
  const current = active === null ? null : points[active];
  return (
    <Section title={title}>
      <p className="mb-2 min-h-5 text-sm" aria-live="polite" data-testid="chart-tooltip">
        {current ? (
          <>
            <span className="font-medium">{current.label}</span> · {primaryLabel}:{' '}
            <span dir="ltr">{format(current.value)}</span>
            {secondaryLabel && current.secondary !== undefined ? (
              <>
                {' '}
                · {secondaryLabel}: <span dir="ltr">{format(current.secondary)}</span>
              </>
            ) : null}
          </>
        ) : null}
      </p>
      <div dir="ltr">
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="h-52 w-full" role="group" aria-label={title}>
          <line x1="0" y1={H} x2={W} y2={H} className="stroke-border" />
          {points.map((p, i) => {
            const x = i * slot + (slot - (secondaryLabel ? bar * 2 + 2 : bar)) / 2;
            const h1 = height(p.value);
            const h2 = height(p.secondary ?? 0n);
            return (
              <g
                key={p.key}
                tabIndex={0}
                role="img"
                aria-label={`${p.label}: ${format(p.value)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onBlur={() => setActive(null)}
                className="outline-none"
                data-testid="chart-bar"
              >
                <rect x={i * slot} y={0} width={slot} height={H} className="fill-transparent" />
                <rect
                  x={x}
                  y={H - h1}
                  width={bar}
                  height={h1}
                  rx={2}
                  className={active === i ? 'fill-primary' : 'fill-primary/70'}
                />
                {secondaryLabel ? (
                  <rect
                    x={x + bar + 2}
                    y={H - h2}
                    width={bar}
                    height={h2}
                    rx={2}
                    className="fill-danger/60"
                  />
                ) : null}
                {points.length <= 31 &&
                (points.length <= 12 || i % Math.ceil(points.length / 12) === 0) ? (
                  <text
                    x={i * slot + slot / 2}
                    y={H + 14}
                    textAnchor="middle"
                    className="fill-fg-muted text-[10px]"
                  >
                    {p.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-1 flex gap-4 text-xs text-fg-muted">
        <span>
          <span className="me-1 inline-block size-2 rounded-sm bg-primary/70" />
          {primaryLabel}
        </span>
        {secondaryLabel ? (
          <span>
            <span className="me-1 inline-block size-2 rounded-sm bg-danger/60" />
            {secondaryLabel}
          </span>
        ) : null}
      </p>
    </Section>
  );
}

// ------------------------------------------------------------ report plumbing
export const reportsKey = ['manager', 'reports'] as const;

export interface TabProps {
  query: ReportQuery;
  onPeriod: (timezone: string) => void;
}

export function useReport<T extends { period: { timezone: string } }>(
  name: string,
  query: ReportQuery,
  fetcher: (q: ReportQuery) => Promise<T>,
  onPeriod: (tz: string) => void,
) {
  const report = useQuery({
    queryKey: [...reportsKey, name, query],
    queryFn: async () => {
      const r = await fetcher(query);
      onPeriod(r.period.timezone);
      return r;
    },
    placeholderData: keepPreviousData,
  });
  return report;
}

export function ReportState({ isPending, error }: { isPending: boolean; error: unknown }) {
  const { t } = useTranslation();
  if (error) return <Alert tone="danger">{t('reports.loadFailed')}</Alert>;
  if (isPending) return <Spinner />;
  return null;
}

export function Definitions({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  return (
    <details className="rounded-lg border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">{t('reports.definitions')}</summary>
      <dl className="mt-3 grid gap-2">
        {keys.map((k) => (
          <div key={k}>
            <dt className="font-medium">{t(`reports.def_${k}_title`)}</dt>
            <dd className="text-fg-muted">{t(`reports.def_${k}`)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
