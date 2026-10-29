import {
  normalizeNigerianPhoneNumber,
  sanitizePhoneDigits,
} from '../../lib/helper';

export const PHONE_BENEFICIARIES_UPDATED_EVENT =
  'kuku:phone-beneficiaries-updated';

export const normalizePhoneBeneficiaries = (rawBeneficiaries = []) => {
  if (!Array.isArray(rawBeneficiaries)) return [];

  const seen = new Set();

  return rawBeneficiaries
    .map((item) => {
      const isObject = item && typeof item === 'object' && !Array.isArray(item);
      const rawPhone = isObject
        ? item.phone_number || item.phoneNumber || item.phone || item.label
        : item;
      const phoneNumber =
        normalizeNigerianPhoneNumber(rawPhone) || sanitizePhoneDigits(rawPhone);

      if (!phoneNumber) return null;
      if (seen.has(phoneNumber)) return null;
      seen.add(phoneNumber);

      const label = isObject
        ? String(item.label || '').trim() || phoneNumber
        : phoneNumber;
      const network = isObject ? String(item.network || '').trim() : '';

      return {
        phoneNumber,
        label,
        network,
      };
    })
    .filter(Boolean);
};

const normalizePhoneForPriority = (value = '') => {
  const digits =
    normalizeNigerianPhoneNumber(value) || sanitizePhoneDigits(value);
  if (!digits) return '';

  return digits;
};

export const prioritizeBeneficiariesByUserPhone = (
  beneficiaries = [],
  userPhone = ''
) => {
  const normalizedUserPhone = normalizePhoneForPriority(userPhone);
  const normalizedBeneficiaries = normalizePhoneBeneficiaries(beneficiaries);

  if (!normalizedUserPhone) {
    return normalizedBeneficiaries;
  }

  let userBeneficiary = null;
  const remainingBeneficiaries = [];

  normalizedBeneficiaries.forEach((beneficiary) => {
    if (
      !userBeneficiary &&
      normalizePhoneForPriority(beneficiary.phoneNumber) === normalizedUserPhone
    ) {
      userBeneficiary = beneficiary;
      return;
    }

    remainingBeneficiaries.push(beneficiary);
  });

  if (!userBeneficiary) {
    userBeneficiary = {
      phoneNumber: normalizedUserPhone,
      label: normalizedUserPhone,
      network: '',
    };
  }

  return [userBeneficiary, ...remainingBeneficiaries];
};

export const dispatchPhoneBeneficiariesUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PHONE_BENEFICIARIES_UPDATED_EVENT));
};
