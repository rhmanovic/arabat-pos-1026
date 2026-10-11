import { type Page, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/** Development seed accounts (apps/api/src/database/seeds/dev-accounts.ts). */
export const DEV_PASSWORD = 'Demo-Pass-2026';
export const DEV = {
  owner: 'owner@demo.arabat.test',
  manager: 'manager@demo.arabat.test',
  cashier: 'cashier@demo.arabat.test',
  multi: 'multi@demo.arabat.test',
  operator: 'operator@platform.arabat.test',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

export const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.arabat.test`;
}

export async function useEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
}

export async function signIn(
  page: Page,
  app: 'manager' | 'pos',
  email: string,
  password = DEV_PASSWORD,
) {
  await page.goto(`/${app}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** RFC 6238 code for a time step (same algorithm as the API). */
export function totp(secret: string, offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** Latest e-mail sent to an address, from the Mailpit API. */
export async function latestMailText(to: string): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const list = (await res.json()) as { messages: { ID: string }[] };
        if (!list.messages?.length) return false;
        const message = await (
          await fetch(`${MAILPIT}/api/v1/message/${list.messages[0]!.ID}`)
        ).json();
        text = (message as { Text: string }).Text;
        return true;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return text;
}
