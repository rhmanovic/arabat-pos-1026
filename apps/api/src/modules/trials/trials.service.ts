import {
  type DeviceTrialRequest,
  type DeviceTrialStatus,
  type FunnelStats,
  type FunnelStep,
  type Lead,
  type LeadStage,
  type PublicTrialOffer,
  type TrialDeviceStock,
  type TrialSettings,
  type TrialStarted,
  type TrialVerified,
  DEMO_CATALOGS,
  DEVICE_TRIAL_STATUSES,
  FUNNEL_STEPS,
  LEAD_STAGES,
  demoReceiptSchema,
  saveTrialSettingsSchema,
  saveTrialStockSchema,
  startTrialSchema,
  updateDeviceTrialSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { createHash, randomInt } from 'node:crypto';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { safeEqual } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import type { LoginOutcome } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AUTH_LIMITS, RateLimiterService } from '../auth/rate-limiter.service.js';
import { EMAIL_TAKEN, RegistrationService } from '../auth/registration.service.js';
import type { ClientInfo } from '../auth/session.service.js';
import { users } from '../iam/iam.schema.js';
import { offerItems } from '../pricing/pricing.schema.js';
import { subscriptionEvents, subscriptions } from '../subscriptions/subscriptions.schema.js';
import {
  deviceTrialRequestLines,
  deviceTrialRequests,
  funnelEvents,
  leads,
  trialSettings,
  trialSignups,
} from './trials.schema.js';

type O<T extends z.ZodType> = z.output<T>;
type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_SENT = 5;
const LIMITS = {
  funnelPerIp: { limit: 300, windowSeconds: 3600 },
  receiptPerIp: { limit: 10, windowSeconds: 3600 },
  receiptPerEmail: { limit: 3, windowSeconds: 3600 },
  resendPerIp: { limit: 10, windowSeconds: 3600 },
  verifyPerIp: { limit: 30, windowSeconds: 600 },
};
/** Devices lent and not yet back count against the trial stock. */
const OUT: DeviceTrialStatus[] = ['approved', 'delivered'];
const STAGE_RANK: Record<LeadStage, number> = { receipt: 0, started: 1, trial: 2 };
/** Allowed follow-up moves of a device trial in the platform. */
const NEXT: Record<DeviceTrialStatus, DeviceTrialStatus[]> = {
  pending: ['approved', 'waitlist', 'rejected'],
  waitlist: ['approved', 'pending', 'rejected'],
  approved: ['delivered', 'rejected'],
  delivered: ['returned'],
  returned: [],
  rejected: [],
};
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const kwd = (minor: bigint) => `${Money.ofMinor(minor, CURRENCY).toDecimalString()} KWD`;
const versionConflict = () =>
  new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload it.');
const codeHash = (signupId: string, code: string) =>
  createHash('sha256').update(`${signupId}:${code}`).digest('hex');
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Free trials and the public sign-up funnel (ADR-0115): demo receipts become leads, trial
 * sign-ups are confirmed with an e-mailed code before the account exists, device trials wait
 * for the operator and their trial time starts on delivery.
 */
