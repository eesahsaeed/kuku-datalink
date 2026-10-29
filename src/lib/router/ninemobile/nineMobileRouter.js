const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');

const { authMiddleware } = require('../../middleware/index');
const User = require('../../schema/UserSchema');
const Transaction = require('../../schema/TransactionSchema');
const {
  aidapayAccessToken,
  aidapayPin,
  buildNineMobileDataPackageCode,
  liveDataDetailsStore,
  dataPlans,
  networkTimeout,
  normalizeNigerianPhoneNumber,
} = require('../../helper');
const {
  catalog: sampleCatalog = {},
  purchase: samplePurchase = {},
  validation: sampleValidation = {},
} = require('../purchase/sample.json');
const {
  createUserNotification,
} = require('../../services/notificationService');
const {
  fetchDirectortechPackagesForProvider,
  getDirectortechNetworkMeta,
  requestDirectortechDataPurchase,
} = require('../../services/directortechService');
const {
  beginPurchaseIdempotency,
  finalizePurchaseIdempotency,
  failPurchaseIdempotency,
  resolveReplayResponseBody,
} = require('../../services/purchaseIdempotencyService');

const router = express.Router();

const AIDAPAY_BASE_URL = 'https://aidapay.ng/api/v1';
const AIDAPAY_LIVE_MODE =
  process.env.AIDAPAY_LIVE_MODE === 'true'
    ? true
    : process.env.AIDAPAY_LIVE_MODE === 'false'
    ? false
    : process.env.NODE_ENV === 'production';
const NINEMOBILE_DEBUG_LOGS =
  String(process.env.NINEMOBILE_DEBUG_LOGS || '')
    .trim()
    .toLowerCase() === 'true';
const NINEMOBILE_RESOLUTION_LOG_COOLDOWN_MS = Math.max(
  Number(process.env.NINEMOBILE_RESOLUTION_LOG_COOLDOWN_MS) || 180000,
  0
);
const NINEMOBILE_FALLBACK_PROVIDER_CODE = '9mobile-helper-fallback';
const NINEMOBILE_PROVIDER_IMAGE_URL = '/img/t2mobile.png';
const FALLBACK_AIDAPAY_PROVIDER_CODE = String(
  process.env.NINEMOBILE_AIDAPAY_PROVIDER_CODE || '9mobile-sme'
)
  .trim()
  .toLowerCase();
const recentResolutionLogAt = new Map();
const FRIENDLY_PURCHASE_RETRY_MESSAGE =
  'We could not complete your purchase because of a network issue. Please try again.';

function getRequestIdempotencyKey(req, fallbackReference = '') {
  return String(
    req?.headers?.['idempotency-key'] ||
      req?.headers?.['x-idempotency-key'] ||
      req?.body?.idempotency_key ||
      req?.body?.idempotencyKey ||
      fallbackReference ||
      ''
  ).trim();
}

function logNineMobileDebug(...args) {
  if (!NINEMOBILE_DEBUG_LOGS) return;
  console.log(...args);
}

function logNineMobileResolution(message, payload = {}) {
  if (!NINEMOBILE_DEBUG_LOGS) return;

  const signature = [
    message,
    payload.providerCode || 'all',
    payload.source || 'unknown',
    payload.count || 0,
  ].join('|');

  const now = Date.now();
  const lastLoggedAt = recentResolutionLogAt.get(signature) || 0;
  if (now - lastLoggedAt < NINEMOBILE_RESOLUTION_LOG_COOLDOWN_MS) {
    return;
  }

  recentResolutionLogAt.set(signature, now);
  console.log(message, payload);
}

if (NINEMOBILE_DEBUG_LOGS) {
  console.log('============================================================');
  console.log(
    `[nineMobileRouter] AIDAPAY MODE: ${AIDAPAY_LIVE_MODE ? 'LIVE' : 'MOCK'}`
  );
  console.log(
    `[nineMobileRouter] Aidapay Access Token: ${
      aidapayAccessToken ? 'PRESENT' : 'MISSING'
    }`
  );
  console.log('[nineMobileRouter] Base URL:', AIDAPAY_BASE_URL);
  console.log('============================================================');
}

function cloneSampleResponse(sample = {}) {
  return JSON.parse(JSON.stringify(sample));
}

