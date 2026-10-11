import type { LoggerService } from '@nestjs/common';
import { type Logger, type LoggerOptions, pino } from 'pino';
import type { Env } from '../../config/env.js';

/** Fields that must never reach the logs. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
];

export function createLoggerOptions(env: Env): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    base: { service: 'arabat-api', version: env.APP_VERSION },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(env.LOG_PRETTY
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } } }
      : {}),
  };
}

/** Adapts a pino logger to Nest's LoggerService so framework logs are structured JSON too. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
  fatal(message: unknown, context?: string): void {
    this.logger.fatal({ context }, String(message));
  }
}
