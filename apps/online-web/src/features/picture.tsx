import { Button, cn } from '@arabat/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The first picture in a paste or a drop, if any. */
export function pictureFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (file.type.startsWith('image/')) return file;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** A picture waiting to be saved with a dialog: chosen, pasted or dropped, or removed. */
export function usePendingPicture() {
  const [picture, setPicture] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const choose = (file: File | null) => {
    if (!file) return;
    setPicture(file);
    setRemoved(false);
  };
  // A picture pasted anywhere while the dialog is open becomes its picture.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = pictureFrom(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      setPicture(file);
      setRemoved(false);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  return {
    picture,
    removed,
    choose,
    remove: () => {
      setPicture(null);
      setRemoved(true);
    },
  };
}

/** Drop zone with a preview, an upload button and a remove button (pictures saved as WebP). */
export function PictureField({
  pending,
  current,
  alt,
  testId,
}: {
  pending: ReturnType<typeof usePendingPicture>;
  /** The saved picture, if any. */
  current: string | null;
  alt: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(
    () =>
      pending.picture && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(pending.picture)
        : null,
    [pending.picture],
  );
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const shown = preview ?? (pending.removed ? null : current);
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border-2 border-dashed p-3 sm:col-span-2',
        dragging ? 'border-primary bg-primary-soft' : 'border-border',
      )}
      data-testid={testId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pending.choose(pictureFrom(e.dataTransfer));
      }}
    >
      <span className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
        {shown ? <img src={shown} alt={alt} className="size-full object-cover" /> : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-fg-muted">{t('picture.pasteHint')}</p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={t('picture.upload')}
            onChange={(e) => {
              pending.choose(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            {t('picture.upload')}
          </Button>
          {shown ? (
            <Button variant="ghost" size="sm" onClick={pending.remove}>
              {t('picture.remove')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
