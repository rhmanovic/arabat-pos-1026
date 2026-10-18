import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';
import { normalizeLinkUrl } from './LinkPageTab.js';

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

describe('link page tab', () => {
  function setup() {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/link-page': () => ({ status: 200, body: page }),
        'PUT /manager/link-page': (body) => ({
          status: 200,
          body: { ...page, ...(body as object), version: 3 },
        }),
        'PUT /manager/link-page/items/order': () => ({ status: 200, body: page }),
        'POST /manager/link-page/items': () => ({ status: 201, body: page }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    return fetch;
  }

  it('publishes the page and reorders its links', async () => {
    const user = userEvent.setup();
    const fetch = setup();
    await user.click(await screen.findByRole('button', { name: 'Link page' }));
    expect(await screen.findByText('https://instagram.com/demo')).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Link page' }));
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
        url: 'https://tiktok.com/@demo',
        status: 'active',
        version: 0,
      }),
    );
  });
});
