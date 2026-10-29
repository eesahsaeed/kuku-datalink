// routes/admin.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs/promises');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const User = require('../../schema/UserSchema');
const Transaction = require('../../schema/TransactionSchema');
const AuthIdempotency = require('../../schema/AuthIdempotencySchema');
const Complain = require('../../schema/ComplainSchema');
const ContactRequest = require('../../schema/ContactRequestSchema');
const Notification = require('../../schema/NotificationSchema');
const WalletFunding = require('../../schema/walletFundingSchema');
const PaystackTransferLog = require('../../schema/PaystackTransferLogSchema');
const SupportEmailDigest = require('../../schema/SupportEmailDigestSchema');
const WebhookIdempotency = require('../../schema/WebhookIdempotencySchema');

const Plan = require('../../schema/PlanSchema');

const {
  createTransferRecipient,
  fetchPaystackBalance,
  initiateTransfer,
  finalizeTransfer,
} = require('../../services/paystackService');

const {
  aidapayAccessToken,
  networkTimeout,
  liveDataDetailsStore,
  resolveDataDetailEntry,
  replaceAllDataDetails,
  buildLiveDataDetailsSnapshot,
  mergeDataDetailsSnapshots,
} = require('../../helper');

const {
  fetchAidapayDataPlans, 
  fetchDDSDataPlans, 
  mergePlans, 
  mergePackagesByApiCode, 
  readPlanOverrides, 
  getAdminPlanCode
} = require('../../libs.js');

const {
  authMiddleware,
  adminMiddleware,
  primaryAdminMiddleware,
} = require('../../middleware');
const {
  createUserNotification,
  dispatchPushNotifications,
} = require('../../services/notificationService');
const {
  fetchDirectortechAdminCatalogPlans,
  fetchDirectortechAdminDataDetailsSnapshot,
  fetchDirectortechWalletBalance,
} = require('../../services/directortechService');
const {
  deletePlanOverrideRecord,
  fetchPersistedPlanOverridesSnapshot,
  upsertPlanOverrideRecord,
} = require('../../services/planCatalogService');
const {
  ADMIN_DASHBOARD_ROLE,
  buildManagedRoles,
  buildSignupRoles,
  getNormalizedUserRoleState,
  getPrimaryWorkspaceRole,
  isPrimaryAdminEmail,
  normalizeRoleName,
  rolesEqual,
} = require('../../utils/roles');

const LOW_BALANCE_THRESHOLD = 20000;
const MANUAL_FUND_MINIMUM = 1;
const MANUAL_FUND_RECIPIENT = {
  name: 'aidapaay isah saidu',
  accountNumber: '1962721837',
  bankCode: '044',
};
const ATLAS_FREE_TIER_MB = 512;
const generateHexToken = (byteLength = 32) => {
  const tokenSource = `${uuidv4().replace(/-/g, '')}${uuidv4()
    .replace(/-/g, '')}`;

  return tokenSource.slice(0, byteLength * 2);
};
const STORAGE_SCHEMA_DEFINITIONS = [
  { key: 'users', label: 'Users', model: User, kbPerDoc: 7.5 },
  { key: 'transactions', label: 'Transactions', model: Transaction, kbPerDoc: 4.5 },
  { key: 'notifications', label: 'Notifications', model: Notification, kbPerDoc: 2.0 },
  { key: 'complains', label: 'Complains', model: Complain, kbPerDoc: 6.5 },
  {
    key: 'contactRequests',
    label: 'Contact Requests',
    model: ContactRequest,
    kbPerDoc: 2.0,
  },
  {
    key: 'walletFundingEvents',
    label: 'Wallet Funding Events',
    model: WalletFunding,
    kbPerDoc: 3.0,
  },
  {
    key: 'paystackTransferLogs',
    label: 'Transfer Logs',
    model: PaystackTransferLog,
    kbPerDoc: 2.5,
  },
  {
    key: 'authIdempotencyKeys',
    label: 'Auth Idempotency',
    model: AuthIdempotency,
    kbPerDoc: 1.5,
  },
  {
    key: 'webhookIdempotencyKeys',
    label: 'Webhook Idempotency',
    model: WebhookIdempotency,
    kbPerDoc: 1.8,
  },
  {
    key: 'supportEmailDigests',
    label: 'Support Email Digests',
    model: SupportEmailDigest,
    kbPerDoc: 1.4,
  },
];
const ROLE_SORT_ORDER = {
  admin: 0,
  staff: 1,
  customer: 2,
};

const lagosDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const escapeRegex = (value = '') =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isPrimaryAdminAccount = (emailAddress = '') =>
  isPrimaryAdminEmail(emailAddress);

const formatRoleManagerUser = (user = {}) => {
  const normalizedRoleState = getNormalizedUserRoleState(user);

  return {
    id: String(user._id || ''),
    fullName: user.fullName || '',
    emailAddress: user.emailAddress || '',
    phoneNumber: user.phoneNumber || '',
    roles: normalizedRoleState.roles,
    canAccessAdminDashboard: normalizedRoleState.hasAdminDashboardAccess,
    createdAt: user.createdAt || null,
    lastUpdated: user.lastUpdated || null,
    blocked: Boolean(user.blocked),
    isPrimaryAdmin: isPrimaryAdminAccount(user.emailAddress),
  };
};

const normalizeBooleanInput = (value) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
};

const normalizeTransferOtp = (value = '') =>
  String(value || '')
    .replace(/\D/g, '')
    .trim();

const normalizeTransferCode = (value = '') => String(value || '').trim();

const isLikelyTransferOtpError = (error) => {
  const message = String(
    error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      ''
  )
    .toLowerCase()
    .trim();

  return (
    message.includes('otp') ||
    message.includes('one time password') ||
    message.includes('verification code')
  );
};

const notifyManagedUserOfAdminChange = async (
  req,
  user,
  {
    title = '',
    message = '',
    actionUrl = '/profile',
    priority = 'normal',
    meta = {},
  } = {}
) => {
  if (!user?._id || !user?.emailAddress || !title || !message) return;

  try {
    await createUserNotification(req, {
      userId: user._id,
      emailAddress: user.emailAddress,
      category: 'system',
      title,
      message,
      actionUrl,
      priority,
      meta,
    });
  } catch (error) {
    console.error('[admin] Failed to notify managed user:', {
      userId: String(user._id || ''),
      emailAddress: String(user.emailAddress || ''),
      title,
      message,
      error: error?.message || error,
    });
  }
};

const toAdminMoneyNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const getWalletBalanceNumber = (user = {}) => {
  const balance = user?.wallet?.balance;
  const rawValue =
    balance && typeof balance.toString === 'function'
      ? balance.toString()
      : balance;
  return toAdminMoneyNumber(rawValue, 0);
};

const ensureUserWallet = (user = {}) => {
  if (!user.wallet) {
    user.wallet = {
      balance: mongoose.Types.Decimal128.fromString('0.00'),
      currency: 'NGN',
      status: 'active',
      createdAt: new Date(),
    };
  }

  return user.wallet;
};

const saveUserWalletBalance = async (
  user,
  nextBalance,
  session,
  { direction = null } = {}
) => {
  const wallet = ensureUserWallet(user);
  const safeBalance = Math.max(0, toAdminMoneyNumber(nextBalance, 0));

  wallet.balance = mongoose.Types.Decimal128.fromString(
    safeBalance.toFixed(2)
  );

  if (direction === 'credit') {
    wallet.lastFundedAt = new Date();
  } else if (direction === 'debit') {
    wallet.lastWithdrawnAt = new Date();
  }

  user.lastUpdated = new Date();
  await user.save({ session });

  return safeBalance;
};

const adjustAdminUserWalletBalance = async (userId, amountDelta, session) => {
  const user = await User.findById(userId).session(session);
  if (!user) {
    throw new Error('User not found');
  }

  const currentBalance = getWalletBalanceNumber(user);
  const normalizedDelta = toAdminMoneyNumber(amountDelta, 0);
  const nextBalance = toAdminMoneyNumber(currentBalance + normalizedDelta, 0);

  if (nextBalance < 0) {
    throw new Error('Insufficient wallet balance for this action');
  }

  const persistedBalance = await saveUserWalletBalance(user, nextBalance, session, {
    direction: normalizedDelta > 0 ? 'credit' : normalizedDelta < 0 ? 'debit' : null,
  });

  return {
    user,
    currentBalance,
    nextBalance: persistedBalance,
    delta: normalizedDelta,
  };
};

const getTransactionMetadataObject = (transaction = {}) => {
  const metadata = transaction?.metadata;

  if (metadata && typeof metadata.toObject === 'function') {
    return metadata.toObject();
  }

  if (metadata && typeof metadata === 'object') {
    return { ...metadata };
  }

  return {};
};

const normalizeAdminTransactionAction = (value = '') => {
  const normalized = String(value || '').toLowerCase().trim();

  if (
    ['success', 'successful', 'completed', 'complete', 'delivered'].includes(
      normalized
    )
  ) {
    return 'success';
  }

  if (
    ['refund', 'refunded', 'reversed', 'reversal', 'chargeback'].includes(
      normalized
    )
  ) {
    return 'refund';
  }

  if (['failed', 'failure', 'error', 'rejected', 'declined'].includes(normalized)) {
    return 'failed';
  }

  if (['processing', 'pending'].includes(normalized)) {
    return 'processing';
  }

  return '';
};

const getAdminTransactionUserSummary = (transaction = {}) => {
  const user = transaction?.userId && typeof transaction.userId === 'object'
    ? transaction.userId
    : {};

  return {
    id: String(user?._id || transaction?.userId || '').trim(),
    fullName: String(user?.fullName || '').trim(),
    emailAddress: String(user?.emailAddress || '').trim(),
    phoneNumber: String(user?.phoneNumber || '').trim(),
  };
};

const buildAdminTransactionQuery = ({
  search = '',
  status = 'all',
  type = 'all',
  providerSource = 'all',
  userId = '',
} = {}) => {
  const query = {};
  const normalizedSearch = String(search || '').trim();
  const normalizedStatus = String(status || 'all').trim().toLowerCase();
  const normalizedType = String(type || 'all').trim().toLowerCase();
  const normalizedProviderSource = String(providerSource || 'all')
    .trim()
    .toLowerCase();
  const normalizedUserId = String(userId || '').trim();

  if (normalizedUserId && mongoose.isValidObjectId(normalizedUserId)) {
    query.userId = new mongoose.Types.ObjectId(normalizedUserId);
  }

  if (normalizedStatus && normalizedStatus !== 'all') {
    query.status = normalizedStatus;
  }

  if (normalizedType && normalizedType !== 'all') {
    query.type = normalizedType;
  }

  if (normalizedProviderSource && normalizedProviderSource !== 'all') {
    query['metadata.providerSource'] = normalizedProviderSource;
  }

  if (normalizedSearch) {
    const searchRegex = new RegExp(escapeRegex(normalizedSearch), 'i');
    query.$or = [
      { reference: searchRegex },
      { description: searchRegex },
      { recipientPhone: searchRegex },
      { recipientMeterNumber: searchRegex },
      { recipientSmartCardNumber: searchRegex },
      { provider_code: searchRegex },
      { package_code: searchRegex },
      { package_name: searchRegex },
      { 'purchasedBy.fullName': searchRegex },
      { 'purchasedBy.email': searchRegex },
      { 'fundedBy.fullName': searchRegex },
      { 'fundedBy.email': searchRegex },
      { 'metadata.providerReference': searchRegex },
      { 'metadata.providerTransactionHash': searchRegex },
      { 'metadata.providerTransactionReference': searchRegex },
      { 'metadata.providerSource': searchRegex },
    ];
  }

  return query;
};

const buildAdminTransactionSocketPayload = ({
  transaction = {},
  user = null,
  walletMovement = null,
  nextBalance = null,
  status = '',
  action = '',
  reason = '',
}) => {
  const transactionUser = getAdminTransactionUserSummary({
    ...transaction,
    userId: user || transaction.userId,
  });
  const timestamp = new Date().toISOString();
  const currentStatus = String(status || transaction.status || 'pending')
    .trim()
    .toLowerCase();
  const providerStatus = String(
    transaction?.providerResponse?.providerStatus ||
      transaction?.metadata?.providerStatus ||
      currentStatus
  )
    .trim()
    .toLowerCase();

  return {
    type: transaction.type || 'transaction',
    transactionType: transaction.type || 'transaction',
    transactionId: String(transaction._id || '').trim(),
    reference: String(transaction.reference || '').trim(),
    amount: toAdminMoneyNumber(transaction.amount, 0),
    providerAmountPaid: toAdminMoneyNumber(
      transaction?.providerResponse?.providerTransactionData?.amount_paid ??
        transaction?.providerResponse?.providerTransactionData?.amount ??
        transaction.amount,
      transaction.amount
    ),
    providerCommission: toAdminMoneyNumber(
      transaction?.providerResponse?.accounting?.providerCommission ??
        transaction?.providerResponse?.providerTransactionData?.commission ??
        transaction?.pricing?.commission ??
        0,
      0
    ),
    userId: transactionUser.id,
    recipient: String(
      transaction.recipientPhone ||
        transaction.recipientMeterNumber ||
        transaction.recipientSmartCardNumber ||
        transaction?.metadata?.recipient ||
        ''
    ).trim(),
    providerCode: String(transaction.provider_code || '').trim(),
    packageCode: String(transaction.package_code || '').trim(),
    packageName: String(transaction.package_name || '').trim(),
    status: currentStatus,
    providerStatus,
    action,
    reason,
    newBalance:
      nextBalance === null || typeof nextBalance === 'undefined'
        ? undefined
        : toAdminMoneyNumber(nextBalance, 0).toFixed(2),
    timestamp,
    pricing: transaction.pricing || {},
    description: transaction.description || '',
    providerSource: String(transaction?.metadata?.providerSource || '').trim(),
    purchaseMode: String(transaction?.metadata?.purchaseMode || '').trim(),
    customerName: transactionUser.fullName || '',
    customerEmail: transactionUser.emailAddress || '',
    walletMovement: walletMovement
      ? {
          currentBalance: toAdminMoneyNumber(walletMovement.currentBalance, 0),
          nextBalance: toAdminMoneyNumber(walletMovement.nextBalance, 0),
          delta: toAdminMoneyNumber(walletMovement.delta, 0),
        }
      : null,
  };
};

const appendAdminTransactionHistory = (
  transaction = {},
  {
    action = '',
    status = '',
    reason = '',
    actor = {},
    previousStatus = '',
    nextStatus = '',
    walletMovement = null,
  } = {}
) => {
  const metadata = getTransactionMetadataObject(transaction);
  const history = Array.isArray(metadata.adminActionHistory)
    ? metadata.adminActionHistory.slice()
    : [];
  const entry = {
    action,
    status,
    reason,
    previousStatus,
    nextStatus,
    actor: {
      id: String(actor?.id || '').trim(),
      emailAddress: String(actor?.emailAddress || '').trim(),
      fullName: String(actor?.fullName || '').trim(),
    },
    walletMovement: walletMovement
      ? {
          currentBalance: toAdminMoneyNumber(walletMovement.currentBalance, 0),
          nextBalance: toAdminMoneyNumber(walletMovement.nextBalance, 0),
          delta: toAdminMoneyNumber(walletMovement.delta, 0),
        }
      : null,
    at: new Date().toISOString(),
  };

  history.unshift(entry);
  metadata.adminLastAction = entry;
  metadata.adminActionHistory = history.slice(0, 10);
  metadata.adminActionSource = 'admin-dashboard';
  transaction.metadata = metadata;

  return entry;
};