async function requestAidapayValidationPayload(
  providerCode,
  recipient,
  { fallbackName = 'Customer', successLabel = 'Account' } = {}
) {
  const normalizedProviderCode = String(providerCode || '').trim();
  const normalizedRecipient =
    normalizeNigerianPhoneNumber(recipient) ||
    String(recipient || '').trim();

  if (!AIDAPAY_LIVE_MODE) {
    const sampleValidationPayload = cloneSampleResponse(sampleValidation);
    return {
      success: sampleValidationPayload?.success ?? true,
      verified: sampleValidationPayload?.verified ?? true,
      message:
        sampleValidationPayload?.message ||
        `${successLabel} verified successfully`,
      customer_name:
        sampleValidationPayload?.customer_name || fallbackName,
      data: {
        ...(sampleValidationPayload?.data || {}),
        provider_code: normalizedProviderCode,
        recipient: normalizedRecipient,
        customer_name:
          sampleValidationPayload?.data?.customer_name || fallbackName,
        success: sampleValidationPayload?.data?.success ?? true,
        verified: sampleValidationPayload?.data?.verified ?? true,
      },
    };
  }

  if (!normalizedProviderCode || !normalizedRecipient) {
    return {
      success: false,
      verified: false,
      message: 'Unable to verify account details',
    };
  }

  try {
    const response = await axios.get(
      `${AIDAPAY_BASE_URL}/validation/${encodeURIComponent(
        normalizedProviderCode
      )}/${encodeURIComponent(normalizedRecipient)}`,
      {
        headers: buildAidapayHeaders(),
        timeout: networkTimeout,
      }
    );

    if (!response.data?.success || response.data?.verified === false) {
      return {
        success: false,
        verified: false,
        message: response.data?.message || 'Unable to verify account details',
      };
    }

    return {
      success: true,
      verified: true,
      message:
        response.data?.message || `${successLabel} verified successfully`,
      customer_name:
        response.data?.customer_name ||
        response.data?.data?.customer_name ||
        fallbackName,
      data: response.data?.data || response.data,
    };
  } catch (error) {
    return {
      success: false,
      verified: false,
      message:
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Unable to verify account details',
    };
  }
}

async function verifyAidapayRecipientForPurchase(
  providerCode,
  recipient,
  options = {}
) {
  const payload = await requestAidapayValidationPayload(
    providerCode,
    recipient,
    options
  );

  if (!payload.success || payload.verified === false) {
    return {
      success: false,
      verified: false,
      message: payload.message || 'Unable to verify account details',
      data: payload.data || payload,
    };
  }

  return payload;
}

function buildMockPurchasePayload(sampleResponse = {}, mockMeta = {}) {
  const payload = cloneSampleResponse(sampleResponse || {});
  const transactionData = {
    ...(payload?.data?.transaction_data || {}),
  };

  const reference =
    String(mockMeta.reference || '').trim() ||
    String(transactionData.transaction_hash || '').trim() ||
    `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const recipient =
    String(mockMeta.recipient || '').trim() ||
    String(transactionData.recipient || '').trim();
  const amount = toMoneyNumber(
    mockMeta.amount ?? transactionData.amount ?? mockMeta.amountPaid,
    0
  );
  const amountPaid = toMoneyNumber(
    mockMeta.amountPaid ?? transactionData.amount_paid ?? amount,
    amount
  );
  const commission = toMoneyNumber(
    mockMeta.commission ?? transactionData.commission,
    0
  );
  const discount = toMoneyNumber(
    mockMeta.discount ?? transactionData.discount,
    0
  );
  const status = String(
    mockMeta.status || transactionData.status || 'Processing'
  );

  const message =
    String(mockMeta.message || '').trim() ||
    String(payload?.data?.message || '').trim() ||
    `Transaction Sent For Processing . N${amountPaid} Beneficiary : ${recipient}`;

  return {
    success: payload?.success ?? true,
    message: payload?.message || 'success',
    data: {
      ...(payload?.data || {}),
      success: payload?.data?.success ?? true,
      message,
      transaction_data: {
        ...transactionData,
        transaction_hash: reference,
        status,
        amount,
        recipient,
        amount_paid: amountPaid,
        commission,
        discount,
        special_message:
          mockMeta.specialMessage ??
          transactionData.special_message ??
          '',
      },
    },
  };
}

function buildAidapayHeaders(formData) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${aidapayAccessToken}`,
    ...(formData ? formData.getHeaders() : {}),
  };
}

function buildAidapayErrorResponse(
  error,
  fallbackMessage = 'Unable to reach service provider'
) {
  if (error.response?.data && typeof error.response.data === 'object') {
    return error.response.data;
  }

  return {
    success: false,
    message: fallbackMessage,
  };
}

function buildFriendlyPurchaseFailurePayload() {
  return {
    success: false,
    message: FRIENDLY_PURCHASE_RETRY_MESSAGE,
  };
}

function toMoneyNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function extractArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === 'object') {
    const keys = ['data', 'providers', 'results', 'items', 'plans'];

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
}

function normalizeProviderIdentifier(record = {}) {
  const directString = typeof record === 'string' ? record : '';

  return String(
    directString ||
      record?.provider_code ||
      record?.code ||
      record?.provider ||
      record?.provider_name ||
      record?.name ||
      ''
  )
    .trim()
    .toLowerCase();
}

function is9mobileIdentifier(value = '') {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (!normalizedValue) return false;

  return (
    normalizedValue.includes('9mobile') ||
    normalizedValue.includes('t2mobile') ||
    normalizedValue.includes('etisalat')
  );
}

function buildNineMobileFallbackProvider() {
  return {
    provider_name: '9Mobile Data',
    provider_code: NINEMOBILE_FALLBACK_PROVIDER_CODE,
    provider_info: 'Fallback 9mobile catalog from helper data.',
    provider_image_url: NINEMOBILE_PROVIDER_IMAGE_URL,
  };
}

