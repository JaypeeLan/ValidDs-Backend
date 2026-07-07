import type { UserRole } from '../types/user.types';

export function isSuperAdmin(role: UserRole | string | undefined): boolean {
  return role === 'super_admin';
}

export function isDashboardRole(role: UserRole | string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isPrivilegedAdmin(role: UserRole | string | undefined): boolean {
  return isDashboardRole(role);
}

/** True when the user's role satisfies any of the required roles. */
export function userHasRole(
  userRole: UserRole | string | undefined,
  ...required: UserRole[]
): boolean {
  if (!userRole || required.length === 0) return false;
  return required.some((role) => {
    if (role === 'admin') return isDashboardRole(userRole);
    return userRole === role;
  });
}

export function canManageAdminAccounts(actorRole: UserRole | string | undefined): boolean {
  return isSuperAdmin(actorRole);
}
