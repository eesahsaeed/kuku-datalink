const axios = require('axios');
const { getPaystackKeysForMode, networkTimeout } = require('../helper.js');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_DVA_DOCS_URL = 'https://paystack.com/docs/api/dedicated-virtual-account/';

const PAYSTACK_PREFERRED_BANKS = {
  test: [{ label: 'Test Bank', value: 'test-bank' }],
  live: [
    { label: 'Paystack-Titan', value: 'titan-paystack' },
    { label: 'Wema Bank', value: 'wema-bank' },
  ],
};

async function getAvailableBanks() {
  try {
    const { data } = await axios.get(
      `${PAYSTACK_BASE_URL}/dedicated_account/available_providers`,
      { headers: getPaystackHeaders(), timeout: networkTimeout }
    );

    console.log(data);
    return data;
  } catch (error) {
    console.error(error.response?.data || error.message);
    throw error;
  }
}

const DEFAULT_TRANSFER_BANK_CODE = '044';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getPaystackSecretKey = () => {
  const keys = getPaystackKeysForMode(process.env.PAYSTACK_MODE);
  return String(keys?.secretKey || '').trim();
};

const getPaystackHeaders = () => {
  const key = getPaystackSecretKey();
  if (!key) {
    throw new Error(
      'PAYSTACK_LIVE_SECRET_KEY or PAYSTACK_TEST_SECRET_KEY is not configured'
    );
  }

  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
};

const normalizePaystackBalanceAmount = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.round((numericValue / 100 + Number.EPSILON) * 100) / 100;
};

const fetchPaystackBalance = async (currency = 'NGN') => {
  const response = await axios.get(`${PAYSTACK_BASE_URL}/balance`, {
    headers: getPaystackHeaders(),
    timeout: networkTimeout,
  });

  const balances = Array.isArray(response.data?.data) ? response.data.data : [];
  const normalizedBalances = balances
    .map((entry) => ({
      currency: String(entry?.currency || '').toUpperCase().trim(),
      balance: normalizePaystackBalanceAmount(entry?.balance),
      pendingBalance: normalizePaystackBalanceAmount(
        entry?.pending_balance ?? entry?.pendingBalance
      ),
    }))
    .filter((entry) => entry.currency);

  const normalizedCurrency = String(currency || 'NGN').toUpperCase().trim();
  const matchedBalance =
    normalizedBalances.find((entry) => entry.currency === normalizedCurrency) ||
    normalizedBalances[0] ||
    null;

  return {
    balance: matchedBalance?.balance ?? null,
    pendingBalance: matchedBalance?.pendingBalance ?? null,
    currency: matchedBalance?.currency || normalizedCurrency,
    balances: normalizedBalances,
    payload: response.data?.data || [],
  };
};

const createTransferRecipient = async ({
  name,
  accountNumber,
  bankCode = DEFAULT_TRANSFER_BANK_CODE,
}) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transferrecipient`,
    {
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    },
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const initiateTransfer = async ({
  amount,
  recipient,
  reference,
  reason = '',
}) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transfer`,
    {
      source: 'balance',
      amount: Math.round(Number(amount || 0) * 100),
      recipient,
      reference,
      reason,
      currency: 'NGN',
    },
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const finalizeTransfer = async ({ transferCode, otp }) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transfer/finalize_transfer`,
    {
      transfer_code: transferCode,
      otp,
    },
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const resendTransferOtp = async ({ transferCode }) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transfer/resend_otp`,
    {
      transfer_code: transferCode,
      reason: 'admin_wallet_funding',
    },
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const getPaystackErrorMessage = (error, fallbackMessage) => {
  const apiMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallbackMessage;

  return `${apiMessage} (${PAYSTACK_DVA_DOCS_URL})`;
};

const getPaystackMode = () => {
  const configuredMode = String(process.env.PAYSTACK_MODE || '')
    .toLowerCase()
    .trim();

  if (configuredMode === 'test' || configuredMode === 'live') {
    return configuredMode;
  }

  const secret = getPaystackSecretKey();
  if (secret.startsWith('sk_test_')) return 'test';
  if (secret.startsWith('sk_live_')) return 'live';

  return process.env.NODE_ENV === 'production' ? 'live' : 'test';
};

const getPaystackPreferredBanks = () => {
  const mode = getPaystackMode();
  return PAYSTACK_PREFERRED_BANKS[mode] || PAYSTACK_PREFERRED_BANKS.test;
};

