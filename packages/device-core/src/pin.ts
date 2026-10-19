import { argon2Verify } from 'hash-wasm';
import type { BridgeDb } from './bridge.js';

/** 5 wrong PINs lock the person on this device for 5 minutes, doubling on each repeat. */
export const PIN_MAX_FAILURES = 3;
export const PIN_LOCK_BASE_MS = 5 * 60_000;

/**
 * Verifies a PIN against the argon2id PHC string from the snapshot, in WebAssembly. Call it from
 * a Web Worker in the app so the UI does not freeze (64 MiB, 3 passes). The hash is never shown
 * or uploaded. A missing hash never matches.
 */
export async function verifyPinHash(pinHash: string | null, pin: string): Promise<boolean> {
  if (!pinHash || !/^\d{6,12}$/.test(pin)) return false;
  try {
    return await argon2Verify({ password: pin, hash: pinHash });
  } catch {
    return false;
  }
}

export interface PinLockState {
  failures: number;
  lockouts: number;
  lockedUntil: Date | null;
}

export const freshLock: PinLockState = { failures: 0, lockouts: 0, lockedUntil: null };

export function isLocked(state: PinLockState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** The state after a wrong PIN: counts up to the limit, then locks for a doubling period. */
export function afterFailure(state: PinLockState, now: Date): PinLockState {
  const failures = state.failures + 1;
  if (failures < PIN_MAX_FAILURES) return { ...state, failures, lockedUntil: null };
  return {
    failures: 0,
    lockouts: state.lockouts + 1,
    lockedUntil: new Date(now.getTime() + PIN_LOCK_BASE_MS * 2 ** state.lockouts),
  };
}

export async function loadLock(db: BridgeDb, membershipId: string): Promise<PinLockState> {
  const [row] = await db.query(`SELECT * FROM pin_attempts WHERE membership_id = ?`, [
    membershipId,
  ]);
  if (!row) return freshLock;
  return {
    failures: Number(row['failures']),
    lockouts: Number(row['lockouts']),
    lockedUntil: row['locked_until'] === null ? null : new Date(String(row['locked_until'])),
  };
}

export async function saveLock(
  db: BridgeDb,
  membershipId: string,
  state: PinLockState,
): Promise<void> {
  await db.exec(
    `INSERT INTO pin_attempts (membership_id, failures, lockouts, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(membership_id) DO UPDATE SET failures = excluded.failures, lockouts = excluded.lockouts, locked_until = excluded.locked_until`,
    [
      membershipId,
      state.failures,
      state.lockouts,
      state.lockedUntil ? state.lockedUntil.toISOString() : null,
    ],
  );
}

export type PinOutcome =
  | { ok: true }
  | { ok: false; reason: 'locked'; until: Date }
  | { ok: false; reason: 'wrong'; failuresLeft: number }
  | { ok: false; reason: 'no_pin' };

/**
 * One sign-in attempt: refuses while locked, verifies with `verify` (the worker-backed
 * `verifyPinHash`), records the failure or clears the count on success.
 */
export async function attemptPin(
  db: BridgeDb,
  member: { membershipId: string; pinHash: string | null },
  pin: string,
  verify: (hash: string, pin: string) => Promise<boolean>,
  now: Date = new Date(),
): Promise<PinOutcome> {
  if (!member.pinHash) return { ok: false, reason: 'no_pin' };
  const state = await loadLock(db, member.membershipId);
  if (isLocked(state, now)) return { ok: false, reason: 'locked', until: state.lockedUntil! };
  if (await verify(member.pinHash, pin)) {
    // A success clears the failures and ends any past lock, but keeps the lockout history for
    // the doubling, which decays only with a new sync of the staff list (fresh device data).
    await saveLock(db, member.membershipId, { ...state, failures: 0, lockedUntil: null });
    return { ok: true };
  }
  const next = afterFailure(state, now);
  await saveLock(db, member.membershipId, next);
  return next.lockedUntil
    ? { ok: false, reason: 'locked', until: next.lockedUntil }
    : { ok: false, reason: 'wrong', failuresLeft: PIN_MAX_FAILURES - next.failures };
}
