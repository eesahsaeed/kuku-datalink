const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require("crypto");
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');

const User = require('../../schema/UserSchema.js');
const AuthIdempotency = require('../../schema/AuthIdempotencySchema.js');
const {
  noreply,
  getAuthFrontendUrl,
  networkTimeout,
} = require('../../helper.js');
const { authMiddleware } = require('../../middleware');
const {
  buildSignupRoles,
  getNormalizedUserRoleState,
  rolesEqual,
} = require('../../utils/roles');
const {
  createOrFetchPaystackVirtualAccount,
} = require('../../services/paystackService');
const {
  normalizeNigerianPhoneNumber,
  isValidNigerianPhoneNumber,
} = require('../../utils/phoneNumber');
const {
  sendNoReplyMail,
  isSmtpConnectivityError,
  isSmtpTimeoutError,
} = require('../../services/mailService');

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
const DEFAULT_GOOGLE_WEB_CLIENT_ID =
  '968600140927-c7v3ie8um4qs7qvh0mign2jooa1sco9s.apps.googleusercontent.com';
const DEFAULT_GOOGLE_MOBILE_CLIENT_IDS = [
  '968600140927-c7v3ie8um4qs7qvh0mign2jooa1sco9s.apps.googleusercontent.com',
  '968600140927-8vo5l6s5bu8l5uvp85vdrjmc6ig11ncf.apps.googleusercontent.com',
  '968600140927-sn77fd7nssnf1b2ng0r3ii7pu9tmqi1v.apps.googleusercontent.com',
];
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const generateHexToken = (byteLength = 32) => {
  const tokenSource = `${uuidv4().replace(/-/g, '')}${uuidv4()
    .replace(/-/g, '')}`;

  return tokenSource.slice(0, byteLength * 2);
};

const generateEmailVerificationToken = () => generateHexToken(32);

const generateEmailVerificationCode = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const hasTransactionPin = (user) =>
  Boolean(user?.transactionPinSetAt || user?.transactionPinHash);

const synchronizeUserRoles = async (userDoc) => {
  if (!userDoc) return userDoc;

  const normalizedRoleState = getNormalizedUserRoleState(userDoc);
  if (!rolesEqual(userDoc.roles, normalizedRoleState.roles)) {
    userDoc.roles = normalizedRoleState.roles;
    userDoc.lastUpdated = new Date();
    await userDoc.save({ validateBeforeSave: false });
  }

  return userDoc;
};

const buildJwtPayload = (userDoc) => {
  const normalizedRoleState = getNormalizedUserRoleState(userDoc);

  return {
    id: userDoc._id,
    email: userDoc.emailAddress,
    roles: normalizedRoleState.roles,
  };
};

// Temporary toggle: keep verification implementation but bypass enforcement/send flow.
const EMAIL_VERIFICATION_ENFORCED = false;
const EMAIL_FOLDER_REMINDER =
  'Please check your inbox and also your spam, junk, or promotions folder.';
const withEmailFolderReminder = (message = '') =>
  `${String(message || '').trim()} ${EMAIL_FOLDER_REMINDER}`.trim();
const normalizeEmailForMessage = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase();
const buildPasswordResetSentMessage = (emailAddress = '') =>
  withEmailFolderReminder(
    `A password reset link has been sent to ${normalizeEmailForMessage(
      emailAddress
    )}.`
  );
const buildPinResetSentMessage = (emailAddress = '') =>
  withEmailFolderReminder(
    `A transaction PIN reset link has been sent to ${normalizeEmailForMessage(
      emailAddress
    )}.`
  );

