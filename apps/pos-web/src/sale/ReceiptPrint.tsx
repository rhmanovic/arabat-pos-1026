import { type ReactNode, useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * The printed copy of a receipt: rendered into `document.body` as `#receipt-print`, hidden on
 * screen and the only thing visible when the browser prints (see `styles.css`). Sized for an
 * 80 mm thermal roll with a 72 mm printable width (ImagePlus 810, Printer_POS_80C).
 */
export function ReceiptPrint({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [printedAt, setPrintedAt] = useState(() => new Date());
  useEffect(() => {
    // The stamp is the moment of printing, not of opening the dialog.
    const stamp = () => flushSync(() => setPrintedAt(new Date()));
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  return createPortal(
    <div id="receipt-print" dir={i18n.dir()}>
      {children}
      <p className="receipt-printed-at">
        {t('sale.printedAt')} <bdi>{formatReceiptDate(printedAt, i18n.language)}</bdi>
      </p>
    </div>,
    document.body,
  );
}

export function formatReceiptDate(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
