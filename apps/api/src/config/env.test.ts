import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    });
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3000, SERVE_WEB: false });
  });

  it('fails fast on invalid configuration', () => {
    expect(() => loadEnv({})).toThrow(InvalidEnvironmentError);
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://u@h/db', MFA_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ DATABASE_URL: 'mysql://x' })).toThrow(InvalidEnvironmentError);
    expect(() => loadEnv({ DATABASE_URL: 'postgres://u@h/db', PORT: '99999' })).toThrow(/PORT/);
  });

  it('trusts X-Forwarded-For only from configured proxies', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    };
    expect(loadEnv(base).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).TRUST_PROXY).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    // "true" would let every client choose its own IP.
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('refuses development secrets in production', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      MFA_ENCRYPTION_KEY: 'VFZOJrTc/gBvE/+ElghyAt/0JVSBdrV8+m1D1ZOdSp4=',
    };
    expect(() => loadEnv(prod)).toThrow(/MFA_ENCRYPTION_KEY/);
    const key = Buffer.alloc(32, 9).toString('base64');
    expect(loadEnv({ ...prod, MFA_ENCRYPTION_KEY: key }).NODE_ENV).toBe('production');
    expect(() =>
      loadEnv({ ...prod, MFA_ENCRYPTION_KEY: key, PAYMENT_MOCK_ENABLED: 'true' }),
    ).toThrow(/PAYMENT_MOCK_SECRET/);
  });

  it('requires the provider key for HTTP e-mail delivery', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    };
    expect(loadEnv(base).MAIL_PROVIDER).toBe('smtp');
    expect(() => loadEnv({ ...base, MAIL_PROVIDER: 'resend' })).toThrow(/MAIL_API_KEY/);
    expect(() => loadEnv({ ...base, MAIL_PROVIDER: 'sendgrid' })).toThrow(/MAIL_PROVIDER/);
    expect(loadEnv({ ...base, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: ' k ' })).toMatchObject({
      MAIL_PROVIDER: 'brevo',
      MAIL_API_KEY: 'k',
    });
  });

  it('derives the MFA key from a long random secret (hosting platforms)', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      MFA_ENCRYPTION_SECRET: 'x'.repeat(40),
    });
    expect(Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', MFA_ENCRYPTION_SECRET: 'short' }),
    ).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