const buildEmailVerificationFields = () => {
  if (EMAIL_VERIFICATION_ENFORCED) {
    return {
      emailVerified: false,
      emailVerificationToken: generateEmailVerificationToken(),
      emailVerificationCode: generateEmailVerificationCode(),
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  return {
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationCode: null,
    emailVerificationExpires: null,
  };
};

const isEmailVerificationRequired = (user) =>
  EMAIL_VERIFICATION_ENFORCED && user?.emailVerified !== true;

const buildEmailFailureMessage = (fallbackMessage = '') => {
  const normalizedFallback = String(fallbackMessage || '').trim();
  return normalizedFallback || 'Could not send email right now.';
};

const isEmailTimeoutError = (error) => {
  return isSmtpTimeoutError(error);
};

const isEmailConnectivityError = (error) => {
  return isSmtpConnectivityError(error);
};

const rollbackUserEmailFields = async (user, fields = []) => {
  if (!user || !Array.isArray(fields) || !fields.length) return;

  fields.forEach((fieldName) => {
    user[fieldName] = null;
  });

  await user.save();
};

const sendVerificationEmail = async (user) => {
  if (!user?.emailAddress || !user?.emailVerificationToken) {
    throw new Error('Email verification details are incomplete');
  }

  const verificationUrl = `${getAuthFrontendUrl()}/confirm-email/${user.emailVerificationToken}`;

  await sendNoReplyMail({
    from: `"Kuku Data" <${noreply.email}>`,
    to: user.emailAddress,
    subject: 'Confirm your Kuku Data account',
    html: `
      <h1>Confirm your email</h1>
      <p>Welcome to Kuku Data. Please confirm your email address to activate your account.</p>
      <p>Your 6-digit verification code is:</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px;">${user.emailVerificationCode}</p>
      <p>
        <a href="${verificationUrl}" style="padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;">Confirm Email</a>
      </p>
      <p>You can also use the button above or enter the code on the confirmation page.</p>
      <p>If the button does not work, use this link:</p>
      <p style="word-break: break-all;">${verificationUrl}</p>
      <p>This link will expire in 24 hours.</p>
    `,
  }, {
    label: 'sendVerificationEmail',
  });
};

const sendPinResetEmail = async (user) => {
  if (!user?.emailAddress || !user?.pinResetToken) {
    throw new Error('PIN reset details are incomplete');
  }

  const resetUrl = `${getAuthFrontendUrl()}/open-reset-pin/${user.pinResetToken}`;

  await sendNoReplyMail({
    from: `"Kuku Data" <${noreply.email}>`,
    to: user.emailAddress,
    subject: 'Reset your Kuku Data transaction PIN',
    html: `
      <h1>Reset your transaction PIN</h1>
      <p>We received a request to reset your 4-digit transaction PIN.</p>
      <p>
        <a href="${resetUrl}" style="padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;">Reset PIN</a>
      </p>
      <p>If the button does not work, use this link:</p>
      <p style="word-break: break-all;">${resetUrl}</p>
      <p>This link will expire in 1 hour.</p>
    `,
  }, {
    label: 'sendPinResetEmail',
  });
};

const attachVirtualAccountToUserResponse = async (userId) => {
  const freshUser = await User.findById(userId).select(
    '-password -resetPasswordToken -resetPasswordExpires -transactionPinHash'
  );
  return freshUser;
};

const toSafeUserPayload = (userDoc) => {
  if (!userDoc) return null;

  const base = userDoc?.toProfileJSON
    ? userDoc.toProfileJSON()
    : userDoc.toObject
    ? userDoc.toObject()
    : { ...userDoc };

  return {
    ...base,
    emailVerified: Boolean(userDoc.emailVerified),
    hasTransactionPin: hasTransactionPin(userDoc),
  };
};

const attemptVirtualAccountProvision = async (user, contextLabel) => {
  try {
    const virtualAccount = await createOrFetchPaystackVirtualAccount(user);
    return {
      provisioned: true,
      pending: false,
      virtualAccount,
      message: '',
    };
  } catch (provisionError) {
    console.error(
      `Paystack VA auto-provision failed during ${contextLabel}:`,
      provisionError.message
    );
    return {
      provisioned: false,
      pending: true,
      virtualAccount: null,
      message: provisionError.message,
    };
  }
};

const hasUsableVirtualAccountFromUser = (user) =>
  Boolean(
    String(user?.virtualAccount?.virtual_account_number || '').trim() &&
      String(user?.virtualAccount?.account_name || '').trim()
  );

const IDEMPOTENCY_HEADER = 'idempotency-key';
const AUTH_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const buildIdempotencyHash = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const normalizeIdempotencyKey = (req) =>
  String(
    req.headers?.[IDEMPOTENCY_HEADER] ||
      req.headers?.['x-idempotency-key'] ||
      ''
  ).trim();

const finalizeIdempotency = async (recordId, statusCode, responseBody) => {
  await AuthIdempotency.findByIdAndUpdate(recordId, {
    status: 'completed',
    statusCode,
    responseBody,
  });
};

const releaseIdempotency = async (recordId) => {
  if (!recordId) return;
  await AuthIdempotency.findByIdAndDelete(recordId);
};

const beginIdempotentRequest = async (req, route, payload) => {
  const key = normalizeIdempotencyKey(req);
  if (!key) {
    return { enabled: false };
  }

  const requestHash = buildIdempotencyHash(payload);
  const existing = await AuthIdempotency.findOne({ route, key });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return {
        enabled: true,
        conflict: true,
        statusCode: 409,
        responseBody: {
          success: false,
          message:
            'This idempotency key has already been used with a different request.',
        },
      };
    }

    if (existing.status === 'completed' && existing.responseBody) {
      return {
        enabled: true,
        replay: true,
        statusCode: existing.statusCode || 200,
        responseBody: existing.responseBody,
      };
    }

    return {
      enabled: true,
      conflict: true,
      statusCode: 409,
      responseBody: {
        success: false,
        message: 'A matching request is already being processed. Please wait.',
      },
    };
  }

  const record = await AuthIdempotency.create({
    route,
    key,
    requestHash,
    status: 'in_progress',
    expiresAt: new Date(Date.now() + AUTH_IDEMPOTENCY_TTL_MS),
  });

  return {
    enabled: true,
    recordId: record._id,
  };
};

const normalizeConfiguredValue = (value = '') => String(value || '').trim();

const configuredGoogleClientIds = [
  process.env.VITE_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_EXPO_ANDROID_CLIENT_ID,
  process.env.GOOGLE_EXPO_IOS_CLIENT_ID,
  ...DEFAULT_GOOGLE_MOBILE_CLIENT_IDS,
  DEFAULT_GOOGLE_WEB_CLIENT_ID,
]
  .flatMap((value) =>
    normalizeConfiguredValue(value)
      .split(',')
      .map((item) => normalizeConfiguredValue(item))
      .filter(Boolean)
  )
  .filter((value, index, array) => array.indexOf(value) === index);

const googleOauthClient = new OAuth2Client(configuredGoogleClientIds[0]);

const createGoogleAuthError = (statusCode, message, details = {}) =>
  Object.assign(new Error(message), {
    statusCode,
    details,
  });

const extractGoogleTokensFromBody = (body = {}) => {
  const idToken = normalizeConfiguredValue(
    body.idToken || body.id_token || body.credential
  );
  const accessToken = normalizeConfiguredValue(
    body.accessToken || body.access_token
  );

  if (!idToken && !accessToken) {
    throw createGoogleAuthError(
      400,
      'Google ID token or access token is required'
    );
  }

  return { idToken, accessToken };
};

