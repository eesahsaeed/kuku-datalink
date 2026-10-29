
import axios from "axios";
import mongoose from "mongoose";

import { fetchDirectortechNetworkPlans } from './services/directortechService.js';
import Plan from "./schema/PlanSchema.js";

const DIRECTORTECH_NETWORKS = Object.freeze([
  {
    network_id: 1,
    provider_code: 'mtn',
    provider_name: 'MTN',
    provider_image_url: '/img/mtn.png',
  },
  {
    network_id: 2,
    provider_code: 'glo',
    provider_name: 'GLO',
    provider_image_url: '/img/glo.png',
  },
  {
    network_id: 3,
    provider_code: '9mobile',
    provider_name: '9Mobile',
    provider_image_url: '/img/t2mobile.png',
  },
  {
    network_id: 4,
    provider_code: 'airtel',
    provider_name: 'Airtel',
    provider_image_url: '/img/airtel-airtime.png',
  },
  {
    network_id: 5,
    provider_code: 'smile',
    provider_name: 'Smile',
    provider_image_url: '/img/smile.png',
  },
]);

// check this object and tell me the difference between package_original_amount and package_amount and package_original_amount
export const getAdminPlanCode = (plan = {}) => {
  const code = String(
    plan?.package_api_code ||
      plan?.packageCode ||
      plan?.planCode ||
      plan?.package_code ||
      plan?.code ||
      plan?.id ||
      ''
  ).trim();

  if (
    code &&
    plan?.id &&
    !plan?.package_api_code &&
    !plan?.packageCode &&
    !plan?.planCode &&
    !plan?.package_code &&
    !plan?.code
  ) {
    return code.replace(/-\d+$/, '');
  }

  return code;
};

export async function getAidapayDataPlans(providerCode) {
  try{
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `https://aidapay.ng/api/v1/packages/${providerCode}`,
      headers: { 
        'Accept': 'application/json', 
        'Authorization': `Bearer ${process.env.AIDAPAY_ACCESS_TOKEN}`
      }
    };

    const plans = await axios(config);

    return extractArrayPayload(plans?.data);

  } catch (error) {
    console.error('Error retrieving data plans:', error);
    throw error;
  }
}

export async function fetchDDSDataPlans(){
  try {
    const planGroups = await Promise.all( 
      DIRECTORTECH_NETWORKS.map(async (networkMeta) => {
        try {
          return await fetchDirectortechNetworkPlans(networkMeta, {
            forceSessionRefresh: false,
            includeAllPlans: true,
          });
        } catch (error) {
          console.warn('[directortech] Failed to load plans for network:', {
            network: networkMeta.provider_code,
            message: error?.message || error,
          });
          return [];
        }
      })
    );

    return planGroups
  } catch(err){
    console.error('Error retrieving data plans:', err);
    throw err;
  }
}

export async function fetchAidapayDataPlans(){
  try{
    const providersConfig = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://aidapay.ng/api/v1/service/data-bundle-sme',
      headers: { 
        'Accept': 'application/json', 
        'Authorization': `Bearer ${process.env.AIDAPAY_ACCESS_TOKEN}`
      }
    };

    const providers = await axios(providersConfig);
    const providerRecords = extractArrayPayload(providers?.data);

    let plans = [];

    for (const provider of providerRecords) {
      const providerCode =
        provider?.provider_code || provider?.code || provider?.provider;

      if (!providerCode) {
        continue;
      }

      const providerPlans = await getAidapayDataPlans(providerCode);
      plans = plans.concat(providerPlans);
    }

    return plans;

  } catch(err){
    console.error('Error retrieving Aidapay data plans:', err);
    throw err;
  }
}

export const readPlanOverrides = async () => {
  const [planOverrides, legacyPlans] = await Promise.all([
    Plan.find({}).lean(),
    mongoose.connection.readyState === 1 && mongoose.connection.db
      ? mongoose.connection.db.collection('plans').find({}).toArray()
      : Promise.resolve([]),
  ]);
  const plansByCode = new Map();

  [...legacyPlans, ...planOverrides].forEach((plan) => {
    const planCode = getAdminPlanCode(plan);
    if (!planCode) return;

    const existingPlan = plansByCode.get(planCode.toUpperCase());
    const existingTime = existingPlan
      ? new Date(existingPlan.updatedAt || existingPlan.createdAt || 0).getTime()
      : -1;
    const planTime = new Date(plan.updatedAt || plan.createdAt || 0).getTime();

    if (!existingPlan || planTime >= existingTime) {
      plansByCode.set(planCode.toUpperCase(), {
        ...plan,
        planCode,
        packageCode: plan.packageCode || planCode,
      });
    }
  });

  return [...plansByCode.values()];
};

function extractArrayPayload(payload = {}) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const arrayKeys = ['data', 'providers', 'results', 'items', 'plans', 'products'];

  for (const key of arrayKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  for (const key of ['data', 'result', 'payload']) {
    if (payload[key] && typeof payload[key] === 'object') {
      const nestedArray = extractArrayPayload(payload[key]);
      if (nestedArray.length > 0 || Array.isArray(payload[key])) {
        return nestedArray;
      }
    }
  }

  const arrayValues = Object.values(payload).filter(Array.isArray);
  if (arrayValues.length > 0) {
    return arrayValues.flat();
  }

  const objectValues = Object.values(payload);
  if (
    objectValues.length > 0 &&
    objectValues.every(
      (value) => value && typeof value === 'object' && !Array.isArray(value)
    )
  ) {
    return objectValues;
  }

  return [];
}

