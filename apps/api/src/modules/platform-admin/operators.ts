import type { PlatformRole } from '@arabat/permissions';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auditLog } from '../audit/audit.schema.js';
import { sessions } from '../auth/auth.schema.js';
import type { Transaction } from '../../database/database.service.js';
import { SecretBox } from '../../kernel/crypto/secret-box.js';
import { generateTotpSecret, otpauthUri } from '../../kernel/crypto/totp.js';
import { newId } from '../../kernel/ids.js';
import { platformOperators } from './platform.schema.js';

export interface CreatedOperator {
  id: string;
  totpSecret: string;
  otpauthUri: string;
}

/**
 * Creates (or, with `replace`, re-keys) a platform operator. Operators are never created
 * through the public API: only the CLI and development seeds call this.
 */
export async function upsertOperator(
  tx: Transaction,
  input: {
    email: string;
    fullName: string;
    role: PlatformRole;
    passwordHash: string;
    encryptionKey: string;
    totpSecret?: string;
  },
): Promise<CreatedOperator> {
  const secret = input.totpSecret ?? generateTotpSecret();
  const box = new SecretBox(input.encryptionKey);
  const email = input.email.trim().toLowerCase();
  const values = {
    email,
    fullName: input.fullName,
    platformRole: input.role,
    passwordHash: input.passwordHash,
    mfaSecretEnc: box.encrypt(secret),
    mfaLastStep: 0,
    status: 'active',
  };
  const [existing] = await tx
    .select({ id: platformOperators.id })
    .from(platformOperators)
    .where(eq(platformOperators.email, email));
  let id = existing?.id;
  if (id) {
    await tx.update(platformOperators).set(values).where(eq(platformOperators.id, id));
    // Re-keying (new password and TOTP secret) ends the operator's sessions (audit fix).
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'operator_rekeyed' })
      .where(and(eq(sessions.operatorId, id), isNull(sessions.revokedAt)));
  } else {
    id = newId();
    await tx.insert(platformOperators).values({ id, ...values });
  }
  return { id, totpSecret: secret, otpauthUri: otpauthUri(secret, email) };
}

/**
 * Sets a new password for an existing operator and nothing else: the TOTP secret, role and
 * status stay, so the operator's authenticator app keeps working. Ends the operator's sessions
 * and records the reset in the audit log. Returns null when no operator has that e-mail.
 */
export async function resetOperatorPassword(
  tx: Transaction,
  input: { email: string; passwordHash: string },
): Promise<{ id: string } | null> {
  const email = input.email.trim().toLowerCase();
  const [operator] = await tx
    .update(platformOperators)
    .set({ passwordHash: input.passwordHash, updatedAt: sql`now()` })
    .where(eq(platformOperators.email, email))
    .returning({ id: platformOperators.id });
  if (!operator) return null;
  await tx
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokeReason: 'operator_password_reset' })
    .where(and(eq(sessions.operatorId, operator.id), isNull(sessions.revokedAt)));
  await tx.insert(auditLog).values({
    id: newId(),
    merchantId: null,
    actorType: 'system',
    actorId: null,
    action: 'platform.operator.password_reset',
    targetType: 'platform_operator',
    targetId: operator.id,
    details: { via: 'cli', mfaKept: true },
  });
  return operator;
}
