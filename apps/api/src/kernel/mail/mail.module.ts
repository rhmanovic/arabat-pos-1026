import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { Mailer, createMailer } from './mailer.js';

@Global()
@Module({
  providers: [{ provide: Mailer, inject: [ENV], useFactory: (env: Env) => createMailer(env) }],
  exports: [Mailer],
})
export class MailModule {}
