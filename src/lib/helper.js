export const networkTimeout = 30000;

export const airtimeCommissionRates = {
  'mtn-airtime': 2.1,
  'glo-airtime': 4.0,
  'airtel-airtime': 1.5,
  '9mobile-airtime': 1.85,
};

export function formatNaira(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return "₦0";
  }

  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

const roundToMoneyPrecision = (value = 0) =>
  Number(Number(value || 0).toFixed(3));

const roundSellingPriceToTens = (value = 0) =>
  Math.ceil(Number(value || 0) / 10) * 10;

const isBrowserRuntime =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

const calculatePlanPricing = (originalAmountLike = 0, pricingContext = {}) => {
  const originalAmount = Number(originalAmountLike);
  const source = String(pricingContext?.source || '').trim().toLowerCase();

  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return null;
  }

  if (source === 'directortech') {
    const charges = originalAmount * 0.02;
    const commissionCandidate = Number(pricingContext?.commission);
    const commission = Number.isFinite(commissionCandidate)
      ? commissionCandidate
      : 0;
    const sellingPrice = roundSellingPriceToTens(originalAmount + charges);

    return {
      commission: roundToMoneyPrecision(commission),
      fee: 0,
      charges: roundToMoneyPrecision(charges),
      gain: 0,
      extra: roundToMoneyPrecision(charges),
      markup: roundToMoneyPrecision(charges),
      sellingPrice,
    };
  }

  const markup = originalAmount * 0.015;
  const fee = originalAmount * 0.002;
  const charges = originalAmount * 0.013;
  const sellingPrice = roundSellingPriceToTens(originalAmount + markup);
  const gain = sellingPrice - originalAmount - fee - charges;

  return {
    commission: roundToMoneyPrecision(fee),
    fee: roundToMoneyPrecision(fee),
    charges: roundToMoneyPrecision(charges),
    gain: roundToMoneyPrecision(gain),
    extra: roundToMoneyPrecision(charges),
    markup: roundToMoneyPrecision(markup),
    sellingPrice,
  };
};

export const liveDataDetailsStore = {};

const normalizeDataDetailsPricingRecord = (record = {}) => {
  if (!record || typeof record !== "object") {
    return record;
  }

  const hasExplicitNumericValue = (value) =>
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    Number.isFinite(Number(value));

  const originalAmount = Number(
    record?.package_original_amount ??
      record?.originalPrice ??
      record?.package_amount ??
      record?.price ??
      record?.amount ??
      record?.rawPrice
  );
  const normalizeNumericValue = isBrowserRuntime
    ? (value) => Number(value)
    : (value) => roundToMoneyPrecision(Number(value));
  const normalizeSellingPriceValue = isBrowserRuntime
    ? (value) => Number(value)
    : (value) => roundSellingPriceToTens(Number(value));

  const normalizedRecord = {
    ...record,
    originalPrice:
      Number.isFinite(originalAmount) && originalAmount > 0
        ? normalizeNumericValue(originalAmount)
        : record?.originalPrice,
    package_original_amount:
      Number.isFinite(originalAmount) && originalAmount > 0
        ? normalizeNumericValue(originalAmount)
        : record?.package_original_amount,
  };

  if (!isBrowserRuntime) {
    const calculatedPricing = calculatePlanPricing(originalAmount, record);

    if (calculatedPricing) {
      Object.assign(normalizedRecord, calculatedPricing);
    }
  }

  if (hasExplicitNumericValue(record?.commission)) {
    normalizedRecord.commission = normalizeNumericValue(record.commission);
  }
  if (hasExplicitNumericValue(record?.fee)) {
    normalizedRecord.fee = normalizeNumericValue(record.fee);
  }
  if (hasExplicitNumericValue(record?.gain)) {
    normalizedRecord.gain = normalizeNumericValue(record.gain);
  }
  if (hasExplicitNumericValue(record?.extra)) {
    normalizedRecord.extra = normalizeNumericValue(record.extra);
  }
  if (hasExplicitNumericValue(record?.markup)) {
    normalizedRecord.markup = normalizeNumericValue(record.markup);
  }
  if (hasExplicitNumericValue(record?.sellingPrice)) {
    normalizedRecord.sellingPrice = normalizeSellingPriceValue(
      record.sellingPrice
    );
  }

  if (
    normalizedRecord?.replacement_data_details &&
    typeof normalizedRecord.replacement_data_details === "object" &&
    !Array.isArray(normalizedRecord.replacement_data_details)
  ) {
    normalizedRecord.replacement_data_details = Object.fromEntries(
      Object.entries(normalizedRecord.replacement_data_details).map(
        ([replacementCode, replacementRecord]) => [
          replacementCode,
          normalizeDataDetailsPricingRecord(replacementRecord),
        ]
      )
    );
  }

  return normalizedRecord;
};

export function buildLiveDataDetailsSnapshot(plans = []) {
  const liveDataDetails = {};

  (Array.isArray(plans) ? plans : []).forEach((plan = {}) => {
    const packageCode = normalizeReplacementPackageCode(
      plan?.package_api_code || plan?.package_code
    );

    if (!packageCode) {
      return;
    }

    const packageOriginalAmount = Number(
      plan?.package_original_amount ??
        plan?.originalPrice ??
        plan?.package_amount ??
        plan?.price ??
        plan?.amount ??
        plan?.rawPrice ??
        0
    );
    const directortechNetworkId = Number(
      plan?.directortech_network_id ?? plan?.network_id
    );
    const normalizedDirectortechNetworkId =
      Number.isFinite(directortechNetworkId) && directortechNetworkId > 0
        ? roundToMoneyPrecision(directortechNetworkId)
        : undefined;
    const normalizedRecord = normalizeDataDetailsPricingRecord({
      package_code: packageCode,
      package_name: String(
        plan?.package_name || plan?.name || packageCode || ''
      ).trim(),
      package_original_amount: packageOriginalAmount,
      originalPrice: packageOriginalAmount,
      replacement_package_api_codes: normalizeReplacementPackageCodeList(
        plan?.replacement_package_api_codes
      ),
      provider_name: String(plan?.provider_name || '').trim(),
      provider_code: String(
        plan?.provider_code || plan?.provider || ''
      ).trim(),
      network_id: normalizedDirectortechNetworkId,
      directortech_network_id: normalizedDirectortechNetworkId,
      directortech_plan_id: String(
        plan?.directortech_plan_id || plan?.package_api_code || plan?.package_code || ''
      ).trim(),
      directortech_plan_type: String(
        plan?.directortech_plan_type || plan?.plan_type || ''
      ).trim(),
      directortech_raw_label: String(plan?.directortech_raw_label || '').trim(),
      catalog_source: String(plan?.catalog_source || '').trim(),
      source: String(plan?.source || 'aidapay').trim().toLowerCase(),
      isNew: Boolean(plan?.isNew),
    });

    liveDataDetails[packageCode] = {
      ...normalizedRecord,
      package_api_code: packageCode,
    };
  });

  return liveDataDetails;
}

export function mergeDataDetailsSnapshots(...snapshots) {
  const mergedSnapshots = {};

  snapshots
    .filter((snapshot) => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    .forEach((snapshot) => {
      Object.entries(snapshot).forEach(([packageCode, pricingMeta]) => {
        if (!packageCode || !pricingMeta || typeof pricingMeta !== 'object') {
          return;
        }

        mergedSnapshots[packageCode] = normalizeDataDetailsPricingRecord({
          ...(mergedSnapshots[packageCode] || {}),
          ...pricingMeta,
          package_api_code: packageCode,
          package_code: packageCode,
        });
      });
    });

  return mergedSnapshots;
}

export function isDev(){
  return process.env.NODE_ENV === 'development';
}

export const airtimeProviders = {
  MTN: {
    provider_name: 'MTN',
    provider_code: 'mtn-airtime',
    min_amount: 50,
    max_amount: 5000,
    ref_commission: null,
    provider_info: 'Dial *310# to check airtime balance.',
    agent_percent: '2.1',
    provider_image: 'mtn.png',
    provider_image_url: 'https://aidapay.ng/images/panel/providers/mtn.png',
  },
  AIRTEL: {
    provider_name: 'Airtel',
    provider_code: 'airtel-airtime',
    min_amount: 100,
    max_amount: 5000,
    ref_commission: null,
    provider_info: 'Dial *310# to check airtime balance',
    agent_percent: '1.5',
    provider_image: 'airtel-airtime.png',
    provider_image_url:
      'https://aidapay.ng/images/panel/providers/airtel-airtime.png',
  },
  T2MOBILE: {
    provider_name: '9Mobile',
    provider_code: '9mobile-airtime',
    min_amount: 100,
    max_amount: 5000,
    ref_commission: null,
    provider_info: 'Dial *232# to check Airtime balance',
    agent_percent: '1.85',
    provider_image: '9mobile-airtime.png',
    provider_image_url:
      'https://aidapay.ng/images/panel/providers/9mobile-airtime.png',
  },
  GLO: {
    provider_name: 'GLO',
    provider_code: 'glo-airtime',
    min_amount: 100,
    max_amount: 5000,
    ref_commission: 1,
    provider_info: 'Dial #124*1# to check airtime balance',
    agent_percent: '4',
    provider_image: 'glo-airtime.png',
    provider_image_url:
      'https://aidapay.ng/images/panel/providers/glo-airtime.png',
  },
};

export const regions = [
  {
    Provider: 'IE',
    'Full Name': 'Ikeja Electricity',
    Region: 'Abule Egba, Akowonjo, Ikeja, Ikorodu, Oshodi and Shomolu in Lagos',
  },
  {
    Provider: 'EKEDC',
    'Full Name': 'Eko Electricity Distribution Company',
    Region:
      'Lekki, Ibeju, Islands, Ajah, Ajele, Orile, Ijora, Apapa, Mushin, Festac, Ojo, and Agbara in Lagos',
  },
  {
    Provider: 'AEDC',
    'Full Name': 'Abuja Electricity Distribution Company',
    Region: 'FCT Abuja, Kogi, Niger, and Nasarawa States',
  },
  {
    Provider: 'YEDC',
    'Full Name': 'Yola Electricity Distribution Company',
    Region: 'Adamawa, Taraba, Borno, and Yobe states',
  },
  {
    Provider: 'BEDC',
    'Full Name': 'Benin Electricity Distribution Company',
    Region: 'Delta, Edo, Ekiti, and Ondo States',
  },
  {
    Provider: 'IBEDC',
    'Full Name': 'Ibadan Electricity Distribution Company',
    Region: 'Oyo, Ibadan, Osun, Ogun & Kwara States',
  },
  {
    Provider: 'KEDCO',
    'Full Name': 'Kano Electricity Distribution Company',
    Region: 'Kano, Katsina, and Jigawa States',
  },
  {
    Provider: 'KAEDC',
    'Full Name': 'Kaduna Electricity Distribution Company',
    Region: 'Kaduna, Kebbi, Sokoto and Zamfara States',
  },
  {
    Provider: 'PHED',
    'Full Name': 'Port Harcourt Electricity Distribution Company',
    Region: 'Rivers, Bayelsa, Cross River and Akwa-Ibom States',
  },
  {
    Provider: 'EEDC',
    'Full Name': 'Enugu Electricity Distribution Company',
    Region: 'Abia, Anambra, Ebonyi, Enugu and Imo States',
  },
];

function normalizeProviderArray(input) {
  if (Array.isArray(input)) {
    return input;
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  if (Array.isArray(input.data)) {
    return input.data;
  }

  if (Array.isArray(input.providers)) {
    return input.providers;
  }

  if (Array.isArray(input.results)) {
    return input.results;
  }

  return Object.values(input).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item)
  );
}