const emitAdminTransactionRealtimeEvents = (
  req,
  transaction = {},
  {
    user = null,
    walletMovement = null,
    action = '',
    reason = '',
    nextBalance = null,
  } = {}
) => {
  try {
    const io = req?.app?.get?.('io');
    if (!io) return;

    const socketPayload = buildAdminTransactionSocketPayload({
      transaction,
      user,
      walletMovement,
      nextBalance,
      status: transaction?.status || '',
      action,
      reason,
    });

    io.to('admin-dashboard').emit('new-transaction', socketPayload);

    if (walletMovement && user?._id) {
      const walletPayload = {
        userId: String(user._id),
        event:
          walletMovement.delta >= 0
            ? 'admin_wallet_credit'
            : 'admin_wallet_debit',
        amount: Math.abs(toAdminMoneyNumber(walletMovement.delta, 0)),
        direction: walletMovement.delta >= 0 ? 'credit' : 'debit',
        source: 'admin-dashboard',
        reference: String(transaction.reference || '').trim(),
        transactionId: String(transaction._id || '').trim(),
        timestamp: socketPayload.timestamp,
        status: String(transaction.status || '').trim().toLowerCase(),
        newBalance:
          nextBalance === null || typeof nextBalance === 'undefined'
            ? undefined
            : toAdminMoneyNumber(nextBalance, 0).toFixed(2),
      };

      const rooms = [
        String(user.emailAddress || '').trim().toLowerCase(),
        `user:${String(user._id || '').trim()}`,
      ].filter(Boolean);

      for (const room of [...new Set(rooms)]) {
        io.to(room).emit('wallet:updated', walletPayload);
        io.to(room).emit('new-transaction', socketPayload);
      }

      io.to('admin-dashboard').emit('wallet-balance-update', walletPayload);
    }
  } catch (error) {
    console.error('[admin] Failed to emit admin transaction realtime events:', {
      reference: String(transaction?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
};

const buildAdminUserOverview = async (userId, { transactionLimit = 10 } = {}) => {
  const user = await User.findById(userId).lean();
  if (!user) return null;

  const [transactions, summary] = await Promise.all([
    Transaction.find({ userId: user._id })
      .populate('userId', 'fullName emailAddress phoneNumber')
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(transactionLimit) || 10, 1), 50))
      .lean(),
    Transaction.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          successCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $toLower: { $ifNull: ['$status', ''] } },
                    ['success', 'successful', 'completed'],
                  ],
                },
                1,
                0,
              ],
            },
          },
          failedCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $toLower: { $ifNull: ['$status', ''] } },
                    ['failed', 'failure', 'error'],
                  ],
                },
                1,
                0,
              ],
            },
          },
          refundCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    { $toLower: { $ifNull: ['$status', ''] } },
                    ['refund', 'refunded', 'reversed', 'reversal'],
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalAmount: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const summaryEntry = summary[0] || {};

  return {
    user: formatRoleManagerUser(user),
    wallet: {
      balance: getWalletBalanceNumber(user),
      currency: String(user?.wallet?.currency || 'NGN').toUpperCase(),
      status: String(user?.wallet?.status || 'active'),
      walletId: String(user?.wallet?.walletId || '').trim(),
      createdAt: user?.wallet?.createdAt || null,
      lastFundedAt: user?.wallet?.lastFundedAt || null,
      lastWithdrawnAt: user?.wallet?.lastWithdrawnAt || null,
      lastRefundedAt: user?.wallet?.lastRefundedAt || null,
    },
    transactions,
    summary: {
      totalTransactions: Number(summaryEntry.totalTransactions || 0),
      successCount: Number(summaryEntry.successCount || 0),
      failedCount: Number(summaryEntry.failedCount || 0),
      refundCount: Number(summaryEntry.refundCount || 0),
      totalAmount: Number(summaryEntry.totalAmount || 0),
    },
  };
};

const findAdminTransactionByIdentifier = async (identifier, session = null) => {
  const normalizedIdentifier = String(identifier || '').trim();
  if (!normalizedIdentifier) return null;

  const query = mongoose.isValidObjectId(normalizedIdentifier)
    ? {
        $or: [
          { _id: normalizedIdentifier },
          { reference: normalizedIdentifier },
        ],
      }
    : { reference: normalizedIdentifier };

  let finder = Transaction.findOne(query);
  if (session) {
    finder = finder.session(session);
  }

  return finder.populate('userId', 'fullName emailAddress phoneNumber').lean();
};

const parseProviderBalance = (value) => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  const numericValue =
    typeof value === 'string'
      ? Number(value.replace(/,/g, '').trim())
      : Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
};

const extractAidapayWalletBalance = (payload = {}) => {
  const candidates = [
    payload?.data?.balance,
    payload?.balance,
    payload?.data?.wallet_balance,
    payload?.wallet_balance,
    payload?.data?.walletBalance,
    payload?.walletBalance,
    payload?.data?.wallet?.balance,
    payload?.wallet?.balance,
    payload?.data?.account?.balance,
    payload?.account?.balance,
    payload?.data?.available_balance,
    payload?.available_balance,
    payload?.data?.availableBalance,
    payload?.availableBalance,
    payload?.data?.total_balance,
    payload?.total_balance,
    payload?.data?.totalBalance,
    payload?.totalBalance,
    payload?.data?.user?.balance,
    payload?.user?.balance,
    payload?.data?.profile?.balance,
    payload?.profile?.balance,
  ];

  for (const candidate of candidates) {
    const parsedValue = parseProviderBalance(candidate);
    if (parsedValue !== null) {
      return parsedValue;
    }
  }

  return null;
};

const fetchAidapayWalletBalance = async () => {
  const token = String(aidapayAccessToken || '').trim();

  if (!token) {
    throw new Error('Aidapay access token is not configured');
  }

  const response = await axios({
    method: 'get',
    url: 'https://aidapay.ng/api/v1/my_account',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    timeout: networkTimeout,
  });

  const payload = response?.data || {};
  const balance = extractAidapayWalletBalance(payload);

  if (balance === null) {
    throw new Error(
      payload?.message || 'Wallet balance not found in AidaPay response'
    );
  }

  return {
    balance,
    payload,
  };
};

const buildAidapayBalanceFailure = (error) => {
  const providerMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'Failed to fetch AidaPay wallet balance';
  const normalizedMessage = String(providerMessage || '').trim();
  const statusCode = Number(error?.response?.status || error?.statusCode || 0);
  const missingConfig = /not configured/i.test(normalizedMessage);
  const authFailure = statusCode === 401 || statusCode === 403;
  const malformedProviderPayload = /wallet balance not found/i.test(
    normalizedMessage
  );

  return {
    success: false,
    balance: null,
    currency: 'NGN',
    fetchedAt: new Date().toISOString(),
    configured: !missingConfig,
    providerReachable: !authFailure && !missingConfig,
    recoverable: true,
    message: missingConfig
      ? 'Aidapay balance is unavailable because AIDAPAY_ACCESS_TOKEN is not configured on the server.'
      : authFailure
      ? 'Aidapay rejected the wallet balance request. Please verify the configured access token.'
      : malformedProviderPayload
      ? 'Aidapay responded, but no wallet balance field was found in the provider payload.'
      : normalizedMessage || 'Failed to fetch AidaPay wallet balance',
    debug: {
      statusCode: statusCode || null,
    },
    fundingRecipient: {
      name: MANUAL_FUND_RECIPIENT.name,
      accountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
      bankCode: MANUAL_FUND_RECIPIENT.bankCode,
      minimumAmount: MANUAL_FUND_MINIMUM,
    },
  };
};

const buildPaystackBalancePayload = (result) => {
  if (result?.status === 'fulfilled') {
    const balance = Number.isFinite(Number(result.value?.balance))
      ? Number(Number(result.value.balance).toFixed(2))
      : null;
    const pendingBalance = Number.isFinite(Number(result.value?.pendingBalance))
      ? Number(Number(result.value.pendingBalance).toFixed(2))
      : null;

    return {
      paystackBalance: balance,
      paystackPendingBalance: pendingBalance,
      paystackCurrency: result.value?.currency || 'NGN',
      paystackBalanceMessage: '',
    };
  }

  return {
    paystackBalance: null,
    paystackPendingBalance: null,
    paystackCurrency: 'NGN',
    paystackBalanceMessage:
      result?.reason?.response?.data?.message ||
      result?.reason?.message ||
      'Unable to load Paystack balance',
  };
};

const buildDirectortechBalancePayload = (result) => {
  if (result?.status === 'fulfilled') {
    const balance = Number.isFinite(Number(result.value?.balance))
      ? Number(Number(result.value.balance).toFixed(2))
      : null;

    return {
      directortechBalance: balance,
      directortechCurrency: result.value?.currency || 'NGN',
      directortechBalanceMessage: '',
      directortechBalanceFetchedAt:
        result.value?.fetchedAt || new Date().toISOString(),
    };
  }

  return {
    directortechBalance: null,
    directortechCurrency: 'NGN',
    directortechBalanceMessage:
      result?.reason?.response?.data?.message ||
      result?.reason?.message ||
      'Unable to load Directortech balance',
    directortechBalanceFetchedAt: new Date().toISOString(),
  };
};

const getLagosDateKey = (value) => {
  const parts = lagosDateFormatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
};

const PROFIT_TRANSACTION_TYPE_FILTER = {
  $or: [
    { type: { $regex: /^data$/i } },
    { type: { $regex: /^airtime$/i } },
    { type: { $regex: /^(tv-|electricity-)/i } },
  ],
};

const PROFIT_SUCCESS_STATUS_FILTER = {
  status: { $regex: /^(success|successful|completed)$/i },
};

const PROFIT_EVENT_DATE_EXPR = {
  $ifNull: ['$completedAt', '$createdAt'],
};

const buildLagosDayKeys = (days = 7) => {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  const labels = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - safeDays + 1);

  for (let index = 0; index < safeDays; index += 1) {
    labels.push(getLagosDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return labels;
};

const toKobo = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue * 100);
};

const fromKobo = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number((numericValue / 100).toFixed(2));
};

const buildAidapayHeaders = () => ({
  Accept: 'application/json',
  Authorization: `Bearer ${aidapayAccessToken}`,
});

const extractArrayPayload = (payload = {}) => {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === 'object') {
    const keys = ['data', 'providers', 'results', 'items', 'plans', 'products'];

    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    if (payload.data && typeof payload.data === 'object') {
      for (const key of keys) {
        if (Array.isArray(payload.data[key])) {
          return payload.data[key];
        }
      }
    }
  }

  return [];
};

const normalizeProviderCode = (value = '') =>
  String(value || '').trim().toLowerCase();

const normalizePackageCode = (value = '') => String(value || '').trim();

const buildDataDetailResolutionState = (detailsMap = {}) => {
  const directMatchMap = {};
  const priorityMatchMap = {};

  Object.entries(detailsMap || {}).forEach(([packageCode, pricingMeta]) => {
    const normalizedPackageCode = normalizePackageCode(packageCode);
    if (!normalizedPackageCode) {
      return;
    }

    directMatchMap[normalizedPackageCode.toUpperCase()] = normalizedPackageCode;

    const orderedPackageCodes = normalizeReplacementCodeInput([
      normalizedPackageCode,
      ...(pricingMeta?.replacement_package_api_codes || []),
    ]);

    orderedPackageCodes.forEach((candidatePackageCode, index) => {
      const candidateKey = candidatePackageCode.toUpperCase();
      const existingResolution = priorityMatchMap[candidateKey];

      if (!existingResolution || index < existingResolution.priorityRank) {
        priorityMatchMap[candidateKey] = {
          canonicalPackageCode: normalizedPackageCode,
          priorityRank: index,
        };
      }
    });
  });

  return {
    directMatchMap,
    priorityMatchMap,
  };
};

const resolvePlanDataDetailEntry = (
  packageCode = '',
  detailsMap = liveDataDetailsStore,
  resolutionState = null
) => {
  const normalizedPackageCode = normalizePackageCode(packageCode);
  if (!normalizedPackageCode) {
    return {
      requestedPackageCode: '',
      canonicalPackageCode: '',
      pricingMeta: null,
      matchedByReplacement: false,
      priorityRank: 0,
    };
  }

  if (detailsMap === liveDataDetailsStore && typeof resolveDataDetailEntry === 'function') {
    const resolvedEntry = resolveDataDetailEntry(normalizedPackageCode);
    if (resolvedEntry?.pricingMeta) {
      return resolvedEntry;
    }
  }

  const nextResolutionState =
    resolutionState || buildDataDetailResolutionState(detailsMap);
  const normalizedLookupKey = normalizedPackageCode.toUpperCase();
  const directMatchKey =
    nextResolutionState?.directMatchMap?.[normalizedLookupKey] || '';
  const directPricingMeta = directMatchKey ? detailsMap?.[directMatchKey] || null : null;

  // In the admin pricing dashboard, an exact configured package code should
  // always resolve to its own record before any parent replacement mapping.
  if (directPricingMeta) {
    return {
      requestedPackageCode: normalizedPackageCode,
      canonicalPackageCode: directMatchKey,
      pricingMeta: directPricingMeta,
      matchedByReplacement: false,
      priorityRank: 0,
    };
  }

  const priorityResolution =
    nextResolutionState?.priorityMatchMap?.[normalizedLookupKey] || null;

  if (priorityResolution?.canonicalPackageCode) {
    const priorityPricingMeta =
      detailsMap?.[priorityResolution.canonicalPackageCode] || null;

    if (priorityPricingMeta) {
      return {
        requestedPackageCode: normalizedPackageCode,
        canonicalPackageCode: priorityResolution.canonicalPackageCode,
        pricingMeta: priorityPricingMeta,
        matchedByReplacement:
          priorityResolution.canonicalPackageCode !== normalizedPackageCode,
        priorityRank: Number(priorityResolution.priorityRank || 0),
      };
    }
  }

  return {
    requestedPackageCode: normalizedPackageCode,
    canonicalPackageCode: normalizedPackageCode,
    pricingMeta: null,
    matchedByReplacement: false,
    priorityRank: 0,
  };
};

const requestAidapayCatalog = async (pathname = '') => {
  if (!String(aidapayAccessToken || '').trim()) {
    return null;
  }

  const response = await axios.get(`https://aidapay.ng/api/v1${pathname}`, {
    headers: buildAidapayHeaders(),
    timeout: networkTimeout,
  });

  return response.data;
};

const normalizeProviderPlanRecord = (record = {}, fallbackProviderCode = '') => {
  const packageCode = normalizePackageCode(
    record?.package_api_code || record?.package_code || record?.code
  );
  if (!packageCode) {
    return null;
  }

  const packageAmount = Number(
    record?.package_amount ?? record?.amount ?? record?.price_naira ?? record?.price
  );
  if (!Number.isFinite(packageAmount) || packageAmount <= 0) {
    return null;
  }

  const providerAmountCandidate = Number(
    record?.package_original_amount ??
      record?.original_amount ??
      record?.cost_price ??
      packageAmount
  );
  const providerAmount = Number.isFinite(providerAmountCandidate)
    ? providerAmountCandidate
    : packageAmount;

  return {
    package_api_code: packageCode,
    package_name: String(record?.package_name || record?.name || packageCode).trim(),
    package_amount: Number(packageAmount.toFixed(2)),
    package_original_amount: Number(providerAmount.toFixed(2)),
    provider_code: normalizeProviderCode(
      record?.provider_code || record?.provider || fallbackProviderCode
    ),
    source: String(record?.source || 'aidapay').trim().toLowerCase(),
  };
};

