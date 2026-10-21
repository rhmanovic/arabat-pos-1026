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

/** Every picture in a paste or a drop. */
export function picturesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
  if (files.length > 0) return files;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

/** Pictures of a product waiting to be saved with a dialog: added ones and removed saved ones. */
export function usePendingGallery() {
  const [added, setAdded] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const add = (files: File[]) => (files.length > 0 ? setAdded((x) => [...x, ...files]) : null);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = picturesFrom(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      setAdded((x) => [...x, ...files]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  return {
    added,
    removed,
    add,
    dropAdded: (index: number) => setAdded((x) => x.filter((_, i) => i !== index)),
    removeSaved: (id: string) => setRemoved((x) => [...x, id]),
    changed: added.length > 0 || removed.length > 0,
  };
}

/**
 * A product's pictures (the first is the main one): saved ones with a remove button, new ones
 * chosen, pasted or dropped, all saved with the dialog as WebP.
 */
export function GalleryField({
  pending,
  current,
  max,
  testId,
}: {
  pending: ReturnType<typeof usePendingGallery>;
  current: { id: string; url: string }[];
  max: number;
  testId: string;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const previews = useMemo(
    () =>
      pending.added.map((f) =>
        typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '',
      ),
    [pending.added],
  );
  useEffect(
    () => () => previews.forEach((p) => (p ? URL.revokeObjectURL(p) : undefined)),
    [previews],
  );
  const kept = current.filter((c) => !pending.removed.includes(c.id));
  const count = kept.length + pending.added.length;
  const tile = 'relative size-20 shrink-0 overflow-hidden rounded-lg border border-border';
  const removeButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
    >
      ✕
    </button>
  );
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border-2 border-dashed p-3 sm:col-span-2',
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
        pending.add(picturesFrom(e.dataTransfer).slice(0, Math.max(0, max - count)));
      }}
    >
      <div className="flex flex-wrap gap-2">
        {kept.map((img, n) => (
          <span key={img.id} className={tile}>
            <img src={img.url} alt="" className="size-full object-cover" />
            {n === 0 ? (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[0.65rem] font-semibold text-white">
                {t('picture.main')}
              </span>
            ) : null}
            {removeButton(t('picture.removeOne', { n: n + 1 }), () => pending.removeSaved(img.id))}
          </span>
        ))}
        {pending.added.map((file, n) => (
          <span key={`${file.name}-${n}`} className={cn(tile, 'ring-2 ring-primary')}>
            {previews[n] ? (
              <img src={previews[n]} alt={file.name} className="size-full object-cover" />
            ) : null}
            {removeButton(t('picture.removeOne', { n: kept.length + n + 1 }), () =>
              pending.dropAdded(n),
            )}
          </span>
        ))}
        {count < max ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="grid size-20 shrink-0 place-items-center rounded-lg border border-dashed border-border text-2xl text-fg-muted hover:border-primary hover:text-primary"
            aria-label={t('picture.add')}
            title={t('picture.add')}
          >
            +
          </button>
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label={t('picture.upload')}
        onChange={(e) => {
          pending.add(Array.from(e.target.files ?? []).slice(0, Math.max(0, max - count)));
          e.target.value = '';
        }}
      />
      <p className="text-xs text-fg-muted">{t('picture.galleryHint', { count, max })}</p>
    </div>
  );
}
