const PRIMARY_ADMIN_EMAIL = 'admin@kuku.com.ng';
const DEFAULT_WORKSPACE_ROLE = 'customer';
const WORKSPACE_ROLE_VALUES = ['admin', 'staff', 'customer'];
const ADMIN_DASHBOARD_ROLE = 'admin-dashboard';
const ROLE_VALUES = [...WORKSPACE_ROLE_VALUES];
const WORKSPACE_ROLE_PRIORITY = ['admin', 'staff', 'customer'];

const normalizeEmailAddress = (value = '') =>
  String(value || '')
    .toLowerCase()
    .trim();

const normalizeRoleName = (value = '') =>
  String(value || '')
    .toLowerCase()
    .trim();

const uniqueRoles = (roles = []) =>
  Array.from(
    new Set(
      roles
        .map((role) => normalizeRoleName(role))
        .filter((role) => ROLE_VALUES.includes(role))
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
      const parsedValue = JSON.parse(trimmedValue);
      return flattenRoleInput(parsedValue);
    } catch (_error) {
      // Fall through to simple comma-separated parsing.
    }
  }

  return trimmedValue
    .split(',')
    .map((item) => normalizeRoleName(item))
    .filter(Boolean);
};

const isPrimaryAdminEmail = (emailAddress = '') =>
  normalizeEmailAddress(emailAddress) === PRIMARY_ADMIN_EMAIL;

const getPrimaryWorkspaceRole = (
  rolesInput = [],
  fallbackRole = DEFAULT_WORKSPACE_ROLE
) => {
  const roles = uniqueRoles(flattenRoleInput(rolesInput));

  for (const role of WORKSPACE_ROLE_PRIORITY) {
    if (roles.includes(role)) {
      return role;
    }
  }

  const normalizedFallbackRole = normalizeRoleName(fallbackRole);
  return WORKSPACE_ROLE_VALUES.includes(normalizedFallbackRole)
    ? normalizedFallbackRole
    : DEFAULT_WORKSPACE_ROLE;
};

const normalizeStoredRoles = (
  rolesInput = [],
  {
    emailAddress = '',
    fallbackRole = DEFAULT_WORKSPACE_ROLE,
  } = {}
) => {
  const sourceRoles = uniqueRoles(flattenRoleInput(rolesInput));
  let primaryWorkspaceRole = getPrimaryWorkspaceRole(sourceRoles, fallbackRole);

  if (isPrimaryAdminEmail(emailAddress)) {
    primaryWorkspaceRole = 'admin';
  }

  return uniqueRoles([primaryWorkspaceRole]);
};

const getUserRoles = (user = {}, options = {}) => {
  const hasExplicitRolesArray =
    Array.isArray(user?.roles) && user.roles.length > 0;
  const sourceRoles = hasExplicitRolesArray ? user.roles : user?.role;

  return normalizeStoredRoles(sourceRoles, {
    emailAddress: user?.emailAddress || user?.email || '',
    ...options,
  });
};

const hasRole = (userOrRoles = {}, roleName = '') => {
  const normalizedRoleName = normalizeRoleName(roleName);
  if (!normalizedRoleName) return false;

  const roles = Array.isArray(userOrRoles)
    ? normalizeStoredRoles(userOrRoles)
    : getUserRoles(userOrRoles);

  return roles.includes(normalizedRoleName);
};

const hasAdminDashboardAccess = (userOrRoles = {}) => {
  if (Array.isArray(userOrRoles)) {
    return normalizeStoredRoles(userOrRoles).includes('admin');
  }

  const legacyRoles = flattenRoleInput(userOrRoles?.roles ?? userOrRoles?.role);
  return (
    hasRole(userOrRoles, 'admin') ||
    userOrRoles?.adminDashboardAccess === true ||
    userOrRoles?.canAccessAdminDashboard === true ||
    legacyRoles.includes(ADMIN_DASHBOARD_ROLE)
  );
};

const isAdminUser = (userOrRoles = {}) =>
  hasRole(userOrRoles, 'admin') || userOrRoles?.isAdmin === true;

const isCustomerUser = (userOrRoles = {}) =>
  getPrimaryWorkspaceRole(
    Array.isArray(userOrRoles) ? userOrRoles : getUserRoles(userOrRoles)
  ) === 'customer';

const buildSignupRoles = (emailAddress = '') =>
  normalizeStoredRoles(isPrimaryAdminEmail(emailAddress) ? ['admin'] : [], {
    emailAddress,
  });

const buildManagedRoles = ({
  workspaceRole = DEFAULT_WORKSPACE_ROLE,
  emailAddress = '',
} = {}) =>
  normalizeStoredRoles(
    [workspaceRole],
    { emailAddress }
  );

const rolesEqual = (left = [], right = []) => {
  const normalizedLeft = normalizeStoredRoles(left);
  const normalizedRight = normalizeStoredRoles(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((role, index) => role === normalizedRight[index]);
};

const getNormalizedUserRoleState = (user = {}, options = {}) => {
  const roles = getUserRoles(user, options);
  return {
    roles,
    primaryRole: getPrimaryWorkspaceRole(roles),
    hasAdminDashboardAccess: hasAdminDashboardAccess(user),
  };
};

module.exports = {
  ADMIN_DASHBOARD_ROLE,
  DEFAULT_WORKSPACE_ROLE,
  PRIMARY_ADMIN_EMAIL,
  ROLE_VALUES,
  WORKSPACE_ROLE_VALUES,
  buildManagedRoles,
  buildSignupRoles,
  getNormalizedUserRoleState,
  getPrimaryWorkspaceRole,
  getUserRoles,
  hasAdminDashboardAccess,
  hasRole,
  isAdminUser,
  isCustomerUser,
  isPrimaryAdminEmail,
  normalizeEmailAddress,
  normalizeRoleName,
  normalizeStoredRoles,
  rolesEqual,
};
