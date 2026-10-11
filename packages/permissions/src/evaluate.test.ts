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
