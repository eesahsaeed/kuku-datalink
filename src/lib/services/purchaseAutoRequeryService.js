const cron = require('node-cron');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

const Transaction = require('../schema/TransactionSchema');
const User = require('../schema/UserSchema');
const { aidapayAccessToken, networkTimeout } = require('../helper');
const { createUserNotification } = require('./notificationService');
const { requestDirectortechTransaction } = require('./directortechService');
const { requery: sampleRequery = {} } = require('../router/purchase/sample.json');

const AIDAPAY_BASE_URL = 'https://aidapay.ng/api/v1';
const AIDAPAY_LIVE_MODE =
  process.env.AIDAPAY_LIVE_MODE === 'true'
    ? true
    : process.env.AIDAPAY_LIVE_MODE === 'false'
    ? false
    : process.env.NODE_ENV === 'production';
const PURCHASE_AUTO_REQUERY_TIMEOUT_MS = Math.max(
  Number(process.env.PURCHASE_AUTO_REQUERY_TIMEOUT_MS) || 60000,
  30000
);
const PURCHASE_AUTO_REQUERY_CRON_SCHEDULE =
  process.env.PURCHASE_AUTO_REQUERY_CRON_SCHEDULE || '*/5 * * * *';

let autoRequeryCronStarted = false;
let autoRequerySweepRunning = false;
const scheduledTimeouts = new Map();
const activeReferences = new Set();
let notificationSource = null;