const dedupeProviderPlans = (plans = []) => {
  const plansByCode = new Map();

  for (const plan of Array.isArray(plans) ? plans : []) {
    const packageCode = normalizePackageCode(plan?.package_api_code).toUpperCase();
    if (!packageCode) continue;

    const existingPlan = plansByCode.get(packageCode);
    if (!existingPlan) {
      plansByCode.set(packageCode, plan);
      continue;
    }

    const nextAmount = Number(plan?.package_amount || 0);
    const currentAmount = Number(existingPlan?.package_amount || 0);
    if (nextAmount > 0 && (currentAmount <= 0 || nextAmount < currentAmount)) {
      plansByCode.set(packageCode, plan);
    }
  }

  return [...plansByCode.values()];
};

const fetchAidapayLiveProviderPlans = async () => {
  if (!String(aidapayAccessToken || '').trim()) {
    return [];
  }

  const providerPayload = await requestAidapayCatalog('/service/data-bundle-sme');
  const providers = extractArrayPayload(providerPayload?.data)
    .map((provider) =>
      normalizeProviderCode(
        provider?.provider_code || provider?.code || provider?.provider
      )
    )
    .filter(Boolean);

  const packageResponses = await Promise.allSettled(
    providers.map(async (providerCode) => {
      const payload = await requestAidapayCatalog(
        `/packages/${encodeURIComponent(providerCode)}`
      );
      return extractArrayPayload(payload?.data)
        .map((record) => normalizeProviderPlanRecord(record, providerCode))
        .filter(Boolean);
    })
  );

  return dedupeProviderPlans(
    packageResponses.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    )
  );
};

const buildLivePlanPricingMeta = (plan = {}) => {
  const packageCode = normalizePackageCode(
    plan?.package_api_code || plan?.package_code || ''
  );

  if (!packageCode) {
    const providerAmount = Number(
      plan?.package_original_amount ?? plan?.package_amount ?? 0
    );

    return {
      package_name: String(plan?.package_name || '').trim(),
      sellingPrice: Number.isFinite(providerAmount) ? providerAmount : 0,
      originalPrice: Number.isFinite(providerAmount) ? providerAmount : 0,
      commission: 0,
      package_original_amount: Number.isFinite(providerAmount) ? providerAmount : 0,
      exclude: false,
      source: String(plan?.source || 'live').trim().toLowerCase(),
      provider_code: String(plan?.provider_code || '').trim(),
    };
  }

  const snapshot = buildLiveDataDetailsSnapshot([plan]);
  const pricingMeta = snapshot[packageCode] || null;
  if (pricingMeta) {
    return pricingMeta;
  }

  const providerAmount = Number(
    plan?.package_original_amount ?? plan?.package_amount ?? plan?.price ?? 0
  );

  return {
    package_name: String(plan?.package_name || packageCode).trim(),
    sellingPrice: Number.isFinite(providerAmount) ? providerAmount : 0,
    originalPrice: Number.isFinite(providerAmount) ? providerAmount : 0,
    commission: 0,
    package_original_amount: Number.isFinite(providerAmount) ? providerAmount : 0,
    exclude: false,
    source: String(plan?.source || 'live').trim().toLowerCase(),
    provider_code: String(plan?.provider_code || '').trim(),
  };
};

const inferNetwork = (planId = '', packageName = '', providerCode = '') => {
  const normalizedPlanId = String(planId || '').trim().toLowerCase();
  const normalizedName = String(packageName || '').trim().toLowerCase();
  const normalizedProviderCode = String(providerCode || '').trim().toLowerCase();
  const fingerprint = `${normalizedPlanId} ${normalizedName} ${normalizedProviderCode}`;

  if (fingerprint.includes('mtn')) return 'MTN';
  if (fingerprint.includes('glo')) return 'GLO';
  if (fingerprint.includes('airtel')) return 'AIRTEL';
  if (
    fingerprint.includes('9mobile') ||
    fingerprint.includes('t2mobile') ||
    fingerprint.includes('etisalat')
  ) {
    return '9MOBILE';
  }

  return 'OTHER';
};

const inferCategory = (packageName = '') => {
  const normalizedName = String(packageName || '').trim().toLowerCase();

  if (
    normalizedName.includes('daily') ||
    /\b1\s*day\b/.test(normalizedName)
  ) {
    return 'Daily';
  }

  if (
    normalizedName.includes('weekly') ||
    /\b7\s*days?\b/.test(normalizedName)
  ) {
    return 'Weekly';
  }

  if (
    normalizedName.includes('month') ||
    normalizedName.includes('monthly') ||
    /\b30\s*days?\b/.test(normalizedName)
  ) {
    return 'Monthly';
  }

  if (normalizedName.includes('year') || /\b365\s*days?\b/.test(normalizedName)) {
    return 'Yearly';
  }

  if (normalizedName.includes('night') || normalizedName.includes('overnight')) {
    return 'Night';
  }

  if (
    normalizedName.includes('social') ||
    normalizedName.includes('whatsapp') ||
    normalizedName.includes('facebook') ||
    normalizedName.includes('instagram') ||
    normalizedName.includes('youtube') ||
    normalizedName.includes('tiktok')
  ) {
    return 'Social';
  }

  const customDurationMatch = normalizedName.match(/\b(\d{1,3})\s*days?\b/);
  if (customDurationMatch) {
    const days = Number(customDurationMatch[1] || 0);
    if (days === 1) return 'Daily';
    if (days === 7) return 'Weekly';
    if (days >= 28 && days <= 31) return 'Monthly';
    if (days === 14) return 'Bi-Weekly';
    return `${days} Days`;
  }

  return 'Other';
};

const DATA_DETAIL_NETWORK_SORT_ORDER = Object.freeze({
  MTN: 0,
  GLO: 1,
  AIRTEL: 2,
  '9MOBILE': 3,
  SMILE: 4,
  OTHER: 99,
});

const normalizeDurationAmount = (amount = 0) => {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount)) {
    return '';
  }

  return Number.isInteger(numericAmount)
    ? String(numericAmount)
    : String(Number(numericAmount.toFixed(1)));
};

const extractDurationDays = (value = '') => {
  const normalizedValue = String(value || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalizedValue) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedValue.includes('daily') || /\b1\s*day\b/.test(normalizedValue)) {
    return 1;
  }

  if (normalizedValue.includes('weekly') || /\b7\s*days?\b/.test(normalizedValue)) {
    return 7;
  }

  if (normalizedValue.includes('monthly') || /\b30\s*days?\b/.test(normalizedValue)) {
    return 30;
  }

  if (normalizedValue.includes('yearly') || /\b365\s*days?\b/.test(normalizedValue)) {
    return 365;
  }

  const durationMatch = normalizedValue.match(
    /(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (!durationMatch) {
    return Number.POSITIVE_INFINITY;
  }

  const amount = Number(durationMatch[1]);
  const unit = String(durationMatch[2] || '').toLowerCase();
  const multipliers = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };

  const days = amount * (multipliers[unit.replace(/s$/, '')] || 0);
  return Number.isFinite(days) && days > 0 ? days : Number.POSITIVE_INFINITY;
};

