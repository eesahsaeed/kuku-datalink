const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const { authMiddleware } = require('../../middleware/index');
const User = require('../../schema/UserSchema');
const Transaction = require('../../schema/TransactionSchema');
const {
  aidapayAccessToken,
  airtimeCommissionRates,
  networkTimeout,
  aidapayPin,
  dataPlans,
  extractCustomerName,
  getDataPlanPricingMeta,
  buildLiveDataDetailsSnapshot,
  normalizeNigerianPhoneNumber,
  networkProviderMatchesPhone,
  removeLastNonWordChar,
  removeDuplicatePackagesWithPricingMap,
  resolveFallbackProviderCodeForNetwork,
} = require('../../helper');

const {
  catalog: sampleCatalog = {},
  validation: sampleValidation = {},
  purchase: samplePurchase = {},
  transaction: sampleTransaction = {},
  requery: sampleRequery = {},
} = require('./sample.json');
const {
  createUserNotification,
} = require('../../services/notificationService');
const {
  DIRECTORTECH_AIRTIME_TEST_MODE,
  fetchDirectortechLiveDataDetailsSnapshot,
  fetchDirectortechPackagesForProvider,
  getDirectortechNetworkMeta,
  requestDirectortechAirtimePurchase,
  requestDirectortechDataPurchase,
  requestDirectortechTransaction,
} = require('../../services/directortechService');
const {
  mergeLiveAndPersistedPlanSnapshots,
} = require('../../services/planCatalogService');
const {
  beginPurchaseIdempotency,
  finalizePurchaseIdempotency,
  failPurchaseIdempotency,
  resolveReplayResponseBody,
} = require('../../services/purchaseIdempotencyService');
const {
  PURCHASE_AUTO_REQUERY_TIMEOUT_MS,
  schedulePurchaseAutoRequery,
} = require('../../services/purchaseAutoRequeryService');

const AIDAPAY_BASE_URL = 'https://aidapay.ng/api/v1';
const PHONE_NETWORK_MISMATCH_MESSAGE =
  'This phone number does not belong to the selected network.';
const useDirectortechAirtime = DIRECTORTECH_AIRTIME_TEST_MODE === true;
const AIDAPAY_LIVE_MODE =
  process.env.AIDAPAY_LIVE_MODE === 'true'
    ? true
    : process.env.AIDAPAY_LIVE_MODE === 'false'
    ? false
    : process.env.NODE_ENV === 'production';
const AIDAPAY_DEBUG_LOGS = true;
const DEFAULT_AIRTIME_MIN_AMOUNT = 50;
const DEFAULT_AIRTIME_MAX_AMOUNT = 5000;
const FRIENDLY_PURCHASE_RETRY_MESSAGE =
  'We could not complete your purchase because of a network issue. Please try again.';
const WEBHOOK_SIGNATURE_HEADER_CANDIDATES = [
  'x-webhook-signature',
  'x-signature',
  'x-aidapay-signature',
  'x-directortech-signature',
  'signature',
];
const AIDAPAY_WEBHOOK_SECRET = String(
  process.env.AIDAPAY_WEBHOOK_SECRET || aidapayAccessToken || ''
).trim();
const AIDAPAY_WEBHOOK_ENABLED = (() => {
  const normalizedValue = String(process.env.AIDAPAY_WEBHOOK_ENABLED || '')
    .trim()
    .toLowerCase();

  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalizedValue)) {
    return true;
  }

  if (['false', '0', 'no', 'off', 'disabled'].includes(normalizedValue)) {
    return false;
  }

  return true;
})();

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

const AIRTIME_PROVIDER_LIMITS = {
  'mtn-airtime': { min: 50, max: 5000 },
  'airtel-airtime': { min: 100, max: 5000 },
  '9mobile-airtime': { min: 100, max: 5000 },
  'glo-airtime': { min: 100, max: 5000 },
};

if (AIDAPAY_DEBUG_LOGS) {
  console.log('============================================================');
  console.log(
    `[purchaseRouter] AIDAPAY MODE: ${AIDAPAY_LIVE_MODE ? 'LIVE' : 'MOCK'}`
  );
  console.log(
    `[purchaseRouter] AIDAPAY WEBHOOK: ${
      AIDAPAY_WEBHOOK_ENABLED ? 'ENABLED' : 'DISABLED (legacy flow)'
    }`
  );
  console.log(
    `[purchaseRouter] Aidapay Access Token: ${
      aidapayAccessToken ? 'PRESENT' : 'MISSING'
    }`
  );
  console.log(`[purchaseRouter] Base URL: ${AIDAPAY_BASE_URL}`);
  console.log('============================================================');
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

function extractDirectortechErrorMessage(error) {
  const responseData = error?.response?.data;
  const errorCandidates = [
    responseData?.error,
    responseData?.message,
    responseData?.detail,
    error?.message,
  ];

  for (const candidate of errorCandidates) {
    if (Array.isArray(candidate)) {
      const firstMessage = candidate.find((item) => String(item || '').trim());
      if (firstMessage) {
        return String(firstMessage).trim();
      }
      continue;
    }

    const normalizedCandidate = String(candidate || '').trim();
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return '';
}

function shouldRetryDirectortechWithPortedNumber(error) {
  const message = extractDirectortechErrorMessage(error).toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.includes('mtn user') ||
    message.includes('ported') ||
    message.includes('check entered number')
  );
}

function isProviderInsufficientBalanceError(error) {
  const message = extractDirectortechErrorMessage(error).toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.includes('insufficient balance') ||
    message.includes('insufficient wallet balance') ||
    message.includes('low balance') ||
    message.includes('balance is low') ||
    message.includes('not enough balance') ||
    message.includes('recharge and try again') ||
    message.includes('wallet balance is low')
  );
}

function buildWebhookAcknowledgementPayload(providerName = 'aidapay') {
  const normalizedProviderName = String(providerName || 'aidapay')
    .trim()
    .toLowerCase();
  const providerLabel =
    normalizedProviderName === 'directortech' ? 'Directortech' : 'Aidapay';

  return {
    success: true,
    acknowledged: true,
    provider: normalizedProviderName,
    message: `${providerLabel} webhook acknowledged`,
  };
}

function normalizePurchaseProviderSource(value = '') {
  return String(value || '').trim().toLowerCase();
}

function resolvePersistedPurchaseReference(
  providerSource = '',
  providerReference = '',
  fallbackReference = ''
) {
  const normalizedProviderSource = normalizePurchaseProviderSource(
    providerSource
  );
  const normalizedProviderReference = String(providerReference || '').trim();
  const normalizedFallbackReference = String(fallbackReference || '').trim();

  if (
    normalizedProviderSource.includes('directortech') &&
    normalizedProviderReference
  ) {
    return normalizedProviderReference;
  }

  return normalizedFallbackReference || normalizedProviderReference;
}

async function resolveDirectortechPurchaseSnapshot(
  providerData = {},
  providerReference = ''
) {
  const normalizedProviderReference = String(providerReference || '').trim();
  const transactionData = getProviderTransactionData(providerData);
  const existingReferenceCandidates = [
    transactionData?.ident,
    transactionData?.id,
    transactionData?.provider_reference,
    transactionData?.providerReference,
    transactionData?.provider_transaction_hash,
    transactionData?.providerTransactionHash,
    transactionData?.transaction_hash,
    transactionData?.transactionHash,
  ]
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean);

  if (existingReferenceCandidates.some((candidate) => /^data/i.test(candidate))) {
    return providerData;
  }

  if (!normalizedProviderReference) {
    return providerData;
  }

  try {
    const lookupResponse = await requestDirectortechTransaction(
      normalizedProviderReference
    );

    return lookupResponse || providerData;
  } catch (error) {
    console.warn('[purchaseRouter] Directortech purchase lookup fallback', {
      providerReference: normalizedProviderReference,
      message: error?.message || error,
    });

    return providerData;
  }
}

async function resolveTransactionRequeryContext(
  reference,
  explicitProviderSource = ''
) {
  const normalizedReference = String(reference || '').trim();
  const normalizedExplicitProviderSource = normalizePurchaseProviderSource(
    explicitProviderSource
  );

  if (!normalizedReference) {
    return {
      transaction: null,
      providerSource: normalizedExplicitProviderSource || 'aidapay',
      transactionType: '',
    };
  }

  const transaction = await Transaction.findOne({
    reference: normalizedReference,
  })
    .select('type provider_code providerSource metadata pricing providerResponse')
    .lean();

  const metadata = transaction?.metadata || {};
  const pricing = transaction?.pricing || {};
  const providerResponse = transaction?.providerResponse || {};
  const providerHints = [
    normalizedExplicitProviderSource,
    normalizePurchaseProviderSource(transaction?.providerSource),
    normalizePurchaseProviderSource(metadata.providerSource),
    normalizePurchaseProviderSource(metadata.purchaseMode),
    normalizePurchaseProviderSource(metadata.source),
    normalizePurchaseProviderSource(transaction?.source),
    normalizePurchaseProviderSource(pricing.source),
  ].filter(Boolean);

  const providerReferenceCandidates = [
    metadata.providerReference,
    metadata.providerTransactionReference,
    metadata.providerTransactionHash,
    metadata.providerTid,
    metadata.providerTransactionId,
    providerResponse?.providerReference,
    providerResponse?.providerTransactionReference,
    providerResponse?.providerTransactionHash,
    providerResponse?.providerTid,
    providerResponse?.providerTransactionId,
    providerResponse?.providerTransactionHash,
    providerResponse?.data?.transaction_data?.provider_transaction_hash,
    providerResponse?.data?.transaction_data?.providerTransactionHash,
    extractProviderTransactionReference(providerResponse),
  ].filter(Boolean);

  const providerSource =
    providerHints.find((hint) => hint.includes('directortech')) ||
    providerHints.find((hint) => hint.includes('aidapay')) ||
    normalizedExplicitProviderSource ||
    'aidapay';

  const providerLookupReference =
    providerReferenceCandidates
      .map((candidate) => String(candidate || '').trim())
      .find(Boolean) || normalizedReference;

  return {
    transaction,
    providerSource,
    transactionType: String(transaction?.type || '').trim().toLowerCase(),
    providerLookupReference,
  };
}

function logWebhookIngress(providerName = 'aidapay', req = {}, extra = {}) {
  const normalizedProviderName = String(providerName || 'aidapay')
    .trim()
    .toLowerCase();
  const providerLabel =
    normalizedProviderName === 'directortech' ? 'Directortech' : 'Aidapay';
  const rawBody = getRawRequestBody(req);
  const bodyKeys =
    req?.body && typeof req.body === 'object'
      ? Object.keys(req.body).slice(0, 20)
      : [];

  console.info(`[purchaseRouter] ${providerLabel} webhook ingress`, {
    method: String(req?.method || '').trim() || 'POST',
    url: String(req?.originalUrl || req?.url || '').trim(),
    ip: String(req?.ip || '').trim(),
    forwardedFor: String(req?.headers?.['x-forwarded-for'] || '').trim(),
    userAgent: String(req?.headers?.['user-agent'] || '').trim(),
    contentType: String(req?.headers?.['content-type'] || '').trim(),
    bodyKeys,
    rawBodyLength: rawBody.length,
    ...extra,
  });
}

function buildPhoneNetworkMismatchPayload() {
  return {
    success: false,
    verified: false,
    message: PHONE_NETWORK_MISMATCH_MESSAGE,
  };
}

