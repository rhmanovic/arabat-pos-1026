import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Env } from './env.js';

export const ENV = Symbol('ENV');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: Object.freeze(env) }],
      exports: [ENV],
    };
  }
}
