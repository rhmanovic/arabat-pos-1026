import { z } from 'zod';
import { optionalId } from './optional-id.js';

/**
 * Server-side receipt printing (ADR-0111). A print agent is a program on the computer with the
 * receipt printer attached; it authenticates with a bearer token, is told about new jobs over
 * Socket.IO (namespace `/print-agent`, event `print:job`) and claims them through the agent API.
 */

/** An agent counts as online when it was seen less than this long ago. */
export const PRINT_AGENT_ONLINE_SECONDS = 60;

export const createPrintAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** The branch whose receipts it prints; omitted or null = every branch. */
  branchId: optionalId(),
});

export const printAgentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  branchId: z.uuid().nullable(),
  lastSeenAt: z.string().nullable(),
  online: z.boolean(),
  createdAt: z.string(),
});
export type PrintAgent = z.infer<typeof printAgentSchema>;

/** Returned once, at creation: the plain token is never stored and never shown again. */
export const createdPrintAgentSchema = z.object({ id: z.uuid(), token: z.string() });
export type CreatedPrintAgent = z.infer<typeof createdPrintAgentSchema>;

export const printSettingsSchema = z.object({ autoPrintReceipts: z.boolean() });
export type PrintSettings = z.infer<typeof printSettingsSchema>;

export const PRINT_JOB_STATUSES = ['pending', 'printing', 'printed', 'failed'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/**
 * A receipt copy queued for the print agents (`POST /manager/sales/:id/print`,
 * `POST /pos/sales/:id/print`). `agentOnline` is false when no agent for the sale's branch was
 * seen in the last minute: the job then waits until one connects.
 */
export const printJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(PRINT_JOB_STATUSES),
  createdAt: z.string(),
  copyNumber: z.number().int().positive(),
  agentOnline: z.boolean(),
});
export type PrintJob = z.infer<typeof printJobSchema>;

/* Agent API (field names are the agent's contract). */

export const agentPendingJobSchema = z.object({
  id: z.uuid(),
  html: z.string(),
  /** The sale the receipt belongs to. */
  orderUuid: z.uuid().nullable(),
  createdAt: z.string(),
});
export type AgentPendingJob = z.infer<typeof agentPendingJobSchema>;

export const agentClaimedJobSchema = z.object({ id: z.uuid(), html: z.string() });
export type AgentClaimedJob = z.infer<typeof agentClaimedJobSchema>;

export const agentJobResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(2000).optional(),
});