export function transformProviders(providers) {
  const regionMapping = {
    kaduna: 'Kaduna, Kebbi, Sokoto, Zamfara',
    bedc: 'Delta, Edo, Ekiti, Ondo',
    enugu: 'Abia, Anambra, Ebonyi, Enugu, Imo',
    aedc: 'Federal Capital Territory (Abuja), Kogi, Nasarawa, Niger',
    jed: 'Bauchi, Benue, Gombe, Plateau',
    phed: 'Akwa Ibom, Bayelsa, Cross River, Rivers',
    kedco: 'Jigawa, Kano, Katsina',
    eedc: 'Southern Lagos (Festac, Ijora, Lekki, Ajah, Apapa, Islands, Mushin, Ojo, Orile, Ibeju, Agbara in Ogun)',
    ikedc:
      'Northern Lagos (Abule Egba, Akowonjo, Ikeja, Ikorodu, Oshodi, Shomolu)',
    ibedc: 'Oyo, Ogun, Osun, Kwara, parts of Ekiti, Kogi, Niger',
  };

    return normalizeProviderArray(providers)
      .filter((provider) => provider && typeof provider === 'object')
      .map((provider) => {
      const code = provider.provider_code;

      return {
        ...provider,
        provider_image_url: `/img/${code}-logo.png`,
        region: regionMapping[code] || 'Region not specified',
      };
      });
  }

export function removeLastNonWordChar(str) {
  if (typeof str !== 'string' || str.length === 0) {
    return str;
  }

  // Check if the last character is NOT a word character (alphanumeric or underscore)
  if (!/\w$/.test(str)) {
    return str.slice(0, -1);
  }

  // If it is a word character, return the string unchanged
  return str;
}

export const dataPlans = {
  MTN: {
    '1_day': [
      {
        provider: 'MTN Nigeria',
        plan_name: '75MB Daily Plan',
        data_allowance: '75MB',
        price_naira: 75,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '110MB Daily Plan',
        data_allowance: '110MB',
        price_naira: 100,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '1GB + 15 Mins Call Daily Plan',
        data_allowance: '1GB',
        price_naira: 500,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: 'MTN 1GB Daily - AWUF',
        data_allowance: '1GB',
        price_naira: 230,
        biller_code: 'BIL108',
        package_api_code: 'PK-MTN-1GB-SmartData-AWUF',
        provider_code: 'mtn-awuf-data',
        package_amount: 226.71,
        package_original_amount: 230,
      },
      {
        provider: 'MTN Nigeria',
        plan_name: 'MTN 2.5GB Daily - AWUF',
        data_allowance: '2.5GB',
        price_naira: 550,
        biller_code: 'BIL108',
        package_api_code: 'PK-MTN-2.5GB-SmartData-AWUF',
        provider_code: 'mtn-awuf-data',
        package_amount: 542.13,
        package_original_amount: 550,
      },
      {
        provider: 'MTN Nigeria',
        plan_name: 'MTN 1GB Daily - AWUF',
        data_allowance: '1GB',
        price_naira: 230,
        biller_code: 'BIL108',
        package_api_code: 'PK-MTN-1GB-SmartData',
        provider_code: 'mtn-sme',
        package_amount: 221.76,
        package_original_amount: 230,
      },
    ],
    '2_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '2.5GB 2-Day Plan',
        data_allowance: '2.5GB',
        price_naira: 900,
        biller_code: 'BIL108',
      },
    ],
    '7_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '1.2GB Weekly Pulse',
        data_allowance: '1.2GB',
        price_naira: 750,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '3.5GB Weekly Plan',
        data_allowance: '3.5GB',
        price_naira: 1500,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '20GB Weekly Plan',
        data_allowance: '20GB',
        price_naira: 5000,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: 'MTN 1.5GB - Weekly',
        data_allowance: '1.5GB',
        price_naira: 985,
        biller_code: 'BIL108',
        package_api_code: 'PK-MTN-PUZI-7DX',
        provider_code: 'mtn-sme',
        package_amount: 978.1,
        package_original_amount: 985,
      },
    ],
    '30_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '7GB Monthly Plan',
        data_allowance: '7GB',
        price_naira: 3500,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '25GB Monthly Plan',
        data_allowance: '25GB',
        price_naira: 9000,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: '165GB Monthly Plan',
        data_allowance: '165GB',
        price_naira: 35000,
        biller_code: 'BIL108',
      },
      {
        provider: 'MTN Nigeria',
        plan_name: 'MTN 2GB - 1 Month + 2mins Call Credit',
        data_allowance: '2GB',
        price_naira: 1477,
        biller_code: 'BIL108',
        package_api_code: 'PK-MTN-HDPX',
        provider_code: 'mtn-sme',
        package_amount: 1466.66,
        package_original_amount: 1477,
      },
    ],
    '60_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '150GB 2-Month Plan',
        data_allowance: '150GB',
        price_naira: 40000,
        biller_code: 'BIL108',
      },
    ],
    '90_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '480GB Quarterly Plan',
        data_allowance: '480GB',
        price_naira: 90000,
        biller_code: 'BIL108',
      },
    ],
    '365_days': [
      {
        provider: 'MTN Nigeria',
        plan_name: '800GB Yearly Plan',
        data_allowance: '800GB',
        price_naira: 125000,
        biller_code: 'BIL108',
      },
    ],
  },

  GLO: {
    '1_day': [
      {
        provider: 'Glo Nigeria',
        plan_name: '125MB Daily Plan (Inc. Night Bonus)',
        data_allowance: '125MB',
        price_naira: 100,
        biller_code: 'BIL109',
      },
    ],
    '2_days': [
      {
        provider: 'Glo Nigeria',
        plan_name: '275MB 2-Day Plan (Inc. Night Bonus)',
        data_allowance: '275MB',
        price_naira: 200,
        biller_code: 'BIL109',
      },
    ],
    '7_days': [
      {
        provider: 'Glo Nigeria',
        plan_name: '1.55GB Weekly Plan (Inc. Night Bonus)',
        data_allowance: '1.55GB',
        price_naira: 500,
        biller_code: 'BIL109',
      },
      {
        provider: 'Glo Nigeria',
        plan_name: '3.7GB Weekly Plan (Inc. Night Bonus)',
        data_allowance: '3.7GB',
        price_naira: 1000,
        biller_code: 'BIL109',
      },
    ],
    '30_days': [
      {
        provider: 'Glo Nigeria',
        plan_name: '2.6GB Monthly Plan (Inc. Night Bonus)',
        data_allowance: '2.6GB',
        price_naira: 1000,
        biller_code: 'BIL109',
      },
      {
        provider: 'Glo Nigeria',
        plan_name: '16.5GB Monthly Plan (Inc. Night Bonus)',
        data_allowance: '16.5GB',
        price_naira: 5000,
        biller_code: 'BIL109',
      },
      {
        provider: 'Glo Nigeria',
        plan_name: '165GB Monthly Plan (Mega)',
        data_allowance: '165GB',
        price_naira: 30000,
        biller_code: 'BIL109',
      },
    ],
    '60_days': [
      {
        provider: 'Glo Nigeria',
        plan_name: '355GB 2-Month Plan (Mega)',
        data_allowance: '355GB',
        price_naira: 60000,
        biller_code: 'BIL109',
      },
    ],
  },

  AIRTEL: {
    '1_day': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '100MB Daily Plan',
        data_allowance: '100MB',
        price_naira: 100,
        biller_code: 'BIL110',
      },
      {
        provider: 'Airtel Nigeria',
        plan_name: '1GB Daily Plan',
        data_allowance: '1GB',
        price_naira: 350,
        biller_code: 'BIL110',
      },
    ],
    '2_days': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '2GB 2-Day Plan',
        data_allowance: '2GB',
        price_naira: 500,
        biller_code: 'BIL110',
      },
    ],
    '7_days': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '1.5GB Weekly Plan',
        data_allowance: '1.5GB',
        price_naira: 1000,
        biller_code: 'BIL110',
      },
      {
        provider: 'Airtel Nigeria',
        plan_name: '6GB Weekly Plan',
        data_allowance: '6GB',
        price_naira: 2500,
        biller_code: 'BIL110',
      },
    ],
    '30_days': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '8GB Monthly Plan',
        data_allowance: '8GB',
        price_naira: 3000,
        biller_code: 'BIL110',
      },
      {
        provider: 'Airtel Nigeria',
        plan_name: '18GB Monthly Plan',
        data_allowance: '18GB',
        price_naira: 6000,
        biller_code: 'BIL110',
      },
      {
        provider: 'Airtel Nigeria',
        plan_name: '160GB Monthly Plan',
        data_allowance: '160GB',
        price_naira: 30000,
        biller_code: 'BIL110',
      },
    ],
    '90_days': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '300GB Quarterly Plan',
        data_allowance: '300GB',
        price_naira: 50000,
        biller_code: 'BIL110',
      },
    ],
    '365_days': [
      {
        provider: 'Airtel Nigeria',
        plan_name: '650GB Yearly Plan',
        data_allowance: '650GB',
        price_naira: 100000,
        biller_code: 'BIL110',
      },
    ],
  },

  T2MOBILE: {
    '1_day': [
      {
        provider: '9mobile Nigeria',
        plan_name: '200MB Daily Plan',
        data_allowance: '200MB',
        price_naira: 100,
        biller_code: 'BIL111',
      },
      {
        provider: '9mobile Nigeria',
        plan_name: '1GB Daily Plan',
        data_allowance: '1GB',
        price_naira: 500,
        biller_code: 'BIL111',
      },
    ],
    '2_days': [
      {
        provider: '9mobile Nigeria',
        plan_name: '2GB 2-Day Plan',
        data_allowance: '2GB',
        price_naira: 1000,
        biller_code: 'BIL111',
      },
    ],
    '7_days': [
      {
        provider: '9mobile Nigeria',
        plan_name: '7GB Weekly Plan',
        data_allowance: '7GB',
        price_naira: 1500,
        biller_code: 'BIL111',
      },
    ],
    '30_days': [
      {
        provider: '9mobile Nigeria',
        plan_name: '11GB Monthly Plan',
        data_allowance: '11GB',
        price_naira: 4000,
        biller_code: 'BIL111',
      },
      {
        provider: '9mobile Nigeria',
        plan_name: '40GB Monthly Plan',
        data_allowance: '40GB',
        price_naira: 10000,
        biller_code: 'BIL111',
      },
      {
        provider: '9mobile Nigeria',
        plan_name: '125GB Monthly Plan',
        data_allowance: '125GB',
        price_naira: 18000,
        biller_code: 'BIL111',
      },
    ],
  },
};

