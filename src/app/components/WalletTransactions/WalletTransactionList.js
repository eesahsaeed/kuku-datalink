import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  ListGroup,
  ListGroupItem,
  Badge,
  Pagination,
  PaginationItem,
  PaginationLink,
  Modal,
  ModalHeader,
  ModalBody,
  Spinner,
  Row,
  Col,
  Card,
  CardBody,
  CardHeader,
} from 'components/ui/primitives';
import { format } from 'date-fns';
import axios from 'axios';
import { toast } from 'sonner';
import { getUser, networkTimeout } from '../../../lib/helper';
import { useSocket } from 'contexts/SocketContext';

const ITEMS_PER_PAGE = 5;
const MAX_VISIBLE_PAGES = 5;

const formatAsNaira = (amount) => {
  const num =
    typeof amount === 'string' ? parseFloat(amount) : Number(amount || 0);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(num);
};

const formatDate = (dateString) => {
  try {
    return format(new Date(dateString), 'dd MMM yyyy, hh:mm a');
  } catch {
    return 'Invalid date';
  }
};

const getStatusBadgeColor = (rawStatus) => {
  const status = String(rawStatus || '')
    .toLowerCase()
    .trim();

  if (status === 'success' || status === 'successful') return 'success';
  if (status === 'mismatch') return 'warning';
  if (status === 'failed' || status === 'fail' || status === 'error') {
    return 'danger';
  }

  return 'secondary';
};

const isUtilityTransaction = (tx) => {
  const type = String(tx?.type || '')
    .toLowerCase()
    .trim();

  return (
    type === 'electricity' ||
    type.startsWith('electricity-') ||
    type === 'utility' ||
    type.startsWith('utility-')
  );
};

const isCreditTransaction = (tx) => {
  const type = String(tx?.type || '')
    .toLowerCase()
    .trim();
  const status = String(tx?.status || '')
    .toLowerCase()
    .trim();

  return (
    type === 'credit' ||
    (status === 'success' &&
      !type.includes('data') &&
      !type.includes('electricity') &&
      !type.includes('tv'))
  );
};

const getServiceLabel = (tx, extraDetails = null) => {
  const type = String(tx?.type || '')
    .toLowerCase()
    .trim();

  if (type === 'credit') return 'Wallet Funding';
  if (type === 'data') return 'Data Bundle';
  if (type === 'airtime') return 'Airtime Recharge';
  if (type.startsWith('tv-')) return 'TV Subscription';
  if (isUtilityTransaction(tx)) return 'Utility Payment';

  return extraDetails?.data?.service || tx?.type || 'Wallet Transaction';
};

const pickFirstPresent = (...values) =>
  values.find((value) => value !== undefined && value !== null);

const pickFirstNonEmptyString = (...values) =>
  values
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim();

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeMeterToken = (value) => {
  const rawValue = pickFirstNonEmptyString(value);
  if (!rawValue) return null;

  const digitsOnly = rawValue.replace(/[^\d]/g, '');
  if (digitsOnly.length >= 16 && digitsOnly.length <= 24) {
    return digitsOnly;
  }

  return rawValue;
};

const formatMeterTokenDisplay = (token) => {
  const normalizedToken = normalizeMeterToken(token);
  if (!normalizedToken) return null;

  if (/^\d+$/.test(normalizedToken)) {
    return normalizedToken.match(/.{1,4}/g)?.join(' ') || normalizedToken;
  }

  return normalizedToken;
};

const parseElectricityTokenMessage = (message = '') => {
  const normalizedMessage = String(message || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalizedMessage) {
    return {
      token: null,
      units: null,
      customerMessage: '',
    };
  }

  const tokenMatch = normalizedMessage.match(
    /(?:token|token code|meter token|activation code)\s*[:-]?\s*((?:\d[\s-]*){16,24})/i
  );
  const unitsMatch = normalizedMessage.match(
    /(?:units?|token units?|units purchased)\s*[:-]?\s*([\d,.]+(?:\.\d+)?)/i
  );

  return {
    token: normalizeMeterToken(tokenMatch?.[1]),
    units: toOptionalNumber(unitsMatch?.[1]),
    customerMessage: normalizedMessage,
  };
};

