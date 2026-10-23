import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { CustomHostnames, createCustomHostnames } from './custom-hostnames.js';

@Global()
@Module({
  providers: [
    {
      provide: CustomHostnames,
      inject: [ENV],
      useFactory: (env: Env) => createCustomHostnames(env),
    },
  ],
  exports: [CustomHostnames],
})
export class DomainsModule {}