function getRequestHeaderValue(req, headerNames = []) {
  for (const headerName of headerNames) {
    const value = req?.headers?.[String(headerName).toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function getRawRequestBody(req) {
  if (typeof req?.rawBody === 'string' && req.rawBody.trim()) {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req?.rawBody)) {
    return req.rawBody.toString('utf8');
  }

  if (typeof req?.body === 'string' && req.body.trim()) {
    return req.body.trim();
  }

  if (req?.body && typeof req.body === 'object') {
    try {
      return JSON.stringify(req.body);
    } catch (error) {
      return '';
    }
  }

  return '';
}

function verifyWebhookSignature({
  req,
  signatureHeaderNames = WEBHOOK_SIGNATURE_HEADER_CANDIDATES,
  secret = '',
} = {}) {
  const rawBody = getRawRequestBody(req);
  const signature = getRequestHeaderValue(req, signatureHeaderNames);
  const normalizedSecret = String(secret || '').trim();

  if (!rawBody || !signature || !normalizedSecret) {
    return false;
  }

  const providedHash = String(signature || '').trim().toLowerCase();
  const algorithms = ['sha256', 'sha512'];

  for (const algorithm of algorithms) {
    const expectedHash = crypto
      .createHmac(algorithm, normalizedSecret)
      .update(rawBody)
      .digest('hex')
      .toLowerCase();

    if (expectedHash.length !== providedHash.length) {
      continue;
    }

    if (
      crypto.timingSafeEqual(
        Buffer.from(expectedHash, 'utf8'),
        Buffer.from(providedHash, 'utf8')
      )
    ) {
      return true;
    }
  }

  return false;
}

function normalizeProviderTransactionStatus(status = '') {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (
    ['success', 'successful', 'completed', 'complete', 'delivered', 'delivered successfully', 'processed'].includes(
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

function extractProviderTransactionReference(providerData = {}) {
  const transactionData = getProviderTransactionData(providerData);
  const candidates = [
    transactionData?.provider_transaction_hash,
    transactionData?.providerTransactionHash,
    transactionData?.provider_reference,
    transactionData?.providerReference,
    transactionData?.provider_tid,
    transactionData?.providerTid,
    transactionData?.tid,
    transactionData?.transaction_id,
    transactionData?.transactionId,
    providerData?.provider_transaction_hash,
    providerData?.providerTransactionHash,
    providerData?.provider_reference,
    providerData?.providerReference,
    providerData?.provider_tid,
    providerData?.providerTid,
    providerData?.tid,
    providerData?.transaction_id,
    providerData?.transactionId,
    transactionData?.transaction_hash,
    transactionData?.reference,
    transactionData?.ref,
    providerData?.reference,
    providerData?.ref,
    providerData?.transaction_hash,
    providerData?.data?.reference,
    providerData?.data?.ref,
    providerData?.data?.transaction_hash,
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = String(candidate || '').trim();
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return '';
}

function getProviderTransactionStatus(providerData = {}) {
  const transactionData = getProviderTransactionData(providerData);
  return normalizeProviderTransactionStatus(
    transactionData?.status || providerData?.status || providerData?.data?.status
  );
}

function isFinalProviderTransactionStatus(status = '') {
  const normalizedStatus = normalizeProviderTransactionStatus(status);
  return normalizedStatus === 'success' || normalizedStatus === 'refund' || normalizedStatus === 'failed';
}

function verifyPhoneMatchesProvider(providerCode, recipient) {
  const normalizedProviderCode = String(providerCode || '').trim();
  const normalizedRecipient =
    normalizeNigerianPhoneNumber(recipient) || String(recipient || '').trim();

  if (!normalizedProviderCode || !normalizedRecipient) {
    return {
      success: false,
      verified: false,
      message: 'Unable to verify account details',
    };
  }

  if (!networkProviderMatchesPhone(normalizedRecipient, normalizedProviderCode)) {
    return buildPhoneNetworkMismatchPayload();
  }

  return null;
}

function toLoggableValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toLoggableValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (typeof value.toJSON === 'function') {
      try {
        return toLoggableValue(value.toJSON(), seen);
      } catch (error) {
        return `[Unserializable toJSON: ${error.message}]`;
      }
    }

    const output = {};
    for (const key of Object.keys(value)) {
      output[key] = toLoggableValue(value[key], seen);
    }
    return output;
  }

  return String(value);
}

function buildErrorLogPayload(error) {
  if (!error) {
    return { error: null };
  }

  const payload = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if (error.code) {
    payload.code = error.code;
  }

  if (error.status) {
    payload.status = error.status;
  }

  if (error.response) {
    payload.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: toLoggableValue(error.response.data),
      headers: toLoggableValue(error.response.headers),
    };
  }

  if (error.config) {
    payload.request = {
      method: error.config.method,
      url: error.config.url,
      baseURL: error.config.baseURL,
      timeout: error.config.timeout,
      params: toLoggableValue(error.config.params),
      data: toLoggableValue(error.config.data),
    };
  }

  const extra = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (
      ['name', 'message', 'stack', 'cause', 'response', 'config', 'request'].includes(
        key
      )
    ) {
      continue;
    }
    extra[key] = toLoggableValue(error[key]);
  }

  if (Object.keys(extra).length > 0) {
    payload.extra = extra;
  }

  if (error.cause !== undefined) {
    payload.cause = toLoggableValue(error.cause);
  }

  return payload;
}

function buildPurchaseSuccessLogPayload({
  type,
  providerCode,
  packageCode,
  packageName,
  reference,
  recipient,
  amountCharged,
  providerAmountPaid,
  providerCommission,
  newBalance,
  userId,
  transactionId,
  providerResponse,
}) {
  return {
    type,
    providerCode,
    packageCode,
    packageName,
    reference,
    recipient,
    amountCharged,
    providerAmountPaid,
    providerCommission,
    newBalance,
    userId,
    transactionId,
    providerResponse: toLoggableValue(providerResponse),
  };
}

function logStructuredPayload(label, payload) {
  const normalizedPayload = toLoggableValue(payload);

  try {
    console.log(`${label} ${JSON.stringify(normalizedPayload, null, 2)}`);
  } catch (error) {
    console.log(label, normalizedPayload);
  }
}

function logPurchaseTransactionObject(label, transaction) {
  const normalizedTransaction = toLoggableValue(
    transaction?.toObject ? transaction.toObject() : transaction
  );

  try {
    console.log(`${label} ${JSON.stringify(normalizedTransaction, null, 2)}`);
  } catch (error) {
    console.log(label, normalizedTransaction);
  }
}

function cloneSampleResponse(sample = {}) {
  return JSON.parse(JSON.stringify(sample));
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
        ...(mockMeta.token
          ? {
              token: String(mockMeta.token),
            }
          : {}),
        ...(Number.isFinite(Number(mockMeta.tokenUnits))
          ? {
              token_units: toMoneyNumber(mockMeta.tokenUnits, 0),
            }
          : {}),
      },
    },
  };
}

function buildDefaultCatalogSamplePayload() {
  return {
    success: true,
    message: 'success',
    data: [],
  };
}

function buildMockProviderImageUrl(providerCode = '') {
  const normalizedCode = String(providerCode || '').trim().toLowerCase();

  if (normalizedCode.includes('mtn')) {
    return 'https://aidapay.ng/images/panel/providers/mtn.png';
  }
  if (normalizedCode.includes('airtel')) {
    return 'https://aidapay.ng/images/panel/providers/airtel-airtime.png';
  }
  if (normalizedCode.includes('glo')) {
    return 'https://aidapay.ng/images/panel/providers/glo-airtime.png';
  }
  if (
    normalizedCode.includes('9mobile') ||
    normalizedCode.includes('t2mobile') ||
    normalizedCode.includes('etisalat')
  ) {
    return '/img/t2mobile.png';
  }

  return `/img/${normalizedCode}.png`;
}

function getMockPlanRecordsFromHelper() {
  const records = [];
  const networks = Object.values(dataPlans || {});

  for (const network of networks) {
    if (!network || typeof network !== 'object') continue;

    for (const periodPlans of Object.values(network)) {
      if (!Array.isArray(periodPlans)) continue;

      for (const plan of periodPlans) {
        if (!plan || typeof plan !== 'object') continue;

        const providerCode = String(plan.provider_code || '')
          .trim()
          .toLowerCase();
        const packageCode = String(plan.package_api_code || '')
          .trim();

        if (!providerCode || !packageCode) continue;

        const amount = toMoneyNumber(
          plan.package_amount ?? plan.price_naira,
          NaN
        );

        if (!Number.isFinite(amount) || amount <= 0) continue;

        const originalAmount = toMoneyNumber(
          plan.package_original_amount ?? plan.price_naira ?? amount,
          amount
        );

        records.push({
          provider_name: String(plan.provider || providerCode).trim(),
          provider_code: providerCode,
          provider_image_url: buildMockProviderImageUrl(providerCode),
          package_name: String(
            plan.package_name || plan.plan_name || packageCode
          ).trim(),
          package_amount: amount,
          package_original_amount: originalAmount,
          package_api_code: packageCode,
        });
      }
    }
  }

  return records;
}