const normalizeDurationGroupLabel = (value = '', fallbackName = '') => {
  const normalizedValue = String(value || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  const normalizedFallback = String(fallbackName || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  const candidate = normalizedValue || normalizedFallback;

  if (!candidate) {
    return 'More';
  }

  if (candidate.includes('daily') || /\b1\s*day\b/.test(candidate)) {
    return 'Daily';
  }

  if (candidate.includes('weekly') || /\b7\s*days?\b/.test(candidate)) {
    return 'Weekly';
  }

  const durationMatch = candidate.match(
    /(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = String(durationMatch[2] || '').toLowerCase();
    const unitSingular = unit.replace(/s$/, '');
    const formattedAmount = normalizeDurationAmount(amount);

    if (unitSingular === 'day') {
      return amount === 1 ? 'Daily' : `${formattedAmount} Days`;
    }

    if (unitSingular === 'week') {
      return amount === 1 ? 'Weekly' : `${formattedAmount} Weeks`;
    }

    if (unitSingular === 'month') {
      return amount === 1 ? 'Monthly' : `${formattedAmount} Months`;
    }

    if (unitSingular === 'year') {
      return amount === 1 ? 'Yearly' : `${formattedAmount} Years`;
    }
  }

  if (candidate.includes('month')) {
    return 'Monthly';
  }

  if (candidate.includes('year')) {
    return 'Yearly';
  }

  if (candidate === 'more') {
    return 'More';
  }

  return String(value || fallbackName || '').trim() || 'More';
};

const inferDurationGroup = (packageName = '') =>
  normalizeDurationGroupLabel(packageName, packageName);

const getDurationGroupSortRank = (value = '') => {
  const normalizedDurationGroup = normalizeDurationGroupLabel(value, value);
  return extractDurationDays(normalizedDurationGroup);
};

const getNetworkSortRank = (value = '') => {
  const normalizedNetwork = String(value || '').trim().toUpperCase();
  return DATA_DETAIL_NETWORK_SORT_ORDER[normalizedNetwork] ?? DATA_DETAIL_NETWORK_SORT_ORDER.OTHER;
};

const sortEditableDataDetailRecords = (records = []) =>
  [...records].sort((left, right) => {
    const leftSource = String(left?.source || 'configured').trim().toLowerCase();
    const rightSource = String(right?.source || 'configured').trim().toLowerCase();

    if (leftSource !== rightSource) {
      return leftSource.localeCompare(rightSource);
    }

    const leftNetwork = String(
      left?.network ||
        inferNetwork(left?.packageCode, left?.package_name, left?.provider_code)
    )
      .trim()
      .toUpperCase();
    const rightNetwork = String(
      right?.network ||
        inferNetwork(
          right?.packageCode,
          right?.package_name,
          right?.provider_code
        )
    )
      .trim()
      .toUpperCase();

    if (leftNetwork !== rightNetwork) {
      return getNetworkSortRank(leftNetwork) - getNetworkSortRank(rightNetwork);
    }

    const leftDuration = getDurationGroupSortRank(left?.durationGroup);
    const rightDuration = getDurationGroupSortRank(right?.durationGroup);

    if (leftDuration !== rightDuration) {
      return leftDuration - rightDuration;
    }

    return normalizeDataDetailPackageCode(left?.packageCode).localeCompare(
      normalizeDataDetailPackageCode(right?.packageCode)
    );
  });

const buildPlanInsight = ({
  planId,
  planPricing = {},
  popularityCount = 0,
  isNew = false,
  isAidapayActive = false,
  source = 'configured',
  providerCode = '',
}) => {
  const planName = String(planPricing.package_name || planId).trim();
  const commissionKobo = toKobo(planPricing.commission);
  const packageOriginalAmountKobo = toKobo(planPricing.package_original_amount);
  const sourceSellingPriceKobo = toKobo(
    planPricing.sellingPrice ?? planPricing.originalPrice
  );
  const originalPriceKobo = Math.max(sourceSellingPriceKobo - commissionKobo, 0);
  const sellingPriceKobo = originalPriceKobo + commissionKobo;
  const profitKobo = sellingPriceKobo - packageOriginalAmountKobo;
  const network = inferNetwork(planId, planName, providerCode);
  const category = inferCategory(planName);
  const durationGroup = inferDurationGroup(
    `${planName} ${String(planPricing?.duration_group || planPricing?.durationGroup || '')}`
  );
  const resolvedSellingPrice = toFiniteNumber(
    planPricing?.sellingPrice ?? planPricing?.originalPrice,
    fromKobo(sellingPriceKobo)
  );
  const resolvedProviderPrice = toFiniteNumber(
    planPricing?.package_original_amount,
    fromKobo(packageOriginalAmountKobo)
  );
  const normalizedPricingMeta = buildEditableDataDetailRecord(planId, {
    ...planPricing,
    package_name: planName,
    sellingPrice: resolvedSellingPrice,
    package_original_amount: resolvedProviderPrice,
    exclude: Boolean(planPricing?.exclude),
  });
  const pricingMeta = {
    commission: normalizedPricingMeta.commission,
    fee: normalizedPricingMeta.fee,
    gain: normalizedPricingMeta.gain,
    extra: normalizedPricingMeta.extra,
    markup: normalizedPricingMeta.markup,
    exclude: normalizedPricingMeta.exclude,
    sellingPrice: normalizedPricingMeta.sellingPrice,
    package_original_amount: normalizedPricingMeta.package_original_amount,
    package_name: normalizedPricingMeta.package_name,
    replacement_package_api_codes:
      normalizedPricingMeta.replacement_package_api_codes,
  };
  const normalizedSource = String(source || 'configured').trim().toLowerCase();
  const sourceLabel =
    normalizedSource === 'aidapay'
      ? 'Aidapay'
      : normalizedSource === 'directortech'
      ? 'Directortech'
      : normalizedSource === 'configured'
      ? 'Configured'
      : normalizedSource
      ? normalizedSource.replace(/(^|[-_\s])(\w)/g, (_, separator, letter) => {
          const prefix = separator ? ' ' : '';
          return `${prefix}${String(letter || '').toUpperCase()}`;
        }).trim()
      : 'Live';

  return {
    id: planId,
    packageCode: planId,
    name: planName,
    providerCode: normalizeProviderCode(providerCode),
    source: normalizedSource,
    sourceLabel,
    network,
    category,
    durationGroup,
    duration_group: durationGroup,
    isNew,
    isAidapayActive: Boolean(isAidapayActive && normalizedSource === 'aidapay'),
    exclude: Boolean(planPricing.exclude),
    popularity: Number(popularityCount || 0),
    commissionKobo,
    originalPriceKobo,
    sellingPriceKobo,
    packageOriginalAmountKobo,
    profitKobo,
    commission: fromKobo(commissionKobo),
    originalPrice: fromKobo(originalPriceKobo),
    sellingPrice: fromKobo(sellingPriceKobo),
    packageOriginalAmount: fromKobo(packageOriginalAmountKobo),
    profit: fromKobo(profitKobo),
    pricingMeta,
  };
};

const buildAidapayPlanCodeSet = (plans = []) =>
  new Set(
    (Array.isArray(plans) ? plans : [])
      .map((plan) => normalizePackageCode(plan?.package_api_code).toUpperCase())
      .filter(Boolean)
  );

const isPlanReturnedByAidapay = (
  planId = '',
  aidapayPlanCodeSet = new Set()
) => {
  if (!(aidapayPlanCodeSet instanceof Set) || aidapayPlanCodeSet.size === 0) {
    return false;
  }

  const normalizedPlanId = normalizePackageCode(planId).toUpperCase();
  if (!normalizedPlanId) {
    return false;
  }

  return aidapayPlanCodeSet.has(normalizedPlanId);
};

const DATA_DETAIL_NUMERIC_FIELDS = Object.freeze([
  'commission',
  'charges',
  'fee',
  'gain',
  'extra',
  'markup',
  'sellingPrice',
  'package_original_amount',
]);
const DATA_DETAIL_BOOLEAN_FIELDS = Object.freeze(['exclude']);
const DATA_DETAIL_ARRAY_FIELDS = Object.freeze(['replacement_package_api_codes']);
const DATA_DETAILS_SOURCE_START_MARKERS = Object.freeze([
  'export const liveDataDetailsStore = ',
  'const liveDataDetailsStore = exports.liveDataDetailsStore = ',
  'var liveDataDetailsStore = exports.liveDataDetailsStore = ',
  'let liveDataDetailsStore = exports.liveDataDetailsStore = ',
]);
const DATA_DETAILS_SOURCE_END_MARKERS = Object.freeze([
  '\n\nexport const dataPlans = {',
  '\n\nconst dataPlans = exports.dataPlans = {',
  '\n\nvar dataPlans = exports.dataPlans = {',
  '\n\nlet dataPlans = exports.dataPlans = {',
]);

const normalizeDataDetailPackageCode = (value = '') =>
  String(value || '').trim();

const toFiniteNumber = (value, fallbackValue = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number(fallbackValue || 0);
};

const normalizeReplacementCodeInput = (value = []) => {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]+/)
        .map((entry) => entry.trim());
  const seen = new Set();

  return rawValues.reduce((accumulator, entry) => {
    const packageCode = normalizeDataDetailPackageCode(entry);
    const normalizedKey = packageCode.toUpperCase();
    if (!packageCode || seen.has(normalizedKey)) {
      return accumulator;
    }

    seen.add(normalizedKey);
    accumulator.push(packageCode);
    return accumulator;
  }, []);
};

const buildEditableDataDetailRecord = (packageCode = '', pricingMeta = {}) => ({
  packageCode,
  package_name: String(pricingMeta?.package_name || packageCode).trim(),
  source: String(pricingMeta?.source || 'configured').trim().toLowerCase(),
  provider_code: String(pricingMeta?.provider_code || '').trim(),
  network: inferNetwork(
    packageCode,
    pricingMeta?.package_name || packageCode,
    pricingMeta?.provider_code || ''
  ),
  durationGroup: normalizeDurationGroupLabel(
    pricingMeta?.duration_group || pricingMeta?.durationGroup,
    pricingMeta?.package_name || packageCode
  ),
  duration_group: normalizeDurationGroupLabel(
    pricingMeta?.duration_group || pricingMeta?.durationGroup,
    pricingMeta?.package_name || packageCode
  ),
  commission: toFiniteNumber(pricingMeta?.commission, 0),
  charges: toFiniteNumber(pricingMeta?.charges, 0),
  fee: toFiniteNumber(pricingMeta?.fee, 0),
  gain: toFiniteNumber(pricingMeta?.gain, 0),
  extra: toFiniteNumber(pricingMeta?.extra, 0),
  markup: toFiniteNumber(pricingMeta?.markup, 0),
  isNew: Boolean(pricingMeta?.isNew),
  exclude: Boolean(pricingMeta?.exclude),
  sellingPrice: toFiniteNumber(
    pricingMeta?.sellingPrice ?? pricingMeta?.originalPrice,
    0
  ),
  package_original_amount: toFiniteNumber(
    pricingMeta?.package_original_amount,
    0
  ),
  replacement_package_api_codes: normalizeReplacementCodeInput(
    pricingMeta?.replacement_package_api_codes
  ),
});

const getRuntimeDataDetailsDraftObject = () =>
  Object.entries(liveDataDetailsStore || {}).reduce((accumulator, [packageCode, pricingMeta]) => {
    accumulator[packageCode] = {
      ...pricingMeta,
    };
    return accumulator;
  }, {});

const buildPersistableDataDetailsObject = (records = []) =>
  [...records]
    .sort((left, right) =>
      String(left?.source || 'configured')
        .trim()
        .toLowerCase()
        .localeCompare(String(right?.source || 'configured').trim().toLowerCase()) ||
      getNetworkSortRank(left?.network || inferNetwork(left?.packageCode, left?.package_name, left?.provider_code)) -
        getNetworkSortRank(
          right?.network ||
            inferNetwork(right?.packageCode, right?.package_name, right?.provider_code)
        ) ||
      getDurationGroupSortRank(left?.durationGroup) -
        getDurationGroupSortRank(right?.durationGroup) ||
      normalizeDataDetailPackageCode(left?.packageCode).localeCompare(
        normalizeDataDetailPackageCode(right?.packageCode)
      )
    )
    .reduce((accumulator, record) => {
      const packageCode = normalizeDataDetailPackageCode(record?.packageCode);
      const source = String(record?.source || 'configured').trim().toLowerCase();
      const originalPackageCode = normalizeDataDetailPackageCode(
        record?.originalPackageCode || record?.packageCode
      );
      const originalSource = String(
        record?.originalSource || record?.source || source
      )
        .trim()
        .toLowerCase();
      if (!packageCode) {
        return accumulator;
      }

    accumulator[`${source}:${packageCode}`] = {
      packageCode,
      originalPackageCode,
      originalSource,
      package_name: String(record?.package_name || packageCode).trim(),
      source,
      provider_code: String(record?.provider_code || '').trim().toLowerCase(),
      network: inferNetwork(
        packageCode,
        record?.package_name || packageCode,
        record?.provider_code || ''
      ),
      durationGroup: normalizeDurationGroupLabel(
        record?.durationGroup || record?.duration_group,
        record?.package_name || packageCode
      ),
      duration_group: normalizeDurationGroupLabel(
        record?.durationGroup || record?.duration_group,
        record?.package_name || packageCode
      ),
      commission: toFiniteNumber(record?.commission, 0),
      charges: toFiniteNumber(record?.charges, 0),
        fee: toFiniteNumber(record?.fee, 0),
        gain: toFiniteNumber(record?.gain, 0),
        extra: toFiniteNumber(record?.extra, 0),
        markup: toFiniteNumber(record?.markup, 0),
        isNew: Boolean(record?.isNew),
        exclude: Boolean(record?.exclude),
        sellingPrice: toFiniteNumber(record?.sellingPrice, 0),
        package_original_amount: toFiniteNumber(
          record?.package_original_amount,
          0
        ),
        replacement_package_api_codes: normalizeReplacementCodeInput(
          record?.replacement_package_api_codes
        ),
      };
      return accumulator;
    }, {});

const normalizeEditableDataDetailPayload = (payload = {}, currentPackageCode = '') => {
  const nextPackageCode = normalizeDataDetailPackageCode(
    payload?.packageCode || payload?.nextPackageCode || currentPackageCode
  );
  const nextSource = String(
    payload?.source || payload?.provider_source || payload?.providerSource || 'configured'
  )
    .trim()
    .toLowerCase();
  const originalPackageCode = normalizeDataDetailPackageCode(
    payload?.originalPackageCode ||
      payload?.original_package_code ||
      payload?.previousPackageCode ||
      payload?.previous_package_code ||
      currentPackageCode
  );
  const originalSource = String(
    payload?.originalSource ||
      payload?.original_source ||
      payload?.previousSource ||
      payload?.previous_source ||
      nextSource
  )
    .trim()
    .toLowerCase();

  if (!nextPackageCode) {
    const error = new Error('Package code is required');
    error.statusCode = 400;
    throw error;
  }

  return {
    ...buildEditableDataDetailRecord(nextPackageCode, {
      package_name: payload?.package_name,
      source: nextSource,
      provider_code: payload?.provider_code,
      durationGroup: payload?.durationGroup || payload?.duration_group,
      commission: payload?.commission,
      charges: payload?.charges,
      fee: payload?.fee,
      gain: payload?.gain,
      extra: payload?.extra,
      markup: payload?.markup,
      isNew: payload?.isNew,
      exclude: payload?.exclude,
      sellingPrice: payload?.sellingPrice,
      package_original_amount: payload?.package_original_amount,
      replacement_package_api_codes: payload?.replacement_package_api_codes,
    }),
    originalPackageCode,
    originalSource,
  };
};

const resolveDataDetailsSourceBlock = (fileContent = '') => {
  for (const startMarker of DATA_DETAILS_SOURCE_START_MARKERS) {
    const startIndex = fileContent.indexOf(startMarker);
    if (startIndex === -1) {
      continue;
    }

    const markerSearchStart = startIndex + startMarker.length;
    for (const endMarker of DATA_DETAILS_SOURCE_END_MARKERS) {
      const endIndex = fileContent.indexOf(endMarker, markerSearchStart);
      if (endIndex === -1) {
        continue;
      }

      return {
        startIndex,
        endIndex,
        startMarker,
      };
    }
  }

  return null;
};

const buildMergedEditableDataDetailsSnapshot = async () => {
  const [aidapayPlansResult, directortechDetailsResult, persistedOverridesResult] =
    await Promise.allSettled([
      fetchAidapayLiveProviderPlans(),
      fetchDirectortechAdminDataDetailsSnapshot(),
      fetchPersistedPlanOverridesSnapshot(),
    ]);

  const aidapayPlans =
    aidapayPlansResult.status === 'fulfilled' ? aidapayPlansResult.value : [];
  const directortechDetails =
    directortechDetailsResult.status === 'fulfilled'
      ? directortechDetailsResult.value
      : {};
  const persistedOverrides =
    persistedOverridesResult.status === 'fulfilled'
      ? persistedOverridesResult.value
      : {};

  const mergedSnapshot = mergeDataDetailsSnapshots(
    buildLiveDataDetailsSnapshot(aidapayPlans),
    directortechDetails,
    persistedOverrides
  );

  replaceAllDataDetails(mergedSnapshot);
  return mergedSnapshot;
};

const buildEditableDataDetailRecordsFromSnapshots = (
  aidapayPlans = [],
  directortechDetails = {},
  persistedOverrides = {}
) => {
  const recordMap = new Map();

  const upsertRecord = (packageCode = '', pricingMeta = {}, sourceOverride = '') => {
    const normalizedPackageCode = String(packageCode || '').trim();
    if (!normalizedPackageCode || !pricingMeta || typeof pricingMeta !== 'object') {
      return;
    }

    const source = String(
      pricingMeta?.source || sourceOverride || 'configured'
    )
      .trim()
      .toLowerCase();
    const recordKey = `${source}:${normalizedPackageCode}`.toLowerCase();
    const existingRecord = recordMap.get(recordKey) || {};

    recordMap.set(
      recordKey,
      buildEditableDataDetailRecord(normalizedPackageCode, {
        ...existingRecord,
        ...pricingMeta,
        source,
      })
    );
  };

  Object.entries(buildLiveDataDetailsSnapshot(aidapayPlans)).forEach(
    ([packageCode, pricingMeta]) => upsertRecord(packageCode, pricingMeta, 'aidapay')
  );

  Object.entries(directortechDetails || {}).forEach(([packageCode, pricingMeta]) =>
    upsertRecord(packageCode, pricingMeta, 'directortech')
  );

  Object.entries(persistedOverrides || {}).forEach(([packageCode, pricingMeta]) =>
    upsertRecord(packageCode, pricingMeta, pricingMeta?.source || 'configured')
  );

  return [...recordMap.values()];
};

const listEditableDataDetails = async () => {
  const [aidapayPlansResult, directortechDetailsResult, persistedOverridesResult] =
    await Promise.allSettled([
      fetchAidapayLiveProviderPlans(),
      fetchDirectortechAdminDataDetailsSnapshot(),
      fetchPersistedPlanOverridesSnapshot(),
    ]);

  const aidapayPlans =
    aidapayPlansResult.status === 'fulfilled' ? aidapayPlansResult.value : [];
  const directortechDetails =
    directortechDetailsResult.status === 'fulfilled'
      ? directortechDetailsResult.value
      : {};
  const persistedOverrides =
    persistedOverridesResult.status === 'fulfilled'
      ? persistedOverridesResult.value
      : {};

  await buildMergedEditableDataDetailsSnapshot();
  const editableDataRecords = buildEditableDataDetailRecordsFromSnapshots(
    aidapayPlans,
    directortechDetails,
    persistedOverrides
  );

  return sortEditableDataDetailRecords(editableDataRecords);
};

const saveEditableDataDetails = async (records = []) => {
  const nextDataDetails = buildPersistableDataDetailsObject(records);

  await Promise.all(
    Object.entries(nextDataDetails).map(([, pricingMeta]) =>
      upsertPlanOverrideRecord(
        {
          packageCode: pricingMeta?.packageCode,
          ...pricingMeta,
        },
        {
          packageCode:
            pricingMeta?.originalPackageCode || pricingMeta?.packageCode,
          originalPackageCode: pricingMeta?.originalPackageCode,
          source: pricingMeta?.originalSource || pricingMeta?.source,
          originalSource: pricingMeta?.originalSource,
          provider_code: pricingMeta?.provider_code,
        }
      )
    )
  );

  const mergedSnapshot = await buildMergedEditableDataDetailsSnapshot();
  return sortEditableDataDetailRecords(
    Object.entries(mergedSnapshot).map(([packageCode, pricingMeta]) =>
      buildEditableDataDetailRecord(packageCode, pricingMeta)
    )
  );
};

const buildDataDetailsEditorResponseData = async (records = []) => {
  const durationGroupMap = new Map();
  const networkMap = new Map();

  (Array.isArray(records) ? records : []).forEach((record) => {
    const durationLabel = normalizeDurationGroupLabel(
      record?.durationGroup || record?.duration_group,
      record?.package_name || record?.packageCode
    );
    const durationKey = String(durationLabel || '').trim().toLowerCase();

    if (durationKey) {
      durationGroupMap.set(durationKey, durationLabel);
    }

    const networkLabel = inferNetwork(
      record?.packageCode,
      record?.package_name || record?.packageCode,
      record?.provider_code || ''
    );
    const normalizedNetworkLabel = String(networkLabel || '').trim().toUpperCase();
    const networkKey = String(normalizedNetworkLabel || '').trim().toLowerCase();

    if (networkKey) {
      networkMap.set(networkKey, normalizedNetworkLabel);
    }
  });

  const durationEntries = [...durationGroupMap.entries()]
    .filter(([, label]) => String(label || '').trim())
    .sort((left, right) => {
      const leftRank = getDurationGroupSortRank(left[1]);
      const rightRank = getDurationGroupSortRank(right[1]);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return String(left[1]).localeCompare(String(right[1]), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    })
    .map(([, label]) => label);

  const hasSpecificDuration = durationEntries.some(
    (label) => String(label || '').trim().toLowerCase() !== 'more'
  );

  const availableDurationGroups = [
    'all',
    ...durationEntries.filter((label) =>
      hasSpecificDuration ? String(label || '').trim().toLowerCase() !== 'more' : true
    ),
  ];

  const networkEntries = [...networkMap.entries()]
    .filter(([, label]) => String(label || '').trim())
    .sort((left, right) => {
      const leftRank = getNetworkSortRank(left[1]);
      const rightRank = getNetworkSortRank(right[1]);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return String(left[1]).localeCompare(String(right[1]), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    })
    .map(([, label]) => label);

  return {
    records,
    schema: {
      numericFields: DATA_DETAIL_NUMERIC_FIELDS,
      booleanFields: DATA_DETAIL_BOOLEAN_FIELDS,
      arrayFields: DATA_DETAIL_ARRAY_FIELDS,
    },
    availableSources: ['all', 'aidapay', 'directortech', 'configured'],
    availableDurationGroups,
    availableNetworks: ['all', ...networkEntries],
    readOnly: false,
  };
};

router.get(
  '/plans/data-details',
  authMiddleware,
  adminMiddleware,
  async (_req, res) => {
    try {
      const records = await listEditableDataDetails();
      return res.json({
        success: true,
        data: {
          ...(await buildDataDetailsEditorResponseData(records)),
        },
      });
    } catch (error) {
      console.error('[admin/plans/data-details] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load editable data details',
      });
    }
  }
);

router.post(
  '/plans/data-details',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const records = await saveEditableDataDetails([
        normalizeEditableDataDetailPayload(req.body || {}),
      ]);
      return res.status(201).json({
        success: true,
        message: 'Plan saved successfully',
        data: {
          ...(await buildDataDetailsEditorResponseData(records)),
        },
      });
    } catch (error) {
      console.error('[admin/plans/data-details:create] Error:', error);
      return res.status(error?.statusCode || 500).json({
        success: false,
        message: error?.message || 'Failed to create plan',
      });
    }
  }
);

