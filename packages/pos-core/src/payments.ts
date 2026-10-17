import { type FeeType, Money, processingFee } from '@arabat/money';
import { POS_CURRENCY, parseAmount } from './amounts.js';
import { PosRuleError } from './errors.js';

/** A tender as entered at the till (contracts `paymentInputSchema`). */
export interface PaymentInput {
  methodId: string;
  amount: string;
  /** Cash handed over (cash only); the change is tendered − amount. */
  tendered: string | null;
  reference: string | null;
}

/** A payment method as the server stores it (`payment_methods`). */
export interface PosPaymentMethod {
  id: string;
  kind: string;
  status: string;
  availableInPos: boolean;
  /** Set for gateway methods, which the till can never confirm. */
  gatewayProvider: string | null;
  /** Where non-cash money settles (BR-181). */
  financialAccountId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  feeType: FeeType;
  feeFixedMinor: bigint;
  feePercent: string;
}

export interface CheckedPayment {
  method: {
    id: string;
    kind: string;
    nameEn: string | null;
    nameAr: string | null;
    financialAccountId: string | null;
  };
  amountMinor: bigint;
  tenderedMinor: bigint | null;
  changeMinor: bigint;
  /** The card network's charge (0 for cash, FND-412). */
  feeMinor: bigint;
  reference: string | null;
}

/**
 * Tender rules (BR-181): methods active and allowed at the till, no gateway, a settlement account
 * for non-cash, a reference when the company requires one, positive amounts, cash-only change,
 * and the sum equal to the amount due. Returns the payments with their change and fee.
 */
export function checkPayments(
  input: readonly PaymentInput[],
  methods: ReadonlyMap<string, PosPaymentMethod>,
  dueMinor: bigint,
  requireReference = true,
): CheckedPayment[] {
  if (input.length === 0) {
    if (dueMinor === 0n) return [];
    throw new PosRuleError(400, 'PAYMENT_TOTAL_MISMATCH', 'Add a payment.');
  }
  let sum = 0n;
  const checked = input.map((p, i): CheckedPayment => {
    const m = methods.get(p.methodId);
    if (!m || m.status !== 'active' || !m.availableInPos)
      throw new PosRuleError(
        409,
        'PAYMENT_METHOD_UNAVAILABLE',
        'This payment method is not available.',
        [{ path: `payments.${i}.methodId`, code: 'unavailable', message: 'Unavailable.' }],
      );
    // No gateway is integrated yet: a gateway payment can never be confirmed at the till.
    if (m.gatewayProvider)
      throw new PosRuleError(
        409,
        'PAYMENT_NOT_VERIFIED',
        'This payment needs gateway verification, which is not available.',
      );
    if (m.kind !== 'cash' && !m.financialAccountId)
      throw new PosRuleError(
        409,
        'SETTLEMENT_ACCOUNT_REQUIRED',
        'This payment method has no settlement account.',
        [{ path: `payments.${i}.methodId`, code: 'no_account', message: 'No account.' }],
      );
    if (m.kind !== 'cash' && requireReference && !p.reference)
      throw new PosRuleError(400, 'REFERENCE_REQUIRED', 'Enter the payment reference.', [
        { path: `payments.${i}.reference`, code: 'required', message: 'Required.' },
      ]);
    const amountMinor = parseAmount(p.amount, `payments.${i}.amount`);
    if (amountMinor <= 0n)
      throw new PosRuleError(400, 'PAYMENT_TOTAL_MISMATCH', 'Payment amounts must be positive.');
    let tenderedMinor: bigint | null = null;
    let changeMinor = 0n;
    if (p.tendered !== null) {
      if (m.kind !== 'cash')
        throw new PosRuleError(
          400,
          'PAYMENT_TOTAL_MISMATCH',
          'Only cash can be tendered with change.',
        );
      tenderedMinor = parseAmount(p.tendered, `payments.${i}.tendered`);
      if (tenderedMinor < amountMinor)
        throw new PosRuleError(
          400,
          'PAYMENT_TOTAL_MISMATCH',
          'Cash tendered is less than the amount.',
        );
      changeMinor = tenderedMinor - amountMinor;
    }
    sum += amountMinor;
    const feeMinor =
      m.kind === 'cash'
        ? 0n
        : processingFee(amountMinor, {
            type: m.feeType,
            fixedMinor: m.feeFixedMinor,
            percent: m.feePercent,
          });
    return {
      method: {
        id: m.id,
        kind: m.kind,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        financialAccountId: m.financialAccountId,
      },
      amountMinor,
      tenderedMinor,
      changeMinor,
      feeMinor,
      reference: p.reference,
    };
  });
  if (sum !== dueMinor)
    throw new PosRuleError(
      400,
      'PAYMENT_TOTAL_MISMATCH',
      'The payments do not add up to the total.',
      [
        {
          path: 'payments',
          code: 'mismatch',
          message: `total=${Money.ofMinor(dueMinor, POS_CURRENCY).toDecimalString()} paid=${Money.ofMinor(sum, POS_CURRENCY).toDecimalString()}`,
        },
      ],
    );
  return checked;
}
