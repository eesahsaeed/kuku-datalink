export function toKobo(value = 0) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue * 100);
}

export function fromKobo(value = 0) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue / 100;
}

export function formatNairaFromKobo(value = 0) {
  const nairaValue = fromKobo(value);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(nairaValue);
}

export function formatPercentFromBasisPoints(value = 0) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return '0.00%';
  return `${(numericValue / 100).toFixed(2)}%`;
}
