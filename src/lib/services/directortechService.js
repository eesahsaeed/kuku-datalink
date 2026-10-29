const axios = require('axios');

const { buildLiveDataDetailsSnapshot, networkTimeout } = require('../helper');

const DIRECTORTECH_BASE_URL = String(
  process.env.DIRECTORTECH_BASE_URL || 'https://directortechs.com'
)
  .trim()
  .replace(/\/+$/, '');
const DIRECTORTECH_USERNAME = String(process.env.DIRECTORTECH_USERNAME || '').trim();
const DIRECTORTECH_PASSWORD = String(process.env.DIRECTORTECH_PASSWORD || '').trim();
const DIRECTORTECH_ACCESS_TOKEN = String(
  process.env.DIRECTORTECH_ACCESS_TOKEN || ''
).trim();
function parseBooleanEnvFlag(value, defaultValue = false) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();

  if (!normalizedValue) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalizedValue);
}

const DIRECTORTECH_HAS_LIVE_CREDENTIALS = Boolean(
  DIRECTORTECH_USERNAME && DIRECTORTECH_PASSWORD
);
const DIRECTORTECH_PURCHASE_MOCK_MODE =
  String(process.env.DIRECTORTECH_PURCHASE_MODE || '').trim().toLowerCase() === 'mock' ||
  String(process.env.DIRECTORTECH_LIVE_MODE || '').trim().toLowerCase() === 'false';
const DIRECTORTECH_AIRTIME_TEST_MODE = parseBooleanEnvFlag(
  process.env.DIRECTORTECH_AIRTIME_TEST_MODE,
  false
);
const DIRECTORTECH_DEBUG_LOGS =
  String(process.env.DIRECTORTECH_DEBUG_LOGS || '')
    .trim()
    .toLowerCase() !== 'false';

if (DIRECTORTECH_DEBUG_LOGS) {
  console.log('============================================================');
  console.log(
    `[directortech] Purchase Mode: ${
      DIRECTORTECH_PURCHASE_MOCK_MODE ? 'MOCK' : 'LIVE'
    }`
  );
  console.log(
    `[directortech] Airtime Test Mode: ${
      DIRECTORTECH_AIRTIME_TEST_MODE ? 'ENABLED' : 'DISABLED'
    }`
  );
  console.log(
    `[directortech] Live credentials: ${
      DIRECTORTECH_HAS_LIVE_CREDENTIALS ? 'PRESENT' : 'MISSING'
    }`
  );
  console.log(
    `[directortech] Access Token: ${
      DIRECTORTECH_ACCESS_TOKEN ? 'PRESENT' : 'MISSING'
    }`
  );
  console.log(`[directortech] Base URL: ${DIRECTORTECH_BASE_URL}`);
  console.log('============================================================');
}

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

const DIRECTORTECH_PROVIDER_LOOKUP = Object.freeze(
  DIRECTORTECH_NETWORKS.reduce((accumulator, network) => {
    accumulator[String(network.provider_code).toLowerCase()] = network;
    accumulator[String(network.provider_name).toLowerCase()] = network;
    return accumulator;
  }, {})
);

const DIRECTORTECH_NETWORK_HINTS = Object.freeze([
  { provider_code: '9mobile', patterns: ['9mobile', 't2mobile', 'etisalat'] },
  { provider_code: 'mtn', patterns: ['mtn'] },
  { provider_code: 'airtel', patterns: ['airtel'] },
  { provider_code: 'glo', patterns: ['glo', 'globacom'] },
  { provider_code: 'smile', patterns: ['smile'] },
]);

const DIRECTORTECH_MTN_AWOOF_PLAN_IDS = new Set(['498', '499', '501']);

const DIRECTORTECH_SESSION_TTL_MS = 30 * 60 * 1000;
const DIRECTORTECH_CATALOG_TTL_MS = 5 * 60 * 1000;
const DIRECTORTECH_BALANCE_TTL_MS = 2 * 60 * 1000;

let directortechSessionCache = null;
let directortechSessionPromise = null;
let directortechCatalogCache = null;
let directortechCatalogPromise = null;
let directortechAdminCatalogCache = null;
let directortechAdminCatalogPromise = null;
let directortechBalanceCache = null;
let directortechBalancePromise = null;

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function normalizeDirectortechProviderCode(value = '') {
  return String(value || '').trim().toLowerCase();
}

function getDirectortechNetworkMeta(networkLike = '') {
  const normalized = normalizeDirectortechProviderCode(networkLike);

  if (!normalized) {
    return null;
  }

  const directMatch =
    DIRECTORTECH_PROVIDER_LOOKUP[normalized] ||
    DIRECTORTECH_NETWORKS.find(
      (network) => String(network.provider_code || '').toLowerCase() === normalized
    ) ||
    DIRECTORTECH_NETWORKS.find(
      (network) => String(network.provider_name || '').toLowerCase() === normalized
    ) ||
    null;

  if (directMatch) {
    return directMatch;
  }

  for (const hint of DIRECTORTECH_NETWORK_HINTS) {
    if (hint.patterns.some((pattern) => normalized.includes(pattern))) {
      return DIRECTORTECH_PROVIDER_LOOKUP[hint.provider_code] || null;
    }
  }

  return null;
}

function extractDirectortechCsrfToken(html = '') {
  const match = String(html || '').match(
    /name="csrfmiddlewaretoken"\s+value="([^"]+)"/i
  );

  return match?.[1] ? String(match[1]).trim() : '';
}

