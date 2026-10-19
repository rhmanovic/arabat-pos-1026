import {
  type AgentClaimedJob,
  type AgentPendingJob,
  type CreatedPrintAgent,
  PRINT_AGENT_ONLINE_SECONDS,
  type PrintAgent,
  type PrintJob,
  type PrintSettings,
  type SalePrintStatus,
  type agentJobResultSchema,
  type createPrintAgentSchema,
} from '@arabat/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { PrintAgent as AgentIdentity } from '../../kernel/access/print-agent-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { loadReceiptData, renderReceiptHtml } from './receipt-html.js';

/** PostgreSQL channels: delivered to every API instance after the writing transaction commits. */
export const PRINT_JOBS_CHANNEL = 'print_jobs';
export const PRINT_AGENTS_CHANNEL = 'print_agents';

export type PrintJobNotice = { id: string; merchantId: string; branchId: string | null };
export type PrintAgentNotice = { revoked: string };

/** A job left in "printing" this long (agent crashed mid-print) can be claimed again. */
const STALE_CLAIM = sql`interval '2 minutes'`;

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

/**
 * Server-side receipt printing (ADR-0111): print agents, the job queue and the agent API.
 * Jobs are written in the caller's transaction and announced with `pg_notify`, so an agent is
 * only told about a job that exists, on whichever instance it is connected to.
 */
