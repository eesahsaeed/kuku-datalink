const CACHE_TTL_MS = 60 * 1000;

let walletBalanceCache = {
  token: '',
  value: undefined,
  fetchedAt: 0,
};

let beneficiariesCache = {
  token: '',
  value: undefined,
  fetchedAt: 0,
};

const isFresh = (entry = {}, token = '') =>
  Boolean(entry?.token) &&
  entry.token === token &&
  entry.fetchedAt > 0 &&
  Date.now() - entry.fetchedAt < CACHE_TTL_MS;

export const readCachedWalletBalance = (token = '') =>
  isFresh(walletBalanceCache, token) ? walletBalanceCache.value : undefined;

export const writeCachedWalletBalance = (token = '', value) => {
  walletBalanceCache = {
    token,
    value,
    fetchedAt: Date.now(),
  };

  return value;
};

export const readCachedBeneficiaries = (token = '') =>
  isFresh(beneficiariesCache, token) ? beneficiariesCache.value : undefined;

export const writeCachedBeneficiaries = (token = '', value = []) => {
  beneficiariesCache = {
    token,
    value,
    fetchedAt: Date.now(),
  };

  return value;
};

export const clearPurchaseUiCache = () => {
  walletBalanceCache = {
    token: '',
    value: undefined,
    fetchedAt: 0,
  };
  beneficiariesCache = {
    token: '',
    value: undefined,
    fetchedAt: 0,
  };
};
