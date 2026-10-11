import { describe, expect, it } from 'vitest';
import {
  type MerchantActorAccess,
  accessibleBranches,
  branchesWithPermission,
  can,
} from './index.js';

const base: MerchantActorAccess = {
  membershipActive: true,
  merchantActive: true,
  isOwner: false,
  assignments: [],
};

const cashierAtA: MerchantActorAccess = {
  ...base,
  assignments: [{ branchId: 'A', permissions: ['pos.access'] }],
};

describe('can()', () => {
  it('denies by default when the actor has no assignments', () => {
    expect(can(base, 'manager.access', 'A')).toBe(false);
    expect(can(base, 'pos.access', 'A')).toBe(false);
  });

  it('owner has every permission at every branch', () => {
    const owner = { ...base, isOwner: true };
    expect(can(owner, 'manager.access', 'Z')).toBe(true);
    expect(can(owner, 'roles.manage')).toBe(true);
  });

  it('a cashier does not get management access (BR-013)', () => {
    expect(can(cashierAtA, 'pos.access', 'A')).toBe(true);
    expect(can(cashierAtA, 'manager.access', 'A')).toBe(false);
  });

  it('a manager does not get POS access implicitly (BR-014)', () => {
    const manager = { ...base, assignments: [{ branchId: null, permissions: ['manager.access'] }] };
    expect(can(manager, 'manager.access', 'A')).toBe(true);
    expect(can(manager, 'pos.access', 'A')).toBe(false);
  });

  it('branch-scoped grants apply only to their branch', () => {
    expect(can(cashierAtA, 'pos.access', 'B')).toBe(false);
    expect(can(cashierAtA, 'pos.access')).toBe(false);
  });

  it('supports different roles at different branches (BR-024)', () => {
    const mixed = {
      ...base,
      assignments: [
        { branchId: 'A', permissions: ['manager.access', 'pos.access'] },
        { branchId: 'B', permissions: ['pos.access'] },
      ],
    };
    expect(can(mixed, 'manager.access', 'A')).toBe(true);
    expect(can(mixed, 'manager.access', 'B')).toBe(false);
    expect(can(mixed, 'pos.access', 'B')).toBe(true);
  });

  it('merchant-scoped permissions require a merchant-wide assignment', () => {
    const branchOnly = { ...base, assignments: [{ branchId: 'A', permissions: ['roles.manage'] }] };
    expect(can(branchOnly, 'roles.manage', 'A')).toBe(false);
    const wide = { ...base, assignments: [{ branchId: null, permissions: ['roles.manage'] }] };
    expect(can(wide, 'roles.manage')).toBe(true);
  });

  it('denies everything for inactive memberships or suspended merchants, even owners', () => {
    const owner = { ...base, isOwner: true };
    expect(can({ ...owner, membershipActive: false }, 'manager.access', 'A')).toBe(false);
    expect(can({ ...owner, merchantActive: false }, 'manager.access', 'A')).toBe(false);
  });

  it('denies unknown permission keys', () => {
    const owner = { ...base, isOwner: true };
    expect(can(owner, 'does.not.exist' as never)).toBe(false);
  });
});

describe('branch helpers', () => {
  it('computes accessible branches', () => {
    expect(accessibleBranches(cashierAtA)).toEqual({ all: false, branchIds: ['A'] });
    expect(accessibleBranches({ ...base, isOwner: true })).toEqual({ all: true });
  });

  it('lists branches where a permission is held', () => {
    expect(branchesWithPermission(cashierAtA, 'pos.access', ['A', 'B'])).toEqual(['A']);
  });
});

import { canAnywhere, canGrant, canManageMember, permissionBranchScope } from './index.js';
import { ROLE_TEMPLATES } from './templates.js';
import { PERMISSIONS } from './catalog.js';

describe('anti-escalation', () => {
  const branchManagerAtA: MerchantActorAccess = {
    ...base,
    assignments: [{ branchId: 'A', permissions: [...ROLE_TEMPLATES.branch_manager.permissions] }],
  };

  it('lets a branch manager grant cashier rights at their own branch only', () => {
    expect(canGrant(branchManagerAtA, ROLE_TEMPLATES.cashier.permissions, 'A')).toEqual({
      ok: false,
      missing: expect.arrayContaining(['pos.access']),
    });
    const withPos = {
      ...base,
      assignments: [
        {
          branchId: 'A',
          permissions: [
            ...ROLE_TEMPLATES.branch_manager.permissions,
            ...ROLE_TEMPLATES.cashier.permissions,
          ],
        },
      ],
    };
    expect(canGrant(withPos, ROLE_TEMPLATES.cashier.permissions, 'A')).toEqual({ ok: true });
    expect(canGrant(withPos, ROLE_TEMPLATES.cashier.permissions, 'B').ok).toBe(false);
    expect(canGrant(withPos, ROLE_TEMPLATES.cashier.permissions, null).ok).toBe(false);
  });

  it('never lets anyone grant permissions they do not hold', () => {
    const result = canGrant(branchManagerAtA, ['roles.manage'], 'A');
    expect(result).toEqual({ ok: false, missing: ['roles.manage'] });
    expect(canGrant(branchManagerAtA, ['not.a.permission'], 'A').ok).toBe(false);
  });

  it('owners may grant everything', () => {
    expect(canGrant({ ...base, isOwner: true }, Object.keys(PERMISSIONS), null)).toEqual({
      ok: true,
    });
  });

  it('protects the owner, oneself and more privileged members', () => {
    const owner = { ...base, isOwner: true };
    const companyManager = {
      ...base,
      assignments: [
        { branchId: null, permissions: [...ROLE_TEMPLATES.company_manager.permissions] },
      ],
    };
    expect(canManageMember(companyManager, owner, false)).toBe(false);
    expect(canManageMember(owner, companyManager, false)).toBe(true);
    expect(canManageMember(owner, owner, true)).toBe(false);
    expect(canManageMember(branchManagerAtA, companyManager, false)).toBe(false);
    const cashierAtB = { ...base, assignments: [{ branchId: 'B', permissions: ['pos.access'] }] };
    expect(canManageMember(branchManagerAtA, cashierAtB, false)).toBe(false);
  });

  it('computes where a permission is held', () => {
    expect(canAnywhere(branchManagerAtA, 'employees.manage')).toBe(true);
    expect(canAnywhere(branchManagerAtA, 'roles.manage')).toBe(false);
    expect(permissionBranchScope(branchManagerAtA, 'inventory.adjust')).toEqual({
      all: false,
      branchIds: ['A'],
    });
    expect(permissionBranchScope({ ...base, isOwner: true }, 'inventory.adjust')).toEqual({
      all: true,
    });
  });

  it('keeps every template permission in the catalog and managers away from the POS', () => {
    for (const template of Object.values(ROLE_TEMPLATES)) {
      for (const key of template.permissions)
        expect(Object.hasOwn(PERMISSIONS, key), key).toBe(true);
    }
    expect(ROLE_TEMPLATES.company_manager.permissions).not.toContain('pos.access');
    expect(ROLE_TEMPLATES.branch_manager.permissions).not.toContain('pos.access');
    expect(ROLE_TEMPLATES.cashier.permissions).not.toContain('manager.access');
  });
});