function normalize9mobileProviderRecord(record = {}) {
  const normalizedCode = String(
    record?.provider_code || record?.code || record?.provider || ''
  )
    .trim()
    .toLowerCase();

  if (!is9mobileIdentifier(normalizedCode)) {
    return null;
  }

  const providerName = String(
    record?.provider_name || record?.provider || record?.name || '9Mobile Data'
  ).trim();

  return {
    provider_name: providerName || '9Mobile Data',
    provider_code: normalizedCode || NINEMOBILE_FALLBACK_PROVIDER_CODE,
    provider_info:
      String(record?.provider_info || '').trim() || '9mobile data provider',
    provider_image_url:
      String(record?.provider_image_url || '').trim() ||
      NINEMOBILE_PROVIDER_IMAGE_URL,
  };
}

function build9mobilePackagesFromHelper(
  providerCode = NINEMOBILE_FALLBACK_PROVIDER_CODE
) {
  const groupedPlans = dataPlans?.T2MOBILE || {};
  const records = [];

  for (const [groupKey, plansInGroup] of Object.entries(groupedPlans)) {
    const plans = Array.isArray(plansInGroup) ? plansInGroup : [];
    plans.forEach((plan, index) => {
      const price = toMoneyNumber(plan?.price_naira, NaN);
      if (!Number.isFinite(price) || price <= 0) {
        return;
      }

      records.push({
        package_name:
          String(plan?.plan_name || '').trim() ||
          `${plan?.data_allowance || ''} ${groupKey}`.trim() ||
          `9Mobile Plan ${index + 1}`,
        package_amount: price,
        package_original_amount: price,
        package_api_code: buildNineMobileDataPackageCode({
          groupKey,
          index,
          plan,
        }),
        provider_code: providerCode,
        provider_name: String(plan?.provider || '9mobile Nigeria').trim(),
        data_allowance: String(plan?.data_allowance || '').trim(),
        plan_group: groupKey,
      });
    });
  }

  return records;
}

function get9mobileHelperPackageByCode(packageCode = '') {
  const normalizedPackageCode = String(packageCode || '').trim().toUpperCase();
  if (!normalizedPackageCode) return null;

  const helperPackages = build9mobilePackagesFromHelper(
    NINEMOBILE_FALLBACK_PROVIDER_CODE
  );
  return (
    helperPackages.find(
      (record) =>
        String(record?.package_api_code || '').trim().toUpperCase() ===
        normalizedPackageCode
    ) || null
  );
}

