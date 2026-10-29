const WebhookIdempotency = require('../schema/WebhookIdempotencySchema');

const PURCHASE_IDEMPOTENCY_PROCESSING_TIMEOUT_MS = Math.max(
  Number(
    process.env.PURCHASE_IDEMPOTENCY_TIMEOUT_MS ||
      process.env.WEBHOOK_IDEMPOTENCY_PROCESSING_TIMEOUT_MS ||
      300000
  ),
  30000
);

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function shouldReclaimProcessingIdempotency(record) {
  if (!record) return false;

  const lockTimestamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
  if (!Number.isFinite(lockTimestamp) || lockTimestamp <= 0) return false;

  return Date.now() - lockTimestamp >= PURCHASE_IDEMPOTENCY_PROCESSING_TIMEOUT_MS;
}

function buildPurchaseIdempotencyKey({
  providerName = 'aidapay',
  eventType = 'purchase.data',
  idempotencyKey = '',
  reference = '',
  providerEventId = '',
} = {}) {
  const providerSegment = String(providerName || 'aidapay').trim().toLowerCase() || 'aidapay';
  const eventSegment = String(eventType || 'purchase.data').trim().toLowerCase() || 'purchase.data';
  const keySource = String(idempotencyKey || providerEventId || reference || '').trim();

  if (!keySource) return '';

  return `purchase:${providerSegment}:${eventSegment}:${keySource}`;
}

function resolveReplayResponseBody(existing = {}, fallbackMessage = 'Purchase already processed') {
  if (existing && typeof existing.responseBody === 'object' && existing.responseBody) {
    return existing.responseBody;
  }

  const reference = String(existing?.reference || '').trim();
  return {
    success: true,
    status: existing?.status === 'failed' ? 'failed' : 'processing',
    message: fallbackMessage,
    ...(reference ? { reference } : {}),
  };
}

async function beginPurchaseIdempotency({
  providerName = 'aidapay',
  eventType = 'purchase.data',
  idempotencyKey = '',
  reference = '',
  providerEventId = '',
} = {}) {
  const provider = String(providerName || 'aidapay').trim().toLowerCase() || 'aidapay';
  const normalizedReference = String(reference || '').trim();
  const normalizedProviderEventId = String(providerEventId || idempotencyKey || reference || '').trim();
  const key = buildPurchaseIdempotencyKey({
    providerName: provider,
    eventType,
    idempotencyKey,
    reference,
    providerEventId,
  });

  if (!key) {
    return {
      reservation: null,
      replay: false,
      conflict: false,
      invalid: true,
      reason: 'Missing purchase idempotency key',
    };
  }

  const existing = await WebhookIdempotency.findOne({ provider, key }).lean();
  if (existing) {
    if (existing.status === 'processed' && existing.responseBody) {
      return {
        reservation: existing,
        replay: true,
        conflict: false,
        invalid: false,
      };
    }

    if (existing.status === 'failed' && existing.responseBody) {
      return {
        reservation: existing,
        replay: true,
        conflict: false,
        invalid: false,
      };
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
      );

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
      reservation: existing,
      replay: false,
      conflict: true,
      invalid: false,
    };
  }

  try {
    const reservation = await WebhookIdempotency.create({
      provider,
      eventType,
      key,
      reference: normalizedReference,
      providerEventId: normalizedProviderEventId,
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
    if (isDuplicateKeyError(error)) {
      const duplicateRecord = await WebhookIdempotency.findOne({ provider, key }).lean();

      if (duplicateRecord) {
        if (duplicateRecord.status === 'processed' && duplicateRecord.responseBody) {
          return {
            reservation: duplicateRecord,
            replay: true,
            conflict: false,
            invalid: false,
          };
        }

        if (duplicateRecord.status === 'failed' && duplicateRecord.responseBody) {
          return {
            reservation: duplicateRecord,
            replay: true,
            conflict: false,
            invalid: false,
          };
        }

        if (
          duplicateRecord.status === 'processing' &&
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
          );

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
    }

    throw error;
  }
}

async function finalizePurchaseIdempotency(
  reservationId,
  responseBody = {},
  transactionId = null,
  options = {}
) {
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
}

async function failPurchaseIdempotency(
  reservationId,
  error,
  responseBody = {},
  options = {}
) {
  if (!reservationId) return;

  const safeError = String(error?.message || error || 'Purchase processing failed')
    .trim()
    .slice(0, 500);

  await WebhookIdempotency.findByIdAndUpdate(
    reservationId,
    {
      status: 'failed',
      responseBody: responseBody && Object.keys(responseBody).length ? responseBody : null,
      lastError: safeError,
      lastErrorAt: new Date(),
      transaction: null,
    },
    options
  );
}

module.exports = {
  beginPurchaseIdempotency,
  finalizePurchaseIdempotency,
  failPurchaseIdempotency,
  buildPurchaseIdempotencyKey,
  resolveReplayResponseBody,
};
