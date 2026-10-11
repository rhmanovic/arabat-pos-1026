import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/** OWASP recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). */
// `algorithm: 2` is Algorithm.Argon2id (a const enum, not importable with verbatimModuleSyntax).
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Hash verified against when the account does not exist, so timing does not reveal it. */
  private readonly dummyHash = hash('arabat-timing-equalizer', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const target = passwordHash ?? (await this.dummyHash);
    try {
      const ok = await verify(target, password);
      return ok && passwordHash !== null;
    } catch {
      return false;
    }
  }
}
