import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AccessModule } from './kernel/access/access.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

/** Root module of the modular monolith. Domain modules are registered here per milestone. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), DatabaseModule, AccessModule, HealthModule, AuthModule],
    };
  }
}