function resolveSampleCatalogPayload(pathname = '') {
  const normalizedPathname = String(pathname || '').trim();
  const serviceMatch = normalizedPathname.match(/^\/service\/(.+)$/i);
  if (serviceMatch) {
    const serviceCode = decodeURIComponent(serviceMatch[1] || '');
    const serviceData = sampleCatalog?.services?.[serviceCode];
    const helperPlans = getMockPlanRecordsFromHelper();

    if (serviceCode === 'data-bundle-sme' && helperPlans.length > 0) {
      const providerMap = new Map();
      for (const plan of helperPlans) {
        if (!providerMap.has(plan.provider_code)) {
          providerMap.set(plan.provider_code, {
            provider_name: plan.provider_name,
            provider_code: plan.provider_code,
            provider_image_url: plan.provider_image_url,
          });
        }
      }

      return {
        success: true,
        message: 'success',
        data: [...providerMap.values()],
      };
    }

    return {
      success: true,
      message: 'success',
      data: Array.isArray(serviceData) ? cloneSampleResponse(serviceData) : [],
    };
  }

  const packageMatch = normalizedPathname.match(/^\/packages\/(.+)$/i);
  if (packageMatch) {
    const providerCode = decodeURIComponent(packageMatch[1] || '');
    const normalizedProviderCode = providerCode.trim().toLowerCase();
    const packageData = sampleCatalog?.packagesByProvider?.[providerCode];
    const helperPackages = getMockPlanRecordsFromHelper()
      .filter((plan) => plan.provider_code === normalizedProviderCode)
      .map((plan) => ({
        package_name: plan.package_name,
        package_amount: plan.package_amount,
        package_original_amount: plan.package_original_amount,
        package_api_code: plan.package_api_code,
        provider_code: plan.provider_code,
      }));

    if (helperPackages.length > 0) {
      return {
        success: true,
        message: 'success',
        data: helperPackages,
      };
    }

    return {
      success: true,
      message: 'success',
      data: Array.isArray(packageData) ? cloneSampleResponse(packageData) : [],
    };
  }

  return buildDefaultCatalogSamplePayload();
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

function has9mobileProvider(records = []) {
  return records.some((record) =>
    is9mobileIdentifier(normalizeProviderIdentifier(record))
  );
}

function resolveDataPurchaseProviderCode(providerCode = '', packageCode = '') {
  return resolveFallbackProviderCodeForNetwork(packageCode, providerCode);
}

function resolveDirectortechPurchaseNetworkId(packageInfo = {}, providerCodeLike = '') {
  const candidates = [
    packageInfo?.directortech_network_id,
    packageInfo?.network_id,
    packageInfo?.provider_network_id,
  ];

  for (const candidate of candidates) {
    const numericCandidate = Number(candidate);
    if (Number.isFinite(numericCandidate) && numericCandidate > 0) {
      return numericCandidate;
    }
  }

  const networkHints = [
    packageInfo?.provider_code,
    packageInfo?.provider_name,
    packageInfo?.provider,
    providerCodeLike,
  ];

  for (const hint of networkHints) {
    const networkMeta = getDirectortechNetworkMeta(hint);
    const numericNetworkId = Number(networkMeta?.network_id);

    if (Number.isFinite(numericNetworkId) && numericNetworkId > 0) {
      return numericNetworkId;
    }
  }

  return null;
}

function resolveSampleTransactionPayload(reference, samplePayload) {
  const payload = cloneSampleResponse(samplePayload);
  const transactionData = payload?.data?.transaction_data;

  if (transactionData && typeof transactionData === 'object') {
    transactionData.transaction_hash = String(reference || '').trim() || transactionData.transaction_hash;
  }

  return payload;
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

async function fetchLiveAidapayDataDetailsSnapshot() {
  try {
    if (!String(aidapayAccessToken || '').trim()) {
      return {};
    }

    const providerPayload = await requestAidapayCatalog(
      '/service/data-bundle-sme',
      { forceLive: true }
    );
    const providers = extractArrayPayload(providerPayload?.data)
      .map((provider) =>
        String(
          provider?.provider_code || provider?.code || provider?.provider || ''
        )
          .trim()
      )
      .filter(Boolean)
      .filter((providerCode) => !is9mobileIdentifier(providerCode));

    const packageResponses = await Promise.allSettled(
      providers.map(async (providerCode) => {
        const payload = await requestAidapayCatalog(
          `/packages/${encodeURIComponent(providerCode)}`,
          { forceLive: true }
        );
        return extractArrayPayload(payload?.data).map((record) => ({
          ...record,
          provider_code: String(
            record?.provider_code || providerCode || ''
          ).trim(),
          source: String(record?.source || 'aidapay').trim().toLowerCase(),
        }));
      })
    );

    const livePlans = packageResponses.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    );

    return buildLiveDataDetailsSnapshot(livePlans);
  } catch (error) {
    console.warn('[purchaseRouter] Failed to load live data details:', {
      message: error?.message || 'Unknown error',
      status: error?.response?.status || null,
    });
    return {};
  }
}

async function fetchLiveDirectortechDataDetailsSnapshot() {
  try {
    return await fetchDirectortechLiveDataDetailsSnapshot();
  } catch (error) {
    console.warn('[purchaseRouter] Failed to load Directortech data details:', {
      message: error?.message || 'Unknown error',
      status: error?.response?.status || null,
    });
    return {};
  }
}

async function fetchLiveDataDetailsSnapshot() {
  const [aidapaySnapshot, directortechSnapshot] = await Promise.allSettled([
    fetchLiveAidapayDataDetailsSnapshot(),
    fetchLiveDirectortechDataDetailsSnapshot(),
  ]);

  return {
    ...(aidapaySnapshot.status === 'fulfilled' ? aidapaySnapshot.value : {}),
    ...(directortechSnapshot.status === 'fulfilled'
      ? directortechSnapshot.value
      : {}),
  };
}

async function refreshMergedDataDetailsSnapshot() {
  const liveSnapshot = await fetchLiveDataDetailsSnapshot();
  return mergeLiveAndPersistedPlanSnapshots(liveSnapshot);
}

async function fetchMergedDataPackages(providerCode = '') {
  const normalizedProviderCode = String(providerCode || '').trim();
  const isNineMobileProvider = is9mobileIdentifier(normalizedProviderCode);
  const pricingSnapshot = await refreshMergedDataDetailsSnapshot().catch(
    (error) => {
      console.warn(
        '[purchaseRouter][catalog/packages] Saved catalog refresh failed:',
        {
          message: error?.message || 'Unknown error',
        }
      );
      return {};
    }
  );

  const [aidapayPackagesResult, directortechPackagesResult] =
    await Promise.allSettled([
      isNineMobileProvider
        ? Promise.resolve([])
        : requestAidapayCatalog(
            `/packages/${encodeURIComponent(normalizedProviderCode)}`,
            { forceLive: true }
          ).then((payload) => extractArrayPayload(payload?.data)),
      fetchDirectortechPackagesForProvider(normalizedProviderCode),
    ]);

  const aidapayPackages =
    aidapayPackagesResult.status === 'fulfilled'
      ? aidapayPackagesResult.value
      : [];
  const directortechPackages =
    directortechPackagesResult.status === 'fulfilled'
      ? directortechPackagesResult.value
      : [];

  const mergedPackages = [
    ...aidapayPackages.map((plan) => ({
      ...plan,
      source: String(plan?.source || 'aidapay').trim().toLowerCase(),
    })),
    ...directortechPackages.map((plan) => ({
      ...plan,
      source: String(plan?.source || 'directortech').trim().toLowerCase(),
    })),
  ].filter(Boolean);

  return removeDuplicatePackagesWithPricingMap(mergedPackages, pricingSnapshot)
    .filter((plan) => !plan?.exclude)
    .sort((left, right) => {
    const leftAmount = Number(
      left?.sellingPrice ??
        left?.price ??
        left?.package_original_amount ??
        left?.package_amount ??
        0
    );
    const rightAmount = Number(
      right?.sellingPrice ??
        right?.price ??
        right?.package_original_amount ??
        right?.package_amount ??
        0
    );

    if (leftAmount !== rightAmount) {
      return leftAmount - rightAmount;
    }

    return String(left?.package_name || '').localeCompare(
      String(right?.package_name || ''),
      undefined,
      {
        sensitivity: 'base',
        numeric: true,
      }
    );
  });
}

async function requestAidapayValidationPayload(
  providerCode,
  recipient,
  { fallbackName, successLabel }
) {
  const resolvedProviderCode = resolveFallbackProviderCodeForNetwork(
    '',
    providerCode
  );
  const phoneNetworkMismatchPayload = verifyPhoneMatchesProvider(
    resolvedProviderCode,
    recipient
  );

  if (phoneNetworkMismatchPayload) {
    return phoneNetworkMismatchPayload;
  }

  if (!AIDAPAY_LIVE_MODE) {
    const sampleValidationPayload = cloneSampleResponse(sampleValidation);
    return buildValidationPayload(
      {
        ...sampleValidationPayload,
        success: sampleValidationPayload?.success ?? true,
        verified: sampleValidationPayload?.verified ?? true,
        message:
          sampleValidationPayload?.message ||
          `${successLabel} verified successfully`,
        customer_name: sampleValidationPayload?.customer_name || fallbackName,
        data: {
          ...(sampleValidationPayload?.data || {}),
          provider_code: resolvedProviderCode,
          recipient,
          customer_name:
            sampleValidationPayload?.data?.customer_name || fallbackName,
          success: sampleValidationPayload?.data?.success ?? true,
          verified: sampleValidationPayload?.data?.verified ?? true,
        },
      },
      fallbackName,
      successLabel
    );
  }

  const response = await axios.get(
    `${AIDAPAY_BASE_URL}/validation/${resolvedProviderCode}/${recipient}`,
    {
      headers: buildAidapayHeaders(),
      timeout: networkTimeout,
    }
  );

  if (!response.data?.success || response.data?.verified === false) {
    return {
      success: false,
      verified: false,
      message: response.data?.message || 'Unable to verify account',
    };
  }

  return buildValidationPayload(response.data, fallbackName, successLabel);
}

async function verifyAidapayRecipientForPurchase(
  providerCode,
  recipient,
  { fallbackName = 'Customer', successLabel = 'Account' } = {}
) {
  const normalizedProviderCode = String(providerCode || '').trim();
  const normalizedRecipient =
    normalizeNigerianPhoneNumber(recipient) ||
    String(recipient || '').trim();

  if (!normalizedProviderCode || !normalizedRecipient) {
    return {
      success: false,
      verified: false,
      message: 'Unable to verify account details',
    };
  }

  const payload = await requestAidapayValidationPayload(
    normalizedProviderCode,
    normalizedRecipient,
    {
      fallbackName,
      successLabel,
    }
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

async function requestAidapayPurchase(formData, sampleResponse, mockMeta = {}) {
  if (!AIDAPAY_LIVE_MODE) {
    return buildMockPurchasePayload(sampleResponse, mockMeta);
  }

  const response = await axios.post(`${AIDAPAY_BASE_URL}/buy`, formData, {
    headers: buildAidapayHeaders(formData),
    timeout: networkTimeout,
  });

  return response.data;
}

async function requestAidapayTransaction(reference) {
  if (!AIDAPAY_LIVE_MODE) {
    return resolveSampleTransactionPayload(reference, sampleTransaction);
  }

  const response = await axios.get(
    `${AIDAPAY_BASE_URL}/transaction/${encodeURIComponent(reference)}`,
    {
      headers: buildAidapayHeaders(),
      timeout: networkTimeout,
    }
  );

  return response.data;
}

async function requestAidapayRequery(reference) {
  const normalizedReference = String(reference || '').trim();
  const requestPayload = {
    transaction_hash: normalizedReference,
  };

  console.info('[purchaseRouter] Aidapay requery request payload', {
    endpoint: `${AIDAPAY_BASE_URL}/requery`,
    liveMode: Boolean(AIDAPAY_LIVE_MODE),
    payload: requestPayload,
  });

  if (!AIDAPAY_LIVE_MODE) {
    const mockResponse = resolveSampleTransactionPayload(
      normalizedReference,
      sampleRequery
    );

    console.info('[purchaseRouter] Aidapay requery mock response payload', {
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

  console.info('[purchaseRouter] Aidapay requery response payload', {
    reference: normalizedReference,
    payload: response.data,
  });

  return response.data;
}

function toMoneyNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.round((numeric + Number.EPSILON) * 100) / 100;
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

function buildInsufficientBalanceMessage(currentBalance, requiredAmount) {
  const shortfall = toMoneyNumber(requiredAmount - currentBalance, 0);

  if (shortfall > 0) {
    return `Insufficient wallet balance. Need NGN ${shortfall.toFixed(2)} more.`;
  }

  return 'Insufficient wallet balance';
}

function buildInsufficientBalancePayload(currentBalance, requiredAmount) {
  const normalizedBalance = toMoneyNumber(currentBalance, 0);
  const normalizedRequired = toMoneyNumber(requiredAmount, 0);
  const shortfall = toMoneyNumber(normalizedRequired - normalizedBalance, 0);

  return {
    success: false,
    code: 'INSUFFICIENT_WALLET_BALANCE',
    message: buildInsufficientBalanceMessage(
      normalizedBalance,
      normalizedRequired
    ),
    walletBalance: normalizedBalance.toFixed(2),
    requiredAmount: normalizedRequired.toFixed(2),
    shortfall: shortfall.toFixed(2),
  };
}

function getAirtimeCommissionPercent(providerCode = '') {
  const normalizedProviderCode = String(providerCode || '').toLowerCase().trim();

  const directMatch = Number(airtimeCommissionRates[providerCode]);
  if (Number.isFinite(directMatch)) {
    return directMatch;
  }

  const normalizedMatch = Number(airtimeCommissionRates[normalizedProviderCode]);
  if (Number.isFinite(normalizedMatch)) {
    return normalizedMatch;
  }

  if (normalizedProviderCode && !normalizedProviderCode.endsWith('-airtime')) {
    const suffixedMatch = Number(
      airtimeCommissionRates[`${normalizedProviderCode}-airtime`]
    );
    if (Number.isFinite(suffixedMatch)) {
      return suffixedMatch;
    }
  }

  return 0;
}

function getAirtimeLimits(providerCode = '') {
  const normalizedProviderCode = String(providerCode || '').toLowerCase().trim();
  const lookupCodes = [providerCode, normalizedProviderCode];

  if (normalizedProviderCode && !normalizedProviderCode.endsWith('-airtime')) {
    lookupCodes.push(`${normalizedProviderCode}-airtime`);
  }

  for (const code of lookupCodes) {
    const limits = AIRTIME_PROVIDER_LIMITS[code];
    if (limits) {
      return limits;
    }
  }

  return {
    min: DEFAULT_AIRTIME_MIN_AMOUNT,
    max: DEFAULT_AIRTIME_MAX_AMOUNT,
  };
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
  const providerCommission = transactionData?.commission;
  if (
    providerCommission !== null &&
    providerCommission !== undefined &&
    providerCommission !== ''
  ) {
    return toMoneyNumber(providerCommission, 0);
  }
  return toMoneyNumber(fallbackAmount, 0);
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

function getTransactionMetadataObject(transaction = {}) {
  const metadata = transaction?.metadata;

  if (metadata && typeof metadata.toObject === 'function') {
    return metadata.toObject();
  }

  if (metadata && typeof metadata === 'object') {
    return { ...metadata };
  }

  return {};
}

async function adjustUserWalletBalance(userId, amountDelta, session) {
  const user = await User.findById(userId).session(session);
  if (!user) {
    throw new Error('User not found');
  }

  if (!user.wallet) {
    user.wallet = {
      balance: mongoose.Types.Decimal128.fromString('0.00'),
      currency: 'NGN',
      status: 'active',
      createdAt: new Date(),
    };
  }

  const currentBalance = getWalletBalanceNumber(user);
  const normalizedDelta = toMoneyNumber(amountDelta, 0);
  const nextBalance = currentBalance + normalizedDelta;

  user.wallet.balance = mongoose.Types.Decimal128.fromString(
    nextBalance.toFixed(2)
  );

  if (normalizedDelta > 0) {
    user.wallet.lastRefundedAt = new Date();
  } else if (normalizedDelta < 0) {
    user.wallet.lastWithdrawnAt = new Date();
  }

  await user.save({ session });

  return {
    user,
    currentBalance,
    nextBalance,
    delta: normalizedDelta,
  };
}

async function reconcileDataPurchaseTransaction({
  req,
  session,
  providerName = 'aidapay',
  providerData = {},
  transactionReference = '',
  providerStatusOverride = '',
} = {}) {
  const normalizedReference =
    String(transactionReference || '').trim() ||
    extractProviderTransactionReference(providerData);

  if (!normalizedReference) {
    throw new Error('Transaction reference is required');
  }

  const transaction = await Transaction.findOne({
    reference: normalizedReference,
    type: 'data',
  }).session(session);

  if (!transaction) {
    return {
      acknowledged: false,
      found: false,
      reference: normalizedReference,
      providerStatus: normalizeProviderTransactionStatus(
        providerStatusOverride || getProviderTransactionStatus(providerData)
      ),
    };
  }

  const transactionData = getProviderTransactionData(providerData);
  const providerStatus = normalizeProviderTransactionStatus(
    providerStatusOverride || getProviderTransactionStatus(providerData)
  );
  const metadata = getTransactionMetadataObject(transaction);
  const currentStatus = normalizeProviderTransactionStatus(transaction.status);
  const walletDebitAmount = toMoneyNumber(
    metadata.walletDebitAmount ?? transaction.amount,
    transaction.amount
  );
  const walletDebitApplied = Boolean(metadata.walletDebitApplied);
  const walletDebitReversed = Boolean(metadata.walletDebitReversed);
  const nowIso = new Date().toISOString();
  let walletMovement = null;

  if (providerStatus === 'success') {
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
  } else if (providerStatus === 'refund' || providerStatus === 'failed') {
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
      `Transaction ${providerStatus === 'refund' ? 'refunded' : 'failed'} by provider`;
  } else {
    transaction.status =
      currentStatus === 'success' || currentStatus === 'failed'
        ? currentStatus
        : 'processing';
    transaction.failureReason = undefined;
  }

  transaction.providerResponse = {
    ...(transaction.providerResponse || {}),
    webhook: toLoggableValue(providerData),
    webhookMeta: {
      provider: providerName,
      status: providerStatus,
      reference: normalizedReference,
      receivedAt: nowIso,
      transactionData: toLoggableValue(transactionData),
    },
  };
  transaction.metadata = {
    ...metadata,
    providerSource: metadata.providerSource || providerName,
    providerLastWebhookStatus: providerStatus,
    lastWebhookAt: nowIso,
    lastWebhookPayload: toLoggableValue(providerData),
    walletDebitAmount,
    walletDebitApplied: walletDebitApplied || providerStatus === 'success',
  };

  await transaction.save({ session });

  return {
    acknowledged: true,
    found: true,
    reference: normalizedReference,
    providerStatus,
    transaction,
    walletMovement,
  };
}

function emitAdminPurchaseEvents(
  req,
  {
    type = '',
    transaction = null,
    amountCharged = 0,
    providerAmountPaid = 0,
    recipient = '',
    provider = '',
    packageCode = '',
    userId = '',
    reference = '',
    status = 'success',
    timestamp = '',
    customerName = '',
    meterType = '',
    walletUpdateDirection = 'debit',
    walletUpdateSource = 'aidapay-wallet',
    emitWalletUpdate = true,
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
    const resolvedType = String(type || tx.type || '').trim();
    const resolvedTransactionId = tx?._id ? tx._id.toString() : '';
    const resolvedReference = String(reference || tx.reference || '').trim();
    const resolvedUserId = String(userId || tx.userId || '').trim();

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
      ...(customerName ? { customerName } : {}),
      ...(meterType ? { meterType } : {}),
    });

    if (emitWalletUpdate) {
      io.to('admin-dashboard').emit('wallet-balance-update', {
        amount: normalizedProviderDebit,
        direction: walletUpdateDirection,
        source: walletUpdateSource,
        reference: resolvedReference,
        transactionId: resolvedTransactionId,
        timestamp: txTimestamp,
      });
    }
  } catch (error) {
    console.error('[purchaseRouter] Failed to emit admin purchase events:', {
      type,
      reference: String(reference || transaction?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
}

// -------------------------------------------------------------
// HELPER: SAVE BENEFICIARY (still in User schema)
// -------------------------------------------------------------
async function saveBeneficiary(user, phone, session) {
  if (!phone || !user?._id) return;

  try {
    // -------------------------------------------------------------
    await User.updateOne(
      { _id: user._id },
      { $addToSet: { beneficiaries: phone } },
      { session } // important when inside transaction
    );
  } catch (err) {
    // Only log if it's not the expected "already exists" case
    if (!err.message.includes('E11000')) {
      console.warn('Beneficiary save failed:', err.message);
    } else {
      console.log(`Beneficiary ${phone} already exists for user ${user._id}`);
    }
  }
}

// -------------------------------------------------------------
// HELPER: SAVE TV BENEFICIARY (Reliable duplicate check by smartCardNumber)
// -------------------------------------------------------------
async function saveTvBeneficiary(
  user,
  smartCardNumber,
  customerName,
  tvType,
  session
) {
  if (!smartCardNumber || !user?._id || !tvType) {
    console.warn('saveTvBeneficiary: Missing required parameters');
    return;
  }

  const trimmedSmartCard = smartCardNumber.trim();
  const tvTypeLower = tvType.toLowerCase().trim();

  try {
    // Check if smartCardNumber already exists for this user
    const existing = await User.findOne(
      {
        _id: user._id,
        'tvBeneficiaries.smartCardNumber': trimmedSmartCard,
      },
      null,
      { session }
    );

    if (existing) {
      // Update name if a better one is provided (optional but useful)
      if (customerName && customerName !== 'Unknown Customer') {
        await User.updateOne(
          {
            _id: user._id,
            'tvBeneficiaries.smartCardNumber': trimmedSmartCard,
          },
          {
            $set: {
              'tvBeneficiaries.$.name': customerName,
            },
          },
          { session }
        );
        console.log(`TV Beneficiary name updated for ${trimmedSmartCard}`);
      } else {
        console.log(`TV Beneficiary already exists: ${trimmedSmartCard}`);
      }
      return;
    }

    // Add new beneficiary if it doesn't exist
    const newBeneficiary = {
      smartCardNumber: trimmedSmartCard,
      name: customerName || '',
      tvType: tvTypeLower,
    };

    const result = await User.updateOne(
      { _id: user._id },
      {
        $push: { tvBeneficiaries: newBeneficiary }, // Using $push instead of $addToSet for objects
      },
      { session }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `New TV Beneficiary saved successfully: ${trimmedSmartCard} (${tvTypeLower})`
      );
    } else {
      console.log(`TV Beneficiary save had no effect for user ${user._id}`);
    }
  } catch (err) {
    console.error('saveTvBeneficiary failed:', err.message);
    // -------------------------------------------------------------
  }
}

async function saveElectricityBeneficiary(
  user,
  meterNumber,
  customerName,
  discoCode,
  session
) {
  if (!meterNumber || !user?._id || !discoCode) return;

  const trimmedMeter = meterNumber.trim();

  try {
    const existing = await User.findOne(
      {
        _id: user._id,
        'electricityBeneficiaries.meterNumber': trimmedMeter,
      },
      null,
      { session }
    );

    if (existing) {
      if (customerName && customerName !== 'Unknown Customer') {
        await User.updateOne(
          {
            _id: user._id,
            'electricityBeneficiaries.meterNumber': trimmedMeter,
          },
          {
            $set: { 'electricityBeneficiaries.$.name': customerName },
          },
          { session }
        );
      }
      return;
    }

    const newBeneficiary = {
      meterNumber: trimmedMeter,
      name: customerName || '',
      disco: discoCode.toLowerCase(),
    };

    await User.updateOne(
      { _id: user._id },
      { $push: { electricityBeneficiaries: newBeneficiary } },
      { session }
    );

    console.log(`Electricity beneficiary saved: ${trimmedMeter}`);
  } catch (err) {
    console.error('Electricity beneficiary save failed:', err.message);
  }
}

function buildValidationPayload(providerData, fallbackName, successLabel) {
  const derivedNameFromMessage = getDerivedCustomerNameFromMessage(
    providerData?.message
  );
  const derivedName =
    providerData?.customer_name ||
    providerData?.data?.customer_name ||
    providerData?.name ||
    derivedNameFromMessage ||
    fallbackName;

  return {
    success: true,
    verified: true,
    message: providerData?.message || `${successLabel} verified successfully`,
    customer_name: derivedName || fallbackName,
    data: providerData?.data || providerData,
  };
}

function getDerivedCustomerNameFromMessage(message) {
  const normalizedMessage = typeof message === 'string' ? message : '';
  if (!normalizedMessage || !normalizedMessage.includes(':')) {
    return '';
  }

  try {
    const extractedName = extractCustomerName(normalizedMessage);
    return removeLastNonWordChar(extractedName) || '';
  } catch (_error) {
    return '';
  }
}

async function loadUserForPurchase(userId, session) {
  return User.findById(userId)
    // Keep default fields (including wallet) and opt-in the select:false PIN fields.
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

function normalizeReplacementPackageCodeList(replacementCodes = []) {
  const rawCodes = Array.isArray(replacementCodes)
    ? replacementCodes
    : String(replacementCodes || "").trim()
    ? [replacementCodes]
    : [];

  const seenCodes = new Set();
  const normalizedCodes = [];

  for (const candidateCode of rawCodes) {
    const packageCode = String(candidateCode || "").trim();
    const uppercaseCode = packageCode.toUpperCase();

    if (!packageCode || seenCodes.has(uppercaseCode)) {
      continue;
    }

    seenCodes.add(uppercaseCode);
    normalizedCodes.push(packageCode);
  }

  return normalizedCodes;
}

// -------------------------------------------------------------
// DATA PURCHASE
// -------------------------------------------------------------
router.get("/catalog/data-details", async (_req, res) => {
  try {
    const dataDetailsSnapshot = await refreshMergedDataDetailsSnapshot();

    return res.json({
      success: true,
      source: 'mixed',
      count: Object.keys(dataDetailsSnapshot).length,
      data: dataDetailsSnapshot,
    });
  } catch (error) {
    console.warn('[purchaseRouter] /catalog/data-details fallback:', {
      message: error?.message || 'Unknown error',
      status: error?.response?.status || null,
    });
    return res.json({
      success: true,
      source: 'mixed',
      count: 0,
      data: {},
      degraded: true,
      message: 'Live data details are temporarily unavailable.',
    });
  }
});

router.get('/catalog/service/:serviceCode', async (req, res) => {
  try {
    const serviceCode = String(req.params.serviceCode || '').trim();
    const allowedServiceCodes = new Set([
      'data-bundle-sme',
      'cable-tv-subscription',
      'meter-token',
    ]);

    if (!allowedServiceCodes.has(serviceCode)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported service code',
      });
    }

    const providerData = await requestAidapayCatalog(
      `/service/${encodeURIComponent(serviceCode)}`,
      { forceLive: true }
    );

    // console.log(`Loaded providers for service "${serviceCode}":`, providerData);

    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(error, 'Unable to load service providers')
      );
  }
});

router.get('/catalog/packages/:providerCode', async (req, res) => {
  try {
    const providerCode = String(req.params.providerCode || '').trim();

    if (!providerCode) {
      return res.status(400).json({
        success: false,
        message: 'providerCode is required',
      });
    }

    const providerData = await fetchMergedDataPackages(providerCode);

    return res.json({
      success: true,
      source: 'mixed',
      data: providerData,
    });
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(buildAidapayErrorResponse(error, 'Unable to load packages'));
  }
});

router.get('/catalog/validation/:providerCode/:recipient', async (req, res) => {
  try {
    const providerCode = String(req.params.providerCode || '').trim();
    const recipient = String(req.params.recipient || '').trim();

    if (!providerCode || !recipient) {
      return res.status(400).json({
        success: false,
        message: 'providerCode and recipient are required',
      });
    }

    const fallbackName = providerCode.includes('meter')
      ? 'Electricity Customer'
      : providerCode.includes('tv') || providerCode.includes('cable')
      ? 'TV Customer'
      : 'Customer';

    const payload = await requestAidapayValidationPayload(providerCode, recipient, {
      fallbackName,
      successLabel: 'Account',
    });

    if (!payload.success || payload.verified === false) {
      return res.status(400).json(payload);
    }

    return res.json(payload);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(error, 'Unable to validate account details')
      );
  }
});

router.get('/catalog/transaction/:reference', async (req, res) => {
  try {
    const reference = String(req.params.reference || '').trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const providerData = await requestAidapayTransaction(reference);
    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(error, 'Unable to fetch transaction details')
      );
  }
});

router.post('/catalog/requery', async (req, res) => {
  try {
    const reference = String(req.body?.reference || '').trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const providerData = await requestAidapayRequery(reference);
    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(buildAidapayErrorResponse(error, 'Unable to requery transaction'));
  }
});

router.post('/catalog/requery/transaction', async (req, res) => {
  try {
    const reference = String(req.body?.reference || '').trim();
    const explicitProviderSource = String(
      req.body?.providerSource ||
        req.body?.provider_source ||
        req.body?.provider ||
        ''
    ).trim();
  const explicitProviderReference = String(
      req.body?.providerReference ||
        req.body?.provider_reference ||
        req.body?.providerTransactionHash ||
        req.body?.provider_transaction_hash ||
        req.body?.providerTid ||
        req.body?.provider_tid ||
        req.body?.transactionId ||
        req.body?.transaction_id ||
        ''
    ).trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const {
      transaction,
      providerSource,
      transactionType,
      providerLookupReference,
    } = await resolveTransactionRequeryContext(reference, explicitProviderSource);

    const lookupReference =
      explicitProviderReference ||
      (providerSource === 'directortech'
        ? providerLookupReference || reference
        : reference);

    console.log('[purchaseRouter] Transaction requery resolved', {
      reference,
      requestPayload: {
        reference,
        providerSource: explicitProviderSource,
        providerReference: explicitProviderReference,
      },
      providerSource,
      transactionType,
      transactionId: transaction?._id?.toString?.() || null,
      lookupReference,
    });

    if (providerSource === 'directortech') {
      const providerData = await requestDirectortechTransaction(lookupReference);
      return res.json(providerData);
    }

    const providerData = await requestAidapayRequery(reference);
    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(buildAidapayErrorResponse(error, 'Unable to requery transaction'));
  }
});

async function handleDataPurchaseWebhook(
  req,
  res,
  {
    providerName = 'aidapay',
    verifySignature = false,
    signatureSecret = '',
    requeryHandler = null,
    acknowledgeOnMissingReference = false,
    suppressErrorResponse = false,
  } = {}
) {
  const normalizedProviderName = String(providerName || 'aidapay')
    .trim()
    .toLowerCase();
  const providerLabel =
    normalizedProviderName === 'directortech' ? 'Directortech' : 'Aidapay';

  try {
    logWebhookIngress(normalizedProviderName, req, {
      signatureVerification: Boolean(verifySignature),
    });

    if (
      verifySignature &&
      !verifyWebhookSignature({
        req,
        secret: signatureSecret,
      })
    ) {
      return res.status(403).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    const incomingReference = extractProviderTransactionReference(req.body);
    if (!incomingReference) {
      if (acknowledgeOnMissingReference) {
        return res.json(buildWebhookAcknowledgementPayload(normalizedProviderName));
      }

      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const idempotencyState = await beginPurchaseIdempotency({
      providerName: normalizedProviderName,
      eventType: 'webhook.data',
      idempotencyKey: incomingReference,
      reference: incomingReference,
      providerEventId: incomingReference,
    });

    if (idempotencyState.invalid) {
      return res.status(400).json({
        success: false,
        message: idempotencyState.reason || 'Invalid webhook idempotency key',
      });
    }

    if (idempotencyState.replay) {
      return res.json(
        idempotencyState.reservation?.responseBody ||
          resolveReplayResponseBody(
            idempotencyState.reservation,
            'Webhook already acknowledged'
          )
      );
    }

    if (idempotencyState.conflict) {
      return res.json({
        success: true,
        acknowledged: true,
        provider: normalizedProviderName,
        reference: incomingReference,
        message: `${providerLabel} webhook is already being processed`,
      });
    }

    const reservationId = idempotencyState.reservation?._id || null;

    let providerData = req.body || {};
    if (typeof requeryHandler === 'function') {
      try {
        const requeryData = await requeryHandler(incomingReference, req.body);
        if (requeryData && typeof requeryData === 'object') {
          providerData = requeryData;
        }
      } catch (lookupError) {
        console.warn(
          `[purchaseRouter] ${providerLabel} webhook requery failed:`,
          lookupError?.response?.data || lookupError?.message || lookupError
        );
      }
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const reconciliation = await reconcileDataPurchaseTransaction({
        req,
        session,
        providerName: normalizedProviderName,
        providerData,
        transactionReference: incomingReference,
      });

      if (!reconciliation.found) {
        await session.commitTransaction();
        const responseBody = {
          success: true,
          acknowledged: true,
          provider: normalizedProviderName,
          reference: incomingReference,
          message: `${providerLabel} transaction not found`,
        };

        await finalizePurchaseIdempotency(reservationId, responseBody);
        return res.json(responseBody);
      }

      const transaction = reconciliation.transaction;
      const providerStatus = reconciliation.providerStatus;
      const resolvedTransactionStatus = normalizeProviderTransactionStatus(
        transaction.status
      );
      const providerTransactionData = getProviderTransactionData(providerData);
      const providerAmountPaid = getProviderAmountPaid(
        providerData,
        transaction.amount
      );
      const providerCommission = getProviderCommission(
        providerData,
        transaction?.pricing?.commission || 0
      );
      const walletUpdateShouldEmit = Boolean(reconciliation.walletMovement);

      await session.commitTransaction();

      let user = null;
      try {
        user = await User.findById(transaction.userId).lean();
      } catch (lookupError) {
        console.warn(
          `[purchaseRouter] ${providerLabel} webhook user lookup failed:`,
          lookupError?.message || lookupError
        );
      }

      const responseMessage =
        resolvedTransactionStatus === 'success'
          ? `${providerLabel} transaction confirmed successfully`
          : resolvedTransactionStatus === 'failed' &&
            providerStatus === 'refund'
          ? `${providerLabel} transaction refunded`
          : resolvedTransactionStatus === 'failed'
          ? `${providerLabel} transaction failed`
          : `${providerLabel} transaction processing`;

      if (user?.emailAddress) {
        const title =
          resolvedTransactionStatus === 'success'
            ? 'Data purchase successful'
            : resolvedTransactionStatus === 'failed' &&
              providerStatus === 'refund'
            ? 'Data purchase refunded'
            : resolvedTransactionStatus === 'failed'
            ? 'Data purchase failed'
            : 'Data purchase processing';

        const message =
          resolvedTransactionStatus === 'success'
            ? `${
                transaction.package_name || transaction.package_code
              } for ${transaction.recipientPhone} has been delivered successfully.`
            : resolvedTransactionStatus === 'failed' &&
              providerStatus === 'refund'
            ? `${
                transaction.package_name || transaction.package_code
              } for ${transaction.recipientPhone} was refunded by the provider.`
            : resolvedTransactionStatus === 'failed'
            ? `${
                transaction.package_name || transaction.package_code
              } for ${transaction.recipientPhone} failed on the provider side.`
            : `${
                transaction.package_name || transaction.package_code
              } for ${transaction.recipientPhone} is processing.`;

        try {
          await createUserNotification(req, {
            userId: transaction.userId,
            emailAddress: user.emailAddress,
          category: 'transaction',
          title,
          message,
          actionUrl: '/transactions',
          priority:
            resolvedTransactionStatus === 'success' ||
            resolvedTransactionStatus === 'processing'
              ? 'normal'
              : 'high',
          meta: {
            transactionId: transaction._id.toString(),
            transactionType: 'data',
            amount: transaction.amount,
              reference: transaction.reference,
              providerStatus,
            },
          });
        } catch (notificationError) {
          console.warn(
            `[purchaseRouter] ${providerLabel} webhook notification failed:`,
            notificationError?.message || notificationError
          );
        }
      }

      emitAdminPurchaseEvents(req, {
        type: 'data',
        transaction,
        amountCharged: transaction.amount,
        providerAmountPaid,
        recipient: transaction.recipientPhone,
        provider: transaction.provider_code,
        packageCode: transaction.package_code,
        userId: transaction.userId?.toString?.() || '',
        reference: transaction.reference,
        status: resolvedTransactionStatus,
        walletUpdateDirection:
          reconciliation.walletMovement?.delta > 0 ? 'credit' : 'debit',
        walletUpdateSource: `${normalizedProviderName}-webhook`,
        emitWalletUpdate: walletUpdateShouldEmit,
      });

      emitCustomerPurchaseEvents(req, {
        type: 'data',
        transaction,
        amountCharged: transaction.amount,
        providerAmountPaid,
        recipient: transaction.recipientPhone,
        provider: transaction.provider_code,
        packageCode: transaction.package_code,
        userId: transaction.userId?.toString?.() || '',
        emailAddress: user?.emailAddress || '',
        reference: transaction.reference,
        status: resolvedTransactionStatus,
        providerStatus,
        walletUpdateDirection:
          reconciliation.walletMovement?.delta > 0 ? 'credit' : 'debit',
        walletUpdateSource: `${normalizedProviderName}-webhook`,
        emitWalletUpdate: walletUpdateShouldEmit,
        newBalance:
          reconciliation.walletMovement?.nextBalance != null
            ? reconciliation.walletMovement.nextBalance.toFixed(2)
            : null,
      });

      const responseBody = {
        success: true,
        provider: normalizedProviderName,
        status: resolvedTransactionStatus,
        reference: transaction.reference,
        transactionId: transaction._id?.toString?.(),
        providerResponse: providerData,
        providerTransactionData,
        providerCommission: toMoneyNumber(providerCommission, 0),
        message: responseMessage,
      };

      await finalizePurchaseIdempotency(reservationId, responseBody, transaction._id);
      return res.json(responseBody);
    } catch (error) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        reservationId,
        error,
        {
          success: false,
          acknowledged: false,
          provider: normalizedProviderName,
          reference: incomingReference,
          message: `${providerLabel} webhook processing failed`,
        }
      );
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error(
      `[purchaseRouter] ${providerLabel} webhook failed:`,
      buildErrorLogPayload(error)
    );

    if (suppressErrorResponse) {
      return res.json(buildWebhookAcknowledgementPayload(normalizedProviderName));
    }

    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(
          error,
          `Unable to process ${providerLabel} webhook`
        )
      );
  }
}

function getCustomerSocketRooms({ userId = '', emailAddress = '' } = {}) {
  const rooms = [];
  const normalizedUserId = String(userId || '').trim();
  const normalizedEmail = String(emailAddress || '').trim().toLowerCase();

  if (normalizedUserId) {
    rooms.push(`user:${normalizedUserId}`);
  }

  if (normalizedEmail) {
    rooms.push(normalizedEmail);
  }

  return [...new Set(rooms)];
}

function emitCustomerPurchaseEvents(
  req,
  {
    type = '',
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
    customerName = '',
    meterType = '',
    walletUpdateDirection = 'debit',
    walletUpdateSource = 'aidapay-wallet',
    emitWalletUpdate = true,
    newBalance = null,
    providerStatus = '',
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
    const resolvedType = String(type || tx.type || '').trim();
    const resolvedTransactionId = tx?._id ? tx._id.toString() : '';
    const resolvedReference = String(reference || tx.reference || '').trim();
    const resolvedUserId = String(userId || tx.userId || '').trim();
    const resolvedEmailAddress = String(
      emailAddress || tx?.metadata?.customerEmail || tx?.emailAddress || ''
    )
      .trim()
      .toLowerCase();
    const rooms = getCustomerSocketRooms({
      userId: resolvedUserId,
      emailAddress: resolvedEmailAddress,
    });

    if (!rooms.length) {
      return;
    }

    const normalizedNewBalance = toMoneyNumber(newBalance, NaN);
    const hasWalletUpdate = Number.isFinite(normalizedNewBalance);
    const transactionPayload = {
      type: resolvedType,
      transactionType: resolvedType,
      transactionId: resolvedTransactionId,
      reference: resolvedReference,
      providerReference: String(
        tx?.metadata?.providerReference ||
          tx?.metadata?.providerTransactionReference ||
          tx?.metadata?.providerTransactionHash ||
          tx?.providerResponse?.providerReference ||
          tx?.providerResponse?.providerTransactionHash ||
          resolvedReference
      ).trim(),
      providerTransactionHash: String(
        tx?.metadata?.providerTransactionHash ||
          tx?.metadata?.providerTransactionReference ||
          tx?.providerResponse?.providerTransactionHash ||
          tx?.providerResponse?.providerReference ||
          resolvedReference
      ).trim(),
      amount: normalizedAmountCharged,
      providerAmountPaid: normalizedProviderDebit,
      recipient,
      provider,
      package: packageCode,
      status,
      providerStatus,
      userId: resolvedUserId,
      profit: calculateTransactionProfit(normalizedPricing),
      timestamp: txTimestamp,
      pricing: normalizedPricing,
      description: tx.description || '',
      purchaseMode: String(tx?.metadata?.purchaseMode || '').trim(),
      providerSource: String(tx?.metadata?.providerSource || '').trim(),
      ...(customerName ? { customerName } : {}),
      ...(meterType ? { meterType } : {}),
      ...(hasWalletUpdate ? { newBalance: normalizedNewBalance.toFixed(2) } : {}),
    };

    const walletPayload = {
      userId: resolvedUserId,
      event:
        walletUpdateDirection === 'credit'
          ? 'credit_received'
          : 'purchase_debited',
      amount: normalizedProviderDebit,
      direction: walletUpdateDirection,
      source: walletUpdateSource,
      reference: resolvedReference,
      transactionId: resolvedTransactionId,
      timestamp: txTimestamp,
      status,
      ...(hasWalletUpdate ? { newBalance: normalizedNewBalance.toFixed(2) } : {}),
    };

    for (const room of rooms) {
      io.to(room).emit('new-transaction', transactionPayload);

      if (emitWalletUpdate && hasWalletUpdate) {
        io.to(room).emit('wallet:updated', walletPayload);
      }
    }
  } catch (error) {
    console.error('[purchaseRouter] Failed to emit customer purchase events:', {
      type,
      reference: String(reference || transaction?.reference || '').trim(),
      message: error?.message || String(error),
    });
  }
}

router.post('/webhooks/aidapay', async (req, res) => {
  logWebhookIngress('aidapay', req, {
    webhookEnabled: AIDAPAY_WEBHOOK_ENABLED,
  });

  if (!AIDAPAY_WEBHOOK_ENABLED) {
    console.info(
      '[purchaseRouter] Aidapay webhook received while disabled; acknowledging without processing.'
    );
    return res.json(buildWebhookAcknowledgementPayload('aidapay'));
  }

  return handleDataPurchaseWebhook(req, res, {
    providerName: 'aidapay',
    verifySignature: true,
    signatureSecret: AIDAPAY_WEBHOOK_SECRET,
    requeryHandler: async (reference) => requestAidapayRequery(reference),
  });
});

router.post('/webhooks/directortech', async (req, res) => {
  return handleDataPurchaseWebhook(req, res, {
    providerName: 'directortech',
    requeryHandler: async (reference) => requestDirectortechTransaction(reference),
    acknowledgeOnMissingReference: true,
    suppressErrorResponse: true,
  });
});

router.get('/catalog/directortech/transaction/:reference', async (req, res) => {
  try {
    const reference = String(req.params.reference || '').trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const providerData = await requestDirectortechTransaction(reference);
    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(
          error,
          'Unable to fetch Directortech transaction details'
        )
      );
  }
});

router.post('/catalog/directortech/requery', async (req, res) => {
  try {
    const reference = String(req.body?.reference || '').trim();
    const explicitProviderReference = String(
      req.body?.providerReference ||
        req.body?.provider_reference ||
        req.body?.providerTransactionHash ||
        req.body?.provider_transaction_hash ||
        req.body?.providerTid ||
        req.body?.provider_tid ||
        req.body?.transactionId ||
        req.body?.transaction_id ||
        ''
    ).trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'reference is required',
      });
    }

    const {
      transaction,
      providerLookupReference,
      transactionType,
    } = await resolveTransactionRequeryContext(reference, 'directortech');
    const lookupReference =
      explicitProviderReference || providerLookupReference || reference;

    console.info('[purchaseRouter] Directortech requery request payload', {
      reference,
      lookupReference,
      method: req.method,
      url: req.originalUrl,
      providerReference: explicitProviderReference,
      providerSource: String(
        req.body?.providerSource ||
          req.body?.provider_source ||
          req.body?.provider ||
          ''
      )
        .trim()
        .toLowerCase(),
      bodyKeys: Object.keys(req.body || {}),
      transactionId: transaction?._id?.toString?.() || null,
      transactionType,
    });

    const providerData = await requestDirectortechTransaction(lookupReference);
    console.info('[purchaseRouter] Directortech requery response payload', providerData);
    return res.json(providerData);
  } catch (error) {
    return res
      .status(error.response?.status || 500)
      .json(
        buildAidapayErrorResponse(error, 'Unable to requery Directortech transaction')
      );
  }
});