const fetchPaystackPreferredBanks = async () => {
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/dedicated_account/available_providers`,
      {
        headers: getPaystackHeaders(),
        timeout: networkTimeout,
      }
    );

    const providers = Array.isArray(response.data?.data)
      ? response.data.data
      : [];
    if (providers.length === 0) {
      return getPaystackPreferredBanks();
    }

    const normalizedProviders = providers
      .map((provider) => ({
        label:
          provider?.bank_name ||
          provider?.name ||
          provider?.slug ||
          'Unknown Bank',
        value: provider?.slug || '',
      }))
      .filter((provider) => provider.value);

    const preferredOrder = getPaystackPreferredBanks().map(
      (provider) => provider.value
    );

    return normalizedProviders.sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.value);
      const rightIndex = preferredOrder.indexOf(right.value);
      const normalizedLeftIndex =
        leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRightIndex =
        rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      return normalizedLeftIndex - normalizedRightIndex;
    });
  } catch (_error) {
    return getPaystackPreferredBanks();
  }
};

const getDefaultPreferredBank = () => {
  const configured = String(process.env.PAYSTACK_PREFERRED_BANK || '').trim();
  if (configured) return configured;

  const mode = getPaystackMode();
  return mode === 'test' ? 'test-bank' : 'titan-paystack';
};

const uniq = (items = []) => [...new Set(items.filter(Boolean))];

const getPreferredBankCandidates = async (requestedPreferredBank = '') => {
  const explicitBank = String(requestedPreferredBank || '').trim();
  const configuredDefault = getDefaultPreferredBank();

  const availableProviders = await fetchPaystackPreferredBanks();
  const availableBankValues = Array.isArray(availableProviders)
    ? availableProviders.map((provider) => provider.value).filter(Boolean)
    : [];

  const fallbackBanks = getPaystackPreferredBanks()
    .map((provider) => provider.value)
    .filter(Boolean);

  const orderedCandidates = uniq([
    explicitBank,
    configuredDefault,
    ...fallbackBanks,
    ...availableBankValues,
  ]);

  if (availableBankValues.length === 0) {
    return orderedCandidates;
  }

  return orderedCandidates.filter((candidate) =>
    availableBankValues.includes(candidate)
  );
};

const splitName = (fullName = '') => {
  const chunks = String(fullName).trim().split(/\s+/).filter(Boolean);

  if (chunks.length === 0) {
    return { firstName: 'Kuku', lastName: 'User' };
  }

  if (chunks.length === 1) {
    return { firstName: chunks[0], lastName: 'User' };
  }

  return {
    firstName: chunks[0],
    lastName: chunks.slice(1).join(' '),
  };
};

const normalizePhoneForPaystack = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');

  if (!digits) {
    return '+2348000000000';
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return `+234${digits.slice(1)}`;
  }

  if (digits.length === 13 && digits.startsWith('234')) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+234${digits}`;
  }

  if (digits.startsWith('234')) {
    return `+${digits}`;
  }

  return `+${digits}`;
};

const normalizeVirtualAccount = (data = {}) => {
  const customer = data.customer || {};
  const bank = data.bank || {};

  return {
    provider: 'paystack',
    account_name: data.account_name || '',
    bank_name: bank.name || '',
    bank_slug: bank.slug || '',
    virtual_account_number: data.account_number || '',
    customer_code: customer.customer_code || customer.code || '',
    customer_id: customer.id || null,
    dedicated_account_id: data.id || null,
    assigned: Boolean(data.assigned),
    currency: data.currency || 'NGN',
    created_at: data.created_at || new Date().toISOString(),
    updated_at: data.updated_at || new Date().toISOString(),
  };
};

const hasUsableVirtualAccount = (account = {}) =>
  Boolean(
    String(account.virtual_account_number || '').trim() &&
      String(account.account_name || '').trim()
  );

const findDedicatedAccountMatch = (accounts = [], email) => {
  const normalizedEmail = String(email || '')
    .toLowerCase()
    .trim();
  return (
    accounts.find((account) => {
      const accountEmail = account?.customer?.email || '';
      return accountEmail.toLowerCase().trim() === normalizedEmail;
    }) || null
  );
};

const normalizeAndValidateVirtualAccount = (data, fallbackMessage) => {
  const normalized = normalizeVirtualAccount(data || {});
  if (!hasUsableVirtualAccount(normalized)) {
    throw new Error(`${fallbackMessage} (${PAYSTACK_DVA_DOCS_URL})`);
  }
  return normalized;
};

const buildAssignPayload = ({
  user,
  firstName,
  lastName,
  phone,
  preferredBank,
}) => ({
  email: user.emailAddress,
  first_name: firstName,
  last_name: lastName,
  phone,
  preferred_bank: preferredBank,
  country: 'NG',
});

const assignDedicatedAccount = async ({
  user,
  firstName,
  lastName,
  phone,
  preferredBank,
}) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/dedicated_account/assign`,
    buildAssignPayload({
      user,
      firstName,
      lastName,
      phone,
      preferredBank,
    }),
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const createDedicatedAccountFromCustomer = async ({
  customerCode,
  firstName,
  lastName,
  phone,
  preferredBank,
}) => {
  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/dedicated_account`,
    {
      customer: customerCode,
      preferred_bank: preferredBank,
      first_name: firstName,
      last_name: lastName,
      phone,
    },
    { headers: getPaystackHeaders(), timeout: networkTimeout }
  );

  return response.data?.data;
};

