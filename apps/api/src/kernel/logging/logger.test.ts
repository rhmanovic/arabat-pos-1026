import { describe, expect, it } from 'vitest';
import { redactUrl } from './logger.js';

describe('redactUrl', () => {
  it('hides tracking tokens and token query parameters', () => {
    expect(redactUrl('/api/v1/store/shop/orders/0123456789abcdef0123456789abcdef')).toBe(
      '/api/v1/store/shop/orders/[redacted]',
    );
    expect(redactUrl('/manager/reset-password?token=abc-123&x=1')).toBe(
      '/manager/reset-password?token=[redacted]&x=1',
    );
    expect(redactUrl('/api/v1/manager/sales?page=2')).toBe('/api/v1/manager/sales?page=2');
  });
});
