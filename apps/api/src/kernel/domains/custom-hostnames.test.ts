import { describe, expect, it } from 'vitest';
import { CloudflareCustomHostnames, fromCloudflare } from './custom-hostnames.js';

describe('Cloudflare custom hostnames (ADR-0137)', () => {
  it('reads host name and certificate states', () => {
    expect(
      fromCloudflare({
        id: 'a',
        hostname: 'www.shop.com',
        status: 'pending',
        ssl: {
          status: 'pending_validation',
          validation_records: [{ txt_name: '_acme-challenge.www.shop.com', txt_value: 'x1' }],
        },
      }),
    ).toEqual({
      id: 'a',
      hostname: 'www.shop.com',
      status: 'pending',
      certificate: 'pending',
      errors: [],
      txt: [{ name: '_acme-challenge.www.shop.com', value: 'x1' }],
    });
    expect(
      fromCloudflare({ id: 'b', hostname: 'h', status: 'active', ssl: { status: 'active' } }),
    ).toMatchObject({ status: 'active', certificate: 'active' });
    expect(
      fromCloudflare({
        id: 'c',
        hostname: 'h',
        status: 'blocked',
        verification_errors: ['custom hostname does not CNAME to this zone.'],
        ssl: { status: 'validation_timed_out', validation_errors: [{ message: 'timed out' }] },
      }),
    ).toMatchObject({
      status: 'failed',
      certificate: 'failed',
      errors: ['custom hostname does not CNAME to this zone.', 'timed out'],
    });
  });

  it('creates a host name once, reuses an existing one, and treats a missing one as gone', async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const existing = new Set<string>(['www.old.com']);
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, body: init.body as string | undefined });
      const json = (result: unknown, status = 200) =>
        new Response(JSON.stringify({ success: status < 300, result, errors: [] }), { status });
      if (url.includes('?hostname=')) {
        const name = decodeURIComponent(url.split('?hostname=')[1]!);
        return json(existing.has(name) ? [{ id: 'old', hostname: name, status: 'active' }] : []);
      }
      if (init.method === 'POST')
        return json({
          id: 'new',
          hostname: JSON.parse(init.body as string).hostname,
          status: 'pending',
        });
      if (url.endsWith('/missing')) return new Response('{}', { status: 404 });
      return json({ id: 'x', hostname: 'h', status: 'active', ssl: { status: 'active' } });
    }) as typeof fetch;
    const cf = new CloudflareCustomHostnames('token', 'zone1', 'stores.arabatapp.com', fakeFetch);
    expect((await cf.create('www.shop.com')).id).toBe('new');
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({
      hostname: 'www.shop.com',
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });
    expect((await cf.create('www.old.com')).id).toBe('old');
    expect(await cf.get('missing')).toBeNull();
    expect(
      calls.every((c) =>
        c.url.startsWith('https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames'),
      ),
    ).toBe(true);
  });
});
