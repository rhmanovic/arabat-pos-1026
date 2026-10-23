---
name: ui-theme
description: Visual design system of the Arabat web apps - which look each app uses (Arabat palette vs the consoles' young look), semantic color tokens, dark mode, icons, fonts and how to screenshot a screen to check it. Use when styling or building a screen, choosing colors, adding an icon, touching theme.css / vibe.css / ThemeSwitch, or when asked to make a page look better, "جيل زي", or check it in dark mode or on a phone.
---

# UI theme and visual design system

General React / i18n / RTL rules live in the `frontend-conventions` skill; running the apps is in
`run-api-locally`; Playwright setup is in `sandbox-setup`. This skill is only about the look.

## 1. Which look each app uses

| Look | Apps | Source |
|---|---|---|
| **Young look** (violet / pink, larger radii, dark mode, gradients) | `apps/manager-web`, `apps/online-web` | `theme.css` then `vibe.css` (ADR-0127, ADR-0131) |
| **Arabat palette** (navy primary, mint accent, light only) | `apps/pos-web`, `apps/platform-web`, `apps/store-web`, `apps/links-web`, `apps/device-web` | `theme.css` only (ADR-0131) |
| **Landing brand** (teal `brand`, Alexandria font, own tokens) | `apps/landing-web` | its own `src/styles.css`, does not import `@arabat/ui` CSS (ADR-0113) |

- Every app's `src/styles.css` starts `@import 'tailwindcss'; @import '@arabat/ui/theme.css';` and
  `@source`s `packages/ui/src` and `packages/web-core/src`. Only manager-web and online-web add
  `@import '@arabat/ui/vibe.css';` - never add it to another app without an owner decision and an
  ADR (ADR-0131: "the POS, storefront, platform, link page and landing keep the Arabat palette").
- The storefront's per-merchant colors (store design, ADR-0128) are merchant data, not tokens; hex
  values in `apps/online-web/src/features/design/*` are store settings, not a precedent.
- The dark `console` tokens (`bg-console`, `text-console-fg`) are for the POS / platform / device
  login and shell bars and `packages/web-core/src/lock-screen.tsx`, not for page content.

## 2. Tokens - never hard-code colors

Tokens are Tailwind v4 `@theme` variables in `packages/ui/src/theme.css`, overridden (same names)
in `packages/ui/src/vibe.css`. Use the utilities, never hex / `oklch()` / Tailwind palette colors
(`bg-violet-500`, `text-gray-600`) in app code:

- Surfaces: `bg-canvas` (page), `bg-surface` (cards, menus), `bg-surface-muted` (wells, segmented).
- Lines: `border-border`, `border-border-strong`.
- Text: `text-fg`, `text-fg-muted` (secondary), `text-fg-subtle` (hints).
- Brand: `bg-primary text-primary-fg`, `hover:bg-primary-hover`, `bg-primary-soft`; `accent` / `accent-fg`.
- Status: `success`, `warning`, `danger` (+ `-soft` backgrounds, `danger-hover`).
- Radii: `rounded-sm|md|lg|xl` (the young look makes them larger automatically).
- Touch: `h-touch` / `min-h-touch` (3.25rem) for POS targets (`--spacing-touch`, BR-018).
- Never redefine a semantic token inside an app's `styles.css` (comment in `theme.css`). A new
  token goes into `theme.css` and, if it differs in the young look, also into both dark blocks
  of `vibe.css`.
- Never use `dark:` variants: dark mode works by swapping token values, so token utilities are
  already correct in both modes.

## 3. Dark mode (young look only)

- `vibe.css` defines dark values twice: `:root[data-theme='dark']` and
  `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`. Change both blocks
  together, keeping text pairs at 4.5 : 1 or better (ADR-0127).
- `applyTheme()` / `useThemeMode()` / `ThemeSwitch` are in `packages/web-core/src/theme.tsx`;
  choice stored in `localStorage` key `arabat.theme` (legacy `arabat.online.theme` read once),
  applied as `<html data-theme>`; absent = follow the device (ADR-0131).
- `applyTheme()` must run in `main.tsx` before `createRoot` (see `apps/manager-web/src/main.tsx`).
  `ThemeSwitch` sits at the foot of the side menu (`ManagerLayout.tsx`, `OnlineLayout.tsx`).
- Arabat-palette apps have no dark mode; do not build one piecemeal (the `theme.css` header's
  "dark mode is defined for the platform console" is not true in code).

## 4. Effects of the young look (`vibe.css`)

- `.vibe-gradient` (violet -> pink, white text): hero/welcome card, logo tile, active nav item only.
- `.vibe-glow` (primary shadow), `.vibe-lift` (cards that lift on hover; use on clickable tiles),
  `.vibe-enter` (page entrance), `.vibe-scroll` (hidden scrollbar for swipe rows).
- All stop under `prefers-reduced-motion`; any new animation must do the same (also `lp-*` in
  `theme.css`, ADR-0116).
- `vibe.css` clips horizontal overflow and gives a bare `.grid` one shrinkable column
  (`minmax(0,1fr)`); always add `sm:grid-cols-*` / `lg:grid-cols-*` explicitly (ADR-0131).

## 5. Icons

- Use `Icon` from `@arabat/ui` (`packages/ui/src/icons.tsx`): inline 24x24 line SVGs, 2 px stroke,
  `currentColor`, `aria-hidden`, default `size-5`. Size with `className="size-4"` etc., color with
  a text token. Do not add an icon package (ADR-0127: "no new dependency").
- Icons are decorative: always next to a visible label (or give the button an `aria-label`).
- A missing icon: add a `PATHS` entry (same 24-grid stroke style) and use its name; the `name`
  prop is typed from `PATHS`.
- Directional icons (`arrow`) must be mirrored in RTL (`rtl:-scale-x-100`).

## 6. Typography, spacing, fonts

- One typeface: IBM Plex Sans Arabic 400/500/600/700, self-hosted through `@fontsource`
  (`packages/ui/src/fonts.ts`); every SPA's `main.tsx` imports `@arabat/ui/fonts` first.
  `body` uses tabular figures (`tnum`) so amounts align.
- Landing uses Alexandria TTFs from `apps/landing-web/public/fonts` (`@font-face` in its `styles.css`).
- No font CDN (Google Fonts etc.): the API CSP is `fontSrc: ["'self'"]`
  (`apps/api/src/bootstrap.ts`). Fonts are never inlined as `data:` URIs - each `vite.config.ts`
  sets `assetsInlineLimit` to `false` for woff/ttf/otf (CLAUDE.md gotchas).
- Scale in use: page title `text-2xl font-semibold` (`PageHeader`), dialog title `text-lg`,
  card / section title `text-base font-semibold` (`CardTitle`, `Section`), body `text-sm`, hints
  `text-xs text-fg-muted`, figures `tabular-nums text-2xl sm:text-3xl font-semibold` (`StatCard`).
  Spacing: Tailwind steps (`gap-2/3/4`, card `p-5`, `mb-6` under the header). Logical utilities only.

## 7. Building a new screen that matches

1. Compose from `@arabat/ui` primitives before writing markup: `PageHeader`, `Section`,
   `StatCard` (`page.tsx`), `Card*`, `Button` (`buttonVariants`), `Input` / `Field` / `Label`,
   `Select` / `Textarea` / `Checkbox` / `Tabs`, `Segmented`, `DataTable`, `Dialog` /
   `ConfirmDialog`, `Menu*`, `Alert` / `Badge` / `StatusDot` / `EmptyState`, `Spinner`,
   `useToast`, `Kbd`. Merge classes with `cn()` (`cn.ts`).
2. Copy the shape of a sibling page in the same app (e.g. `apps/manager-web/src/pages/*`), so the
   layout follows its shell (`ManagerLayout`, `OnlineLayout`, `POSLayout`, `PlatformLayout`).
3. Only tokens (section 2); a new shared component goes into `packages/ui/src` and is exported
   from `index.ts`.
4. Consoles are phone-first: check at 390 px; nothing may widen the page; the bottom tab bar
   exists only below `lg` (1024 px) (ADR-0131).
5. Test in Arabic (RTL) and English (LTR), light and dark (young look), and with a long Arabic label.

## 8. Checking visually (screenshots)

Start the app first (`run-api-locally`: API on `:3000`, Vite on `:5173` manager, `:5174` pos,
`:5175` platform, `:5178` online; demo `owner@demo.arabat.test`). Then, from the repo root
(so `@playwright/test` resolves), save shots in the scratchpad, not the repo:

```bash
cd /home/user/arabat-pos-1026 && node --input-type=module -e "
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  await p.goto('http://localhost:5173/manager/');   // sign in here if redirected
  await p.screenshot({ path: process.env.OUT + '/shot-' + scheme + '.png', fullPage: true });
}
await b.close();"
```

- Set `OUT` to the scratchpad. `colorScheme` drives "follow the device"; to force a mode set
  `localStorage['arabat.theme']` via `page.addInitScript`. Use `1280x800` for desktop.
- Open the PNG with the Read tool and look: contrast, cut-off text, RTL mirroring, overflow.
- e2e device projects are in `playwright.config.ts` (`desktop`, `tablet-touch`, `phone`); see `run-tests`.
