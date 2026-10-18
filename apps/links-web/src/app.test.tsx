import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';
import { normalizeLinkUrl } from './pages/EditorPage.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const ID1 = '0190a000-0000-7000-8000-0000000000a1';
const ID2 = '0190a000-0000-7000-8000-0000000000a2';
const item = (id: string, kind: string, label: string, url: string, sortOrder: number) => ({
  id,
  kind,
  labelAr: null,
  labelEn: label,
  emoji: null,
  effect: 'none',
  url,
  status: 'active',
  sortOrder,
  clicks: 3,
  version: 1,
});
const page = {
  slug: 'demo',
  status: 'draft',
  titleAr: null,
  titleEn: 'Demo',
  bioAr: null,
  bioEn: null,
  themeColor: '#0f766e',
  buttonStyle: 'rounded',
  background: 'light',
  buttonVariant: 'fill',
  buttonTextColor: null,
  backgroundColor: null,
  backgroundColor2: null,
  textColor: null,
  font: 'default',
  animation: 'fade-up',
  avatarUrl: null,
  url: 'http://localhost:5176/store/links/demo',
  storeUrl: 'http://localhost:5176/store/demo',
  items: [
    item(ID1, 'instagram', 'Instagram', 'https://instagram.com/demo', 0),
    item(ID2, 'whatsapp', 'WhatsApp', 'https://wa.me/96550000001', 1),
  ],
  version: 2,
};

describe('link page addresses', () => {
  it('turns what people type into full addresses', () => {
    expect(normalizeLinkUrl('instagram', '@demo')).toBe('https://instagram.com/demo');
    expect(normalizeLinkUrl('whatsapp', '+965 5000 0001')).toBe('https://wa.me/96550000001');
    expect(normalizeLinkUrl('phone', '+965 5000 0001')).toBe('tel:+96550000001');
    expect(normalizeLinkUrl('email', 'hi@example.com')).toBe('mailto:hi@example.com');
    expect(normalizeLinkUrl('website', 'example.com/menu')).toBe('https://example.com/menu');
    expect(normalizeLinkUrl('link', 'https://x.com/a')).toBe('https://x.com/a');
    // Anything else is sent as typed and refused by the API.
    expect(normalizeLinkUrl('link', 'javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('link page app', () => {
  function setup() {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/link-page': () => ({ status: 200, body: page }),
        'PUT /manager/link-page': (body) => ({
          status: 200,
          body: { ...page, ...(body as object), version: 3 },
        }),
        'PUT /manager/link-page/items/order': () => ({ status: 200, body: page }),
        'POST /manager/link-page/items': () => ({ status: 201, body: page }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    return fetch;
  }

  it('publishes the page and reorders its links', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    expect(await screen.findByText('https://instagram.com/demo')).toBeInTheDocument();
    // The live preview shows the visible links as buttons.
    const preview = screen.getByRole('complementary', { name: 'Preview' });
    expect(within(preview).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://instagram.com/demo',
    );
    expect(screen.getAllByText('3 clicks')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Move WhatsApp up' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.path.endsWith('/items/order'))?.body).toEqual({
        ids: [ID2, ID1],
      }),
    );
    await user.selectOptions(screen.getByLabelText('Page status'), 'published');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        fetch.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/link-page'))?.body,
      ).toMatchObject({ slug: 'demo', status: 'published', version: 2 }),
    );
  });

  it('adds a link with a suggested label and a normalized address', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    await user.click(await screen.findByRole('button', { name: 'Add link' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'store');
    expect(within(dialog).getByLabelText('Button text (English)')).toHaveValue('Online store');
    expect(within(dialog).getByLabelText('Button text (Arabic)')).toHaveValue('المتجر الإلكتروني');
    expect(within(dialog).getByLabelText('Address')).toHaveValue(
      'http://localhost:5176/store/demo',
    );
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'tiktok');
    await user.clear(within(dialog).getByLabelText('Address'));
    await user.type(within(dialog).getByLabelText('Address'), '@demo');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        kind: 'tiktok',
        labelAr: 'المتجر الإلكتروني',
        labelEn: 'Online store',
        emoji: null,
        effect: 'none',
        url: 'https://tiktok.com/@demo',
        status: 'active',
        version: 0,
      }),
    );
  });
});

describe('link page style', () => {
  function setup() {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/link-page': () => ({ status: 200, body: page }),
        'PUT /manager/link-page': (body) => ({
          status: 200,
          body: { ...page, ...(body as object), version: 3 },
        }),
        'POST /manager/link-page/items': () => ({ status: 201, body: page }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    return fetch;
  }

  it('applies a ready-made theme, shows it in the preview before saving and saves it', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    await user.click(await screen.findByRole('button', { name: 'Sunset' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const preview = screen.getByRole('complementary', { name: 'Preview' });
    const shell = within(preview).getByRole('heading', { name: 'Demo' }).closest('[data-font]')!;
    expect(shell).toHaveAttribute('data-font', 'cairo');
    expect((shell as HTMLElement).style.backgroundImage).toContain('linear-gradient');
    // Pick a motion and an outline button on top of the theme.
    await user.click(screen.getByRole('button', { name: 'Pop' }));
    await user.click(screen.getByRole('button', { name: 'Outline' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        background: 'gradient',
        backgroundColor: '#f97316',
        backgroundColor2: '#db2777',
        textColor: '#ffffff',
        buttonVariant: 'outline',
        font: 'cairo',
        animation: 'pop',
        version: 2,
      }),
    );
  });

  it('switches a colour back to automatic', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    await user.click(await screen.findByRole('button', { name: 'Night' }));
    const auto = screen.getAllByRole('checkbox', { name: 'Automatic' });
    // Button text colour is set by the theme; text colour stays automatic.
    expect(auto[0]).not.toBeChecked();
    expect(auto[1]).toBeChecked();
    await user.click(auto[0]!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        buttonTextColor: null,
        textColor: null,
        background: 'dark',
      }),
    );
  });

  it('gives a link an emoji and an effect', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    await user.click(await screen.findByRole('button', { name: 'Add link' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Address'), '@demo');
    await user.click(within(dialog).getByRole('button', { name: '☕' }));
    await user.selectOptions(within(dialog).getByLabelText('Effect'), 'glow');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        kind: 'instagram',
        emoji: '☕',
        effect: 'glow',
        url: 'https://instagram.com/demo',
      }),
    );
  });
});

describe('link page access', () => {
  it('asks anonymous visitors to sign in with the management account', async () => {
    const fetch = fakeApiFetch({ session: null });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your link page' }),
    ).toBeInTheDocument();
  });

  it('explains when the account cannot manage the link page', async () => {
    const fetch = fakeApiFetch({ session: makeSession('manager', ['manager.access']) });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    expect(await screen.findByText(/cannot manage the link page/)).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path === '/manager/link-page')).toBe(false);
  });
});

describe('link page strings', () => {
  it('counts clicks with Arabic plural forms', async () => {
    await i18n.changeLanguage('ar');
    expect(i18n.t('linkPage.clicks', { count: 0 })).toBe('لا نقرات');
    expect(i18n.t('linkPage.clicks', { count: 2 })).toBe('نقرتان');
    expect(i18n.t('linkPage.clicks', { count: 5 })).toBe('5 نقرات');
    expect(i18n.t('linkPage.clicks', { count: 11 })).toBe('11 نقرة');
    await i18n.changeLanguage('en');
    expect(i18n.t('linkPage.clicks', { count: 1 })).toBe('1 click');
  });
});
