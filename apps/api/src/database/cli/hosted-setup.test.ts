import { describe, expect, it } from 'vitest';
import { hostedRolesFromEnv, withUser } from './hosted-setup.js';

describe('hosted setup', () => {
  it('derives role URLs from the admin URL', () => {
    expect(withUser('postgres://postgres:secret@db.internal:5432/railway', 'app_owner', 'pw')).toBe(
      'postgres://app_owner:pw@db.internal:5432/railway',
    );
  });

  it('keeps the Cloud SQL socket of a Cloud Run admin URL', () => {
    const url = withUser(
      'postgresql://postgres:secret@localhost/arabat?host=/cloudsql/proj:me-central1:arabat-prod',
      'app_runtime',
      'p@ss/word',
    );
    const parsed = new URL(url);
    expect(parsed.username).toBe('app_runtime');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss/word');
    expect(parsed.pathname).toBe('/arabat');
    expect(parsed.searchParams.get('host')).toBe('/cloudsql/proj:me-central1:arabat-prod');
  });

  it('requires two long, different role passwords', () => {
    const long = 'x'.repeat(32);
    expect(() => hostedRolesFromEnv({})).toThrow(/required/);
    expect(() =>
      hostedRolesFromEnv({ APP_OWNER_PASSWORD: 'short', APP_RUNTIME_PASSWORD: long }),
    ).toThrow(/16 characters/);
    expect(() =>
      hostedRolesFromEnv({ APP_OWNER_PASSWORD: long, APP_RUNTIME_PASSWORD: long }),
    ).toThrow(/must differ/);
    expect(
      hostedRolesFromEnv({ APP_OWNER_PASSWORD: long, APP_RUNTIME_PASSWORD: `${long}y` }),
    ).toEqual({ ownerPassword: long, runtimePassword: `${long}y` });
  });
});