function buildCookieHeader(setCookieHeader = []) {
  return (Array.isArray(setCookieHeader) ? setCookieHeader : [])
    .map((cookieLine) => String(cookieLine || '').split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function mergeCookieHeader(existingCookies = '', nextCookies = '') {
  const merged = new Map();

  String(existingCookies || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((cookie) => {
      const [name, ...valueParts] = cookie.split('=');
      if (!name) return;
      merged.set(name.trim(), valueParts.join('=').trim());
    });

  String(nextCookies || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((cookie) => {
      const [name, ...valueParts] = cookie.split('=');
      if (!name) return;
      merged.set(name.trim(), valueParts.join('=').trim());
    });

  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function extractDirectortechWalletBalance(html = '') {
  const normalizedHtml = String(html || '');
  const patterns = [
    /<p[^>]*class="card-category"[^>]*>\s*Wallet Balance\s*<\/p>\s*<h4[^>]*class="card-title"[^>]*>\s*&#8358;\s*([0-9,]+(?:\.[0-9]+)?)\s*<\/h4>/i,
    /<span[^>]*class="user-level"[^>]*>\s*balance:\s*&#8358;\s*([0-9,]+(?:\.[0-9]+)?)\s*<\/span>/i,
    /balance:\s*&#8358;\s*([0-9,]+(?:\.[0-9]+)?)/i,
    /Wallet Balance[\s\S]{0,240}?&#8358;\s*([0-9,]+(?:\.[0-9]+)?)/i,
    /balance:\s*₦\s*([0-9,]+(?:\.[0-9]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedHtml.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const numericValue = Number(String(match[1]).replace(/,/g, '').trim());
    if (Number.isFinite(numericValue)) {
      return normalizeMoney(numericValue, 0);
    }
  }

  return null;
}

async function fetchDirectortechWalletBalancePage(pagePath, cookies) {
  const response = await axios.get(`${DIRECTORTECH_BASE_URL}${pagePath}`, {
    timeout: networkTimeout,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `${DIRECTORTECH_BASE_URL}/data_Create/`,
      Cookie: cookies,
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Directortech wallet balance request redirected to ${response.headers?.location || 'login'}`
    );
  }

  const html = String(response.data || '');
  if (!html || html.includes('name="password"') || html.includes('Sign In')) {
    throw new Error(
      `Directortech balance page ${pagePath} did not return account markup`
    );
  }

  const balance = extractDirectortechWalletBalance(html);
  if (balance === null) {
    throw new Error(
      `Wallet balance not found in Directortech response for ${pagePath}`
    );
  }

  return {
    balance: normalizeMoney(balance, 0),
    currency: 'NGN',
    fetchedAt: new Date().toISOString(),
    source: 'directortech',
    pagePath,
  };
}

async function fetchDirectortechWalletBalance({ force = false } = {}) {
  const now = Date.now();
  if (!force && directortechBalanceCache?.expiresAt > now) {
    return directortechBalanceCache.payload;
  }

  if (!force && directortechBalancePromise) {
    return directortechBalancePromise;
  }

  directortechBalancePromise = (async () => {
    const cookies = await getDirectortechSessionCookies({ force });
    const pagePaths = ['/profile', '/data_Create/'];
    let lastError = null;

    for (const pagePath of pagePaths) {
      try {
        const payload = await fetchDirectortechWalletBalancePage(pagePath, cookies);
        directortechBalanceCache = {
          payload,
          expiresAt: Date.now() + DIRECTORTECH_BALANCE_TTL_MS,
        };
        return payload;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to fetch Directortech wallet balance');
  })();

  try {
    return await directortechBalancePromise;
  } finally {
    directortechBalancePromise = null;
  }
}

function buildDirectortechPackageName(optionText = '', planType = '') {
  const normalizedText = String(optionText || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedText) {
    return String(planType || '').trim();
  }

  const leftSide = normalizedText.split('=')[0] || '';
  const rightSide = normalizedText.split('=').slice(1).join('=');
  const amountMatch = rightSide.match(/^\s*(?:₦\s*|NGN\s*)?([0-9,]+)/i);
  const trailingText = amountMatch
    ? rightSide.replace(amountMatch[0], '').trim()
    : rightSide.trim();

  return [leftSide.trim(), trailingText].filter(Boolean).join(' ').trim();
}

function inferDirectortechDurationGroup(value = '') {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (
    normalized.includes('1 day') ||
    normalized.includes('1-day') ||
    normalized.includes('daily awoof') ||
    normalized.includes('[1 day validity]') ||
    normalized.includes('[1-day]') ||
    /\bdaily\b/.test(normalized)
  ) {
    return 'Daily';
  }

  if (
    normalized.includes('7 day') ||
    normalized.includes('7-day') ||
    normalized.includes('weekly') ||
    normalized.includes('[7 days validity]')
  ) {
    return 'Weekly';
  }

  const durationMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = String(durationMatch[2] || '').toLowerCase();
    const amountLabel = Number.isInteger(amount)
      ? String(amount)
      : String(Number(amount.toFixed(1)));

    if (unit.startsWith('day')) {
      return amount === 1 ? 'Daily' : `${amountLabel} Days`;
    }

    if (unit.startsWith('week')) {
      return amount === 1 ? 'Weekly' : `${amountLabel} Weeks`;
    }

    if (unit.startsWith('month')) {
      return amount === 1 ? 'Monthly' : `${amountLabel} Months`;
    }

    if (unit.startsWith('year')) {
      return amount === 1 ? 'Yearly' : `${amountLabel} Years`;
    }
  }

  return 'More';
}

function getDirectortechDurationSortRank(value = '') {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (normalized === 'daily') {
    return 0;
  }

  if (normalized === 'weekly') {
    return 1;
  }

  const durationMatch = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = String(durationMatch[2] || '').toLowerCase();
    const baseRank = unit.startsWith('day')
      ? 10
      : unit.startsWith('week')
      ? 100
      : unit.startsWith('month')
      ? 1000
      : 10000;

    return baseRank + (Number.isFinite(amount) ? amount : 0);
  }

  if (normalized.includes('monthly')) {
    return 1000;
  }

  if (normalized.includes('yearly')) {
    return 10000;
  }

  return Number.MAX_SAFE_INTEGER - 1;
}

function parseDirectortechPlanOption(
  optionMarkup = '',
  networkMeta = null,
  { includeAllPlans = false } = {}
) {
  const markup = String(optionMarkup || '').trim();
  if (!markup || !networkMeta) {
    return null;
  }

  const attrMatch = markup.match(/^<option\b([^>]*)>([\s\S]*?)<\/option>$/i);
  if (!attrMatch) {
    return null;
  }

  const attributes = attrMatch[1] || '';
  const innerText = (attrMatch[2] || '').replace(/\s+/g, ' ').trim();
  const planType = (
    attributes.match(/plantype\s*=\s*["']?\s*([^"']+?)\s*["']?(?=\s|$)/i)?.[1] || ''
  ).trim();
  const planId = (
    attributes.match(/value\s*=\s*["']?\s*([^"']+?)\s*["']?(?=\s|$)/i)?.[1] || ''
  ).trim();

  if (!planType || !planId) {
    return null;
  }

  if (!includeAllPlans) {
    const providerCode = String(networkMeta.provider_code || '').trim().toLowerCase();

    if (providerCode === 'mtn') {
      if (!DIRECTORTECH_MTN_AWOOF_PLAN_IDS.has(planId)) {
        return null;
      }
    } else if (providerCode !== '9mobile') {
      return null;
    }
  }

  const parts = innerText.split('=');
  const amountPart = parts.slice(1).join('=').trim();
  const amountMatch = amountPart.match(/^\s*(?:₦\s*|NGN\s*)?([0-9,]+)/i);
  const rawAmount = amountMatch ? amountMatch[1].replace(/,/g, '') : '';
  const amount = Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const packageName = buildDirectortechPackageName(innerText, planType);

  return {
    provider_name: networkMeta.provider_name,
    provider_code: networkMeta.provider_code,
    provider_image_url: networkMeta.provider_image_url,
    network_id: networkMeta.network_id,
    package_name: packageName || `${planType} ${planId}`,
    package_amount: amount,
    package_original_amount: amount,
    originalPrice: amount,
    package_api_code: planId,
    package_code: planId,
    plan_type: planType,
    validity: amountPart.replace(/^\s*(?:₦\s*|NGN\s*)?[0-9,]+\s*/i, '').trim(),
    source: 'directortech',
    duration_group: inferDirectortechDurationGroup(
      `${packageName} ${amountPart}`
    ),
    directortech_network_id: networkMeta.network_id,
    directortech_plan_id: planId,
    directortech_plan_type: planType,
    directortech_raw_label: innerText,
  };
}
async function getDirectortechSessionCookies({ force = false } = {}) {
  if (!DIRECTORTECH_HAS_LIVE_CREDENTIALS) {
    throw new Error('Directortech credentials are not configured');
  }

  const now = Date.now();
  if (!force && directortechSessionCache?.cookies && directortechSessionCache?.expiresAt > now) {
    return directortechSessionCache.cookies;
  }

  if (!force && directortechSessionPromise) {
    return directortechSessionPromise;
  }

  directortechSessionPromise = (async () => {
    const loginPage = await axios.get(`${DIRECTORTECH_BASE_URL}/login/`, {
      timeout: networkTimeout,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const csrfToken = extractDirectortechCsrfToken(loginPage.data || '');
    if (!csrfToken) {
      throw new Error('Unable to resolve Directortech login CSRF token');
    }

    const initialCookies = buildCookieHeader(loginPage.headers?.['set-cookie'] || []);
    const formBody = new URLSearchParams({
      username: DIRECTORTECH_USERNAME,
      password: DIRECTORTECH_PASSWORD,
      csrfmiddlewaretoken: csrfToken,
    }).toString();

    const loginResponse = await axios.post(
      `${DIRECTORTECH_BASE_URL}/login/`,
      formBody,
      {
        timeout: networkTimeout,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: DIRECTORTECH_BASE_URL,
          Referer: `${DIRECTORTECH_BASE_URL}/login/`,
          Cookie: initialCookies,
        },
      }
    );

    const postCookies = buildCookieHeader(loginResponse.headers?.['set-cookie'] || []);
    const mergedCookies = mergeCookieHeader(initialCookies, postCookies);

    if (!mergedCookies) {
      throw new Error('Directortech session cookies were not returned');
    }

    directortechSessionCache = {
      cookies: mergedCookies,
      expiresAt: Date.now() + DIRECTORTECH_SESSION_TTL_MS,
    };

    return mergedCookies;
  })();

  try {
    return await directortechSessionPromise;
  } finally {
    directortechSessionPromise = null;
  }
}

async function fetchDirectortechNetworkPlans(
  networkMeta,
  { forceSessionRefresh = false, includeAllPlans = false } = {}
) {
  const cookies = await getDirectortechSessionCookies({ force: forceSessionRefresh });
  const response = await axios.get(
    DIRECTORTECH_BASE_URL + '/ajax/load_plans/',
    {
      params: {
        network: networkMeta.network_id,
      },
      timeout: networkTimeout,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: DIRECTORTECH_BASE_URL + '/data_Create/',
        Cookie: cookies,
      },
    }
  );

  const html = String(response.data || '');
  if (!html || html.includes('name="password"') || html.includes('Sign In')) {
    throw new Error(
      `Directortech session for network ${networkMeta.provider_code} did not return plan markup`
    );
  }

  const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  const plans = [];
  let match = null;

  while ((match = optionRegex.exec(html))) {
    const markup = `<option${match[1]}>${match[2]}</option>`;
    const parsedPlan = parseDirectortechPlanOption(markup, networkMeta, {
      includeAllPlans,
    });

    if (parsedPlan) {
      plans.push(parsedPlan);
    }
  }

  return plans.sort((left, right) => {
    const leftAmount = Number(left.package_original_amount || left.package_amount || 0);
    const rightAmount = Number(right.package_original_amount || right.package_amount || 0);

    if (leftAmount !== rightAmount) {
      return leftAmount - rightAmount;
    }

    return String(left.package_name || '').localeCompare(String(right.package_name || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}
function buildDirectortechProviderList(plans = []) {
  const planCountByProvider = new Map();

  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    const providerCode = normalizeDirectortechProviderCode(plan?.provider_code);
    if (!providerCode) {
      return;
    }

    planCountByProvider.set(
      providerCode,
      (planCountByProvider.get(providerCode) || 0) + 1
    );
  });

  return DIRECTORTECH_NETWORKS.map((network) => ({
    ...network,
    source: 'directortech',
    has_live_plans: (planCountByProvider.get(network.provider_code) || 0) > 0,
    live_plan_count: planCountByProvider.get(network.provider_code) || 0,
  }));
}

async function fetchDirectortechCatalogPlans({ force = false } = {}) {
  const now = Date.now();
  if (!force && directortechCatalogCache?.expiresAt > now) {
    return directortechCatalogCache.plans;
  }

  if (!force && directortechCatalogPromise) {
    return directortechCatalogPromise;
  }

  directortechCatalogPromise = (async () => {
    let plans = [];

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

    plans = planGroups.flat().filter(Boolean);

    if (!Array.isArray(plans) || plans.length === 0) {
      try {
        plans = await fetchDirectortechPublicCatalogPlans({ force });
      } catch (error) {
        console.warn('[directortech] Falling back to public catalog failed:', {
          message: error?.message || error,
        });
        plans = [];
      }
    }

    plans = plans.sort((left, right) => {
      const leftProvider = String(left.provider_code || '');
      const rightProvider = String(right.provider_code || '');

      if (leftProvider !== rightProvider) {
        return leftProvider.localeCompare(rightProvider, undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      }

      const leftDurationRank = getDirectortechDurationSortRank(
        left.duration_group || left.validity || left.plan_type || ''
      );
      const rightDurationRank = getDirectortechDurationSortRank(
        right.duration_group || right.validity || right.plan_type || ''
      );

      if (leftDurationRank !== rightDurationRank) {
        return leftDurationRank - rightDurationRank;
      }

      const leftAmount = Number(left.package_original_amount || left.package_amount || 0);
      const rightAmount = Number(right.package_original_amount || right.package_amount || 0);

      if (leftAmount !== rightAmount) {
        return leftAmount - rightAmount;
      }

      return String(left.package_name || '').localeCompare(
        String(right.package_name || ''),
        undefined,
        {
          sensitivity: 'base',
          numeric: true,
        }
      );
    });

    directortechCatalogCache = {
      plans,
      providers: buildDirectortechProviderList(plans),
      expiresAt: Date.now() + DIRECTORTECH_CATALOG_TTL_MS,
    };

    return plans;
  })();

  try {
    return await directortechCatalogPromise;
  } finally {
    directortechCatalogPromise = null;
  }
}

async function fetchDirectortechAuthenticatedAdminCatalogPlans({ force = false } = {}) {
  const now = Date.now();
  if (!force && directortechAdminCatalogCache?.expiresAt > now) {
    return directortechAdminCatalogCache.plans;
  }

  if (!force && directortechAdminCatalogPromise) {
    return directortechAdminCatalogPromise;
  }

  directortechAdminCatalogPromise = (async () => {
    const planGroups = await Promise.all(
      DIRECTORTECH_NETWORKS.map(async (networkMeta) => {
        try {
          return await fetchDirectortechNetworkPlans(networkMeta, {
            forceSessionRefresh: false,
            includeAllPlans: true,
          });
        } catch (error) {
          console.warn('[directortech] Failed to load admin plans for network:', {
            network: networkMeta.provider_code,
            message: error?.message || error,
          });
          return [];
        }
      })
    );

    const plans = planGroups
      .flat()
      .filter(Boolean)
      .sort((left, right) => {
        const leftProvider = String(left.provider_code || '');
        const rightProvider = String(right.provider_code || '');

        if (leftProvider !== rightProvider) {
          return leftProvider.localeCompare(rightProvider, undefined, {
            sensitivity: 'base',
            numeric: true,
          });
        }

        const leftDurationRank = getDirectortechDurationSortRank(
          left.duration_group || left.validity || left.plan_type || ''
        );
        const rightDurationRank = getDirectortechDurationSortRank(
          right.duration_group || right.validity || right.plan_type || ''
        );

        if (leftDurationRank !== rightDurationRank) {
          return leftDurationRank - rightDurationRank;
        }

        const leftAmount = Number(left.package_original_amount || left.package_amount || 0);
        const rightAmount = Number(right.package_original_amount || right.package_amount || 0);

        if (leftAmount !== rightAmount) {
          return leftAmount - rightAmount;
        }

        return String(left.package_name || '').localeCompare(String(right.package_name || ''), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      });

    directortechAdminCatalogCache = {
      plans,
      providers: buildDirectortechProviderList(plans),
      expiresAt: Date.now() + DIRECTORTECH_CATALOG_TTL_MS,
    };

    return plans;
  })();

  try {
    return await directortechAdminCatalogPromise;
  } finally {
    directortechAdminCatalogPromise = null;
  }
}

async function fetchDirectortechPublicCatalogPlans({ force = false } = {}) {
  const now = Date.now();
  if (!force && directortechAdminCatalogCache?.publicPlans?.expiresAt > now) {
    return directortechAdminCatalogCache.publicPlans.plans;
  }

  const response = await axios.get(DIRECTORTECH_BASE_URL, {
    timeout: networkTimeout,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const html = String(response.data || '');
  const publicNetworks = [
    { heading: 'MTN DATA', network_id: 1, provider_code: 'mtn', provider_name: 'MTN', provider_image_url: '/img/mtn.png' },
    { heading: 'GLO DATA', network_id: 2, provider_code: 'glo', provider_name: 'GLO', provider_image_url: '/img/glo.png' },
    { heading: '9MOBILE DATA', network_id: 3, provider_code: '9mobile', provider_name: '9Mobile', provider_image_url: '/img/t2mobile.png' },
    { heading: 'AIRTEL DATA', network_id: 4, provider_code: 'airtel', provider_name: 'Airtel', provider_image_url: '/img/airtel-airtime.png' },
  ];

  const plans = [];

  publicNetworks.forEach((networkMeta) => {
    const headingToken = `${networkMeta.heading}</span>`;
    const startIndex = html.indexOf(headingToken);

    if (startIndex === -1) {
      return;
    }

    const searchStart = startIndex + headingToken.length;
    const nextIndices = publicNetworks
      .map((candidate) => html.indexOf(`${candidate.heading}</span>`, searchStart))
      .filter((index) => index > startIndex);
    const endIndex = nextIndices.length ? Math.min(...nextIndices) : html.length;
    const sectionHtml = html.slice(startIndex, endIndex);
    const rowRegex = /<tr>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>[\s\S]*?&#8358;\s*([0-9,]+)[\s\S]*?<td[^>]*>\s*<i>\s*([^<]+?)\s*<\/i>/gi;
    let rowMatch = null;
    let rowIndex = 0;

    while ((rowMatch = rowRegex.exec(sectionHtml))) {
      rowIndex += 1;
      const sizeText = String(rowMatch[1] || '').replace(/\s+/g, ' ').trim();
      const amount = Number(String(rowMatch[2] || '').replace(/,/g, ''));
      const validityText = String(rowMatch[3] || '').replace(/\s+/g, ' ').trim();

      if (!sizeText || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const packageName = [sizeText, networkMeta.provider_name, validityText]
        .filter(Boolean)
        .join(' ')
        .trim();
      const planKey = [
        'public',
        networkMeta.provider_code,
        sizeText,
        amount,
        validityText,
        rowIndex,
      ]
        .map((part) =>
          String(part || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
        )
        .filter(Boolean)
        .join('-');

      plans.push({
        provider_name: networkMeta.provider_name,
        provider_code: networkMeta.provider_code,
        provider_image_url: networkMeta.provider_image_url,
        network_id: networkMeta.network_id,
        package_name: packageName,
        package_amount: amount,
        package_original_amount: amount,
        originalPrice: amount,
        package_api_code: planKey,
        package_code: planKey,
        plan_type: sizeText,
        validity: validityText,
        source: 'directortech',
        duration_group: inferDirectortechDurationGroup(`${sizeText} ${validityText}`),
        directortech_network_id: networkMeta.network_id,
        directortech_plan_id: planKey,
        directortech_plan_type: sizeText,
        directortech_raw_label: `${sizeText} = ? ${amount} ${validityText}`,
        catalog_source: 'public',
      });
    }
  });

  const sortedPlans = plans.sort((left, right) => {
    const leftProvider = String(left.provider_code || '');
    const rightProvider = String(right.provider_code || '');

    if (leftProvider !== rightProvider) {
      return leftProvider.localeCompare(rightProvider, undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    }

    const leftAmount = Number(left.package_original_amount || left.package_amount || 0);
    const rightAmount = Number(right.package_original_amount || right.package_amount || 0);
    if (leftAmount !== rightAmount) {
      return leftAmount - rightAmount;
    }

    return String(left.package_name || '').localeCompare(String(right.package_name || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });

  directortechAdminCatalogCache = {
    ...(directortechAdminCatalogCache || {}),
    publicPlans: {
      plans: sortedPlans,
      expiresAt: Date.now() + DIRECTORTECH_CATALOG_TTL_MS,
    },
  };

  return sortedPlans;
}

async function fetchDirectortechAdminCatalogPlans({ force = false } = {}) {
  const now = Date.now();
  if (!force && directortechAdminCatalogCache?.expiresAt > now) {
    return directortechAdminCatalogCache.plans;
  }

  if (!force && directortechAdminCatalogPromise) {
    return directortechAdminCatalogPromise;
  }

  directortechAdminCatalogPromise = (async () => {
    let plans = [];

    try {
      plans = await fetchDirectortechAuthenticatedAdminCatalogPlans({ force });
    } catch (error) {
      console.warn('[directortech] Falling back to public catalog for admin view:', {
        message: error?.message || error,
      });
    }

    if (!Array.isArray(plans) || plans.length === 0) {
      plans = await fetchDirectortechPublicCatalogPlans({ force });
    }

    directortechAdminCatalogCache = {
      plans,
      providers: buildDirectortechProviderList(plans),
      expiresAt: Date.now() + DIRECTORTECH_CATALOG_TTL_MS,
    };

    return plans;
  })();

  try {
    return await directortechAdminCatalogPromise;
  } finally {
    directortechAdminCatalogPromise = null;
  }
}

async function fetchDirectortechAdminDataDetailsSnapshot(options = {}) {
  const plans = await fetchDirectortechAdminCatalogPlans(options);
  return buildLiveDataDetailsSnapshot(plans);
}
async function fetchDirectortechServiceProviders({ force = false } = {}) {
  const plans = await fetchDirectortechCatalogPlans({ force });

  if (directortechCatalogCache?.providers && !force) {
    return directortechCatalogCache.providers;
  }

  return buildDirectortechProviderList(plans);
}

async function fetchDirectortechPackagesForProvider(providerCode = '', { force = false } = {}) {
  const normalizedProviderCode = normalizeDirectortechProviderCode(providerCode);
  if (!normalizedProviderCode) {
    return [];
  }

  const networkMeta = getDirectortechNetworkMeta(normalizedProviderCode);
  if (!networkMeta) {
    return [];
  }

  const plans = await fetchDirectortechCatalogPlans({ force });
  return plans
    .filter(
      (plan) =>
        normalizeDirectortechProviderCode(plan?.provider_code) === networkMeta.provider_code ||
        Number(plan?.network_id) === Number(networkMeta.network_id)
    )
    .sort((left, right) => {
      const leftAmount = Number(left.package_original_amount || left.package_amount || 0);
      const rightAmount = Number(right.package_original_amount || right.package_amount || 0);

      if (leftAmount !== rightAmount) {
        return leftAmount - rightAmount;
      }

      return String(left.package_name || '').localeCompare(String(right.package_name || ''), undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    });
}

async function fetchDirectortechLiveProviderPlans(options = {}) {
  return fetchDirectortechCatalogPlans(options);
}

async function fetchDirectortechLiveDataDetailsSnapshot(options = {}) {
  const plans = await fetchDirectortechCatalogPlans(options);
  return buildLiveDataDetailsSnapshot(plans);
}

function normalizeDirectortechPurchaseResponse(responseData = {}, meta = {}) {
  const rawData =
    responseData && typeof responseData === 'object' ? responseData : { raw: responseData };
  const transactionData =
    rawData?.data && typeof rawData.data === 'object' && rawData.data.transaction_data &&
    typeof rawData.data.transaction_data === 'object'
      ? rawData.data.transaction_data
      : {};
  const providerTransactionHash = String(
    transactionData?.provider_transaction_hash ||
      transactionData?.providerTransactionHash ||
      transactionData?.transaction_hash ||
      transactionData?.transactionHash ||
      rawData?.provider_transaction_hash ||
      rawData?.providerTransactionHash ||
      rawData?.transaction_hash ||
      rawData?.transactionHash ||
      rawData?.data?.transaction_hash ||
      rawData?.data?.transactionHash ||
      ''
  ).trim();

  const amount = normalizeMoney(meta.amount, 0);
  const amountPaid = normalizeMoney(
    meta.amountPaid ?? meta.amount_paid ?? transactionData.amount_paid ?? amount,
    amount
  );
  const commission = normalizeMoney(
    transactionData.commission ?? meta.commission ?? 0,
    0
  );
  const discount = normalizeMoney(meta.discount ?? transactionData.discount ?? 0, 0);
  const recipient = String(meta.recipient || transactionData.recipient || '').trim();
  const providerReference = String(
    transactionData?.id ||
      transactionData?.ident ||
      transactionData?.provider_reference ||
      transactionData?.providerReference ||
      transactionData?.provider_tid ||
      transactionData?.providerTid ||
      transactionData?.tid ||
      transactionData?.transaction_id ||
      transactionData?.transactionId ||
      rawData?.id ||
      rawData?.ident ||
      rawData?.provider_reference ||
      rawData?.providerReference ||
      rawData?.provider_tid ||
      rawData?.providerTid ||
      rawData?.tid ||
      rawData?.transaction_id ||
      rawData?.transactionId ||
      providerTransactionHash ||
      meta.providerReference ||
      ''
  ).trim();
  const reference = String(providerReference || meta.reference || providerTransactionHash || '').trim();
  const status = String(
    transactionData.status ||
      rawData?.status ||
      rawData?.message ||
      meta.status ||
      'Processing'
  ).trim();
  const message =
    String(meta.message || rawData?.message || '').trim() ||
    `Transaction Sent For Processing . N${amountPaid} Beneficiary : ${recipient}`;

  return {
    success: rawData.success ?? true,
    message: rawData.message || 'success',
    data: {
      ...(rawData.data || {}),
      success: rawData.data?.success ?? true,
      message: rawData.data?.message || message,
      transaction_data: {
        ...transactionData,
        transaction_hash: reference,
        provider_transaction_hash: providerTransactionHash || reference,
        provider_reference: providerReference || reference,
        provider_tid: providerReference || reference,
        provider_transaction_id: providerReference || reference,
        id: providerReference || reference,
        ident: providerReference || reference,
        status,
        amount,
        recipient,
        amount_paid: amountPaid,
        commission,
        discount,
      },
    },
  };
}

function buildDirectortechMockPurchasePayload(meta = {}) {
  const amount = normalizeMoney(meta.amount, 0);
  const amountPaid = normalizeMoney(
    meta.amountPaid ?? meta.amount_paid ?? amount,
    amount
  );
  const commission = normalizeMoney(meta.commission ?? 0, 0);
  const discount = normalizeMoney(meta.discount ?? 0, 0);
  const recipient = String(meta.recipient || '').trim();
  const reference =
    String(meta.reference || '').trim() ||
    `MOCK-DIRECTORTECH-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  const status = String(meta.status || 'Processing').trim();
  const message =
    String(meta.message || '').trim() ||
    `Transaction Sent For Processing . N${amountPaid} Beneficiary : ${recipient}`;
  const providerTransactionHash = reference;

  return normalizeDirectortechPurchaseResponse(
    {
      success: true,
      message: 'success',
      data: {
        success: true,
        message,
        transaction_data: {
          transaction_hash: reference,
          id: reference,
          ident: reference,
          provider_transaction_hash: providerTransactionHash,
          provider_reference: reference,
          provider_tid: reference,
          provider_transaction_id: reference,
          status,
          amount,
          recipient,
          amount_paid: amountPaid,
          commission,
          discount,
          special_message: String(meta.specialMessage || 'Directortech mock purchase').trim(),
        },
      },
    },
    meta
  );
}

function buildDirectortechMockAirtimePurchasePayload(meta = {}) {
  const amount = normalizeMoney(meta.amount, 0);
  const amountPaid = normalizeMoney(
    meta.amountPaid ?? meta.amount_paid ?? amount,
    amount
  );
  const commission = normalizeMoney(meta.commission ?? 0, 0);
  const discount = normalizeMoney(meta.discount ?? 0, 0);
  const recipient = String(meta.recipient || '').trim();
  const planNetwork = String(
    meta.planNetwork ||
      meta.networkName ||
      meta.providerLabel ||
      meta.providerCode ||
      ''
  ).trim();
  const reference =
    String(meta.reference || '').trim() ||
    `MOCK-DIRECTORTECH-AIRTIME-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;

  return normalizeDirectortechAirtimePurchaseResponse(
    {
      success: true,
      message: 'success',
      id: reference,
      ident: reference,
      plan_amount: amount,
      plan_network: planNetwork,
      mobile_number: recipient,
      amount_paid: amountPaid,
      commission,
      discount,
      status: String(meta.status || 'success').trim() || 'success',
      special_message: String(meta.specialMessage || 'Directortech mock airtime purchase').trim(),
    },
    meta
  );
}

function buildDirectortechPurchaseHeaders() {
  return {
    Accept: 'application/json',
    Authorization: `Token ${DIRECTORTECH_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function normalizeDirectortechAirtimePurchaseResponse(responseData = {}, meta = {}) {
  const isStructuredResponse =
    responseData && typeof responseData === 'object' && !Array.isArray(responseData);
  const rawData = isStructuredResponse ? responseData : { raw: responseData };
  const rawTransactionData =
    rawData?.data &&
    typeof rawData.data === 'object' &&
    rawData.data.transaction_data &&
    typeof rawData.data.transaction_data === 'object'
      ? rawData.data.transaction_data
      : {};
  const providerTransactionHash = String(
    rawTransactionData?.provider_transaction_hash ||
      rawTransactionData?.providerTransactionHash ||
      rawTransactionData?.transaction_hash ||
      rawTransactionData?.transactionHash ||
      rawData?.provider_transaction_hash ||
      rawData?.providerTransactionHash ||
      rawData?.transaction_hash ||
      rawData?.transactionHash ||
      rawData?.data?.transaction_hash ||
      rawData?.data?.transactionHash ||
      ''
  ).trim();
  const transactionHash =
    String(
      rawTransactionData?.transaction_hash ||
        rawTransactionData?.reference ||
        rawTransactionData?.ref ||
        rawData?.id ||
        rawData?.reference ||
        rawData?.transaction_hash ||
        rawData?.data?.reference ||
        meta.reference ||
        ''
    ).trim() ||
    `DIRECTORTECH-AIRTIME-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  const amount = normalizeMoney(
    rawTransactionData?.amount ??
      rawData?.plan_amount ??
      rawData?.amount ??
      meta.amount ??
      0,
    0
  );
  const amountPaid = normalizeMoney(
    rawTransactionData?.amount_paid ??
      rawData?.amount_paid ??
      rawData?.amountPaid ??
      meta.amountPaid ??
      amount,
    amount
  );
  const commission = normalizeMoney(
    rawTransactionData?.commission ?? rawData?.commission ?? meta.commission ?? 0,
    0
  );
  const discount = normalizeMoney(
    rawTransactionData?.discount ?? rawData?.discount ?? meta.discount ?? 0,
    0
  );
  const recipient = String(
    rawTransactionData?.recipient ||
      rawData?.mobile_number ||
      rawData?.recipient ||
      meta.recipient ||
      ''
  ).trim();
  const providerReference = String(
    rawTransactionData?.id ||
      rawTransactionData?.ident ||
      rawTransactionData?.provider_reference ||
      rawTransactionData?.providerReference ||
      rawTransactionData?.provider_tid ||
      rawTransactionData?.providerTid ||
      rawTransactionData?.tid ||
      rawTransactionData?.transaction_id ||
      rawTransactionData?.transactionId ||
      rawData?.id ||
      rawData?.ident ||
      rawData?.provider_reference ||
      rawData?.providerReference ||
      rawData?.provider_tid ||
      rawData?.providerTid ||
      rawData?.tid ||
      rawData?.transaction_id ||
      rawData?.transactionId ||
      providerTransactionHash ||
      meta.providerReference ||
      ''
  ).trim();
  const planNetwork = String(
    rawData?.plan_network ||
      rawTransactionData?.plan_network ||
      meta.planNetwork ||
      meta.networkName ||
      meta.providerLabel ||
      meta.providerCode ||
      ''
  ).trim();
  const status = String(
    rawTransactionData?.status || rawData?.status || meta.status || 'success'
  ).trim() || 'success';
  const message = String(
    rawData?.message ||
      rawData?.data?.message ||
      meta.message ||
      'success'
  ).trim() || 'success';
  const normalizedSuccess = isStructuredResponse ? rawData.success ?? true : false;
  const normalizedDataSuccess = isStructuredResponse
    ? rawData.data?.success ?? true
    : false;
  const normalizedMessage = isStructuredResponse
    ? rawData.message || message
    : 'Unexpected Directortech airtime response';

  return {
    success: normalizedSuccess,
    message: normalizedMessage,
    data: {
      ...(rawData.data || {}),
      success: normalizedDataSuccess,
      message: isStructuredResponse ? rawData.data?.message || message : normalizedMessage,
      transaction_data: {
        ...rawTransactionData,
        transaction_hash: transactionHash,
        provider_transaction_hash: providerTransactionHash || transactionHash,
        provider_reference: providerReference || transactionHash,
        provider_tid: providerReference || transactionHash,
        provider_transaction_id: providerReference || transactionHash,
        status,
        amount,
        recipient,
        amount_paid: amountPaid,
        commission,
        discount,
        plan_amount: amount,
        plan_network: planNetwork,
        mobile_number: recipient,
      },
    },
  };
}

function buildDirectortechAirtimePurchaseHeaders({ cookies = '', csrfToken = '' } = {}) {
  const normalizedCookies = String(cookies || '').trim();
  const normalizedCsrfToken = String(csrfToken || '').trim();

  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json',
    Cookie: normalizedCookies,
    Origin: DIRECTORTECH_BASE_URL,
    Referer: `${DIRECTORTECH_BASE_URL}/AirtimeTopupCreate/`,
    'X-CSRFToken': normalizedCsrfToken,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

async function fetchDirectortechAirtimeTopupPage(cookies) {
  const response = await axios.get(`${DIRECTORTECH_BASE_URL}/AirtimeTopupCreate/`, {
    timeout: networkTimeout,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `${DIRECTORTECH_BASE_URL}/`,
      Cookie: cookies,
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Directortech airtime page redirected to ${response.headers?.location || 'login'}`
    );
  }

  const html = String(response.data || '');
  if (!html || html.includes('name="password"') || html.includes('Sign In')) {
    throw new Error(
      'Directortech airtime page did not return the expected authenticated form'
    );
  }

  const pageCookies = buildCookieHeader(response.headers?.['set-cookie'] || []);
  const mergedCookies = mergeCookieHeader(cookies, pageCookies);
  const csrfToken = extractDirectortechCsrfToken(html);

  if (!csrfToken) {
    throw new Error('Unable to resolve Directortech airtime CSRF token');
  }

  return {
    html,
    cookies: mergedCookies || cookies,
    csrfToken,
  };
}

async function requestDirectortechAirtimePurchase(
  {
    networkId,
    mobileNumber,
    amount,
    portedNumber = false,
    airtimeType = 'VTU',
  } = {},
  meta = {}
) {
  const normalizedNetworkId = Number(networkId);
  const normalizedMobileNumber = String(mobileNumber || '').trim();
  const normalizedAmount = normalizeMoney(amount, NaN);
  const normalizedAirtimeType = String(airtimeType || 'VTU').trim() || 'VTU';

  if (!Number.isFinite(normalizedNetworkId) || normalizedNetworkId <= 0) {
    throw new Error('Directortech airtime network id is required');
  }

  if (!normalizedMobileNumber) {
    throw new Error('Directortech airtime mobile number is required');
  }

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Directortech airtime amount must be greater than zero');
  }

  if (!DIRECTORTECH_HAS_LIVE_CREDENTIALS) {
    throw new Error('Directortech credentials are not configured');
  }

  const sessionCookies = await getDirectortechSessionCookies();
  const airtimePage = await fetchDirectortechAirtimeTopupPage(sessionCookies);
  const response = await axios.post(
    `${DIRECTORTECH_BASE_URL}/api/topup/`,
    {
      network: normalizedNetworkId,
      mobile_number: normalizedMobileNumber,
      amount: normalizedAmount,
      Ported_number: Boolean(portedNumber),
      airtime_type: normalizedAirtimeType,
    },
    {
      headers: buildDirectortechAirtimePurchaseHeaders({
        cookies: airtimePage.cookies,
        csrfToken: airtimePage.csrfToken,
      }),
      timeout: networkTimeout,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    }
  );

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Directortech airtime purchase redirected to ${response.headers?.location || 'login'}`
    );
  }

  return normalizeDirectortechAirtimePurchaseResponse(response.data, {
    ...meta,
    amount: normalizedAmount,
    amountPaid: meta.amountPaid ?? normalizedAmount,
    recipient: normalizedMobileNumber,
    planNetwork:
      meta.planNetwork ||
      meta.networkName ||
      meta.providerLabel ||
      meta.providerCode ||
      DIRECTORTECH_NETWORKS.find(
        (network) => Number(network.network_id) === normalizedNetworkId
      )?.provider_name ||
      '',
  });
}

async function requestDirectortechDataPurchase(
  {
    networkId,
    planId,
    mobileNumber,
    portedNumber = false,
  } = {},
  meta = {}
) {
  if (DIRECTORTECH_PURCHASE_MOCK_MODE) {
    return buildDirectortechMockPurchasePayload(meta);
  }

  if (!DIRECTORTECH_ACCESS_TOKEN) {
    throw new Error('Directortech access token is not configured');
  }

  const response = await axios.post(
    `${DIRECTORTECH_BASE_URL}/api/data/`,
    {
      network: Number(networkId),
      mobile_number: String(mobileNumber || '').trim(),
      plan: String(planId || '').trim(),
      Ported_number: Boolean(portedNumber),
    },
    {
      headers: buildDirectortechPurchaseHeaders(),
      timeout: networkTimeout,
      validateStatus: (status) => status >= 200 && status < 400,
    }
  );

  return normalizeDirectortechPurchaseResponse(response.data, meta);
}

async function requestDirectortechTransaction(reference) {
  const normalizedReference = String(reference || '').trim();

  if (!normalizedReference) {
    throw new Error('Directortech transaction reference is required');
  }

  const transactionListEndpoint = `${DIRECTORTECH_BASE_URL}/api/data/`;

  console.info(
    '[directortechService] Directortech transaction requery request payload',
    {
      endpoint: transactionListEndpoint,
      liveMode: !DIRECTORTECH_PURCHASE_MOCK_MODE,
      accessTokenPresent: Boolean(DIRECTORTECH_ACCESS_TOKEN),
      payload: {
        reference: normalizedReference,
      },
    }
  );

  if (DIRECTORTECH_PURCHASE_MOCK_MODE) {
    const mockResponse = normalizeDirectortechPurchaseResponse(
      {
        success: true,
        message: 'success',
        data: {
          success: true,
          message: 'Directortech mock transaction lookup',
          transaction_data: {
            transaction_hash: normalizedReference,
            status: 'Processing',
            amount: 0,
            recipient: '',
            amount_paid: 0,
            commission: 0,
            discount: 0,
          },
        },
      },
      {
        reference: normalizedReference,
        status: 'Processing',
      }
    );

    console.info(
      '[directortechService] Directortech transaction requery mock response payload',
      {
        reference: normalizedReference,
        payload: mockResponse,
      }
    );

    return mockResponse;
  }

  if (!DIRECTORTECH_ACCESS_TOKEN) {
    throw new Error('Directortech access token is not configured');
  }

  const resolveTransactionCollectionItems = (payload) => {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.results)) {
      return payload.results;
    }
    if (Array.isArray(payload?.data?.results)) {
      return payload.data.results;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  };

  const matchesReference = (item = {}) => {
    const candidates = [
      item?.ident,
      item?.id,
      item?.transaction_hash,
      item?.transactionHash,
      item?.reference,
      item?.ref,
      item?.tid,
      item?.transaction_id,
      item?.transactionId,
      item?.provider_reference,
      item?.providerReference,
      item?.provider_transaction_hash,
      item?.providerTransactionHash,
    ];

    return candidates.some(
      (candidate) => String(candidate || '').trim() === normalizedReference
    );
  };

  let pageUrl = transactionListEndpoint;
  let response = null;
  let matchedTransaction = null;
  let pageCount = 0;

  while (pageUrl && pageCount < 20 && !matchedTransaction) {
    pageCount += 1;
    response = await axios.get(pageUrl, {
      headers: buildDirectortechPurchaseHeaders(),
      timeout: networkTimeout,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const pageItems = resolveTransactionCollectionItems(response.data);
    matchedTransaction = pageItems.find(matchesReference) || null;

    if (!matchedTransaction) {
      const nextPage = String(response.data?.next || '').trim();
      pageUrl = nextPage
        ? /^https?:\/\//i.test(nextPage)
          ? nextPage
          : `${DIRECTORTECH_BASE_URL}${nextPage.startsWith('/') ? '' : '/'}${nextPage}`
        : '';
    }
  }

  if (!matchedTransaction) {
    const notFoundError = new Error(
      `Directortech transaction ${normalizedReference} was not found in the transaction list`
    );
    notFoundError.response = {
      status: 404,
      data: {
        success: false,
        message: 'Directortech transaction not found',
        reference: normalizedReference,
      },
    };
    throw notFoundError;
  }

  const matchedReference = String(
    matchedTransaction?.ident ||
      matchedTransaction?.transaction_hash ||
      matchedTransaction?.reference ||
      normalizedReference
  ).trim();
  const matchedAmount = normalizeMoney(
    matchedTransaction?.plan_amount ?? matchedTransaction?.amount ?? 0,
    0
  );
  const matchedStatus = String(
    matchedTransaction?.Status ||
      matchedTransaction?.status ||
      matchedTransaction?.transaction_status ||
      'Processing'
  ).trim();
  const matchedRecipient = String(
    matchedTransaction?.mobile_number || matchedTransaction?.recipient || ''
  ).trim();
  const normalizedLookupPayload = normalizeDirectortechPurchaseResponse(
    {
      success: true,
      message: 'success',
      data: {
        success: true,
        message: 'Directortech transaction lookup',
        transaction_data: {
          ...matchedTransaction,
          transaction_hash: matchedReference,
          provider_transaction_hash: matchedReference,
          provider_reference: matchedReference,
          provider_tid: matchedReference,
          provider_transaction_id: matchedReference,
          status: matchedStatus,
          amount: matchedAmount,
          amount_paid: matchedAmount,
          recipient: matchedRecipient,
        },
      },
    },
    {
      reference: matchedReference,
      status: matchedStatus,
      amount: matchedAmount,
      amountPaid: matchedAmount,
      recipient: matchedRecipient,
      message: 'Directortech transaction lookup',
    }
  );

  console.info(
    '[directortechService] Directortech transaction requery response payload',
    {
      reference: normalizedReference,
      matchedReference,
      payload: normalizedLookupPayload,
    }
  );

  return normalizedLookupPayload;
}

module.exports = {
  DIRECTORTECH_BASE_URL,
  DIRECTORTECH_NETWORKS,
  fetchDirectortechCatalogPlans,
  fetchDirectortechAdminCatalogPlans,
  fetchDirectortechAdminDataDetailsSnapshot,
  fetchDirectortechAuthenticatedAdminCatalogPlans,
  fetchDirectortechLiveDataDetailsSnapshot,
  fetchDirectortechLiveProviderPlans,
  fetchDirectortechPublicCatalogPlans,
  fetchDirectortechPackagesForProvider,
  fetchDirectortechWalletBalance,
  fetchDirectortechServiceProviders,
  getDirectortechNetworkMeta,
  DIRECTORTECH_AIRTIME_TEST_MODE,
  normalizeDirectortechProviderCode,
  requestDirectortechAirtimePurchase,
  requestDirectortechDataPurchase,
  requestDirectortechTransaction,
  fetchDirectortechNetworkPlans
};
