import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  Table,
} from 'components/ui/primitives';
import { getUser, networkTimeout } from '../../../../lib/helper';

const formatNGN = (value = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDateTime = (value) => {
  if (!value) return 'N/A';

  try {
    return new Date(value).toLocaleString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value || 'N/A');
  }
};

const toSafeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const buildDefaultSummary = () => ({
  totalGain: 0,
  totalCommission: 0,
  totalPackageOriginalAmount: 0,
  totalTransactions: 0,
  displayedCount: 0,
});

const getUserLabel = (transaction = {}) => {
  const user = transaction?.userId && typeof transaction.userId === 'object'
    ? transaction.userId
    : {};

  const names = [
    user.fullName,
    user.fullname,
    transaction?.purchasedBy?.fullName,
    transaction?.fundedBy?.fullName,
    user.username,
    user.emailAddress,
    user.email,
    transaction?.purchasedBy?.email,
    transaction?.fundedBy?.email,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return names[0] || 'Unknown user';
};

const getRecipientLabel = (transaction = {}) =>
  String(
    transaction?.recipientPhone ||
      transaction?.recipientMeterNumber ||
      transaction?.recipientSmartCardNumber ||
      transaction?.metadata?.recipient ||
      ''
  ).trim() || 'N/A';

const getStatusBadgeColor = (status = '') => {
  const normalized = String(status || '').trim().toLowerCase();

  if (['success', 'successful', 'completed'].includes(normalized)) {
    return 'success';
  }

  if (['failed', 'failure', 'error'].includes(normalized)) {
    return 'danger';
  }

  if (['pending', 'processing', 'queued'].includes(normalized)) {
    return 'warning';
  }

  return 'secondary';
};

function RecentTransactionsSection() {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(buildDefaultSummary());
  const [pagination, setPagination] = useState({
    limit: 10,
    skip: 0,
    hasMore: false,
    total: 0,
  });
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const hasLoadedOnceRef = useRef(false);

  const totalPages = useMemo(() => {
    const total = toSafeNumber(pagination.total, 0);
    const limit = Math.max(1, toSafeNumber(pagination.limit, pageSize));
    return total > 0 ? Math.ceil(total / limit) : 0;
  }, [pagination.limit, pagination.total, pageSize]);

  const loadTransactions = useCallback(
    async ({ page: nextPage = 1, limit = 10, days: nextDays = 30 } = {}) => {
      const safePage = Math.max(1, toSafeNumber(nextPage, 1));
      const safeLimit = Math.min(Math.max(toSafeNumber(limit, 10), 5), 50);
      const safeDays = Math.min(Math.max(toSafeNumber(nextDays, 30), 1), 30);
      const skip = (safePage - 1) * safeLimit;

      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError('');

      try {
        const session = getUser();
        const token = session?.token;

        if (!token) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        const response = await axios.get('/api/admin/transactions/recent', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
          params: {
            limit: safeLimit,
            skip,
            days: safeDays,
          },
        });

        const payload = response?.data || {};
        setTransactions(Array.isArray(payload.data) ? payload.data : []);
        setSummary({
          ...buildDefaultSummary(),
          ...(payload.summary || {}),
        });
        setPagination({
          limit: Number(payload.pagination?.limit || safeLimit),
          skip: Number(payload.pagination?.skip || skip),
          hasMore: Boolean(payload.pagination?.hasMore),
          total: Number(payload.pagination?.total || 0),
        });
        setDays(safeDays);
        setPage(safePage);
        setPageSize(safeLimit);
        hasLoadedOnceRef.current = true;
      } catch (loadError) {
        const message =
          loadError?.response?.data?.message ||
          loadError?.message ||
          'Failed to load transactions';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadTransactions({ page, limit: pageSize, days });
  }, [days, loadTransactions, page, pageSize]);

  const summaryBadges = [
    ['Total Transactions', summary.totalTransactions],
    ['Displayed', summary.displayedCount],
    ['Package Amount', summary.totalPackageOriginalAmount],
    ['Total Gain', summary.totalGain],
    ['Commission', summary.totalCommission],
  ];

  return (
    <Card className="shadow-sm border-0 h-100">
      <CardHeader className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <CardTitle tag="h5" className="mb-2">
            Recent Transactions
          </CardTitle>
          <div className="text-muted">
            Paginated view of the latest successful data and airtime transactions.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div style={{ minWidth: 140 }}>
            <Input
              type="select"
              value={String(days)}
              onChange={(event) => {
                setPage(1);
                setDays(Number(event.target.value || 30));
              }}
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </Input>
          </div>
          <div style={{ minWidth: 120 }}>
            <Input
              type="select"
              value={String(pageSize)}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value || 10));
              }}
            >
              <option value="10">10 / page</option>
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
            </Input>
          </div>
          <Button
            color="secondary"
            outline
            onClick={() => loadTransactions({ page, limit: pageSize, days })}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>

      <CardBody>
        {error ? (
          <Alert color="danger" className="mb-3">
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <div className="text-center py-5">
            <Spinner />
            <div className="mt-2 text-muted">Loading transactions...</div>
          </div>
        ) : (
          <>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {summaryBadges.map(([label, value]) => (
                <Badge key={label} color="light" className="border text-dark px-3 py-2">
                  {label}: {' '}
                  {label === 'Total Transactions' || label === 'Displayed'
                    ? Number(value || 0).toLocaleString()
                    : formatNGN(value)}
                </Badge>
              ))}
            </div>

            <div className="table-responsive">
              <Table hover className="mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>User</th>
                    <th>Package</th>
                    <th>Provider</th>
                    <th>Recipient</th>
                    <th>Amount</th>
                    <th>Gain</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center text-muted py-4">
                        No transactions found for the selected window.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((transaction) => {
                      const status = String(transaction.status || 'pending');
                      const userLabel = getUserLabel(transaction);
                      const packageLabel = String(transaction.package_name || transaction.package_code || 'N/A').trim();
                      const providerLabel = String(transaction.provider_code || 'N/A').trim();
                      const amount = toSafeNumber(transaction.amount, 0);
                      const gain = toSafeNumber(transaction.pricing?.gain, 0);

                      return (
                        <tr key={String(transaction._id || transaction.reference || `${transaction.createdAt}-${amount}`)}>
                          <td>{formatDateTime(transaction.createdAt || transaction.completedAt)}</td>
                          <td>
                            <Badge color={getStatusBadgeColor(status)} pill>
                              {status}
                            </Badge>
                          </td>
                          <td>{String(transaction.type || 'N/A').trim()}</td>
                          <td>
                            <div className="fw-semibold">{userLabel}</div>
                            <div className="text-muted small">
                              {String(
                                transaction.userId?.emailAddress ||
                                  transaction.userId?.email ||
                                  transaction.purchasedBy?.email ||
                                  transaction.fundedBy?.email ||
                                  ''
                              ).trim() || ' '}
                            </div>
                          </td>
                          <td>{packageLabel}</td>
                          <td>{providerLabel}</td>
                          <td>{getRecipientLabel(transaction)}</td>
                          <td className="fw-semibold">{formatNGN(amount)}</td>
                          <td className={gain >= 0 ? 'text-success fw-semibold' : 'text-danger fw-semibold'}>
                            {formatNGN(gain)}
                          </td>
                          <td className="text-break small">
                            {String(transaction.reference || 'N/A').trim()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>

            <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3">
              <div className="text-muted small">
                Page {totalPages > 0 ? page : 0}
                {totalPages > 0 ? ` of ${totalPages}` : ''} | Limit{' '}
                {Number(pagination.limit || pageSize).toLocaleString()}
              </div>
              <div className="d-flex gap-2">
                <Button
                  color="secondary"
                  outline
                  size="sm"
                  onClick={() => setPage((previous) => Math.max(previous - 1, 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  color="secondary"
                  outline
                  size="sm"
                  onClick={() => setPage((previous) => previous + 1)}
                  disabled={!pagination.hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default RecentTransactionsSection;
