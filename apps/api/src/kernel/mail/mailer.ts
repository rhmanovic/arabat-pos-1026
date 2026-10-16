import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../../config/config.module.js';
import { type Env, SMTP_URL_LOCAL_DEFAULT } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Outgoing e-mail boundary. Tests replace it with an in-memory outbox. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** SMTP delivery; in local development the SMTP server is Mailpit (docker compose). */
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.transport = nodemailer.createTransport(env.SMTP_URL);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...message });
    this.logger.log(`E-mail "${message.subject}" sent`);
  }
}

/** `Name <address>` or a bare address, as `MAIL_FROM` is written. */
export function parseMailFrom(from: string): { name?: string; email: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(from);
  if (match) {
    const name = match[1]?.trim();
    return name ? { name, email: match[2]! } : { email: match[2]! };
  }
  return { email: from.trim() };
}

const HTTP_TIMEOUT_MS = 15_000;

/**
 * Delivery through a provider's HTTP API. Hosting platforms often block outbound SMTP
 * (Railway does below the Pro plan), so staging and production use one of these.
 */
abstract class HttpMailer extends Mailer {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly apiKey: string,
    protected readonly from: { name?: string; email: string },
  ) {
    super();
  }

  protected abstract request(message: MailMessage): {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };

  async send(message: MailMessage): Promise<void> {
    const { url, headers, body } = this.request(message);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `${this.constructor.name}: provider answered ${response.status}${detail ? ` ${detail}` : ''}`,
      );
    }
    this.logger.log(`E-mail "${message.subject}" sent`);
  }
}

/** https://resend.com/docs/api-reference/emails/send-email */
export class ResendMailer extends HttpMailer {
  protected request(message: MailMessage) {
    return {
      url: 'https://api.resend.com/emails',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: {
        from: this.from.name ? `${this.from.name} <${this.from.email}>` : this.from.email,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      },
    };
  }
}

/** https://developers.brevo.com/reference/sendtransacemail */
export class BrevoMailer extends HttpMailer {
  protected request(message: MailMessage) {
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': this.apiKey },
      body: {
        sender: this.from,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      },
    };
  }
}

/** The mailer named by `MAIL_PROVIDER`; `MAIL_API_KEY` is validated by `loadEnv`. */
export function createMailer(env: Env, logger = new Logger('Mailer')): Mailer {
  switch (env.MAIL_PROVIDER) {
    case 'resend':
      return new ResendMailer(env.MAIL_API_KEY!, parseMailFrom(env.MAIL_FROM));
    case 'brevo':
      return new BrevoMailer(env.MAIL_API_KEY!, parseMailFrom(env.MAIL_FROM));
    case 'smtp':
      if (env.NODE_ENV === 'production' && env.SMTP_URL === SMTP_URL_LOCAL_DEFAULT)
        logger.warn(
          'E-mail delivery is not configured (SMTP_URL is the local default): password reset and invitation e-mails will not be delivered. Set MAIL_PROVIDER=resend|brevo with MAIL_API_KEY, or a reachable SMTP_URL.',
        );
      return new SmtpMailer(env);
  }
}
