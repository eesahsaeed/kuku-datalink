const escapeRegex = (value = '') =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCreditTransactionConditions = () => [
  { type: { $regex: 'credit', $options: 'i' } },
  { 'providerResponse.direction': { $regex: '^credit$', $options: 'i' } },
  { description: { $regex: '(wallet funding|funded)', $options: 'i' } },
  { 'metadata.paymentPurpose': { $regex: 'wallet funding', $options: 'i' } },
  { 'metadata.category': { $regex: 'credit', $options: 'i' } },
];

const buildWalletTransactionQuery = ({ userId, group = 'all', search = '' }) => {
  const query = { userId };
  const filters = [];
  const normalizedGroup = String(group || 'all').trim().toLowerCase();
  const trimmedSearch = String(search || '').trim();
  const creditConditions = getCreditTransactionConditions();

  if (normalizedGroup === 'credit') {
    filters.push({ $or: creditConditions });
  } else if (normalizedGroup === 'purchase') {
    filters.push({ $nor: creditConditions });
  }

  if (trimmedSearch) {
    const safeRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
    const searchConditions = [
      { description: safeRegex },
      { reference: safeRegex },
      { type: safeRegex },
      { status: safeRegex },
      { recipientPhone: safeRegex },
      { recipientSmartCardNumber: safeRegex },
      { recipientMeterNumber: safeRegex },
      { provider_code: safeRegex },
      { package_code: safeRegex },
      { package_name: safeRegex },
      { failureReason: safeRegex },
      { 'fundedBy.fullName': safeRegex },
      { 'fundedBy.email': safeRegex },
      { 'fundedBy.phone': safeRegex },
      { 'purchasedBy.fullName': safeRegex },
      { 'purchasedBy.email': safeRegex },
      { 'purchasedBy.phone': safeRegex },
      { 'metadata.sender': safeRegex },
      { 'providerResponse.metadata.sender': safeRegex },
    ];

    const numericSearch = Number(trimmedSearch.replace(/,/g, ''));
    if (Number.isFinite(numericSearch)) {
      searchConditions.push({ amount: numericSearch });
    }

    filters.push({ $or: searchConditions });
  }

  if (filters.length) {
    query.$and = filters;
  }

  return query;
};

const normalizeWalletTransactionsPagination = ({ page = 1, limit = 10 } = {}) => {
  const normalizedPage = Math.max(parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
};

const toPublicWalletTransactionsResponse = ({
  transactions = [],
  page = 1,
  limit = 10,
  totalTransactions = 0,
}) => ({
  success: true,
  transactions: transactions.map((tx) => ({
    ...tx,
    amount: parseFloat(tx.amount || 0).toFixed(2),
  })),
  pagination: {
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(totalTransactions / limit)),
    totalTransactions,
  },
});

module.exports = {
  buildWalletTransactionQuery,
  normalizeWalletTransactionsPagination,
  toPublicWalletTransactionsResponse,
};
