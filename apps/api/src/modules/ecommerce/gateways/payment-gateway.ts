import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../kernel/errors/app-error.js';

/** Providers the platform is designed for (ADR-0078). */
export const GATEWAY_PROVIDERS = ['tap', 'upayments', 'hesabe', 'bookeey', 'mock'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export interface InitiateRequest {
  /** Our payment attempt id: sent to the provider as the merchant reference. */
  paymentId: string;
  amountMinor: bigint;
  currency: 'KWD';
  description: string;
  customer: { name: string; phone: string; email: string | null };
  /** Where the provider sends the customer back. */
  returnUrl: string;
}

export interface InitiateResult {
  /** The provider's transaction/charge id. */
  providerReference: string;
  /** Hosted payment page. */
  redirectUrl: string;
}

export type GatewayStatus = 'succeeded' | 'failed' | 'cancelled' | 'pending';

export interface VerifiedPayment {
  providerReference: string;
  status: GatewayStatus;
  amountMinor: bigint;
  currency: string;
  failureReason: string | null;
}

export interface WebhookEvent extends VerifiedPayment {
  /** Provider event id: the same event delivered twice is processed once. */
  eventId: string;
  payload: Record<string, unknown>;
}

/**
 * One payment provider. Adapters translate to the provider's API; the order/payment state
 * machine, idempotency and reconciliation live in `OnlinePaymentsService` so every
 * provider behaves the same.
 */
export interface PaymentGateway {
  readonly provider: GatewayProvider;
  /** False while the provider has no approved, tested credentials (never live by default). */
  readonly ready: boolean;
  initiate(request: InitiateRequest): Promise<InitiateResult>;
  /** Server-to-server status check (used on the return page and for reconciliation). */
  verify(providerReference: string): Promise<VerifiedPayment>;
  /** Validates the signature over the raw body and parses the notification. */
  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookEvent;
}

const NOT_CONFIGURED = (provider: string) =>
  new AppError(
    409,
    'GATEWAY_NOT_CONFIGURED',
    `${provider} is not connected. Real payments need the owner's approval and tested credentials.`,
  );

/**
 * Placeholder for Tap, UPayments, Hesabe and Bookeey: same interface, refuses every call.
 * A real adapter replaces it only after credentials are provided, sandbox-tested and
 * approved (CLAUDE.md §3.13).
 */
export class UnconfiguredGateway implements PaymentGateway {
  readonly ready = false;
  constructor(readonly provider: GatewayProvider) {}
  initiate(): Promise<InitiateResult> {
    return Promise.reject(NOT_CONFIGURED(this.provider));
  }
  verify(): Promise<VerifiedPayment> {
    return Promise.reject(NOT_CONFIGURED(this.provider));
  }
  parseWebhook(): WebhookEvent {
    throw NOT_CONFIGURED(this.provider);
  }
}

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

interface MockCharge {
  amountMinor: bigint;
  status: GatewayStatus;
  failureReason: string | null;
}

/**
 * Test gateway: no money moves. It keeps its "charges" in memory, shows a hosted test page
 * in the storefront and signs its notifications with HMAC-SHA256 like a real provider, so
 * the full flow (initiate → redirect → webhook → verification) is exercised end to end.
 */
export class MockGateway implements PaymentGateway {
  readonly provider = 'mock' as const;
  readonly ready = true;
  private readonly charges = new Map<string, MockCharge>();

  constructor(
    private readonly secret: string,
    private readonly storeUrl: string,
  ) {}

  initiate(request: InitiateRequest): Promise<InitiateResult> {
    const providerReference = `mock_${randomBytes(12).toString('hex')}`;
    this.charges.set(providerReference, {
      amountMinor: request.amountMinor,
      status: 'pending',
      failureReason: null,
    });
    // The hosted page is addressed by the provider's own reference, like a real gateway.
    const url = new URL(`${this.storeUrl.replace(/\/$/, '')}/pay/${providerReference}`);
    url.searchParams.set('return', request.returnUrl);
    return Promise.resolve({ providerReference, redirectUrl: url.toString() });
  }

  verify(providerReference: string): Promise<VerifiedPayment> {
    const charge = this.charges.get(providerReference);
    return Promise.resolve({
      providerReference,
      status: charge?.status ?? 'pending',
      amountMinor: charge?.amountMinor ?? 0n,
      currency: 'KWD',
      failureReason: charge?.failureReason ?? null,
    });
  }

  /** The customer's choice on the test page; returns the signed notification to deliver. */
  settle(
    providerReference: string,
    outcome: Exclude<GatewayStatus, 'pending'>,
    amountMinor: bigint,
  ) {
    this.charges.set(providerReference, {
      amountMinor,
      status: outcome,
      failureReason: outcome === 'failed' ? 'Card declined (test)' : null,
    });
    const body = Buffer.from(
      JSON.stringify({
        id: `evt_${randomBytes(10).toString('hex')}`,
        reference: providerReference,
        status: outcome,
        amount: amountMinor.toString(),
        currency: 'KWD',
        failureReason: outcome === 'failed' ? 'Card declined (test)' : null,
      }),
    );
    return { body, signature: this.sign(body) };
  }

  sign(body: Buffer): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): WebhookEvent {
    const given = String(headers[MOCK_SIGNATURE_HEADER] ?? '');
    const expected = this.sign(rawBody);
    const ok =
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) throw new AppError(401, 'PAYMENT_SIGNATURE_INVALID', 'Invalid webhook signature.');
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const status = String(payload['status']) as GatewayStatus;
    if (
      !['succeeded', 'failed', 'cancelled', 'pending'].includes(status) ||
      !/^\d+$/.test(String(payload['amount']))
    )
      throw AppError.validation([
        { path: 'body', code: 'invalid', message: 'Malformed notification.' },
      ]);
    return {
      eventId: String(payload['id']),
      providerReference: String(payload['reference']),
      status,
      amountMinor: BigInt(String(payload['amount'])),
      currency: String(payload['currency']),
      failureReason: (payload['failureReason'] as string | null) ?? null,
      payload,
    };
  }
}
