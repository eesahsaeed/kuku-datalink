export const PRIMARY_ADMIN_EMAIL = 'admin@kuku.com.ng';
export const ADMIN_DASHBOARD_ROLE = 'admin-dashboard';
export const DEFAULT_WORKSPACE_ROLE = 'customer';
export const WORKSPACE_ROLE_VALUES = ['admin', 'staff', 'customer'];

export const normalizeEmailAddress = (value = '') =>
  String(value || '').toLowerCase().trim();

export const normalizeRole = (value = '') =>
  String(value || '').toLowerCase().trim();

const uniqueRoles = (roles = []) =>
  Array.from(
    new Set(
      roles
        .map((role) => normalizeRole(role))
        .filter((role) => WORKSPACE_ROLE_VALUES.includes(role))
    )
  );

const flattenRoleInput = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRoleInput(item));
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return [];
  }

  if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
    try {
      return flattenRoleInput(JSON.parse(trimmedValue));
    } catch (_error) {
      // Fall through to comma-split parsing.
    }
  }

  return trimmedValue
    .split(',')
    .map((item) => normalizeRole(item))
    .filter(Boolean);
};

export const getUserRoles = (user = {}) => {
  const sourceRoles =
    Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles
      : Array.isArray(user?.role)
      ? user.role
      : user?.role;

  const normalizedRoles = uniqueRoles(flattenRoleInput(sourceRoles));
  const workspaceRole =
    ['admin', 'staff', 'customer'].find((role) =>
      normalizedRoles.includes(role)
    ) || DEFAULT_WORKSPACE_ROLE;

  if (normalizeEmailAddress(user?.emailAddress || user?.email) === PRIMARY_ADMIN_EMAIL) {
    return ['admin'];
  }

  return uniqueRoles([workspaceRole]);
};

export const getPrimaryWorkspaceRole = (user = {}) =>
  getUserRoles(user).find((role) => WORKSPACE_ROLE_VALUES.includes(role)) ||
  DEFAULT_WORKSPACE_ROLE;

export const hasRole = (user = {}, roleName = '') =>
  getUserRoles(user).includes(normalizeRole(roleName));

export const hasAdminDashboardAccess = (user = {}) => {
  const legacyRoleValues = flattenRoleInput(user?.roles ?? user?.role);
  return (
    hasRole(user, 'admin') ||
    user?.adminDashboardAccess === true ||
    user?.canAccessAdminDashboard === true ||
    legacyRoleValues.includes(ADMIN_DASHBOARD_ROLE)
  );
};

export const isAdminUser = (user = {}) =>
  hasRole(user, 'admin') || user?.isAdmin === true;

export const isCustomerUser = (user = {}) =>
  getPrimaryWorkspaceRole(user) === 'customer';

export const isPrimaryAdminUser = (user = {}) =>
  normalizeEmailAddress(user?.emailAddress || user?.email) ===
  PRIMARY_ADMIN_EMAIL;
