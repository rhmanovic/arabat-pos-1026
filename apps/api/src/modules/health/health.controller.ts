import type { LiveResponse, ReadyResponse } from '@arabat/contracts';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { Public } from '../../kernel/access/access.decorators.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Liveness: the process is running. Never touches dependencies. */
  @Public()
  @Get('live')
  live(): LiveResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: dependencies are reachable. Returns 503 when the database is down. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadyResponse> {
    try {
      const latencyMs = await this.database.ping();
      return {
        status: 'ok',
        version: this.env.APP_VERSION,
        checks: { database: { status: 'ok', latencyMs } },
      };
    } catch {
      void reply.status(503);
      return {
        status: 'down',
        version: this.env.APP_VERSION,
        checks: { database: { status: 'down', error: 'Database unreachable' } },
      };
    }
  }
}