router.put(
  '/plans/data-details/:packageCode',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const records = await saveEditableDataDetails([
        normalizeEditableDataDetailPayload(req.body || {}, req.params.packageCode),
      ]);
      return res.status(200).json({
        success: true,
        message: 'Plan updated successfully',
        data: {
          ...(await buildDataDetailsEditorResponseData(records)),
        },
      });
    } catch (error) {
      console.error('[admin/plans/data-details:update] Error:', error);
      return res.status(error?.statusCode || 500).json({
        success: false,
        message: error?.message || 'Failed to update plan',
      });
    }
  }
);

router.delete(
  '/plans/data-details/:packageCode',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      await deletePlanOverrideRecord({
        packageCode: req.params.packageCode,
        source: req.body?.source || req.query?.source,
      });
      const records = await listEditableDataDetails();
      return res.status(200).json({
        success: true,
        message: 'Plan deleted successfully',
        data: {
          ...(await buildDataDetailsEditorResponseData(records)),
        },
      });
    } catch (error) {
      console.error('[admin/plans/data-details:delete] Error:', error);
      return res.status(error?.statusCode || 500).json({
        success: false,
        message: error?.message || 'Failed to delete plan',
      });
    }
  }
);

router.get("/plans/get-plans", authMiddleware, adminMiddleware, async (req, res) => {
  try{
    const aidapayPlans = await fetchAidapayDataPlans();
    const ddsPlans = await fetchDDSDataPlans();

    const plans = mergePlans({ aidapayPlans, ddsPlans });

    const plansOverride = await readPlanOverrides();

    const latestPlans = mergePackagesByApiCode(plans, plansOverride);

    const databasePlanCodes = new Set(
      plansOverride
        .map((plan) => getAdminPlanCode(plan).toUpperCase())
        .filter(Boolean)
    );
    const getPlanStatusRank = (plan) => {
      const planCode = getAdminPlanCode(plan).toUpperCase();

      if (!databasePlanCodes.has(planCode)) {
        return 0;
      }

      return plan?.exclude ? 2 : 1;
    };
    const sortedPlans = Object.fromEntries(
      Object.entries(latestPlans).map(([network, networkPlans]) => [
        network,
        [...(Array.isArray(networkPlans) ? networkPlans : [])].sort(
          (left, right) => {
            const statusDifference =
              getPlanStatusRank(left) - getPlanStatusRank(right);

            if (statusDifference !== 0) {
              return statusDifference;
            }

            return getAdminPlanCode(left).localeCompare(
              getAdminPlanCode(right),
              undefined,
              { numeric: true, sensitivity: 'base' }
            );
          }
        ),
      ])
    );

    return res.json({
      success: true,
      plans: sortedPlans,
    });
  } catch(err){
    console.error('[admin/plans/get-plans] Error:', err);

    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to fetch plans'
    });
  }
})

router.post("/plan/save", async (req, res) => {
  try{
    const planCode = String(
      req.body?.package_api_code || req.body?.packageCode || req.body?.id || ''
    ).trim();

    if (!planCode) {
      return res.status(400).json({
        success: false,
        message: 'Plan code is required',
      });
    }

    const planRes = await Plan.findOneAndUpdate(
      { planCode },
      {
        ...req.body,
        planCode,
        packageCode:
          req.body?.packageCode ||
          req.body?.package_api_code ||
          req.body?.package_code ||
          planCode,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

  return res.json({
    success: true,
    data: planRes,
  });
  } catch(err){
    console.error('[admin/plans/save-plan] Error:', err);

    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to save plan'
    });
  }
})

router.get(
  '/plans/insights',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const livePlans = await fetchAidapayLiveProviderPlans();
      const [directortechDetailsResult, persistedOverridesResult] =
        await Promise.allSettled([
          fetchDirectortechAdminDataDetailsSnapshot(),
          fetchPersistedPlanOverridesSnapshot(),
        ]);
      const editableDataDetails = mergeDataDetailsSnapshots(
        buildLiveDataDetailsSnapshot(livePlans),
        directortechDetailsResult.status === 'fulfilled'
          ? directortechDetailsResult.value
          : {},
        persistedOverridesResult.status === 'fulfilled'
          ? persistedOverridesResult.value
          : {}
      );
      const editableResolutionState =
        buildDataDetailResolutionState(editableDataDetails);
      const popularityRows = await Transaction.aggregate([
        {
          $match: {
            status: 'success',
            type: 'data',
            package_code: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $group: {
            _id: '$package_code',
            count: { $sum: 1 },
          },
        },
      ]);

      const popularityByCode = popularityRows.reduce((accumulator, row) => {
        const rawPackageCode = normalizePackageCode(row?._id);
        const count = Number(row?.count || 0);

        if (!rawPackageCode || count <= 0) {
          return accumulator;
        }

        const resolvedEntry = resolvePlanDataDetailEntry(
          rawPackageCode,
          editableDataDetails,
          editableResolutionState
        );
        const dedupeCode = normalizePackageCode(
          resolvedEntry?.pricingMeta && resolvedEntry?.canonicalPackageCode
            ? resolvedEntry.canonicalPackageCode
            : rawPackageCode
        ).toUpperCase();

        accumulator.set(dedupeCode, Number(accumulator.get(dedupeCode) || 0) + count);
        return accumulator;
      }, new Map());

      const livePlanResults = await Promise.allSettled([
        Promise.resolve(livePlans),
        fetchDirectortechAdminCatalogPlans(),
      ]);

      const aidapayLivePlans =
        livePlanResults[0].status === 'fulfilled' ? livePlanResults[0].value : [];
      const directortechLivePlans =
        livePlanResults[1].status === 'fulfilled' ? livePlanResults[1].value : [];
      const insightLivePlans = [
        ...aidapayLivePlans,
        ...directortechLivePlans,
      ];
      const aidapayPlanCodeSet = buildAidapayPlanCodeSet(aidapayLivePlans);

      const plansByCode = new Map(
        Object.entries(editableDataDetails || {})
          .map(([planId, planPricing]) => {
            const normalizedPlanId = normalizePackageCode(planId);
            const planKey = normalizedPlanId.toUpperCase();

            if (!normalizedPlanId) {
              return null;
            }

            return [
              planKey,
              buildPlanInsight({
                planId: normalizedPlanId,
                planPricing,
                popularityCount: popularityByCode.get(planKey) || 0,
                isAidapayActive: isPlanReturnedByAidapay(
                  normalizedPlanId,
                  aidapayPlanCodeSet
                ),
                isNew: false,
                source: 'configured',
              }),
            ];
          })
          .filter(Boolean)
      );

      insightLivePlans.forEach((plan) => {
        const packageCode = normalizePackageCode(plan?.package_api_code);
        if (!packageCode) {
          return;
        }
        const packageKey = packageCode.toUpperCase();
        const hasExactConfiguredEntry = Boolean(
          editableResolutionState?.directMatchMap?.[packageKey]
        );

        if (hasExactConfiguredEntry || plansByCode.has(packageKey)) {
          return;
        }

        plansByCode.set(
          packageKey,
          buildPlanInsight({
            planId: packageCode,
            planPricing: buildLivePlanPricingMeta(plan),
            popularityCount: popularityByCode.get(packageKey) || 0,
            isAidapayActive:
              String(plan?.source || '').trim().toLowerCase() === 'aidapay',
            isNew: true,
            source: plan?.source || 'live',
            providerCode: plan?.provider_code || '',
          })
        );
      });

      const plans = [...plansByCode.values()];

      const sellingPriceValues = plans.map((plan) => plan.sellingPriceKobo);
      const priceRange = {
        minKobo: sellingPriceValues.length ? Math.min(...sellingPriceValues) : 0,
        maxKobo: sellingPriceValues.length ? Math.max(...sellingPriceValues) : 0,
      };

      const networks = [...new Set(plans.map((plan) => plan.network))];
      const categories = [...new Set(plans.map((plan) => plan.category))];
      const durationGroups = [...new Set(plans.map((plan) => plan.durationGroup))]
        .filter(Boolean)
        .sort(
          (left, right) =>
            getDurationGroupSortRank(left) - getDurationGroupSortRank(right) ||
            String(left).localeCompare(String(right))
        );

      return res.json({
        success: true,
        data: {
          plans,
          filters: {
            networks,
            categories,
            durationGroups,
            priceRange,
          },
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[admin/plans/insights] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load plan insights',
      });
    }
  }
);

