import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3000, SERVE_WEB: false });
  });

  it('fails fast on invalid configuration', () => {
    expect(() => loadEnv({})).toThrow(InvalidEnvironmentError);
    expect(() => loadEnv({ DATABASE_URL: 'mysql://x' })).toThrow(InvalidEnvironmentError);
    expect(() => loadEnv({ DATABASE_URL: 'postgres://u@h/db', PORT: '99999' })).toThrow(/PORT/);
  });
});