const normalizeGoogleProfile = (profile = {}) => ({
  email: normalizeConfiguredValue(profile.email).toLowerCase(),
  name: normalizeConfiguredValue(profile.name || profile.given_name || ''),
  picture: normalizeConfiguredValue(profile.picture || ''),
  emailVerified:
    profile.email_verified === true ||
    profile.email_verified === 'true' ||
    profile.verified_email === true ||
    profile.verified_email === 'true',
  googleId: normalizeConfiguredValue(profile.sub || profile.id || ''),
});

const fetchGoogleProfileFromIdToken = async (idToken) => {
  try {
    const ticket = await googleOauthClient.verifyIdToken({
      idToken,
      audience: configuredGoogleClientIds,
    });
    return normalizeGoogleProfile(ticket.getPayload() || {});
  } catch (error) {
    throw createGoogleAuthError(401, 'Failed to verify Google ID token', {
      reason: error.message,
    });
  }
};

const fetchGoogleProfileFromAccessToken = async (accessToken) => {
  let userInfo = {};
  let googleResponse;

  try {
    googleResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    userInfo = await googleResponse.json();
  } catch (error) {
    throw createGoogleAuthError(
      502,
      'Could not reach Google to verify this login',
      {
        reason: error.message,
      }
    );
  }

  if (!googleResponse.ok) {
    throw createGoogleAuthError(401, 'Failed to verify Google access token', {
      reason:
        userInfo.error_description ||
        userInfo.error ||
        `Google userinfo returned ${googleResponse.status}`,
    });
  }

  return normalizeGoogleProfile(userInfo);
};

const resolveGoogleProfileFromRequest = async (body = {}) => {
  const { idToken, accessToken } = extractGoogleTokensFromBody(body);
  const googleProfile = idToken
    ? await fetchGoogleProfileFromIdToken(idToken)
    : await fetchGoogleProfileFromAccessToken(accessToken);

  if (!googleProfile.email) {
    throw createGoogleAuthError(400, 'Invalid Google account information');
  }

  if (!googleProfile.emailVerified) {
    throw createGoogleAuthError(
      403,
      'The selected Google account email is not verified'
    );
  }

  return googleProfile;
};

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      '-password -resetPasswordToken -resetPasswordExpires'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      user: toSafeUserPayload(user),
      success: true,
      emailVerificationRequired: isEmailVerificationRequired(user),
      pinSetupRequired: !hasTransactionPin(user),
      wallet: user.wallet || null,
    });
  } catch (err) {
    console.error('Fetch User Error:', err.message);
    res.status(500).json({ error: 'Server error retrieving user data' });
  }
});

router.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      '-password -resetPasswordToken -resetPasswordExpires'
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      user: toSafeUserPayload(user),
    });
  } catch (error) {
    console.error('Fetch user by id error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load user',
    });
  }
});