function slugifyPlanIdentifier(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function buildNineMobileDataPackageCode({ groupKey = '', index = 0, plan = {} }) {
  const seed = [
    groupKey,
    index + 1,
    plan.plan_name || '',
    plan.data_allowance || '',
    plan.price_naira || '',
  ]
    .filter(Boolean)
    .join('-');

  const slug =
    slugifyPlanIdentifier(seed) || `${slugifyPlanIdentifier(groupKey)}-${index + 1}`;
  return `PK-9MOBILE-${slug.toUpperCase()}`;
}

function normalizeReplacementPackageCode(packageCodeLike = '') {
  return String(packageCodeLike || '').trim();
}

function normalizeReplacementPackageCodeList(packageCodesLike = []) {
  const rawPackageCodes = Array.isArray(packageCodesLike)
    ? packageCodesLike
    : normalizeReplacementPackageCode(packageCodesLike)
    ? [packageCodesLike]
    : [];
  const seenPackageCodes = new Set();

  return rawPackageCodes.reduce((accumulator, packageCodeLike) => {
    const packageCode = normalizeReplacementPackageCode(packageCodeLike);
    const normalizedKey = packageCode.toUpperCase();

    if (!packageCode || seenPackageCodes.has(normalizedKey)) {
      return accumulator;
    }

    seenPackageCodes.add(normalizedKey);
    accumulator.push(packageCode);
    return accumulator;
  }, []);
}

const DATA_DETAIL_PROVIDER_SIGNATURES = Object.freeze([
  { key: '9mobile', patterns: ['9mobile', 't2mobile', 'etisalat'] },
  { key: 'mtn', patterns: ['mtn'] },
  { key: 'airtel', patterns: ['airtel'] },
  { key: 'glo', patterns: ['glo', 'globacom'] },
]);

function resolveDataDetailProviderSignature(
  packageCode = '',
  packageName = '',
  providerCode = '',
  source = ''
) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  const normalizedProviderCode = String(providerCode || '').trim().toLowerCase();
  if (normalizedSource && normalizedProviderCode) {
    return `${normalizedSource}:${normalizedProviderCode}`;
  }

  if (normalizedProviderCode) {
    return normalizedProviderCode;
  }

  const fingerprint = `${packageCode} ${packageName}`.toLowerCase();

  for (const signature of DATA_DETAIL_PROVIDER_SIGNATURES) {
    if (signature.patterns.some((pattern) => fingerprint.includes(pattern))) {
      return signature.key;
    }
  }

  return '';
}

function resolveDataDetailDurationSignature(packageName = '') {
  const normalizedPackageName = String(packageName || '').toLowerCase();

  if (normalizedPackageName.includes('daily')) return '1-day';
  if (normalizedPackageName.includes('weekly')) return '7-day';
  if (normalizedPackageName.includes('monthly')) return '30-day';
  if (
    normalizedPackageName.includes('yearly') ||
    normalizedPackageName.includes('annually')
  ) {
    return '365-day';
  }

  const durationMatch = normalizedPackageName.match(
    /(\d+(?:\.\d+)?)\s*(day|week|month|year)s?/i
  );

  if (!durationMatch) return '';

  const durationValue = Number(durationMatch[1]);
  const durationUnit = String(durationMatch[2] || '').toLowerCase();
  const unitMultiplier = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  const days = durationValue * (unitMultiplier[durationUnit] || 0);

  if (!Number.isFinite(days) || days <= 0) return '';

  return `${days}-day`;
}

function resolveDataDetailDataSignature(packageName = '') {
  const normalizedPackageName = String(packageName || '').toLowerCase();
  const dataMatch = normalizedPackageName.match(/(\d+(?:\.\d+)?)\s*(mb|gb|tb)/i);

  if (!dataMatch) return '';

  const dataValue = Number(dataMatch[1]);
  const dataUnit = String(dataMatch[2] || '').toLowerCase();

  if (!Number.isFinite(dataValue) || dataValue <= 0) return '';

  const dataValueInMb =
    dataUnit === 'gb'
      ? dataValue * 1024
      : dataUnit === 'tb'
      ? dataValue * 1024 * 1024
      : dataValue;

  if (!Number.isFinite(dataValueInMb) || dataValueInMb <= 0) return '';

  return `${dataValueInMb.toFixed(2)}mb`;
}

function resolveDataDetailPriceSignature(pricingMeta = {}) {
  const sourcePrice = Number(
    pricingMeta?.package_original_amount ??
      pricingMeta?.sellingPrice ??
      pricingMeta?.originalPrice
  );

  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0) {
    return '';
  }

  return sourcePrice.toFixed(2);
}

function buildAutoReplacementCodeMap(detailsSource = {}) {
  const groupedPackageCodes = new Map();

  Object.entries(detailsSource || {}).forEach(([packageCode, pricingMeta]) => {
    if (!pricingMeta || typeof pricingMeta !== 'object') return;

    const packageName = String(pricingMeta.package_name || '');
    const providerSignature = resolveDataDetailProviderSignature(
      packageCode,
      packageName,
      pricingMeta?.provider_code,
      pricingMeta?.source
    );
    const durationSignature = resolveDataDetailDurationSignature(packageName);
    const dataSignature = resolveDataDetailDataSignature(packageName);
    const priceSignature = resolveDataDetailPriceSignature(pricingMeta);

    if (!providerSignature || !durationSignature || !dataSignature || !priceSignature) {
      return;
    }

    const groupingKey = [
      providerSignature,
      durationSignature,
      dataSignature,
      priceSignature,
    ].join('|');

    if (!groupedPackageCodes.has(groupingKey)) {
      groupedPackageCodes.set(groupingKey, []);
    }

    groupedPackageCodes.get(groupingKey).push(packageCode);
  });

  const autoReplacementCodeMap = {};

  groupedPackageCodes.forEach((packageCodes) => {
    if (!Array.isArray(packageCodes) || packageCodes.length < 2) return;

    const sortedPackageCodes = [...packageCodes].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );

    sortedPackageCodes.forEach((packageCode) => {
      const relatedPackageCodes = sortedPackageCodes.filter(
        (candidateCode) =>
          candidateCode.toUpperCase() !== String(packageCode).toUpperCase()
      );

      if (relatedPackageCodes.length > 0) {
        autoReplacementCodeMap[String(packageCode).toUpperCase()] =
          relatedPackageCodes;
      }
    });
  });

  return Object.freeze(autoReplacementCodeMap);
}

