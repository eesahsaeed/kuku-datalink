const PlanOverride = require('../schema/PlanSchema');
const {
  mergeDataDetailsSnapshots,
  replaceAllDataDetails,
} = require('../helper');

const normalizeText = (value = '') => String(value || '').trim();
const normalizeSource = (value = '') =>
  normalizeText(value).toLowerCase() || 'aidapay';
const isNineMobileIdentifier = (value = '') => {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('9mobile') ||
    normalized.includes('t2mobile') ||
    normalized.includes('etisalat')
  );
};

const normalizeDurationGroup = (value = '') => {
  const formatDurationAmount = (amount = 0) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      return '';
    }

    return Number.isInteger(numericAmount)
      ? String(numericAmount)
      : String(Number(numericAmount.toFixed(1)));
  };

  const normalized = normalizeText(value).replace(/[-_]+/g, ' ').toLowerCase();

  if (!normalized) {
    return 'More';
  }

  if (normalized.includes('daily') || /\b1\s*day\b/.test(normalized)) {
    return 'Daily';
  }

  if (normalized.includes('weekly') || /\b7\s*days?\b/.test(normalized)) {
    return 'Weekly';
  }

  const durationMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = String(durationMatch[2] || '').toLowerCase();

    if (unit.startsWith('day')) {
      return amount === 1
        ? 'Daily'
        : `${formatDurationAmount(amount)} Day${amount === 1 ? '' : 's'}`;
    }

    if (unit.startsWith('week')) {
      return amount === 1
        ? 'Weekly'
        : `${formatDurationAmount(amount)} Week${amount === 1 ? '' : 's'}`;
    }

    if (unit.startsWith('month')) {
      return `${formatDurationAmount(amount)} Month${amount === 1 ? '' : 's'}`;
    }

    if (unit.startsWith('year')) {
      return `${formatDurationAmount(amount)} Year${amount === 1 ? '' : 's'}`;
    }
  }

  if (normalized.includes('month')) {
    return 'Monthly';
  }

  if (normalized.includes('year')) {
    return 'Yearly';
  }

  if (normalized === 'more') {
    return 'More';
  }

  return normalizeText(value) || 'More';
};

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
};

const normalizeReplacementCodes = (value = []) => {
  const rawValues = Array.isArray(value) ? value : normalizeText(value) ? [value] : [];
  const seen = new Set();

  return rawValues.reduce((accumulator, entry) => {
    const packageCode = normalizeText(entry);
    const normalizedKey = packageCode.toUpperCase();

    if (!packageCode || seen.has(normalizedKey)) {
      return accumulator;
    }

    seen.add(normalizedKey);
    accumulator.push(packageCode);
    return accumulator;
  }, []);
};

function normalizePlanPackageCode(value = '') {
  return normalizeText(value);
}

function buildPlanOverrideSnapshotRecord(record = {}) {
  const packageCode = normalizePlanPackageCode(
    record?.packageCode || record?.package_code || record?.package_api_code
  );

  if (!packageCode) {
    return null;
  }

  const packageOriginalAmount = normalizeNumber(
    record?.package_original_amount ?? record?.originalPrice ?? record?.package_amount
  );

  return {
    packageCode,
    package_code: packageCode,
    package_api_code: packageCode,
    source: normalizeSource(record?.source),
    provider_code: normalizeText(record?.provider_code).toLowerCase(),
    package_name: normalizeText(record?.package_name || packageCode),
    durationGroup: normalizeDurationGroup(
      record?.durationGroup || record?.duration_group || record?.package_name || packageCode
    ),
    duration_group: normalizeDurationGroup(
      record?.durationGroup || record?.duration_group || record?.package_name || packageCode
    ),
    package_original_amount: packageOriginalAmount,
    originalPrice: packageOriginalAmount,
    sellingPrice: normalizeNumber(record?.sellingPrice),
    isNew: Boolean(record?.isNew),
    commission: normalizeNumber(record?.commission),
    charges: normalizeNumber(record?.charges),
    fee: normalizeNumber(record?.fee),
    gain: normalizeNumber(record?.gain),
    extra: normalizeNumber(record?.extra),
    markup: normalizeNumber(record?.markup),
    exclude: Boolean(record?.exclude),
    replacement_package_api_codes: normalizeReplacementCodes(
      record?.replacement_package_api_codes
    ),
    lastSyncedAt: record?.lastSyncedAt || record?.updatedAt || record?.createdAt || null,
    updatedAt: record?.updatedAt || null,
    createdAt: record?.createdAt || null,
  };
}

