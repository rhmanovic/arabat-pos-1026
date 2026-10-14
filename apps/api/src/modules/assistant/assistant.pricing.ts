/**
 * List prices of the provider's models in micro-USD per million tokens (Anthropic first-party
 * API, checked 2026-10-14). Cache writes are 1.25× input. The estimate is informational: the
 * provider's invoice is the record. Update this table when the price list changes and note the
 * date here.
 */
const PRICES: Record<
  string,
  { input: bigint; output: bigint; cacheWrite: bigint; cacheRead: bigint }
> = {
  'claude-opus-5-5': {
    input: 4_000_000n,
    output: 20_000_000n,
    cacheWrite: 5_000_000n,
    cacheRead: 200_000n,
  },
  'claude-opus-5': {
    input: 5_000_000n,
    output: 25_000_000n,
    cacheWrite: 6_250_000n,
    cacheRead: 500_000n,
  },
  'claude-sonnet-5-5': {
    input: 2_000_000n,
    output: 10_000_000n,
    cacheWrite: 2_500_000n,
    cacheRead: 200_000n,
  },
  'claude-sonnet-5': {
    input: 2_000_000n,
    output: 10_000_000n,
    cacheWrite: 2_500_000n,
    cacheRead: 200_000n,
  },
  'claude-haiku-5-5': {
    input: 100_000n,
    output: 500_000n,
    cacheWrite: 125_000n,
    cacheRead: 10_000n,
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

const MILLION = 1_000_000n;

/** Estimated cost in micro-USD, rounded to the nearest; null when the model is not priced. */
export function estimateCostMicroUsd(model: string, usage: TokenUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const sum =
    BigInt(usage.inputTokens) * p.input +
    BigInt(usage.outputTokens) * p.output +
    BigInt(usage.cacheWriteTokens) * p.cacheWrite +
    BigInt(usage.cacheReadTokens) * p.cacheRead;
  return Number((sum + MILLION / 2n) / MILLION);
}

export const PRICED_MODELS = Object.keys(PRICES);
