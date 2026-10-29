export const FRIENDLY_PURCHASE_RETRY_MESSAGE =
  'We could not complete your purchase because of a network issue. Please try again.';

const PURCHASE_NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export function getFriendlyPurchaseErrorMessage(
  error,
  fallbackMessage = FRIENDLY_PURCHASE_RETRY_MESSAGE
) {
  const status = Number(error?.response?.status || 0);
  const responseMessage = String(error?.response?.data?.message || '').trim();
  const errorCode = String(error?.code || '').trim().toUpperCase();
  const rawMessage = String(error?.message || '').trim();

  if (responseMessage) {
    return responseMessage;
  }

  if (PURCHASE_NETWORK_ERROR_CODES.has(errorCode)) {
    return fallbackMessage;
  }

  if (!error?.response) {
    return fallbackMessage;
  }

  if (
    status >= 500 ||
    /network|timeout|request failed|socket hang up/i.test(rawMessage)
  ) {
    return fallbackMessage;
  }

  return fallbackMessage;
}
