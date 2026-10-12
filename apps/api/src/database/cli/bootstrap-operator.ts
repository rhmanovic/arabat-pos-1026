import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Transaction } from '../database.service.js';
import { upsertOperator } from '../../modules/platform-admin/operators.js';

export interface BootstrappedOperator {
  email: string;
  password: string;
  totpSecret: string;
  otpauthUri: string;
}

/**
 * Creates the first platform super admin on a hosted service that offers no shell
 * (OPERATIONS.md §8). Does nothing once any operator exists, so it can never re-key or add
 * operators; later operators come from create-operator.ts.
 */
export async function bootstrapFirstOperator(
  tx: Transaction,
  input: { email: string; fullName: string; encryptionKey: string },
): Promise<BootstrappedOperator | null> {
  // Serializes concurrent starts (two replicas booting together).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bootstrap_first_operator'))`);
  const { rows } = await tx.execute(sql`select exists (select 1 from platform_operators) as any`);
  if ((rows[0] as { any: boolean }).any) return null;
  const password = randomBytes(12).toString('base64url');
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const created = await upsertOperator(tx, {
    email: input.email,
    fullName: input.fullName,
    role: 'platform.super_admin',
    passwordHash,
    encryptionKey: input.encryptionKey,
  });
  return {
    email: input.email.trim().toLowerCase(),
    password,
    totpSecret: created.totpSecret,
    otpauthUri: created.otpauthUri,
  };
}
