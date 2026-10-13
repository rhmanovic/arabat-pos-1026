import { z } from 'zod';
import { emailSchema, newPasswordSchema } from './auth.js';
import { languageSchema } from './interfaces.js';

/** Optional text: missing, null or blank all become null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));
const requiredText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- branches
export const branchDetailSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  isMain: z.boolean(),
  status: z.enum(['active', 'inactive']),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  receiptHeader: z.string().nullable(),
  receiptFooter: z.string().nullable(),
  timezone: z.string(),
  version: z.number().int(),
  employeeCount: z.number().int(),
  createdAt: z.string(),
});
export type BranchDetail = z.infer<typeof branchDetailSchema>;
export const branchDetailListSchema = z.object({ branches: z.array(branchDetailSchema) });

const branchFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, { error: 'Code: letters, digits, - or _ (max 20).' }),
  nameEn: text(120),
  nameAr: text(120),
  phone: text(30),
  address: text(300),
  receiptHeader: text(500),
  receiptFooter: text(500),
};
const nameRequired = (v: { nameEn?: string | null; nameAr?: string | null }) =>
  Boolean(v.nameAr || v.nameEn);

export const createBranchSchema = z.object(branchFields).refine(nameRequired, {
  error: 'A branch name in Arabic or English is required.',
  path: ['nameAr'],
});
export type CreateBranch = z.input<typeof createBranchSchema>;

export const updateBranchSchema = z
  .object({ ...branchFields, version: z.number().int().positive() })
  .refine(nameRequired, {
    error: 'A branch name in Arabic or English is required.',
    path: ['nameAr'],
  });
export type UpdateBranch = z.input<typeof updateBranchSchema>;

export const branchStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
  /**
   * On reactivation, what to do with the role assignments that were dormant at the branch
   * (BR-192): required when any exist; `GRANTS_NEED_CONFIRMATION` lists them otherwise.
   */
  dormantGrants: z.enum(['keep', 'clear']).optional(),
});
export type BranchStatus = z.input<typeof branchStatusSchema>;

// ---------------------------------------------------------------- roles & permissions
export const permissionInfoSchema = z.object({
  key: z.string(),
  scope: z.enum(['merchant', 'branch']),
  group: z.string(),
  description: z.string(),
});
export const permissionCatalogSchema = z.object({ permissions: z.array(permissionInfoSchema) });
export type PermissionInfo = z.infer<typeof permissionInfoSchema>;

export const roleSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  templateKey: z.string().nullable(),
  permissions: z.array(z.string()),
  assignmentCount: z.number().int(),
  version: z.number().int(),
  /** Whether the current user may edit this role (anti-escalation). */
  editable: z.boolean(),
});
export type Role = z.infer<typeof roleSchema>;
export const roleListSchema = z.object({
  roles: z.array(roleSchema),
  /** Permission keys the current user may put into roles (held merchant-wide). */
  grantable: z.array(z.string()),
});

const roleFields = {
  nameEn: text(80),
  nameAr: text(80),
  permissions: z.array(z.string()).max(200),
};
export const createRoleSchema = z
  .object(roleFields)
  .refine(nameRequired, { error: 'A role name is required.', path: ['nameAr'] });
export type CreateRole = z.input<typeof createRoleSchema>;
export const updateRoleSchema = z
  .object({ ...roleFields, version: z.number().int().positive() })
  .refine(nameRequired, { error: 'A role name is required.', path: ['nameAr'] });
export type UpdateRole = z.input<typeof updateRoleSchema>;

// ---------------------------------------------------------------- employees
export const assignmentSchema = z.object({ roleId: z.uuid(), branchId: z.uuid().nullable() });
export type Assignment = z.infer<typeof assignmentSchema>;

export const employeeSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  phone: z.string().nullable(),
  employeeCode: z.string().nullable(),
  isOwner: z.boolean(),
  status: z.enum(['invited', 'active', 'inactive']),
  userStatus: z.enum(['active', 'disabled']),
  lastLoginAt: z.string().nullable(),
  assignments: z.array(assignmentSchema),
  /** Whether the current user may manage this employee (anti-escalation). */
  manageable: z.boolean(),
  createdAt: z.string(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'revoked']),
  expired: z.boolean(),
  assignments: z.array(assignmentSchema),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const employeeListSchema = z.object({
  employees: z.array(employeeSchema),
  invitations: z.array(invitationSchema),
});

export const inviteEmployeeSchema = z.object({
  email: emailSchema,
  fullName: requiredText(120),
  jobTitle: text(80).optional(),
  phone: text(30).optional(),
  employeeCode: text(30).optional(),
  interface: z.enum(['manager', 'pos']).default('pos'),
  assignments: z.array(assignmentSchema).min(1).max(50),
});
export type InviteEmployee = z.input<typeof inviteEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  jobTitle: text(80),
  phone: text(30),
  employeeCode: text(30),
});
export type UpdateEmployee = z.input<typeof updateEmployeeSchema>;

export const employeeStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export const setAssignmentsSchema = z.object({ assignments: z.array(assignmentSchema).max(50) });
export type SetAssignments = z.input<typeof setAssignmentsSchema>;

// ---------------------------------------------------------------- invitation acceptance (public)
export const invitationTokenSchema = z.object({ token: z.string().min(20).max(200) });
export const invitationPreviewSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  merchant: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  /** True when an account with this e-mail exists: the person confirms with their password. */
  existingAccount: z.boolean(),
  expiresAt: z.string(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  /** New account: the chosen password. Existing account: the current password. */
  password: z.string().min(1).max(128),
  preferredLanguage: languageSchema.optional(),
});
export type AcceptInvitation = z.input<typeof acceptInvitationSchema>;
export const acceptInvitationResultSchema = z.object({
  status: z.literal('accepted'),
  availableInterfaces: z.array(z.enum(['manager', 'pos'])),
});

export { newPasswordSchema };