function normalizeDataDetailReplacementField(
  record = {},
  packageCodeLike = '',
  autoReplacementCodeMap = {}
) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const normalizedPackageCode = normalizeReplacementPackageCode(packageCodeLike);
  const legacyReplacementPackageCode = normalizeReplacementPackageCode(
    record.replacement_package_api_code
  );
  const manualReplacementPackageCodes = normalizeReplacementPackageCodeList(
    record.replacement_package_api_codes
  );
  const autoReplacementPackageCodes = normalizedPackageCode
    ? normalizeReplacementPackageCodeList(
        autoReplacementCodeMap[normalizedPackageCode.toUpperCase()] || []
      )
    : [];

  record.replacement_package_api_codes = normalizeReplacementPackageCodeList(
    [
      ...manualReplacementPackageCodes,
      ...autoReplacementPackageCodes,
    ]
  );
  Object.defineProperty(record, '_manual_replacement_package_api_codes', {
    value: manualReplacementPackageCodes,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(record, '_legacy_replacement_package_api_code', {
    value: legacyReplacementPackageCode,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(record, '_auto_replacement_package_api_codes', {
    value: autoReplacementPackageCodes,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  delete record.replacement_package_api_code;
  return record;
}

function getPriorityReplacementPackageCodes(pricingMeta = {}) {
  const sourceReplacementCodes = Array.isArray(
    pricingMeta?._manual_replacement_package_api_codes
  )
    ? pricingMeta._manual_replacement_package_api_codes
    : pricingMeta?.replacement_package_api_codes;

  return normalizeReplacementPackageCodeList(sourceReplacementCodes);
}

function buildDataDetailPriorityMap() {
  return Object.freeze(
    Object.entries(liveDataDetailsStore).reduce((accumulator, [packageCode, pricingMeta]) => {
      const priorityPackageCodes = normalizeReplacementPackageCodeList([
        packageCode,
        ...getPriorityReplacementPackageCodes(pricingMeta),
      ]);

      if (priorityPackageCodes.length < 2) {
        return accumulator;
      }

      const canonicalPackageCode = priorityPackageCodes[0];

      priorityPackageCodes.forEach((candidatePackageCode, index) => {
        const candidateKey = candidatePackageCode.toUpperCase();
        const existingResolution = accumulator[candidateKey];

        if (!existingResolution || index < existingResolution.priorityRank) {
          accumulator[candidateKey] = {
            canonicalPackageCode,
            priorityRank: index,
          };
        }
      });

      return accumulator;
    }, {})
  );
}

function buildDataDetailPriorityMapFromSource(detailsSource = {}) {
  return Object.freeze(
    Object.entries(detailsSource || {}).reduce((accumulator, [packageCode, pricingMeta]) => {
      const priorityPackageCodes = normalizeReplacementPackageCodeList([
        packageCode,
        ...getPriorityReplacementPackageCodes(pricingMeta),
      ]);

      if (priorityPackageCodes.length < 2) {
        return accumulator;
      }

      const canonicalPackageCode = priorityPackageCodes[0];

      priorityPackageCodes.forEach((candidatePackageCode, index) => {
        const candidateKey = candidatePackageCode.toUpperCase();
        const existingResolution = accumulator[candidateKey];

        if (!existingResolution || index < existingResolution.priorityRank) {
          accumulator[candidateKey] = {
            canonicalPackageCode,
            priorityRank: index,
          };
        }
      });

      return accumulator;
    }, {})
  );
}

function buildDataDetailDirectAliasMap() {
  return Object.freeze(
    Object.entries(liveDataDetailsStore).reduce((accumulator, [packageCode, pricingMeta]) => {
      const replacementPackageCode = normalizeReplacementPackageCode(
        pricingMeta?._legacy_replacement_package_api_code
      );

      if (
        replacementPackageCode &&
        replacementPackageCode.toUpperCase() !== packageCode.toUpperCase() &&
        liveDataDetailsStore[replacementPackageCode]
      ) {
        accumulator[packageCode.toUpperCase()] = replacementPackageCode;
      }

      return accumulator;
    }, {})
  );
}

function buildDataDetailDirectAliasMapFromSource(detailsSource = {}) {
  return Object.freeze(
    Object.entries(detailsSource || {}).reduce((accumulator, [packageCode, pricingMeta]) => {
      const replacementPackageCode = normalizeReplacementPackageCode(
        pricingMeta?._legacy_replacement_package_api_code
      );

      if (
        replacementPackageCode &&
        replacementPackageCode.toUpperCase() !== packageCode.toUpperCase() &&
        detailsSource?.[replacementPackageCode]
      ) {
        accumulator[packageCode.toUpperCase()] = replacementPackageCode;
      }

      return accumulator;
    }, {})
  );
}

let DATA_DETAIL_PRIORITY_MAP = Object.freeze({});
let DATA_DETAIL_DIRECT_ALIAS_MAP = Object.freeze({});
let DATA_DETAIL_AUTO_REPLACEMENT_MAP = Object.freeze({});

function refreshDataDetailRuntimeState() {
  DATA_DETAIL_AUTO_REPLACEMENT_MAP = buildAutoReplacementCodeMap(liveDataDetailsStore);

  Object.entries(liveDataDetailsStore).forEach(([packageCode, record]) => {
    normalizeDataDetailReplacementField(
      record,
      packageCode,
      DATA_DETAIL_AUTO_REPLACEMENT_MAP
    );
  });

  DATA_DETAIL_PRIORITY_MAP = buildDataDetailPriorityMap();
  DATA_DETAIL_DIRECT_ALIAS_MAP = buildDataDetailDirectAliasMap();
}

export function replaceAllDataDetails(nextDataDetails = {}) {
  Object.keys(liveDataDetailsStore).forEach((packageCode) => {
    delete liveDataDetailsStore[packageCode];
  });

  Object.entries(nextDataDetails || {}).forEach(([packageCode, pricingMeta]) => {
    if (!packageCode || !pricingMeta || typeof pricingMeta !== 'object') {
      return;
    }

    liveDataDetailsStore[packageCode] = {
      ...pricingMeta,
    };
  });

  refreshDataDetailRuntimeState();
  return liveDataDetailsStore;
}

refreshDataDetailRuntimeState();

export function resolveDataDetailEntry(packageCodeLike = '') {
  const requestedPackageCode = normalizeReplacementPackageCode(packageCodeLike);

  if (!requestedPackageCode) {
    return {
      requestedPackageCode: '',
      canonicalPackageCode: '',
      pricingMeta: null,
      matchedByReplacement: false,
      priorityRank: 0,
    };
  }

  const priorityResolution =
    DATA_DETAIL_PRIORITY_MAP[requestedPackageCode.toUpperCase()] || null;
  const priorityPricingMeta = priorityResolution
    ? liveDataDetailsStore[priorityResolution.canonicalPackageCode] || null
    : null;

  if (priorityPricingMeta) {
    normalizeDataDetailReplacementField(
      priorityPricingMeta,
      priorityResolution.canonicalPackageCode,
      DATA_DETAIL_AUTO_REPLACEMENT_MAP
    );
    return {
      requestedPackageCode,
      canonicalPackageCode: priorityResolution.canonicalPackageCode,
      pricingMeta: priorityPricingMeta,
      matchedByReplacement:
        priorityResolution.canonicalPackageCode !== requestedPackageCode,
      priorityRank: priorityResolution.priorityRank,
    };
  }

  const directPricingMeta = liveDataDetailsStore[requestedPackageCode];
  if (directPricingMeta) {
    normalizeDataDetailReplacementField(
      directPricingMeta,
      requestedPackageCode,
      DATA_DETAIL_AUTO_REPLACEMENT_MAP
    );
    const canonicalPackageCode =
      DATA_DETAIL_DIRECT_ALIAS_MAP[requestedPackageCode.toUpperCase()] ||
      requestedPackageCode;
    const canonicalPricingMeta =
      liveDataDetailsStore[canonicalPackageCode] || directPricingMeta;

    if (canonicalPricingMeta) {
      normalizeDataDetailReplacementField(
        canonicalPricingMeta,
        canonicalPackageCode,
        DATA_DETAIL_AUTO_REPLACEMENT_MAP
      );
    }

    return {
      requestedPackageCode,
      canonicalPackageCode,
      pricingMeta: canonicalPricingMeta,
      matchedByReplacement: canonicalPackageCode !== requestedPackageCode,
      priorityRank: canonicalPackageCode === requestedPackageCode ? 0 : 1,
    };
  }

  return {
    requestedPackageCode,
    canonicalPackageCode: requestedPackageCode,
    pricingMeta: null,
    matchedByReplacement: false,
    priorityRank: 0,
  };
}

export function getDataPlanPricingMeta(packageCodeLike = '') {
  return resolveDataDetailEntry(packageCodeLike).pricingMeta;
}

function createDataDetailResolutionContext(detailsSource = {}) {
  const normalizedDetailsSource =
    detailsSource && typeof detailsSource === 'object' && !Array.isArray(detailsSource)
      ? detailsSource
      : {};
  const autoReplacementMap = buildAutoReplacementCodeMap(normalizedDetailsSource);

  Object.entries(normalizedDetailsSource).forEach(([packageCode, record]) => {
    if (record && typeof record === 'object') {
      normalizeDataDetailReplacementField(record, packageCode, autoReplacementMap);
    }
  });

  return {
    detailsSource: normalizedDetailsSource,
    autoReplacementMap,
    priorityMap: buildDataDetailPriorityMapFromSource(normalizedDetailsSource),
    directAliasMap: buildDataDetailDirectAliasMapFromSource(normalizedDetailsSource),
  };
}

function resolveDataDetailEntryFromMap(
  packageCodeLike = '',
  detailsSource = {}
) {
  const requestedPackageCode = normalizeReplacementPackageCode(packageCodeLike);

  if (!requestedPackageCode) {
    return {
      requestedPackageCode: '',
      canonicalPackageCode: '',
      pricingMeta: null,
      matchedByReplacement: false,
      priorityRank: 0,
    };
  }

  const resolutionContext = createDataDetailResolutionContext(detailsSource);
  const priorityResolution =
    resolutionContext.priorityMap[requestedPackageCode.toUpperCase()] || null;
  const priorityPricingMeta = priorityResolution
    ? resolutionContext.detailsSource[priorityResolution.canonicalPackageCode] || null
    : null;

  if (priorityPricingMeta) {
    normalizeDataDetailReplacementField(
      priorityPricingMeta,
      priorityResolution.canonicalPackageCode,
      resolutionContext.autoReplacementMap
    );
    return {
      requestedPackageCode,
      canonicalPackageCode: priorityResolution.canonicalPackageCode,
      pricingMeta: priorityPricingMeta,
      matchedByReplacement:
        priorityResolution.canonicalPackageCode !== requestedPackageCode,
      priorityRank: priorityResolution.priorityRank,
    };
  }

  const directPricingMeta = resolutionContext.detailsSource[requestedPackageCode];
  if (directPricingMeta) {
    normalizeDataDetailReplacementField(
      directPricingMeta,
      requestedPackageCode,
      resolutionContext.autoReplacementMap
    );
    const canonicalPackageCode =
      resolutionContext.directAliasMap[requestedPackageCode.toUpperCase()] ||
      requestedPackageCode;
    const canonicalPricingMeta =
      resolutionContext.detailsSource[canonicalPackageCode] || directPricingMeta;

    if (canonicalPricingMeta) {
      normalizeDataDetailReplacementField(
        canonicalPricingMeta,
        canonicalPackageCode,
        resolutionContext.autoReplacementMap
      );
    }

    return {
      requestedPackageCode,
      canonicalPackageCode,
      pricingMeta: canonicalPricingMeta,
      matchedByReplacement: canonicalPackageCode !== requestedPackageCode,
      priorityRank: canonicalPackageCode === requestedPackageCode ? 0 : 1,
    };
  }

  return {
    requestedPackageCode,
    canonicalPackageCode: requestedPackageCode,
    pricingMeta: null,
    matchedByReplacement: false,
    priorityRank: 0,
  };
}

function getPlanCatalogPackageCode(plan = {}) {
  return String(plan?.package_api_code || plan?.package_code || '').trim();
}

function buildCatalogPlanDedupeSignature(
  plan = {},
  referencePackageCode = '',
  actualPackageCode = ''
) {
  const source = String(plan?.source || '').trim().toLowerCase() || 'configured';
  const providerCode = String(plan?.provider_code || '').trim().toLowerCase();
  const packageCode = String(
    referencePackageCode || actualPackageCode || plan?.package_name || ''
  ).trim();

  return [source, providerCode, packageCode]
    .filter(Boolean)
    .join(':');
}

function isDirectDataPlanCodeMatch(plan = {}) {
  const actualPackageCode = getPlanCatalogPackageCode(plan);
  const referencePackageCode = String(
    plan?.pricing_reference_code || actualPackageCode
  ).trim();

  return Boolean(actualPackageCode) && actualPackageCode === referencePackageCode;
}

function normalizeCatalogDataPlansFromSource(plans = [], detailsSource = null) {
  const safeNumber = (value, fallbackValue = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? numericValue
      : Number(fallbackValue || 0);
  };

  const preferredPlans = new Map();

  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    if (!plan || typeof plan !== 'object') {
      return;
    }

    const actualPackageCode = getPlanCatalogPackageCode(plan);
    const resolvedEntry =
      detailsSource && typeof detailsSource === 'object' && !Array.isArray(detailsSource)
        ? resolveDataDetailEntryFromMap(actualPackageCode, detailsSource)
        : resolveDataDetailEntry(actualPackageCode);
    const pricingMeta = resolvedEntry.pricingMeta;
    const referencePackageCode =
      resolvedEntry.canonicalPackageCode ||
      actualPackageCode ||
      String(plan?.package_name || '').trim();

    const normalizedPlan = {
      ...plan,
      package_name:
        String(pricingMeta?.package_name || '').trim() ||
        String(plan?.package_name || '').trim() ||
        actualPackageCode ||
        'Data plan',
      package_original_amount: safeNumber(
        pricingMeta?.package_original_amount ??
          pricingMeta?.originalPrice ??
          pricingMeta?.sellingPrice ??
          plan?.package_original_amount ??
          plan?.package_amount ??
          plan?.price ??
          plan?.amount ??
          plan?.rawPrice,
        0
      ),
      pricing_reference_code: referencePackageCode,
      pricing_reference_priority: Number.isFinite(
        Number(resolvedEntry.priorityRank)
      )
        ? Number(resolvedEntry.priorityRank)
        : 0,
      price: safeNumber(
        plan?.sellingPrice ??
          plan?.price ??
          pricingMeta?.sellingPrice ??
          pricingMeta?.price ??
          plan?.package_amount ??
          plan?.package_original_amount ??
          plan?.amount ??
          plan?.rawPrice ??
          pricingMeta?.package_original_amount ??
          pricingMeta?.originalPrice,
        0
      ),
      sellingPrice: safeNumber(
        plan?.sellingPrice ??
          plan?.price ??
          pricingMeta?.sellingPrice ??
          pricingMeta?.price ??
          plan?.package_amount ??
          plan?.package_original_amount ??
          plan?.amount ??
          plan?.rawPrice ??
          pricingMeta?.package_original_amount ??
          pricingMeta?.originalPrice,
        0
      ),
      replacement_package_api_codes: normalizeReplacementPackageCodeList(
        pricingMeta?.replacement_package_api_codes
      ),
      source: String(pricingMeta?.source || plan?.source || '')
        .trim()
        .toLowerCase(),
      provider_code: String(
        pricingMeta?.provider_code || plan?.provider_code || ''
      )
        .trim()
        .toLowerCase(),
      durationGroup: String(
        pricingMeta?.durationGroup || plan?.durationGroup || plan?.duration_group || ''
      ).trim(),
      isNew: Boolean(pricingMeta?.isNew ?? plan?.isNew),
      exclude: Boolean(pricingMeta?.exclude ?? plan?.exclude),
      commission: safeNumber(pricingMeta?.commission ?? plan?.commission, 0),
      fee: safeNumber(pricingMeta?.fee ?? plan?.fee, 0),
      gain: safeNumber(pricingMeta?.gain ?? plan?.gain, 0),
      extra: safeNumber(pricingMeta?.extra ?? plan?.extra, 0),
      markup: safeNumber(pricingMeta?.markup ?? plan?.markup, 0),
    };

    const dedupeKey = buildCatalogPlanDedupeSignature(
      normalizedPlan,
      referencePackageCode,
      actualPackageCode
    );

    const existingPlan = preferredPlans.get(dedupeKey);
    if (!existingPlan) {
      preferredPlans.set(dedupeKey, normalizedPlan);
      return;
    }

    const normalizedPlanPriority = Number.isFinite(
      Number(normalizedPlan?.pricing_reference_priority)
    )
      ? Number(normalizedPlan.pricing_reference_priority)
      : Number.MAX_SAFE_INTEGER;
    const existingPlanPriority = Number.isFinite(
      Number(existingPlan?.pricing_reference_priority)
    )
      ? Number(existingPlan.pricing_reference_priority)
      : Number.MAX_SAFE_INTEGER;

    if (normalizedPlanPriority < existingPlanPriority) {
      preferredPlans.set(dedupeKey, normalizedPlan);
      return;
    }

    if (normalizedPlanPriority > existingPlanPriority) {
      return;
    }

    const normalizedPlanIsDirect = isDirectDataPlanCodeMatch(normalizedPlan);
    const existingPlanIsDirect = isDirectDataPlanCodeMatch(existingPlan);

    if (normalizedPlanIsDirect && !existingPlanIsDirect) {
      preferredPlans.set(dedupeKey, normalizedPlan);
    }
  });

  return [...preferredPlans.values()];
}

function normalizeCatalogDataPlans(plans = []) {
  return normalizeCatalogDataPlansFromSource(plans);
}

function normalizeCatalogDataPlansWithPricingMap(plans = [], detailsSource = {}) {
  return normalizeCatalogDataPlansFromSource(plans, detailsSource);
}

export function cleanAndCapitalize(inputString) {
  let capitalizedString = inputString.toUpperCase();

  let cleanString = capitalizedString.replace('_', ' ');

  return cleanString;
}

export function formatToNaira(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    console.error('Invalid input: must be a number.');
    return '';
  }

  // Use Intl.NumberFormat for robust, internationalized currency formatting.
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  });

  return formatter.format(amount);
}