router.get('/validate-tv', authMiddleware, async (req, res) => {
  try {
    const providerCode = String(req.query.provider_code || '').trim();
    const smartCardNumber = String(req.query.smart_card_number || '').trim();

    if (!providerCode || !smartCardNumber) {
      return res.status(400).json({
        success: false,
        message: 'provider_code and smart_card_number are required',
      });
    }

    const payload = await requestAidapayValidationPayload(
      providerCode,
      smartCardNumber,
      {
        fallbackName: 'TV Customer',
        successLabel: 'Smart card',
      }
    );

    if (!payload.success || payload.verified === false) {
      return res.status(400).json(payload);
    }

    return res.json(payload);
  } catch (error) {
    console.error(
      'TV validation failed:',
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Unable to verify smart card',
    });
  }
});

router.get('/validate-electricity', authMiddleware, async (req, res) => {
  try {
    const providerCode = String(req.query.provider_code || '').trim();
    const meterNumber = String(req.query.meter_number || '').trim();

    if (!providerCode || !meterNumber) {
      return res.status(400).json({
        success: false,
        message: 'provider_code and meter_number are required',
      });
    }

    const payload = await requestAidapayValidationPayload(providerCode, meterNumber, {
      fallbackName: 'Electricity Customer',
      successLabel: 'Meter',
    });

    if (!payload.success || payload.verified === false) {
      return res.status(400).json(payload);
    }

    return res.json(payload);
  } catch (error) {
    console.error(
      'Electricity validation failed:',
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Unable to verify meter',
    });
  }
});