router.patch(
  '/update-phone',
  /*authMiddleware,*/ async (req, res) => {
    try {
      const { phoneNumber, userId } = req.body;
      const normalizedPhoneNumber = normalizeNigerianPhoneNumber(phoneNumber);

      if (!userId) {
        return res.status(400).json({ error: 'User id is required' });
      }

      if (!normalizedPhoneNumber) {
        return res.status(400).json({
          error: [
            'Please enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....',
          ],
        });
      }

      // We only care about the format (11 digits), not if someone else has it
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { phoneNumber: normalizedPhoneNumber },
        {
          returnDocument: 'after',
          runValidators: true,
          context: 'query',
        }
      );

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const virtualAccountResult = await attemptVirtualAccountProvision(
        updatedUser,
        'phone update'
      );
      const refreshedUser = await attachVirtualAccountToUserResponse(
        updatedUser._id
      );

      const token = jwt.sign(buildJwtPayload(updatedUser), kukuJWT);

      updatedUser.password = undefined; // Never send password back

      res.status(200).json({
        success: true,
        message: virtualAccountResult.provisioned
          ? 'Phone number updated successfully'
          : 'Phone updated, but virtual account provisioning is pending',
        user: { ...toSafeUserPayload(refreshedUser), token },
        virtualAccountProvisioned: virtualAccountResult.provisioned,
        virtualAccountProvisioningPending: virtualAccountResult.pending,
        virtualAccountProvisioningMessage: virtualAccountResult.message,
        emailVerificationRequired: isEmailVerificationRequired(refreshedUser),
        pinSetupRequired: !hasTransactionPin(refreshedUser),
      });
    } catch (error) {
      // Handle format validation errors (e.g., letters or wrong length)
      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map((val) => val.message);
        return res.status(400).json({ error: messages });
      }

      console.error('Update Phone Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post('/google-signup', async (req, res) => {
  try {
    const googleProfile = await resolveGoogleProfileFromRequest(req.body);
    const normalizedEmail = googleProfile.email;

    // 2. Check for existing user
    let user = await User.findOne({ emailAddress: normalizedEmail });

    if (user) {
      // Scenario A: Registered with Password
      if (user.authType === 'email') {
        return res.status(409).json({
          success: false,
          message:
            'This email is registered with a password. Please log in instead.',
          error:
            'This email is registered with a password. Please log in instead.',
        });
      }

      // Scenario B: Incomplete Google Registration (Missing Phone)
      if (!user.phoneNumber || String(user.phoneNumber).trim() === '') {
        return res.status(200).json({
          message: 'Registration incomplete. Please provide a phone number.',
          user: toSafeUserPayload(user),
          incomplete: true,
          emailVerificationRequired: isEmailVerificationRequired(user),
          pinSetupRequired: !hasTransactionPin(user),
        });
      }

      // Scenario C: Fully Registered Google User
      return res.status(409).json({
        success: false,
        message: 'An account already exists. Please proceed to the login page.',
        error: 'An account already exists. Please proceed to the login page.',
      });
    }

    // 3. New User Registration
    user = new User({
      fullName: googleProfile.name || 'Google User',
      emailAddress: normalizedEmail,
      role: buildSignupRoles(normalizedEmail),
      authType: 'google',
      ...buildEmailVerificationFields(),
    });

    await user.save();
    let verificationEmailSent = false;
    if (EMAIL_VERIFICATION_ENFORCED) {
      verificationEmailSent = true;
      try {
        await sendVerificationEmail(user);
      } catch (mailError) {
        verificationEmailSent = false;
        console.error('Google signup verification email failed:', mailError);
      }
    }

    const googleSignupMessage =
      'User registered successfully via Google. Please provide a phone number to complete registration.';

    return res.status(201).json({
      message: verificationEmailSent
        ? withEmailFolderReminder(googleSignupMessage)
        : googleSignupMessage,
      user: toSafeUserPayload(user),
      incomplete: true, // New users always need a phone number
      emailVerificationRequired: isEmailVerificationRequired(user),
      pinSetupRequired: !hasTransactionPin(user),
      verificationEmailSent,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        details: err.details?.reason,
      });
    }

    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((val) => val.message);
      return res.status(400).json({ error: messages });
    }

    console.error('Google Signup Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post(
  '/signup',
  [
    // Basic input validation
    body('fullName')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters'),

    body('emailAddress')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),

    body('phoneNumber')
      .optional()
      .custom((value) => !value || isValidNigerianPhoneNumber(value))
      .withMessage(
        'Please provide a valid Nigerian mobile number. You can use 080..., 803..., or 234803....'
      ),

    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/\d/)
      .withMessage('Password must contain at least one number')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter'),
  ],
  async (req, res) => {
    try {
      // 1. Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { fullName, emailAddress, phoneNumber, password } = req.body;
      const normalizedPhoneNumber = phoneNumber
        ? normalizeNigerianPhoneNumber(phoneNumber)
        : null;

      // 2. Check if email already exists
      const existingUser = await User.findOne({
        emailAddress: emailAddress.toLowerCase(),
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'This email address is already registered.',
        });
      }

      // 3. Hash password (12 rounds is more common/recommended in 2026)
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);
      const roles = buildSignupRoles(emailAddress);

      // 4. Create new user
      const newUser = new User({
        fullName: fullName.trim(),
        emailAddress: emailAddress.toLowerCase().trim(),
        phoneNumber: normalizedPhoneNumber || null,
        password: hashedPassword,
        authType: 'email', // important for login differentiation
        ...buildEmailVerificationFields(),
        createdAt: new Date(),
        role: roles,
        // Optional: you can add email verification token here later
        // emailVerificationToken: generateHexToken(32),
        // emailVerificationExpires: Date.now() + 24*60*60*1000
      });

      const savedUser = await newUser.save();

      let verificationEmailSent = false;

      if (EMAIL_VERIFICATION_ENFORCED) {
        verificationEmailSent = true;
        try {
          await sendVerificationEmail(savedUser);
        } catch (mailError) {
          verificationEmailSent = false;
          console.error('Signup verification email failed:', mailError);
        }
      }
      const virtualAccountResult = await attemptVirtualAccountProvision(
        savedUser,
        'signup'
      );
      const refreshedUser = await attachVirtualAccountToUserResponse(
        savedUser._id
      );

      // 5. Prepare safe response (never send password or sensitive fields)
      const safeUser = toSafeUserPayload(refreshedUser);

      // 6. Optional: Auto-login after signup (many apps do this)
      const token = jwt.sign(
        buildJwtPayload(savedUser),
        kukuJWT
      );
      const signupMessage = virtualAccountResult.provisioned
        ? 'Account created successfully.'
        : 'Account created successfully. Virtual account provisioning is pending.';

      return res.status(201).json({
        success: true,
        message: verificationEmailSent
          ? withEmailFolderReminder(signupMessage)
          : signupMessage,
        user: { ...safeUser, token },
        virtualAccountProvisioned: virtualAccountResult.provisioned,
        virtualAccountProvisioningPending: virtualAccountResult.pending,
        virtualAccountProvisioningMessage: virtualAccountResult.message,
        emailVerificationRequired: isEmailVerificationRequired(safeUser),
        pinSetupRequired: !safeUser.hasTransactionPin,
        verificationEmailSent,
        // token,           // uncomment if you want auto-login
        // user: safeUser
      });
    } catch (error) {
      console.error('Signup Error:', error);

      if (error.code === 11000) {
        // MongoDB duplicate key error
        return res.status(409).json({
          success: false,
          message: 'This email address is already registered.',
        });
      }

      if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map((e) => e.message);
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: messages,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          'An error occurred during registration. Please try again later.',
      });
    }
  }
);

