import type { DesignLink } from '@arabat/contracts';
import { Select, cn } from '@arabat/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchChoice, useLocalName, useSlug, useStorefront } from '../shared.js';
import { linkTarget, useDesign } from './context.js';

// ----------------------------------------------------------------------------- icons
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6 6 18M6 6l12 12',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  bag: 'M6 7h12l1 14H5zM9 7V6a3 3 0 0 1 6 0v1',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  chevron: 'M6 9l6 6 6-6',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6',
  phone:
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  instagram:
    'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  tiktok: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.3 4.4 5 4.8',
  snapchat:
    'M12 3a5.5 5.5 0 0 0-5.5 5.5V11l-2 1 2 1-1.5 3 3-.5 1 2.5h6l1-2.5 3 .5-1.5-3 2-1-2-1V8.5A5.5 5.5 0 0 0 12 3z',
  x: 'M4 4l16 16M20 4 4 20',
  youtube: 'M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM10 9l5 3-5 3z',
  whatsapp: 'M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12zM9 9.5c.5 2 2.5 4 4.5 4.5',
} as const;
export type StoreIconName = keyof typeof ICONS;

export function StoreIcon({ name, className }: { name: StoreIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className ?? 'size-5'}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A design link as a router link or an outside link (opened in a new tab). */
export function DesignAnchor({
  link,
  className,
  children,
  onClick,
}: {
  link: DesignLink | null;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const slug = useSlug();
  const target = linkTarget(slug, link);
  if (!target) return <span className={className}>{children}</span>;
  return target.external ? (
    <a
      href={target.to}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  ) : (
    <Link to={target.to} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------- social
const SOCIAL = {
  instagram: (h: string) => `https://instagram.com/${h}`,
  tiktok: (h: string) => `https://www.tiktok.com/@${h}`,
  snapchat: (h: string) => `https://www.snapchat.com/add/${h}`,
  x: (h: string) => `https://x.com/${h}`,
  youtube: (h: string) => `https://www.youtube.com/@${h}`,
  whatsapp: (h: string) => `https://wa.me/${h.replace(/^\+/, '')}`,
} as const;

export function useSocialLinks() {
  const { social } = useDesign();
  const { t } = useTranslation();
  return (Object.keys(SOCIAL) as (keyof typeof SOCIAL)[])
    .filter((k) => social[k])
    .map((k) => ({ key: k, href: SOCIAL[k](social[k]), label: t(`social.${k}`) }));
}

/** The store's social accounts as round icon buttons (their names are the accessible names). */
export function SocialLinks({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const links = useSocialLinks();
  if (links.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {links.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={s.label}
            title={s.label}
            className={cn(
              'grid place-items-center rounded-full border border-current/15 transition-colors hover:bg-current/10',
              size === 'sm' ? 'size-7' : 'size-10',
            )}
          >
            <StoreIcon name={s.key} className={size === 'sm' ? 'size-3.5' : 'size-[1.15rem]'} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------- branch and language
export function BranchPicker({ className }: { className?: string }) {
  const { data: store } = useStorefront();
  const { branchId, setBranchId } = useBranchChoice();
  const name = useLocalName();
  const { t } = useTranslation();
  const pickup = store?.branches.filter((b) => b.pickupEnabled) ?? [];
  if (pickup.length <= 1) return null;
  return (
    <Select
      aria-label={t('nav.branch')}
      className={cn('h-9 w-40 rounded-full text-sm text-fg', className)}
      value={branchId ?? ''}
      onChange={(e) => setBranchId(e.target.value || null)}
    >
      {pickup.map((b) => (
        <option key={b.id} value={b.id}>
          {name(b)}
        </option>
      ))}
    </Select>
  );
}

/** One small button that switches to the other language; its name is that language. */
export function LanguageButton({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('common');
  const next = i18n.resolvedLanguage === 'en' ? 'ar' : 'en';
  const label = t(`language.${next}`);
  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={label}
      title={label}
      lang={next}
      className={cn(
        'inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-bold transition-colors hover:bg-current/10',
        className,
      )}
    >
      {next === 'en' ? 'EN' : 'ع'}
    </button>
  );
}
