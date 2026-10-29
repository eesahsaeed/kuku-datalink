import axios from 'axios';
import {
  buildFallbackDataPlansForNetwork,
  groupData,
  networkTimeout,
  removeDuplicatePackages,
} from '../../lib/helper';

const NETWORK_PLAN_CACHE_TTL_MS = 5 * 60 * 1000;
const networkPlanCache = new Map();
const networkPlanPromiseCache = new Map();

function buildNetworkPlanCacheKey(networkName, providerCodes = []) {
  const providers = providerCodes
    .map((provider) =>
      typeof provider === 'string' ? provider : provider?.provider_code
    )
    .filter(Boolean)
    .map((code) => String(code).trim().toLowerCase())
    .sort()
    .join('|');

  return `${String(networkName || '').trim().toLowerCase()}::${providers}`;
}

export async function loadNetworkPlans({
  networkName,
  providerCodes = [],
  buildPackagesUrl,
  preparePlans = (plans) => plans,
  emptyPlansMessage,
  force = false,
}) {
  const cacheKey = buildNetworkPlanCacheKey(networkName, providerCodes);
  const cachedEntry = networkPlanCache.get(cacheKey);
  const now = Date.now();

  if (
    !force &&
    cachedEntry &&
    now - cachedEntry.loadedAt < NETWORK_PLAN_CACHE_TTL_MS
  ) {
    return cachedEntry.value;
  }

  if (!force && networkPlanPromiseCache.has(cacheKey)) {
    return networkPlanPromiseCache.get(cacheKey);
  }

  if (!Array.isArray(providerCodes) || providerCodes.length === 0) {
    console.warn(
      `[networkPlanLoader] No provider codes supplied for ${networkName}.`
    );
    if (cachedEntry?.value) {
      return cachedEntry.value;
    }
    throw new Error(
      emptyPlansMessage ||
        `[networkPlanLoader] No provider codes supplied for ${networkName}.`
    );
  }

  const requestPromise = (async () => {
    try {
      const responses = await Promise.allSettled(
        providerCodes.map(async (provider) => {
          const providerCode =
            typeof provider === 'string' ? provider : provider?.provider_code;

          if (!providerCode) {
            return [];
          }

          console.log(buildPackagesUrl(providerCode))

          const response = await axios.get(buildPackagesUrl(providerCode), {
            timeout: networkTimeout,
          });

          // console.log(response.data.data);

          return Array.isArray(response.data?.data) ? response.data.data : [];
        })
      );

      const flattenedLivePlans = responses.flatMap((result) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
          return [];
        }

        return result.value;
      });

      if (!flattenedLivePlans.length) {
        console.warn(
          `[networkPlanLoader] No live package data returned for ${networkName}.`
        );
      }

      const preparedLivePlans = preparePlans(flattenedLivePlans);
      const fallbackPlans = buildFallbackDataPlansForNetwork(networkName);
      const mergedPlans = removeDuplicatePackages([
        ...preparedLivePlans,
        ...fallbackPlans,
      ]);
      const preparedPlans = mergedPlans.map((plan) => ({
        ...plan,
      }));

      if (!preparedPlans.length) {
        console.warn(
          `[networkPlanLoader] No plans could be prepared for ${networkName}.`,
          {
            providerCount: providerCodes.length,
            livePlanCount: flattenedLivePlans.length,
          }
        );

        if (cachedEntry?.value) {
          return cachedEntry.value;
        }

        throw new Error(emptyPlansMessage);
      }

      const groupedPlans = groupData(preparedPlans);
      networkPlanCache.set(cacheKey, {
        value: groupedPlans,
        loadedAt: Date.now(),
      });
      return groupedPlans;
    } finally {
      networkPlanPromiseCache.delete(cacheKey);
    }
  })();

  networkPlanPromiseCache.set(cacheKey, requestPromise);
  return requestPromise;
}