const executeManualFundTransfer = async ({
  initiatedBy,
  balanceObserved,
  amount,
  transferCode = '',
  otp = '',
}) => {
  const normalizedAmount = Number(amount || 0);
  const normalizedTransferCode = normalizeTransferCode(transferCode);
  const normalizedOtp = normalizeTransferOtp(otp);

  if (normalizedTransferCode || normalizedOtp) {
    if (!normalizedTransferCode) {
      throw new Error('Transfer code is required to finalize the Paystack OTP.');
    }

    if (normalizedOtp.length !== 6) {
      throw new Error('Enter the 6-digit Paystack OTP to finalize the transfer.');
    }

    const transferLog = await PaystackTransferLog.findOne({
      transferCode: normalizedTransferCode,
      triggerType: 'manual',
    });

    if (!transferLog) {
      throw new Error('Pending Paystack transfer not found.');
    }

    try {
      const transfer = await finalizeTransfer({
        transferCode: normalizedTransferCode,
        otp: normalizedOtp,
      });

      transferLog.status = String(transfer?.status || 'success').toLowerCase();
      transferLog.reason =
        transfer?.message || 'Manual wallet funding transfer finalized';
      transferLog.responsePayload = {
        ...(transferLog.responsePayload || {}),
        finalize: transfer,
      };
      await transferLog.save();

      return {
        reference: transferLog.reference,
        status: transferLog.status,
        transferCode: normalizedTransferCode,
        recipientCode: transferLog.recipientCode || '',
        requiresOtp: false,
        message:
          transfer?.message ||
          'Manual wallet funding transfer finalized successfully',
      };
    } catch (error) {
      const transferLog = await PaystackTransferLog.findOne({
        transferCode: normalizedTransferCode,
        triggerType: 'manual',
      });

      if (transferLog) {
        transferLog.status = isLikelyTransferOtpError(error) ? 'otp' : 'failed';
        transferLog.reason =
          error.response?.data?.message ||
          error.message ||
          'Paystack OTP finalization failed';
        transferLog.responsePayload = {
          ...(transferLog.responsePayload || {}),
          finalizeError: error.response?.data || {
            message: error.message,
          },
        };
        await transferLog.save();
      }

      throw error;
    }
  }

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Amount must be greater than NGN 0');
  }

  const reference = `manualfund-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const transferLog = await PaystackTransferLog.create({
    triggerType: 'manual',
    initiatedBy: initiatedBy?.id || null,
    recipientName: MANUAL_FUND_RECIPIENT.name,
    recipientAccountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
    recipientBankCode: MANUAL_FUND_RECIPIENT.bankCode,
    balanceObserved,
    thresholdAmount: LOW_BALANCE_THRESHOLD,
    transferAmount: normalizedAmount,
    reference,
    status: 'pending',
    reason: 'Manual admin wallet funding request',
    attemptedAt: new Date(),
  });

  try {
    const recipient = await createTransferRecipient({
      name: MANUAL_FUND_RECIPIENT.name,
      accountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
      bankCode: MANUAL_FUND_RECIPIENT.bankCode,
    });

    const transfer = await initiateTransfer({
      amount: normalizedAmount,
      recipient: recipient.recipient_code,
      reference,
      reason: 'Manual admin wallet funding',
    });

    const transferStatus = String(transfer?.status || '').trim().toLowerCase();
    const transferMessage = String(transfer?.message || '').trim();
    const requiresOtp =
      transferStatus === 'otp' || transferMessage.toLowerCase().includes('otp');

    transferLog.recipientCode = recipient.recipient_code || '';
    transferLog.transferCode = transfer?.transfer_code || '';
    transferLog.status = requiresOtp ? 'otp' : transferStatus || 'pending';
    transferLog.reason =
      transferMessage ||
      (requiresOtp
        ? 'Paystack transfer requires OTP confirmation'
        : 'Manual admin wallet funding request');
    transferLog.responsePayload = {
      recipient,
      transfer,
    };
    await transferLog.save();

    return {
      reference,
      status: transferStatus || 'pending',
      transferCode: transfer?.transfer_code || '',
      recipientCode: recipient.recipient_code || '',
      requiresOtp,
      message:
        transferMessage ||
        (requiresOtp
          ? 'Paystack OTP required to finalize this transfer.'
          : 'Manual wallet funding transfer initiated successfully'),
    };
  } catch (error) {
    transferLog.status = 'failed';
    transferLog.reason =
      error.response?.data?.message ||
      error.message ||
      'Manual transfer failed';
    transferLog.responsePayload = error.response?.data || {
      message: error.message,
    };
    await transferLog.save();
    throw error;
  }
};

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [totalTransactions, schemaCountEntries] = await Promise.all([
      Transaction.countDocuments(PROFIT_SUCCESS_STATUS_FILTER),
      Promise.all(
        STORAGE_SCHEMA_DEFINITIONS.map(async (schema) => {
          const count = await schema.model.countDocuments();
          const estimatedUsageMb = (Number(count || 0) * Number(schema.kbPerDoc || 0)) / 1024;

          return [
            schema.key,
            {
              label: schema.label,
              count: Number(count || 0),
              kbPerDoc: Number(schema.kbPerDoc || 0),
              estimatedUsageMb: Number(estimatedUsageMb.toFixed(3)),
            },
          ];
        })
      ),
    ]);
    const schemaCounts = Object.fromEntries(schemaCountEntries);
    const totalUsers = Number(schemaCounts.users?.count || 0);
    const totalTransactionsAll = Number(schemaCounts.transactions?.count || 0);
    const totalStorageRecords = Object.values(schemaCounts).reduce(
      (sum, item) => sum + Number(item?.count || 0),
      0
    );
    const estimatedStorageMb = Object.values(schemaCounts).reduce(
      (sum, item) => sum + Number(item?.estimatedUsageMb || 0),
      0
    );

    // Overall Profit
    const profitResult = await Transaction.aggregate([
      {
        $match: {
          ...PROFIT_SUCCESS_STATUS_FILTER,
          ...PROFIT_TRANSACTION_TYPE_FILTER,
        },
      },
      {
        $group: {
          _id: null,
          totalGain: { $sum: { $ifNull: ['$pricing.gain', 0] } },
          totalCommission: { $sum: { $ifNull: ['$pricing.commission', 0] } },
          totalExtra: { $sum: { $ifNull: ['$pricing.extra', 0] } },
        },
      },
    ]);

    const totalGain = profitResult[0]?.totalGain || 0;
    const totalCommission = profitResult[0]?.totalCommission || 0;
    const totalExtra = profitResult[0]?.totalExtra || 0;
    const totalProfit = totalGain + totalCommission + totalExtra;

    // Today's Profit
    const lagosTodayKey = getLagosDateKey(new Date());

    const todayProfitResult = await Transaction.aggregate([
      {
        $match: {
          ...PROFIT_SUCCESS_STATUS_FILTER,
          ...PROFIT_TRANSACTION_TYPE_FILTER,
        },
      },
      {
        $addFields: {
          profitEventDate: PROFIT_EVENT_DATE_EXPR,
        },
      },
      {
        $match: {
          $expr: {
            $eq: [
              {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$profitEventDate',
                  timezone: 'Africa/Lagos',
                },
              },
              lagosTodayKey,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          todayGain: { $sum: { $ifNull: ['$pricing.gain', 0] } },
          todayCommission: { $sum: { $ifNull: ['$pricing.commission', 0] } },
          todayExtra: { $sum: { $ifNull: ['$pricing.extra', 0] } },
        },
      },
    ]);

    const todayGain = todayProfitResult[0]?.todayGain || 0;
    const todayCommission = todayProfitResult[0]?.todayCommission || 0;
    const todayExtra = todayProfitResult[0]?.todayExtra || 0;
    const todayProfit = todayGain + todayCommission + todayExtra;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalTransactions,
        totalTransactionsAll,
        totalProfit: Number(totalProfit.toFixed(2)),
        todayProfit: Number(todayProfit.toFixed(2)),
        dbStorage: {
          atlasFreeTierMb: ATLAS_FREE_TIER_MB,
          totalRecords: totalStorageRecords,
          estimatedUsageMb: Number(estimatedStorageMb.toFixed(3)),
          schemaCounts,
        },
        breakdown: {
          totalGain: Number(totalGain.toFixed(2)),
          totalCommission: Number(totalCommission.toFixed(2)),
          totalExtra: Number(totalExtra.toFixed(2)),
          todayGain: Number(todayGain.toFixed(2)),
          todayCommission: Number(todayCommission.toFixed(2)),
          todayExtra: Number(todayExtra.toFixed(2)),
        },
      },
    });
  } catch (err) {
    console.error('[admin/stats] Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics',
    });
  }
});

// ────────────────────────────────────────────────────────────────
// GET /api/admin/transactions/recent
// ────────────────────────────────────────────────────────────────
router.get(
  '/transactions/recent',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 5), 50);
      const skip = parseInt(req.query.skip) || 0;
      const daysAgo = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);

      const dateFilter = {
        createdAt: {
          $gte: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        },
      };

      const query = {
        status: 'success',
        type: { $in: ['data', 'airtime'] },
        ...dateFilter,
      };

      const [transactions, totals] = await Promise.all([
        Transaction.find(query)
          .populate('userId', 'fullname email username phone')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),

        Transaction.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalGain: { $sum: { $ifNull: ['$pricing.gain', 0] } },
              totalCommission: {
                $sum: { $ifNull: ['$pricing.commission', 0] },
              },
              totalPackageOriginalAmount: {
                $sum: { $ifNull: ['$pricing.originalPrice', 0] },
              },
              totalTransactions: { $sum: 1 },
            },
          },
        ]),
      ]);

      const summary = totals[0] || {
        totalGain: 0,
        totalCommission: 0,
        totalPackageOriginalAmount: 0,
        totalTransactions: 0,
      };

      res.json({
        success: true,
        data: transactions,
        summary: {
          totalGain: Number(summary.totalGain.toFixed(2)),
          totalCommission: Number(summary.totalCommission.toFixed(2)),
          totalPackageOriginalAmount: Number(
            summary.totalPackageOriginalAmount.toFixed(2)
          ),
          totalTransactions: summary.totalTransactions,
          displayedCount: transactions.length,
        },
        pagination: {
          limit,
          skip,
          hasMore: transactions.length === limit,
          total: summary.totalTransactions,
        },
        meta: { days: daysAgo },
      });
    } catch (err) {
      console.error('[admin/transactions/recent] Error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to load recent transactions',
      });
    }
  }
);

// GET /api/admin/transactions
router.get('/transactions', authMiddleware, primaryAdminMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 5), 100);
    const skip = (page - 1) * limit;
    const query = buildAdminTransactionQuery({
      search: req.query.search,
      status: req.query.status,
      type: req.query.type,
      providerSource: req.query.providerSource,
      userId: req.query.userId,
    });

    const [transactions, total, statusSummary] = await Promise.all([
      Transaction.find(query)
        .populate('userId', 'fullName emailAddress phoneNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query),
      Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: { $toLower: { $ifNull: ['$status', 'pending'] } },
            count: { $sum: 1 },
            totalAmount: { $sum: { $ifNull: ['$amount', 0] } },
          },
        },
      ]),
    ]);

    const summary = {
      totalTransactions: total,
      totalAmount: transactions.reduce(
        (sum, transaction) => sum + toAdminMoneyNumber(transaction.amount, 0),
        0
      ),
      successCount: 0,
      failedCount: 0,
      refundCount: 0,
      processingCount: 0,
      pendingCount: 0,
    };

    for (const bucket of statusSummary || []) {
      const status = String(bucket?._id || '').trim().toLowerCase();
      const count = Number(bucket?.count || 0);
      if (['success', 'successful', 'completed'].includes(status)) {
        summary.successCount += count;
      } else if (['refund', 'refunded', 'reversed', 'reversal'].includes(status)) {
        summary.refundCount += count;
      } else if (['failed', 'failure', 'error'].includes(status)) {
        summary.failedCount += count;
      } else if (['processing'].includes(status)) {
        summary.processingCount += count;
      } else {
        summary.pendingCount += count;
      }
    }

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return res.json({
      success: true,
      data: transactions,
      summary: {
        ...summary,
        totalAmount: Number(summary.totalAmount.toFixed(2)),
      },
      pagination: {
        page,
        limit,
        skip,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error) {
    console.error('[admin/transactions] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load transactions',
    });
  }
});

// GET /api/admin/transactions/:transactionId
router.get(
  '/transactions/:transactionId',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const transaction = await findAdminTransactionByIdentifier(
        req.params.transactionId
      );

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        });
      }

      const userId =
        transaction?.userId?._id || transaction?.userId || transaction?.user;
      const userOverview = userId
        ? await buildAdminUserOverview(userId, { transactionLimit: 8 })
        : null;

      return res.json({
        success: true,
        data: {
          transaction,
          userOverview,
        },
      });
    } catch (error) {
      console.error('[admin/transactions/:transactionId] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load transaction details',
      });
    }
  }
);

// PATCH /api/admin/transactions/:transactionId/status
router.patch(
  '/transactions/:transactionId/status',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    const transactionId = String(req.params.transactionId || '').trim();
    const action = normalizeAdminTransactionAction(
      req.body?.status || req.body?.action
    );
    const reason = String(req.body?.reason || req.body?.note || '').trim();

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction id is required',
      });
    }

    if (!action) {
      return res.status(400).json({
        success: false,
        message:
          'Transaction status must be one of success, failed, refund, or processing',
      });
    }

    const session = await mongoose.startSession();

    try {
      let savedTransaction = null;
      let affectedUser = null;
      let walletMovement = null;
      let nextBalance = null;
      let responsePayload = null;

      await session.withTransaction(async () => {
        const transaction = await findAdminTransactionByIdentifier(
          transactionId,
          session
        );

        if (!transaction) {
          throw new Error('Transaction not found');
        }

        const doc = await Transaction.findById(transaction._id).session(session);
        if (!doc) {
          throw new Error('Transaction not found');
        }

        const user = await User.findById(doc.userId).session(session);
        if (!user) {
          throw new Error('User not found');
        }

        const metadata = getTransactionMetadataObject(doc);
        const currentStatus = String(doc.status || 'pending')
          .trim()
          .toLowerCase();
        const walletDebitAmount = toAdminMoneyNumber(
          metadata.walletDebitAmount ?? doc.amount,
          doc.amount
        );
        const walletDebitApplied = Boolean(metadata.walletDebitApplied);
        const walletDebitReversed = Boolean(metadata.walletDebitReversed);
        const nowIso = new Date().toISOString();
        const actor = {
          id: String(req.user?.id || req.user?._id || '').trim(),
          emailAddress: String(req.user?.emailAddress || '').trim(),
          fullName: String(req.user?.fullName || '').trim(),
        };
        const normalizedAction = action;
        const storedStatus = normalizedAction === 'refund' ? 'failed' : normalizedAction;

        if (normalizedAction === 'success') {
          if (walletDebitReversed) {
            walletMovement = await adjustAdminUserWalletBalance(
              doc.userId,
              -walletDebitAmount,
              session
            );
            metadata.walletDebitApplied = true;
            metadata.walletDebitReversed = false;
            metadata.walletReinstatedAt = nowIso;
            nextBalance = walletMovement.nextBalance;
          } else if (!walletDebitApplied) {
            walletMovement = await adjustAdminUserWalletBalance(
              doc.userId,
              -walletDebitAmount,
              session
            );
            metadata.walletDebitApplied = true;
            nextBalance = walletMovement.nextBalance;
          }

          doc.status = 'success';
          doc.completedAt = doc.completedAt || new Date();
          doc.failureReason = undefined;
        } else if (normalizedAction === 'refund' || normalizedAction === 'failed') {
          if (walletDebitApplied && !walletDebitReversed) {
            walletMovement = await adjustAdminUserWalletBalance(
              doc.userId,
              walletDebitAmount,
              session
            );
            metadata.walletDebitReversed = true;
            metadata.walletReversalAppliedAt = nowIso;
            nextBalance = walletMovement.nextBalance;
          }

          doc.status = 'failed';
          doc.completedAt = doc.completedAt || new Date();
          doc.failureReason =
            reason ||
            `Marked ${normalizedAction === 'refund' ? 'refunded' : 'failed'} by admin`;
        } else {
          doc.status = 'processing';
          if (reason) {
            doc.failureReason = reason;
          }
        }

        appendAdminTransactionHistory(doc, {
          action: normalizedAction,
          status: storedStatus,
          reason,
          actor,
          previousStatus: currentStatus,
          nextStatus: String(doc.status || '').trim().toLowerCase(),
          walletMovement,
        });

        doc.providerResponse = {
          ...(doc.providerResponse || {}),
          adminAction: {
            action: normalizedAction,
            status: storedStatus,
            reason,
            actor,
            at: nowIso,
          },
        };

        await doc.save({ session });

        savedTransaction = doc.toObject();
        affectedUser = user.toObject();
        responsePayload = buildAdminTransactionSocketPayload({
          transaction: savedTransaction,
          user: affectedUser,
          walletMovement,
          nextBalance,
          status: doc.status,
          action: normalizedAction,
          reason,
        });
      });

      if (!savedTransaction) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
        });
      }

      const refreshedTransaction = await Transaction.findById(
        savedTransaction._id
      )
        .populate('userId', 'fullName emailAddress phoneNumber')
        .lean();

      const userOverview = affectedUser?._id
        ? await buildAdminUserOverview(affectedUser._id, { transactionLimit: 8 })
        : null;

      emitAdminTransactionRealtimeEvents(req, refreshedTransaction, {
        user: affectedUser,
        walletMovement,
        action,
        reason,
        nextBalance,
      });

      if (affectedUser?._id && affectedUser?.emailAddress) {
        const actionTitle =
          action === 'success'
            ? 'Transaction marked successful'
            : action === 'refund'
              ? 'Transaction refunded'
              : 'Transaction status updated';
        const actionMessage =
          reason ||
          (action === 'success'
            ? `Your transaction ${refreshedTransaction.reference} was marked successful by an administrator.`
            : action === 'refund'
              ? `Your transaction ${refreshedTransaction.reference} was refunded by an administrator.`
              : `Your transaction ${refreshedTransaction.reference} was updated by an administrator.`);

        await createUserNotification(req, {
          userId: affectedUser._id,
          emailAddress: affectedUser.emailAddress,
          category: 'system',
          title: actionTitle,
          message: actionMessage,
          actionUrl: '/wallet',
          priority: action === 'success' || action === 'refund' ? 'high' : 'normal',
          meta: {
            adminAction: action,
            transactionId: String(refreshedTransaction._id || ''),
            reference: String(refreshedTransaction.reference || ''),
            reason,
          },
        });
      }

      return res.json({
        success: true,
        message:
          action === 'success'
            ? 'Transaction marked successful'
            : action === 'refund'
              ? 'Transaction refunded'
              : 'Transaction status updated',
        data: {
          transaction: refreshedTransaction,
          userOverview,
          walletMovement,
          socketPayload: responsePayload,
        },
      });
    } catch (error) {
      const message = String(error?.message || '').trim() || 'Failed to update transaction';
      console.error('[admin/transactions/:transactionId/status] Error:', error);
      return res.status(
        message === 'Transaction not found' || message === 'User not found'
          ? 404
          : 500
      ).json({
        success: false,
        message,
      });
    } finally {
      session.endSession();
    }
  }
);

// GET /api/admin/users/:userId/overview
router.get(
  '/users/:userId/overview',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User id is required',
        });
      }

      const transactionLimit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 8, 1),
        50
      );
      const overview = await buildAdminUserOverview(userId, {
        transactionLimit,
      });

      if (!overview) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      return res.json({
        success: true,
        data: overview,
      });
    } catch (error) {
      console.error('[admin/users/:userId/overview] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load user overview',
      });
    }
  }
);

// PATCH /api/admin/users/:userId/wallet
router.patch(
  '/users/:userId/wallet',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const mode = String(req.body?.mode || 'set').trim().toLowerCase();
    const reason = String(req.body?.reason || req.body?.note || '').trim();
    const balanceInput = req.body?.balance;
    const deltaInput = req.body?.delta;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User id is required',
      });
    }

    if (!['set', 'adjust'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Wallet mode must be set or adjust',
      });
    }

    const session = await mongoose.startSession();

    try {
      let createdTransaction = null;
      let affectedUser = null;
      let responsePayload = null;

      await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        if (!user) {
          throw new Error('User not found');
        }

        const currentBalance = getWalletBalanceNumber(user);
        let nextBalance = currentBalance;
        let delta = 0;

        if (mode === 'set') {
          nextBalance = toAdminMoneyNumber(balanceInput, NaN);
          if (!Number.isFinite(nextBalance)) {
            throw new Error('A valid wallet balance is required');
          }
          delta = toAdminMoneyNumber(nextBalance - currentBalance, 0);
        } else {
          delta = toAdminMoneyNumber(deltaInput, NaN);
          if (!Number.isFinite(delta)) {
            throw new Error('A valid wallet adjustment is required');
          }
          nextBalance = toAdminMoneyNumber(currentBalance + delta, 0);
        }

        if (nextBalance < 0) {
          throw new Error('Wallet balance cannot be negative');
        }

        if (Math.abs(delta) < 0.005) {
          responsePayload = {
            user: formatRoleManagerUser(user),
            wallet: {
              balance: currentBalance,
              currency: String(user?.wallet?.currency || 'NGN').toUpperCase(),
              status: String(user?.wallet?.status || 'active'),
              walletId: String(user?.wallet?.walletId || '').trim(),
            },
            transaction: null,
          };
          affectedUser = user.toObject();
          return;
        }

        const persistedBalance = await saveUserWalletBalance(user, nextBalance, session, {
          direction: delta >= 0 ? 'credit' : 'debit',
        });

        const adjustmentAmount = Math.abs(delta);
        const reference = `ADM-WAL-${Date.now()}-${generateHexToken(3).toUpperCase()}`;
        const actor = {
          id: String(req.user?.id || req.user?._id || '').trim(),
          emailAddress: String(req.user?.emailAddress || '').trim(),
          fullName: String(req.user?.fullName || '').trim(),
        };
        const adjustmentDescription =
          mode === 'set'
            ? `Admin wallet balance set from NGN ${currentBalance.toFixed(2)} to NGN ${persistedBalance.toFixed(2)}`
            : `Admin wallet balance adjusted by NGN ${adjustmentAmount.toFixed(2)}`;

        const [createdDoc] = await Transaction.create(
          [
            {
              userId: user._id,
              type: 'wallet-adjustment',
              status: 'success',
              amount: adjustmentAmount,
              reference,
              description: adjustmentDescription,
              purchasedBy: {
                fullName: actor.fullName || 'Admin',
                email: actor.emailAddress || '',
                phone: '',
              },
              pricing: {
                originalPrice: adjustmentAmount,
                gain: 0,
                commission: 0,
                fee: 0,
                package_original_amount: adjustmentAmount,
              },
              providerResponse: {
                adminAction: {
                  mode,
                  delta,
                  previousBalance: currentBalance,
                  nextBalance: persistedBalance,
                  note: reason,
                  actor,
                },
              },
              metadata: {
                adminAction: 'wallet-adjustment',
                mode,
                delta,
                previousBalance: currentBalance,
                nextBalance: persistedBalance,
                note: reason,
                actor,
              },
              completedAt: new Date(),
            },
          ],
          { session }
        );

        createdTransaction = createdDoc.toObject();
        affectedUser = user.toObject();
        responsePayload = {
          user: formatRoleManagerUser(user),
          wallet: {
            balance: persistedBalance,
            currency: String(user?.wallet?.currency || 'NGN').toUpperCase(),
            status: String(user?.wallet?.status || 'active'),
            walletId: String(user?.wallet?.walletId || '').trim(),
            createdAt: user?.wallet?.createdAt || null,
            lastFundedAt: user?.wallet?.lastFundedAt || null,
            lastWithdrawnAt: user?.wallet?.lastWithdrawnAt || null,
          },
          transaction: createdTransaction,
          delta,
        };
      });

      if (!affectedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const refreshedOverview = await buildAdminUserOverview(userId, {
        transactionLimit: 8,
      });

      if (createdTransaction) {
        emitAdminTransactionRealtimeEvents(req, createdTransaction, {
          user: affectedUser,
          walletMovement: {
            currentBalance: createdTransaction?.metadata?.previousBalance,
            nextBalance: createdTransaction?.metadata?.nextBalance,
            delta: createdTransaction?.metadata?.delta,
          },
          action: 'wallet-adjustment',
          reason,
          nextBalance: createdTransaction?.metadata?.nextBalance,
        });
      }

      if (affectedUser?.emailAddress) {
        await createUserNotification(req, {
          userId: affectedUser._id || userId,
          emailAddress: affectedUser.emailAddress,
          category: 'system',
          title: 'Wallet balance updated',
          message:
            reason ||
            'Your wallet balance was updated by an administrator.',
          actionUrl: '/wallet',
          priority: 'high',
          meta: {
            adminAction: 'wallet-adjustment',
            mode,
            delta: responsePayload?.delta ?? 0,
          },
        });
      }

      return res.json({
        success: true,
        message: 'Wallet updated successfully',
        data: {
          ...responsePayload,
          overview: refreshedOverview,
        },
      });
    } catch (error) {
      const message = String(error?.message || '').trim() || 'Failed to update wallet';
      console.error('[admin/users/:userId/wallet] Error:', error);
      return res.status(
        message === 'User not found' ? 404 : 500
      ).json({
        success: false,
        message,
      });
    } finally {
      session.endSession();
    }
  }
);

// POST /api/admin/users/:userId/message
router.post(
  '/users/:userId/message',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const title = String(req.body?.title || '').trim();
      const message = String(req.body?.message || '').trim();
      const actionUrl = String(req.body?.actionUrl || '/notifications').trim();
      const priority = String(req.body?.priority || 'normal').trim();
      const category = String(req.body?.category || 'system').trim();

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User id is required',
        });
      }

      if (!title || !message) {
        return res.status(400).json({
          success: false,
          message: 'Both title and message are required',
        });
      }

      const user = await User.findById(userId)
        .select('_id emailAddress fullName mobilePushTokens')
        .lean();

      if (!user?._id) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const notification = await createUserNotification(req, {
        userId: user._id,
        emailAddress: user.emailAddress,
        category,
        title,
        message,
        actionUrl,
        priority,
        meta: {
          adminAction: 'admin-message',
          sender: {
            id: String(req.user?.id || req.user?._id || '').trim(),
            emailAddress: String(req.user?.emailAddress || '').trim(),
            fullName: String(req.user?.fullName || '').trim(),
          },
        },
      });

      return res.json({
        success: true,
        message: 'Message sent successfully',
        data: {
          notificationId: String(notification?._id || ''),
        },
      });
    } catch (error) {
      console.error('[admin/users/:userId/message] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send message',
      });
    }
  }
);

// GET /api/admin/profit/daily
router.get(
  '/profit/daily',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
      const lagosDayKeys = buildLagosDayKeys(days);
      const startDateKey = lagosDayKeys[0] || '';
      const endDateKey = lagosDayKeys[lagosDayKeys.length - 1] || '';
      const rollingWindowStart = new Date(
        Date.now() - (Math.max(days, 2) + 2) * 24 * 60 * 60 * 1000
      );

      const result = await Transaction.aggregate([
        {
          $match: {
            ...PROFIT_SUCCESS_STATUS_FILTER,
            ...PROFIT_TRANSACTION_TYPE_FILTER,
            $or: [
              { completedAt: { $gte: rollingWindowStart } },
              { createdAt: { $gte: rollingWindowStart } },
            ],
          },
        },
        {
          $addFields: {
            profitEventDate: PROFIT_EVENT_DATE_EXPR,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$profitEventDate',
                timezone: 'Africa/Lagos',
              },
            },
            dailyGain: { $sum: { $ifNull: ['$pricing.gain', 0] } },
            dailyCommission: { $sum: { $ifNull: ['$pricing.commission', 0] } },
            dailyFee: { $sum: { $ifNull: ['$pricing.fee', 0] } },
            dailyExtra: { $sum: { $ifNull: ['$pricing.extra', 0] } },
          },
        },
        {
          $match: {
            _id: { $in: lagosDayKeys },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const labels = [];
      const profits = [];
      const gains = [];
      const fees = [];
      const extras = [];
      const commissions = [];
      const resultByDate = new Map(result.map((entry) => [entry._id, entry]));

      if (days === 1) {
        const todayKey = lagosDayKeys[0];
        const todayEntry = resultByDate.get(todayKey);
        const todayGain = Number(todayEntry?.dailyGain || 0);
        const todayExtra = Number(todayEntry?.dailyExtra || 0);
        const todayCommission = Number(todayEntry?.dailyCommission || 0);
        const todayFee = Number(todayEntry?.dailyFee || 0);
        const todayProfit =
          Number(todayGain || 0) +
          Number(todayCommission || 0) +
          Number(todayExtra || 0);

        labels.push('Today');
        profits.push(Number(todayProfit.toFixed(2)));
        gains.push(Number(todayGain.toFixed(2)));
        fees.push(Number(todayFee.toFixed(2)));
        extras.push(Number(todayExtra.toFixed(2)));
        commissions.push(Number(todayCommission.toFixed(2)));
      } else {
        for (const dateStr of lagosDayKeys) {
          labels.push(dateStr);
          const found = resultByDate.get(dateStr);
          const dailyGain = Number(found?.dailyGain || 0);
          const dailyExtra = Number(found?.dailyExtra || 0);
          const dailyCommission = Number(found?.dailyCommission || 0);
          const dailyFee = Number(found?.dailyFee || 0);
          const dailyProfit = found
            ? Number(dailyGain || 0) +
              Number(dailyCommission || 0) +
              Number(dailyExtra || 0)
            : 0;

          profits.push(Number(dailyProfit.toFixed(2)));
          gains.push(Number(dailyGain.toFixed(2)));
          fees.push(Number(dailyFee.toFixed(2)));
          extras.push(Number(dailyExtra.toFixed(2)));
          commissions.push(Number(dailyCommission.toFixed(2)));
        }
      }

      const totalInPeriod = profits.reduce((sum, val) => sum + val, 0);
      const totalGainInPeriod = gains.reduce((sum, val) => sum + val, 0);
      const totalFeeInPeriod = fees.reduce((sum, val) => sum + val, 0);
      const totalExtraInPeriod = extras.reduce((sum, val) => sum + val, 0);
      const totalCommissionInPeriod = commissions.reduce((sum, val) => sum + val, 0);

      res.json({
        success: true,
        data: {
          labels,
          profits,
          gains,
          fees,
          extras,
          commissions,
          totalInPeriod: Number(totalInPeriod.toFixed(2)),
          totalGainInPeriod: Number(totalGainInPeriod.toFixed(2)),
          totalFeeInPeriod: Number(totalFeeInPeriod.toFixed(2)),
          totalExtraInPeriod: Number(totalExtraInPeriod.toFixed(2)),
          totalCommissionInPeriod: Number(totalCommissionInPeriod.toFixed(2)),
          days,
          startDate: startDateKey,
          endDate: endDateKey,
        },
      });
    } catch (err) {
      console.error('[admin/profit/daily] Error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to load daily profit breakdown',
      });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// GET /api/admin/packages/top-profit
// ────────────────────────────────────────────────────────────────
router.get(
  '/packages/top-profit',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      // Fixed to always return top 5
      const limit = 5;

      const packages = await Transaction.aggregate([
        {
          $match: {
            status: 'success',
            type: 'data',
          },
        },
        {
          $group: {
            _id: '$package_code',
            packageName: { $first: '$package_name' },
            totalProfit: { $sum: { $ifNull: ['$pricing.gain', 0] } },
            totalPurchaseAmount: { $sum: { $ifNull: ['$amount', 0] } },
            transactionCount: { $sum: 1 },
            // Sums gain and commission before calculating the average
            averageProfit: {
              $avg: {
                $add: [
                  { $ifNull: ['$pricing.gain', 0] },
                  { $ifNull: ['$pricing.commission', 0] },
                ],
              },
            },
          },
        },
        {
          $sort: { transactionCount: -1 },
        },
        { $limit: limit },
      ]);

      const result = packages.map((p) => ({
        packageCode: p._id || 'UNKNOWN',
        packageName: p.packageName || 'Unknown Package',
        totalProfit: Number((p.totalProfit || 0).toFixed(2)),
        totalPurchaseAmount: Number((p.totalPurchaseAmount || 0).toFixed(2)),
        transactionCount: p.transactionCount || 0,
        averageProfit: Number((p.avgProfit || 0).toFixed(2)),
      }));

      res.json({
        success: true,
        data: result, // Always returns array of max 5 objects
      });
    } catch (err) {
      console.error('[admin/packages/top-profit] Error:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to load top 5 purchased packages',
      });
    }
  }
);

// ────────────────────────────────────────────────────────────────
// GET /api/admin/wallet/balance  (AidaPay, Paystack, Directortech)
// ────────────────────────────────────────────────────────────────
router.get(
  '/wallet/balance',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const [aidapayResult, paystackResult, directortechResult] =
        await Promise.allSettled([
          fetchAidapayWalletBalance(),
          fetchPaystackBalance('NGN'),
          fetchDirectortechWalletBalance(),
        ]);
      const paystackPayload = buildPaystackBalancePayload(paystackResult);
      const directortechPayload = buildDirectortechBalancePayload(
        directortechResult
      );

      if (aidapayResult.status !== 'fulfilled') {
        return res.json({
          ...buildAidapayBalanceFailure(aidapayResult.reason),
          ...paystackPayload,
          ...directortechPayload,
          fundingRecipient: {
            name: MANUAL_FUND_RECIPIENT.name,
            accountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
            bankCode: MANUAL_FUND_RECIPIENT.bankCode,
            minimumAmount: MANUAL_FUND_MINIMUM,
          },
        });
      }

      const aidapayBalance = Number(aidapayResult.value.balance.toFixed(2));

      res.json({
        success: true,
        balance: aidapayBalance,
        aidapayBalance,
        currency: 'NGN',
        fetchedAt: new Date().toISOString(),
        configured: true,
        providerReachable: true,
        recoverable: true,
        message: '',
        ...paystackPayload,
        ...directortechPayload,
        fundingRecipient: {
          name: MANUAL_FUND_RECIPIENT.name,
          accountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
          bankCode: MANUAL_FUND_RECIPIENT.bankCode,
          minimumAmount: MANUAL_FUND_MINIMUM,
        },
      });
    } catch (err) {
      console.error(
        '[admin/wallet/balance] Error:',
        err.response?.data || err.message
      );
      return res.json({
        ...buildAidapayBalanceFailure(err),
        ...buildPaystackBalancePayload({ status: 'rejected', reason: err }),
        ...buildDirectortechBalancePayload({
          status: 'rejected',
          reason: err,
        }),
      });
    }
  }
);

router.post(
  '/wallet/fund-manual',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const amount = Number(req.body?.amount || 0);
      const balanceObserved = Number(req.body?.balanceObserved || 0);

      const result = await executeManualFundTransfer({
        initiatedBy: req.user,
        balanceObserved,
        amount,
      });

      return res.json({
        success: true,
        message: 'Manual wallet funding transfer initiated successfully',
        data: {
          ...result,
          amount,
          recipientName: MANUAL_FUND_RECIPIENT.name,
          recipientAccountNumber: MANUAL_FUND_RECIPIENT.accountNumber,
          recipientBankCode: MANUAL_FUND_RECIPIENT.bankCode,
        },
      });
    } catch (error) {
      console.error(
        '[admin/wallet/fund-manual] Error:',
        error.response?.data || error.message
      );
      return res.status(500).json({
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          'Failed to initiate manual wallet funding transfer',
      });
    }
  }
);

router.get(
  '/users/roles',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const search = String(req.query.search || '').trim();
      const requestedRole = normalizeRoleName(req.query.role || 'all');
      const roleFilter = [
        'customer',
        'staff',
        'admin',
        ADMIN_DASHBOARD_ROLE,
      ].includes(requestedRole)
        ? requestedRole
        : '';
      const requestedStatus = String(req.query.status || 'all')
        .toLowerCase()
        .trim();
      const statusFilter = ['active', 'blocked'].includes(requestedStatus)
        ? requestedStatus
        : '';
      const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 40, 10),
        150
      );

      const query = {};

      if (roleFilter === ADMIN_DASHBOARD_ROLE) {
        query.$or = [
          { roles: 'admin' },
          { adminDashboardAccess: true },
        ];
      } else if (roleFilter) {
        query.roles = roleFilter;
      }

      if (statusFilter === 'blocked') {
        query.blocked = true;
      } else if (statusFilter === 'active') {
        query.blocked = { $ne: true };
      }

      if (search) {
        const safePattern = escapeRegex(search);
        const searchConditions = [
          { fullName: { $regex: safePattern, $options: 'i' } },
          { emailAddress: { $regex: safePattern, $options: 'i' } },
          { phoneNumber: { $regex: safePattern, $options: 'i' } },
        ];
        if (query.$or) {
          query.$and = [{ $or: query.$or }, { $or: searchConditions }];
          delete query.$or;
        } else {
          query.$or = searchConditions;
        }
      }

      const [
        users,
        customerCount,
        staffCount,
        adminCount,
        dashboardAccessCount,
        activeCount,
        blockedCount,
      ] = await Promise.all([
        User.find(query)
          .select(
            'fullName emailAddress phoneNumber roles adminDashboardAccess createdAt lastUpdated blocked'
          )
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean(),
        User.countDocuments({ roles: 'customer' }),
        User.countDocuments({ roles: 'staff' }),
        User.countDocuments({ roles: 'admin' }),
        User.countDocuments({
          $or: [{ roles: 'admin' }, { adminDashboardAccess: true }],
        }),
        User.countDocuments({ blocked: { $ne: true } }),
        User.countDocuments({ blocked: true }),
      ]);

      const sortedUsers = users
        .map(formatRoleManagerUser)
        .sort((left, right) => {
          const leftOrder = ROLE_SORT_ORDER[getPrimaryWorkspaceRole(left)] ?? 99;
          const rightOrder = ROLE_SORT_ORDER[getPrimaryWorkspaceRole(right)] ?? 99;

          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }

          if (
            Boolean(left?.canAccessAdminDashboard) !==
            Boolean(right?.canAccessAdminDashboard)
          ) {
            return Number(right?.canAccessAdminDashboard) -
              Number(left?.canAccessAdminDashboard);
          }

          return new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0);
        });

      return res.json({
        success: true,
        data: {
          users: sortedUsers,
          counts: {
            customer: Number(customerCount || 0),
            staff: Number(staffCount || 0),
            admin: Number(adminCount || 0),
            dashboardAccess: Number(dashboardAccessCount || 0),
            active: Number(activeCount || 0),
            blocked: Number(blockedCount || 0),
          },
          query: {
            search,
            role: roleFilter || 'all',
            status: statusFilter || 'all',
            limit,
          },
        },
      });
    } catch (error) {
      console.error('[admin/users/roles] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load users for role management',
      });
    }
  }
);

router.patch(
  '/users/:userId/status',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const requestedBlockedState = normalizeBooleanInput(req.body?.blocked);

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User id is required',
        });
      }

      if (requestedBlockedState === null) {
        return res.status(400).json({
          success: false,
          message: 'Blocked status must be true or false',
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const normalizedEmailAddress = String(user.emailAddress || '')
        .toLowerCase()
        .trim();
      const normalizedRequesterEmail = String(req.user?.emailAddress || '')
        .toLowerCase()
        .trim();

      if (isPrimaryAdminAccount(normalizedEmailAddress) && requestedBlockedState) {
        return res.status(400).json({
          success: false,
          message: 'The primary admin account cannot be blocked',
        });
      }

      if (
        normalizedEmailAddress &&
        normalizedEmailAddress === normalizedRequesterEmail &&
        requestedBlockedState
      ) {
        return res.status(400).json({
          success: false,
          message: 'You cannot block your own active admin session',
        });
      }

      if (Boolean(user.blocked) === requestedBlockedState) {
        return res.json({
          success: true,
          message: requestedBlockedState
            ? 'User is already blocked'
            : 'User is already active',
          data: {
            user: formatRoleManagerUser(user),
          },
        });
      }

      user.blocked = requestedBlockedState;
      user.lastUpdated = new Date();
      await user.save();

      await notifyManagedUserOfAdminChange(req, user, {
        title: requestedBlockedState
          ? 'Account access disabled'
          : 'Account access restored',
        message: requestedBlockedState
          ? 'Your account has been temporarily blocked by an administrator. Contact support if you need help.'
          : 'Your account has been reactivated. You can sign in again.',
        actionUrl: '/signin',
        priority: requestedBlockedState ? 'high' : 'normal',
        meta: {
          adminAction: 'account-status-update',
          blocked: requestedBlockedState,
        },
      });

      return res.json({
        success: true,
        message: requestedBlockedState
          ? `${user.emailAddress} has been blocked`
          : `${user.emailAddress} has been reactivated`,
        data: {
          user: formatRoleManagerUser(user),
        },
      });
    } catch (error) {
      console.error('[admin/users/:userId/status] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user status',
      });
    }
  }
);

router.patch(
  '/users/:userId/role',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const requestedRole = normalizeRoleName(req.body?.role || '');
      const requestedAdminDashboardAccess = normalizeBooleanInput(
        req.body?.adminDashboardAccess
      );

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User id is required',
        });
      }

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const currentRoleState = getNormalizedUserRoleState(user);
      const nextWorkspaceRole = ['customer', 'staff', 'admin'].includes(
        requestedRole
      )
        ? requestedRole
        : currentRoleState.primaryRole;
      const nextAdminDashboardAccess =
        requestedAdminDashboardAccess === null
          ? currentRoleState.hasAdminDashboardAccess
          : requestedAdminDashboardAccess;

      if (isPrimaryAdminAccount(user.emailAddress)) {
        if (
          nextWorkspaceRole !== 'admin' ||
          nextAdminDashboardAccess !== true
        ) {
          return res.status(400).json({
            success: false,
            message:
              'The primary admin account must retain admin and admin dashboard access',
          });
        }
      } else {
        const canRetainLegacyAdminRole =
          currentRoleState.primaryRole === 'admin' &&
          nextWorkspaceRole === 'admin';

        if (
          !['customer', 'staff'].includes(nextWorkspaceRole) &&
          !canRetainLegacyAdminRole
        ) {
          return res.status(400).json({
            success: false,
            message: 'Only customer and staff workspace roles can be assigned here',
          });
        }
      }

      const nextRoles = isPrimaryAdminAccount(user.emailAddress)
        ? buildSignupRoles(user.emailAddress)
        : buildManagedRoles({
            workspaceRole: nextWorkspaceRole,
            emailAddress: user.emailAddress,
          });

      if (
        rolesEqual(user.roles, nextRoles) &&
        Boolean(user.adminDashboardAccess) === Boolean(nextAdminDashboardAccess)
      ) {
        return res.json({
          success: true,
          message: 'User access is already up to date',
          data: {
            user: formatRoleManagerUser(user),
          },
        });
      }

      user.roles = nextRoles;
      user.adminDashboardAccess = Boolean(nextAdminDashboardAccess);
      user.lastUpdated = new Date();
      await user.save();

      const refreshedRoleState = getNormalizedUserRoleState(user);
      await notifyManagedUserOfAdminChange(req, user, {
        title: 'Account access updated',
        message: `Your workspace access is now ${refreshedRoleState.primaryRole}${
          refreshedRoleState.hasAdminDashboardAccess
            ? ' with admin dashboard access.'
            : '.'
        }`,
        actionUrl: '/profile',
        priority: 'normal',
        meta: {
          adminAction: 'role-update',
          role: refreshedRoleState.primaryRole,
          roles: refreshedRoleState.roles,
          adminDashboardAccess: refreshedRoleState.hasAdminDashboardAccess,
        },
      });

      return res.json({
        success: true,
        message: `${user.emailAddress} access roles updated successfully`,
        data: {
          user: formatRoleManagerUser(user),
        },
      });
    } catch (error) {
      console.error('[admin/users/:userId/role] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user role',
      });
    }
  }
);

router.post(
  '/users/:userId/push-test',
  authMiddleware,
  primaryAdminMiddleware,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User id is required',
        });
      }

      const user = await User.findById(userId)
        .select('fullName emailAddress mobilePushTokens')
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // console.log("User data is", user)

      const tokens = (user.mobilePushTokens || [])
        .map((entry) => String(entry?.token || '').trim())
        .filter(Boolean);

      if (!tokens.length) {
        return res.status(400).json({
          success: false,
          message: 'This user has no registered push notification token yet.',
        });
      }

      const source = String(req.body?.source || 'admin-user-manager').trim();
      const title = String(req.body?.title || '').trim() || 'Kuku Push Test';
      const message =
        String(req.body?.message || '').trim() ||
        `Hello ${String(user.fullName || '').trim() || 'there'}, this is a push test from admin.`;

      const dispatchResult = await dispatchPushNotifications(tokens, {
        title,
        message,
        data: {
          type: 'admin_push_test',
          source,
          userId: String(user._id || ''),
          emailAddress: String(user.emailAddress || ''),
          timestamp: new Date().toISOString(),
        },
      }, {
        awaitReceipts: true,
      });

      const hasDispatchIssues =
        Array.isArray(dispatchResult?.ticketErrors) &&
        dispatchResult.ticketErrors.length > 0;
      const hasReceiptIssues =
        Array.isArray(dispatchResult?.receiptErrors) &&
        dispatchResult.receiptErrors.length > 0;
      const allPushErrors = [
        ...(dispatchResult?.ticketErrors || []),
        ...(dispatchResult?.receiptErrors || []),
      ];
      const hasFcmCredentialError = allPushErrors.some((pushError) => {
        const message = String(pushError?.message || '').toLowerCase();
        const code = String(pushError?.details?.error || '').toLowerCase();
        return (
          code === 'invalidcredentials' ||
          message.includes('fcm server') ||
          message.includes('authenticate with fcm')
        );
      });
      const responseMessage =
        hasFcmCredentialError
          ? 'Expo accepted the push, but Google rejected Android delivery credentials. Update the Android FCM V1 service account credentials for this Expo project.'
          : hasDispatchIssues || hasReceiptIssues
          ? `Push test reached Expo for ${user.emailAddress}, but delivery issues were detected.`
          : `Push test sent to ${user.emailAddress}.`;

      return res.status(200).json({
        success: true,
        message: responseMessage,
        data: {
          userId: String(user._id || ''),
          tokenCount: tokens.length,
          registeredDevices: (user.mobilePushTokens || []).map((entry) => ({
            platform: String(entry?.platform || 'unknown'),
            deviceName: String(entry?.deviceName || 'Unknown device'),
            tokenSuffix: String(entry?.token || '').slice(-6),
            lastSeenAt: entry?.lastSeenAt || null,
          })),
          dispatchResult,
        },
      });
    } catch (error) {
      console.error('[admin/users/:userId/push-test] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send push test notification',
      });
    }
  }
);

const getWalletFundingEventsOverview = async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);

    const now = new Date();
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totals, todayTotals, grouped] = await Promise.all([
      WalletFunding.aggregate([
        {
          $group: {
            _id: null,
            totalGross: { $sum: { $ifNull: ['$grossAmount', 0] } },
            totalFees: { $sum: { $ifNull: ['$feeAmount', 0] } },
            totalNet: { $sum: { $ifNull: ['$netAmount', 0] } },
            totalCount: { $sum: 1 },
          },
        },
      ]),
      WalletFunding.aggregate([
        {
          $match: {
            createdAt: { $gte: todayStart },
          },
        },
        {
          $group: {
            _id: null,
            todayGross: { $sum: { $ifNull: ['$grossAmount', 0] } },
            todayFees: { $sum: { $ifNull: ['$feeAmount', 0] } },
            todayNet: { $sum: { $ifNull: ['$netAmount', 0] } },
            todayCount: { $sum: 1 },
          },
        },
      ]),
      WalletFunding.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'Africa/Lagos',
              },
            },
            gross: { $sum: { $ifNull: ['$grossAmount', 0] } },
            fees: { $sum: { $ifNull: ['$feeAmount', 0] } },
            net: { $sum: { $ifNull: ['$netAmount', 0] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalSummary = totals[0] || {
      totalGross: 0,
      totalFees: 0,
      totalNet: 0,
      totalCount: 0,
    };

    const todaySummary = todayTotals[0] || {
      todayGross: 0,
      todayFees: 0,
      todayNet: 0,
      todayCount: 0,
    };

    const labels = [];
    const gross = [];
    const fees = [];
    const net = [];
    const counts = [];

    const groupedMap = new Map(grouped.map((item) => [item._id, item]));
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const dateStr = getLagosDateKey(cursor);
      const found = groupedMap.get(dateStr);
      labels.push(dateStr);
      gross.push(Number((found?.gross || 0).toFixed(2)));
      fees.push(Number((found?.fees || 0).toFixed(2)));
      net.push(Number((found?.net || 0).toFixed(2)));
      counts.push(found?.count || 0);
      cursor.setDate(cursor.getDate() + 1);
    }

    return res.json({
      success: true,
      data: {
        totals: {
          totalGross: Number(totalSummary.totalGross.toFixed(2)),
          totalFees: Number(totalSummary.totalFees.toFixed(2)),
          totalNet: Number(totalSummary.totalNet.toFixed(2)),
          totalCount: totalSummary.totalCount || 0,
          todayGross: Number(todaySummary.todayGross.toFixed(2)),
          todayFees: Number(todaySummary.todayFees.toFixed(2)),
          todayNet: Number(todaySummary.todayNet.toFixed(2)),
          todayCount: todaySummary.todayCount || 0,
        },
        chart: {
          labels,
          gross,
          fees,
          net,
          counts,
        },
      },
    });
  } catch (err) {
    console.error('[admin/wallet-funding-events/overview] Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load wallet funding events overview',
    });
  }
};

const getWalletFundingEventsRecent = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      50
    );

    const logs = await WalletFunding.find({})
      .populate('user', 'fullName emailAddress')
      .populate('transaction', 'reference status amount description')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      data: logs.map((log) => ({
        id: String(log._id),
        reference: log.reference,
        source: log.source,
        currency: log.currency || 'NGN',
        grossAmount: Number(log.grossAmount || 0),
        feeAmount: Number(log.feeAmount || 0),
        netAmount: Number(log.netAmount || 0),
        customerEmail: log.customerEmail || log.user?.emailAddress || '',
        accountNumber: log.accountNumber || '',
        processedAt: log.processedAt || log.createdAt,
        user: log.user
          ? {
              id: String(log.user._id),
              fullName: log.user.fullName || '',
              emailAddress: log.user.emailAddress || '',
            }
          : null,
        transaction: log.transaction
          ? {
              id: String(log.transaction._id),
              reference: log.transaction.reference,
              status: log.transaction.status,
              amount: Number(log.transaction.amount || 0),
              description: log.transaction.description || '',
            }
          : null,
      })),
    });
  } catch (err) {
    console.error('[admin/wallet-funding-events/recent] Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load recent wallet funding events',
    });
  }
};

router.get(
  '/wallet-funding-events/overview',
  authMiddleware,
  adminMiddleware,
  getWalletFundingEventsOverview
);

router.get(
  '/wallet-funding-events/recent',
  authMiddleware,
  adminMiddleware,
  getWalletFundingEventsRecent
);

// Backward-compatible aliases for older dashboard clients.
router.get(
  '/webhooks/overview',
  authMiddleware,
  adminMiddleware,
  getWalletFundingEventsOverview
);

router.get(
  '/webhooks/recent',
  authMiddleware,
  adminMiddleware,
  getWalletFundingEventsRecent
);

module.exports = router;
