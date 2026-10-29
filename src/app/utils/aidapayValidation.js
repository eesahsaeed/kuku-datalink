import axios from 'axios';

import {
  networkTimeout,
  networkProviderMatchesPhone,
  normalizeNigerianPhoneNumber,
  resolveFallbackProviderCodeForNetwork,
} from '../../lib/helper';

export async function validateAidapayRecipient(providerCode, recipient) {
  const normalizedProviderCode = String(providerCode || '').trim();
  const normalizedRecipient =
    normalizeNigerianPhoneNumber(recipient) || String(recipient || '').trim();
  const resolvedProviderCode = resolveFallbackProviderCodeForNetwork(
    '',
    normalizedProviderCode
  );

  if (!resolvedProviderCode || !normalizedRecipient) {
    return {
      success: false,
      verified: false,
      message: 'Unable to verify account details',
    };
  }

  if (!networkProviderMatchesPhone(normalizedRecipient, resolvedProviderCode)) {
    return {
      success: false,
      verified: false,
      message: 'This phone number does not belong to the selected network.',
    };
  }

  try {
    const response = await axios.get(
      `/api/purchase/catalog/validation/${encodeURIComponent(
        resolvedProviderCode
      )}/${encodeURIComponent(normalizedRecipient)}`,
      {
        timeout: networkTimeout,
      }
    );

    return response.data || {
      success: false,
      verified: false,
      message: 'Unable to verify account details',
    };
  } catch (error) {
    return (
      error?.response?.data || {
        success: false,
        verified: false,
        message:
          error?.response?.data?.message ||
          error?.response?.data?.error ||
          error?.message ||
          'Unable to verify account details',
      }
    );
  }
}