router.post('/purchase-data', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let purchaseIdempotencyReservationId = null;
  let purchaseIdempotencyProviderName = 'aidapay';
  let purchaseIdempotencyKey = '';

  try {
    const {
      phone_number,
      provider_code,
      package_code,
      reference,
      package_name,
      transactionPin,
    } = req.body;

    const resolvedProviderCode = resolveDataPurchaseProviderCode(
      provider_code,
      package_code
    );

    if (!phone_number || !package_code || !reference || !resolvedProviderCode) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields (phone_number, package_code, reference, provider_code)',
      });
    }

    const user = req.userFull;
    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    let packageInfo = getDataPlanPricingMeta(package_code);
    if (!packageInfo) {
      await refreshMergedDataDetailsSnapshot();
      packageInfo = getDataPlanPricingMeta(package_code);
    }

    if (!packageInfo) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package code',
      });
    }

    const userPaidAmount = toMoneyNumber(
      packageInfo.sellingPrice ?? packageInfo.originalPrice,
      NaN
    );
    if (!Number.isFinite(userPaidAmount) || userPaidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package pricing',
      });
    }

    // Load user inside transaction session
    let updatedUser = await loadUserForPurchase(user._id, session);
    if (!updatedUser) {
      throw new Error('User not found');
    }

    purchaseIdempotencyProviderName = String(
      packageInfo?.source || 'aidapay'
    )
      .trim()
      .toLowerCase() || 'aidapay';
    purchaseIdempotencyKey = getRequestIdempotencyKey(req, reference);
    const purchaseIdempotencyState = await beginPurchaseIdempotency({
      providerName: purchaseIdempotencyProviderName,
      eventType: 'purchase.data',
      idempotencyKey: purchaseIdempotencyKey,
      reference,
      providerEventId: reference,
    });

    if (purchaseIdempotencyState.invalid) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          purchaseIdempotencyState.reason || 'Missing purchase idempotency key',
      });
    }

    if (purchaseIdempotencyState.replay) {
      await session.abortTransaction();
      return res.json(
        purchaseIdempotencyState.reservation?.responseBody ||
          resolveReplayResponseBody(
            purchaseIdempotencyState.reservation,
            'Purchase already processed'
          )
      );
    }

    if (purchaseIdempotencyState.conflict) {
      await session.abortTransaction();
      return res.status(202).json({
        success: true,
        status: 'processing',
        message: 'This purchase is already being processed.',
        reference,
      });
    }

    purchaseIdempotencyReservationId =
      purchaseIdempotencyState.reservation?._id || null;

    const pinValidation = await validateTransactionPin(
      updatedUser,
      transactionPin
    );
    if (!pinValidation.success) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        purchaseIdempotencyReservationId,
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

    // Ensure wallet subdocument exists
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
      return res.status(400).json(insufficientPayload);
    }

    const packageOriginalAmount = toMoneyNumber(
      packageInfo?.package_original_amount ?? userPaidAmount,
      userPaidAmount
    );
    const planCommission = toMoneyNumber(packageInfo?.commission, 0);
    const providerDiscount = toMoneyNumber(packageInfo?.gain ?? 0, 0);
    const providerLabel = String(
      packageInfo?.provider_name ||
        packageInfo?.provider_code ||
        resolvedProviderCode ||
      ''
    ).toUpperCase();

    const validationPayload = await verifyAidapayRecipientForPurchase(
      resolvedProviderCode,
      phone_number,
      {
        fallbackName: providerLabel || 'Customer',
        successLabel: 'Account',
      }
    );

    if (!validationPayload.success || validationPayload.verified === false) {
      await session.abortTransaction();
      return res.status(400).json(validationPayload);
    }

    let providerData;

    if (String(packageInfo?.source || '').trim().toLowerCase() === 'directortech') {
      const directortechNetworkId = resolveDirectortechPurchaseNetworkId(
        packageInfo,
        resolvedProviderCode
      );

      if (!Number.isFinite(Number(directortechNetworkId)) || Number(directortechNetworkId) <= 0) {
        throw new Error(
          `Unable to resolve Directortech network for package ${package_code}`
        );
      }

      const directortechPurchaseRequest = {
        networkId: directortechNetworkId,
        planId:
          packageInfo?.directortech_plan_id ||
          packageInfo?.package_api_code ||
          package_code,
        mobileNumber: phone_number,
        portedNumber: Boolean(
          req.body?.Ported_number ?? req.body?.ported_number ?? false
        ),
      };

      console.info('[purchaseRouter] Directortech data purchase request payload', {
        reference,
        providerCode: resolvedProviderCode,
        packageCode: package_code,
        networkId: directortechPurchaseRequest.networkId,
        planId: directortechPurchaseRequest.planId,
        mobileNumber: directortechPurchaseRequest.mobileNumber,
        portedNumber: directortechPurchaseRequest.portedNumber,
      });

      try {
        providerData = await requestDirectortechDataPurchase(
          directortechPurchaseRequest,
          {
            reference,
            recipient: phone_number,
            amount: userPaidAmount,
            amountPaid: packageOriginalAmount,
            commission: planCommission,
            discount: providerDiscount,
            status: 'Processing',
            message: `Transaction Sent For Processing . N${packageOriginalAmount} ${providerLabel} Beneficiary : ${phone_number}`,
          }
        );
      } catch (error) {
        if (
          directortechPurchaseRequest.portedNumber === false &&
          shouldRetryDirectortechWithPortedNumber(error)
        ) {
          console.warn(
            '[purchaseRouter] Retrying Directortech data purchase with ported number enabled',
            {
              reference,
              providerCode: resolvedProviderCode,
              packageCode: package_code,
              mobileNumber: phone_number,
            }
          );

          providerData = await requestDirectortechDataPurchase(
            {
              ...directortechPurchaseRequest,
              portedNumber: true,
            },
            {
              reference,
              recipient: phone_number,
              amount: userPaidAmount,
              amountPaid: packageOriginalAmount,
              commission: planCommission,
              discount: providerDiscount,
              status: 'Processing',
              message: `Transaction Sent For Processing . N${packageOriginalAmount} ${providerLabel} Beneficiary : ${phone_number}`,
            }
          );
        } else {
          throw error;
        }
      }

      providerData = await resolveDirectortechPurchaseSnapshot(
        providerData,
        extractProviderTransactionReference(providerData) || reference
      );
    } else {
      // -------------------------------------------------------------
      // AIDAPAY API CALL
      // -------------------------------------------------------------
      const formData = new FormData();
      formData.append('recipient', phone_number);
      formData.append('provider_code', resolvedProviderCode);
      formData.append('package_code', package_code);
      formData.append('account_pin', aidapayPin);
      formData.append('ref', reference);

      providerData = await requestAidapayPurchase(
        formData,
        samplePurchase?.data,
        {
          reference,
          recipient: phone_number,
          amount: userPaidAmount,
          amountPaid: packageOriginalAmount,
          commission: planCommission,
          discount: providerDiscount,
          status: 'Processing',
          message: `Transaction Sent For Processing . N${packageOriginalAmount} ${providerLabel} Beneficiary : ${phone_number}`,
        }
      );
    }
    const providerTransactionData = getProviderTransactionData(providerData);
    const providerTransactionStatus = getProviderTransactionStatus(providerData);
    const isProcessingPurchase = providerTransactionStatus !== 'success';
    const providerAmountPaid = getProviderAmountPaid(providerData, userPaidAmount);
    const providerCommission = getProviderCommission(
      providerData,
      planCommission
    );
    const providerReference =
      extractProviderTransactionReference(providerData) || reference;
    const persistedReference = resolvePersistedPurchaseReference(
      purchaseIdempotencyProviderName,
      providerReference,
      reference
    );

    // console.log(providerData)

    const internalTx = new Transaction({
      type: 'data',
      userId: user._id,
      recipientPhone: phone_number,
      provider_code: resolvedProviderCode,
      package_code,
      package_name,
      amount: userPaidAmount,
      reference: persistedReference,
      description: `Data bundle - ${package_name} (${phone_number})`,
      status: isProcessingPurchase ? 'processing' : 'success',
      pricing: packageInfo,
        metadata: {
          providerSource: purchaseIdempotencyProviderName,
          providerStatus: providerTransactionStatus,
          walletDebitApplied: true,
          walletDebitAmount: userPaidAmount,
          ...(isProcessingPurchase
            ? {
                autoRequeryScheduledAt: new Date(),
                autoRequeryDueAt: new Date(
                  Date.now() + PURCHASE_AUTO_REQUERY_TIMEOUT_MS
                ),
                autoRequeryAttempts: 0,
              }
            : {}),
          purchaseMode:
            purchaseIdempotencyProviderName === 'directortech'
              ? 'directortech'
              : 'aidapay',
          appReference: reference,
        providerReference,
        providerTransactionReference: providerReference,
        providerTransactionHash: providerReference,
        purchaseIdempotencyKey,
      },
    });

    await internalTx.save({ session });

    if (!providerData?.success || !providerData?.data?.success) {
      internalTx.status = 'failed';
      internalTx.failureReason = providerData?.message || 'Provider rejected';
      await internalTx.save({ session });
      logPurchaseTransactionObject(
        'Data purchase transaction object:',
        internalTx
      );
      const providerRejectionError = new Error('Provider rejected the transaction');
      providerRejectionError.providerResponse = providerData;
      providerRejectionError.providerCode = resolvedProviderCode;
      providerRejectionError.packageCode = package_code;
      providerRejectionError.reference = persistedReference;
      providerRejectionError.transactionId = internalTx._id?.toString?.();
      throw providerRejectionError;
    }

    const debitAmount = -userPaidAmount;
    const newBalanceNum = currentBalance + debitAmount;
    const newBalanceDec = mongoose.Types.Decimal128.fromString(
      newBalanceNum.toFixed(2)
    );

    // const walletTx = {
    //   type: 'debit',
    //   amount: debitAmount,
    //   description: `Data bundle - ${package_name} (${phone_number})`,
    //   reference,
    //   status: 'successful',
    //   source: 'data_purchase',
    //   createdAt: new Date()
    // };

    // Atomic update of balance + transaction log
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
    internalTx.providerResponse = {
      ...(providerData || {}),
      providerReference,
      providerTransactionHash: providerReference,
      accounting: {
        providerCommission: toMoneyNumber(providerCommission, 0),
      },
      providerStatus: providerTransactionStatus,
      providerTransactionData,
    };
    internalTx.status = isProcessingPurchase ? 'processing' : 'success';
    if (!isProcessingPurchase) {
      internalTx.completedAt = new Date();
    }
    await internalTx.save({ session });

    await session.commitTransaction();

    const customerName =
      String(user?.fullName || user?.name || user?.username || user?.emailAddress || '')
        .trim() || 'Customer';

    const responseBody = {
      success: true,
      status: isProcessingPurchase ? 'processing' : 'success',
      message: isProcessingPurchase
        ? 'Data purchase is processing'
        : 'Data purchase completed successfully',
      newBalance: newBalanceNum.toFixed(2),
      transactionId: internalTx._id.toString(),
      reference: persistedReference,
    };

    try {
      if (isProcessingPurchase) {
        schedulePurchaseAutoRequery(persistedReference, {
          providerSource: purchaseIdempotencyProviderName,
          delayMs: PURCHASE_AUTO_REQUERY_TIMEOUT_MS,
          trigger: 'purchase',
        });
      }

      logPurchaseTransactionObject('Data purchase transaction object:', internalTx);

      logStructuredPayload(
        isProcessingPurchase
          ? 'Data purchase processing:'
          : 'Data purchase success:',
        buildPurchaseSuccessLogPayload({
          type: 'data',
          providerCode: resolvedProviderCode,
          packageCode: package_code,
          packageName: package_name,
          reference: persistedReference,
          recipient: phone_number,
          amountCharged: userPaidAmount,
          providerAmountPaid,
          providerCommission: toMoneyNumber(providerCommission, 0),
          newBalance: newBalanceNum.toFixed(2),
          userId: user._id?.toString?.(),
          transactionId: internalTx._id?.toString?.(),
          providerResponse: providerData,
        })
      );

      emitAdminPurchaseEvents(req, {
        type: 'data',
        transaction: internalTx,
        amountCharged: userPaidAmount,
        providerAmountPaid,
        recipient: phone_number,
        provider: provider_code,
        packageCode: package_code,
        userId: user._id.toString(),
        reference: persistedReference,
        status: isProcessingPurchase ? 'processing' : 'success',
        walletUpdateSource: String(packageInfo?.source || 'aidapay')
          .trim()
          .toLowerCase(),
      });

      emitCustomerPurchaseEvents(req, {
        type: 'data',
        transaction: internalTx,
        amountCharged: userPaidAmount,
        providerAmountPaid,
        recipient: phone_number,
        provider: provider_code,
        packageCode: package_code,
        userId: user._id.toString(),
        emailAddress: user.emailAddress,
        reference: persistedReference,
        status: isProcessingPurchase ? 'processing' : 'success',
        providerStatus: providerTransactionStatus,
        walletUpdateDirection: 'debit',
        walletUpdateSource: String(packageInfo?.source || 'aidapay')
          .trim()
          .toLowerCase(),
        newBalance: newBalanceNum.toFixed(2),
        customerName,
      });

      await createUserNotification(req, {
        userId: user._id,
        emailAddress: user.emailAddress,
        category: 'transaction',
        title: isProcessingPurchase
          ? 'Data purchase processing'
          : 'Data purchase successful',
        message: isProcessingPurchase
          ? `${
              package_name || package_code
            } for ${phone_number} is processing. We will notify you once it completes.`
          : `${
              package_name || package_code
            } for ${phone_number} has been delivered successfully.`,
        actionUrl: '/transactions',
        priority: isProcessingPurchase ? 'normal' : 'normal',
        meta: {
          transactionId: internalTx._id.toString(),
          transactionType: 'data',
          amount: userPaidAmount,
          reference: persistedReference,
          providerStatus: providerTransactionStatus,
        },
      });

      await finalizePurchaseIdempotency(
        purchaseIdempotencyReservationId,
        responseBody,
        internalTx._id
      );
    } catch (postCommitError) {
      console.warn('[purchaseRouter] Data purchase post-commit side effect failed', {
        message: postCommitError?.message || 'Unknown post-commit error',
        stack: postCommitError?.stack,
      });
    }

    return res.json(responseBody);
  } catch (error) {
    logStructuredPayload('Data purchase failed:', buildErrorLogPayload(error));

    if (isProviderInsufficientBalanceError(error)) {
      console.warn('[purchaseRouter] Provider insufficient balance normalized to generic failure', {
        provider: purchaseIdempotencyProviderName,
        message: extractDirectortechErrorMessage(error),
      });

      await failPurchaseIdempotency(
        purchaseIdempotencyReservationId,
        error,
        buildFriendlyPurchaseFailurePayload()
      );
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return res.status(503).json(buildFriendlyPurchaseFailurePayload());
    }

    const directortechFailureMessage =
      purchaseIdempotencyProviderName === 'directortech'
        ? extractDirectortechErrorMessage(error)
        : '';

    if (directortechFailureMessage && Number(error?.response?.status) === 400) {
      const directortechFailurePayload = {
        success: false,
        message: directortechFailureMessage,
      };

      await failPurchaseIdempotency(
        purchaseIdempotencyReservationId,
        error,
        directortechFailurePayload
      );
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return res.status(400).json(directortechFailurePayload);
    }

    await failPurchaseIdempotency(
      purchaseIdempotencyReservationId,
      error,
      buildFriendlyPurchaseFailurePayload()
    );
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    return res.status(503).json(buildFriendlyPurchaseFailurePayload());
  } finally {
    session.endSession();
  }
});