export function mergePlans(data) {
  const plans = {
    mtn: [],
    glo: [],
    airtel: [],
    "9mobile": []
  };

  // Helper to map provider_code / provider_name to network key
  const toNetwork = (codeOrName) => {
    if (!codeOrName) return null;
    const lower = String(codeOrName).toLowerCase();

    if (lower.includes("mtn")) return "mtn";
    if (lower.includes("glo")) return "glo";
    if (lower.includes("airtel")) return "airtel";
    if (lower.includes("9mobile") || lower.includes("9 mobile") || lower === "9mobile") {
      return "9mobile";
    }
    return null;
  };

  // 1. Process aidapayPlans
  if (Array.isArray(data.aidapayPlans)) {
    data.aidapayPlans.forEach((plan) => {
      const network = toNetwork(plan.provider_code);
      if (network && plans[network]) {
        plans[network].push({
          ...plan,
          source: "aidapay"
        });
      }
    });
  }

  // 2. Process ddsPlans (array of arrays)
  if (Array.isArray(data.ddsPlans)) {
    data.ddsPlans.forEach((networkPlans) => {
      if (!Array.isArray(networkPlans) || networkPlans.length === 0) return;

      // Use the first item to determine the network
      const first = networkPlans[0];
      const network =
        toNetwork(first.provider_code) ||
        toNetwork(first.provider_name);

      if (network && plans[network]) {
        networkPlans.forEach((plan) => {
          plans[network].push({
            ...plan,
            source: "dds" // or "directortech"
          });
        });
      }
    });
  }

  return plans;
}

export function mergePackagesByApiCode(firstObj = {}, secondArr = []) {
  const getPackageCode = (item = {}) =>
    String(
      item?.package_api_code ||
        item?.packageCode ||
        item?.planCode ||
        item?.package_code ||
        item?.code ||
        item?.id ||
        ''
    ).trim();

  const getPackageCodeKeys = (item = {}) => {
    const packageCode = getPackageCode(item);
    if (!packageCode) return [];

    const keys = [packageCode.toUpperCase()];
    const hasLegacyRowId =
      !item?.package_api_code &&
      !item?.packageCode &&
      !item?.planCode &&
      !item?.package_code &&
      !item?.code &&
      item?.id;

    if (hasLegacyRowId && /-\d+$/.test(packageCode)) {
      keys.push(packageCode.replace(/-\d+$/, '').toUpperCase());
    }

    return keys;
  };

  const overridesByCode = new Map();
  (Array.isArray(secondArr) ? secondArr : []).forEach((override) => {
    getPackageCodeKeys(override).forEach((packageCode) => {
      overridesByCode.set(packageCode, override);
    });
  });

  return Object.fromEntries(
    Object.entries(firstObj || {}).map(([network, packages]) => [
      network,
      (Array.isArray(packages) ? packages : []).map((plan) => {
        const packageCode = getPackageCode(plan);
        const override = overridesByCode.get(packageCode.toUpperCase());

        if (!override) {
          return { ...plan };
        }

        // Database admin values must win over live provider values.
        return {
          ...plan,
          ...override,
          package_api_code: packageCode,
          package_code: packageCode,
        };
      }),
    ])
  );
}

export function getCustomerPlans(firstObj = {}, secondArr = []) {
  const getPackageCode = (item = {}) =>
    String(
      item?.package_api_code ||
        item?.packageCode ||
        item?.planCode ||
        item?.package_code ||
        item?.code ||
        item?.id ||
        ''
    ).trim();

  const getPackageCodeKeys = (item = {}) => {
    const packageCode = getPackageCode(item);
    if (!packageCode) return [];

    const keys = [packageCode.toUpperCase()];
    const hasLegacyRowId =
      !item?.package_api_code &&
      !item?.packageCode &&
      !item?.planCode &&
      !item?.package_code &&
      !item?.code &&
      item?.id;

    if (hasLegacyRowId && /-\d+$/.test(packageCode)) {
      keys.push(packageCode.replace(/-\d+$/, '').toUpperCase());
    }

    return keys;
  };

  const overridesByCode = new Map();
  (Array.isArray(secondArr) ? secondArr : []).forEach((override) => {
    getPackageCodeKeys(override).forEach((packageCode) => {
      overridesByCode.set(packageCode, override);
    });
  });

  return Object.fromEntries(
    Object.entries(firstObj || {}).map(([network, packages]) => [
      network,
      (Array.isArray(packages) ? packages : [])
        .filter((plan) => {
          const packageCode = getPackageCode(plan);
          return packageCode && overridesByCode.has(packageCode.toUpperCase());
        })
        .map((plan) => {
          const packageCode = getPackageCode(plan);
          const override = overridesByCode.get(packageCode.toUpperCase());

          // Database admin values must win over live provider values.
          return {
            ...plan,
            ...override,
            package_api_code: packageCode,
            package_code: packageCode,
          };
        }),
    ])
  );
}
