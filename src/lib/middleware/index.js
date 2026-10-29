const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const User = require('../schema/UserSchema');
const {
  getNormalizedUserRoleState,
  hasAdminDashboardAccess,
  isPrimaryAdminEmail,
  rolesEqual,
} = require('../utils/roles');

const resolveJwtSecret = () => {
  const configuredSecret = String(process.env.JWT_SECRET || '').trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured');
  }

  return 'kukudata-secret';
};

const kukuJWT = resolveJwtSecret();
// Temporary toggle: disable email-verification enforcement without deleting logic.
const EMAIL_VERIFICATION_ENFORCED = false;

const isPrimaryAdminUser = (user = {}) =>
  isPrimaryAdminEmail(user?.email || user?.emailAddress || '');

const normalizeTokenEmail = (value = '') =>
  String(value || '')
    .toLowerCase()
    .trim();

const resolveDecodedUserId = (decoded = {}) => {
  const candidates = [
    decoded?.id,
    decoded?._id,
    decoded?.userId,
    decoded?.user?._id,
    decoded?.user?.id,
  ];

  for (const candidate of candidates) {
    const normalizedCandidate =
      typeof candidate === 'object' && candidate !== null
        ? candidate._id || candidate.id || ''
        : candidate;

    const asString = String(normalizedCandidate || '').trim();

    if (asString && mongoose.Types.ObjectId.isValid(asString)) {
      return asString;
    }
  }

  return '';
};

const findAuthenticatedUser = async (decoded = {}) => {
  const decodedUserId = resolveDecodedUserId(decoded);

  if (decodedUserId) {
    return User.findById(decodedUserId).select('-password');
  }

  const decodedEmail = normalizeTokenEmail(
    decoded?.email || decoded?.emailAddress || decoded?.user?.email
  );

  if (!decodedEmail) {
    return null;
  }

  return User.findOne({ emailAddress: decodedEmail }).select('-password');
};

const isVerificationAllowedPath = (req) => {
  if (req.baseUrl !== '/api/authentication') return false;

  const path = String(req.path || '').trim();
  return [
    '/me',
    '/resend-verification',
    '/verify-email-code',
    '/verify-email',
  ].some(
    (allowedPath) => path === allowedPath || path.startsWith(`${allowedPath}/`)
  );
};

// middleware/adminMiddleware.js
const adminMiddleware = (req, res, next) => {
  const user = req.user; // from your authMiddleware (JWT or session)

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Authentication required' });
  }

  // Adjust according to your User model
  const isAdmin = hasAdminDashboardAccess(user);

  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied – admin privileges required',
    });
  }

  next();
};

const primaryAdminMiddleware = (req, res, next) => {
  const user = req.user;

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Authentication required' });
  }

  if (!isPrimaryAdminUser(user)) {
    return res.status(403).json({
      success: false,
      message: 'Only the primary admin account can manage user roles',
    });
  }

  next();
};

const authMiddleware = async (req, res, next) => {
  try {
    // 1. Get token from header
    const authHeader =
      req.header('Authorization') || req.header('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided or invalid format.',
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token missing.',
      });
    }

    // 2. Verify token
    const decoded = jwt.verify(token, kukuJWT);

    // 3. Find user and attach to request
    const user = await findAuthenticatedUser(decoded);

    if (!user) {
      const hasDecodedIdentity =
        Boolean(resolveDecodedUserId(decoded)) ||
        Boolean(
          normalizeTokenEmail(
            decoded?.email || decoded?.emailAddress || decoded?.user?.email
          )
        );

      if (!hasDecodedIdentity) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token payload. Please log in again.',
        });
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.',
      });
    }

    const normalizedRoleState = getNormalizedUserRoleState(user);
    if (!rolesEqual(user.roles, normalizedRoleState.roles)) {
      user.roles = normalizedRoleState.roles;
      user.lastUpdated = new Date();
      await user.save({ validateBeforeSave: false });
    }

    // Optional: Check if user has been blocked or deactivated
    if (user.blocked) {
      return res.status(401).json({
        success: false,
        message: 'Account is disabled. Contact support.',
      });
    }

    if (
      EMAIL_VERIFICATION_ENFORCED &&
      !user.emailVerified &&
      !isVerificationAllowedPath(req)
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Please verify your email address before accessing this endpoint.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // 4. Attach user to request object
    req.user = {
      id: user._id,
      email: user.emailAddress,
      emailAddress: user.emailAddress,
      fullName: user.fullName,
      roles: normalizedRoleState.roles,
      canAccessAdminDashboard: normalizedRoleState.hasAdminDashboardAccess,
      createdAt: user.createdAt,
      authType: user.authType,
      token: token,
      wallet: user.wallet,
    };

    // Also attach full user if needed in some routes
    req.userFull = user;

    //console.log("AuthMiddleware ", user)

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please log in again.',
      });
    }

    if (
      error.name === 'CastError' ||
      error.name === 'BSONTypeError' ||
      /objectid/i.test(String(error.message || ''))
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload. Please log in again.',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during authentication.',
    });
  }
};

module.exports = { authMiddleware, adminMiddleware, primaryAdminMiddleware };
