const truthyValues = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const DEFAULT_IFRAME_KEY = 'bf122a76c5e96e0baaa2b2e7443e627f';
const DEFAULT_IFRAME_SCRIPT_URL =
  'https://www.highperformanceformat.com/bf122a76c5e96e0baaa2b2e7443e627f/invoke.js';
const DEFAULT_IFRAME_HEIGHT = 60;
const DEFAULT_IFRAME_WIDTH = 468;
const DEFAULT_CONTAINER_SCRIPT_URL =
  'https://pl29341725.profitablecpmratenetwork.com/608853702475ab78e96608c929d17d22/invoke.js';
const DEFAULT_CONTAINER_ID = 'container-608853702475ab78e96608c929d17d22';

function canUseDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function parseBoolean(value) {
  return truthyValues.has(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function normalizeUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function getAdsterraConfig() {
  const env = import.meta.env || {};

  return {
    enabled: parseBoolean(env.VITE_ADSTERRA_ENABLED || 'true'),
    iframeAdOptions: {
      key: String(env.VITE_ADSTERRA_IFRAME_KEY || DEFAULT_IFRAME_KEY).trim(),
      format: String(env.VITE_ADSTERRA_IFRAME_FORMAT || 'iframe').trim(),
      height: toFiniteNumber(
        env.VITE_ADSTERRA_IFRAME_HEIGHT,
        DEFAULT_IFRAME_HEIGHT
      ),
      width: toFiniteNumber(
        env.VITE_ADSTERRA_IFRAME_WIDTH,
        DEFAULT_IFRAME_WIDTH
      ),
      params: {},
    },
    iframeScriptUrl: normalizeUrl(
      env.VITE_ADSTERRA_IFRAME_SCRIPT_URL || DEFAULT_IFRAME_SCRIPT_URL
    ),
    containerScriptUrl: normalizeUrl(
      env.VITE_ADSTERRA_CONTAINER_SCRIPT_URL || DEFAULT_CONTAINER_SCRIPT_URL
    ),
    containerId: String(
      env.VITE_ADSTERRA_CONTAINER_ID || DEFAULT_CONTAINER_ID
    ).trim(),
    directLinkUrl: normalizeUrl(env.VITE_ADSTERRA_DIRECT_LINK_URL),
    directLinkLabel: String(
      env.VITE_ADSTERRA_DIRECT_LINK_LABEL || 'Open sponsored offer'
    ).trim(),
  };
}

export function isAdsterraEnabled() {
  return getAdsterraConfig().enabled;
}

export function openAdsterraDirectLink(directLinkUrl = '') {
  if (!canUseDom()) return false;
  if (!directLinkUrl) return false;

  const popupWindow = window.open(
    directLinkUrl,
    '_blank',
    'noopener,noreferrer'
  );
  return Boolean(popupWindow);
}
