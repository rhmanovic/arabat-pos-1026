import type { Assignment, Role } from '@arabat/contracts';
import { Button, Select } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { useBranchContext } from '../../app/context.js';

/** Rows of (role, branch | all branches). The server enforces what the user may grant. */
export function AssignmentsEditor({
  value,
  onChange,
  roles,
  disabled,
}: {
  value: Assignment[];
  onChange: (value: Assignment[]) => void;
  roles: Role[];
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { branches } = useBranchContext();
  const active = branches.filter((b) => b.status === 'active');
  const update = (index: number, patch: Partial<Assignment>) =>
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('employees.assignmentsHint')}</p>
      {value.map((a, index) => (
        <div
          key={index}
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          data-testid="assignment-row"
        >
          <Select
            aria-label={t('employees.role')}
            value={a.roleId}
            disabled={disabled}
            onChange={(e) => update(index, { roleId: e.target.value })}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {localizedName(r, i18n.language)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('employees.branch')}
            value={a.branchId ?? ''}
            disabled={disabled}
            onChange={(e) => update(index, { branchId: e.target.value || null })}
          >
            <option value="">{t('employees.allBranchesScope')}</option>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {localizedName(b, i18n.language)}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            {t('employees.remove')}
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || roles.length === 0}
          onClick={() =>
            onChange([...value, { roleId: roles[0]!.id, branchId: active[0]?.id ?? null }])
          }
        >
          {t('employees.addAssignment')}
        </Button>
      </div>
    </div>
  );
}

/** "Cashier · Main branch, Manager · All branches" */
export function useAssignmentLabel(roles: Role[] | undefined) {
  const { t, i18n } = useTranslation();
  const { branches } = useBranchContext();
  return (assignments: Assignment[]) => {
    if (assignments.length === 0) return t('employees.noRoles');
    return assignments
      .map((a) => {
        const role = roles?.find((r) => r.id === a.roleId);
        const branch = a.branchId ? branches.find((b) => b.id === a.branchId) : null;
        const roleName = role ? localizedName(role, i18n.language) : '…';
        const where = a.branchId
          ? branch
            ? localizedName(branch, i18n.language)
            : '…'
          : t('employees.allBranchesScope');
        return `${roleName} · ${where}`;
      })
      .join(i18n.language.startsWith('ar') ? '، ' : ', ');
  };
}