@Injectable()
export class TrialsService {
  private readonly logger = new Logger(TrialsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly registration: RegistrationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------ public funnel
  async offer(): Promise<PublicTrialOffer> {
    const settings = await this.settingsRow(this.database.db);
    const items = await this.database.db
      .select()
      .from(offerItems)
      .where(eq(offerItems.status, 'active'))
      .orderBy(asc(offerItems.sortOrder), asc(offerItems.nameEn));
    const system = items.find((i) => i.kind === 'system');
    if (!system) throw AppError.notFound('The pricing page is not set up.');
    const out = await this.outByItem(this.database.db);
    return {
      trialDaysOwn: settings.trialDaysOwn,
      trialDaysDevices: settings.trialDaysDevices,
      waitlistEnabled: settings.waitlistEnabled,
      systemPrice: Money.ofMinor(system.priceMinor, CURRENCY).toJSON(),
      devices: items
        .filter((i) => i.kind === 'device')
        .map((i) => ({
          id: i.id,
          kind: 'device' as const,
          nameAr: i.nameAr,
          nameEn: i.nameEn,
          descriptionAr: i.descriptionAr,
          descriptionEn: i.descriptionEn,
          price: Money.ofMinor(i.priceMinor, CURRENCY).toJSON(),
          icon: i.icon as PublicTrialOffer['devices'][number]['icon'],
          imageUrl: i.imageKey ? `/api/v1/public/pricing/images/${i.id}?v=${i.version}` : null,
          maxQuantity: i.maxQuantity,
          available: i.trialStock - (out.get(i.id) ?? 0) > 0,
        })),
    };
  }

  async track(sessionId: string, step: FunnelStep, ip: string): Promise<void> {
    await this.limiter.consume(`funnel:ip:${ip}`, LIMITS.funnelPerIp);
    await this.step(sessionId, step);
  }

  async demoReceipt(input: O<typeof demoReceiptSchema>, ip: string): Promise<void> {
    await this.limiter.consume(`demo-receipt:ip:${ip}`, LIMITS.receiptPerIp);
    await this.limiter.consume(`demo-receipt:email:${input.email}`, LIMITS.receiptPerEmail);
    const catalog = new Map(DEMO_CATALOGS[input.businessType].map((p) => [p.key, p]));
    const lines = input.lines.map((line, index) => {
      const product = catalog.get(line.key);
      if (!product)
        throw AppError.validation([
          { path: `lines.${index}.key`, code: 'invalid', message: 'Unknown demo product.' },
        ]);
      const total = Money.parse(product.price, CURRENCY).multiply(String(line.quantity));
      return { product, quantity: line.quantity, total };
    });
    const total = lines.reduce((sum, l) => sum + l.total.minor, 0n);
    await this.database.db.transaction((tx) =>
      this.upsertLead(tx, input.email, 'receipt', {
        businessType: input.businessType,
        language: input.language,
      }),
    );
    await this.step(input.sessionId, 'receipt');
    const ar = (l: (typeof lines)[number]) =>
      `${l.product.nameAr} × ${l.quantity} = ${kwd(l.total.minor)}`;
    const en = (l: (typeof lines)[number]) =>
      `${l.product.nameEn} × ${l.quantity} = ${kwd(l.total.minor)}`;
    await this.send({
      to: input.email,
      ...renderEmail({
        title: { ar: 'إيصال البيع التجريبي', en: 'Your demo receipt' },
        name: input.language === 'ar' ? 'عميلنا' : 'there',
        intro: {
          ar: `هذا إيصال البيع اللي جربته على كاشير عربات:\n${lines.map(ar).join('\n')}\nالإجمالي: ${kwd(total)}\n(بيع تجريبي، ما فيه أي دفع.)`,
          en: `Here is the receipt of the sale you tried on the Arabat till:\n${lines.map(en).join('\n')}\nTotal: ${kwd(total)}\n(Demo sale, nothing was charged.)`,
        },
        action: {
          label: { ar: 'أنشئ حساب وجهّز محلك', en: 'Create an account and set up your shop' },
          url: `${this.siteUrl()}/start`,
        },
      }),
    });
    await this.notifySales(
      { ar: 'عميل محتمل جديد (إيصال تجريبي)', en: 'New lead (demo receipt)' },
      `${input.email} — ${input.businessType}`,
    );
  }

  async start(input: O<typeof startTrialSchema>, ip: string): Promise<TrialStarted> {
    await this.limiter.consume(`register:ip:${ip}`, AUTH_LIMITS.registerPerIp);
    const [existing] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email));
    if (existing) throw EMAIL_TAKEN();
    const devices = await this.checkDevices(input.devices);
    const passwordHash = await this.passwords.hash(input.password);
    const signupId = newId();
    const code = newCode();
    await this.database.db.transaction(async (tx) => {
      await tx.insert(trialSignups).values({
        id: signupId,
        email: input.email,
        fullName: input.fullName,
        companyName: input.companyName,
        passwordHash,
        businessType: input.businessType,
        language: input.language,
        devices: devices.map((d) => ({ itemId: d.item.id, quantity: d.quantity })),
        codeHash: codeHash(signupId, code),
        expiresAt: sql`now() + make_interval(mins => ${CODE_TTL_MINUTES})`,
        sessionId: input.sessionId,
        ip,
      });
      await this.upsertLead(tx, input.email, 'started', {
        fullName: input.fullName,
        companyName: input.companyName,
        businessType: input.businessType,
        language: input.language,
      });
    });
    await this.step(input.sessionId, 'account');
    await this.sendCode(input.email, input.fullName, code);
    return { signupId, email: input.email };
  }

  async resend(signupId: string, ip: string): Promise<void> {
    await this.limiter.consume(`trial-resend:ip:${ip}`, LIMITS.resendPerIp);
    const code = newCode();
    const [signup] = await this.database.db
      .update(trialSignups)
      .set({
        codeHash: codeHash(signupId, code),
        attempts: 0,
        sentCount: sql`${trialSignups.sentCount} + 1`,
        expiresAt: sql`now() + make_interval(mins => ${CODE_TTL_MINUTES})`,
      })
      .where(
        and(
          eq(trialSignups.id, signupId),
          sql`${trialSignups.verifiedAt} is null`,
          sql`${trialSignups.sentCount} < ${MAX_CODES_SENT}`,
        ),
      )
      .returning();
    if (!signup) throw new AppError(409, 'CODE_LIMIT', 'No more codes can be sent. Start again.');
    await this.sendCode(signup.email, signup.fullName, code);
  }

  async verify(
    signupId: string,
    code: string,
    client: ClientInfo,
  ): Promise<{ outcome: LoginOutcome; result: TrialVerified }> {
    await this.limiter.consume(`trial-verify:ip:${client.ip}`, LIMITS.verifyPerIp);
    const [signup] = await this.database.db
      .select()
      .from(trialSignups)
      .where(eq(trialSignups.id, signupId));
    const invalid = (remaining: number) =>
      new AppError(400, 'INVALID_CODE', 'The code is incorrect or has expired.', [
        { path: 'code', code: 'invalid', message: `${remaining} attempts left.` },
      ]);
    if (!signup || signup.verifiedAt) throw invalid(0);
    if (signup.attempts >= MAX_CODE_ATTEMPTS || signup.expiresAt.getTime() < Date.now())
      throw invalid(0);
    if (!safeEqual(Buffer.from(codeHash(signupId, code)), Buffer.from(signup.codeHash))) {
      await this.database.db
        .update(trialSignups)
        .set({ attempts: sql`${trialSignups.attempts} + 1` })
        .where(eq(trialSignups.id, signupId));
      throw invalid(MAX_CODE_ATTEMPTS - signup.attempts - 1);
    }

    const settings = await this.settingsRow(this.database.db);
    const wanted = signup.devices as { itemId: string; quantity: number }[];
    // Availability is decided now; a waiting list keeps the order of sign-ups.
    const devices = wanted.length ? await this.checkDevices(wanted) : [];
    const deviceStatus: TrialVerified['devices'] = !devices.length
      ? 'none'
      : devices.some((d) => !d.available)
        ? 'waitlist'
        : 'pending';
    const name = signup.companyName ?? signup.fullName;

    const outcome = await this.registration.createAccount(
      {
        email: signup.email,
        fullName: signup.fullName,
        passwordHash: signup.passwordHash,
        nameAr: signup.language === 'ar' ? name : null,
        nameEn: signup.language === 'en' ? name : null,
        legalName: null,
        language: signup.language as 'ar' | 'en',
      },
      client,
      {
        reason: 'Free trial (sign-up funnel)',
        trialDays: settings.trialDaysOwn,
        after: async (tx, { merchantId }) => {
          const [done] = await tx
            .update(trialSignups)
            .set({ verifiedAt: sql`now()`, merchantId })
            .where(and(eq(trialSignups.id, signupId), sql`${trialSignups.verifiedAt} is null`))
            .returning({ id: trialSignups.id });
          if (!done) throw invalid(0);
          const leadId = await this.upsertLead(tx, signup.email, 'trial', {
            fullName: signup.fullName,
            companyName: signup.companyName,
            businessType: signup.businessType,
            language: signup.language,
            merchantId,
          });
          if (devices.length) {
            const requestId = newId();
            await tx.insert(deviceTrialRequests).values({
              id: requestId,
              merchantId,
              leadId,
              status: deviceStatus,
            });
            await tx.insert(deviceTrialRequestLines).values(
              devices.map((d) => ({
                id: newId(),
                requestId,
                itemId: d.item.id,
                nameAr: d.item.nameAr,
                nameEn: d.item.nameEn,
                quantity: d.quantity,
              })),
            );
          }
        },
      },
    );
    if (signup.sessionId) await this.step(signup.sessionId, 'verified');
    await this.notifySales(
      { ar: 'تجربة جديدة', en: 'New trial' },
      `${name} — ${signup.email} — ${signup.businessType}${
        devices.length
          ? ` — devices (${deviceStatus}): ${devices.map((d) => `${d.item.nameEn} × ${d.quantity}`).join(', ')}`
          : ' — own devices'
      }`,
    );
    return {
      outcome,
      result: {
        trialDays: devices.length ? settings.trialDaysDevices : settings.trialDaysOwn,
        devices: deviceStatus,
        redirectTo: '/manager/',
      },
    };
  }

  // ------------------------------------------------------------ platform
  async settings(): Promise<TrialSettings> {
    const s = await this.settingsRow(this.database.db);
    return {
      trialDaysOwn: s.trialDaysOwn,
      trialDaysDevices: s.trialDaysDevices,
      waitlistEnabled: s.waitlistEnabled,
      version: s.version,
    };
  }

  async saveSettings(
    actor: PlatformActor,
    input: O<typeof saveTrialSettingsSchema>,
    ip: string,
  ): Promise<TrialSettings> {
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const [current] = await tx.select().from(trialSettings).for('update');
      if (!current || current.version !== input.version) throw versionConflict();
      await tx
        .update(trialSettings)
        .set({
          trialDaysOwn: input.trialDaysOwn,
          trialDaysDevices: input.trialDaysDevices,
          waitlistEnabled: input.waitlistEnabled,
          version: sql`${trialSettings.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(trialSettings.id, 1));
      await this.record(tx, actor, 'trials.settings.updated', 'trial_settings', null, ip, {
        trialDaysOwn: input.trialDaysOwn,
        trialDaysDevices: input.trialDaysDevices,
        waitlistEnabled: input.waitlistEnabled,
      });
    });
    return this.settings();
  }

  async stock(): Promise<TrialDeviceStock[]> {
    const items = await this.database.db
      .select()
      .from(offerItems)
      .where(eq(offerItems.kind, 'device'))
      .orderBy(asc(offerItems.sortOrder), asc(offerItems.nameEn));
    const out = await this.outByItem(this.database.db);
    const waiting = await this.byItem(this.database.db, ['waitlist']);
    return items.map((i) => {
      const lent = out.get(i.id) ?? 0;
      return {
        itemId: i.id,
        nameAr: i.nameAr,
        nameEn: i.nameEn,
        status: i.status as TrialDeviceStock['status'],
        trialStock: i.trialStock,
        out: lent,
        available: Math.max(0, i.trialStock - lent),
        waiting: waiting.get(i.id) ?? 0,
        version: i.version,
      };
    });
  }

  async saveStock(
    actor: PlatformActor,
    itemId: string,
    input: O<typeof saveTrialStockSchema>,
    ip: string,
  ): Promise<TrialDeviceStock[]> {
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const [item] = await tx
        .select()
        .from(offerItems)
        .where(and(eq(offerItems.id, itemId), eq(offerItems.kind, 'device')))
        .for('update');
      if (!item) throw AppError.notFound('Device not found.');
      if (item.version !== input.version) throw versionConflict();
      await tx
        .update(offerItems)
        .set({
          trialStock: input.trialStock,
          version: sql`${offerItems.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(offerItems.id, itemId));
      await this.record(tx, actor, 'trials.stock.updated', 'offer_item', itemId, ip, {
        from: item.trialStock,
        to: input.trialStock,
      });
    });
    return this.stock();
  }

  async leads(actor: PlatformActor, stage?: LeadStage) {
    const rows = await this.database.db
      .select()
      .from(leads)
      .where(stage ? eq(leads.stage, stage) : undefined)
      .orderBy(desc(leads.updatedAt))
      .limit(300);
    const grouped = await this.database.db
      .select({ stage: leads.stage, n: sql<number>`count(*)::int` })
      .from(leads)
      .groupBy(leads.stage);
    const counts = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
    for (const g of grouped) counts[g.stage as LeadStage] = Number(g.n);
    const merchantIds = rows.map((r) => r.merchantId).filter((v): v is string => Boolean(v));
    const activity = await this.activity(actor, merchantIds);
    const devices = new Map<string, DeviceTrialStatus>();
    if (merchantIds.length) {
      const requests = await this.database.db
        .select({ merchantId: deviceTrialRequests.merchantId, status: deviceTrialRequests.status })
        .from(deviceTrialRequests)
        .where(inArray(deviceTrialRequests.merchantId, merchantIds))
        .orderBy(asc(deviceTrialRequests.createdAt));
      for (const r of requests) devices.set(r.merchantId, r.status as DeviceTrialStatus);
    }
    const list: Lead[] = rows.map((r) => {
      const a = r.merchantId ? activity.get(r.merchantId) : undefined;
      return {
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        companyName: r.companyName,
        businessType: r.businessType as Lead['businessType'],
        language: r.language as Lead['language'],
        stage: r.stage as LeadStage,
        merchantId: r.merchantId,
        devices: r.merchantId ? (devices.get(r.merchantId) ?? null) : null,
        trialEndsAt: iso(a?.['trial_ends_at']),
        lastSeenAt: iso(a?.['last_seen_at']),
        salesCount: Number(a?.['sales_count'] ?? 0),
        lastSaleAt: iso(a?.['last_sale_at']),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
    return { leads: list, counts };
  }

  async deviceRequests(actor: PlatformActor, status?: DeviceTrialStatus) {
    const rows = await this.database.db
      .select({ request: deviceTrialRequests, lead: leads })
      .from(deviceTrialRequests)
      .leftJoin(leads, eq(leads.id, deviceTrialRequests.leadId))
      .where(status ? eq(deviceTrialRequests.status, status) : undefined)
      .orderBy(asc(deviceTrialRequests.createdAt))
      .limit(300);
    const grouped = await this.database.db
      .select({ status: deviceTrialRequests.status, n: sql<number>`count(*)::int` })
      .from(deviceTrialRequests)
      .groupBy(deviceTrialRequests.status);
    const counts = Object.fromEntries(DEVICE_TRIAL_STATUSES.map((s) => [s, 0])) as Record<
      DeviceTrialStatus,
      number
    >;
    for (const g of grouped) counts[g.status as DeviceTrialStatus] = Number(g.n);
    const ids = rows.map((r) => r.request.id);
    const lines = ids.length
      ? await this.database.db
          .select()
          .from(deviceTrialRequestLines)
          .where(inArray(deviceTrialRequestLines.requestId, ids))
      : [];
    const activity = await this.activity(
      actor,
      rows.map((r) => r.request.merchantId),
    );
    const requests: DeviceTrialRequest[] = rows.map(({ request, lead }) => ({
      id: request.id,
      merchantId: request.merchantId,
      companyName: lead?.companyName ?? null,
      contactName: lead?.fullName ?? null,
      email: lead?.email ?? '',
      status: request.status as DeviceTrialStatus,
      note: request.note,
      lines: lines
        .filter((l) => l.requestId === request.id)
        .map((l) => ({ nameAr: l.nameAr, nameEn: l.nameEn, quantity: l.quantity })),
      deliveredAt: iso(request.deliveredAt),
      trialEndsAt: iso(activity.get(request.merchantId)?.['trial_ends_at']),
      createdAt: request.createdAt.toISOString(),
      version: request.version,
    }));
    return { requests, counts };
  }

  async updateDeviceRequest(
    actor: PlatformActor,
    id: string,
    input: O<typeof updateDeviceTrialSchema>,
    ip: string,
  ) {
    const settings = await this.settingsRow(this.database.db);
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const [current] = await tx
        .select()
        .from(deviceTrialRequests)
        .where(eq(deviceTrialRequests.id, id))
        .for('update');
      if (!current) throw AppError.notFound('Request not found.');
      if (current.version !== input.version) throw versionConflict();
      const from = current.status as DeviceTrialStatus;
      if (from !== input.status && !NEXT[from].includes(input.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          `A ${from} request cannot become ${input.status}.`,
        );
      await tx
        .update(deviceTrialRequests)
        .set({
          status: input.status,
          note: input.note,
          ...(input.status === 'delivered' && from !== 'delivered'
            ? { deliveredAt: sql`now()` }
            : {}),
          ...(input.status === 'returned' && from !== 'returned' ? { returnedAt: sql`now()` } : {}),
          version: sql`${deviceTrialRequests.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(deviceTrialRequests.id, id));
      await this.record(tx, actor, 'trials.devices.updated', 'device_trial_request', id, ip, {
        from,
        to: input.status,
      });
    });
    // The device trial starts on delivery: the trial runs at least that long from today.
    if (input.status === 'delivered') await this.extendTrial(actor, id, settings.trialDaysDevices);
    return (await this.deviceRequests(actor)).requests.find((r) => r.id === id)!;
  }

  async funnel(days: number): Promise<FunnelStats> {
    const rows = await this.database.db
      .select({ step: funnelEvents.step, n: sql<number>`count(*)::int` })
      .from(funnelEvents)
      .where(gte(funnelEvents.createdAt, sql`now() - make_interval(days => ${days})`))
      .groupBy(funnelEvents.step);
    const counts = new Map(rows.map((r) => [r.step, Number(r.n)]));
    return { days, steps: FUNNEL_STEPS.map((step) => ({ step, sessions: counts.get(step) ?? 0 })) };
  }

  // ------------------------------------------------------------ helpers
  private async extendTrial(actor: PlatformActor, requestId: string, days: number) {
    const [request] = await this.database.db
      .select({ merchantId: deviceTrialRequests.merchantId })
      .from(deviceTrialRequests)
      .where(eq(deviceTrialRequests.id, requestId));
    if (!request) return;
    await this.database.withPlatformContext(actor.operatorId, request.merchantId, async (tx) => {
      const [sub] = await tx
        .update(subscriptions)
        .set({
          trialEndsAt: sql`greatest(coalesce(${subscriptions.trialEndsAt}, now()), now() + make_interval(days => ${days}))`,
          version: sql`${subscriptions.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(subscriptions.merchantId, request.merchantId),
            eq(subscriptions.status, 'trialing'),
          ),
        )
        .returning({ id: subscriptions.id });
      if (!sub) return;
      await tx.insert(subscriptionEvents).values({
        id: newId(),
        merchantId: request.merchantId,
        subscriptionId: sub.id,
        kind: 'changed',
        fromStatus: 'trialing',
        toStatus: 'trialing',
        operatorId: actor.operatorId,
        reason: `Trial devices delivered: trial runs ${days} days from delivery`,
      });
    });
  }

  private async checkDevices(wanted: { itemId: string; quantity: number }[]) {
    if (!wanted.length) return [];
    const settings = await this.settingsRow(this.database.db);
    const items = await this.database.db
      .select()
      .from(offerItems)
      .where(
        and(
          inArray(
            offerItems.id,
            wanted.map((w) => w.itemId),
          ),
          eq(offerItems.kind, 'device'),
          eq(offerItems.status, 'active'),
        ),
      );
    const byId = new Map(items.map((i) => [i.id, i]));
    const out = await this.outByItem(this.database.db);
    return wanted.map((w, index) => {
      const item = byId.get(w.itemId);
      if (!item)
        throw AppError.validation([
          { path: `devices.${index}.itemId`, code: 'unavailable', message: 'Device not offered.' },
        ]);
      const available = item.trialStock - (out.get(item.id) ?? 0) >= w.quantity;
      if (!available && !settings.waitlistEnabled)
        throw AppError.validation([
          {
            path: `devices.${index}.itemId`,
            code: 'unavailable',
            message: 'This device is not available for a trial now.',
          },
        ]);
      return { item, quantity: w.quantity, available };
    });
  }

  private outByItem(db: Pick<Transaction, 'select'>) {
    return this.byItem(db, OUT);
  }

  private async byItem(db: Pick<Transaction, 'select'>, statuses: DeviceTrialStatus[]) {
    const rows = await db
      .select({
        itemId: deviceTrialRequestLines.itemId,
        n: sql<number>`sum(${deviceTrialRequestLines.quantity})::int`,
      })
      .from(deviceTrialRequestLines)
      .innerJoin(deviceTrialRequests, eq(deviceTrialRequests.id, deviceTrialRequestLines.requestId))
      .where(inArray(deviceTrialRequests.status, statuses))
      .groupBy(deviceTrialRequestLines.itemId);
    return new Map(rows.map((r) => [r.itemId, Number(r.n)]));
  }

  private async settingsRow(db: Pick<Transaction, 'select'>) {
    const [row] = await db.select().from(trialSettings).where(eq(trialSettings.id, 1));
    if (!row) throw AppError.unavailable('Trial settings are missing.');
    return row;
  }

  private async activity(actor: PlatformActor, merchantIds: string[]): Promise<Map<string, Row>> {
    if (!merchantIds.length) return new Map();
    const rows = await this.database.withPlatformContext(
      actor.operatorId,
      null,
      async (tx) =>
        (
          await tx.execute(
            sql`select * from platform_trial_activity(${`{${[...new Set(merchantIds)].join(',')}}`}::uuid[])`,
          )
        ).rows as Row[],
    );
    return new Map(rows.map((r) => [r['merchant_id'] as string, r]));
  }

  /** Keeps the furthest stage a prospect reached; returns the lead id. */
  private async upsertLead(
    tx: Transaction,
    email: string,
    stage: LeadStage,
    fields: {
      fullName?: string | null;
      companyName?: string | null;
      businessType?: string;
      language?: string;
      merchantId?: string;
    },
  ): Promise<string> {
    const [current] = await tx.select().from(leads).where(eq(leads.email, email)).for('update');
    const values = {
      ...(fields.fullName ? { fullName: fields.fullName } : {}),
      ...(fields.companyName ? { companyName: fields.companyName } : {}),
      ...(fields.businessType ? { businessType: fields.businessType } : {}),
      ...(fields.language ? { language: fields.language } : {}),
      ...(fields.merchantId ? { merchantId: fields.merchantId } : {}),
    };
    if (!current) {
      const id = newId();
      await tx.insert(leads).values({ id, email, stage, ...values });
      return id;
    }
    const keepStage = STAGE_RANK[current.stage as LeadStage] > STAGE_RANK[stage];
    await tx
      .update(leads)
      .set({ ...values, ...(keepStage ? {} : { stage }), updatedAt: sql`now()` })
      .where(eq(leads.id, current.id));
    return current.id;
  }

  private async step(sessionId: string, step: FunnelStep) {
    await this.database.db.insert(funnelEvents).values({ sessionId, step }).onConflictDoNothing();
  }

  private sendCode(email: string, name: string, code: string) {
    return this.send({
      to: email,
      ...renderEmail({
        title: { ar: 'رمز تأكيد إيميلك', en: 'Your verification code' },
        name,
        intro: {
          ar: 'اكتب هذا الرمز في صفحة التسجيل لتبدأ تجربتك المجانية في عربات:',
          en: 'Enter this code on the sign-up page to start your free Arabat trial:',
        },
        code,
        note: {
          ar: `الرمز صالح ${CODE_TTL_MINUTES} دقيقة. إذا ما طلبته فتجاهل الرسالة.`,
          en: `The code is valid for ${CODE_TTL_MINUTES} minutes. If you did not ask for it, ignore this e-mail.`,
        },
      }),
    });
  }

  private notifySales(title: { ar: string; en: string }, line: string) {
    return this.send({
      to: this.env.SALES_NOTIFY_EMAIL,
      ...renderEmail({
        title,
        name: 'Arabat',
        intro: { ar: line, en: line },
        action: {
          label: { ar: 'افتح العملاء المحتملين', en: 'Open leads' },
          url: `${this.siteUrl()}/platform/trials`,
        },
      }),
    });
  }

  private async send(message: { to: string; subject: string; text: string; html: string }) {
    try {
      await this.mailer.send(message);
    } catch (error) {
      this.logger.error(`Trial e-mail failed: ${(error as Error).message}`);
    }
  }

  private siteUrl() {
    return new URL(this.env.PUBLIC_MANAGER_URL).origin;
  }

  private record(
    tx: Transaction,
    actor: PlatformActor,
    action: string,
    targetType: string,
    targetId: string | null,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: null,
      actorType: 'operator',
      actorId: actor.operatorId,
      action,
      targetType,
      targetId,
      ip,
      details: { ...details, operatorRole: actor.role },
    });
  }
}
