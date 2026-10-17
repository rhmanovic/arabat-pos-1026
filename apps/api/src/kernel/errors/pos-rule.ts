import { PosRuleError } from '@arabat/pos-core';
import { AppError } from './app-error.js';

/**
 * Runs a shared selling rule (`@arabat/pos-core`, ADR-0112) and answers its refusal exactly as
 * the API did before the rules moved: same status, code, message and issues.
 */
export function rules<T>(decide: () => T): T {
  try {
    return decide();
  } catch (error) {
    if (error instanceof PosRuleError)
      throw new AppError(error.status, error.code, error.message, error.issues);
    throw error;
  }
}