@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Queues the receipt of a sale just completed in `tx` when the company prints automatically
   * and has an agent for the branch. Never fails the sale: a problem only skips the receipt.
   */
  async queueAutoInTx(
    tx: Transaction,
    args: { merchantId: string; branchId: string; saleId: string; onlineOrderId?: string | null },
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        const [row] = (
          await sp.execute(sql`
            select coalesce((select auto_print_receipts from sales_settings where merchant_id = ${args.merchantId}), true) as auto,
                   (exists (select 1 from print_agents where merchant_id = ${args.merchantId}
                            and (branch_id is null or branch_id = ${args.branchId}))
                    or exists (select 1 from pos_devices where merchant_id = ${args.merchantId}
                            and branch_id = ${args.branchId} and role = 'primary'
                            and revoked_at is null)) as has_agent`)
        ).rows as { auto: boolean; has_agent: boolean }[];
        if (!row?.auto || !row.has_agent) return;
        await this.insertJob(sp, { ...args, kind: 'auto', userId: null });
      });
    } catch (error) {
      this.logger.error(
        `Receipt print job for sale ${args.saleId} skipped: ${(error as Error).message}`,
      );
    }
  }

  private async insertJob(
    tx: Transaction,
    args: {
      merchantId: string;
      branchId: string;
      saleId: string;
      onlineOrderId?: string | null;
      kind: 'auto' | 'reprint';
      userId: string | null;
      copyNumber?: number;
    },
  ): Promise<{ id: string; status: PrintJob['status']; createdAt: string }> {
    const id = newId();
    const html = renderReceiptHtml(
      await loadReceiptData(tx, args.saleId, args.onlineOrderId ?? null),
      new Date(),
      args.copyNumber ?? 0,
    );
    const [job] = (
      await tx.execute(sql`
        insert into print_jobs (id, merchant_id, branch_id, sale_id, kind, html, created_by_user_id)
        values (${id}, ${args.merchantId}, ${args.branchId}, ${args.saleId}, ${args.kind}, ${html}, ${args.userId})
        returning status, created_at`)
    ).rows as { status: PrintJob['status']; created_at: string }[];
    const notice: PrintJobNotice = { id, merchantId: args.merchantId, branchId: args.branchId };
    await tx.execute(sql`select pg_notify(${PRINT_JOBS_CHANNEL}, ${JSON.stringify(notice)})`);
    return { id, status: job!.status, createdAt: iso(job!.created_at) };
  }

  /**
   * A numbered receipt copy (BR-182) in the caller's transaction: logged in `receipt_reprints`
   * and queued for the print agents of the sale's branch, whatever the auto-print setting.
   * Used by the till (`POST /pos/sales/:id/print`) and the manager (`/manager/sales/:id/print`).
   */
  async queueCopyInTx(
    tx: Transaction,
    args: {
      merchantId: string;
      branchId: string;
      saleId: string;
      userId: string;
      shiftId: string | null;
    },
  ): Promise<PrintJob> {
    await tx.execute(sql`
      insert into receipt_reprints (id, merchant_id, sale_id, user_id, shift_id)
      values (${newId()}, ${args.merchantId}, ${args.saleId}, ${args.userId}, ${args.shiftId})`);
    const [count] = (
      await tx.execute(
        sql`select count(*)::int as n from receipt_reprints where merchant_id = ${args.merchantId} and sale_id = ${args.saleId}`,
      )
    ).rows as { n: number }[];
    const copyNumber = count!.n;
    const job = await this.insertJob(tx, {
      merchantId: args.merchantId,
      branchId: args.branchId,
      saleId: args.saleId,
      kind: 'reprint',
      userId: args.userId,
      copyNumber,
    });
    const [online] = (
      await tx.execute(sql`
        select (exists (select 1 from print_agents where merchant_id = ${args.merchantId}
                        and (branch_id is null or branch_id = ${args.branchId})
                        and last_seen_at > now() - make_interval(secs => ${PRINT_AGENT_ONLINE_SECONDS}))
             or exists (select 1 from pos_devices where merchant_id = ${args.merchantId}
                        and branch_id = ${args.branchId} and role = 'primary' and revoked_at is null
                        and last_seen_at > now() - make_interval(secs => ${PRINT_AGENT_ONLINE_SECONDS}))) as online`)
    ).rows as { online: boolean }[];
    return { ...job, copyNumber, agentOnline: online!.online };
  }

  /** The browser POS: the latest print job of a sale of the session's branch (Plan A). */
  async saleStatus(actor: MerchantActor, saleId: string): Promise<SalePrintStatus> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [sale] = (
        await tx.execute(
          sql`select branch_id from sales where id = ${saleId} and merchant_id = ${actor.merchantId}`,
        )
      ).rows as { branch_id: string }[];
      if (!sale) throw AppError.notFound();
      assertCan(actor, 'sales.create', sale.branch_id);
      const [job] = (
        await tx.execute(sql`
          select id, status, error from print_jobs
          where merchant_id = ${actor.merchantId} and sale_id = ${saleId}
          order by created_at desc, id desc limit 1`)
      ).rows as { id: string; status: PrintJob['status']; error: string | null }[];
      const [online] = (
        await tx.execute(sql`
          select (exists (select 1 from print_agents where merchant_id = ${actor.merchantId}
                          and (branch_id is null or branch_id = ${sale.branch_id})
                          and last_seen_at > now() - make_interval(secs => ${PRINT_AGENT_ONLINE_SECONDS}))
               or exists (select 1 from pos_devices where merchant_id = ${actor.merchantId}
                          and branch_id = ${sale.branch_id} and role = 'primary' and revoked_at is null
                          and last_seen_at > now() - make_interval(secs => ${PRINT_AGENT_ONLINE_SECONDS}))) as online`)
      ).rows as { online: boolean }[];
      return {
        status: job?.status ?? 'none',
        jobId: job?.id ?? null,
        error: job?.error ?? null,
        printerOnline: online!.online,
      };
    });
  }

  /** Manager: a numbered copy of a sale's receipt, sent to the print agents. */
  async reprint(actor: MerchantActor, saleId: string, ip: string): Promise<PrintJob> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [sale] = (
        await tx.execute(
          sql`select branch_id, receipt_number from sales where id = ${saleId} and merchant_id = ${actor.merchantId}`,
        )
      ).rows as { branch_id: string; receipt_number: string }[];
      if (!sale) throw AppError.notFound();
      assertCan(actor, 'sales.read', sale.branch_id);
      const job = await this.queueCopyInTx(tx, {
        merchantId: actor.merchantId,
        branchId: sale.branch_id,
        saleId,
        userId: actor.userId,
        shiftId: null,
      });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'sales.receipt_print_requested',
        targetType: 'sale',
        targetId: saleId,
        ip,
        details: {
          receiptNumber: sale.receipt_number,
          printJobId: job.id,
          copyNumber: job.copyNumber,
        },
      });
      return job;
    });
  }

  /* Agents (manager) */

  async listAgents(actor: MerchantActor): Promise<PrintAgent[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select id, name, branch_id, last_seen_at, created_at,
                 coalesce(last_seen_at > now() - make_interval(secs => ${PRINT_AGENT_ONLINE_SECONDS}), false) as online
          from print_agents where merchant_id = ${actor.merchantId} order by created_at, id`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r['id'] as string,
        name: r['name'] as string,
        branchId: (r['branch_id'] as string | null) ?? null,
        lastSeenAt: r['last_seen_at'] ? iso(r['last_seen_at']) : null,
        online: r['online'] as boolean,
        createdAt: iso(r['created_at']),
      }));
    });
  }

  async createAgent(
    actor: MerchantActor,
    input: z.output<typeof createPrintAgentSchema>,
    ip: string,
  ): Promise<CreatedPrintAgent> {
    // An agent for every branch prints every branch's receipts: company-wide permission.
    assertCan(actor, 'registers.manage', input.branchId);
    const id = newId();
    const token = generateToken();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      if (input.branchId) {
        const { rows } = await tx.execute(
          sql`select 1 from branches where id = ${input.branchId} and merchant_id = ${actor.merchantId}`,
        );
        if (rows.length === 0)
          throw AppError.validation([
            { path: 'branchId', code: 'invalid', message: 'Unknown branch.' },
          ]);
      }
      await tx.execute(sql`
        insert into print_agents (id, merchant_id, branch_id, name, token_hash, created_by_user_id)
        values (${id}, ${actor.merchantId}, ${input.branchId}, ${input.name}, ${hashToken(token)}, ${actor.userId})`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'print_agent.created',
        targetType: 'print_agent',
        targetId: id,
        ip,
        details: { name: input.name, branchId: input.branchId },
      });
    });
    return { id, token };
  }

  /** Deletes the agent: its token stops working and its open sockets are disconnected. */
  async deleteAgent(actor: MerchantActor, id: string, ip: string): Promise<void> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [agent] = (
        await tx.execute(
          sql`select name, branch_id from print_agents where id = ${id} and merchant_id = ${actor.merchantId} for update`,
        )
      ).rows as { name: string; branch_id: string | null }[];
      if (!agent) throw AppError.notFound();
      assertCan(actor, 'registers.manage', agent.branch_id);
      await tx.execute(sql`delete from print_agents where id = ${id}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'print_agent.deleted',
        targetType: 'print_agent',
        targetId: id,
        ip,
        details: { name: agent.name, branchId: agent.branch_id },
      });
      const notice: PrintAgentNotice = { revoked: id };
      await tx.execute(sql`select pg_notify(${PRINT_AGENTS_CHANNEL}, ${JSON.stringify(notice)})`);
    });
  }

  /* Setting */

  async settings(actor: MerchantActor): Promise<PrintSettings> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select auto_print_receipts from sales_settings where merchant_id = ${actor.merchantId}`,
        )
      ).rows as { auto_print_receipts: boolean }[];
      return { autoPrintReceipts: row?.auto_print_receipts ?? true };
    });
  }

  async updateSettings(actor: MerchantActor, input: PrintSettings, ip: string) {
    assertCan(actor, 'merchant.settings.update', null);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [before] = (
        await tx.execute(sql`
          insert into sales_settings (merchant_id, auto_print_receipts) values (${actor.merchantId}, ${input.autoPrintReceipts})
          on conflict (merchant_id) do update set auto_print_receipts = excluded.auto_print_receipts, updated_at = now()
          returning (select s.auto_print_receipts from sales_settings s where s.merchant_id = ${actor.merchantId}) as previous`)
      ).rows as { previous: boolean | null }[];
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'sales.settings_updated',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: {
          autoPrintReceipts: { from: before?.previous ?? true, to: input.autoPrintReceipts },
        },
      });
      return { autoPrintReceipts: input.autoPrintReceipts };
    });
  }

  /* Agent API */

  private scope(agent: AgentIdentity): SQL {
    return agent.branchId
      ? sql`merchant_id = ${agent.merchantId} and branch_id = ${agent.branchId}`
      : sql`merchant_id = ${agent.merchantId}`;
  }

  /** The claim column of this printer: a print agent or the primary device (Plan A). */
  private claimedBy(agent: AgentIdentity): SQL {
    return agent.kind === 'device' ? sql`device_id = ${agent.id}` : sql`agent_id = ${agent.id}`;
  }

  private claimable(): SQL {
    return sql`(status = 'pending' or (status = 'printing' and claimed_at < now() - ${STALE_CLAIM}))`;
  }

  /** Jobs waiting for this agent, oldest first (also used after every reconnect). */
  async pending(agent: AgentIdentity): Promise<AgentPendingJob[]> {
    return this.database.withMerchantTx(agent.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select id, html, sale_id, created_at from print_jobs
          where ${this.scope(agent)} and ${this.claimable()}
          order by created_at, id limit 50`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r['id'] as string,
        html: r['html'] as string,
        orderUuid: (r['sale_id'] as string | null) ?? null,
        createdAt: iso(r['created_at']),
        openDrawer: false,
      }));
    });
  }

  /** pending → printing in one statement: of two agents claiming at once, one gets 409. */
  async claim(agent: AgentIdentity, id: string): Promise<AgentClaimedJob> {
    return this.database.withMerchantTx(agent.merchantId, async (tx) => {
      const [job] = (
        await tx.execute(sql`
          update print_jobs set status = 'printing', claimed_at = now(),
            agent_id = ${agent.kind === 'agent' ? agent.id : null},
            device_id = ${agent.kind === 'device' ? agent.id : null}
          where id = ${id} and ${this.scope(agent)} and ${this.claimable()}
          returning id, html`)
      ).rows as { id: string; html: string }[];
      if (job) return { id: job.id, html: job.html, openDrawer: false };
      const { rows } = await tx.execute(
        sql`select 1 from print_jobs where id = ${id} and ${this.scope(agent)}`,
      );
      if (rows.length === 0) throw AppError.notFound();
      throw AppError.conflict('The print job was already claimed.');
    });
  }

  /** printing → printed, or failed with the agent's error (attempts + 1). */
  async result(
    agent: AgentIdentity,
    id: string,
    input: z.output<typeof agentJobResultSchema>,
  ): Promise<{ id: string; status: 'printed' | 'failed' }> {
    return this.database.withMerchantTx(agent.merchantId, async (tx) => {
      const [job] = (
        await tx.execute(
          input.ok
            ? sql`update print_jobs set status = 'printed', printed_at = now(), error = null
                  where id = ${id} and ${this.scope(agent)} and status = 'printing' and ${this.claimedBy(agent)}
                  returning id, status`
            : sql`update print_jobs set status = 'failed', attempts = attempts + 1,
                         error = ${input.error?.trim() || 'Printing failed.'}
                  where id = ${id} and ${this.scope(agent)} and status = 'printing' and ${this.claimedBy(agent)}
                  returning id, status`,
        )
      ).rows as { id: string; status: 'printed' | 'failed' }[];
      if (job) return job;
      const { rows } = await tx.execute(
        sql`select 1 from print_jobs where id = ${id} and ${this.scope(agent)}`,
      );
      if (rows.length === 0) throw AppError.notFound();
      throw AppError.conflict('The print job is not being printed by this agent.');
    });
  }

  /** Keeps socket-connected agents "online" while they wait without REST calls. */
  async touch(agents: AgentIdentity[]): Promise<void> {
    const byMerchant = new Map<string, AgentIdentity[]>();
    for (const a of agents)
      byMerchant.set(a.merchantId, [...(byMerchant.get(a.merchantId) ?? []), a]);
    const list = (xs: AgentIdentity[]) =>
      sql.join(
        xs.map((x) => sql`${x.id}`),
        sql`, `,
      );
    for (const [merchantId, all] of byMerchant)
      await this.database.withMerchantTx(merchantId, async (tx) => {
        const agentsOnly = all.filter((a) => a.kind === 'agent');
        const devices = all.filter((a) => a.kind === 'device');
        if (agentsOnly.length)
          await tx.execute(sql`update print_agents set last_seen_at = now()
                               where merchant_id = ${merchantId} and id in (${list(agentsOnly)})`);
        if (devices.length)
          await tx.execute(sql`update pos_devices set last_seen_at = now()
                               where merchant_id = ${merchantId} and revoked_at is null
                                 and id in (${list(devices)})`);
      });
  }
}
