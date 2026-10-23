import { Logger } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

/*
 * Custom hostnames (ADR-0137): a merchant's own domain reaches Arabat through Cloudflare for
 * SaaS on the platform's zone. Cloudflare checks that the host name points here (the
 * merchant's CNAME) and issues and renews its certificate; Arabat only creates, reads and
 * removes the host names. `fake` answers like Cloudflare without the network (development and
 * tests: a host name turns active on its first read); `off` means the feature is not set up.
 */

export type HostState = 'pending' | 'active' | 'failed';
export type CustomHostname = {
  id: string;
  hostname: string;
  status: HostState;
  certificate: HostState;
  errors: string[];
  /** TXT records Cloudflare asks for when the HTTP check cannot be used. */
  txt: { name: string; value: string }[];
};

export abstract class CustomHostnames {
  /** Connecting domains works on this server. */
  abstract readonly available: boolean;
  /** The name merchants point their CNAME to, e.g. `stores.arabatapp.com`. */
  abstract readonly target: string | null;
  abstract create(hostname: string): Promise<CustomHostname>;
  /** The host name's current state, or null when Cloudflare no longer has it. */
  abstract get(id: string): Promise<CustomHostname | null>;
  abstract remove(id: string): Promise<void>;
}

const unavailable = () =>
  new AppError(503, 'DOMAINS_UNAVAILABLE', 'Connecting your own domain is not available yet.');

export class UnconfiguredCustomHostnames extends CustomHostnames {
  readonly available = false;
  readonly target = null;
  create(): Promise<CustomHostname> {
    return Promise.reject(unavailable());
  }
  get(): Promise<CustomHostname | null> {
    return Promise.reject(unavailable());
  }
  remove(): Promise<void> {
    return Promise.reject(unavailable());
  }
}

export class FakeCustomHostnames extends CustomHostnames {
  readonly available = true;
  private readonly hosts = new Map<string, CustomHostname>();
  private next = 1;
  constructor(readonly target: string) {
    super();
  }
  create(hostname: string): Promise<CustomHostname> {
    const host: CustomHostname = {
      id: `fake-${this.next++}`,
      hostname,
      status: 'pending',
      certificate: 'pending',
      errors: [],
      txt: [],
    };
    this.hosts.set(host.id, host);
    return Promise.resolve({ ...host });
  }
  get(id: string): Promise<CustomHostname | null> {
    const host = this.hosts.get(id);
    if (!host) return Promise.resolve(null);
    host.status = 'active';
    host.certificate = 'active';
    return Promise.resolve({ ...host });
  }
  remove(id: string): Promise<void> {
    this.hosts.delete(id);
    return Promise.resolve();
  }
}

type CloudflareHostname = {
  id: string;
  hostname: string;
  status?: string;
  verification_errors?: string[];
  ssl?: {
    status?: string;
    validation_errors?: { message?: string }[];
    validation_records?: { txt_name?: string; txt_value?: string }[];
  };
};

const hostState = (status: string | undefined): HostState =>
  status === 'active'
    ? 'active'
    : status === undefined || status.startsWith('pending')
      ? 'pending'
      : 'failed';
const certificateState = (status: string | undefined): HostState =>
  status === 'active'
    ? 'active'
    : status === undefined || status === 'initializing' || status.startsWith('pending')
      ? 'pending'
      : 'failed';

export function fromCloudflare(h: CloudflareHostname): CustomHostname {
  return {
    id: h.id,
    hostname: h.hostname,
    status: hostState(h.status),
    certificate: certificateState(h.ssl?.status),
    errors: [
      ...(h.verification_errors ?? []),
      ...(h.ssl?.validation_errors ?? []).map((e) => e.message ?? '').filter(Boolean),
    ],
    txt: (h.ssl?.validation_records ?? [])
      .filter((r) => r.txt_name && r.txt_value)
      .map((r) => ({ name: r.txt_name!, value: r.txt_value! })),
  };
}

export class CloudflareCustomHostnames extends CustomHostnames {
  readonly available = true;
  private readonly logger = new Logger(CloudflareCustomHostnames.name);
  constructor(
    private readonly token: string,
    private readonly zoneId: string,
    readonly target: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const response = await this.fetchFn(
      `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 404) return null;
    const json = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: T;
      errors?: { code?: number; message?: string }[];
    } | null;
    if (!response.ok || !json?.success) {
      const message = json?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? '';
      this.logger.warn(
        `Cloudflare ${method} custom_hostnames${path} failed: ${response.status} ${message}`,
      );
      throw new AppError(
        502,
        'DOMAINS_PROVIDER_ERROR',
        'The domain service did not answer. Try again shortly.',
      );
    }
    return json.result ?? null;
  }

  async create(hostname: string): Promise<CustomHostname> {
    // A host name created before (an earlier attempt) is reused rather than refused.
    const existing = await this.call<CloudflareHostname[]>(
      'GET',
      `?hostname=${encodeURIComponent(hostname)}`,
    );
    const found = existing?.find((h) => h.hostname === hostname);
    if (found) return fromCloudflare(found);
    const created = await this.call<CloudflareHostname>('POST', '', {
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });
    if (!created)
      throw new AppError(502, 'DOMAINS_PROVIDER_ERROR', 'The domain service did not answer.');
    return fromCloudflare(created);
  }

  async get(id: string): Promise<CustomHostname | null> {
    const h = await this.call<CloudflareHostname>('GET', `/${encodeURIComponent(id)}`);
    return h ? fromCloudflare(h) : null;
  }

  async remove(id: string): Promise<void> {
    await this.call('DELETE', `/${encodeURIComponent(id)}`);
  }
}

export function createCustomHostnames(env: Env): CustomHostnames {
  const target =
    env.CUSTOM_HOSTNAME_TARGET || (env.STORE_DOMAIN ? `stores.${env.STORE_DOMAIN}` : '');
  switch (env.CUSTOM_HOSTNAMES_DRIVER) {
    case 'cloudflare':
      return new CloudflareCustomHostnames(
        env.CLOUDFLARE_API_TOKEN!,
        env.CLOUDFLARE_ZONE_ID!,
        target,
      );
    case 'fake':
      return new FakeCustomHostnames(target || 'stores.localhost');
    default:
      return new UnconfiguredCustomHostnames();
  }
}
