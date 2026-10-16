import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { BrevoMailer, ResendMailer, SmtpMailer, createMailer, parseMailFrom } from './mailer.js';

const message = { to: 'owner@example.com', subject: 'Reset', text: 'link' };

function stubFetch(status = 200, body = '{}') {
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function sentBody(fetch: ReturnType<typeof vi.fn>): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('parseMailFrom', () => {
  it('splits "Name <address>" and accepts a bare address', () => {
    expect(parseMailFrom('Arabat POS <no-reply@arabat.local>')).toEqual({
      name: 'Arabat POS',
      email: 'no-reply@arabat.local',
    });
    expect(parseMailFrom('"Arabat" <a@b.c>')).toEqual({ name: 'Arabat', email: 'a@b.c' });
    expect(parseMailFrom('<a@b.c>')).toEqual({ email: 'a@b.c' });
    expect(parseMailFrom(' a@b.c ')).toEqual({ email: 'a@b.c' });
  });
});

describe('HTTP mailers', () => {
  it('Resend: bearer key, display name kept in from', async () => {
    const fetch = stubFetch();
    await new ResendMailer('re_key', { name: 'Arabat POS', email: 'no-reply@x.kw' }).send({
      ...message,
      html: '<p>link</p>',
    });
    const sent = sentBody(fetch);
    expect(sent.url).toBe('https://api.resend.com/emails');
    expect(sent.headers['authorization']).toBe('Bearer re_key');
    expect(sent.body).toEqual({
      from: 'Arabat POS <no-reply@x.kw>',
      to: ['owner@example.com'],
      subject: 'Reset',
      text: 'link',
      html: '<p>link</p>',
    });
  });

  it('Brevo: api-key header, sender object, no html when absent', async () => {
    const fetch = stubFetch(201);
    await new BrevoMailer('xkeysib', { email: 'no-reply@x.kw' }).send(message);
    const sent = sentBody(fetch);
    expect(sent.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(sent.headers['api-key']).toBe('xkeysib');
    expect(sent.body).toEqual({
      sender: { email: 'no-reply@x.kw' },
      to: [{ email: 'owner@example.com' }],
      subject: 'Reset',
      textContent: 'link',
    });
  });

  it('fails loudly when the provider refuses, so the caller can log it', async () => {
    stubFetch(401, '{"message":"API key is invalid"}');
    await expect(new ResendMailer('bad', { email: 'a@b.c' }).send(message)).rejects.toThrow(
      /401.*API key is invalid/,
    );
  });
});

describe('createMailer', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('picks the provider from MAIL_PROVIDER', () => {
    expect(createMailer(loadEnv(base))).toBeInstanceOf(SmtpMailer);
    expect(
      createMailer(loadEnv({ ...base, MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' })),
    ).toBeInstanceOf(ResendMailer);
    expect(
      createMailer(loadEnv({ ...base, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'k' })),
    ).toBeInstanceOf(BrevoMailer);
  });

  it('warns in production when e-mail delivery is left at the local default', () => {
    const logger = new Logger('test');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const prod = { ...base, NODE_ENV: 'production' };
    createMailer(loadEnv(prod), logger);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not configured/));
    warn.mockClear();
    createMailer(loadEnv({ ...prod, SMTP_URL: 'smtps://u:p@smtp.example.com:465' }), logger);
    createMailer(loadEnv({ ...prod, MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'k' }), logger);
    expect(warn).not.toHaveBeenCalled();
  });
});
