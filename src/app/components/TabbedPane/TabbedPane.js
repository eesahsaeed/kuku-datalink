import React from 'react';
import {
  formatToNaira,
  cleanAndCapitalize,
  getDataPlanPricingMeta,
  sortPlanGroupKeysByDuration,
} from '../../../lib/helper';

const normalizeDurationLabel = (days) => {
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  if (days >= 28 && days <= 31) return "Monthly";
  if (days === 365) return "Yearly";
  if (days % 30 === 0) return `${days / 30} Month(s)`;
  return `${days} Day(s)`;
};

const getDurationRank = (label = "") => {
  const normalized = String(label).toLowerCase();
  if (normalized === "daily") return 1;
  if (normalized === "weekly") return 7;
  if (normalized === "monthly") return 30;
  if (normalized === "yearly") return 365;
  const monthMatch = normalized.match(/(\d+)\s*month/);
  if (monthMatch) return Number(monthMatch[1]) * 30;
  const dayMatch = normalized.match(/(\d+)\s*day/);
  if (dayMatch) return Number(dayMatch[1]);
  return Number.MAX_SAFE_INTEGER;
};

const sortDurationKeys = (keys = []) => [...keys].sort((a, b) => getDurationRank(a) - getDurationRank(b));

function sortPlansByLowestVisiblePrice(plans = []) {
  return [...plans]
    .map((plan, index) => ({
      plan,
      index,
      amount: resolveVisiblePlanAmount(
        plan,
        getDataPlanPricingMeta(plan.package_api_code)
      ),
    }))
    .sort((planA, planB) => {
      if (planA.amount !== planB.amount) {
        return planA.amount - planB.amount;
      }
      return planA.index - planB.index;
    })
    .map((entry) => entry.plan);
}

function isPlanExcluded(plan = {}) {
  console.log(plan)
  const pricingMeta = getDataPlanPricingMeta(plan.package_api_code);
  const isTrue = (value) =>
    value === true ||
    value === 1 ||
    String(value || '').trim().toLowerCase() === 'true';

  return isTrue(plan?.exclude) || isTrue(pricingMeta?.exclude);
}

function getVisiblePlansForGroup(plans = []) {
  return sortPlansByLowestVisiblePrice(
    (Array.isArray(plans) ? plans : []).filter((plan) => !isPlanExcluded(plan))
  );
}

function resolveVisiblePlanAmount(plan = {}, pricingMeta = null) {
  const backendAmount = Number(
    plan?.sellingPrice ??
      plan?.price ??
      pricingMeta?.sellingPrice ??
      pricingMeta?.price ??
      plan?.package_amount ??
      plan?.package_original_amount ??
      pricingMeta?.package_original_amount ??
      pricingMeta?.originalPrice ??
      plan?.amount ??
      plan?.rawPrice ??
      0
  );

  return Number.isFinite(backendAmount) && backendAmount > 0 ? backendAmount : 0;
}

const groupPlansByDuration = (plans = []) => {
  const grouped = {};
  const keywordMap = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    yearly: 365,
    annually: 365,
  };

  for (const plan of plans) {
    if (plan?.exclude === true) {
      continue;
    }

    const packageName = String(plan?.package_name || "").toLowerCase();
    let bucket = "Other";

    for (const [keyword, days] of Object.entries(keywordMap)) {
      if (packageName.includes(keyword)) {
        bucket = normalizeDurationLabel(days);
        break;
      }
    }

    if (bucket === "Other") {
      const match = packageName.match(/(\d+)\s*(day|month|week|year)s?/i);
      if (match) {
        const value = Number(match[1]);
        const unit = String(match[2]).toLowerCase();
        const multiplier = {
          day: 1,
          week: 7,
          month: 30,
          year: 365,
        };
        bucket = normalizeDurationLabel(value * (multiplier[unit] || 0));
      }
    }

    if (!grouped[bucket]) grouped[bucket] = [];
    grouped[bucket].push(plan);
  }

  Object.keys(grouped).forEach((bucket) => {
    grouped[bucket] = sortPlansByLowestVisiblePrice(grouped[bucket]);
  });

  return grouped;
};

