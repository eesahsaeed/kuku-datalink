const sanitizePhoneDigits = (value = '') =>
  String(value || '').replace(/\D/g, '').trim();

const normalizeNigerianPhoneNumber = (value = '') => {
  const digits = sanitizePhoneDigits(value);

  if (!digits) {
    return '';
  }

  const withoutInternationalCallPrefix = digits.startsWith('00')
    ? digits.slice(2)
    : digits;

  // Some users type +234 with an extra local trunk prefix 0 (for example, +2340803...).
  // Accept it and convert to standard local format.
  if (
    withoutInternationalCallPrefix.length === 14 &&
    /^2340[789]\d{9}$/.test(withoutInternationalCallPrefix)
  ) {
    return withoutInternationalCallPrefix.slice(3);
  }

  if (
    withoutInternationalCallPrefix.length === 13 &&
    /^234[789]\d{9}$/.test(withoutInternationalCallPrefix)
  ) {
    return `0${withoutInternationalCallPrefix.slice(3)}`;
  }

  if (digits.length === 15 && digits.startsWith('00234')) {
    return `0${digits.slice(5)}`;
  }

  if (digits.length === 10 && /^[789]\d{9}$/.test(digits)) {
    return `0${digits}`;
  }

  if (digits.length === 11 && /^0\d{10}$/.test(digits)) {
    return digits;
  }

  return '';
};

const isValidNigerianPhoneNumber = (value = '') =>
  /^0[789]\d{9}$/.test(normalizeNigerianPhoneNumber(value));

const coerceStoredPhoneNumber = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const digits = sanitizePhoneDigits(value);

  if (!digits) {
    return null;
  }

  return normalizeNigerianPhoneNumber(digits) || digits;
};

module.exports = {
  sanitizePhoneDigits,
  normalizeNigerianPhoneNumber,
  isValidNigerianPhoneNumber,
  coerceStoredPhoneNumber,
};
