import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { Spinner } from './spinner.js';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hidden below this breakpoint to keep tables readable on tablets. */
  hideBelow?: 'sm' | 'md' | 'lg';
}

const HIDE = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const;

/** Simple accessible data table; horizontal scroll stays inside its container. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  caption,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  caption?: string;
  onRowClick?: (row: T) => void;
}) {
  return (
    // `relative` keeps absolutely positioned children (sr-only labels) inside the scroll area.
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-surface-muted text-xs text-fg-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-start font-medium whitespace-nowrap',
                  c.hideBelow && HIDE[c.hideBelow],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-primary">
                <Spinner />
              </td>
            </tr>
          ) : rows && rows.length > 0 ? (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-t border-border',
                  onRowClick && 'cursor-pointer hover:bg-surface-muted',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 align-middle',
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-fg-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