function dedupeProviders(providers = []) {
  const seen = new Set();
  const result = [];

  for (const provider of providers) {
    const key = String(provider?.provider_code || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(provider);
  }

  return result;
}

function dedupePackages(packages = []) {
  const seen = new Set();
  const result = [];

  for (const record of packages) {
    const code = String(record?.package_api_code || '')
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(record);
  }

  return result;
}

function resolveSampleCatalogPayload(pathname = '') {
  const normalizedPathname = String(pathname || '').trim();
  const serviceMatch = normalizedPathname.match(/^\/service\/(.+)$/i);
  if (serviceMatch) {
    const serviceCode = decodeURIComponent(serviceMatch[1] || '');
    const serviceData = sampleCatalog?.services?.[serviceCode];

    return {
      success: true,
      message: 'success',
      data: Array.isArray(serviceData) ? cloneSampleResponse(serviceData) : [],
    };
  }

  const packageMatch = normalizedPathname.match(/^\/packages\/(.+)$/i);
  if (packageMatch) {
    const providerCode = decodeURIComponent(packageMatch[1] || '');
    const packageData = sampleCatalog?.packagesByProvider?.[providerCode];

    return {
      success: true,
      message: 'success',
      data: Array.isArray(packageData) ? cloneSampleResponse(packageData) : [],
    };
  }

  return {
    success: true,
    message: 'success',
    data: [],
  };
}

async function requestAidapayCatalog(pathname, options = {}) {
  const forceLive = options?.forceLive === true;
  if (!forceLive && !AIDAPAY_LIVE_MODE) {
    return resolveSampleCatalogPayload(pathname);
  }

  const response = await axios.get(`${AIDAPAY_BASE_URL}${pathname}`, {
    headers: buildAidapayHeaders(),
    timeout: networkTimeout,
  });

  return response.data;
}

async function requestAidapayPurchase(formData, mockMeta = {}) {
  if (!AIDAPAY_LIVE_MODE) {
    return buildMockPurchasePayload(samplePurchase?.data || {}, mockMeta);
  }

  const response = await axios.post(`${AIDAPAY_BASE_URL}/buy`, formData, {
    headers: buildAidapayHeaders(formData),
    timeout: networkTimeout,
  });

  return response.data;
}

async function fetch9mobileProvidersFromAidapay(options = {}) {
  const force = Boolean(options?.forceLive || options?.force);
  const packages = await fetchDirectortechPackagesForProvider('9mobile', {
    force,
  });
  const networkMeta = getDirectortechNetworkMeta('9mobile');

  if (!packages.length && !networkMeta) {
    return [];
  }

  return dedupeProviders([
    {
      provider_name: networkMeta?.provider_name || '9Mobile',
      provider_code: networkMeta?.provider_code || '9mobile',
      provider_info: 'Directortech 9mobile catalog',
      provider_image_url:
        networkMeta?.provider_image_url || NINEMOBILE_PROVIDER_IMAGE_URL,
      source: 'directortech',
      has_live_plans: packages.length > 0,
      live_plan_count: packages.length,
    },
  ]);
}

async function fetch9mobilePackagesFromAidapay(providerCode = '', options = {}) {
  const force = Boolean(options?.forceLive || options?.force);
  const resolvedProviderCode =
    getDirectortechNetworkMeta(providerCode)?.provider_code || '9mobile';
  const packages = await fetchDirectortechPackagesForProvider(
    resolvedProviderCode,
    { force }
  );

  return dedupePackages(
    packages.map((record) => ({
      ...record,
      provider_code:
        String(record?.provider_code || resolvedProviderCode || '9mobile')
          .trim()
          .toLowerCase() || '9mobile',
      provider_name: String(record?.provider_name || '9Mobile').trim(),
      provider_image_url:
        String(record?.provider_image_url || NINEMOBILE_PROVIDER_IMAGE_URL).trim(),
      source: 'directortech',
    }))
  );
}

function getProviderTransactionData(providerData = {}) {
  const candidates = [
    providerData?.data?.transaction_data,
    providerData?.transaction_data,
    providerData?.data,
    providerData?.transaction,
    providerData,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }

  return {};
}

function getProviderAmountPaid(providerData, fallbackAmount = 0) {
  const transactionData = getProviderTransactionData(providerData);
  return toMoneyNumber(transactionData?.amount_paid, fallbackAmount);
}

function getProviderCommission(providerData, fallbackAmount = 0) {
  const transactionData = getProviderTransactionData(providerData);
  const providerCommission = Number(transactionData?.commission);
  if (Number.isFinite(providerCommission) && providerCommission > 0) {
    return toMoneyNumber(providerCommission, 0);
  }
  return toMoneyNumber(fallbackAmount, 0);
}

function normalizeProviderTransactionStatus(status = '') {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (
    ['success', 'successful', 'completed', 'complete', 'delivered', 'processed'].includes(
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
    ['failed', 'failure', 'error', 'cancelled', 'canceled', 'declined', 'rejected'].includes(
      normalizedStatus
    )
  ) {
    return 'failed';
  }

  return 'processing';
}

function getProviderTransactionStatus(providerData = {}) {
  const transactionData = getProviderTransactionData(providerData);
  return normalizeProviderTransactionStatus(
    transactionData?.status || providerData?.status || providerData?.data?.status
  );
}

function normalizeTransactionPricing(pricing = {}, fallbackAmount = 0) {
  const sourcePricing =
    pricing && typeof pricing.toObject === 'function'
      ? pricing.toObject()
      : pricing || {};

  const sellingPriceValue =
    sourcePricing?.sellingPrice ?? sourcePricing?.originalPrice ?? fallbackAmount;
  const originalPriceValue =
    sourcePricing?.originalPrice ?? sourcePricing?.sellingPrice ?? fallbackAmount;
  const packageOriginalValue =
    sourcePricing?.package_original_amount ??
    sourcePricing?.originalPrice ??
    sourcePricing?.sellingPrice ??
    fallbackAmount;

  return {
    ...sourcePricing,
    gain: toMoneyNumber(sourcePricing?.gain, 0),
    commission: toMoneyNumber(sourcePricing?.commission, 0),
    extra: toMoneyNumber(sourcePricing?.extra, 0),
    fee: toMoneyNumber(sourcePricing?.fee, 0),
    sellingPrice: toMoneyNumber(sellingPriceValue, fallbackAmount),
    originalPrice: toMoneyNumber(originalPriceValue, fallbackAmount),
    package_original_amount: toMoneyNumber(packageOriginalValue, fallbackAmount),
  };
}

function calculateTransactionProfit(pricing = {}) {
  const gain = toMoneyNumber(pricing?.gain, 0);
  const commission = toMoneyNumber(pricing?.commission, 0);
  const extra = toMoneyNumber(pricing?.extra, 0);
  return toMoneyNumber(gain + commission + extra, 0);
}

function emitAdminPurchaseEvents(
  req,
  {
    type = 'data',
    transaction = null,
    amountCharged = 0,
    providerAmountPaid = 0,
    recipient = '',
    provider = '',
    packageCode = '',
    userId = '',
    emailAddress = '',
    reference = '',
    status = 'success',
    timestamp = '',
    walletUpdateDirection = 'debit',
    walletUpdateSource = 'aidapay-wallet',
    emitWalletUpdate = true,
    newBalance = null,
  } = {}
) {
  try {
    const io = req?.app?.get?.('io');
    if (!io) return;

    const tx = transaction || {};
    const txTimestamp = timestamp || new Date().toISOString();
    const normalizedAmountCharged = toMoneyNumber(
      amountCharged ?? tx.amount,
      toMoneyNumber(tx.amount, 0)
    );
    const normalizedProviderDebit = toMoneyNumber(
      providerAmountPaid,
      normalizedAmountCharged
    );
    const normalizedPricing = normalizeTransactionPricing(
      tx.pricing || {},
      normalizedAmountCharged
    );
    const resolvedType = String(type || tx.type || 'data').trim();
    const resolvedTransactionId = tx?._id ? tx._id.toString() : '';
    const resolvedReference = String(reference || tx.reference || '').trim();
    const resolvedUserId = String(userId || tx.userId || '').trim();
    const customerRooms = [...new Set([
      resolvedUserId ? `user:${resolvedUserId}` : '',
      String(emailAddress || '').trim().toLowerCase(),
    ].filter(Boolean))];
    const normalizedNewBalance = toMoneyNumber(newBalance, NaN);

    io.to('admin-dashboard').emit('new-transaction', {
      type: resolvedType,
      transactionType: resolvedType,
      transactionId: resolvedTransactionId,
      reference: resolvedReference,
      amount: normalizedAmountCharged,
      providerAmountPaid: normalizedProviderDebit,
      recipient,
      provider,
      package: packageCode,
      status,
      userId: resolvedUserId,
      profit: calculateTransactionProfit(normalizedPricing),
      timestamp: txTimestamp,
      pricing: normalizedPricing,
    });

    if (emitWalletUpdate) {
      const walletPayload = {
        userId: resolvedUserId,
        amount: normalizedProviderDebit,
        direction: walletUpdateDirection,
        source: walletUpdateSource,
        reference: resolvedReference,
        transactionId: resolvedTransactionId,
        timestamp: txTimestamp,
        status,
        ...(Number.isFinite(normalizedNewBalance)
          ? { newBalance: normalizedNewBalance.toFixed(2) }
          : {}),
      };

      io.to('admin-dashboard').emit('wallet-balance-update', walletPayload);
      for (const room of customerRooms) {
        io.to(room).emit('wallet:updated', walletPayload);
        io.to(room).emit('new-transaction', {
          type: resolvedType,
          transactionType: resolvedType,
          transactionId: resolvedTransactionId,
          reference: resolvedReference,
          amount: normalizedAmountCharged,
          providerAmountPaid: normalizedProviderDebit,
          recipient,
          provider,
          package: packageCode,
          status,
          userId: resolvedUserId,
          timestamp: txTimestamp,
          pricing: normalizedPricing,
          ...(Number.isFinite(normalizedNewBalance)
            ? { newBalance: normalizedNewBalance.toFixed(2) }
            : {}),
        });
      }
    }
  } catch (error) {
    console.error('[nineMobileRouter] Failed to emit admin purchase events:', {
      type,
      reference: String(reference || transaction?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
}

function getWalletBalanceNumber(userDoc = {}) {
  const rawBalance = userDoc?.wallet?.balance;
  const normalizedBalance =
    rawBalance != null && typeof rawBalance.toString === 'function'
      ? rawBalance.toString()
      : rawBalance;

  return toMoneyNumber(normalizedBalance, 0);
}

function hasInsufficientBalance(currentBalance, requiredAmount) {
  return toMoneyNumber(currentBalance, 0) < toMoneyNumber(requiredAmount, 0);
}

function buildInsufficientBalancePayload(currentBalance, requiredAmount) {
  const normalizedBalance = toMoneyNumber(currentBalance, 0);
  const normalizedRequired = toMoneyNumber(requiredAmount, 0);
  const shortfall = toMoneyNumber(normalizedRequired - normalizedBalance, 0);

  return {
    success: false,
    code: 'INSUFFICIENT_WALLET_BALANCE',
    message:
      shortfall > 0
        ? `Insufficient wallet balance. Need NGN ${shortfall.toFixed(2)} more.`
        : 'Insufficient wallet balance',
    walletBalance: normalizedBalance.toFixed(2),
    requiredAmount: normalizedRequired.toFixed(2),
    shortfall: shortfall.toFixed(2),
  };
}

async function loadUserForPurchase(userId, session) {
  return User.findById(userId)
    .select('+transactionPinHash +transactionPinSetAt')
    .session(session);
}

async function validateTransactionPin(user, pin) {
  const normalizedPin = String(pin || '').trim();

  if (!user?.transactionPinHash) {
    return {
      success: false,
      status: 403,
      message: 'Please set your transaction PIN before making purchases',
    };
  }

  if (!/^\d{4}$/.test(normalizedPin)) {
    return {
      success: false,
      status: 400,
      message: 'A valid 4-digit transaction PIN is required',
    };
  }

  const isValidPin = await bcrypt.compare(normalizedPin, user.transactionPinHash);
  if (!isValidPin) {
    return {
      success: false,
      status: 403,
      message: 'Incorrect transaction PIN',
    };
  }

  return { success: true };
}

async function saveBeneficiary(user, phone, session) {
  if (!phone || !user?._id) return;

  try {
    await User.updateOne(
      { _id: user._id },
      { $addToSet: { beneficiaries: phone } },
      { session }
    );
  } catch (error) {
    if (!String(error?.message || '').includes('E11000')) {
      console.warn('[nineMobileRouter] Beneficiary save failed:', error.message);
    }
  }
}

function resolveAidapayProviderCode(providerCode = '') {
  const normalized = String(providerCode || '').trim().toLowerCase();
  if (normalized === NINEMOBILE_FALLBACK_PROVIDER_CODE) {
    return FALLBACK_AIDAPAY_PROVIDER_CODE || '';
  }

  return normalized;
}

async function resolve9mobilePackagePricing({
  providerCode = '',
  packageCode = '',
  amountHint,
}) {
  const fromDetails = liveDataDetailsStore?.[packageCode];
  if (fromDetails) {
    const detailSource = String(fromDetails?.source || '').trim().toLowerCase();
    if (detailSource === 'directortech') {
      const amount = toMoneyNumber(
        fromDetails?.sellingPrice ??
          fromDetails?.originalPrice ??
          fromDetails?.package_original_amount,
        NaN
      );

      if (Number.isFinite(amount) && amount > 0) {
        return {
          package_name: String(fromDetails?.package_name || packageCode).trim(),
          amount,
          pricing: fromDetails,
        };
      }
    }
  }

  try {
    const directortechPackages = await fetch9mobilePackagesFromAidapay(
      providerCode,
      { forceLive: true }
    );
    const matchedDirectortechPackage = directortechPackages.find(
      (record) =>
        String(record?.package_api_code || '')
          .trim()
          .toUpperCase() === String(packageCode || '').trim().toUpperCase()
    );

    if (matchedDirectortechPackage) {
      return {
        package_name: matchedDirectortechPackage.package_name,
        amount: toMoneyNumber(matchedDirectortechPackage.package_amount, 0),
        pricing: matchedDirectortechPackage,
      };
    }
  } catch (error) {
    console.warn(
      '[nineMobileRouter] Directortech package lookup failed:',
      error?.response?.data || error?.message || error
    );
  }

  return null;
}

router.get('/catalog/service/data-bundle-sme', async (_req, res) => {
  try {
    let providers = [];

    try {
      providers = await fetch9mobileProvidersFromAidapay({ forceLive: true });
    } catch (error) {
      console.warn(
        '[nineMobileRouter] Directortech provider lookup failed:',
        error?.response?.data || error?.message || error
      );
    }

    logNineMobileResolution('[nineMobileRouter] Provider resolution:', {
      source: 'directortech',
      count: providers.length,
      providerCodes: providers.map((provider) => provider.provider_code),
    });

    return res.json({
      success: true,
      message: 'success',
      data: providers,
    });
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(buildAidapayErrorResponse(error, 'Unable to load 9mobile providers'));
  }
});

router.get('/catalog/packages/:providerCode', async (req, res) => {
  try {
    const providerCode = String(req.params.providerCode || '').trim().toLowerCase();

    if (!providerCode) {
      return res.status(400).json({
        success: false,
        message: 'providerCode is required',
      });
    }

    if (!is9mobileIdentifier(providerCode)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported provider for 9mobile router',
      });
    }

    let packages = [];
    try {
      packages = await fetch9mobilePackagesFromAidapay(providerCode, {
        forceLive: true,
      });
    } catch (error) {
      console.warn(
        '[nineMobileRouter] Directortech package lookup failed:',
        error?.response?.data || error?.message || error
      );
    }

    logNineMobileResolution('[nineMobileRouter] Package resolution:', {
      providerCode,
      source: 'directortech',
      count: packages.length,
    });

    return res.json({
      success: true,
      message: 'success',
      data: packages,
    });
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(buildAidapayErrorResponse(error, 'Unable to load 9mobile packages'));
  }
});

router.post('/purchase-data', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let nineMobileIdempotencyReservationId = null;
  let nineMobileIdempotencyKey = '';

  try {
    const {
      phone_number,
      provider_code,
      package_code,
      reference,
      package_name,
      amount,
      transactionPin,
    } = req.body;

    if (!phone_number || !provider_code || !package_code || !reference) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields (phone_number, provider_code, package_code, reference)',
      });
    }

    const normalizedProviderCode = String(provider_code || '').trim().toLowerCase();
    if (!is9mobileIdentifier(normalizedProviderCode)) {
      return res.status(400).json({
        success: false,
        message: 'Provider is not supported by the 9mobile router',
      });
    }

    const user = req.userFull;
    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resolvedPricing = await resolve9mobilePackagePricing({
      providerCode: normalizedProviderCode,
      packageCode: package_code,
      amountHint: amount,
    });

    if (!resolvedPricing) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package pricing',
      });
    }

    const userPaidAmount = toMoneyNumber(resolvedPricing.amount, NaN);
    if (!Number.isFinite(userPaidAmount) || userPaidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package amount',
      });
    }

    const directortechNetworkMeta = getDirectortechNetworkMeta(
      normalizedProviderCode
    );
    if (!directortechNetworkMeta?.network_id) {
      return res.status(503).json({
        success: false,
        message:
          '9mobile Directortech network is not configured.',
      });
    }

    const validationPayload = await verifyAidapayRecipientForPurchase(
      FALLBACK_AIDAPAY_PROVIDER_CODE || normalizedProviderCode,
      phone_number,
      {
        fallbackName: 'Customer',
        successLabel: 'Account',
      }
    );

    if (!validationPayload.success || validationPayload.verified === false) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        nineMobileIdempotencyReservationId,
        new Error(validationPayload.message || 'Phone validation failed'),
        validationPayload
      );
      return res.status(400).json(validationPayload);
    }

    let updatedUser = await loadUserForPurchase(user._id, session);
    if (!updatedUser) {
      throw new Error('User not found');
    }

    nineMobileIdempotencyKey = getRequestIdempotencyKey(req, reference);
    const nineMobileIdempotencyState = await beginPurchaseIdempotency({
      providerName: 'directortech',
      eventType: 'purchase.data.9mobile',
      idempotencyKey: nineMobileIdempotencyKey,
      reference,
      providerEventId: reference,
    });

    if (nineMobileIdempotencyState.invalid) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          nineMobileIdempotencyState.reason || 'Missing purchase idempotency key',
      });
    }

    if (nineMobileIdempotencyState.replay) {
      await session.abortTransaction();
      return res.json(
        nineMobileIdempotencyState.reservation?.responseBody ||
          resolveReplayResponseBody(
            nineMobileIdempotencyState.reservation,
            'Purchase already processed'
          )
      );
    }

    if (nineMobileIdempotencyState.conflict) {
      await session.abortTransaction();
      return res.status(202).json({
        success: true,
        status: 'processing',
        message: 'This purchase is already being processed.',
        reference,
      });
    }

    nineMobileIdempotencyReservationId =
      nineMobileIdempotencyState.reservation?._id || null;

    const pinValidation = await validateTransactionPin(updatedUser, transactionPin);
    if (!pinValidation.success) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        nineMobileIdempotencyReservationId,
        new Error(pinValidation.message),
        {
          success: false,
          message: pinValidation.message,
        }
      );
      return res.status(pinValidation.status).json({
        success: false,
        message: pinValidation.message,
      });
    }

    if (!updatedUser.wallet) {
      updatedUser.wallet = {
        balance: mongoose.Types.Decimal128.fromString('0.00'),
        currency: 'NGN',
        status: 'active',
        createdAt: new Date(),
      };
      await updatedUser.save({ session });
    }

    const currentBalance = getWalletBalanceNumber(updatedUser);
    if (hasInsufficientBalance(currentBalance, userPaidAmount)) {
      const insufficientPayload = buildInsufficientBalancePayload(
        currentBalance,
        userPaidAmount
      );
      await failPurchaseIdempotency(
        nineMobileIdempotencyReservationId,
        new Error(insufficientPayload.message),
        insufficientPayload
      );
      return res.status(400).json(insufficientPayload);
    }

    const providerData = await requestDirectortechDataPurchase(
      {
        networkId: directortechNetworkMeta.network_id,
        planId:
          resolvedPricing?.pricing?.directortech_plan_id ||
          resolvedPricing?.pricing?.package_api_code ||
          package_code,
        mobileNumber: phone_number,
        portedNumber: false,
      },
      {
        reference,
        recipient: phone_number,
        amount: userPaidAmount,
        amountPaid: toMoneyNumber(
          resolvedPricing?.pricing?.package_original_amount ?? userPaidAmount,
          userPaidAmount
        ),
        commission: toMoneyNumber(resolvedPricing?.pricing?.commission, 0),
        discount: toMoneyNumber(resolvedPricing?.pricing?.gain ?? 0, 0),
        status: 'Processing',
        message: `Transaction Sent For Processing . N${toMoneyNumber(
          resolvedPricing?.pricing?.package_original_amount ?? userPaidAmount,
          userPaidAmount
        )} ${String(
          directortechNetworkMeta?.provider_name || normalizedProviderCode
        ).toUpperCase()} Beneficiary : ${phone_number}`,
      }
    );
    const providerTransactionData = getProviderTransactionData(providerData);
    const providerTransactionStatus = getProviderTransactionStatus(providerData);
    const isProcessingPurchase = providerTransactionStatus !== 'success';
    const providerAmountPaid = getProviderAmountPaid(providerData, userPaidAmount);
    const providerCommission = getProviderCommission(
      providerData,
      toMoneyNumber(resolvedPricing?.pricing?.commission, 0)
    );

    const pricingPayload = {
      originalPrice: toMoneyNumber(
        resolvedPricing?.pricing?.originalPrice,
        userPaidAmount
      ),
      gain: toMoneyNumber(resolvedPricing?.pricing?.gain, 0),
      commission: toMoneyNumber(resolvedPricing?.pricing?.commission, 0),
      fee: toMoneyNumber(resolvedPricing?.pricing?.fee, 0),
      package_original_amount: toMoneyNumber(
        resolvedPricing?.pricing?.package_original_amount,
        userPaidAmount
      ),
    };

    const internalTx = new Transaction({
      type: 'data',
      userId: user._id,
      recipientPhone: phone_number,
      provider_code: normalizedProviderCode,
      package_code,
      package_name:
        String(package_name || resolvedPricing.package_name || package_code).trim(),
      amount: userPaidAmount,
      reference,
      description: `9mobile data bundle - ${
        package_name || resolvedPricing.package_name || package_code
      } (${phone_number})`,
      status: isProcessingPurchase ? 'processing' : 'success',
      pricing: pricingPayload,
      metadata: {
        router: '9mobile',
        upstreamProviderCode: String(
          directortechNetworkMeta?.provider_code || normalizedProviderCode || ''
        ).trim(),
        providerSource: 'directortech',
        providerStatus: providerTransactionStatus,
        walletDebitApplied: true,
        walletDebitAmount: userPaidAmount,
        providerReference: reference,
        purchaseIdempotencyKey: nineMobileIdempotencyKey,
      },
    });

    await internalTx.save({ session });

    if (!providerData?.success || !providerData?.data?.success) {
      internalTx.status = 'failed';
      internalTx.failureReason = providerData?.message || 'Provider rejected';
      internalTx.providerResponse = providerData || {};
      await internalTx.save({ session });
      throw new Error('Provider rejected the transaction');
    }

    const debitAmount = -userPaidAmount;
    const newBalanceNum = currentBalance + debitAmount;
    const newBalanceDec = mongoose.Types.Decimal128.fromString(
      newBalanceNum.toFixed(2)
    );

    await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          'wallet.balance': newBalanceDec,
          'wallet.lastWithdrawnAt': new Date(),
        },
      },
      { session }
    );

    await saveBeneficiary(user, phone_number, session);

    // Preserve configured plan pricing for accounting consistency.
    // Provider-reported commission is kept in providerResponse for diagnostics.
    internalTx.pricing = normalizeTransactionPricing(
      internalTx.pricing?.toObject
        ? internalTx.pricing.toObject()
        : internalTx.pricing || {},
      userPaidAmount
    );
    internalTx.status = isProcessingPurchase ? 'processing' : 'success';
    if (!isProcessingPurchase) {
      internalTx.completedAt = new Date();
    }
    internalTx.providerResponse = {
      ...(providerData || {}),
      accounting: {
        providerCommission: toMoneyNumber(providerCommission, 0),
      },
      providerStatus: providerTransactionStatus,
      providerTransactionData,
    };
    await internalTx.save({ session });

    await session.commitTransaction();

    emitAdminPurchaseEvents(req, {
      type: 'data',
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid,
      recipient: phone_number,
      provider: normalizedProviderCode,
      packageCode: package_code,
      userId: user._id.toString(),
      emailAddress: user.emailAddress,
      reference,
      status: isProcessingPurchase ? 'processing' : 'success',
      walletUpdateSource: 'directortech',
      newBalance: newBalanceNum.toFixed(2),
    });

    await createUserNotification(req, {
      userId: user._id,
      emailAddress: user.emailAddress,
      category: 'transaction',
      title: isProcessingPurchase
        ? '9mobile data purchase processing'
        : '9mobile data purchase successful',
      message: isProcessingPurchase
        ? `${
            package_name || resolvedPricing.package_name || package_code
          } for ${phone_number} is processing. We will notify you once it completes.`
        : `${
            package_name || resolvedPricing.package_name || package_code
          } for ${phone_number} has been delivered successfully.`,
      actionUrl: '/transactions',
      priority: 'normal',
      meta: {
        transactionId: internalTx._id.toString(),
        transactionType: 'data',
        amount: userPaidAmount,
        reference,
        providerStatus: providerTransactionStatus,
      },
    });

    const responseBody = {
      success: true,
      status: isProcessingPurchase ? 'processing' : 'success',
      message: isProcessingPurchase
        ? '9mobile data purchase is processing'
        : '9mobile data purchase completed successfully',
      newBalance: newBalanceNum.toFixed(2),
      transactionId: internalTx._id.toString(),
      reference,
    };

    await finalizePurchaseIdempotency(
      nineMobileIdempotencyReservationId,
      responseBody,
      internalTx._id
    );

    return res.json(responseBody);
  } catch (error) {
    console.error('[nineMobileRouter] Data purchase failed:', error);
    await failPurchaseIdempotency(
      nineMobileIdempotencyReservationId,
      error,
      buildFriendlyPurchaseFailurePayload()
    );
    await session.abortTransaction();
    return res.status(503).json(buildFriendlyPurchaseFailurePayload());
  } finally {
    session.endSession();
  }
});

module.exports = router;