function parsePurchaseProviderSource(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeProviderTransactionStatus(status = '') {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();

  if (!normalizedStatus) {
    return 'processing';
  }

  if (
    ['success', 'successful', 'processed', 'completed', 'approved'].includes(
      normalizedStatus
    )
  ) {
    return 'success';
  }

  if (
    ['processing', 'pending', 'queued', 'in progress', 'awaiting'].includes(
      normalizedStatus
    )
  ) {
    return 'processing';
  }

  if (
    ['refund', 'refunded', 'reversed', 'reversal', 'chargeback'].includes(
      normalizedStatus
    )
  ) {
    return 'refund';
  }

  if (
    [
      'failed',
      'failure',
      'error',
      'cancelled',
      'canceled',
      'declined',
      'rejected',
    ].includes(normalizedStatus)
  ) {
    return 'failed';
  }

  return 'processing';
}

function getProviderTransactionData(providerData = {}) {
  const candidates = [
    providerData?.data?.transaction_data,
    providerData?.transaction_data,
    providerData?.data,
    providerData?.transaction,
    providerData,
  ];

  return candidates.find(
    (candidate) => candidate && typeof candidate === 'object'
  );
}

function getProviderTransactionStatus(providerData = {}) {
  const transactionData = getProviderTransactionData(providerData);
  return normalizeProviderTransactionStatus(
    transactionData?.status || providerData?.status || providerData?.data?.status
  );
}

function extractProviderTransactionReference(providerData = {}) {
  const transactionData = getProviderTransactionData(providerData);
  const candidates = [
    transactionData?.provider_transaction_hash,
    transactionData?.provider_reference,
    transactionData?.provider_tid,
    transactionData?.provider_transaction_id,
    transactionData?.transaction_hash,
    transactionData?.id,
    transactionData?.ident,
    providerData?.providerTransactionHash,
    providerData?.providerReference,
    providerData?.providerTid,
    providerData?.providerTransactionId,
    providerData?.reference,
    providerData?.transaction_hash,
    providerData?.transactionHash,
    providerData?.id,
    providerData?.ident,
  ];

  return candidates.find((candidate) => String(candidate || '').trim()) || '';
}

function getTransactionProviderSource(transaction = {}) {
  return parsePurchaseProviderSource(
    transaction?.metadata?.providerSource ||
      transaction?.metadata?.purchaseMode ||
      transaction?.providerResponse?.providerSource ||
      transaction?.providerResponse?.data?.providerSource ||
      transaction?.metadata?.provider ||
      transaction?.providerResponse?.provider ||
      ''
  );
}

function getTransactionProviderReference(transaction = {}) {
  const metadata = transaction?.metadata || {};
  const providerResponse = transaction?.providerResponse || {};

  return (
    String(
      metadata.providerReference ||
        metadata.providerTransactionReference ||
        metadata.providerTransactionHash ||
        providerResponse.providerReference ||
        providerResponse.providerTransactionHash ||
        providerResponse.providerTransactionData?.provider_reference ||
        transaction.reference ||
        metadata.appReference ||
        ''
    )
      .trim() || ''
  );
}

function getTransactionRecipient(transaction = {}) {
  return (
    String(
      transaction?.recipientPhone ||
        transaction?.recipientSmartCardNumber ||
        transaction?.recipientMeterNumber ||
        transaction?.recipient ||
        ''
    ).trim() || ''
  );
}

function getTransactionPurchaseLabel(transaction = {}) {
  const type = String(transaction?.type || '').trim().toLowerCase();

  if (type.includes('airtime')) return 'Airtime purchase';
  if (type.includes('electricity')) return 'Electricity payment';
  if (type.includes('tv')) return 'TV subscription';
  return 'Data purchase';
}

function getTransactionSpecialMessage(transaction = {}) {
  const providerResponse = transaction?.providerResponse || {};
  const transactionData = getProviderTransactionData(providerResponse);
  const candidates = [
    transaction?.metadata?.specialMessage,
    transaction?.metadata?.special_message,
    transactionData?.special_message,
    transactionData?.specialMessage,
    providerResponse?.special_message,
    providerResponse?.specialMessage,
    providerResponse?.data?.special_message,
    providerResponse?.data?.specialMessage,
  ];

  return candidates.find((candidate) => String(candidate || '').trim()) || '';
}

function isMockTestPurchaseTransaction(transaction = {}) {
  const specialMessage = String(getTransactionSpecialMessage(transaction) || '')
    .trim()
    .toLowerCase();
  const providerReference = String(
    getTransactionProviderReference(transaction) || ''
  )
    .trim()
    .toLowerCase();

  return (
    specialMessage.includes('mock purchase') ||
    specialMessage.includes('mock airtime purchase') ||
    specialMessage.includes('test purchase') ||
    /^mock[-_]/i.test(providerReference)
  );
}

function buildMockSuccessfulProviderData(transaction = {}, reference = '') {
  const normalizedReference = String(reference || '').trim();
  const walletDebitAmount = Number(
    transaction?.metadata?.walletDebitAmount ?? transaction?.amount ?? 0
  );
  const amount = Number.isFinite(walletDebitAmount) ? walletDebitAmount : 0;
  const recipient = getTransactionRecipient(transaction);
  const specialMessage = String(
    getTransactionSpecialMessage(transaction) ||
      'Directortech mock purchase auto-completed after timeout'
  ).trim();

  return {
    success: true,
    message: 'success',
    data: {
      success: true,
      message: specialMessage,
      transaction_data: {
        transaction_hash: normalizedReference,
        provider_transaction_hash: normalizedReference,
        provider_reference: normalizedReference,
        provider_tid: normalizedReference,
        provider_transaction_id: normalizedReference,
        id: normalizedReference,
        ident: normalizedReference,
        status: 'successful',
        amount,
        recipient,
        amount_paid: amount,
        commission: 0,
        discount: 0,
        special_message: specialMessage,
      },
    },
    providerReference: normalizedReference,
    providerTransactionHash: normalizedReference,
    providerSource: 'directortech',
    providerStatus: 'success',
  };
}

function resolveRealtimeIo(source) {
  if (source?.app?.get) {
    return source.app.get('io');
  }

  if (source?.to && source?.emit) {
    return source;
  }

  return null;
}

function emitCustomerPurchaseRealtimeEvents(
  source,
  {
    transaction = null,
    providerSource = '',
    providerStatus = '',
    walletMovement = null,
    userEmailAddress = '',
    trigger = 'manual',
  } = {}
) {
  try {
    const io = resolveRealtimeIo(source);
    if (!io || !transaction) return;

    const userId = String(transaction.userId || '').trim();
    const emailAddress = String(userEmailAddress || '').trim().toLowerCase();
    const rooms = [...new Set(
      [userId ? `user:${userId}` : '', emailAddress]
        .map((room) => String(room || '').trim())
        .filter(Boolean)
    )];

    if (!rooms.length) return;

    const normalizedReference = String(transaction.reference || '').trim();
    const normalizedType = String(transaction.type || '').trim();
    const normalizedStatus = String(transaction.status || providerStatus || '')
      .trim()
      .toLowerCase();
    const timestamp = new Date().toISOString();
    const nextBalance = Number(walletMovement?.nextBalance);
    const hasWalletBalance = Number.isFinite(nextBalance);
    const providerAmountPaid = Number(
      transaction?.providerResponse?.providerTransactionData?.amount_paid ||
        transaction?.providerResponse?.data?.transaction_data?.amount_paid ||
        transaction.amount ||
        0
    );

    const transactionPayload = {
      type: normalizedType,
      transactionType: normalizedType,
      transactionId: transaction._id?.toString?.() || '',
      reference: normalizedReference,
      providerReference: String(
        transaction?.metadata?.providerReference ||
          transaction?.metadata?.providerTransactionReference ||
          transaction?.metadata?.providerTransactionHash ||
          transaction?.providerResponse?.providerReference ||
          transaction?.providerResponse?.providerTransactionHash ||
          normalizedReference
      ).trim(),
      providerTransactionHash: String(
        transaction?.metadata?.providerTransactionHash ||
          transaction?.metadata?.providerTransactionReference ||
          transaction?.providerResponse?.providerTransactionHash ||
          transaction?.providerResponse?.providerReference ||
          normalizedReference
      ).trim(),
      amount: Number(transaction.amount || 0),
      providerAmountPaid,
      recipient:
        transaction.recipientPhone ||
        transaction.recipientMeterNumber ||
        transaction.recipientSmartCardNumber ||
        transaction.recipient ||
        '',
      provider: transaction.provider_code || '',
      package: transaction.package_code || '',
      status: normalizedStatus || 'processing',
      providerStatus: String(providerStatus || '').trim().toLowerCase(),
      providerSource: String(providerSource || '').trim().toLowerCase(),
      userId,
      timestamp,
      description: transaction.description || '',
      purchaseMode: String(transaction?.metadata?.purchaseMode || '').trim(),
      ...(hasWalletBalance ? { newBalance: nextBalance.toFixed(2) } : {}),
      ...(trigger ? { trigger } : {}),
    };

    const walletPayload = {
      userId,
      event:
        walletMovement?.delta > 0
          ? 'credit_received'
          : walletMovement?.delta < 0
          ? 'purchase_debited'
          : 'transaction_updated',
      amount: Math.abs(Number(walletMovement?.delta || 0)),
      direction:
        walletMovement?.delta > 0
          ? 'credit'
          : walletMovement?.delta < 0
          ? 'debit'
          : 'none',
      source: `${providerSource || 'purchase'}-auto-requery`,
      reference: normalizedReference,
      transactionId: transaction._id?.toString?.() || '',
      timestamp,
      status: normalizedStatus || 'processing',
      ...(hasWalletBalance ? { newBalance: nextBalance.toFixed(2) } : {}),
    };

    for (const room of rooms) {
      io.to(room).emit('new-transaction', transactionPayload);
      if (hasWalletBalance) {
        io.to(room).emit('wallet:updated', walletPayload);
      }
    }
  } catch (error) {
    console.warn('[purchaseAutoRequery] Realtime emit failed:', {
      reference: String(transaction?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
}

function buildAidapayHeaders(formData) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${aidapayAccessToken}`,
    ...(formData ? formData.getHeaders() : {}),
  };
}

async function requestAidapayRequery(reference) {
  const normalizedReference = String(reference || '').trim();
  const requestPayload = {
    transaction_hash: normalizedReference,
  };

  console.info('[purchaseAutoRequery] Aidapay requery request payload', {
    endpoint: `${AIDAPAY_BASE_URL}/requery`,
    liveMode: Boolean(AIDAPAY_LIVE_MODE),
    payload: requestPayload,
  });

  if (!AIDAPAY_LIVE_MODE) {
    const mockResponse =
      sampleRequery && typeof sampleRequery === 'object'
        ? {
            ...sampleRequery,
            data:
              sampleRequery.data && typeof sampleRequery.data === 'object'
                ? {
                    ...sampleRequery.data,
                    transaction_data: {
                      ...(sampleRequery.data.transaction_data || {}),
                      transaction_hash:
                        sampleRequery.data.transaction_data?.transaction_hash ||
                        normalizedReference,
                    },
                  }
                : sampleRequery.data,
          }
        : {
            success: true,
            message: 'success',
            data: {
              success: true,
              message: 'Aidapay mock requery',
              transaction_data: {
                transaction_hash: normalizedReference,
                status: 'Processing',
                amount: 0,
                recipient: '',
                amount_paid: 0,
                commission: 0,
                discount: 0,
              },
            },
          };

    console.info('[purchaseAutoRequery] Aidapay requery mock response payload', {
      reference: normalizedReference,
      payload: mockResponse,
    });

    return mockResponse;
  }

  const formData = new FormData();
  formData.append('transaction_hash', normalizedReference);

  const response = await axios.post(`${AIDAPAY_BASE_URL}/requery`, formData, {
    headers: buildAidapayHeaders(formData),
    timeout: networkTimeout,
  });

  console.info('[purchaseAutoRequery] Aidapay requery response payload', {
    reference: normalizedReference,
    payload: response.data,
  });

  return response.data;
}

async function adjustUserWalletBalance(userId, amountDelta, session) {
  const normalizedDelta = Number(amountDelta || 0);
  if (!normalizedDelta) {
    return { previousBalance: 0, newBalance: 0 };
  }

  const user = await User.findById(userId).session(session);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  if (!user.wallet) {
    user.wallet = { balance: 0 };
  }

  const currentBalance = Number(user.wallet.balance || 0);
  const newBalance = currentBalance + normalizedDelta;
  user.wallet.balance = mongoose.Types.Decimal128.fromString(
    newBalance.toFixed(2)
  );

  if (normalizedDelta > 0) {
    user.wallet.lastRefundedAt = new Date();
  } else if (normalizedDelta < 0) {
    user.wallet.lastWithdrawnAt = new Date();
  }

  await user.save({ session });

  return { previousBalance: currentBalance, newBalance };
}

function setPurchaseAutoRequeryNotificationSource(source) {
  notificationSource = source || null;
}

function clearPurchaseAutoRequeryTimeout(reference = '') {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) return;

  const timer = scheduledTimeouts.get(normalizedReference);
  if (timer) {
    clearTimeout(timer);
    scheduledTimeouts.delete(normalizedReference);
  }
}

function schedulePurchaseAutoRequery(reference, meta = {}) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) {
    return;
  }

  if (scheduledTimeouts.has(normalizedReference)) {
    return;
  }

  const delayMs = Math.max(
    Number(meta.delayMs) || PURCHASE_AUTO_REQUERY_TIMEOUT_MS,
    1000
  );
  const scheduledAt = new Date();
  const dueAt = new Date(Date.now() + delayMs);

  console.info('[purchaseAutoRequery] Scheduling purchase timeout requery', {
    reference: normalizedReference,
    delayMs,
    dueAt: dueAt.toISOString(),
    providerSource: parsePurchaseProviderSource(meta.providerSource || ''),
    trigger: String(meta.trigger || 'timeout'),
  });

  const timer = setTimeout(() => {
    scheduledTimeouts.delete(normalizedReference);
    void runPurchaseAutoRequery(normalizedReference, {
      trigger: 'timeout',
      providerSource: meta.providerSource || '',
      scheduledAt: scheduledAt.toISOString(),
      dueAt: dueAt.toISOString(),
    }).catch((error) => {
      console.error('[purchaseAutoRequery] Timeout requery failed:', {
        reference: normalizedReference,
        error: error?.response?.data || error?.message || error,
      });
    });
  }, delayMs);

  scheduledTimeouts.set(normalizedReference, timer);
}

async function reconcilePurchaseTransaction({
  reference,
  providerData = {},
  providerSource = '',
  session,
  trigger = 'manual',
}) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) {
    throw new Error('Transaction reference is required');
  }

  const transaction = await Transaction.findOne({
    reference: normalizedReference,
  }).session(session);

  if (!transaction) {
    throw new Error(`Transaction ${normalizedReference} not found`);
  }

  const currentStatus = String(transaction.status || '')
    .trim()
    .toLowerCase();
  const normalizedProviderStatus = normalizeProviderTransactionStatus(
    getProviderTransactionStatus(providerData)
  );
  const transactionData = getProviderTransactionData(providerData);
  const providerReference =
    extractProviderTransactionReference(providerData) ||
    getTransactionProviderReference(transaction) ||
    normalizedReference;
  const nowIso = new Date().toISOString();
  const metadata =
    transaction.metadata && typeof transaction.metadata.toObject === 'function'
      ? transaction.metadata.toObject()
      : {
          ...(transaction.metadata || {}),
        };
  const walletDebitAmount = Number(
    metadata.walletDebitAmount ?? transaction.amount ?? 0
  );
  const walletDebitApplied = Boolean(metadata.walletDebitApplied);
  const walletDebitReversed = Boolean(metadata.walletDebitReversed);
  let walletMovement = null;

  if (normalizedProviderStatus === 'success') {
    if (walletDebitReversed) {
      walletMovement = await adjustUserWalletBalance(
        transaction.userId,
        -walletDebitAmount,
        session
      );
      metadata.walletDebitApplied = true;
      metadata.walletDebitReversed = false;
      metadata.walletReinstatedAt = nowIso;
    } else if (!walletDebitApplied) {
      walletMovement = await adjustUserWalletBalance(
        transaction.userId,
        -walletDebitAmount,
        session
      );
      metadata.walletDebitApplied = true;
    }

    transaction.status = 'success';
    transaction.completedAt = transaction.completedAt || new Date();
    transaction.failureReason = undefined;
  } else if (normalizedProviderStatus === 'refund' || normalizedProviderStatus === 'failed') {
    if (walletDebitApplied && !walletDebitReversed) {
      walletMovement = await adjustUserWalletBalance(
        transaction.userId,
        walletDebitAmount,
        session
      );
      metadata.walletDebitReversed = true;
      metadata.walletReversalAppliedAt = nowIso;
    }

    transaction.status = 'failed';
    transaction.completedAt = transaction.completedAt || new Date();
    transaction.failureReason =
      transactionData?.message ||
      `Transaction ${
        normalizedProviderStatus === 'refund' ? 'refunded' : 'failed'
      } by provider`;
  } else {
    transaction.status =
      currentStatus === 'success' || currentStatus === 'failed'
        ? currentStatus
        : 'processing';
    transaction.failureReason = undefined;
  }

  transaction.providerResponse = {
    ...(transaction.providerResponse || {}),
    autoRequery: providerData,
    autoRequeryMeta: {
      provider: providerSource,
      status: normalizedProviderStatus,
      reference: providerReference,
      receivedAt: nowIso,
      transactionData,
      trigger,
    },
  };

  transaction.metadata = {
    ...metadata,
    providerSource: metadata.providerSource || providerSource,
    providerLastAutoRequeryStatus: normalizedProviderStatus,
    lastAutoRequeryAt: nowIso,
    lastAutoRequeryPayload: providerData,
    walletDebitAmount,
    walletDebitApplied: walletDebitApplied || normalizedProviderStatus === 'success',
    autoRequeryAttempts: Number(metadata.autoRequeryAttempts || 0) + 1,
  };

  if (normalizedProviderStatus === 'refund' || normalizedProviderStatus === 'failed') {
    transaction.metadata.walletDebitReversed = true;
    transaction.metadata.walletReversalAppliedAt =
      transaction.metadata.walletReversalAppliedAt || nowIso;
  }

  if (normalizedProviderStatus === 'success') {
    transaction.metadata.providerCompletedAt = nowIso;
  }

  await transaction.save({ session });

  return {
    transaction,
    providerStatus: normalizedProviderStatus,
    providerReference,
    walletMovement,
  };
}

function buildAutoRequeryNotificationPayload(transaction, providerStatus) {
  const label = getTransactionPurchaseLabel(transaction);
  const recipient = getTransactionRecipient(transaction);
  const itemLabel =
    transaction?.package_name ||
    transaction?.package_code ||
    transaction?.description ||
    'purchase';

  if (providerStatus === 'success') {
    return {
      title: `${label} successful`,
      message: `${itemLabel} for ${recipient} has been delivered successfully.`,
    };
  }

  if (providerStatus === 'refund') {
    return {
      title: `${label} refunded`,
      message: `${itemLabel} for ${recipient} was refunded by the provider.`,
    };
  }

  if (providerStatus === 'failed') {
    return {
      title: `${label} failed`,
      message: `${itemLabel} for ${recipient} failed on the provider side.`,
    };
  }

  return null;
}

async function runPurchaseAutoRequery(reference, meta = {}) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) {
    return { processed: false, reason: 'missing_reference' };
  }

  if (activeReferences.has(normalizedReference)) {
    return { processed: false, reason: 'in_flight' };
  }

  if (mongoose.connection.readyState !== 1) {
    return { processed: false, reason: 'db_not_ready' };
  }

  activeReferences.add(normalizedReference);

  try {
    const transaction = await Transaction.findOne({
      reference: normalizedReference,
    });

    if (!transaction) {
      return { processed: false, reason: 'not_found' };
    }

    const currentStatus = String(transaction.status || '')
      .trim()
      .toLowerCase();

    if (currentStatus !== 'processing') {
      clearPurchaseAutoRequeryTimeout(normalizedReference);
      return { processed: false, reason: 'not_processing', status: currentStatus };
    }

    const providerSource = parsePurchaseProviderSource(
      meta.providerSource || getTransactionProviderSource(transaction)
    );
    const providerReference = getTransactionProviderReference(transaction);
    const lookupReference = providerReference || normalizedReference;

    console.info('[purchaseAutoRequery] Requerying pending transaction', {
      reference: normalizedReference,
      lookupReference,
      providerSource,
      trigger: String(meta.trigger || 'manual'),
    });

    let providerData = null;
    const trigger = String(meta.trigger || 'manual');
    const shouldAutoCompleteMockPurchase =
      ['timeout', 'cron'].includes(trigger) &&
      providerSource === 'directortech' &&
      isMockTestPurchaseTransaction(transaction);

    if (shouldAutoCompleteMockPurchase) {
      providerData = buildMockSuccessfulProviderData(
        transaction,
        lookupReference || normalizedReference
      );
      console.info('[purchaseAutoRequery] Mock test purchase auto-complete payload', {
        reference: normalizedReference,
        lookupReference,
        providerSource,
        trigger,
        payload: providerData,
      });
    } else if (providerSource === 'directortech') {
      providerData = await requestDirectortechTransaction(lookupReference);
    } else {
      providerData = await requestAidapayRequery(lookupReference);
    }

    const providerStatus = normalizeProviderTransactionStatus(
      getProviderTransactionStatus(providerData)
    );

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const reconciliation = await reconcilePurchaseTransaction({
        reference: normalizedReference,
        providerData,
        providerSource,
        session,
        trigger: String(meta.trigger || 'manual'),
      });

      await session.commitTransaction();

      clearPurchaseAutoRequeryTimeout(normalizedReference);

      console.info('[purchaseAutoRequery] Requery reconciled', {
        reference: normalizedReference,
        providerSource,
        providerStatus: reconciliation.providerStatus,
        transactionStatus: reconciliation.transaction.status,
      });

      let userEmailAddress = '';
      try {
        const user = await User.findById(reconciliation.transaction.userId)
          .select('emailAddress')
          .lean();
        userEmailAddress = String(user?.emailAddress || '').trim();
      } catch (lookupError) {
        console.warn('[purchaseAutoRequery] User lookup for realtime emit failed:', {
          reference: normalizedReference,
          error: lookupError?.message || lookupError,
        });
      }

      emitCustomerPurchaseRealtimeEvents(notificationSource, {
        transaction: reconciliation.transaction,
        providerSource,
        providerStatus: reconciliation.providerStatus,
        walletMovement: reconciliation.walletMovement,
        userEmailAddress,
        trigger: String(meta.trigger || 'manual'),
      });

      const notification = buildAutoRequeryNotificationPayload(
        reconciliation.transaction,
        reconciliation.providerStatus
      );

      if (notification) {
        try {
          await createUserNotification(notificationSource, {
            userId: reconciliation.transaction.userId,
            emailAddress:
              reconciliation.transaction?.fundedBy?.email ||
              reconciliation.transaction?.purchasedBy?.email ||
              '',
            category: 'transaction',
            title: notification.title,
            message: notification.message,
            actionUrl: '/transactions',
            priority:
              reconciliation.providerStatus === 'success' ? 'normal' : 'high',
            meta: {
              transactionId: reconciliation.transaction._id.toString(),
              transactionType: reconciliation.transaction.type,
              amount: reconciliation.transaction.amount,
              reference: reconciliation.transaction.reference,
              providerSource,
              providerStatus: reconciliation.providerStatus,
            },
          });
        } catch (notificationError) {
          console.warn('[purchaseAutoRequery] Notification dispatch failed:', {
            reference: normalizedReference,
            error:
              notificationError?.response?.data ||
              notificationError?.message ||
              notificationError,
          });
        }
      }

      return {
        processed: true,
        reference: normalizedReference,
        providerSource,
        providerStatus: reconciliation.providerStatus,
        transactionStatus: reconciliation.transaction.status,
        walletMovement: reconciliation.walletMovement,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } finally {
    activeReferences.delete(normalizedReference);
  }
}

async function runProcessingPurchaseSweep(source = 'cron') {
  if (autoRequerySweepRunning) {
    return { processed: 0, skipped: 'in-flight' };
  }

  if (mongoose.connection.readyState !== 1) {
    return { processed: 0, skipped: 'db_not_ready' };
  }

  autoRequerySweepRunning = true;
  try {
    const dueThreshold = new Date(Date.now() - PURCHASE_AUTO_REQUERY_TIMEOUT_MS);
    const transactions = await Transaction.find({
      status: 'processing',
      $or: [
        {
          'metadata.autoRequeryDueAt': { $lte: new Date() },
        },
        {
          createdAt: { $lte: dueThreshold },
        },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(100);

    console.info('[purchaseAutoRequery] Processing sweep started', {
      source,
      dueCount: transactions.length,
    });

    let processed = 0;
    for (const transaction of transactions) {
      try {
        const result = await runPurchaseAutoRequery(transaction.reference, {
          trigger: 'cron',
          providerSource: getTransactionProviderSource(transaction),
        });
        if (result?.processed) {
          processed += 1;
        }
      } catch (error) {
        console.error('[purchaseAutoRequery] Processing sweep item failed:', {
          reference: transaction.reference,
          error: error?.response?.data || error?.message || error,
        });
      }
    }

    return { processed, scanned: transactions.length };
  } finally {
    autoRequerySweepRunning = false;
  }
}

function startPurchaseAutoRequeryJobs() {
  if (autoRequeryCronStarted) {
    return;
  }

  autoRequeryCronStarted = true;

  cron.schedule(
    PURCHASE_AUTO_REQUERY_CRON_SCHEDULE,
    () => {
      void runProcessingPurchaseSweep('cron').catch((error) => {
        console.error('[purchaseAutoRequery] Cron sweep failed:', {
          error: error?.response?.data || error?.message || error,
        });
      });
    },
    { timezone: 'Africa/Lagos' }
  );

  console.log('[purchaseAutoRequery] Cron scheduler started', {
    schedule: PURCHASE_AUTO_REQUERY_CRON_SCHEDULE,
    timeoutMs: PURCHASE_AUTO_REQUERY_TIMEOUT_MS,
  });
}

module.exports = {
  PURCHASE_AUTO_REQUERY_TIMEOUT_MS,
  clearPurchaseAutoRequeryTimeout,
  getProviderTransactionData,
  getProviderTransactionStatus,
  getTransactionProviderReference,
  getTransactionProviderSource,
  runPurchaseAutoRequery,
  runProcessingPurchaseSweep,
  schedulePurchaseAutoRequery,
  setPurchaseAutoRequeryNotificationSource,
  startPurchaseAutoRequeryJobs,
};
