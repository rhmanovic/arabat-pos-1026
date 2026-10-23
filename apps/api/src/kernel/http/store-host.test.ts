import Fastify from 'fastify';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isCloudflareAddress, trustProxyOption } from './client-ip.js';
import { storeAddress, storeHostRewrite, storeSlugFromHost } from './store-host.js';

const env = { PUBLIC_STORE_URL: 'https://www.arabatapp.com/store', STORE_DOMAIN: 'arabatapp.com' };
const req = (host: string, url: string) => ({ url, headers: { host } }) as IncomingMessage;

describe('store sub-domains (ADR-0136)', () => {
  it('reads the store from the host name', () => {
    expect(storeSlugFromHost('store666.arabatapp.com', 'arabatapp.com')).toBe('store666');
    expect(storeSlugFromHost('Store666.ArabatApp.com:443', 'arabatapp.com')).toBe('store666');
    expect(storeSlugFromHost('store666.arabatapp.com.', 'arabatapp.com')).toBe('store666');
    // The platform's own names, deeper names, other domains and look-alikes are no store.
    for (const host of [
      'www.arabatapp.com',
      'arabatapp.com',
      'send.arabatapp.com',
      'stores.arabatapp.com',
      'a.b.arabatapp.com',
      'store666.evilarabatapp.com',
      'store666.arabatapp.com.evil.com',
      'shop-.arabatapp.com',
      'xn--mgb.arabatapp.com',
    ])
      expect(storeSlugFromHost(host, 'arabatapp.com')).toBeNull();
    expect(storeSlugFromHost('store666.arabatapp.com', '')).toBeNull();
    expect(storeSlugFromHost(undefined, 'arabatapp.com')).toBeNull();
  });

  it('builds a store address: its sub-domain, or the shared address', () => {
    expect(storeAddress(env, 'store666')).toBe('https://store666.arabatapp.com');
    // An address that cannot be a host name keeps the shared one.
    expect(storeAddress(env, 'shop-')).toBe('https://www.arabatapp.com/store/shop-');
    expect(storeAddress({ ...env, STORE_DOMAIN: '' }, 'store666')).toBe(
      'https://www.arabatapp.com/store/store666',
    );
    expect(
      storeAddress(
        { PUBLIC_STORE_URL: 'http://localhost:3100/store', STORE_DOMAIN: 'localhost' },
        'shop1',
      ),
    ).toBe('http://shop1.localhost:3100');
  });

  it('shows the store at the root of its host and keeps the API and files', () => {
    const rewrite = storeHostRewrite('arabatapp.com');
    expect(rewrite(req('store666.arabatapp.com', '/'))).toBe('/store/store666/');
    expect(rewrite(req('store666.arabatapp.com', '/products/1?x=2'))).toBe(
      '/store/store666/products/1?x=2',
    );
    // The other apps are not reachable on a store's host.
    expect(rewrite(req('store666.arabatapp.com', '/manager/'))).toBe('/store/store666/manager/');
    expect(rewrite(req('store666.arabatapp.com', '/api/v1/store/store666'))).toBe(
      '/api/v1/store/store666',
    );
    expect(rewrite(req('store666.arabatapp.com', '/store/assets/a.js'))).toBe('/store/assets/a.js');
    expect(rewrite(req('www.arabatapp.com', '/manager/'))).toBe('/manager/');
  });
});

describe('client address behind Cloudflare', () => {
  it('knows Cloudflare ranges', () => {
    expect(isCloudflareAddress('104.16.1.1')).toBe(true);
    expect(isCloudflareAddress('::ffff:172.64.0.9')).toBe(true);
    expect(isCloudflareAddress('2606:4700::1')).toBe(true);
    expect(isCloudflareAddress('8.8.8.8')).toBe(false);
    expect(isCloudflareAddress('not-an-ip')).toBe(false);
  });

  it('trusts the Cloudflare hop behind the load balancer only', async () => {
    const app = Fastify({ trustProxy: trustProxyOption(2) });
    app.get('/ip', (request) => ({ ip: request.ip }));
    const ip = async (xff: string) =>
      (
        await app.inject({
          url: '/ip',
          remoteAddress: '10.0.0.1',
          headers: { 'x-forwarded-for': xff },
        })
      ).json().ip;
    // Direct: client, load balancer.
    expect(await ip('5.6.7.8, 34.49.242.209')).toBe('5.6.7.8');
    // Through Cloudflare: shopper, Cloudflare, load balancer.
    expect(await ip('5.6.7.8, 104.16.1.1, 34.49.242.209')).toBe('5.6.7.8');
    // A faked Cloudflare entry sent by the client is not trusted.
    expect(await ip('1.1.1.1, 104.16.1.1, 5.6.7.8, 34.49.242.209')).toBe('5.6.7.8');
    expect(trustProxyOption(false)).toBe(false);
    expect(trustProxyOption(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
    await app.close();
  });
});
