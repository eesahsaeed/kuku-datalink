const SERVICE_CONTINUATION_QUERY_KEYS = [
  'serviceCategory',
  'serviceProvider',
  'serviceModal',
  'tvSmartCard',
  'tvPackage',
  'electricityMeter',
  'electricityType',
  'electricityAmount',
  'internetPhone',
  'internetPlan',
];

const SERVICE_CATEGORY_TO_PURCHASE_VIEW = {
  tv: 'tv',
  electricity: 'utilities',
  internet: 'internet',
  development: 'development',
};

const normalize = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase();

export function clearServiceContinuationSearch(baseParams = '') {
  const nextParams = new URLSearchParams(baseParams);
  SERVICE_CONTINUATION_QUERY_KEYS.forEach((key) => nextParams.delete(key));
  return nextParams;
}

export function hasServiceContinuationMatch(
  baseParams = '',
  category = '',
  providerCode = ''
) {
  const params = new URLSearchParams(baseParams);
  return (
    normalize(params.get('serviceCategory')) === normalize(category) &&
    normalize(params.get('serviceProvider')) === normalize(providerCode) &&
    normalize(params.get('serviceModal')) === 'open'
  );
}

export function buildServiceContinuationReturnTo({
  pathname = '/',
  search = '',
  category = '',
  providerCode = '',
  values = {},
}) {
  const params = clearServiceContinuationSearch(search);
  const normalizedCategory = normalize(category);

  params.set('serviceCategory', category);
  params.set('serviceProvider', providerCode);
  params.set('serviceModal', 'open');

  if (SERVICE_CATEGORY_TO_PURCHASE_VIEW[normalizedCategory]) {
    params.set(
      'purchaseView',
      SERVICE_CATEGORY_TO_PURCHASE_VIEW[normalizedCategory]
    );
  }

  Object.entries(values).forEach(([key, value]) => {
    const normalizedValue = String(value || '').trim();
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  });

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
