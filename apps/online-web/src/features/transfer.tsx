import { TRANSFER_COLUMNS, type TransferKind, type TransferResult } from '@arabat/contracts';
import { Alert, Badge, Button, Dialog, Icon, cn } from '@arabat/ui';
import { useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../app/context.js';
import { key } from './shared.js';

/*
 * Products and categories in Excel (ADR-0132): the template, every record in the same shape,
 * and an upload that is checked first and then written all at once (or not at all).
 */

const link =
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:border-primary hover:text-primary';

export function TransferBar({ kind }: { kind: TransferKind }) {
  const { t } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-surface-muted/60 p-2"
      role="group"
      aria-label={t('transfer.bar')}
      data-testid={`transfer-${kind}`}
    >
      <span className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-fg-muted">
        <Icon name="sheet" className="size-4" />
        {t('transfer.excel')}
      </span>
      <a className={link} href={api.online.transferUrl(kind, 'template')} download>
        <Icon name="download" className="size-4" />
        {t('transfer.template')}
      </a>
      <a className={link} href={api.online.transferUrl(kind, 'export')} download>
        <Icon name="download" className="size-4" />
        {t('transfer.export')}
      </a>
      {can('catalog.manage') ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Icon name="upload" className="size-4" />
          {t('transfer.upload')}
        </Button>
      ) : null}
      {open ? <UploadDialog kind={kind} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function UploadDialog({ kind, onClose }: { kind: TransferKind; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const check = useMutation({
    mutationFn: (f: File) => api.online.transferImport(kind, f, false),
    onSuccess: setResult,
    onError: notify.fail,
  });
  const apply = useMutation({
    mutationFn: () => api.online.transferImport(kind, file!, true),
    onSuccess: async (r) => {
      setResult(r);
      if (r.mode !== 'applied') return;
      notify.ok(t('transfer.applied', r.counts));
      await queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: notify.fail,
  });
  const choose = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    check.mutate(f);
  };
  const ar = i18n.language.startsWith('ar');
  const column = (k: string) => {
    const c = TRANSFER_COLUMNS[kind].find((x) => x.key === k);
    return c ? (ar ? c.ar : c.en) : '—';
  };
  const changes = result ? result.counts.created + result.counts.updated : 0;
  const ready = result && result.issues.length === 0 && changes > 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      size="lg"
      title={t(`transfer.uploadTitle_${kind}`)}
      description={t('transfer.uploadHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!ready || check.isPending}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            {t('transfer.apply', { count: changes })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center',
            dragging ? 'border-primary bg-primary-soft' : 'border-border',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <Icon name="sheet" className="size-8 text-primary" />
          <p className="text-sm">{file ? file.name : t('transfer.drop')}</p>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label={t('transfer.chooseFile')}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={check.isPending}
            onClick={() => input.current?.click()}
          >
            {file ? t('transfer.otherFile') : t('transfer.chooseFile')}
          </Button>
        </div>
        {result ? (
          <>
            <div className="grid grid-cols-3 gap-2" data-testid="transfer-counts">
              {(['created', 'updated', 'unchanged'] as const).map((k) => (
                <div key={k} className="rounded-xl bg-surface-muted p-3 text-center">
                  <p className="text-2xl font-bold tabular-nums">{result.counts[k]}</p>
                  <p className="text-xs text-fg-muted">{t(`transfer.count_${k}`)}</p>
                </div>
              ))}
            </div>
            {result.issues.length > 0 ? (
              <Alert tone="danger" title={t('transfer.fix', { count: result.issues.length })}>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-start text-sm">
                    <thead>
                      <tr className="text-xs text-fg-muted">
                        <th className="py-1 text-start">{t('transfer.row')}</th>
                        <th className="py-1 text-start">{t('transfer.column')}</th>
                        <th className="py-1 text-start">{t('transfer.problem')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.issues.map((i, n) => (
                        <tr key={n} className="border-t border-border/60 align-top">
                          <td className="py-1 tabular-nums">{i.row || '—'}</td>
                          <td className="py-1">{i.column ? column(i.column) : '—'}</td>
                          <td className="py-1">
                            {t(`transfer.issue_${i.code}`, {
                              defaultValue: i.message ?? i.code,
                              detail: i.message ?? '',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Alert>
            ) : changes === 0 ? (
              <Alert>{t('transfer.nothing')}</Alert>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{t('transfer.willDo')}</p>
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
                  {result.rows.map((r) => (
                    <li
                      key={r.row}
                      className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 last:border-0"
                    >
                      <span className="truncate">
                        <span className="me-2 text-xs text-fg-muted tabular-nums">#{r.row}</span>
                        {r.name}
                      </span>
                      <Badge tone={r.action === 'create' ? 'success' : 'primary'}>
                        {t(`transfer.action_${r.action}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-fg-muted">{t('transfer.allOrNothing')}</p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
