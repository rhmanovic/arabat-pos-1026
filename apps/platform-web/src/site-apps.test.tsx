import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const APP = '0190a000-0000-7000-8000-0000000000s1';
const app = {
  id: APP,
  nameAr: 'الكاشير',
  nameEn: 'Till',
  descriptionAr: null,
  descriptionEn: 'Point of sale in the browser',
  url: '/pos/',
  icon: 'till',
  openInNewTab: false,
  status: 'active',
  sortOrder: 20,
  version: 3,
  updatedAt: '2026-10-19T08:00:00.000Z',
};

/** The "Our apps" menu of the public site, kept by operators (ADR-0117). */
describe('apps menu page', () => {
  it('lists the entries and lets an editor add one', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('platform', ['platform.billing']),
      routes: {
        'GET /platform/site-apps': () => ({ status: 200, body: { apps: [app] } }),
        'POST /platform/site-apps': (body) => ({
          status: 201,
          body: { ...app, id: 'new', ...(body as object), version: 1 },
        }),
      },
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/site-apps', fetch });
    expect(await screen.findByText('Till', { selector: '.font-medium' })).toBeInTheDocument();
    expect(screen.getByText('/pos/')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New app' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'تطبيق آيفون');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'iPhone app');
    const url = within(dialog).getByLabelText('Address');
    await user.clear(url);
    await user.type(url, 'https://apps.apple.com/kw/app/arabat');
    await user.selectOptions(within(dialog).getByLabelText('Icon'), 'phone');
    await user.click(within(dialog).getByLabelText('Open in a new tab'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        nameAr: 'تطبيق آيفون',
        nameEn: 'iPhone app',
        descriptionAr: '',
        descriptionEn: '',
        url: 'https://apps.apple.com/kw/app/arabat',
        icon: 'phone',
        openInNewTab: true,
        status: 'active',
        sortOrder: 100,
        version: 0,
      }),
    );
  });

  it('deletes an entry after a confirmation, with its version on edits', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('platform', ['platform.super_admin']),
      routes: {
        'GET /platform/site-apps': () => ({ status: 200, body: { apps: [app] } }),
        [`DELETE /platform/site-apps/${APP}`]: () => ({ status: 204, body: null }),
      },
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/site-apps', fetch });
    await user.click(await screen.findByText('Till', { selector: '.font-medium' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Address')).toHaveValue('/pos/');
    await user.click(within(dialog).getByRole('button', { name: 'Delete this app' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetch.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(APP))).toBe(true),
    );
  });

  it('is read-only for support operators', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('platform', ['platform.support']),
      routes: { 'GET /platform/site-apps': () => ({ status: 200, body: { apps: [app] } }) },
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/site-apps', fetch });
    expect(await screen.findByText('Till', { selector: '.font-medium' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New app' })).toBeNull();
  });
});