// -------------------------------------------------------------
// AIRTIME PURCHASE
// -------------------------------------------------------------
router.post('/purchase-airtime', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let purchaseIdempotencyReservationId = null;
  let purchaseIdempotencyProviderName = 'aidapay';
  let purchaseIdempotencyKey = '';

  try {
    const { phone_number, provider_code, amount, reference, transactionPin } =
      req.body;

    if (!phone_number || !provider_code || !amount) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields (phone_number, provider_code, amount)',
      });
    }

    const user = req.userFull;
    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const faceValue = toMoneyNumber(amount, NaN);
    if (!Number.isFinite(faceValue) || faceValue <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than zero',
      });
    }

    const { min: airtimeMinAmount, max: airtimeMaxAmount } =
      getAirtimeLimits(provider_code);

    if (faceValue < airtimeMinAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum airtime amount is NGN ${airtimeMinAmount}`,
      });
    }

    if (faceValue > airtimeMaxAmount) {
      return res.status(400).json({
        success: false,
        message: `Maximum airtime amount is NGN ${airtimeMaxAmount}`,
      });
    }

    const commissionPercent = getAirtimeCommissionPercent(provider_code);
    const fullCommissionAmount = toMoneyNumber(
      (faceValue * commissionPercent) / 100,
      0
    );
    const userPaidAmount = toMoneyNumber(faceValue, NaN);
    if (!Number.isFinite(userPaidAmount) || userPaidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid airtime amount',
      });
    }

    let updatedUser = await loadUserForPurchase(user._id, session);
    if (!updatedUser) {
      throw new Error('User not found');
    }

    const txReference =
      reference ||
      `AIR-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`;

    purchaseIdempotencyProviderName = useDirectortechAirtime
      ? 'directortech'
      : 'aidapay';
    purchaseIdempotencyKey = getRequestIdempotencyKey(req, txReference);
    const purchaseIdempotencyState = await beginPurchaseIdempotency({
      providerName: purchaseIdempotencyProviderName,
      eventType: 'purchase.airtime',
      idempotencyKey: purchaseIdempotencyKey,
      reference: txReference,
      providerEventId: txReference,
    });

    if (purchaseIdempotencyState.invalid) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          purchaseIdempotencyState.reason || 'Missing purchase idempotency key',
      });
    }

    if (purchaseIdempotencyState.replay) {
      await session.abortTransaction();
      return res.json(
        purchaseIdempotencyState.reservation?.responseBody ||
          resolveReplayResponseBody(
            purchaseIdempotencyState.reservation,
            'Purchase already processed'
          )
      );
    }

    if (purchaseIdempotencyState.conflict) {
      await session.abortTransaction();
      return res.status(202).json({
        success: true,
        status: 'processing',
        message: 'This purchase is already being processed.',
        reference: txReference,
      });
    }

    purchaseIdempotencyReservationId =
      purchaseIdempotencyState.reservation?._id || null;

    const pinValidation = await validateTransactionPin(
      updatedUser,
      transactionPin
    );
    if (!pinValidation.success) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        purchaseIdempotencyReservationId,
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
        purchaseIdempotencyReservationId,
        new Error(insufficientPayload.message),
        insufficientPayload
      );
      return res.status(400).json(insufficientPayload);
    }

    const validationPayload = await verifyAidapayRecipientForPurchase(
      provider_code,
      phone_number,
      {
        fallbackName: 'Customer',
        successLabel: 'Account',
      }
    );

    if (!validationPayload.success || validationPayload.verified === false) {
      await session.abortTransaction();
      await failPurchaseIdempotency(
        purchaseIdempotencyReservationId,
        new Error(validationPayload.message || 'Phone validation failed'),
        validationPayload
      );
      return res.status(400).json(validationPayload);
    }

    let providerData;

    if (useDirectortechAirtime) {
      const directortechNetworkMeta = getDirectortechNetworkMeta(provider_code);

      if (!directortechNetworkMeta) {
        await session.abortTransaction();
        await failPurchaseIdempotency(
          purchaseIdempotencyReservationId,
          new Error('Unable to resolve Directortech network for airtime purchase'),
          {
            success: false,
            message: 'Unable to resolve Directortech network for airtime purchase',
          }
        );

        return res.status(400).json({
          success: false,
          message: 'Unable to resolve Directortech network for airtime purchase',
        });
      }

      providerData = await requestDirectortechAirtimePurchase(
        {
          networkId: directortechNetworkMeta.network_id,
          mobileNumber: phone_number,
          amount: faceValue,
          portedNumber:
            req.body?.Ported_number ?? req.body?.ported_number ?? false,
          airtimeType:
            req.body?.airtime_type ?? req.body?.airtimeType ?? 'VTU',
        },
        {
          reference: txReference,
          recipient: phone_number,
          amount: faceValue,
          amountPaid: userPaidAmount,
          commission: fullCommissionAmount,
          discount: 0,
          status: 'Processing',
          planNetwork: directortechNetworkMeta.provider_name,
          providerCode: provider_code,
          message: `Transaction Sent For Processing . N${faceValue} ${provider_code?.toUpperCase()} Beneficiary : ${phone_number}`,
        }
      );

      providerData = await resolveDirectortechPurchaseSnapshot(
        providerData,
        extractProviderTransactionReference(providerData) || txReference
      );
    } else {
      // -------------------------------------------------------------
      // AIDAPAY API CALL
      // -------------------------------------------------------------
      const formData = new FormData();
      formData.append('provider_code', provider_code);
      formData.append('recipient', phone_number);
      formData.append('amount', faceValue.toString());
      formData.append('account_pin', aidapayPin);
      formData.append('ref', txReference);

      providerData = await requestAidapayPurchase(
        formData,
        samplePurchase?.airtime,
        {
          reference: txReference,
          recipient: phone_number,
          amount: faceValue,
          amountPaid: userPaidAmount,
          commission: fullCommissionAmount,
          discount: 0,
          status: 'Processing',
          message: `Transaction Sent For Processing . N${faceValue} ${provider_code?.toUpperCase()} Beneficiary : ${phone_number}`,
        }
      );
    }

    const providerAmountPaid = getProviderAmountPaid(providerData, userPaidAmount);
    const providerCommission = getProviderCommission(
      providerData,
      fullCommissionAmount
    );
    const providerReference =
      extractProviderTransactionReference(providerData) || txReference;
    const persistedReference = resolvePersistedPurchaseReference(
      purchaseIdempotencyProviderName,
      providerReference,
      txReference
    );

    const internalTx = new Transaction({
      type: 'airtime',
      userId: user._id,
      recipientPhone: phone_number,
      provider_code,
      amount: faceValue,
      reference: persistedReference,
      status: 'pending',
      description: `Airtime recharge NGN ${faceValue} -> ${phone_number}`,
      pricing: {
        gain: 0,
        commission: providerCommission,
        fee: 0,
        originalPrice: providerAmountPaid,
      },
      metadata: {
        providerSource: purchaseIdempotencyProviderName,
        purchaseMode: purchaseIdempotencyProviderName,
        providerStatus: providerData?.data?.transaction_data?.status || 'success',
        appReference: txReference,
        providerReference,
        providerTransactionReference: providerReference,
        providerTransactionHash: providerReference,
      },
    });

    await internalTx.save({ session });

    if (!providerData?.success || !providerData?.data?.success) {
      internalTx.status = 'failed';
      internalTx.failureReason = providerData?.message || 'Provider rejected';
      await internalTx.save({ session });
      logPurchaseTransactionObject(
        'Airtime purchase transaction object:',
        internalTx
      );
      throw new Error('Provider rejected the transaction');
    }

    const debitAmount = -userPaidAmount;
    const newBalanceNum = currentBalance + debitAmount;
    const newBalanceDec = mongoose.Types.Decimal128.fromString(
      newBalanceNum.toFixed(2)
    );

    // const walletTx = {
    //   type: 'debit',
    //   amount: debitAmount,
    //   description: `Airtime recharge NGN ${faceValue} -> ${phone_number}`,
    //   reference: txReference,
    //   status: 'successful',
    //   source: 'airtime_purchase',
    //   createdAt: new Date()
    // };

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

    internalTx.status = 'success';
    internalTx.completedAt = new Date();
    await internalTx.save({ session });

    await session.commitTransaction();

    logPurchaseTransactionObject('Airtime purchase transaction object:', internalTx);

    emitAdminPurchaseEvents(req, {
      type: 'airtime',
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid,
      recipient: phone_number,
      provider: provider_code,
      userId: user._id.toString(),
      reference: persistedReference,
      status: 'success',
    });

    emitCustomerPurchaseEvents(req, {
      type: 'airtime',
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid,
      recipient: phone_number,
      provider: provider_code,
      userId: user._id.toString(),
      emailAddress: user.emailAddress,
      reference: persistedReference,
      status: 'success',
      providerStatus: 'success',
      walletUpdateDirection: 'debit',
      walletUpdateSource: `${purchaseIdempotencyProviderName}-airtime`,
      newBalance: newBalanceNum.toFixed(2),
    });

    await createUserNotification(req, {
      userId: user._id,
      emailAddress: user.emailAddress,
      category: 'transaction',
      title: 'Airtime purchase successful',
      message: `Your ${provider_code} recharge for ${phone_number} was completed successfully.`,
      actionUrl: '/transactions',
      priority: 'normal',
      meta: {
        transactionId: internalTx._id.toString(),
        transactionType: 'airtime',
        amount: userPaidAmount,
        reference: persistedReference,
      },
    });

    const responseBody = {
      success: true,
      message: 'Airtime purchase completed successfully',
      newBalance: newBalanceNum.toFixed(2),
      transactionId: internalTx._id.toString(),
      reference: persistedReference,
    };

    await finalizePurchaseIdempotency(
      purchaseIdempotencyReservationId,
      responseBody,
      internalTx._id
    );

    return res.json(responseBody);
  } catch (error) {
    console.error('Airtime purchase failed:', error);
    await failPurchaseIdempotency(
      purchaseIdempotencyReservationId,
      error,
      buildFriendlyPurchaseFailurePayload()
    );
    await session.abortTransaction();
    return res.status(503).json(buildFriendlyPurchaseFailurePayload());
  } finally {
    session.endSession();
  }
});

// -------------------------------------------------------------
// TV SUBSCRIPTION PURCHASE
// -------------------------------------------------------------
router.post('/purchase-tv', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      smart_card_number,
      provider_code,
      package_code,
      package_amount, // New: Price sent from frontend
      customer_info,
      reference,
      transactionPin,
    } = req.body;

    // Validation
    if (!smart_card_number || !provider_code || !package_code) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields (smart_card_number, provider_code, package_code)',
      });
    }

    if (
      !package_amount ||
      isNaN(Number(package_amount)) ||
      Number(package_amount) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Valid package_amount is required',
      });
    }

    const user = req.userFull;
    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userPaidAmount = toMoneyNumber(package_amount, NaN);
    if (!Number.isFinite(userPaidAmount) || userPaidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid package_amount is required',
      });
    }

    // Load user inside transaction session
    let updatedUser = await loadUserForPurchase(user._id, session);
    if (!updatedUser) {
      throw new Error('User not found');
    }

    const pinValidation = await validateTransactionPin(
      updatedUser,
      transactionPin
    );
    if (!pinValidation.success) {
      await session.abortTransaction();
      return res.status(pinValidation.status).json({
        success: false,
        message: pinValidation.message,
      });
    }

    // Ensure wallet subdocument exists
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
      return res.status(400).json(insufficientPayload);
    }

    const txReference =
      reference ||
      `TV-${provider_code}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`;

    // Extract customer name using your helper function
    let customerName = 'Unknown Customer';
    if (customer_info?.message) {
      customerName =
        getDerivedCustomerNameFromMessage(customer_info.message) ||
        'Unknown Customer';
    } else if (customer_info?.customer_name) {
      customerName = customer_info.customer_name;
    }

    // -------------------------------------------------------------
    // AIDAPAY API CALL
    // -------------------------------------------------------------
    const formData = new FormData();
    formData.append('recipient', smart_card_number);
    formData.append('provider_code', provider_code);
    formData.append('package_code', package_code);
    formData.append('account_pin', aidapayPin);
    formData.append('ref', txReference);

    const providerData = await requestAidapayPurchase(formData, samplePurchase?.tv, {
      reference: txReference,
      recipient: smart_card_number,
      amount: userPaidAmount,
      amountPaid: userPaidAmount,
      commission: 0,
      discount: 0,
      status: 'processing',
      message: `Transaction Sent For Processing . ${provider_code?.toUpperCase()} Beneficiary : ${smart_card_number}`,
    });
    const providerAmountPaid = getProviderAmountPaid(providerData, userPaidAmount);
    const providerCommission = getProviderCommission(providerData, 0);

    const internalTx = new Transaction({
      type: `tv-${provider_code}`,
      userId: user._id,
      recipientSmartCardNumber: smart_card_number,
      provider_code,
      package_code,
      amount: userPaidAmount,
      reference: txReference,
      description: `TV Subscription - ${provider_code} for ${customerName} (${smart_card_number})`,
      status: 'pending',
      pricing: {
        originalPrice: providerAmountPaid,
        fee: 0, // fallback
        gain: 0,
        commission: providerCommission,
      },
      metadata: {
        customer_info,
        customer_name: customerName,
      },
    });

    await internalTx.save({ session });

    if (!providerData?.success || !providerData?.data?.success) {
      internalTx.status = 'failed';
      internalTx.failureReason =
        providerData?.message || 'Provider rejected the TV subscription';
      await internalTx.save({ session });
      logPurchaseTransactionObject('TV purchase transaction object:', internalTx);
      throw new Error('Provider rejected the transaction');
    }

    // Debit wallet
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

    // Save beneficiaries
    await saveTvBeneficiary(
      user,
      smart_card_number,
      customerName,
      provider_code,
      session
    );

    internalTx.status = 'success';
    internalTx.completedAt = new Date();
    await internalTx.save({ session });

    await session.commitTransaction();

    logPurchaseTransactionObject('TV purchase transaction object:', internalTx);

    emitAdminPurchaseEvents(req, {
      type: `tv-${provider_code}`,
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid,
      recipient: smart_card_number,
      provider: provider_code,
      packageCode: package_code,
      userId: user._id.toString(),
      reference: txReference,
      status: 'success',
      customerName,
    });

    emitCustomerPurchaseEvents(req, {
      type: `tv-${provider_code}`,
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid,
      recipient: smart_card_number,
      provider: provider_code,
      packageCode: package_code,
      userId: user._id.toString(),
      emailAddress: user.emailAddress,
      reference: txReference,
      status: 'success',
      providerStatus: 'success',
      walletUpdateDirection: 'debit',
      walletUpdateSource: 'aidapay-tv',
      newBalance: newBalanceNum.toFixed(2),
      customerName,
    });

    await createUserNotification(req, {
      userId: user._id,
      emailAddress: user.emailAddress,
      category: 'transaction',
      title: 'TV subscription successful',
      message: `${provider_code} subscription for ${customerName} is now active.`,
      actionUrl: '/transactions',
      priority: 'normal',
      meta: {
        transactionId: internalTx._id.toString(),
        transactionType: `tv-${provider_code}`,
        amount: userPaidAmount,
        reference: txReference,
      },
    });

    return res.json({
      success: true,
      message: 'TV subscription renewed successfully',
      newBalance: newBalanceNum.toFixed(2),
      transactionId: internalTx._id.toString(),
      customer: customerName,
    });
  } catch (error) {
    console.error('TV subscription failed:', error);
    await session.abortTransaction();
    return res.status(503).json(buildFriendlyPurchaseFailurePayload());
  } finally {
    session.endSession();
  }
});

// -------------------------------------------------------------
// ELECTRICITY PURCHASE
// -------------------------------------------------------------
router.post('/purchase-electricity', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      meter_number,
      provider_code,
      amount,
      meter_info,
      meter_type = 'prepaid',
      reference,
      transactionPin,
    } = req.body;

    // Validation
    if (!meter_number || !provider_code || !amount) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields (meter_number, provider_code, amount)',
      });
    }

    const userPaidAmount = toMoneyNumber(amount, NaN);
    if (!Number.isFinite(userPaidAmount) || userPaidAmount < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Minimum amount is NGN 1,000',
      });
    }

    const user = req.userFull;
    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Load user inside transaction
    let updatedUser = await loadUserForPurchase(user._id, session);
    if (!updatedUser) {
      throw new Error('User not found');
    }

    const pinValidation = await validateTransactionPin(
      updatedUser,
      transactionPin
    );
    if (!pinValidation.success) {
      await session.abortTransaction();
      return res.status(pinValidation.status).json({
        success: false,
        message: pinValidation.message,
      });
    }

    // Ensure wallet exists
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
      return res.status(400).json(insufficientPayload);
    }

    const txReference =
      reference ||
      `ELEC-${provider_code}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`;

    // Extract customer name
    let customerName = 'Unknown Customer';
    if (meter_info?.message) {
      customerName =
        getDerivedCustomerNameFromMessage(meter_info.message) ||
        'Unknown Customer';
    } else if (meter_info?.customer_name) {
      customerName = meter_info.customer_name;
    }

    // -------------------------------------------------------------
    // AIDAPAY API CALL
    // -------------------------------------------------------------
    const formData = new FormData();
    formData.append('recipient', meter_number);
    formData.append('provider_code', provider_code);
    formData.append('amount', userPaidAmount.toString());
    formData.append('account_pin', aidapayPin);
    formData.append('ref', txReference);

    const providerData = await requestAidapayPurchase(
      formData,
      samplePurchase?.electricity,
      {
        reference: txReference,
        recipient: meter_number,
        amount: userPaidAmount,
        amountPaid: userPaidAmount,
        commission: 0,
        discount: 0,
        status: 'successful',
        token: '12345678901234567890',
        tokenUnits: 93.6,
      }
    );

    // Create internal transaction
    const internalTx = new Transaction({
      type: `electricity-${provider_code}`,
      userId: user._id,
      recipientMeterNumber: meter_number,
      provider_code,
      amount: userPaidAmount,
      reference: txReference,
      description: `Electricity - ${provider_code} (${meter_type}) for ${customerName} (${meter_number})`,
      status: 'pending',
      pricing: {
        originalPrice: userPaidAmount,
        fee: 0,
        gain: 0,
        commission: providerData.data?.transaction_data?.commission || 0,
      },
      metadata: {
        providerSource: 'aidapay',
        purchaseMode: 'aidapay',
        meter_info,
        meter_type,
        customer_name: customerName,
      },
    });

    await internalTx.save({ session });

    if (!providerData?.success || !providerData?.data?.success) {
      internalTx.status = 'failed';
      internalTx.failureReason =
        providerData?.message || 'Provider rejected the transaction';
      await internalTx.save({ session });
      logPurchaseTransactionObject(
        'Electricity purchase transaction object:',
        internalTx
      );
      throw new Error('Provider rejected the transaction');
    }

    // Debit wallet
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

    // Save beneficiary
    await saveElectricityBeneficiary(
      user,
      meter_number,
      customerName,
      provider_code,
      session
    );

    // Mark transaction as successful
    internalTx.status = 'success';
    internalTx.completedAt = new Date();
    await internalTx.save({ session });

    await session.commitTransaction();

    logPurchaseTransactionObject(
      'Electricity purchase transaction object:',
      internalTx
    );

    emitAdminPurchaseEvents(req, {
      type: `electricity-${provider_code}`,
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid: userPaidAmount,
      recipient: meter_number,
      provider: provider_code,
      userId: user._id.toString(),
      reference: txReference,
      status: 'success',
      customerName,
      meterType: meter_type,
    });

    emitCustomerPurchaseEvents(req, {
      type: `electricity-${provider_code}`,
      transaction: internalTx,
      amountCharged: userPaidAmount,
      providerAmountPaid: userPaidAmount,
      recipient: meter_number,
      provider: provider_code,
      userId: user._id.toString(),
      emailAddress: user.emailAddress,
      reference: txReference,
      status: 'success',
      providerStatus: 'success',
      walletUpdateDirection: 'debit',
      walletUpdateSource: 'aidapay-electricity',
      newBalance: newBalanceNum.toFixed(2),
      customerName,
      meterType: meter_type,
    });

    await createUserNotification(req, {
      userId: user._id,
      emailAddress: user.emailAddress,
      category: 'transaction',
      title: 'Electricity payment successful',
      message: `${provider_code} payment for ${customerName} was completed successfully.`,
      actionUrl: '/transactions',
      priority: 'normal',
      meta: {
        transactionId: internalTx._id.toString(),
        transactionType: `electricity-${provider_code}`,
        amount: userPaidAmount,
        reference: txReference,
      },
    });

    return res.json({
      success: true,
      message: 'Electricity payment completed successfully',
      newBalance: newBalanceNum.toFixed(2),
      transactionId: internalTx._id.toString(),
      customer: customerName,
    });
  } catch (error) {
    console.error('Electricity purchase failed:', error);
    await session.abortTransaction();
    return res.status(503).json(buildFriendlyPurchaseFailurePayload());
  } finally {
    session.endSession();
  }
});

module.exports = router;
