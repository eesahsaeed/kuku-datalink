const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

const { authMiddleware } = require('../../middleware/index');
const User = require('../../schema/UserSchema.js');
const Transaction = require('../../schema/TransactionSchema.js');
const WalletFunding = require('../../schema/walletFundingSchema.js');
const WebhookIdempotency = require('../../schema/WebhookIdempotencySchema.js');
const { createUserNotification } = require('../../services/notificationService');
const {
  getNormalizedUserRoleState,
} = require('../../utils/roles');
const {
  createOrFetchPaystackVirtualAccount,
  fetchPaystackPreferredBanks,
  getPaystackMode,
  getPaystackPreferredBanks,
  getPaystackSecretKey,
  getAvailableBanks
} = require('../../services/paystackService');
const {
  buildWalletTransactionQuery,
  normalizeWalletTransactionsPagination,
  toPublicWalletTransactionsResponse,
} = require('../../utils/walletTransactions');

const PAYSTACK_WEBHOOK_IPS = new Set([
  '52.31.139.75',
  '52.49.173.169',
  '52.214.14.220',
]);

const shouldEnforcePaystackIpWhitelist = () => {
  if (process.env.PAYSTACK_ENFORCE_IP_WHITELIST === 'true') return true;
  if (process.env.PAYSTACK_ENFORCE_IP_WHITELIST === 'false') return false;
  return process.env.NODE_ENV === 'production';
};