const findExistingDedicatedAccountForEmail = async (email) => {
  let page = 1;
  const normalizedEmail = email.toLowerCase().trim();

  while (page <= 5) {
    const response = await axios.get(`${PAYSTACK_BASE_URL}/dedicated_account`, {
      headers: getPaystackHeaders(),
      params: { perPage: 100, page },
      timeout: networkTimeout,
    });

    const accounts = Array.isArray(response.data?.data)
      ? response.data.data
      : [];
    const match = findDedicatedAccountMatch(accounts, normalizedEmail);

    if (match || accounts.length < 100) {
      return match;
    }

    page += 1;
  }

  return null;
};

const waitForExistingDedicatedAccount = async (
  email,
  attempts = 4,
  delayMs = 1500
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const match = await findExistingDedicatedAccountForEmail(email);
    if (match) {
      return match;
    }

    if (attempt < attempts - 1) {
      await delay(delayMs);
    }
  }

  return null;
};

const createOrFetchPaystackVirtualAccount = async (user, options = {}) => {
  if (!user) {
    throw new Error('User is required');
  }

  if (hasUsableVirtualAccount(user.virtualAccount || {})) {
    return user.virtualAccount;
  }

  const { firstName, lastName } = splitName(user.fullName);
  const phone = normalizePhoneForPaystack(user.phoneNumber);
  const preferredBankCandidates = await getPreferredBankCandidates(
    options.preferredBank
  );
  const finalBankCandidates =
    preferredBankCandidates.length > 0
      ? preferredBankCandidates
      : [getDefaultPreferredBank()];

  let lastAssignError = null;

  for (const preferredBank of finalBankCandidates) {
    try {
      const assignedAccount = await assignDedicatedAccount({
        user,
        firstName,
        lastName,
        phone,
        preferredBank,
      });
      let normalized = null;

      if (
        assignedAccount &&
        hasUsableVirtualAccount(normalizeVirtualAccount(assignedAccount))
      ) {
        normalized = normalizeAndValidateVirtualAccount(
          assignedAccount,
          'Paystack returned an incomplete dedicated virtual account payload'
        );
      } else {
        const existingAfterAssign = await waitForExistingDedicatedAccount(
          user.emailAddress
        );

        if (existingAfterAssign) {
          normalized = normalizeAndValidateVirtualAccount(
            existingAfterAssign,
            'Paystack returned an incomplete dedicated virtual account payload'
          );
        }
      }

      if (!normalized) {
        throw new Error(
          `Paystack is still processing dedicated account assignment. Please retry in a few seconds (${PAYSTACK_DVA_DOCS_URL})`
        );
      }

      user.virtualAccount = normalized;
      await user.save();
      return normalized;
    } catch (assignError) {
      lastAssignError = assignError;

      let existingAccount = null;

      try {
        existingAccount = await waitForExistingDedicatedAccount(
          user.emailAddress,
          3,
          1000
        );
      } catch (_existingAccountLookupError) {
        existingAccount = null;
      }

      if (existingAccount) {
        const normalized = normalizeAndValidateVirtualAccount(
          existingAccount,
          'Existing Paystack dedicated account is incomplete'
        );
        user.virtualAccount = normalized;
        await user.save();
        return normalized;
      }
    }
  }

  let customerCode = null;

  try {
    const customerResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/customer/${encodeURIComponent(user.emailAddress)}`,
      { headers: getPaystackHeaders(), timeout: networkTimeout }
    );
    customerCode =
      customerResponse.data?.data?.customer_code ||
      customerResponse.data?.data?.code ||
      null;
  } catch (_error) {
    // No-op fallback below
  }

  if (!customerCode) {
    try {
      const customerCreateResponse = await axios.post(
        `${PAYSTACK_BASE_URL}/customer`,
        {
          email: user.emailAddress,
          first_name: firstName,
          last_name: lastName,
          phone,
        },
        { headers: getPaystackHeaders(), timeout: networkTimeout }
      );
      customerCode =
        customerCreateResponse.data?.data?.customer_code ||
        customerCreateResponse.data?.data?.code;
    } catch (customerCreateError) {
      throw new Error(
        getPaystackErrorMessage(
          customerCreateError,
          'Paystack customer creation failed'
        )
      );
    }
  }

  let lastCreateError = lastAssignError;

  for (const preferredBank of finalBankCandidates) {
    try {
      const account = await createDedicatedAccountFromCustomer({
        customerCode,
        firstName,
        lastName,
        phone,
        preferredBank,
      });

      const normalized = normalizeAndValidateVirtualAccount(
        account,
        'Paystack did not return a complete dedicated virtual account'
      );
      user.virtualAccount = normalized;
      await user.save();
      return normalized;
    } catch (createDedicatedAccountError) {
      lastCreateError = createDedicatedAccountError;
    }
  }

  throw new Error(
    getPaystackErrorMessage(
      lastCreateError,
      'Paystack dedicated account creation failed'
    )
  );
};

module.exports = {
  fetchPaystackPreferredBanks,
  fetchPaystackBalance,
  getPaystackMode,
  getPaystackPreferredBanks,
  getPaystackSecretKey,
  createOrFetchPaystackVirtualAccount,
  createTransferRecipient,
  initiateTransfer,
  finalizeTransfer,
  resendTransferOtp,
  getAvailableBanks
};