router.post('/signin', async (req, res) => {
  try {
    const normalizedEmailAddress = String(req.body?.emailAddress || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');

    // 1. Basic input validation
    if (!normalizedEmailAddress || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email address and password are required',
      });
    }

    // 2. Find user (case-insensitive email)
    const user = await User.findOne({
      emailAddress: normalizedEmailAddress,
    }).select('+password'); // explicitly include password field

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'No account found with this email. Please sign up first.',
      });
    }

    // 3. Check authentication method
    if (user.authType === 'google') {
      return res.status(403).json({
        success: false,
        message:
          'This account was created with Google. Please use Google sign-in.',
      });
    }

    // 4. Verify password
    if (!user.password || typeof user.password !== 'string') {
      return res.status(403).json({
        success: false,
        message:
          'This account is not ready for password login. Please reset your password or contact support.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again.',
      });
    }

    // 5. Account status check
    if (user.blocked) {
      return res.status(403).json({
        success: false,
        message: 'This account has been suspended. Contact support.',
      });
    }

    await synchronizeUserRoles(user);

    const virtualAccountResult = hasUsableVirtualAccountFromUser(user)
      ? { provisioned: true, pending: false, message: '' }
      : await attemptVirtualAccountProvision(user, 'signin');

    const refreshedUser = await attachVirtualAccountToUserResponse(user._id);
    const loginUser = refreshedUser || user;

    // 6. Generate JWT token
    const token = jwt.sign(
      buildJwtPayload(loginUser),
      kukuJWT
    );

    // 7. Prepare safe user data (never send password or sensitive tokens)
    const safeUser = toSafeUserPayload(loginUser);

    if (!safeUser) {
      return res.status(500).json({
        success: false,
        message: 'Unable to complete login right now. Please try again.',
      });
    }

    // Optional: Use a dedicated method if you have it in schema
    // const safeUser = user.toProfileJSON?.() || safeUser;

    // 8. Final success response
    return res.status(200).json({
      success: true,
      message: virtualAccountResult.provisioned
        ? 'Login successful'
        : 'Login successful. Virtual account provisioning is pending.',
      user: { ...safeUser, token },
      virtualAccountProvisioned: virtualAccountResult.provisioned,
      virtualAccountProvisioningPending: virtualAccountResult.pending,
      virtualAccountProvisioningMessage: virtualAccountResult.message,
      emailVerificationRequired: isEmailVerificationRequired(safeUser),
      pinSetupRequired: !safeUser.hasTransactionPin,
    });
  } catch (error) {
    console.error('Signin Error:', error.stack || error.message);

    // Don't leak internal errors to client in production
    const isDev = process.env.NODE_ENV === 'development';

    return res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      ...(isDev && { error: error.message }),
    });
  }
});

router.post('/google-signin', async (req, res) => {
  try {
    const googleProfile = await resolveGoogleProfileFromRequest(req.body);
    const normalizedEmail = googleProfile.email;

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google account information',
      });
    }

    // 2. Find user by email
    const user = await User.findOne({ emailAddress: normalizedEmail });

    // console.log("user: ", user.authType)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email. Please sign up first.',
      });
    }

    // 3. Security: Prevent bypassing password-based accounts
    if (user.authType === 'email') {
      return res.status(403).json({
        success: false,
        message:
          'This account uses email/password login. Please use regular sign-in.',
      });
    }

    // 4. Check if profile is complete (phone number required)
    if (!user.phoneNumber) {
      const safeUser = toSafeUserPayload(user);

      return res.status(200).json({
        success: true,
        message: 'Please complete registration by adding a phone number',
        user: safeUser,
        incomplete: true,
      });
    }

    // 5. Account status check
    if (user.blocked) {
      return res.status(403).json({
        success: false,
        message: 'This account has been suspended. Contact support.',
      });
    }

    await synchronizeUserRoles(user);

    const virtualAccountResult = hasUsableVirtualAccountFromUser(user)
      ? { provisioned: true, pending: false, message: '' }
      : await attemptVirtualAccountProvision(user, 'google-signin');
    const refreshedUser = await attachVirtualAccountToUserResponse(user._id);

    // 6. Generate JWT token
    const token = jwt.sign(
      buildJwtPayload(user),
      kukuJWT
    );

    // 7. Prepare safe user data
    const safeUser = toSafeUserPayload(refreshedUser);

    // 8. Success response
    return res.status(200).json({
      success: true,
      message: virtualAccountResult.provisioned
        ? 'Google login successful'
        : 'Google login successful. Virtual account provisioning is pending.',
      user: { ...safeUser, token },
      virtualAccountProvisioned: virtualAccountResult.provisioned,
      virtualAccountProvisioningPending: virtualAccountResult.pending,
      virtualAccountProvisioningMessage: virtualAccountResult.message,
      emailVerificationRequired: isEmailVerificationRequired(safeUser),
      pinSetupRequired: !safeUser.hasTransactionPin,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.details?.reason,
      });
    }

    console.error('Google Signin Error:', err.message || err);

    const isDev = process.env.NODE_ENV === 'development';

    return res.status(500).json({
      success: false,
      message: 'An error occurred during Google login',
      ...(isDev && { error: err.message }),
    });
  }
});

router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Verification link is invalid or has expired.',
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationCode = null;
    user.emailVerificationExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Email confirmed successfully.',
      user: toSafeUserPayload(user),
    });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not verify email at the moment.',
    });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.emailAddress || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required',
      });
    }

    const user = await User.findOne({ emailAddress: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with that email address.',
      });
    }

    if (user.emailVerified) {
      return res.status(200).json({
        success: true,
        message: 'This account is already verified.',
      });
    }

    user.emailVerificationToken = generateEmailVerificationToken();
    user.emailVerificationCode = generateEmailVerificationCode();
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();
    await sendVerificationEmail(user);

    return res.status(200).json({
      success: true,
      message: withEmailFolderReminder('Verification email sent successfully.'),
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not resend verification email.',
    });
  }
});

