import { z } from 'zod';

/**
 * An optional reference picked from a list. HTML selects send "" for the "none" option, so ""
 * means null here; without it a form with "—" chosen fails validation silently.
 */
export const optionalId = () =>
  z
    .union([z.literal(''), z.uuid()])
    .nullish()
    .transform((v) => v || null);