function resolveComparableDataPlanAmount(plan = {}) {
  const packageCode = getPlanCatalogPackageCode(plan);
  const pricingMeta = getDataPlanPricingMeta(packageCode);

  const mappedAmount = Number(
    plan?.sellingPrice ??
      plan?.price ??
      pricingMeta?.sellingPrice ??
      pricingMeta?.price ??
      pricingMeta?.package_original_amount ??
      pricingMeta?.originalPrice ??
      plan?.package_amount ??
      plan?.package_original_amount ??
      plan?.amount ??
      plan?.rawPrice
  );

  if (Number.isFinite(mappedAmount) && mappedAmount > 0) {
    return mappedAmount;
  }

  return Number.MAX_SAFE_INTEGER;
}

function sortPlansByLowestVisiblePrice(plans = []) {
  return [...(Array.isArray(plans) ? plans : [])]
    .map((plan, index) => ({
      plan,
      index,
      amount: resolveComparableDataPlanAmount(plan),
    }))
    .sort((planA, planB) => {
      if (planA.amount !== planB.amount) {
        return planA.amount - planB.amount;
      }

      const nameComparison = String(planA.plan?.package_name || '').localeCompare(
        String(planB.plan?.package_name || ''),
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        }
      );

      if (nameComparison !== 0) {
        return nameComparison;
      }

      return planA.index - planB.index;
    })
    .map((entry) => entry.plan);
}

function sortGroupedPlansByLowestVisiblePrice(groupedPlans = {}) {
  return Object.fromEntries(
    Object.entries(groupedPlans || {}).map(([groupKey, plans]) => [
      groupKey,
      sortPlansByLowestVisiblePrice(plans),
    ])
  );
}

export function toKebabAndLowercase(str) {
  let sanitized = str.toLowerCase();

  // 2. Remove all characters that are NOT word characters or spaces
  sanitized = sanitized.replace(/[^\w\s]/g, '');

  // 3. Trim leading/trailing whitespace
  sanitized = sanitized.trim();

  // 4. Replace one or more whitespace characters with a single hyphen
  sanitized = sanitized.replace(/\s+/g, '-');

  return sanitized;
}

