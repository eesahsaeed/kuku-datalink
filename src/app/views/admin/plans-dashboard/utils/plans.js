const normalize = (value = '') => String(value || '').trim().toLowerCase();
const hasNumericFilter = (value) =>
  value !== null &&
  value !== undefined &&
  String(value).trim() !== '' &&
  Number.isFinite(Number(value));

const toNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function getPlanCode(plan = {}) {
  return String(
    plan?.package_api_code || plan?.package_code || plan?.packageCode || plan?.id || ''
  ).trim();
}

export function getPlanName(plan = {}) {
  return String(plan?.name || plan?.package_name || getPlanCode(plan) || '').trim();
}

export function formatSourceLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === 'configured') {
    return 'Configured';
  }

  if (normalized === 'aidapay') {
    return 'Aidapay';
  }

  if (normalized === 'directortech') {
    return 'Directortech';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function getSourceBadgeColor(value = '') {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === 'configured') {
    return 'secondary';
  }

  if (normalized === 'aidapay') {
    return 'success';
  }

  if (normalized === 'directortech') {
    return 'warning';
  }

  return 'info';
}

export function getPriceComparisonClass(sellingValue = 0, originalValue = 0) {
  const selling = toNumberOrNull(sellingValue);
  const original = toNumberOrNull(originalValue);

  if (selling === null || original === null || original <= 0) {
    return '';
  }

  if (selling > original) {
    return 'plans-price-positive';
  }

  if (selling < original) {
    return 'plans-price-negative';
  }

  return '';
}

export function getPlanSellingPriceClass(plan = {}) {
  return getPriceComparisonClass(
    plan.sellingPriceKobo ?? plan.sellingPrice ?? 0,
    plan.originalPriceKobo ?? plan.packageOriginalAmountKobo ?? plan.package_original_amount ?? 0
  );
}

export function getEditableSellingPriceClass(row = {}) {
  return getPriceComparisonClass(row.sellingPrice ?? 0, row.package_original_amount ?? 0);
}

export function filterPlans(plans = [], filters = {}) {
  const {
    network = 'ALL',
    category = 'ALL',
    durationGroup = 'ALL',
    source = 'ALL',
    minPriceKobo = null,
    maxPriceKobo = null,
    search = '',
  } = filters;

  const normalizedSearch = normalize(search);

  return plans.filter((plan) => {
    if (network !== 'ALL' && plan.network !== network) return false;
    if (category !== 'ALL' && plan.category !== category) return false;
    if (
      durationGroup !== 'ALL' &&
      String(plan.durationGroup || plan.duration_group || '')
        .trim()
        .toLowerCase() !== String(durationGroup || '').trim().toLowerCase()
    ) {
      return false;
    }
    if (
      source !== 'ALL' &&
      String(plan.source || '').trim().toLowerCase() !== String(source || '').trim().toLowerCase()
    ) {
      return false;
    }

    if (
      hasNumericFilter(minPriceKobo) &&
      Number(plan.sellingPriceKobo || 0) < Number(minPriceKobo)
    ) {
      return false;
    }

    if (
      hasNumericFilter(maxPriceKobo) &&
      Number(plan.sellingPriceKobo || 0) > Number(maxPriceKobo)
    ) {
      return false;
    }

    if (!normalizedSearch) return true;

    const searchFingerprint = normalize(
      `${plan.name || ''} ${plan.id || ''} ${plan.network || ''} ${
        plan.category || ''
      } ${plan.durationGroup || plan.duration_group || ''} ${plan.source || ''}`
    );
    return searchFingerprint.includes(normalizedSearch);
  });
}

export function sortPlans(plans = [], sortBy = 'profit_desc') {
  const list = [...plans];

  list.sort((left, right) => {
    if (sortBy === 'new_first') {
      const newPlanDelta = Number(Boolean(right.isNew)) - Number(Boolean(left.isNew));
      if (newPlanDelta !== 0) return newPlanDelta;

      const popularityDelta =
        Number(right.popularity || 0) - Number(left.popularity || 0);
      if (popularityDelta !== 0) return popularityDelta;

      const profitDelta = Number(right.profitKobo || 0) - Number(left.profitKobo || 0);
      if (profitDelta !== 0) return profitDelta;

      return String(left.name || '').localeCompare(String(right.name || ''));
    }

    if (sortBy === 'price_asc') {
      return Number(left.sellingPriceKobo || 0) - Number(right.sellingPriceKobo || 0);
    }

    if (sortBy === 'popularity_desc') {
      const popularityDelta = Number(right.popularity || 0) - Number(left.popularity || 0);
      if (popularityDelta !== 0) return popularityDelta;
      return String(left.name || '').localeCompare(String(right.name || ''));
    }

    if (sortBy === 'name_asc') {
      return String(left.name || '').localeCompare(String(right.name || ''));
    }

    const profitDelta = Number(right.profitKobo || 0) - Number(left.profitKobo || 0);
    if (profitDelta !== 0) return profitDelta;
    return Number(left.sellingPriceKobo || 0) - Number(right.sellingPriceKobo || 0);
  });

  return list;
}

export function buildDashboardAnalytics(plans = []) {
  const totalPlans = plans.length;
  const totalPotentialProfitKobo = plans.reduce(
    (sum, plan) => sum + Number(plan.profitKobo || 0),
    0
  );
  const totalSellingKobo = plans.reduce(
    (sum, plan) => sum + Number(plan.sellingPriceKobo || 0),
    0
  );

  const profitsByNetwork = plans.reduce((accumulator, plan) => {
    const network = String(plan.network || 'OTHER');
    const currentProfit = Number(accumulator[network] || 0);
    accumulator[network] = currentProfit + Number(plan.profitKobo || 0);
    return accumulator;
  }, {});

  const [mostProfitableNetwork = 'N/A'] = Object.entries(profitsByNetwork).sort(
    (left, right) => Number(right[1] || 0) - Number(left[1] || 0)
  )[0] || [];

  const averageProfitMarginBasisPoints =
    totalSellingKobo > 0
      ? Math.round((totalPotentialProfitKobo / totalSellingKobo) * 10000)
      : 0;

  return {
    totalPlans,
    totalPotentialProfitKobo,
    mostProfitableNetwork,
    averageProfitMarginBasisPoints,
  };
}

export function buildChartData(plans = []) {
  const topByProfit = [...plans]
    .sort((left, right) => Number(right.profitKobo || 0) - Number(left.profitKobo || 0))
    .slice(0, 10);

  const networkCounts = plans.reduce((accumulator, plan) => {
    const network = String(plan.network || 'OTHER');
    accumulator[network] = Number(accumulator[network] || 0) + 1;
    return accumulator;
  }, {});

  const categoryCounts = plans.reduce((accumulator, plan) => {
    const category = String(plan.category || 'Other');
    accumulator[category] = Number(accumulator[category] || 0) + 1;
    return accumulator;
  }, {});

  const priceVsProfit = [...plans]
    .sort(
      (left, right) =>
        Number(left.sellingPriceKobo || 0) - Number(right.sellingPriceKobo || 0)
    )
    .slice(0, 60);

  return {
    topByProfit,
    networkCounts,
    categoryCounts,
    priceVsProfit,
  };
}