function buildPersistedPlanOverridesSnapshot(planDocs = []) {
  return (Array.isArray(planDocs) ? planDocs : []).reduce((accumulator, doc) => {
    const snapshotRecord = buildPlanOverrideSnapshotRecord(doc);

    if (!snapshotRecord) {
      return accumulator;
    }

    if (
      snapshotRecord.source === 'aidapay' &&
      isNineMobileIdentifier(
        snapshotRecord.provider_code ||
          snapshotRecord.packageCode ||
          snapshotRecord.package_code ||
          snapshotRecord.package_api_code ||
          snapshotRecord.package_name
      )
    ) {
      return accumulator;
    }

    accumulator[snapshotRecord.packageCode] = snapshotRecord;
    return accumulator;
  }, {});
}

async function fetchPersistedPlanOverridesSnapshot(filter = {}) {
  const query = filter && typeof filter === 'object' ? filter : {};
  const planDocs = await PlanOverride.find(query)
    .sort({ source: 1, packageCode: 1 })
    .lean();

  return buildPersistedPlanOverridesSnapshot(planDocs);
}

async function mergeLiveAndPersistedPlanSnapshots(
  liveSnapshot = {},
  filter = {}
) {
  const filteredLiveSnapshot = Object.fromEntries(
    Object.entries(liveSnapshot || {}).filter(([packageCode, pricingMeta]) => {
      if (!pricingMeta || typeof pricingMeta !== 'object') {
        return false;
      }

      const source = normalizeSource(pricingMeta?.source);
      if (source !== 'aidapay') {
        return true;
      }

      return !isNineMobileIdentifier(
        pricingMeta?.provider_code ||
          pricingMeta?.provider_name ||
          pricingMeta?.packageCode ||
          pricingMeta?.package_code ||
          pricingMeta?.package_api_code ||
          packageCode ||
          pricingMeta?.package_name
      );
    })
  );
  const persistedSnapshot = await fetchPersistedPlanOverridesSnapshot(filter);
  const filteredPersistedSnapshot = Object.fromEntries(
    Object.entries(persistedSnapshot || {}).filter(([packageCode, pricingMeta]) => {
      if (!pricingMeta || typeof pricingMeta !== 'object') {
        return false;
      }

      const source = normalizeSource(pricingMeta?.source);
      if (source !== 'aidapay') {
        return true;
      }

      return !isNineMobileIdentifier(
        pricingMeta?.provider_code ||
          pricingMeta?.provider_name ||
          pricingMeta?.packageCode ||
          pricingMeta?.package_code ||
          pricingMeta?.package_api_code ||
          packageCode ||
          pricingMeta?.package_name
      );
    })
  );
  const mergedSnapshot = mergeDataDetailsSnapshots(
    filteredLiveSnapshot,
    filteredPersistedSnapshot
  );
  replaceAllDataDetails(mergedSnapshot);
  return mergedSnapshot;
}