function normalizeToGroupedPlans(dataPlans, selectedNetwork) {
  // dataPlans can be:
  // 1. Flat array of plans
  // 2. Object keyed by network → Plan[]
  // 3. Already grouped by durationGroup
  let plans = [];

  if (Array.isArray(dataPlans)) {
    plans = dataPlans;
  } else if (dataPlans && typeof dataPlans === 'object') {
    const selectedNetworkKey = Object.keys(dataPlans).find(
      (key) =>
        String(key).trim().toLowerCase() ===
        String(selectedNetwork || '').trim().toLowerCase()
    );
    plans = selectedNetworkKey ? dataPlans[selectedNetworkKey] || [] : [];
  }

  return groupPlansByDuration(plans);
}

export default function TabbedPane({
  selectedNetwork,
  dataPlans,
  airtimeOrdata, // kept for compatibility, currently unused
  selectedTabKey: controlledTabKey,
  selectedPlanCode: controlledPlanCode,
  onSelectedTabChange,
  onPlanSelect,
}) {
  const [selectedPlanData, setSelectedPlanData] = React.useState(null);
  const [selectedTabKey, setSelectedTabKey] = React.useState('');

  const groupedPlans = React.useMemo(
    () => normalizeToGroupedPlans(dataPlans, selectedNetwork),
    [dataPlans, selectedNetwork]
  );

  const visiblePlansByKey = React.useMemo(() => {
    return Object.fromEntries(
      sortDurationKeys(Object.keys(groupedPlans))
        .map((key) => {
          const visiblePlans = getVisiblePlansForGroup(groupedPlans[key]);
          return [key, visiblePlans];
        })
        .filter(([, visiblePlans]) => Array.isArray(visiblePlans) && visiblePlans.length > 0)
    );
  }, [groupedPlans]);

  const planKeys = React.useMemo(
    () => Object.keys(visiblePlansByKey),
    [visiblePlansByKey]
  );

  const preferredTabKey = controlledTabKey ?? selectedTabKey;
  const activeTabKey = planKeys.includes(preferredTabKey)
    ? preferredTabKey
    : planKeys[0] || '';

  const selectedPlanCode = controlledPlanCode ?? selectedPlanData?.package_api_code;

  const selectTab = (key) => {
    const nextTabKey = String(key || '');
    setSelectedTabKey(nextTabKey);
    onSelectedTabChange?.(nextTabKey);
  };

  // Keep selected tab in sync when planKeys change
  React.useEffect(() => {
    if (planKeys.length && !planKeys.includes(preferredTabKey)) {
      selectTab(planKeys[0]);
    }
  }, [planKeys, preferredTabKey]);

  const planKeysWithNew = React.useMemo(() => {
    return planKeys.reduce((acc, key) => {
      const plans = visiblePlansByKey[key] || [];
      acc[key] = plans.some((plan) => Boolean(plan?.isNew) && !isPlanExcluded(plan));
      return acc;
    }, {});
  }, [planKeys, visiblePlansByKey]);

  if (planKeys.length === 0) {
    return null;
  }

  const activePlans = (visiblePlansByKey[activeTabKey] || []).slice(0, 8);

  return (
    <div className="home-plan-filter" aria-label="Available data plans">
      <div className="home-duration-filter" role="tablist" aria-label="Plan duration">
        {planKeys.map((key) => (
          <button
            className={`home-duration-filter-button${
              activeTabKey === key ? ' active' : ''
            }`}
            type="button"
            role="tab"
            aria-selected={activeTabKey === key}
            key={key}
            onClick={() => selectTab(key)}
          >
            <span>{cleanAndCapitalize(key)}</span>
            {planKeysWithNew[key] ? <small>New</small> : null}
          </button>
        ))}
      </div>

      <div className="home-plan-filter-list" role="tabpanel">
        {activePlans.map((plan, index) => {
          const pricingMeta = getDataPlanPricingMeta(plan.package_api_code);
          const displayAmount = resolveVisiblePlanAmount(plan, pricingMeta);
          const isSelected =
            plan.package_api_code === selectedPlanCode ||
            plan.package_code === selectedPlanCode;

          return (
            <button
              key={`${activeTabKey}-${plan.package_api_code}-${index}`}
              type="button"
              className={`home-plan-filter-row${isSelected ? ' active' : ''}`}
              onClick={() => {
                setSelectedPlanData(plan);
                onPlanSelect?.(plan, activeTabKey);
              }}
            >
              <span className="home-plan-filter-name">
                {plan.package_name}
                {plan.isNew ? <small>New</small> : null}
              </span>
              {isSelected ? <span aria-hidden="true">✓</span> : null}
              <strong>{formatToNaira(displayAmount)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}