router.post('/verify-email-code', async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.emailAddress || '')
      .trim()
      .toLowerCase();
    const verificationCode = String(req.body?.code || '')
      .replace(/\D/g, '')
      .slice(0, 6);

    if (!normalizedEmail || verificationCode.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Email address and 6-digit code are required.',
      });
    }

    const user = await User.findOne({
      emailAddress: normalizedEmail,
      emailVerificationCode: verificationCode,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is invalid or has expired.',
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationCode = null;
    user.emailVerificationExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Email confirmed successfully.',
      user: toSafeUserPayload(user),
    });
  } catch (error) {
    console.error('Verify email code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not verify email code at the moment.',
    });
  }
});

const setTransactionPinHandler = async (req, res) => {
  try {
    const pinInput = req.body?.pin ?? req.body?.transactionPin ?? '';
    const confirmPinInput =
      req.body?.confirmPin ?? req.body?.confirmTransactionPin ?? pinInput ?? '';
    const pin = String(pinInput || '').trim();
    const confirmPin = String(confirmPinInput || '').trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits.',
      });
    }

    if (pin !== confirmPin) {
      return res.status(400).json({
        success: false,
        message: 'PIN and confirm PIN do not match.',
      });
    }

    const user = await User.findById(req.user.id).select('+transactionPinHash');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const salt = await bcrypt.genSalt(12);
    user.transactionPinHash = await bcrypt.hash(pin, salt);
    user.transactionPinSetAt = new Date();
    user.lastUpdated = new Date();
    await user.save();

    const refreshedUser = await attachVirtualAccountToUserResponse(user._id);

    return res.status(200).json({
      success: true,
      message: 'Transaction PIN set successfully.',
      user: toSafeUserPayload(refreshedUser),
    });
  } catch (error) {
    console.error('Set PIN error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not set transaction PIN.',
    });
  }
};

router.post('/set-pin', authMiddleware, setTransactionPinHandler);
// Backward-compatible alias for older clients.
router.post('/setup-pin', authMiddleware, setTransactionPinHandler);

router.post('/verify-transaction-pin', authMiddleware, async (req, res) => {
  try {
    const pin = String(req.body?.pin || '').trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits.',
      });
    }

    const user = await User.findById(req.user.id).select('+transactionPinHash');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.transactionPinHash) {
      return res.status(403).json({
        success: false,
        message: 'You need to set your transaction PIN first.',
      });
    }

    const isPinValid = await bcrypt.compare(pin, user.transactionPinHash);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect transaction PIN.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Transaction PIN verified.',
    });
  } catch (error) {
    console.error('Verify transaction PIN error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not verify transaction PIN right now.',
    });
  }
});

router.post('/change-pin', authMiddleware, async (req, res) => {
  try {
    const currentPin = String(req.body?.currentPin || '').trim();
    const newPin = String(req.body?.newPin || '').trim();
    const confirmNewPin = String(req.body?.confirmNewPin || '').trim();

    if (!/^\d{4}$/.test(currentPin)) {
      return res.status(400).json({
        success: false,
        message: 'Current PIN must be exactly 4 digits.',
      });
    }

    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        message: 'New PIN must be exactly 4 digits.',
      });
    }

    if (newPin !== confirmNewPin) {
      return res.status(400).json({
        success: false,
        message: 'New PIN and confirmation do not match.',
      });
    }

    const user = await User.findById(req.user.id).select('+transactionPinHash');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.transactionPinHash) {
      return res.status(403).json({
        success: false,
        message: 'You need to set a transaction PIN first.',
      });
    }

    const isCurrentPinValid = await bcrypt.compare(
      currentPin,
      user.transactionPinHash
    );

    if (!isCurrentPinValid) {
      return res.status(401).json({
        success: false,
        message: 'Current PIN is incorrect.',
      });
    }

    const isSamePin = await bcrypt.compare(newPin, user.transactionPinHash);
    if (isSamePin) {
      return res.status(400).json({
        success: false,
        message: 'New PIN cannot be the same as your current PIN.',
      });
    }

    const salt = await bcrypt.genSalt(12);
    user.transactionPinHash = await bcrypt.hash(newPin, salt);
    user.transactionPinSetAt = new Date();
    user.pinResetToken = null;
    user.pinResetExpires = null;
    user.lastUpdated = new Date();
    await user.save();

    const refreshedUser = await attachVirtualAccountToUserResponse(user._id);

    return res.status(200).json({
      success: true,
      message: 'Transaction PIN changed successfully.',
      user: toSafeUserPayload(refreshedUser),
    });
  } catch (error) {
    console.error('Change PIN error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not change transaction PIN.',
    });
  }
});

router.post('/forgot-pin', async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.emailAddress || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required',
      });
    }

    const user = await User.findOne({ emailAddress: normalizedEmail });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: buildPinResetSentMessage(normalizedEmail),
      });
    }

    user.pinResetToken = generateHexToken(32);
    user.pinResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    try {
      await sendPinResetEmail(user);
    } catch (mailError) {
      await rollbackUserEmailFields(user, ['pinResetToken', 'pinResetExpires']);
      throw mailError;
    }

    return res.status(200).json({
      success: true,
      message: buildPinResetSentMessage(normalizedEmail),
    });
  } catch (error) {
    console.error('Forgot PIN error:', error);
    return res.status(isEmailConnectivityError(error) ? 503 : 500).json({
      success: false,
      message: buildEmailFailureMessage(
        isEmailTimeoutError(error)
          ? 'Email service timed out while sending the PIN reset link. Please try again shortly.'
          : isEmailConnectivityError(error)
          ? 'Email service could not connect while sending the PIN reset link. Please try again shortly.'
          : 'Could not send PIN reset email right now.'
      ),
    });
  }
});

