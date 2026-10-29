import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Col,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
} from 'components/ui/primitives';
import { getUser, networkTimeout } from '../../../lib/helper';
import { isPrimaryAdminUser } from '../../utils/adminAccess';

const money = (value = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateTime = (value) => {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleString('en-NG');
  } catch {
    return String(value);
  }
};

const getStatusColor = (status = '') => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['success', 'successful', 'completed'].includes(normalized)) return 'success';
  if (['refund', 'refunded', 'reversed', 'reversal'].includes(normalized)) return 'warning';
  if (['failed', 'failure', 'error', 'rejected', 'declined'].includes(normalized)) return 'danger';
  if (['processing', 'pending', 'queued'].includes(normalized)) return 'info';
  return 'secondary';
};

const getTypeColor = (type = '') => {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'data') return 'primary';
  if (normalized === 'airtime') return 'warning';
  if (normalized === 'wallet-adjustment') return 'dark';
  if (normalized === 'tv') return 'info';
  if (normalized === 'electricity') return 'success';
  return 'secondary';
};

const buildFilters = (searchParams) => ({
  search: String(searchParams.get('search') || '').trim(),
  status: String(searchParams.get('status') || 'all').trim(),
  type: String(searchParams.get('type') || 'all').trim(),
  providerSource: String(searchParams.get('providerSource') || 'all').trim(),
  userId: String(searchParams.get('userId') || '').trim(),
});

const getUserLabel = (transaction = {}) => {
  const user = transaction?.userId && typeof transaction.userId === 'object' ? transaction.userId : {};
  const value = [
    user.fullName,
    user.fullname,
    user.emailAddress,
    user.email,
    transaction?.purchasedBy?.fullName,
    transaction?.fundedBy?.fullName,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)[0];

  return value || 'Unknown user';
};

const getRecipient = (transaction = {}) =>
  String(
    transaction?.recipientPhone ||
      transaction?.recipientMeterNumber ||
      transaction?.recipientSmartCardNumber ||
      transaction?.metadata?.recipient ||
      ''
  ).trim() || 'N/A';

