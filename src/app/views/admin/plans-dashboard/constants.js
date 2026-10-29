export const DEFAULT_FILTERS = {
  network: 'ALL',
  category: 'ALL',
  durationGroup: 'ALL',
  source: 'ALL',
  minPriceKobo: null,
  maxPriceKobo: null,
  search: '',
  showExcluded: true,
  sortBy: 'new_first',
  viewMode: 'grid',
};

export const SORT_OPTIONS = [
  { value: 'new_first', label: 'New Plans First' },
  { value: 'price_asc', label: 'Price (Low-High)' },
  { value: 'profit_desc', label: 'Profit (High-Low)' },
  { value: 'popularity_desc', label: 'Popularity' },
  { value: 'name_asc', label: 'Name (A-Z)' },
];

export const VIEW_MODES = {
  GRID: 'grid',
  TABLE: 'table',
};