const extractElectricityTokenDetails = (
  providerData = {},
  { meterNumber = '', meterType = 'prepaid', providerCode = '' } = {}
) => {
  const normalizedProviderData =
    providerData && typeof providerData === 'object' ? providerData : {};
  const data =
    normalizedProviderData?.data ||
    normalizedProviderData?.providerResponse?.data ||
    {};
  const transactionData =
    data?.transaction_data || normalizedProviderData?.transaction_data || {};

  const messageCandidates = [
    transactionData.special_message,
    data.special_message,
    transactionData.customer_message,
    data.customer_message,
    normalizedProviderData.customer_message,
    transactionData.message,
    data.message,
    normalizedProviderData.message,
  ].filter(Boolean);

  const parsedMessage =
    messageCandidates
      .map((message) => parseElectricityTokenMessage(message))
      .find((entry) => entry.token || entry.customerMessage) || {};

  const token = normalizeMeterToken(
    pickFirstPresent(
      transactionData.token,
      transactionData.meter_token,
      transactionData.token_code,
      transactionData.token_value,
      transactionData.token_number,
      data.token,
      data.meter_token,
      data.token_code,
      data.token_value,
      data.token_number,
      normalizedProviderData.token,
      normalizedProviderData.meter_token,
      normalizedProviderData.token_code,
      normalizedProviderData.token_value,
      normalizedProviderData.token_number,
      parsedMessage.token
    )
  );

  const units = toOptionalNumber(
    pickFirstPresent(
      transactionData.token_units,
      transactionData.units,
      transactionData.units_purchased,
      transactionData.unit,
      data.token_units,
      data.units,
      data.units_purchased,
      normalizedProviderData.token_units,
      normalizedProviderData.units,
      normalizedProviderData.units_purchased,
      parsedMessage.units
    )
  );

  const customerMessage =
    pickFirstNonEmptyString(
      transactionData.special_message,
      data.special_message,
      transactionData.customer_message,
      data.customer_message,
      normalizedProviderData.customer_message
    ) ||
    parsedMessage.customerMessage ||
    '';

  const tokenDetails = {
    token,
    displayToken: formatMeterTokenDisplay(token),
    units,
    customerMessage,
    meterNumber:
      pickFirstNonEmptyString(
        transactionData.recipient,
        data.recipient,
        normalizedProviderData.recipient,
        meterNumber
      ) || meterNumber,
    meterType,
    providerCode,
    available: Boolean(token || customerMessage || units !== null),
  };

  return tokenDetails.available ? tokenDetails : null;
};