const getMyWallet = async (req, res) => {
  try {
    const user = req.userFull;

    if (!user || !user.wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const balanceStr = parseFloat(user.wallet.balance || 0).toFixed(2);

    return res.json({
      success: true,
      wallet: {
        ...user.wallet,
        balance: balanceStr,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

const getMyWalletTransactions = async (req, res) => {
  try {
    const user = req.userFull;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { page, limit, skip } = normalizeWalletTransactionsPagination({
      page: req.query.page,
      limit: req.query.limit,
    });
    const search = String(req.query.search || '').trim();
    const group = String(req.query.group || 'all').trim().toLowerCase();
    const transactionQuery = buildWalletTransactionQuery({
      userId: user._id,
      group,
      search,
    });

    const totalTransactions = await Transaction.countDocuments(transactionQuery);
    const transactions = await Transaction.find(transactionQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json(
      toPublicWalletTransactionsResponse({
        transactions,
        page,
        limit,
        totalTransactions,
      })
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const getOrProvisionVirtualAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const virtualAccount = await createOrFetchPaystackVirtualAccount(user);

    return res.status(200).json({
      success: true,
      message: 'Virtual account retrieved successfully',
      data: virtualAccount,
    });
  } catch (error) {
    console.error('Failed to fetch/provision virtual account:', error.message);
    const pendingProvisioning = String(error.message || '')
      .toLowerCase()
      .includes('still processing dedicated account assignment');

    return res.status(pendingProvisioning ? 202 : 500).json({
      success: false,
      pending: pendingProvisioning,
      retryable: pendingProvisioning,
      message: pendingProvisioning
        ? 'Your virtual account is still being created by Paystack. Please retry in a few seconds.'
        : error.message || 'Could not retrieve virtual account at the moment',
    });
  }
};

const verifyPaystackSignature = (rawBody, signature) => {
  const secret = getPaystackSecretKey();
  if (!secret) return false;
  if (!rawBody || !signature) return false;

  const hash = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  const expected = Buffer.from(hash, 'utf8');
  const provided = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
};

const normalizeIp = (value) =>
  String(value || '')
    .trim()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/:\d+$/, '');

const getRequestIps = (req) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((value) => normalizeIp(value))
    .filter(Boolean);

  const candidates = [
    ...forwardedFor,
    normalizeIp(req.headers['x-real-ip']),
    normalizeIp(req.ip),
    normalizeIp(req.socket?.remoteAddress),
    normalizeIp(req.connection?.remoteAddress),
  ].filter(Boolean);

  return [...new Set(candidates)];
};

const verifyPaystackSourceIp = (req) => {
  const requestIps = getRequestIps(req);
  return requestIps.some((ip) => PAYSTACK_WEBHOOK_IPS.has(ip));
};

const walletTestToolsEnabled = () =>
  process.env.WALLET_TEST_TOOLS === 'true' ||
  process.env.NODE_ENV !== 'production';

const ensureWalletTestToolsEnabled = (req, res, next) => {
  if (!walletTestToolsEnabled()) {
    return res.status(403).json({
      success: false,
      message: 'Wallet test tools are disabled in this environment',
    });
  }
  return next();
};

const normalizeTxStatus = (status) => {
  const value = String(status || '').toLowerCase().trim();
  if (value === 'successful' || value === 'success') return 'success';
  if (value === 'mismatch') return 'mismatch';
  if (value === 'failed' || value === 'failure' || value === 'error') {
    return 'failed';
  }
  return 'pending';
};

const toNairaAmount = (amount) => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

const makeTestReference = (prefix = 'TEST') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const extractWebhookCustomerEmail = (data = {}) => {
  const candidates = [
    data.customer?.email,
    data.email,
    data.customer_email,
    data.metadata?.customer_email,
    data.metadata?.email,
    data.dedicated_account?.customer?.email,
    data.customer?.customer_code && data.metadata?.paystack_customer_email,
  ];

  return candidates.map(normalizeEmail).find(Boolean) || '';
};

const emitAdminWalletFundingEvents = (req, result) => {
  try {
    const io = req?.app?.get?.('io');
    if (!io || !result?.processed) return;

    const timestamp = result.timestamp || new Date().toISOString();

    io.to('admin-dashboard').emit('wallet-funding-event-received', {
      reference: result.reference,
      transactionId: result.transactionId,
      userId: result.userId,
      customerEmail: result.customerEmail,
      amount: result.amount,
      grossAmount: result.grossAmount,
      feeAmount: result.feeAmount,
      netAmount: result.netAmount,
      source: result.source || 'paystack',
      status: result.status || 'success',
      virtualAccountNumber: result.virtualAccountNumber || '',
      timestamp,
    });

    io.to('admin-dashboard').emit('wallet-balance-update', {
      amount: result.amount,
      direction: 'credit',
      source: 'wallet-funding',
      reference: result.reference,
      newBalance: result.newBalance,
      timestamp,
    });
  } catch (error) {
    console.error('[walletRouter] Failed to emit wallet funding events:', {
      reference: String(result?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
};

const WEBHOOK_IDEMPOTENCY_PROCESSING_TIMEOUT_MS = Math.max(
  Number(process.env.WALLET_WEBHOOK_IDEMPOTENCY_TIMEOUT_MS || 300000),
  30000
);

const isDuplicateKeyError = (error) => Number(error?.code) === 11000;

const shouldReclaimProcessingIdempotency = (record) => {
  if (!record) return false;
  const lockTimestamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
  if (!Number.isFinite(lockTimestamp) || lockTimestamp <= 0) return false;
  return Date.now() - lockTimestamp >= WEBHOOK_IDEMPOTENCY_PROCESSING_TIMEOUT_MS;
};

const buildPaystackWebhookIdempotencyKey = (
  data = {},
  eventType = 'charge.success'
) => {
  const providerEventId = String(data.id || '').trim();
  const reference = String(data.reference || '').trim();
  const keySource = providerEventId || reference;
  if (!keySource) return '';
  return `paystack:${eventType}:${keySource}`;
};

const beginWebhookIdempotency = async (data = {}, eventType = 'charge.success') => {
  const reference = String(data.reference || '').trim();
  const providerEventId = String(data.id || '').trim();
  const key = buildPaystackWebhookIdempotencyKey(data, eventType);

  if (!key) {
    return {
      reservation: null,
      replay: false,
      conflict: false,
      invalid: true,
      reason: 'Missing webhook idempotency source (id/reference)',
    };
  }

  const existing = await WebhookIdempotency.findOne({ key }).lean();
  if (existing) {
    if (existing.status === 'processed' && existing.responseBody) {
      console.log('[Paystack Webhook][Idempotency] Replay response', {
        key,
        reference,
        providerEventId,
      });
      return {
        reservation: existing,
        replay: true,
        conflict: false,
        invalid: false,
      };
    }

    if (existing.status === 'failed') {
      const reclaimed = await WebhookIdempotency.findOneAndUpdate(
        { _id: existing._id, status: 'failed' },
        {
          $set: {
            status: 'processing',
            lastError: '',
            lastErrorAt: null,
            processedAt: null,
          },
          $inc: {
            attemptCount: 1,
          },
        },
        { new: true }
      ).lean();

      if (reclaimed) {
        console.log('[Paystack Webhook][Idempotency] Reclaimed failed key', {
          key,
          reference,
          providerEventId,
          attemptCount: reclaimed.attemptCount,
        });
        return {
          reservation: reclaimed,
          replay: false,
          conflict: false,
          invalid: false,
        };
      }
    }

    if (
      existing.status === 'processing' &&
      shouldReclaimProcessingIdempotency(existing)
    ) {
      const reclaimed = await WebhookIdempotency.findOneAndUpdate(
        {
          _id: existing._id,
          status: 'processing',
          updatedAt: existing.updatedAt,
        },
        {
          $set: {
            lastError: '',
            lastErrorAt: null,
            processedAt: null,
          },
          $inc: {
            attemptCount: 1,
          },
        },
        { new: true }
      ).lean();

      if (reclaimed) {
        console.warn('[Paystack Webhook][Idempotency] Reclaimed stale lock', {
          key,
          reference,
          providerEventId,
          attemptCount: reclaimed.attemptCount,
          timeoutMs: WEBHOOK_IDEMPOTENCY_PROCESSING_TIMEOUT_MS,
        });
        return {
          reservation: reclaimed,
          replay: false,
          conflict: false,
          invalid: false,
        };
      }
    }

    console.log('[Paystack Webhook][Idempotency] Conflict (already processing)', {
      key,
      reference,
      providerEventId,
      status: existing.status,
    });
    return {
      reservation: existing,
      replay: false,
      conflict: true,
      invalid: false,
    };
  }

  try {
    const reservation = await WebhookIdempotency.create({
      provider: 'paystack',
      eventType,
      key,
      reference,
      providerEventId,
      status: 'processing',
      attemptCount: 1,
    });

    return {
      reservation,
      replay: false,
      conflict: false,
      invalid: false,
    };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const duplicateRecord = await WebhookIdempotency.findOne({ key }).lean();
    if (duplicateRecord?.status === 'processed' && duplicateRecord?.responseBody) {
      console.log('[Paystack Webhook][Idempotency] Duplicate replay', {
        key,
        reference,
        providerEventId,
      });
      return {
        reservation: duplicateRecord,
        replay: true,
        conflict: false,
        invalid: false,
      };
    }

    if (duplicateRecord?.status === 'failed') {
      const reclaimed = await WebhookIdempotency.findOneAndUpdate(
        { _id: duplicateRecord._id, status: 'failed' },
        {
          $set: {
            status: 'processing',
            lastError: '',
            lastErrorAt: null,
            processedAt: null,
          },
          $inc: {
            attemptCount: 1,
          },
        },
        { new: true }
      ).lean();

      if (reclaimed) {
        return {
          reservation: reclaimed,
          replay: false,
          conflict: false,
          invalid: false,
        };
      }
    }

    if (
      duplicateRecord?.status === 'processing' &&
      shouldReclaimProcessingIdempotency(duplicateRecord)
    ) {
      const reclaimed = await WebhookIdempotency.findOneAndUpdate(
        {
          _id: duplicateRecord._id,
          status: 'processing',
          updatedAt: duplicateRecord.updatedAt,
        },
        {
          $set: {
            lastError: '',
            lastErrorAt: null,
            processedAt: null,
          },
          $inc: {
            attemptCount: 1,
          },
        },
        { new: true }
      ).lean();

      if (reclaimed) {
        return {
          reservation: reclaimed,
          replay: false,
          conflict: false,
          invalid: false,
        };
      }
    }

    return {
      reservation: duplicateRecord,
      replay: false,
      conflict: true,
      invalid: false,
    };
  }
};

const finalizeWebhookIdempotency = async (
  reservationId,
  responseBody = {},
  transactionId = null,
  options = {}
) => {
  if (!reservationId) return;

  await WebhookIdempotency.findByIdAndUpdate(
    reservationId,
    {
      status: 'processed',
      responseBody,
      transaction: transactionId || null,
      processedAt: new Date(),
      lastError: '',
      lastErrorAt: null,
    },
    options
  );
};

const failWebhookIdempotency = async (
  reservationId,
  error,
  options = {}
) => {
  if (!reservationId) return;

  const safeError = String(error?.message || error || 'Webhook processing failed')
    .trim()
    .slice(0, 500);

  await WebhookIdempotency.findByIdAndUpdate(
    reservationId,
    {
      status: 'failed',
      lastError: safeError,
      lastErrorAt: new Date(),
      transaction: null,
    },
    options
  );
};

const processPaystackChargeSuccess = async ({ data, source, req }) => {
  const eventType = 'charge.success';
  const idempotencyState = await beginWebhookIdempotency(data, eventType);
  if (idempotencyState.invalid) {
    return {
      message: idempotencyState.reason || 'Invalid webhook idempotency key',
      processed: false,
    };
  }

  if (idempotencyState.replay) {
    return (
      idempotencyState.reservation?.responseBody || {
        message: 'Duplicate webhook replayed - acknowledged',
        processed: false,
      }
    );
  }

  if (idempotencyState.conflict) {
    return { message: 'Webhook is already being processed - acknowledged', processed: false };
  }

  const reservationId = idempotencyState.reservation?._id;

  const reference = String(data.reference || '').trim();
  const amountKobo = Number(data.amount || 0);
  const amountNaira = amountKobo / 100;
  const feeKobo = Number(data.fees || data.fee || 0);
  const feeNaira = feeKobo / 100;
  const netAmount = Math.max(amountNaira - feeNaira, 0);
  const customerEmail = extractWebhookCustomerEmail(data);
  const eventTimestamp = data.paid_at || new Date().toISOString();

  if (!reference || !customerEmail || amountNaira <= 0) {
    const responseBody = {
      message: !customerEmail
        ? 'Webhook email missing - acknowledged'
        : 'Payload incomplete - acknowledged',
      processed: false,
    };
    await finalizeWebhookIdempotency(reservationId, responseBody);
    return responseBody;
  }

  const existingTx = await Transaction.findOne({ reference }).lean();
  if (existingTx) {
    const responseBody = {
      message: 'Duplicate webhook - acknowledged',
      processed: false,
      reference,
      transactionId: existingTx._id?.toString?.() || null,
    };
    await finalizeWebhookIdempotency(
      reservationId,
      responseBody,
      existingTx._id || null
    );
    return responseBody;
  }

  const description =
    source === 'paystack'
      ? 'Wallet funded via Paystack bank transfer'
      : 'Wallet funded via Paystack webhook test';

  const session = await mongoose.startSession();
  let result = null;
  let userForEvents = null;
  let shouldMarkFailed = true;

  try {
    await session.withTransaction(async () => {
      const user = await User.findOne({ emailAddress: customerEmail }).session(
        session
      );
      if (!user) {
        result = {
          message: `User with email ${customerEmail} not found - acknowledged`,
          processed: false,
        };
        await finalizeWebhookIdempotency(reservationId, result, null, {
          session,
        });
        shouldMarkFailed = false;
        return;
      }

      const duplicateTx = await Transaction.findOne({ reference })
        .session(session)
        .lean();
      if (duplicateTx) {
        result = {
          message: 'Duplicate webhook - acknowledged',
          processed: false,
          reference,
          transactionId: duplicateTx._id?.toString?.() || null,
        };
        await finalizeWebhookIdempotency(
          reservationId,
          result,
          duplicateTx._id || null,
          {
            session,
          }
        );
        shouldMarkFailed = false;
        return;
      }

      const [transaction] = await Transaction.create(
        [
          {
            userId: user._id,
            type: 'credit',
            amount: amountNaira,
            description,
            reference,
            status: 'success',
            providerResponse: {
              source,
              metadata: {
                channel: data.channel,
                paidAt: data.paid_at,
                gatewayResponse: data.gateway_response,
                customer: data.customer || {},
                authorization: data.authorization || {},
              },
            },
            fundedBy: {
              fullName: user.fullName,
              email: user.emailAddress,
              phone: user.phoneNumber,
            },
            completedAt: data.paid_at || new Date(),
          },
        ],
        { session }
      );

      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $inc: { 'wallet.balance': amountNaira },
          $set: { 'wallet.lastFundedAt': new Date() },
        },
        {
          returnDocument: 'after',
          timestamps: false,
          session,
        }
      );

      if (!updatedUser) {
        throw new Error('Wallet owner not found during credit update');
      }

      const parsedWalletBalance = Number.parseFloat(
        String(updatedUser.wallet?.balance ?? 0)
      );

      try {
        await WalletFunding.create(
          [
            {
              user: user._id,
              transaction: transaction._id,
              reference,
              source,
              currency: data.currency || 'NGN',
              grossAmount: amountNaira,
              feeAmount: feeNaira,
              netAmount,
              customerEmail: user.emailAddress,
              accountNumber:
                data.dedicated_account?.account_number ||
                user.virtualAccount?.virtual_account_number ||
                '',
              eventType: 'charge.success',
              rawPayload: data,
              processedAt: data.paid_at || new Date(),
            },
          ],
          { session }
        );
      } catch (logError) {
        if (!isDuplicateKeyError(logError)) {
          throw logError;
        }
      }

      userForEvents = {
        id: String(user._id),
        emailAddress: user.emailAddress,
        virtualAccountNumber:
          updatedUser.virtualAccount?.virtual_account_number || '',
        walletCurrency: updatedUser.wallet?.currency || 'NGN',
        walletBalance: Number.isFinite(parsedWalletBalance)
          ? parsedWalletBalance
          : 0,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
      };

      result = {
        message: 'Processed',
        processed: true,
        userId: String(user._id),
        transactionId: transaction._id.toString(),
        reference,
        amount: amountNaira,
        grossAmount: amountNaira,
        feeAmount: feeNaira,
        netAmount,
        customerEmail: user.emailAddress,
        virtualAccountNumber: userForEvents.virtualAccountNumber,
        newBalance: userForEvents.walletBalance,
        status: 'success',
        source,
        timestamp: eventTimestamp,
      };

      await finalizeWebhookIdempotency(
        reservationId,
        result,
        transaction._id,
        { session }
      );
      shouldMarkFailed = false;
    });
  } catch (error) {
    if (shouldMarkFailed) {
      await failWebhookIdempotency(reservationId, error);
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (!result || !result.processed) {
    return result || { message: 'Webhook acknowledged', processed: false };
  }

  try {
    const io = req.app.get('io');
    const customerRooms = [
      userForEvents?.emailAddress?.toLowerCase?.().trim?.() || '',
      userForEvents?._id ? `user:${userForEvents._id.toString()}` : '',
    ].filter(Boolean);
    const walletPayload = {
      userId: String(userForEvents?._id || result.userId || ''),
      event: 'credit_received',
      amount: amountNaira,
      description,
      status: 'successful',
      source,
      newBalance: userForEvents.walletBalance,
      currency: userForEvents.walletCurrency || 'NGN',
      reference,
      transactionId: result.transactionId,
      timestamp: eventTimestamp,
    };
    const transactionPayload = {
      type: 'credit',
      transactionType: 'wallet-funding',
      transactionId: result.transactionId,
      reference,
      amount: amountNaira,
      providerAmountPaid: amountNaira,
      recipient: userForEvents.emailAddress || '',
      status: 'success',
      providerStatus: 'success',
      userId: String(userForEvents?._id || result.userId || ''),
      timestamp: eventTimestamp,
      description,
      newBalance: userForEvents.walletBalance,
      source,
    };

    if (io && customerRooms.length > 0) {
      for (const room of [...new Set(customerRooms)]) {
        io.to(room).emit('wallet:updated', walletPayload);
        io.to(room).emit('new-transaction', transactionPayload);
      }
    }

    if (userForEvents?._id && userForEvents?.emailAddress) {
      await createUserNotification(req, {
        userId: userForEvents._id,
        emailAddress: userForEvents.emailAddress,
        category: 'transaction',
        title: 'Wallet funded successfully',
        message: `NGN ${amountNaira.toLocaleString()} has been added to your wallet.`,
        actionUrl: '/wallet',
        priority: 'high',
        meta: {
          reference,
          source,
          grossAmount: amountNaira,
          feeAmount: feeNaira,
          netAmount,
          transactionId: result.transactionId,
          event: 'credit_received',
        },
      });
    }

    const admins = await User.find({
      $or: [{ roles: 'admin' }, { adminDashboardAccess: true }],
    })
      .select('_id emailAddress')
      .lean();

    await Promise.all(
      admins.map((adminUser) =>
        createUserNotification(req, {
          userId: adminUser._id,
          emailAddress: adminUser.emailAddress,
          category: 'transaction',
          title: 'Wallet funding event received',
          message: `Gross: NGN ${amountNaira.toLocaleString()} | Fee: NGN ${feeNaira.toLocaleString()} | ${userForEvents.emailAddress}`,
          actionUrl: '/wallet-test',
          priority: 'high',
          meta: {
            reference,
            source,
            grossAmount: amountNaira,
            feeAmount: feeNaira,
            netAmount,
            customerEmail: userForEvents.emailAddress,
            transactionId: result.transactionId,
          },
        })
      )
    );
  } catch (notifyError) {
    console.error(
      '[Paystack Webhook] Post-commit notifications failed:',
      notifyError
    );
  }

  return result;
};

const webhookData = {
  message: 'Processed',
  processed: true,
  userId: '6a0565c2a8c1be287103a933',
  transactionId: '6abd3ab36f2696f509c652ea',
  reference: '100004260930163658172844009268',
  amount: 100,
  grossAmount: 100,
  feeAmount: 1,
  netAmount: 99,
  customerEmail: 'admin@kuku.com.ng',
  virtualAccountNumber: '9739848320',
  newBalance: 217700,
  status: 'success',
  source: 'paystack',
  timestamp: '2026-09-30T16:37:04.000Z'
};

// const num = 09166198188;

const paystackWebhook = async (req, res) => {
  // console.log(req);

  let shouldProcessInBackground = false;
  let verifiedEventPayload = null;
  try {
    const requestIps = getRequestIps(req);
    const ipAllowed = verifyPaystackSourceIp(req);
    const enforceIpWhitelist = shouldEnforcePaystackIpWhitelist();

    console.log('[Paystack Webhook] Request received', {
      event: Buffer.isBuffer(req.body) ? 'raw-buffer' : req.body?.event,
      ips: requestIps,
      enforceIpWhitelist,
    });

    if (enforceIpWhitelist && !ipAllowed) {
      console.warn('Paystack webhook rejected due to non-whitelisted IP', requestIps);
      return res.status(401).json({
        success: false,
        message: 'Counterfeit webhook source',
      });
    }

    const signature = req.headers['x-paystack-signature'];
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const verified = verifyPaystackSignature(rawBody, signature);

    if (!verified) {
      console.warn('Paystack webhook signature verification failed');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const eventPayload = JSON.parse(rawBody.toString());
    verifiedEventPayload = eventPayload;

    console.log('Verified Paystack webhook event:', eventPayload);

    if (eventPayload.event !== 'charge.success') {
      return res.status(200).json({ success: true, message: 'Event ignored' });
    }

    shouldProcessInBackground = true;
    res.status(200).json({
      success: true,
      acknowledged: true,
    });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    return res.status(200).json({
      success: true,
      acknowledged: true,
      message: 'Webhook acknowledged with internal error',
    });
  }

  if (
    !shouldProcessInBackground ||
    verifiedEventPayload?.event !== 'charge.success'
  ) {
    return undefined;
  }

  try {
    processPaystackChargeSuccess({
      data: verifiedEventPayload.data || {},
      source: 'paystack',
      req,
    })
      .then((result) => {
        console.log('[Paystack Webhook] Processing result', result);
        emitAdminWalletFundingEvents(req, result);
      })
      .catch((backgroundError) => {
        console.error(
          '[Paystack Webhook] Background processing failed:',
          backgroundError
        );
      });
  } catch (backgroundParseError) {
    console.error(
      '[Paystack Webhook] Background parse failed:',
      backgroundParseError
    );
  }

  return undefined;
};

const getWalletTestStatus = async (req, res) => {
  try {
    const preferredBanks = await fetchPaystackPreferredBanks();
    const user = await User.findById(req.user.id).select(
      'emailAddress wallet.balance virtualAccount role'
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const normalizedRoleState = getNormalizedUserRoleState(user);

    return res.status(200).json({
      success: true,
      testToolsEnabled: walletTestToolsEnabled(),
      nodeEnv: process.env.NODE_ENV || 'development',
      paystackMode: getPaystackMode(),
      paystackConfigured: Boolean(getPaystackSecretKey()),
      preferredBanks:
        Array.isArray(preferredBanks) && preferredBanks.length > 0
          ? preferredBanks
          : getPaystackPreferredBanks(),
      user: {
        emailAddress: user.emailAddress,
        roles: normalizedRoleState.roles,
        walletBalance: Number(user.wallet?.balance || 0),
        hasVirtualAccount: Boolean(user.virtualAccount?.virtual_account_number),
        virtualAccount: user.virtualAccount || null,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: 'Failed to load wallet test status' });
  }
};

const walletTestCreateVirtualAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const virtualAccount = await createOrFetchPaystackVirtualAccount(user, {
      preferredBank: req.body.preferredBank,
    });
    return res.status(200).json({
      success: true,
      message: 'Virtual account retrieved/created successfully',
      data: virtualAccount,
    });
  } catch (error) {
    const pendingProvisioning = String(error.message || '')
      .toLowerCase()
      .includes('still processing dedicated account assignment');

    return res.status(pendingProvisioning ? 202 : 500).json({
      success: false,
      pending: pendingProvisioning,
      retryable: pendingProvisioning,
      message: pendingProvisioning
        ? 'Paystack has accepted the request and is still creating the virtual account. Retry shortly.'
        : error.message || 'Could not create virtual account',
    });
  }
};

const walletTestSimulatePayment = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const amount = toNairaAmount(req.body.amount);
    const status = normalizeTxStatus(req.body.status || 'success');
    const reference = String(req.body.reference || makeTestReference('SIM')).trim();
    const description =
      String(req.body.description || 'Wallet test simulated payment').trim();

    if (!user.virtualAccount?.virtual_account_number) {
      return res.status(400).json({
        success: false,
        message:
          'Create the logged-in user virtual account first before simulating a payment.',
      });
    }

    if (amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Amount must be greater than 0' });
    }

    const existingTx = await Transaction.findOne({ reference });
    if (existingTx) {
      return res.status(409).json({
        success: false,
        message: 'Reference already exists. Use a unique reference.',
      });
    }

    const shouldCredit = status === 'success';

    await Transaction.create({
      userId: user._id,
      type: shouldCredit ? 'credit' : 'debit',
      amount,
      description,
      reference,
      status,
      providerResponse: {
        source: 'wallet-test-tool',
        metadata: {
          scenario: 'simulate-payment',
          initiatedBy: req.user.email,
          initiatedAt: new Date().toISOString(),
          virtualAccountNumber: user.virtualAccount.virtual_account_number,
          bankName: user.virtualAccount.bank_name || '',
        },
      },
      fundedBy: {
        fullName: user.fullName,
        email: user.emailAddress,
        phone: user.phoneNumber,
      },
      completedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message:
        status === 'success'
          ? 'Simulated payment saved. Wallet balance is only updated by webhook calls.'
          : `Simulated ${status} payment saved`,
      data: {
        reference,
        status,
        amount,
        walletBalanceUnchanged: true,
        newBalance: Number(user.wallet?.balance || 0),
        requiresWebhook: shouldCredit,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not simulate payment',
    });
  }
};

const walletTestWebhook = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const event = String(req.body.event || 'charge.success').trim();
    if (event !== 'charge.success') {
      return res.status(200).json({
        success: true,
        message: `Event ${event} ignored in simulation`,
      });
    }

    const amount = toNairaAmount(req.body.amount);
    const reference = String(
      req.body.reference || makeTestReference('WEBHOOK')
    ).trim();

    if (!user.virtualAccount?.virtual_account_number) {
      return res.status(400).json({
        success: false,
        message:
          'Create the logged-in user virtual account first before simulating a webhook payment.',
      });
    }

    if (amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Amount must be greater than 0' });
    }

    const payloadData = {
      reference,
      amount: Math.round(amount * 100),
      channel: req.body.channel || 'bank_transfer',
      paid_at: new Date().toISOString(),
      gateway_response: req.body.gateway_response || 'Approved',
      customer: {
        email: user.emailAddress,
      },
      authorization: req.body.authorization || {},
      dedicated_account: {
        account_number: user.virtualAccount.virtual_account_number,
        bank: {
          name: user.virtualAccount.bank_name || '',
        },
      },
    };

    const result = await processPaystackChargeSuccess({
      data: payloadData,
      source: 'paystack-webhook-test',
      req,
    });

    emitAdminWalletFundingEvents(req, result);

    return res.status(200).json({
      success: true,
      ...result,
      payload: {
        event,
        data: payloadData,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not run webhook simulation',
    });
  }
};

router.get('/me', authMiddleware, getMyWallet);
router.get('/transactions', authMiddleware, getMyWalletTransactions);
router.get('/virtual-account', authMiddleware, getOrProvisionVirtualAccount);
router.post('/webhook/paystack', paystackWebhook);

// router.post("/create-demo-account", async (req, res) => {
//   const user = req.body;

//   const banks = await getAvailableBanks();

//   console.log(banks)

//   res.json({success: true})
// })

router.get(
  '/test/status',
  authMiddleware,
  ensureWalletTestToolsEnabled,
  getWalletTestStatus
);
router.post(
  '/test/create-virtual-account',
  authMiddleware,
  ensureWalletTestToolsEnabled,
  walletTestCreateVirtualAccount
);
router.post(
  '/test/simulate-payment',
  authMiddleware,
  ensureWalletTestToolsEnabled,
  walletTestSimulatePayment
);
router.post(
  '/test/webhook',
  authMiddleware,
  ensureWalletTestToolsEnabled,
  walletTestWebhook
);

router.get('/beneficiaries', authMiddleware, async (req, res) => {
  try {
    const user = req.userFull;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const beneficiaries = (user.beneficiaries || []).sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      const dateA = a.lastUsed ? new Date(a.lastUsed) : new Date(0);
      const dateB = b.lastUsed ? new Date(b.lastUsed) : new Date(0);
      return dateB - dateA;
    });

    return res.json({
      success: true,
      beneficiaries,
    });
  } catch (error) {
    console.error('[GET /beneficiaries] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch beneficiaries',
    });
  }
});

router.get('/tv-beneficiaries', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userFull._id)
      .select('tvBeneficiaries')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const beneficiaries = (user.tvBeneficiaries || []).sort(() => 0);

    return res.json({
      success: true,
      message: 'TV beneficiaries retrieved successfully',
      data: beneficiaries,
      count: beneficiaries.length,
    });
  } catch (error) {
    console.error('Error fetching TV beneficiaries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch TV beneficiaries',
    });
  }
});

router.delete('/beneficiaries/:phone', authMiddleware, async (req, res) => {
  try {
    const phone = req.params.phone;
    const user = req.userFull;

    await User.updateOne({ _id: user._id }, { $pull: { beneficiaries: phone } });

    return res.json({
      success: true,
      message: 'Beneficiary removed',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete beneficiary',
    });
  }
});

router.get('/electricity-beneficiaries', authMiddleware, async (req, res) => {
  try {
    const user = req.userFull;

    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userData = await User.findById(user._id)
      .select('electricityBeneficiaries')
      .lean();

    const beneficiaries = userData?.electricityBeneficiaries || [];

    beneficiaries.sort((a, b) => {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return res.json({
      success: true,
      message: 'Electricity beneficiaries retrieved successfully',
      data: beneficiaries,
    });
  } catch (error) {
    console.error('Error fetching electricity beneficiaries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch electricity beneficiaries',
    });
  }
});

module.exports = router;
