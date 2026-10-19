import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server as HttpServer } from 'node:http';
import pg from 'pg';
import { type Namespace, Server } from 'socket.io';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { type PrintAgent, PrintAgentResolver } from '../../kernel/access/print-agent-resolver.js';
import {
  PRINT_AGENTS_CHANNEL,
  PRINT_JOBS_CHANNEL,
  type PrintAgentNotice,
  type PrintJobNotice,
  PrintJobsService,
} from './print-jobs.service.js';

export const PRINT_AGENT_NAMESPACE = '/print-agent';
export const PRINT_JOB_EVENT = 'print:job';

const rooms = {
  agent: (id: string) => `print-agent:${id}`,
  company: (merchantId: string) => `print-company:${merchantId}`,
  branch: (branchId: string) => `print-branch:${branchId}`,
};

/** Connected agents stay "online" (last seen < 60 s) through this heartbeat. */
const TOUCH_MS = 30_000;
const RECONNECT_MS = 5_000;

/**
 * Socket.IO push for print agents (ADR-0111). Namespace `/print-agent`; an agent connects with
 * `auth: { token }` and joins `print-agent:<id>`, `print-company:<merchantId>` and, when bound,
 * `print-branch:<branchId>`. A new job is announced as `print:job { id }`; the agent then claims
 * it over REST, and after a reconnect it reads `GET /print-agent/jobs/pending`, so nothing is
 * lost while it was away.
 *
 * Jobs are announced through PostgreSQL LISTEN/NOTIFY: the notification arrives after the job's
 * transaction commits and reaches every API instance, whichever one holds the agent's socket.
 */
@Injectable()
export class PrintAgentGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PrintAgentGateway.name);
  private io: Server | null = null;
  private namespace: Namespace | null = null;
  private listener: pg.Client | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly adapterHost: HttpAdapterHost,
    private readonly agents: PrintAgentResolver,
    private readonly jobs: PrintJobsService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.io = new Server(server, { path: '/socket.io', serveClient: false });
    const ns = this.io.of(PRINT_AGENT_NAMESPACE);
    ns.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      this.agents
        .fromToken(token)
        .then((agent) => {
          if (!agent) return next(new Error('unauthorized'));
          if (agent === 'not_primary') return next(new Error('forbidden: not the primary device'));
          socket.data['agent'] = agent;
          next();
        })
        .catch((error: Error) => next(error));
    });
    ns.on('connection', (socket) => {
      const agent = socket.data['agent'] as PrintAgent;
      void socket.join([
        rooms.agent(agent.id),
        rooms.company(agent.merchantId),
        ...(agent.branchId ? [rooms.branch(agent.branchId)] : []),
      ]);
    });
    this.namespace = ns;
    this.heartbeat = setInterval(() => void this.touchConnected(), TOUCH_MS);
    this.heartbeat.unref();
    void this.listen();
  }

  /** Sends `print:job` to the company's agents that print the job's branch. */
  async announce(notice: PrintJobNotice): Promise<void> {
    if (!this.namespace) return;
    const sockets = await this.namespace.in(rooms.company(notice.merchantId)).fetchSockets();
    for (const socket of sockets) {
      const agent = socket.data['agent'] as PrintAgent;
      if (!agent.branchId || !notice.branchId || agent.branchId === notice.branchId)
        socket.emit(PRINT_JOB_EVENT, { id: notice.id });
    }
  }

  private async touchConnected(): Promise<void> {
    if (!this.namespace) return;
    const seen = new Map<string, PrintAgent>();
    for (const socket of this.namespace.sockets.values()) {
      const agent = socket.data['agent'] as PrintAgent;
      seen.set(agent.id, agent);
    }
    if (seen.size === 0) return;
    await this.jobs
      .touch([...seen.values()])
      .catch((error: Error) => this.logger.warn(`Print agent heartbeat failed: ${error.message}`));
  }

  private async listen(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: this.env.DATABASE_URL,
      application_name: 'arabat-print-listener',
    });
    client.on('notification', (message) => {
      try {
        const payload = JSON.parse(message.payload ?? '{}') as unknown;
        if (message.channel === PRINT_JOBS_CHANNEL) void this.announce(payload as PrintJobNotice);
        if (message.channel === PRINT_AGENTS_CHANNEL)
          this.namespace
            ?.in(rooms.agent((payload as PrintAgentNotice).revoked))
            .disconnectSockets(true);
      } catch (error) {
        this.logger.warn(`Bad print notification: ${(error as Error).message}`);
      }
    });
    const retry = (error: Error) => {
      if (this.stopped) return;
      this.logger.warn(`Print job listener lost (${error.message}); reconnecting`);
      this.listener = null;
      void client.end().catch(() => undefined);
      this.reconnect ??= setTimeout(() => {
        this.reconnect = null;
        void this.listen();
      }, RECONNECT_MS);
      this.reconnect.unref();
    };
    client.on('error', retry);
    try {
      await client.connect();
      await client.query(`listen ${PRINT_JOBS_CHANNEL}`);
      await client.query(`listen ${PRINT_AGENTS_CHANNEL}`);
      if (this.stopped) {
        await client.end();
        return;
      }
      this.listener = client;
    } catch (error) {
      retry(error as Error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
    // Closing the engine only: the HTTP server belongs to Fastify, which closes it itself.
    this.io?.disconnectSockets(true);
    this.io?.engine.close();
    this.io = null;
  }
}