function Transactions() {
  const currentUser = useMemo(() => getUser(), []);
  const isPrimaryAdmin = useMemo(() => isPrimaryAdminUser(currentUser), [currentUser]);
  const authToken = String(currentUser?.token || '').trim();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFilters = useMemo(() => buildFilters(searchParams), []);
  const initialPage = useMemo(() => Math.max(1, Number(searchParams.get('page') || 1) || 1), []);
  const initialLimit = useMemo(
    () => Math.min(Math.max(Number(searchParams.get('limit') || 20) || 20, 5), 100),
    []
  );

  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState({
    totalTransactions: 0,
    totalAmount: 0,
    successCount: 0,
    failedCount: 0,
    refundCount: 0,
    processingCount: 0,
  });
  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [transactionDetails, setTransactionDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [actionNote, setActionNote] = useState('');

  const syncQuery = useCallback(
    (filters, nextPage, nextLimit) => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.providerSource !== 'all') params.set('providerSource', filters.providerSource);
      if (filters.userId) params.set('userId', filters.userId);
      params.set('page', String(nextPage));
      params.set('limit', String(nextLimit));
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const loadTransactions = useCallback(
    async ({
      nextPage = page,
      nextLimit = limit,
      nextFilters = appliedFilters,
      silent = false,
    } = {}) => {
      if (!isPrimaryAdmin) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const safePage = Math.max(1, Number(nextPage) || 1);
      const safeLimit = Math.min(Math.max(Number(nextLimit) || 20, 5), 100);

      try {
        if (!authToken) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        if (silent) setRefreshing(true);
        else setLoading(true);

        setError('');

        const response = await axios.get('/api/admin/transactions', {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
          params: {
            page: safePage,
            limit: safeLimit,
            search: nextFilters.search || undefined,
            status: nextFilters.status !== 'all' ? nextFilters.status : undefined,
            type: nextFilters.type !== 'all' ? nextFilters.type : undefined,
            providerSource:
              nextFilters.providerSource !== 'all' ? nextFilters.providerSource : undefined,
            userId: nextFilters.userId || undefined,
          },
        });

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to load admin transactions');
        }

        const payload = response.data || {};
        setTransactions(Array.isArray(payload.data) ? payload.data : []);
        setSummary({
          totalTransactions: Number(payload.summary?.totalTransactions || 0),
          totalAmount: Number(payload.summary?.totalAmount || 0),
          successCount: Number(payload.summary?.successCount || 0),
          failedCount: Number(payload.summary?.failedCount || 0),
          refundCount: Number(payload.summary?.refundCount || 0),
          processingCount: Number(payload.summary?.processingCount || 0),
        });
        setPagination({
          total: Number(payload.pagination?.total || 0),
          totalPages: Number(payload.pagination?.totalPages || 0),
          hasMore: Boolean(payload.pagination?.hasMore),
        });
        setPage(safePage);
        setLimit(safeLimit);
      } catch (loadError) {
        const message =
          loadError?.response?.data?.message || loadError?.message || 'Failed to load transactions';
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedFilters, authToken, isPrimaryAdmin, limit, page]
  );

  useEffect(() => {
    loadTransactions({ nextPage: page, nextLimit: limit, nextFilters: appliedFilters });
  }, [appliedFilters, loadTransactions, limit, page]);

  const refreshList = useCallback(
    (silent = true) =>
      loadTransactions({
        nextPage: page,
        nextLimit: limit,
        nextFilters: appliedFilters,
        silent,
      }),
    [appliedFilters, loadTransactions, limit, page]
  );

  const openDetails = useCallback(
    async (transaction) => {
      const identifier = String(transaction?._id || transaction?.id || transaction?.reference || '').trim();
      if (!identifier) return;

      setSelectedTransaction(transaction);
      setTransactionDetails(null);
      setDetailError('');
      setDetailLoading(true);

      try {
        const response = await axios.get(`/api/admin/transactions/${encodeURIComponent(identifier)}`, {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
        });

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to load transaction details');
        }

        setTransactionDetails(response?.data?.data || null);
      } catch (detailLoadError) {
        const message =
          detailLoadError?.response?.data?.message ||
          detailLoadError?.message ||
          'Failed to load transaction details';
        setDetailError(message);
        toast.error(message);
      } finally {
        setDetailLoading(false);
      }
    },
    [authToken]
  );

  const closeDetails = useCallback(() => {
    setSelectedTransaction(null);
    setTransactionDetails(null);
    setDetailError('');
    setDetailLoading(false);
    setActionBusy('');
    setActionNote('');
  }, []);
  const applyFilters = useCallback(
    (event) => {
      event.preventDefault();
      const nextFilters = { ...draftFilters };
      setAppliedFilters(nextFilters);
      setPage(1);
      syncQuery(nextFilters, 1, limit);
    },
    [draftFilters, limit, syncQuery]
  );

  const resetFilters = useCallback(() => {
    const nextFilters = {
      search: '',
      status: 'all',
      type: 'all',
      providerSource: 'all',
      userId: '',
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
    syncQuery(nextFilters, 1, limit);
  }, [limit, syncQuery]);

  const goToPage = useCallback(
    (nextPage) => {
      const safePage = Math.max(1, Number(nextPage) || 1);
      setPage(safePage);
      syncQuery(appliedFilters, safePage, limit);
    },
    [appliedFilters, limit, syncQuery]
  );

  const changeLimit = useCallback(
    (nextLimit) => {
      const safeLimit = Math.min(Math.max(Number(nextLimit) || 20, 5), 100);
      setLimit(safeLimit);
      setPage(1);
      syncQuery(appliedFilters, 1, safeLimit);
    },
    [appliedFilters, syncQuery]
  );

  const refreshSelected = useCallback(async () => {
    const identifier = String(
      transactionDetails?.transaction?._id ||
        transactionDetails?.transaction?.id ||
        selectedTransaction?._id ||
        selectedTransaction?.id ||
        selectedTransaction?.reference ||
        ''
    ).trim();
    if (!identifier) return;
    await openDetails(transactionDetails?.transaction || selectedTransaction);
  }, [openDetails, selectedTransaction, transactionDetails]);

  const updateTransaction = useCallback(
    async (nextAction) => {
      const targetTransaction = transactionDetails?.transaction || selectedTransaction || null;
      const identifier = String(
        targetTransaction?._id || targetTransaction?.id || targetTransaction?.reference || ''
      ).trim();

      if (!identifier) return;

      const confirmMessage =
        nextAction === 'success'
          ? 'Mark this transaction as successful?'
          : nextAction === 'refund'
            ? 'Refund this transaction and credit the wallet back?'
            : 'Mark this transaction as failed?';

      if (!window.confirm(confirmMessage)) return;

      try {
        setActionBusy(nextAction);
        const response = await axios.patch(
          `/api/admin/transactions/${encodeURIComponent(identifier)}/status`,
          {
            status: nextAction,
            action: nextAction,
            note: actionNote.trim() || undefined,
            reason: actionNote.trim() || undefined,
          },
          {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: networkTimeout,
          }
        );

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to update transaction');
        }

        toast.success(response?.data?.message || 'Transaction updated');
        setActionNote('');
        if (response?.data?.data?.transaction) {
          setTransactionDetails((previous) => ({
            ...(previous || {}),
            transaction: response.data.data.transaction,
            userOverview:
              response?.data?.data?.userOverview || previous?.userOverview || null,
          }));
          setSelectedTransaction(response.data.data.transaction);
        }

        await refreshList(true);
      } catch (updateError) {
        const message =
          updateError?.response?.data?.message ||
          updateError?.message ||
          'Failed to update transaction';
        toast.error(message);
        setDetailError(message);
      } finally {
        setActionBusy('');
      }
    },
    [actionNote, authToken, refreshList, selectedTransaction, transactionDetails]
  );

  if (!isPrimaryAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const detail = transactionDetails?.transaction || selectedTransaction;
  const detailUser = transactionDetails?.userOverview?.user || detail?.userId || {};
  const detailWallet = transactionDetails?.userOverview?.wallet || null;
  const detailRecentTransactions = Array.isArray(transactionDetails?.userOverview?.transactions)
    ? transactionDetails.userOverview.transactions
    : [];

  const summaryCards = [
    ['Total', summary.totalTransactions, 'primary'],
    ['Successful', summary.successCount, 'success'],
    ['Refunded', summary.refundCount, 'warning'],
    ['Failed', summary.failedCount, 'danger'],
    ['Processing', summary.processingCount, 'info'],
    ['Amount', money(summary.totalAmount), 'dark'],
  ];

  return (
    <div className="content admin-transactions-page">
      <Row className="mb-4">
        <Col xs="12">
          <Card className="shadow-sm border-0 transactions-workspace-card">
            <CardHeader className="d-flex flex-wrap justify-content-between align-items-start gap-3">
              <div>
                <CardTitle tag="h2" className="mb-1">
                  Transactions
                </CardTitle>
                <div className="text-muted small">
                  Search, inspect, refund, or mark transactions directly from the admin workspace.
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Button color="secondary" outline type="button" disabled={loading || refreshing} onClick={() => refreshList(true)}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </Button>
                <Button color="info" outline type="button" onClick={() => navigate('/admin/role-manager')}>
                  Open User Manager
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {error ? (
                <Alert color="danger" className="mb-4">
                  {error}
                </Alert>
              ) : null}

              <Row className="g-3 mb-4 transactions-summary-grid">
                {summaryCards.map(([label, value, tone]) => (
                  <Col key={label} xs="12" sm="6" lg="4">
                    <Card className={`border h-100 transactions-summary-card transactions-summary-card--${tone}`}>
                      <CardBody>
                        <div className="text-muted small">{label}</div>
                        <div className={`fw-bold fs-4 text-${tone}`}>{value}</div>
                      </CardBody>
                    </Card>
                  </Col>
                ))}
              </Row>

              <form onSubmit={applyFilters} className="mb-4 transactions-filter-panel">
                <Row className="g-3 transactions-filter-grid">
                  <Col lg="4" md="6" xs="12">
                    <FormGroup>
                      <Label>Search</Label>
                      <Input
                        type="text"
                        placeholder="Reference, phone, provider, name..."
                        value={draftFilters.search}
                        onChange={(event) =>
                          setDraftFilters((previous) => ({
                            ...previous,
                            search: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col lg="2" md="6" xs="12">
                    <FormGroup>
                      <Label>Status</Label>
                      <Input
                        type="select"
                        value={draftFilters.status}
                        onChange={(event) =>
                          setDraftFilters((previous) => ({
                            ...previous,
                            status: event.target.value,
                          }))
                        }
                      >
                        <option value="all">All</option>
                        <option value="success">Successful</option>
                        <option value="processing">Processing</option>
                        <option value="failed">Failed</option>
                        <option value="refund">Refunded</option>
                        <option value="pending">Pending</option>
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col lg="2" md="6" xs="12">
                    <FormGroup>
                      <Label>Type</Label>
                      <Input
                        type="select"
                        value={draftFilters.type}
                        onChange={(event) =>
                          setDraftFilters((previous) => ({
                            ...previous,
                            type: event.target.value,
                          }))
                        }
                      >
                        <option value="all">All</option>
                        <option value="data">Data</option>
                        <option value="airtime">Airtime</option>
                        <option value="tv">TV</option>
                        <option value="electricity">Electricity</option>
                        <option value="wallet-adjustment">Wallet Adjustment</option>
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col lg="2" md="6" xs="12">
                    <FormGroup>
                      <Label>Provider</Label>
                      <Input
                        type="select"
                        value={draftFilters.providerSource}
                        onChange={(event) =>
                          setDraftFilters((previous) => ({
                            ...previous,
                            providerSource: event.target.value,
                          }))
                        }
                      >
                        <option value="all">All</option>
                        <option value="aidapay">Aidapay</option>
                        <option value="directortech">Directortech</option>
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col lg="2" md="6" xs="12">
                    <FormGroup>
                      <Label>User ID</Label>
                      <Input
                        type="text"
                        placeholder="Filter by user"
                        value={draftFilters.userId}
                        onChange={(event) =>
                          setDraftFilters((previous) => ({
                            ...previous,
                            userId: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                </Row>

                <div className="d-flex flex-wrap gap-2 mt-3">
                  <Button color="primary" type="submit" disabled={loading || refreshing}>
                    Apply Filters
                  </Button>
                  <Button color="secondary" outline type="button" onClick={resetFilters} disabled={loading || refreshing}>
                    Reset
                  </Button>
                </div>
              </form>

              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 transactions-pagination-toolbar">
                <div className="text-muted small">
                  Page {page} of {pagination.totalPages || 1} | {pagination.total} total records
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <div style={{ minWidth: 140 }}>
                    <Input type="select" value={String(limit)} onChange={(event) => changeLimit(Number(event.target.value || 20))}>
                      <option value="10">10 / page</option>
                      <option value="20">20 / page</option>
                      <option value="50">50 / page</option>
                    </Input>
                  </div>
                  <Button color="secondary" outline type="button" disabled={loading || page <= 1} onClick={() => goToPage(page - 1)}>
                    Previous
                  </Button>
                  <Button color="secondary" outline type="button" disabled={loading || !pagination.hasMore} onClick={() => goToPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-5">
                  <Spinner />
                  <div className="mt-2 text-muted">Loading transactions...</div>
                </div>
              ) : transactions.length ? (
                <div className="transactions-table-card table-responsive">
                  <table className="table align-middle table-hover">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>User</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Provider</th>
                        <th>Recipient</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction) => (
                        <tr
                          key={String(transaction._id || transaction.reference || '')}
                          role="button"
                          style={{ cursor: 'pointer' }}
                          onClick={() => openDetails(transaction)}
                        >
                          <td className="fw-bold">
                            {String(transaction.reference || '').trim() || 'N/A'}
                          </td>
                          <td>{getUserLabel(transaction)}</td>
                          <td>
                            <Badge color={getTypeColor(transaction.type)} pill>
                              {String(transaction.type || 'transaction')}
                            </Badge>
                          </td>
                          <td>
                            <Badge color={getStatusColor(transaction.status)} pill>
                              {String(transaction.status || 'pending')}
                            </Badge>
                          </td>
                          <td>{money(transaction.amount)}</td>
                          <td>
                            {String(transaction?.metadata?.providerSource || '').trim() || 'N/A'}
                          </td>
                          <td>{getRecipient(transaction)}</td>
                          <td>{dateTime(transaction.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Alert color="light" className="mb-0">
                  No transactions matched the current filters.
                </Alert>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Modal isOpen={Boolean(selectedTransaction)} toggle={closeDetails} size="xl">
        <ModalHeader toggle={closeDetails}>Transaction details</ModalHeader>
        <ModalBody>
          {detailError ? (
            <Alert color="danger" className="mb-3">
              {detailError}
            </Alert>
          ) : null}

          {detailLoading && !detail ? (
            <div className="text-center py-4">
              <Spinner />
              <div className="mt-2 text-muted">Loading transaction details...</div>
            </div>
          ) : detail ? (
            <>
              <Row className="g-3">
                <Col lg="7" xs="12">
                  <Card className="border shadow-sm h-100 transactions-detail-card transactions-detail-card--main">
                    <CardBody>
                      <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                        <div>
                          <div className="text-muted small">Reference</div>
                          <div className="fw-bold fs-5">
                            {String(detail.reference || '').trim() || 'N/A'}
                          </div>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          <Badge color={getStatusColor(detail.status)} pill>
                            {String(detail.status || 'pending')}
                          </Badge>
                          <Badge color={getTypeColor(detail.type)} pill>
                            {String(detail.type || 'transaction')}
                          </Badge>
                        </div>
                      </div>

                      <Row className="g-3 mb-3">
                        <Col md="6" xs="12">
                          <div className="text-muted small">Amount</div>
                          <div className="fw-bold">{money(detail.amount)}</div>
                        </Col>
                        <Col md="6" xs="12">
                          <div className="text-muted small">Recipient</div>
                          <div className="fw-bold">{getRecipient(detail)}</div>
                        </Col>
                        <Col md="6" xs="12">
                          <div className="text-muted small">Provider source</div>
                          <div className="fw-bold">
                            {String(detail?.metadata?.providerSource || '').trim() || 'N/A'}
                          </div>
                        </Col>
                        <Col md="6" xs="12">
                          <div className="text-muted small">Provider reference</div>
                          <div className="fw-bold">
                            {String(
                              detail?.metadata?.providerReference ||
                                detail?.metadata?.providerTransactionHash ||
                                detail.reference ||
                                ''
                            ).trim() || 'N/A'}
                          </div>
                        </Col>
                        <Col md="6" xs="12">
                          <div className="text-muted small">Created</div>
                          <div className="fw-bold">{dateTime(detail.createdAt)}</div>
                        </Col>
                        <Col md="6" xs="12">
                          <div className="text-muted small">Completed</div>
                          <div className="fw-bold">{dateTime(detail.completedAt)}</div>
                        </Col>
                      </Row>

                      <FormGroup className="mb-3">
                        <Label>Action note / reason</Label>
                        <Input
                          type="textarea"
                          rows="3"
                          placeholder="Optional note to send with status changes"
                          value={actionNote}
                          onChange={(event) => setActionNote(event.target.value)}
                        />
                      </FormGroup>

                      <div className="d-flex flex-wrap gap-2">
                        <Button
                          color="success"
                          type="button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => updateTransaction('success')}
                        >
                          {actionBusy === 'success' ? <Spinner size="sm" /> : 'Mark Successful'}
                        </Button>
                        <Button
                          color="warning"
                          type="button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => updateTransaction('refund')}
                        >
                          {actionBusy === 'refund' ? <Spinner size="sm" /> : 'Refund'}
                        </Button>
                        <Button
                          color="danger"
                          outline
                          type="button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => updateTransaction('failed')}
                        >
                          {actionBusy === 'failed' ? <Spinner size="sm" /> : 'Mark Failed'}
                        </Button>
                        <Button
                          color="secondary"
                          outline
                          type="button"
                          disabled={detailLoading || Boolean(actionBusy)}
                          onClick={refreshSelected}
                        >
                          Refresh Details
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                </Col>

                <Col lg="5" xs="12">
                  <Card className="border shadow-sm h-100 transactions-detail-card transactions-detail-card--side">
                    <CardBody>
                      <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                        <div>
                          <div className="text-muted small">Customer</div>
                          <div className="fw-bold">
                            {detailUser?.fullName || detailUser?.fullname || getUserLabel(detail)}
                          </div>
                          <div className="text-muted small">
                            {detailUser?.emailAddress || detailUser?.email || 'N/A'}
                          </div>
                        </div>
                        <Button color="info" outline type="button" onClick={() => navigate('/admin/role-manager')}>
                          Open User Manager
                        </Button>
                      </div>

                      <div className="d-flex gap-2 mb-3">
                        <Card className="border flex-fill transactions-detail-mini-card">
                          <CardBody>
                            <div className="text-muted small">Wallet</div>
                            <div className="fw-bold">
                              {detailWallet ? money(detailWallet.balance) : 'N/A'}
                            </div>
                            <div className="text-muted small">
                              {detailWallet?.currency || 'NGN'} | {detailWallet?.status || 'active'}
                            </div>
                          </CardBody>
                        </Card>
                        <Card className="border flex-fill transactions-detail-mini-card">
                          <CardBody>
                            <div className="text-muted small">Recent tx</div>
                            <div className="fw-bold">{detailRecentTransactions.length}</div>
                            <div className="text-muted small">
                              {transactionDetails?.userOverview?.summary?.successCount || 0} successful
                            </div>
                          </CardBody>
                        </Card>
                      </div>

                      {detailRecentTransactions.length ? (
                        <div className="transactions-detail-table-card table-responsive">
                          <table className="table table-sm align-middle">
                            <thead>
                              <tr>
                                <th>Ref</th>
                                <th>Status</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailRecentTransactions.map((transaction) => (
                                <tr key={String(transaction._id || transaction.reference || '')}>
                                  <td>
                                    <div className="fw-bold">
                                      {String(transaction.reference || '').trim() || 'N/A'}
                                    </div>
                                    <div className="text-muted small">{dateTime(transaction.createdAt)}</div>
                                  </td>
                                  <td>
                                    <Badge color={getStatusColor(transaction.status)} pill>
                                      {String(transaction.status || 'pending')}
                                    </Badge>
                                  </td>
                                  <td>{money(transaction.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Alert color="light" className="mb-0">
                          No recent user transactions were found.
                        </Alert>
                      )}
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              {detail?.metadata ? (
                <div className="mt-3">
                  <div className="text-muted small mb-2">Transaction metadata</div>
                  <pre className="bg-light border rounded p-3 small mb-0" style={{ maxHeight: 220, overflow: 'auto' }}>
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
            </>
          ) : (
            <Alert color="light" className="mb-0">
              Select a transaction to inspect it.
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline type="button" onClick={closeDetails}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export default Transactions;
