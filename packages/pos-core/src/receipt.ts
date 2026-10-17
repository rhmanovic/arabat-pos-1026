/** Receipt numbers have six digits after the series, e.g. "MAIN-000028". */
const DIGITS = 6;

const pad = (n: number | bigint | string) => String(n).padStart(DIGITS, '0');

/** Branch-wide series (online store and browser till today): `{branch}-{000001}`. */
export function formatReceiptNumber(
  branchCode: string,
  sequence: number | bigint | string,
): string {
  return `${branchCode}-${pad(sequence)}`;
}

/**
 * Per-device series for local-first registers (ADR-0112): `{branch}-{register}-{000001}`,
 * gap-free per device, e.g. "MAIN-R1-000123".
 */
export function formatDeviceReceiptNumber(
  branchCode: string,
  registerCode: string,
  sequence: number | bigint | string,
): string {
  return `${branchCode}-${registerCode}-${pad(sequence)}`;
}

/** The n-th refund of a sale: `{receipt number}-R{n}` (n starts at 1). */
export function formatRefundNumber(receiptNumber: string, n: number): string {
  return `${receiptNumber}-R${n}`;
}