const readConfiguredValue = (...keys) => {
  for (const key of keys) {
    const value =
      typeof process !== 'undefined' && process?.env
        ? process.env[key]
        : undefined;

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

export function getPaystackKeysForMode(mode = process.env.PAYSTACK_MODE) {
  const normalizedMode = String(mode || '')
    .toLowerCase()
    .trim();
  const useLive =
    normalizedMode === 'live' ||
    (!normalizedMode && process.env.NODE_ENV === 'production');

  return {
    mode: useLive ? 'live' : 'test',
    publicKey: useLive
      ? readConfiguredValue('PAYSTACK_LIVE_PUBLIC_KEY')
      : readConfiguredValue('PAYSTACK_TEST_PUBLIC_KEY'),
    secretKey: useLive
      ? readConfiguredValue('PAYSTACK_LIVE_SECRET_KEY')
      : readConfiguredValue('PAYSTACK_TEST_SECRET_KEY'),
  };
}

export const aidapayPin = readConfiguredValue('AIDAPAY_PIN');

export const aidapayAccessToken = readConfiguredValue('AIDAPAY_ACCESS_TOKEN');

export function extractCustomerName(str) {
  // Splits at ':', takes the first part, and removes extra spaces
  return str.split(':')[1].trim();
}

function getPlanDurationGroup(item = {}) {
    const name = String(item?.package_name || '').toLowerCase();

    const keywordMap = {
      daily: 1,
      weekly: 7,
      monthly: 30,
      yearly: 365,
      annually: 365,
    };

    for (const [key, days] of Object.entries(keywordMap)) {
      if (name.includes(key)) return normalizeLabel(days);
    }

    const durationRegex = /(\d+)\s*(day|month|week|year)s?/i;
    const match = name.match(durationRegex);

    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      const unitMultiplier = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
      };

      const totalDays = value * (unitMultiplier[unit] || 0);
      return normalizeLabel(totalDays);
    }

    return 'Other';
}

function groupDataCatalog(array) {
  const normalizedPlans = normalizeCatalogDataPlans(array);
  const groupedPlans = Object.groupBy(normalizedPlans, getPlanDurationGroup);

  return sortPlanGroupsByDuration(
    sortGroupedPlansByLowestVisiblePrice(groupedPlans)
  );
}

export function groupData(array) {
  return groupDataCatalog(array);
}

function parsePlanGroupDays(label) {
  const normalizedLabel = String(label || '')
    .trim()
    .toLowerCase();

  if (!normalizedLabel) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedLabel.includes('daily')) return 1;
  if (normalizedLabel.includes('weekly')) return 7;
  if (normalizedLabel.includes('monthly')) return 30;
  if (
    normalizedLabel.includes('yearly') ||
    normalizedLabel.includes('annually')
  ) {
    return 365;
  }

  const durationMatch = normalizedLabel.match(
    /(\d+)\s*(day|week|month|year)s?/i
  );
  if (!durationMatch) {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number.parseInt(durationMatch[1], 10);
  const unit = durationMatch[2].toLowerCase();
  const unitMultiplier = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };

  if (!Number.isFinite(value) || !unitMultiplier[unit]) {
    return Number.POSITIVE_INFINITY;
  }

  return value * unitMultiplier[unit];
}

