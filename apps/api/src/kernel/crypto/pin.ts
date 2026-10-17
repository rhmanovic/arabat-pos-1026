import { hash } from '@node-rs/argon2';
import { AppError } from '../errors/app-error.js';

/**
 * Cashier PINs for local-first devices (ADR-0112). The hash travels to the branch's devices,
 * which verify a PIN offline, so it is argon2id with deliberately slow parameters (64 MiB,
 * 3 passes): guessing all 6-digit PINs from a stolen device file takes a long time.
 * Standard PHC string (`$argon2id$v=19$m=65536,t=3,p=1$…`), readable by any argon2 library.
 */
export const PIN_HASH_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (const enum)
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const PIN_MIN_DIGITS = 6;
export const PIN_MAX_DIGITS = 12;

/** Digits only, 6–12 of them, not one repeated digit and not a straight run (123456, 654321). */
export function assertAcceptablePin(pin: string): void {
  const issue = (message: string) =>
    AppError.validation([{ path: 'pin', code: 'invalid', message }]);
  if (!/^\d+$/.test(pin) || pin.length < PIN_MIN_DIGITS || pin.length > PIN_MAX_DIGITS)
    throw issue(`Use ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`);
  if (/^(\d)\1+$/.test(pin)) throw issue('A PIN cannot repeat one digit.');
  const steps = [...pin].slice(1).map((d, i) => Number(d) - Number(pin[i]));
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1))
    throw issue('A PIN cannot be a straight run of digits.');
}

export function hashPin(pin: string): Promise<string> {
  return hash(pin, PIN_HASH_OPTIONS);
}