async function upsertPlanOverrideRecord(payload = {}, identity = {}) {
  const source = normalizeSource(payload?.source || identity?.source);
  const nextPackageCode = normalizePlanPackageCode(
    payload?.packageCode ||
      payload?.package_api_code ||
      payload?.package_code ||
      identity?.packageCode ||
      identity?.package_code
  );
  const previousPackageCode = normalizePlanPackageCode(
    payload?.originalPackageCode ||
      payload?.original_package_code ||
      identity?.originalPackageCode ||
      identity?.original_package_code ||
      identity?.packageCode ||
      identity?.package_code ||
      nextPackageCode
  );
  const previousSource = normalizeSource(
    payload?.originalSource ||
      payload?.original_source ||
      identity?.originalSource ||
      identity?.original_source ||
      identity?.source ||
      source
  );

  if (!nextPackageCode) {
    const error = new Error('Package code is required');
    error.statusCode = 400;
    throw error;
  }

  const replacementCodes = normalizeReplacementCodes(
    payload?.replacement_package_api_codes ??
      identity?.replacement_package_api_codes
  );
  const packageOriginalAmount = normalizeNumber(
    payload?.package_original_amount ??
      identity?.package_original_amount ??
      payload?.originalPrice ??
      identity?.originalPrice ??
      payload?.package_amount ??
      identity?.package_amount
  );

  const nextRecord = {
    packageCode: nextPackageCode,
    source,
    provider_code: normalizeText(
      payload?.provider_code || identity?.provider_code || ''
    ).toLowerCase(),
    package_name: normalizeText(
      payload?.package_name || identity?.package_name || nextPackageCode
    ),
    durationGroup: normalizeDurationGroup(
      payload?.durationGroup ||
        identity?.durationGroup ||
        payload?.duration_group ||
        identity?.duration_group ||
        payload?.package_name ||
        identity?.package_name ||
        nextPackageCode
    ),
    duration_group: normalizeDurationGroup(
      payload?.durationGroup ||
        identity?.durationGroup ||
        payload?.duration_group ||
        identity?.duration_group ||
        payload?.package_name ||
        identity?.package_name ||
        nextPackageCode
    ),
    package_original_amount: packageOriginalAmount,
    originalPrice: packageOriginalAmount,
    sellingPrice: normalizeNumber(
      payload?.sellingPrice ?? identity?.sellingPrice
    ),
    isNew: Boolean(
      payload?.isNew !== undefined ? payload.isNew : identity?.isNew
    ),
    commission: normalizeNumber(payload?.commission ?? identity?.commission),
    charges: normalizeNumber(payload?.charges ?? identity?.charges),
    fee: normalizeNumber(payload?.fee ?? identity?.fee),
    gain: normalizeNumber(payload?.gain ?? identity?.gain),
    extra: normalizeNumber(payload?.extra ?? identity?.extra),
    markup: normalizeNumber(payload?.markup ?? identity?.markup),
    exclude: Boolean(
      payload?.exclude !== undefined ? payload.exclude : identity?.exclude
    ),
    replacement_package_api_codes: replacementCodes,
    lastSyncedAt: new Date(),
  };

  const targetIdentity = {
    source,
    packageCode: nextPackageCode,
  };
  const savedRecord = await PlanOverride.findOneAndUpdate(
    targetIdentity,
    {
      $set: nextRecord,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (
    previousPackageCode &&
    (previousPackageCode !== nextPackageCode || previousSource !== source)
  ) {
    await PlanOverride.deleteOne({
      source: previousSource,
      packageCode: previousPackageCode,
    });
  }

  return buildPlanOverrideSnapshotRecord(savedRecord || nextRecord);
}

async function deletePlanOverrideRecord(identity = {}) {
  const source = normalizeSource(identity?.source);
  const packageCode = normalizePlanPackageCode(
    identity?.packageCode || identity?.package_code
  );

  if (!packageCode) {
    const error = new Error('Package code is required');
    error.statusCode = 400;
    throw error;
  }

  await PlanOverride.deleteOne({ source, packageCode });
  return { source, packageCode };
}

module.exports = {
  buildPlanOverrideSnapshotRecord,
  deletePlanOverrideRecord,
  fetchPersistedPlanOverridesSnapshot,
  mergeLiveAndPersistedPlanSnapshots,
  normalizePlanPackageCode,
  normalizeSource,
  upsertPlanOverrideRecord,
};