router.post('/reset-pin/:token', async (req, res) => {
  let idempotencyRecordId = null;
  try {
    const { token } = req.params;
    const pin = String(req.body?.pin || '').trim();
    const confirmPin = String(req.body?.confirmPin || '').trim();
    const idempotencyState = await beginIdempotentRequest(req, 'reset-pin', {
      token,
      pin,
      confirmPin,
    });

    if (idempotencyState.replay || idempotencyState.conflict) {
      return res
        .status(idempotencyState.statusCode)
        .json(idempotencyState.responseBody);
    }

    idempotencyRecordId = idempotencyState.recordId || null;

    if (!/^\d{4}$/.test(pin)) {
      const responseBody = {
        success: false,
        message: 'PIN must be exactly 4 digits.',
      };
      await finalizeIdempotency(idempotencyRecordId, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    if (pin !== confirmPin) {
      const responseBody = {
        success: false,
        message: 'PIN and confirm PIN do not match.',
      };
      await finalizeIdempotency(idempotencyRecordId, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    const user = await User.findOne({
      pinResetToken: token,
      pinResetExpires: { $gt: new Date() },
    }).select('+transactionPinHash');

    if (!user) {
      const responseBody = {
        success: false,
        message: 'PIN reset link is invalid or has expired.',
      };
      await finalizeIdempotency(idempotencyRecordId, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    const salt = await bcrypt.genSalt(12);
    user.transactionPinHash = await bcrypt.hash(pin, salt);
    user.transactionPinSetAt = new Date();
    user.pinResetToken = null;
    user.pinResetExpires = null;
    user.lastUpdated = new Date();
    await user.save();

    const responseBody = {
      success: true,
      message: 'Transaction PIN reset successfully.',
    };
    await finalizeIdempotency(idempotencyRecordId, 200, responseBody);
    return res.status(200).json(responseBody);
  } catch (error) {
    console.error('Reset PIN error:', error);
    await releaseIdempotency(idempotencyRecordId);
    return res.status(500).json({
      success: false,
      message: 'Could not reset transaction PIN.',
    });
  }
});

router.get('/reset-pin/:token/validate', async (req, res) => {
  try {
    const token = String(req.params?.token || '').trim();

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'PIN reset token is required.',
      });
    }

    const user = await User.findOne({ pinResetToken: token }).select(
      'pinResetExpires'
    );

    if (!user || !user.pinResetExpires) {
      return res.status(400).json({
        success: false,
        message: 'PIN reset link is invalid or has expired.',
      });
    }

    if (new Date(user.pinResetExpires).getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'PIN reset link is invalid or has expired.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'PIN reset link is valid.',
      expiresAt: user.pinResetExpires,
    });
  } catch (error) {
    console.error('Validate reset PIN token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not validate the PIN reset link right now.',
    });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.emailAddress || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.',
        error: 'Email address is required.',
      });
    }

    // 1. Find User
    const user = await User.findOne({
      emailAddress: normalizedEmail,
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: buildPasswordResetSentMessage(normalizedEmail),
      });
    }

    if (user.authType === 'google') {
      // Security: Don't reveal if email exists, return success anyway
      return res.status(403).json({
        success: false,
        message:
          "This account is linked with Google Sign-In. Please use 'Continue with Google' to access your account.",
        error:
          "This account is linked with Google Sign-In. Please use 'Continue with Google' to access your account.",
      });
    }

    // 2. Generate Reset Token (Valid for 1 hour)
    const resetToken = generateHexToken(32);
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour from now
    await user.save();

    const resetUrl = `${getAuthFrontendUrl()}/open-reset/${resetToken}`;

    const mailOptions = {
      from: `"noreply" <${noreply.email}>`,
      to: user.emailAddress,
      subject: 'Password Reset Request',
      html: `
        <h1>Password Reset</h1>
          <p>You requested a password reset. Click the button below to continue securely:</p>
          <a href="${resetUrl}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
          <p style="margin-top: 16px; word-break: break-all;">Web link: ${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
      `,
    };

    // 4. Send Email
    try {
      await sendNoReplyMail(mailOptions, {
        label: 'forgotPasswordResetMail',
      });
    } catch (mailError) {
      await rollbackUserEmailFields(user, [
        'resetPasswordToken',
        'resetPasswordExpires',
      ]);
      throw mailError;
    }

    res.status(200).json({
      success: true,
      message: buildPasswordResetSentMessage(normalizedEmail),
    });
  } catch (error) {
    console.error('Mail Error:', error);
    res.status(isEmailConnectivityError(error) ? 503 : 500).json({
      success: false,
      message: buildEmailFailureMessage(
        isEmailTimeoutError(error)
          ? 'Email service timed out while sending the reset link. Please try again shortly.'
          : isEmailConnectivityError(error)
          ? 'Email service could not connect while sending the reset link. Please try again shortly.'
          : 'Failed to send email. Please try again later.'
      ),
      error: buildEmailFailureMessage(
        isEmailTimeoutError(error)
          ? 'Email service timed out while sending the reset link. Please try again shortly.'
          : isEmailConnectivityError(error)
          ? 'Email service could not connect while sending the reset link. Please try again shortly.'
          : 'Failed to send email. Please try again later.'
      ),
    });
  }
});

router.get('/reset-password/:token/validate', async (req, res) => {
  try {
    const token = String(req.params?.token || '').trim();

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is required.',
        error: 'Password reset token is required.',
      });
    }

    const user = await User.findOne({ resetPasswordToken: token }).select(
      'resetPasswordExpires'
    );

    if (!user || !user.resetPasswordExpires) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.',
        error: 'Password reset token is invalid or has expired.',
      });
    }

    if (new Date(user.resetPasswordExpires).getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Password reset token is invalid or has expired.',
        error: 'Password reset token is invalid or has expired.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset token is valid.',
      expiresAt: user.resetPasswordExpires,
    });
  } catch (error) {
    console.error('Validate reset token error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Could not validate password reset token at the moment.',
      error: 'Could not validate password reset token at the moment.',
    });
  }
});

