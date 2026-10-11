import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);

export const liveResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});
export type LiveResponse = z.infer<typeof liveResponseSchema>;

export const readyResponseSchema = z.object({
  status: healthStatusSchema,
  version: z.string(),
  checks: z.object({
    database: z.object({
      status: healthStatusSchema,
      latencyMs: z.number().optional(),
      error: z.string().optional(),
    }),
  }),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