export function sortPlanGroupKeysByDuration(keys = []) {
  return [...keys].sort((groupA, groupB) => {
    const daysA = parsePlanGroupDays(groupA);
    const daysB = parsePlanGroupDays(groupB);

    if (daysA !== daysB) {
      return daysA - daysB;
    }

    return String(groupA).localeCompare(String(groupB), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function sortPlanGroupsByDuration(groupedPlans = {}) {
  const sortedKeys = sortPlanGroupKeysByDuration(Object.keys(groupedPlans));
  return Object.fromEntries(sortedKeys.map((key) => [key, groupedPlans[key]]));
}

export function removeDuplicatePackages(packages) {
  return normalizeCatalogDataPlans(packages);
}

export function removeDuplicatePackagesWithPricingMap(
  packages,
  detailsSource = {}
) {
  return normalizeCatalogDataPlansWithPricingMap(packages, detailsSource);
}

const DATA_PLAN_NETWORK_TERMS = Object.freeze({
  mtn: ['mtn'],
  glo: ['glo', 'globacom'],
  airtel: ['airtel'],
  '9mobile': ['9mobile', 't2mobile', 'etisalat'],
});

const DATA_PLAN_FALLBACK_PROVIDER_CODES = Object.freeze({
  mtn: 'mtn-sme',
  glo: 'glo-gifting',
  airtel: 'airtel-sme-cg',
  '9mobile': '9mobile-helper-fallback',
});

function normalizeDataPlanNetworkKey(networkLike = '') {
  const normalizedNetwork = String(networkLike || '').trim().toLowerCase();

  if (!normalizedNetwork) return '';
  if (normalizedNetwork.includes('9mobile')) return '9mobile';
  if (normalizedNetwork.includes('t2mobile')) return '9mobile';
  if (normalizedNetwork.includes('etisalat')) return '9mobile';
  if (normalizedNetwork.includes('mtn')) return 'mtn';
  if (normalizedNetwork.includes('airtel')) return 'airtel';
  if (normalizedNetwork.includes('glo')) return 'glo';
  if (normalizedNetwork.includes('globacom')) return 'glo';

  return normalizedNetwork;
}

function getDataPlanNetworkTerms(networkLike = '') {
  const normalizedNetwork = normalizeDataPlanNetworkKey(networkLike);
  return DATA_PLAN_NETWORK_TERMS[normalizedNetwork] || [];
}

export function resolveFallbackProviderCodeForNetwork(
  packageCodeLike = '',
  networkLike = ''
) {
  const packageCode = String(packageCodeLike || '').trim().toLowerCase();
  const normalizedNetwork = normalizeDataPlanNetworkKey(networkLike);

  if (packageCode.includes('glo-awuf-data')) return 'gloawufdata';
  if (packageCode.startsWith('pk-glo-')) return 'glo-gifting';
  if (packageCode.startsWith('pk-mtn-awuf')) return 'mtn-awuf-data';
  if (packageCode.startsWith('pk-mtn-')) return 'mtn-sme';
  if (packageCode.startsWith('pk-airtel-awuf')) return 'airtel-awuf-data';
  if (packageCode.startsWith('pk-airtel-')) return 'airtel-sme-cg';

  return DATA_PLAN_FALLBACK_PROVIDER_CODES[normalizedNetwork] || normalizedNetwork;
}

export function buildFallbackDataPlansForNetwork(networkLike = '') {
  const terms = getDataPlanNetworkTerms(networkLike);
  if (!terms.length) {
    return [];
  }

  const fallbackBasePlans = Object.entries(liveDataDetailsStore)
    .map(([packageCode, pricingMeta]) => {
      if (!pricingMeta) return null;

      const packageName = String(pricingMeta.package_name || '')
        .trim()
        .toLowerCase();
      const packageCodeLower = String(packageCode || '').trim().toLowerCase();
      const matchesNetwork = terms.some(
        (term) => packageName.includes(term) || packageCodeLower.includes(term)
      );

      if (!matchesNetwork) return null;

      const amount = Number(
        pricingMeta?.sellingPrice ??
          pricingMeta?.price ??
          pricingMeta?.package_original_amount ??
          0
      );
      if (!Number.isFinite(amount) || amount <= 0) return null;

      return {
        package_name: String(pricingMeta.package_name || '').trim() || packageCode,
        package_api_code: packageCode,
        provider_code: resolveFallbackProviderCodeForNetwork(
          packageCode,
          networkLike
        ),
        package_amount: amount,
        package_original_amount: amount,
        price: amount,
        sellingPrice: amount,
        source: String(pricingMeta?.source || 'pricing-fallback')
          .trim()
          .toLowerCase(),
      };
    })
    .filter(Boolean);

  return normalizeCatalogDataPlans(fallbackBasePlans);
}

function normalizeLabel(days) {
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days >= 28 && days <= 31) return 'Monthly';
  if (days === 365) return 'Yearly';

  // Fallback for custom durations like "14 Days" or "2 Months"
  if (days % 30 === 0) return `${days / 30} Month(s)`;
  return `${days} Day(s)`;
}

export function validFullNameString(str) {
  const regex = /^(?=.*[A-Za-z])[A-Za-z\s]+$/;
  return regex.test(str);
}

const NIGERIAN_MOBILE_PREFIXES = {
  mtn: [
    '0803',
    '0806',
    '0703',
    '0706',
    '0704',
    '07025',
    '07026',
    '0810',
    '0813',
    '0814',
    '0816',
    '0903',
    '0906',
    '0913',
    '0916',
  ],
  airtel: [
    '0802',
    '0808',
    '0708',
    '0701',
    '0812',
    '0901',
    '0902',
    '0904',
    '0907',
    '0911',
    '0912',
  ],
  glo: ['0805', '0807', '0705', '0811', '0815', '0905', '0915'],
  '9mobile': ['0809', '0817', '0818', '0908', '0909'],
};

export function sanitizePhoneDigits(str = '') {
  return String(str || '').replace(/\D/g, '').trim();
}

export function normalizeNigerianPhoneNumber(str = '') {
  const digits = sanitizePhoneDigits(str);

  if (!digits) {
    return '';
  }

  const withoutInternationalCallPrefix = digits.startsWith('00')
    ? digits.slice(2)
    : digits;

  // Accept numbers entered as +2340803... and normalize them to the local format.
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

  if (digits.length === 13 && digits.startsWith('234')) {
    return `0${digits.slice(3)}`;
  }

  if (digits.length === 10 && /^[789]\d{9}$/.test(digits)) {
    return `0${digits}`;
  }

  if (digits.length === 11 && /^0\d{10}$/.test(digits)) {
    return digits;
  }

  return '';
}

export function normalizePhoneInputValue(str = '') {
  const digits = sanitizePhoneDigits(str).slice(0, 18);
  const normalized = normalizeNigerianPhoneNumber(digits);

  return normalized || digits;
}

export function isValidNigerianMobileNumber(str = '') {
  return /^0[789]\d{9}$/.test(normalizeNigerianPhoneNumber(str));
}

export function detectNigerianMobileNetwork(str = '') {
  const normalized = normalizeNigerianPhoneNumber(str);

  if (!normalized) {
    return '';
  }

  for (const [network, prefixes] of Object.entries(NIGERIAN_MOBILE_PREFIXES)) {
    if (prefixes.some((prefix) => normalized.startsWith(prefix))) {
      return network;
    }
  }

  return '';
}

const normalizeNetworkProviderCode = (providerCode = '') => {
  const normalized = String(providerCode || '').trim().toLowerCase();

  if (!normalized) return '';
  if (normalized.includes('9mobile')) return '9mobile';
  if (normalized.includes('t2mobile')) return '9mobile';
  if (normalized.includes('etisalat')) return '9mobile';
  if (normalized.includes('mtn')) return 'mtn';
  if (normalized.includes('airtel')) return 'airtel';
  if (normalized.includes('glo')) return 'glo';

  return normalized;
};

export function networkProviderMatchesPhone(str = '', providerCode = '') {
  const detected = normalizeNetworkProviderCode(
    detectNigerianMobileNetwork(str)
  );
  const provider = normalizeNetworkProviderCode(providerCode);

  if (!provider) {
    return false;
  }

  if (!detected) {
    return true;
  }

  return provider.includes(detected);
}

export function validateEmailFormat(email) {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(email);
}

export function validEmailAddress(email) {
  // Regex breakdown:
  // ^[a-zA-Z0-9._%+-]+ : Local part (allows letters, numbers, and specific symbols)
  // @                  : Mandatory @ symbol
  // [a-zA-Z0-9.-]+     : Domain name (letters, numbers, dots, or hyphens)
  // \.                 : Literal dot
  // [a-zA-Z]{2,}$      : TLD (at least 2 letters, supporting modern long TLDs)
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  return regex.test(email);
}

export function validPhoneNumber(str) {
  return isValidNigerianMobileNumber(str);
}

export function validPassword(str) {
  // Regex explanation:
  // ^     : Start of string
  // \S    : Matches any character that is NOT whitespace (no spaces, tabs, or newlines)
  // {6,}  : Quantifier for at least 6 characters, with no upper limit
  // $     : End of string
  const regex = /^\S{6,}$/;

  return regex.test(str);
}

const LIVE_FRONTEND_URL = 'https://kuku.com.ng';
const LIVE_BACKEND_URL = 'https://kuku-ahjz.onrender.com';

function normalizeBaseUrl(value = '') {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

export function getFrontendUrl() {
  const configuredUrl = process.env.FRONTEND_URL;
  const normalizedConfiguredUrl = normalizeBaseUrl(configuredUrl);

  if (normalizedConfiguredUrl) {
    return normalizedConfiguredUrl;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5173';
  }

  return LIVE_FRONTEND_URL;
}

export function getAuthFrontendUrl() {
  const authConfiguredUrl = normalizeBaseUrl(process.env.AUTH_FRONTEND_URL);
  if (authConfiguredUrl) {
    return authConfiguredUrl;
  }

  const backendConfiguredUrl = normalizeBaseUrl(process.env.BACKEND_URL);
  if (backendConfiguredUrl) {
    return backendConfiguredUrl;
  }

  const frontendConfiguredUrl = normalizeBaseUrl(process.env.FRONTEND_URL);
  if (frontendConfiguredUrl) {
    return frontendConfiguredUrl;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:5173';
  }

  return LIVE_BACKEND_URL;
}

export function getBackendUrl() {
  const configuredUrl = process.env.BACKEND_URL;
  const normalizedConfiguredUrl = normalizeBaseUrl(configuredUrl);

  if (normalizedConfiguredUrl) {
    return normalizedConfiguredUrl;
  }

  if (process.env.NODE_ENV === 'development') {
    return `http://localhost:${process.env.PORT || 3001}`;
  }

  return LIVE_BACKEND_URL;
}

function isAbsoluteHttpUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function normalizeClientPath(value = '') {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return '';
  }

  if (trimmedValue === 'error') {
    return '/error';
  }

  if (trimmedValue.startsWith('/transactions')) {
    return trimmedValue.replace('/transactions', '/wallet');
  }

  if (trimmedValue.startsWith('/')) {
    return trimmedValue;
  }

  return `/${trimmedValue.replace(/^\/+/, '')}`;
}

function toAbsoluteFrontendUrl(target = '') {
  const normalizedTarget = String(target || '').trim();

  if (!normalizedTarget) {
    return '';
  }

  if (isAbsoluteHttpUrl(normalizedTarget)) {
    return normalizedTarget;
  }

  return `${getFrontendUrl()}${normalizeClientPath(normalizedTarget)}`;
}

function normalizeClientActionUrl(actionUrl = '', meta = {}) {
  const rawActionUrl = String(actionUrl || '').trim();

  if (rawActionUrl) {
    if (isAbsoluteHttpUrl(rawActionUrl)) {
      try {
        const parsedUrl = new URL(rawActionUrl);
        const frontendOrigin = new URL(getFrontendUrl()).origin;

        if (parsedUrl.origin === frontendOrigin) {
          return normalizeClientPath(
            `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
          );
        }
      } catch (_error) {
        return rawActionUrl;
      }

      return rawActionUrl;
    }

    return normalizeClientPath(rawActionUrl);
  }

  const ticketId = String(meta?.ticketId || '').trim();
  if (!ticketId) {
    return null;
  }

  const adminInboxType = String(meta?.adminInboxType || '')
    .trim()
    .toLowerCase();

  if (adminInboxType === 'complain') {
    return `/admin/ticket?id=${encodeURIComponent(ticketId)}`;
  }

  return `/support?ticketId=${encodeURIComponent(ticketId)}`;
}

export function buildClientNavigationTarget(actionUrl = '', meta = {}) {
  const normalizedActionUrl = normalizeClientActionUrl(actionUrl, meta);
  const webActionUrl = normalizedActionUrl
    ? toAbsoluteFrontendUrl(normalizedActionUrl)
    : null;

  return {
    actionUrl: normalizedActionUrl,
    actionPath: normalizedActionUrl,
    webActionUrl,
    mobileActionUrl: webActionUrl,
  };
}

export function avatarName(fromString) {
  if (!fromString || typeof fromString !== 'string') {
    return '';
  }

  const cleaned = fromString.trim();

  let namePart = '';

  // Case 1: "Name" <email>
  const quotedMatch = cleaned.match(/^"([^"]+)"\s*<[^>]+>$/);
  if (quotedMatch?.[1]) {
    namePart = quotedMatch[1].trim();
  }

  // Case 2: Name <email>
  const unquotedMatch = cleaned.match(/^([^<]+?)\s*<[^>]+>$/);
  if (unquotedMatch?.[1]) {
    namePart = unquotedMatch[1].trim();
  }

  // Case 3: Just a name (no email)
  if (!cleaned.includes('<') && !cleaned.includes('@')) {
    namePart = cleaned.trim();
  }

  if (!namePart) return '';

  // Quick filter: reject obvious non-names
  if (/@/.test(namePart) || namePart.length < 2 || /^\d+$/.test(namePart)) {
    return '';
  }

  // Normalize to "First Last" style with title case
  return namePart
    .split(/\s+/)
    .map((part) =>
      part
        .split('-')
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join('-')
    )
    .filter(Boolean)
    .join(' ')
    .replace(/"/g, '');
}

export const support = {
  email: readConfiguredValue('SUPPORT_EMAIL'),
  password: readConfiguredValue('SUPPORT_PASSWORD'),
};

export const admin = {
  email: readConfiguredValue('ADMIN_EMAIL'),
  password: readConfiguredValue('ADMIN_PASSWORD'),
};

export const info = {
  email: readConfiguredValue('INFO_EMAIL'),
  password: readConfiguredValue('INFO_PASSWORD'),
};

export const noreply = {
  email: readConfiguredValue('NOREPLY_EMAIL'),
  password: readConfiguredValue('NOREPLY_PASSWORD'),
};

const ADMIN_DASHBOARD_ROLE = 'admin-dashboard';
export const USER_SESSION_UPDATED_EVENT = 'kuku:user-session-updated';

const notifyUserSessionUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(USER_SESSION_UPDATED_EVENT));
  }
};

const normalizeRoleName = (value = '') =>
  String(value || '')
    .toLowerCase()
    .trim();

const getNormalizedRoleList = (user = {}) => {
  const sourceRoles = Array.isArray(user?.roles)
    ? user.roles
    : Array.isArray(user?.role)
    ? user.role
    : typeof user?.role === 'string'
    ? user.role.split(',')
    : [];

  const normalizedRoles = Array.from(
    new Set(
      sourceRoles
        .map((role) => normalizeRoleName(role))
        .filter((role) => ['admin', 'staff', 'customer'].includes(role))
    )
  );

  if (
    normalizeRoleName(user?.emailAddress || user?.email) === 'admin@kuku.com.ng' &&
    !normalizedRoles.includes('admin')
  ) {
    normalizedRoles.push('admin');
  }

  return normalizedRoles;
};

const hasAdminDashboardAccess = (user = {}) =>
  getNormalizedRoleList(user).includes('admin') ||
  user?.adminDashboardAccess === true ||
  user?.canAccessAdminDashboard === true ||
  [user?.roles, user?.role]
    .flat()
    .some((role) => normalizeRoleName(role) === ADMIN_DASHBOARD_ROLE);

export function signin(user) {
  try {
    const { token } = user;

    // 1. Basic validation
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
      throw new Error('Invalid or missing JWT token');
    }

    if (!user || !user._id || !user.emailAddress) {
      throw new Error('Invalid user data received from server');
    }

    // 2. Build single comprehensive session object
    const session = {
      ...user,
      // Token & auth status
      token,
      isAuthenticated: true,

      // User profile data
      _id: user._id,
      fullName: user.fullName || '',
      emailAddress: user.emailAddress,
      phoneNumber: user.phoneNumber || null,
      authType: user.authType || 'email',
      roles: Array.isArray(user.roles) ? user.roles : getNormalizedRoleList(user),

      // Timestamps
      loginTime: new Date().toISOString(),
      lastActive: new Date().toISOString(),

      // Optional JWT metadata (if you want to parse it client-side)
      // tokenIssuedAt: null,
      // tokenExpiresAt: null,
    };

    // 3. Optional: Try to extract expiry from JWT (client-side)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.iat)
        session.tokenIssuedAt = new Date(payload.iat * 1000).toISOString();
      if (payload.exp)
        session.tokenExpiresAt = new Date(payload.exp * 1000).toISOString();
    } catch (e) {
      console.warn('Could not parse JWT payload for expiry info');
    }

    // 4. Store everything in ONE key
    localStorage.setItem('user', JSON.stringify(session));
    notifyUserSessionUpdated();

    return session;
  } catch (error) {
    console.error('Signin Storage Error:', error.message);

    // Clean up on failure
    localStorage.removeItem('user');

    return null;
  }
}

export function signout() {
  localStorage.removeItem('user');
  notifyUserSessionUpdated();
  clearPendingAuthRedirect();

  // Clear any temporary state and redirect
  window.location.href = '/';
}

export function findTvPackageByCode(packages, apiCode) {
  if (!Array.isArray(packages) || !apiCode) return null;

  const lowerCode = apiCode.toLowerCase();
  return (
    packages.find((pkg) => pkg.package_api_code.toLowerCase() === lowerCode) ||
    null
  );
}

export function trimEndSpecialChars(str, customChars = null) {
  if (typeof str !== 'string') {
    return '';
  }

  // Default special characters (common punctuation + whitespace)
  const defaultSpecialChars = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~\\s';

  const charsToTrim = customChars || defaultSpecialChars;

  // Use regex to match any of the special characters at the end
  // \ escapes are needed for characters like ] and \
  const escapedChars = charsToTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`[${escapedChars}]+$`);

  return str.replace(regex, '');
}

export function filterProvidersByCode(partialCode, providers) {
  if (!partialCode || typeof partialCode !== 'string') return [];

  const lowerPartial = partialCode.toLowerCase().trim();

  return normalizeProviderArray(providers)
      .filter((provider) => provider && typeof provider === 'object')
      .filter((provider) =>
        provider.provider_code.toLowerCase().includes(lowerPartial)
      )
    .sort((a, b) => {
      const codeA = a.provider_code.toLowerCase();
      const codeB = b.provider_code.toLowerCase();

      // Exact match first
      if (codeA === lowerPartial) return -1;
      if (codeB === lowerPartial) return 1;

      // Starts with next
      if (codeA.startsWith(lowerPartial)) return -1;
      if (codeB.startsWith(lowerPartial)) return 1;

      return 0;
    });
}

export function getUser() {
  try {
    const userSession = localStorage.getItem('user');
    return userSession ? JSON.parse(userSession) : null;
  } catch (error) {
    console.error('Get User Error:', error);
    return null;
  }
}

const AUTH_RETURN_TO_STORAGE_KEY = 'kuku_auth_return_to';
// Temporary toggle: keep verification code paths intact while bypassing enforcement.
const EMAIL_VERIFICATION_ENFORCED = false;

function normalizeInternalReturnTo(target = '') {
  const value = String(target || '').trim();
  if (!value) return '';

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value);
      const currentOrigin =
        typeof window !== 'undefined' ? window.location.origin : '';
      if (currentOrigin && parsed.origin !== currentOrigin) {
        return '';
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (error) {
      return '';
    }
  }

  if (!value.startsWith('/')) {
    return '';
  }

  return value;
}

export function setPendingAuthRedirect(target = '') {
  const normalizedTarget = normalizeInternalReturnTo(target);
  if (!normalizedTarget || typeof sessionStorage === 'undefined') {
    return '';
  }

  sessionStorage.setItem(AUTH_RETURN_TO_STORAGE_KEY, normalizedTarget);
  return normalizedTarget;
}

function getPendingAuthRedirect() {
  if (typeof sessionStorage === 'undefined') return '';
  return normalizeInternalReturnTo(
    sessionStorage.getItem(AUTH_RETURN_TO_STORAGE_KEY) || ''
  );
}

export function clearPendingAuthRedirect() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(AUTH_RETURN_TO_STORAGE_KEY);
}

export function getAuthReturnTo(search = '') {
  const params = new URLSearchParams(String(search || ''));
  return (
    normalizeInternalReturnTo(params.get('returnTo') || '') ||
    getPendingAuthRedirect()
  );
}

export function buildAuthNavigationTarget(pathname, returnTo = '') {
  const normalizedReturnTo =
    normalizeInternalReturnTo(returnTo) || getPendingAuthRedirect();

  if (!normalizedReturnTo) {
    return pathname;
  }

  return `${pathname}?returnTo=${encodeURIComponent(normalizedReturnTo)}`;
}

export function resolvePostAuthRedirect(user, returnTo = '') {
  const normalizedReturnTo =
    normalizeInternalReturnTo(returnTo) || getPendingAuthRedirect();
  const requiresEmailVerification =
    EMAIL_VERIFICATION_ENFORCED &&
    Boolean(
      user &&
        (user?.authType === 'email'
          ? user?.emailVerified !== true
          : user?.emailVerificationRequired === true)
    );
  const requiresPinSetup = Boolean(user && user?.hasTransactionPin !== true);

  if (normalizedReturnTo) {
    setPendingAuthRedirect(normalizedReturnTo);
  }

  if (requiresEmailVerification) {
    return buildAuthNavigationTarget('/confirm-account', normalizedReturnTo);
  }

  if (requiresPinSetup) {
    return buildAuthNavigationTarget('/setup-pin', normalizedReturnTo);
  }

  if (normalizedReturnTo) {
    clearPendingAuthRedirect();
    return normalizedReturnTo;
  }

  clearPendingAuthRedirect();

  if (hasAdminDashboardAccess(user)) {
    return '/admin/dashboard';
  }

  return '/wallet';
}

export function updateUser(updatedData) {
  try {
    const currentUser = getUser();
    if (!currentUser) return null;

    const updatedUser = {
      ...currentUser,
      ...updatedData,
    };

    localStorage.setItem('user', JSON.stringify(updatedUser));
    notifyUserSessionUpdated();
    return updatedUser;
  } catch (error) {
    console.error('Update User Error:', error);
    return null;
  }
}

export function needsEmailVerification(user = null) {
  if (!EMAIL_VERIFICATION_ENFORCED) {
    return false;
  }
  return Boolean(user?.isAuthenticated && user?.emailVerified !== true);
}

export function needsTransactionPinSetup(user = null) {
  return Boolean(user?.isAuthenticated && !user?.hasTransactionPin);
}

export function getUrl(url){
  if (process.env.NODE_ENV === "development"){
    return `http://localhost:3001${url}`;
  } else {
    return `https://kuku-ahjz.onrender.com${url}`;
  }
}

export function parseDataPlan(plan) {
  if (!plan || typeof plan !== "string") return "";

  const text = plan.trim().toUpperCase();

  // ---------- 1. Extract data size (MB / GB) ----------
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB|G|M)\b/);
  if (!sizeMatch) return "";

  let amount = sizeMatch[1];
  let unit = sizeMatch[2];

  // Normalize unit
  unit = unit === "G" || unit === "GB" ? "gb" : "mb";

  // Clean trailing .0
  if (amount.endsWith(".0")) {
    amount = amount.slice(0, -2);
  }

  const size = `${amount}${unit}`;

  // ---------- 2. Extract validity ----------
  const patterns = [
    { regex: /(\d+)\s*DAYS?/, type: "day" },
    { regex: /(\d+)\s*DAY\b/, type: "day" },
    { regex: /(\d+)\s*MONTHS?/, type: "month" },
    { regex: /(\d+)\s*WEEKS?/, type: "week" },
    { regex: /(\d+)\s*YEARS?/, type: "year" },
    { regex: /\[?\s*MONTHLY\s*\]?/, type: "monthly" },
    { regex: /\[?\s*WEEKLY\s*\]?/, type: "weekly" },
    { regex: /\[?\s*DAILY\s*\]?/, type: "daily" },
    { regex: /(\d+)\s*M\b/, type: "month" },
    { regex: /(\d+)\s*D\b/, type: "day" },
  ];

  let duration = "unknown";

  for (const { regex, type } of patterns) {
    const match = text.match(regex);
    if (match) {
      if (type === "monthly") {
        duration = "1 month";
      } else if (type === "weekly") {
        duration = "1 week";
      } else if (type === "daily") {
        duration = "1 day";
      } else {
        const num = match[1];
        const singular = num === "1";
        const unitMap = {
          day: singular ? "day" : "days",
          month: singular ? "month" : "months",
          week: singular ? "week" : "weeks",
          year: singular ? "year" : "years",
        };
        duration = `${num} ${unitMap[type]}`;
      }
      break;
    }
  }

  return `${size} ${duration}`;
}

export function aidapayMargins(amount) {
  if (typeof amount !== "number" || isNaN(amount)) {
    throw new Error("Amount must be a valid number");
  }

  const charges = +(amount * 0.013).toFixed(2); // 1.3%
  const fee     = +(amount * 0.002).toFixed(2); // 0.2%
  const gain    = +(amount * 0.005).toFixed(2); // 0.5%

  const totalAdded = +(charges + fee + gain).toFixed(2);
  const finalAmount = +(amount + totalAdded).toFixed(2);

  return {
    initialAmount: amount,
    charges,
    fee,
    gain,
    totalAdded,
    finalAmount
  };
}

export function ddsMargins(amount) {
  if (typeof amount !== "number" || isNaN(amount)) {
    throw new Error("Amount must be a valid number");
  }

  const charges = +(amount * 0.025).toFixed(2); // 2.5%
  const fee     = +(amount * 0.002).toFixed(2); // 0.2%
  const gain    = +(amount * 0.003).toFixed(2); // 0.3%

  const totalAdded = +(charges + fee + gain).toFixed(2);
  const finalAmount = +(amount + totalAdded).toFixed(2);

  return {
    charges,
    fee,
    gain,
    totalAdded,
    finalAmount
  };
}

export function calculateMargins(plan){
  if (plan.source === "aidapay"){
    if (plan.sellingPrice){
      return plan.sellingPrice;
    } else {
      return aidapayMargins(plan.originalPrice).finalAmount
    }
  } else {
    if (plan.sellingPrice){
      return plan.sellingPrice;
    } else {
      return ddsMargins(plan.originalPrice).finalAmount
    }
  }
}
