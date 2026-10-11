import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

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