router.post('/reset-password/:token', async (req, res) => {
  let idempotencyRecordId = null;
  try {
    const { token } = req.params;
    const { password } = req.body;
    const idempotencyState = await beginIdempotentRequest(
      req,
      'reset-password',
      {
        token,
        password,
      }
    );

    if (idempotencyState.replay || idempotencyState.conflict) {
      return res
        .status(idempotencyState.statusCode)
        .json(idempotencyState.responseBody);
    }

    idempotencyRecordId = idempotencyState.recordId || null;

    if (!password || password.length < 6) {
      const responseBody = {
        success: false,
        message: 'Password must be at least 6 characters long.',
        error: 'Password must be at least 6 characters long.',
      };
      await finalizeIdempotency(idempotencyRecordId, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    // 1. Find user with matching token and ensure token hasn't expired
    // $gt: Date.now() ensures the expiration date is in the future
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      const responseBody = {
        success: false,
        message: 'Password reset token is invalid or has expired.',
        error: 'Password reset token is invalid or has expired.',
      };
      await finalizeIdempotency(idempotencyRecordId, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    // 2. Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Update password and clear reset fields
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    const responseBody = {
      success: true,
      message:
        'Your password has been successfully updated. You can now log in.',
    };
    await finalizeIdempotency(idempotencyRecordId, 200, responseBody);
    res.status(200).json(responseBody);
  } catch (error) {
    console.error('Reset Password Error:', error.message);
    await releaseIdempotency(idempotencyRecordId);
    res.status(500).json({
      success: false,
      message: 'An internal server error occurred.',
      error: 'An internal server error occurred.',
    });
  }
});

// PUT /api/users/profile
// Update authenticated user's profile (name, phone, etc.)
router.put(
  '/update-profile',
  authMiddleware,
  [
    body('fullName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters'),

    body('emailAddress')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),

    body('phoneNumber')
      .optional()
      .trim()
      .custom((value) => !value || isValidNigerianPhoneNumber(value))
      .withMessage(
        'Please provide a valid Nigerian mobile number. You can use 080..., 803..., or 234803....'
      ),
  ],
  async (req, res) => {
    try {
      // 1. Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      // 2. Get authenticated user
      const userId = req.user.id; // from JWT middleware
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // 3. Allowed fields to update
      const allowedUpdates = ['fullName', 'phoneNumber', 'emailAddress'];
      const updates = {};

      // Only take fields that were actually sent
      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) {
          // Special handling for email - check if already taken
          if (
            field === 'emailAddress' &&
            req.body.emailAddress !== user.emailAddress
          ) {
            // You might want to add email uniqueness check here
            // For now we'll just allow it (you can add check later)
          }

          updates[field] =
            field === 'phoneNumber'
              ? normalizeNigerianPhoneNumber(req.body.phoneNumber) || null
              : req.body[field];
        }
      });

      // If nothing to update
      if (Object.keys(updates).length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No changes provided',
          user: toSafeUserPayload(user),
        });
      }

      // 4. Apply updates
      Object.assign(user, updates);

      // Optional: track last updated
      user.lastUpdated = new Date();

      // 5. Save
      await user.save();

      // 6. Send response (without sensitive fields)
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: toSafeUserPayload(user),
      });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error while updating profile',
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

// ==================== CHANGE PASSWORD ENDPOINT ====================
router.put(
  '/change-password',
  authMiddleware,
  [
    body('currentPassword')
      .trim()
      .notEmpty()
      .withMessage('Current password is required'),

    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long')
      .matches(/\d/)
      .withMessage('New password must contain at least one number')
      .matches(/[A-Z]/)
      .withMessage('New password must contain at least one uppercase letter')
      .matches(/[^A-Za-z0-9]/)
      .withMessage('New password must contain at least one special character'),

    body('confirmNewPassword')
      .trim()
      .notEmpty()
      .withMessage('Please confirm your new password'),
  ],
  async (req, res) => {
    try {
      // 1. Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { currentPassword, newPassword, confirmNewPassword } = req.body;
      const userId = req.user.id;

      // 2. Fetch user with password field
      const user = await User.findById(userId).select('+password');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // 3. Prevent Google users from changing password this way
      if (user.authType === 'google') {
        return res.status(403).json({
          success: false,
          message:
            'This account uses Google authentication. Password change is not available.',
        });
      }

      // 4. Verify current password
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
        });
      }

      // 5. Check if new password is same as current
      const isSameAsCurrent = await bcrypt.compare(newPassword, user.password);
      if (isSameAsCurrent) {
        return res.status(400).json({
          success: false,
          message: 'New password cannot be the same as your current password',
        });
      }

      // 6. Check if new password and confirm match
      if (newPassword !== confirmNewPassword) {
        return res.status(400).json({
          success: false,
          message: 'New password and confirmation do not match',
        });
      }

      // 7. Hash new password (using 12 rounds - more secure)
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      // 8. Update password
      user.password = hashedPassword;
      user.lastUpdated = new Date(); // Optional: track when password was changed

      await user.save();

      // 9. Success response (never send password back)
      res.status(200).json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      console.error('Change Password Error:', error);
      res.status(500).json({
        success: false,
        message: 'An error occurred while changing password',
        ...(process.env.NODE_ENV === 'development' && { error: error.message }),
      });
    }
  }
);

module.exports = router;