const getPageNumbers = (current, total) => {
  current = Number(current) || 1;
  total = Number(total) || 1;

  if (total <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const windowSize = MAX_VISIBLE_PAGES - 2;
  let start = Math.max(2, current - Math.floor(windowSize / 2));
  let end = start + windowSize - 1;

  if (end >= total) {
    end = total - 1;
    start = Math.max(2, end - windowSize + 1);
  }

  const middlePages = [];
  for (let page = start; page <= end; page += 1) {
    middlePages.push(page);
  }

  const pages = [1];
  if (start > 2) pages.push('...');
  pages.push(...middlePages);
  if (end < total - 1) pages.push('...');
  pages.push(total);

  return pages.filter(
    (page, index, arr) => page === '...' || arr.indexOf(page) === index
  );
};

const WalletTransactionList = ({
  transactions: externalTransactions = null,
}) => {
  const socket = useSocket();
  const currentUser = getUser();
  const usesExternalTransactions = Array.isArray(externalTransactions);

  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });

  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [extraDetails, setExtraDetails] = useState(null);
  const lastAutoRequeryReferenceRef = useRef('');

  const currentPage = Number(pagination.page) || 1;
  const totalPages = Number(pagination.totalPages) || 1;

  const visibleTransactions = useMemo(() => {
    if (!usesExternalTransactions) return transactions;
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return externalTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [
    currentPage,
    externalTransactions,
    transactions,
    usesExternalTransactions,
  ]);
  const paginationSummary =
    pagination.total === 0
      ? 'No transactions to show'
      : `Showing ${visibleTransactions.length} of ${pagination.total} transactions`;

  const fetchTransactions = async (page = 1) => {
    if (usesExternalTransactions) return;
    setLoading(true);
    try {
      const res = await axios.get(
        `/api/wallet/transactions?page=${page}&limit=${ITEMS_PER_PAGE}`,
        {
          headers: { Authorization: `Bearer ${currentUser.token}` },
          timeout: networkTimeout,
        }
      );

      if (res.data.success) {
        const pg = res.data.pagination || {};
        setTransactions(res.data.transactions || []);
        setPagination({
          page: Number(pg.page) || 1,
          totalPages: Number(pg.totalPages) || 1,
          total: Number(pg.totalTransactions) || 0,
        });
      } else {
        toast.error('Failed to load transactions');
      }
    } catch (err) {
      console.error('Transactions fetch error:', err);
      toast.error('Could not load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (usesExternalTransactions) return;
    fetchTransactions(1);
  }, [usesExternalTransactions]);

  useEffect(() => {
    if (!usesExternalTransactions) return;
    setPagination({
      page: 1,
      totalPages: Math.max(
        1,
        Math.ceil(externalTransactions.length / ITEMS_PER_PAGE)
      ),
      total: externalTransactions.length,
    });
  }, [externalTransactions, usesExternalTransactions]);

  useEffect(() => {
    if (usesExternalTransactions || !socket || !currentUser?.token) return;

    const handleCreditReceived = (data) => {
      if (!data?.amount) return;
      const newTransaction = {
        _id: data.reference || `TXN-${Date.now()}`,
        type: 'credit',
        amount: Number(data.amount),
        description: data.description || 'Funding via virtual account',
        reference: data.reference || 'manual-funding',
        status: data.status || 'success',
        createdAt: data.timestamp || new Date().toISOString(),
        providerResponse: data.providerResponse,
      };

      setTransactions((prev) => {
        if (prev.some((tx) => tx.reference === newTransaction.reference))
          return prev;
        if (currentPage !== 1) return prev;
        return [newTransaction, ...prev].slice(0, ITEMS_PER_PAGE);
      });

      setPagination((prev) => ({
        ...prev,
        total: prev.total + 1,
        totalPages: Math.max(1, Math.ceil((prev.total + 1) / ITEMS_PER_PAGE)),
      }));
    };

    socket.on('wallet:updated', handleCreditReceived);
    return () => socket.off('wallet:updated', handleCreditReceived);
  }, [currentPage, socket, usesExternalTransactions]);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      if (usesExternalTransactions) {
        setPagination((prev) => ({ ...prev, page }));
      } else {
        fetchTransactions(page);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const serviceDetails = useMemo(() => {
    if (!selectedTx) return null;

    const fallbackRecipient =
      selectedTx.recipientPhone ||
      selectedTx.recipientSmartCardNumber ||
      selectedTx.recipientMeterNumber ||
      '';

    return {
      service: getServiceLabel(selectedTx, extraDetails),
      provider: selectedTx.provider_code || extraDetails?.data?.provider || '',
      packageName:
        selectedTx.package_name ||
        selectedTx.package_code ||
        extraDetails?.data?.package ||
        '',
      customerName:
        selectedTx?.metadata?.customer_name ||
        selectedTx?.metadata?.customer_info?.customer_name ||
        '',
      recipient: fallbackRecipient || extraDetails?.data?.recipient || '',
      recipientLabel: selectedTx.recipientPhone
        ? 'Recipient'
        : selectedTx.recipientSmartCardNumber
        ? 'Smart Card'
        : selectedTx.recipientMeterNumber
        ? 'Meter Number'
        : 'Recipient',
      commission:
        selectedTx?.pricing?.commission !== undefined &&
        selectedTx?.pricing?.commission !== null
          ? Number(selectedTx.pricing.commission)
          : null,
    };
  }, [extraDetails, selectedTx]);

  const selectedElectricityToken = useMemo(() => {
    if (!selectedTx || !isUtilityTransaction(selectedTx)) {
      return null;
    }

    const savedToken = selectedTx?.metadata?.electricityToken;
    if (savedToken?.available) return savedToken;

    return extractElectricityTokenDetails(extraDetails, {
      meterNumber: selectedTx?.recipientMeterNumber,
      meterType:
        selectedTx?.metadata?.meter_type ||
        selectedTx?.metadata?.meterType ||
        'prepaid',
      providerCode: selectedTx?.provider_code || '',
    });
  }, [extraDetails, selectedTx]);

  const openTransactionModal = (tx) => {
    setSelectedTx(tx);
    setModalOpen(true);
    setExtraDetails(tx?.providerResponse || tx?.metadata?.providerResponse || null);
    setModalLoading(!isCreditTransaction(tx));
  };

  useEffect(() => {
    if (!modalOpen) {
      lastAutoRequeryReferenceRef.current = '';
      setModalLoading(false);
      return undefined;
    }

    const reference = String(selectedTx?.reference || '').trim();
    if (!reference) {
      setModalLoading(false);
      return undefined;
    }

    if (isCreditTransaction(selectedTx)) {
      setModalLoading(false);
      return undefined;
    }

    if (lastAutoRequeryReferenceRef.current === reference) {
      return undefined;
    }

    lastAutoRequeryReferenceRef.current = reference;
    let cancelled = false;

    const runAutoRequery = async () => {
      setModalLoading(true);

      try {
        const explicitProviderSource =
          selectedTx?.metadata?.providerSource ||
          selectedTx?.metadata?.purchaseMode ||
          selectedTx?.providerSource ||
          selectedTx?.metadata?.source ||
          selectedTx?.source ||
          '';
        const normalizedProviderSource = String(explicitProviderSource || '')
          .toLowerCase()
          .trim();
        const providerReference =
          selectedTx?.metadata?.providerReference ||
          selectedTx?.metadata?.providerTransactionReference ||
          selectedTx?.metadata?.providerTransactionHash ||
          selectedTx?.providerReference ||
          selectedTx?.providerTransactionReference ||
          selectedTx?.providerTransactionHash ||
          selectedTx?.providerResponse?.providerReference ||
          selectedTx?.providerResponse?.providerTransactionReference ||
          selectedTx?.providerResponse?.providerTransactionHash ||
          selectedTx?.providerResponse?.data?.transaction_data?.provider_reference ||
          selectedTx?.providerResponse?.data?.transaction_data?.provider_tid ||
          selectedTx?.providerResponse?.data?.transaction_data?.provider_transaction_id ||
          selectedTx?.providerResponse?.data?.transaction_data?.provider_transaction_hash ||
          '';
        const requeryReference =
          normalizedProviderSource.includes('directortech')
            ? String(providerReference || reference).trim()
            : reference;
        const requeryEndpoint = normalizedProviderSource.includes(
          'directortech'
        )
          ? '/api/purchase/catalog/directortech/requery'
          : '/api/purchase/catalog/requery';

        console.info('[WalletTransactionList] auto requery payload', {
          endpoint: requeryEndpoint,
          internalReference: reference,
          providerReference: String(providerReference || '').trim(),
          requeryReference,
          reference,
          providerSource: normalizedProviderSource || 'aidapay',
        });

        const res = await axios.post(
          requeryEndpoint,
          {
            reference: requeryReference,
            providerReference: String(providerReference || '').trim(),
            providerTransactionHash: String(providerReference || '').trim(),
            providerSource: explicitProviderSource,
          },
          {
            timeout: networkTimeout,
          }
        );

        if (cancelled) return;

        const result = res.data;
        setExtraDetails(result);

        const recoveredElectricityToken = extractElectricityTokenDetails(
          result,
          {
            meterNumber: selectedTx?.recipientMeterNumber,
            meterType:
              selectedTx?.metadata?.meter_type ||
              selectedTx?.metadata?.meterType ||
              'prepaid',
            providerCode: selectedTx?.provider_code || '',
          }
        );

        if (recoveredElectricityToken?.available) {
          setSelectedTx((prev) => ({
            ...prev,
            metadata: {
              ...(prev?.metadata || {}),
              electricityToken: recoveredElectricityToken,
            },
          }));

          if (!usesExternalTransactions) {
            setTransactions((prev) =>
              prev.map((tx) =>
                tx.reference === reference
                  ? {
                      ...tx,
                      metadata: {
                        ...(tx.metadata || {}),
                        electricityToken: recoveredElectricityToken,
                      },
                    }
                  : tx
              )
            );
          }
        }
      } catch (err) {
        console.error('Transaction auto requery failed:', {
          reference,
          providerSource:
            selectedTx?.metadata?.providerSource ||
            selectedTx?.metadata?.purchaseMode ||
            selectedTx?.providerSource ||
            selectedTx?.metadata?.source ||
            selectedTx?.source ||
            '',
          error: err?.response?.data || err?.message || err,
          endpoint: err?.config?.url || null,
        });
      } finally {
        if (!cancelled) {
          setModalLoading(false);
        }
      }
    };

    runAutoRequery();

    return () => {
      cancelled = true;
    };
  }, [
    modalOpen,
    selectedTx?.reference,
    selectedTx?.metadata?.providerSource,
    selectedTx?.metadata?.purchaseMode,
    selectedTx?.providerSource,
    selectedTx?.metadata?.source,
    selectedTx?.source,
    selectedTx?.providerResponse,
    usesExternalTransactions,
  ]);

  if (loading && visibleTransactions.length === 0) {
    return (
      <p className="wallet-empty-copy text-center py-5">
        Loading transactions...
      </p>
    );
  }

  if (!loading && pagination.total === 0) {
    return (
      <p className="wallet-empty-copy text-center py-5">
        No transactions found.
      </p>
    );
  }

  return (
    <>
      <ListGroup flush>
        {visibleTransactions.map((tx) => {
          const type = String(tx.type || '').toLowerCase();
          const status = String(tx.status || '').toLowerCase();
          const isCredit =
            type === 'credit' ||
            (status === 'success' &&
              !type.includes('data') &&
              !type.includes('electricity') &&
              !type.includes('tv'));

          const statusColor = getStatusBadgeColor(tx.status);

          return (
            <ListGroupItem
              key={tx._id || tx.reference}
              onClick={() => openTransactionModal(tx)}
              className="wallet-transaction-item d-flex justify-content-between align-items-center border-0 px-0 py-3"
              style={{ cursor: 'pointer' }}
            >
              <div>
                <p className="wallet-transaction-title mb-0">
                  {tx.description || 'Wallet transaction'}
                </p>
                <small className="wallet-transaction-meta">
                  {formatDate(tx.createdAt)} | Ref:{' '}
                  {tx.reference?.substring(0, 12) || 'N/A'}...
                </small>
              </div>
              <div className="text-end">
                <p
                  className={`wallet-transaction-amount mb-1 ${
                    isCredit
                      ? 'wallet-transaction-amount-credit'
                      : 'wallet-transaction-amount-debit'
                  }`}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {isCredit ? '+' : '-'}
                  {formatAsNaira(tx.amount)}
                </p>
                <Badge
                  color={statusColor}
                  className="wallet-transaction-status-badge wallet-transaction-status-badge-list"
                  pill
                >
                  {tx.status}
                </Badge>
              </div>
            </ListGroupItem>
          );
        })}
      </ListGroup>

      {totalPages > 1 && (
        <div className="d-flex justify-content-center mt-4">
          <Pagination size="sm">
            <PaginationItem disabled={currentPage === 1}>
              <PaginationLink
                previous
                onClick={() => goToPage(currentPage - 1)}
              />
            </PaginationItem>
            {getPageNumbers(currentPage, totalPages).map((page, i) =>
              page === '...' ? (
                <span key={`ellipsis-${i}`} className="mx-2">
                  ...
                </span>
              ) : (
                <PaginationItem key={page} active={page === currentPage}>
                  <PaginationLink onClick={() => goToPage(page)}>
                    {page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem disabled={currentPage === totalPages}>
              <PaginationLink next onClick={() => goToPage(currentPage + 1)} />
            </PaginationItem>
          </Pagination>
        </div>
      )}

      <div className="wallet-pagination-meta text-center mt-3 small">
        {paginationSummary}
        {pagination.total > 0 ? ` | Page ${currentPage} of ${totalPages}` : ''}
      </div>

      {/* ==================== COMPACT & MOBILE RESPONSIVE MODAL ==================== */}
      <Modal
        isOpen={modalOpen}
        toggle={() => setModalOpen(false)}
        centered
        size="lg"
      >
        <ModalHeader toggle={() => setModalOpen(false)} className="py-3">
          Transaction Details
        </ModalHeader>
        <ModalBody className="pt-0">
          {modalLoading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
              <p className="mt-2 mb-0">Loading details...</p>
            </div>
          ) : selectedTx ? (
            <div className="px-1">
              {/* Basic Info - Compact */}
              <Card className="mb-3 shadow-sm">
                <CardHeader className="py-2 bg-light">
                  <strong className="wallet-modal-card-title">
                    {selectedTx.description || 'Wallet Transaction'}
                  </strong>
                </CardHeader>
                <CardBody className="py-3">
                  <Row className="g-3">
                    <Col xs={6} md={6}>
                      <small className="wallet-modal-label d-block">
                        Amount
                      </small>
                      <span
                        className={`wallet-modal-amount ${
                          selectedTx.type === 'credit'
                            ? 'wallet-transaction-amount-credit'
                            : 'wallet-transaction-amount-debit'
                        }`}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {selectedTx.type === 'credit' ? '+' : '-'}
                        {formatAsNaira(selectedTx.amount)}
                      </span>
                    </Col>
                    <Col xs={6} md={6} className="text-md-end">
                      <small className="wallet-modal-label d-block">
                        Status
                      </small>
                      <Badge
                        color={getStatusBadgeColor(selectedTx.status)}
                        className="wallet-transaction-status-badge wallet-transaction-status-badge-modal"
                        pill
                      >
                        {selectedTx.status?.toUpperCase()}
                      </Badge>
                    </Col>
                    <Col xs={12} className="pt-1">
                      <small className="wallet-modal-label">
                        Date / Reference
                      </small>
                      <br />
                      <small className="wallet-modal-value">
                        {formatDate(
                          selectedTx.completedAt || selectedTx.createdAt
                        )}{' '}
                        / <code>{selectedTx.reference}</code>
                      </small>
                    </Col>
                  </Row>
                </CardBody>
              </Card>

              {/* Original Transaction Info */}
              <Card className="mb-3 shadow-sm">
                <CardHeader className="py-2 bg-light">
                  Transaction Information
                </CardHeader>
                <CardBody className="py-3">
                  <Row className="g-2 small wallet-modal-value">
                    <Col xs={6}>
                      <strong>Service:</strong>{' '}
                      {serviceDetails?.service || selectedTx.type}
                    </Col>
                    <Col xs={6}>
                      <strong>Created:</strong>{' '}
                      {formatDate(selectedTx.createdAt)}
                    </Col>
                    {serviceDetails?.provider && (
                      <Col xs={6}>
                        <strong>Provider:</strong> {serviceDetails.provider}
                      </Col>
                    )}
                    <Col xs={6}>
                      <strong>Charged:</strong>{' '}
                      {formatAsNaira(selectedTx.amount)}
                    </Col>
                    {serviceDetails?.packageName && (
                      <Col xs={12}>
                        <strong>Package:</strong> {serviceDetails.packageName}
                      </Col>
                    )}
                    {serviceDetails?.customerName && (
                      <Col xs={12}>
                        <strong>Customer:</strong> {serviceDetails.customerName}
                      </Col>
                    )}
                    {serviceDetails?.recipient && (
                      <Col xs={12}>
                        <strong>{serviceDetails.recipientLabel}:</strong>{' '}
                        {serviceDetails.recipient}
                      </Col>
                    )}
                    {serviceDetails?.commission !== null && (
                      <Col xs={12}>
                        <strong>Commission:</strong>{' '}
                        {formatAsNaira(serviceDetails.commission)}
                      </Col>
                    )}
                  </Row>
                </CardBody>
              </Card>

              {isUtilityTransaction(selectedTx) &&
                selectedElectricityToken?.available && (
                  <Card className="mb-3 shadow-sm">
                    <CardHeader className="py-2 bg-success text-white">
                      Electricity Token
                    </CardHeader>
                    <CardBody className="py-3">
                      <Row className="g-3 small wallet-modal-value">
                        {selectedElectricityToken.displayToken && (
                          <Col xs={12}>
                            <strong>Token:</strong>
                            <br />
                            <code>{selectedElectricityToken.displayToken}</code>
                          </Col>
                        )}
                        {selectedElectricityToken.units !== null &&
                          selectedElectricityToken.units !== undefined && (
                            <Col xs={6}>
                              <strong>Units:</strong>
                              <br />
                              {selectedElectricityToken.units}
                            </Col>
                          )}
                        {selectedElectricityToken.meterType && (
                          <Col xs={6}>
                            <strong>Meter Type:</strong>
                            <br />
                            {selectedElectricityToken.meterType}
                          </Col>
                        )}
                        {selectedElectricityToken.customerMessage && (
                          <Col xs={12}>
                            <strong>Message:</strong>
                            <br />
                            {selectedElectricityToken.customerMessage}
                          </Col>
                        )}
                      </Row>
                    </CardBody>
                  </Card>
                )}

            </div>
          ) : null}
        </ModalBody>
      </Modal>
    </>
  );
};

export default WalletTransactionList;

WalletTransactionList.propTypes = {
  transactions: PropTypes.array,
};
