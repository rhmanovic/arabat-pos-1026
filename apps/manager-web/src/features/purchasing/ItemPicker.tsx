import type { StockLevel } from '@arabat/contracts';
import { Input } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { displayQty, itemName } from '../inventory/shared.js';

/** Searches stock items (with the balance at `branchId`) and reports the chosen one. */
export function ItemPicker({
  branchId,
  label,
  disabled,
  onPick,
}: {
  branchId: string;
  label: string;
  disabled?: boolean;
  onPick: (item: StockLevel) => void;
}) {
  const { i18n } = useTranslation();
  const api = useApi();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const results = useQuery({
    queryKey: ['manager', 'item-picker', branchId, q],
    enabled: Boolean(branchId) && q.length > 0,
    queryFn: () => api.inventory.levels({ branchId, q, pageSize: 10 }),
  });
  return (
    <div className="relative max-w-md">
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        disabled={disabled || !branchId}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {q && results.data ? (
        <ul
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
          role="listbox"
          aria-label={label}
        >
          {results.data.levels.map((item) => (
            <li key={item.variantId}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-muted"
                onClick={() => {
                  onPick(item);
                  setSearch('');
                  setQ('');
                }}
              >
                <span>
                  {itemName(item, i18n.language)}
                  {item.sku ? (
                    <span className="ms-2 text-xs text-fg-muted" dir="ltr">
                      {item.sku}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-fg-muted" dir="ltr">
                  {displayQty(item.onHand)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
