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
});
