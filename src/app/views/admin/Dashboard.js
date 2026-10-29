import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Row,
  Col,
  Card,
  CardBody,
  CardTitle,
  Button,
  Alert,
  Spinner,
  Badge,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  FormGroup,
  Label,
  Input,
} from 'components/ui/primitives';
import { Bar, Line } from 'react-chartjs-2';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import TransactionPinPrompt from 'components/TransactionPinPrompt/TransactionPinPrompt';
import RecentTransactionsSection from './components/RecentTransactionsSection';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useSocket } from 'contexts/SocketContext';
import { getUser, networkTimeout } from '../../../lib/helper';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend
);

const formatNGN = (value = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatProviderBalance = (value) =>
  Number.isFinite(Number(value)) ? formatNGN(value) : 'Unavailable';

const LOW_BALANCE_THRESHOLD = 20000;
const MANUAL_FUND_MINIMUM = 1;
const ATLAS_FREE_TIER_MB = 512;
const ROUGH_USER_STORAGE_KB = 7.5;
const ROUGH_TRANSACTION_STORAGE_KB = 4.5;
const buildDefaultDbStorage = () => ({
  atlasFreeTierMb: ATLAS_FREE_TIER_MB,
  totalRecords: 0,
  estimatedUsageMb: 0,
  schemaCounts: {},
});

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
    return value;
  }
};

const parseCurrencyInput = (value) => {
  const digitsOnly = String(value || '').replace(/[^\d]/g, '');
  return digitsOnly ? Number(digitsOnly) : 0;
};

const toSafeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toMoneyNumber = (value, fallback = 0) => {
  const numeric = toSafeNumber(value, fallback);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const normalizeRealtimeStatus = (status) => {
  const normalizedStatus = String(status || '').toLowerCase().trim();
  if (!normalizedStatus) return 'success';
  if (normalizedStatus === 'successful' || normalizedStatus === 'completed') {
    return 'success';
  }
  return normalizedStatus;
};

const normalizeTransactionPricing = (pricing = {}, fallbackAmount = 0) => {
  const sourcePricing = pricing && typeof pricing === 'object' ? pricing : {};
  const sellingPrice =
    sourcePricing.sellingPrice ?? sourcePricing.originalPrice ?? fallbackAmount;
  const originalPrice =
    sourcePricing.originalPrice ?? sourcePricing.sellingPrice ?? fallbackAmount;
  const packageOriginalAmount =
    sourcePricing.package_original_amount ??
    sourcePricing.originalPrice ??
    sourcePricing.sellingPrice ??
    fallbackAmount;

  return {
    ...sourcePricing,
    gain: toMoneyNumber(sourcePricing.gain, 0),
    commission: toMoneyNumber(sourcePricing.commission, 0),
    extra: toMoneyNumber(sourcePricing.extra, 0),
    fee: toMoneyNumber(sourcePricing.fee, 0),
    sellingPrice: toMoneyNumber(sellingPrice, fallbackAmount),
    originalPrice: toMoneyNumber(originalPrice, fallbackAmount),
    package_original_amount: toMoneyNumber(packageOriginalAmount, fallbackAmount),
  };
};

const normalizeRealtimeTransaction = (payload = {}) => {
  const fallbackAmount = toMoneyNumber(
    payload.amount ??
      payload.providerAmountPaid ??
      payload.pricing?.sellingPrice ??
      payload.pricing?.originalPrice,
    0
  );
  const normalizedPricing = normalizeTransactionPricing(
    payload.pricing || {},
    fallbackAmount
  );
  const derivedProfit = toMoneyNumber(
    toMoneyNumber(normalizedPricing.gain, 0) +
      toMoneyNumber(normalizedPricing.commission, 0) +
      toMoneyNumber(normalizedPricing.extra, 0),
    0
  );
  const normalizedProfit = toMoneyNumber(
    Number.isFinite(Number(payload.profit)) ? payload.profit : derivedProfit,
    derivedProfit
  );
  const normalizedAmount = toMoneyNumber(
    payload.amount ?? normalizedPricing.sellingPrice ?? fallbackAmount,
    fallbackAmount
  );

  return {
    ...payload,
    status: normalizeRealtimeStatus(payload.status),
    pricing: normalizedPricing,
    amount: normalizedAmount,
    profit: normalizedProfit,
    timestamp: payload.timestamp || payload.createdAt || new Date().toISOString(),
  };
};

const buildTodayProfitBreakdown = (values = {}) => ({
  gain: toMoneyNumber(values.gain, 0),
  fee: toMoneyNumber(values.fee, 0),
  extra: toMoneyNumber(values.extra, 0),
  commission: toMoneyNumber(values.commission, 0),
  profit: toMoneyNumber(values.profit, 0),
});

const incrementTodayProfitBreakdown = (previous = {}, delta = {}) => {
  const normalizedPrevious = buildTodayProfitBreakdown(previous);
  return buildTodayProfitBreakdown({
    gain: normalizedPrevious.gain + toMoneyNumber(delta.gain, 0),
    fee: normalizedPrevious.fee + toMoneyNumber(delta.fee, 0),
    extra: normalizedPrevious.extra + toMoneyNumber(delta.extra, 0),
    commission:
      normalizedPrevious.commission + toMoneyNumber(delta.commission, 0),
    profit: normalizedPrevious.profit + toMoneyNumber(delta.profit, 0),
  });
};

const makeTodayProfitBreakdownChartData = (breakdown = {}) => {
  const normalized = buildTodayProfitBreakdown(breakdown);
  return {
    labels: ['Gain', 'Fee', 'Extra', 'Commission', 'Profit'],
    datasets: [
      {
        label: "Today's Breakdown (NGN)",
        data: [
          normalized.gain,
          normalized.fee,
          normalized.extra,
          normalized.commission,
          normalized.profit,
        ],
        backgroundColor: [
          'rgba(54, 162, 235, 0.75)',
          'rgba(255, 193, 7, 0.75)',
          'rgba(23, 162, 184, 0.75)',
          'rgba(111, 66, 193, 0.75)',
          'rgba(40, 167, 69, 0.75)',
        ],
        borderColor: [
          'rgba(54, 162, 235, 1)',
          'rgba(255, 193, 7, 1)',
          'rgba(23, 162, 184, 1)',
          'rgba(111, 66, 193, 1)',
          'rgba(40, 167, 69, 1)',
        ],
        borderWidth: 1.6,
        borderRadius: 8,
      },
    ],
  };
};

const formatStorage = (valueInMb = 0) => {
  const numericValue = Number(valueInMb || 0);

  if (numericValue >= 1024) {
    return `${(numericValue / 1024).toFixed(2)} GB`;
  }

  if (numericValue >= 100) {
    return `${numericValue.toFixed(0)} MB`;
  }

  return `${numericValue.toFixed(1)} MB`;
};

const estimateAtlasUsageMb = ({
  dbStorage = null,
  totalUsers = 0,
  totalTransactions = 0,
} = {}) => {
  const serverEstimate = Number(dbStorage?.estimatedUsageMb);
  if (Number.isFinite(serverEstimate) && serverEstimate >= 0) {
    return serverEstimate;
  }

  return (
    (Number(totalUsers || 0) * ROUGH_USER_STORAGE_KB +
      Number(totalTransactions || 0) * ROUGH_TRANSACTION_STORAGE_KB) /
    1024
  );
};

const getAtlasUsageTone = (usagePercent = 0) => {
  if (usagePercent >= 85) {
    return {
      color: 'danger',
      label: 'High pressure',
    };
  }

  if (usagePercent >= 60) {
    return {
      color: 'warning',
      label: 'Watch closely',
    };
  }

  return {
    color: 'success',
    label: 'Comfortable',
  };
};

const isSameLagosDay = (left, right = Date.now()) => {
  if (!left) return false;
  return getLagosDateKey(left) === getLagosDateKey(right);
};

const getLagosDateKey = (value) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));

    const year = parts.find((part) => part.type === 'year')?.value || '0000';
    const month = parts.find((part) => part.type === 'month')?.value || '00';
    const day = parts.find((part) => part.type === 'day')?.value || '00';

    return `${year}-${month}-${day}`;
  } catch {
    return String(value || '').split('T')[0];
  }
};

const makeWalletFundingEventChartData = (chart = {}) => ({
  labels: chart.labels || [],
  datasets: [
    {
      label: 'Gross',
      data: chart.gross || [],
      backgroundColor: 'rgba(23, 162, 184, 0.2)',
      borderColor: 'rgba(23, 162, 184, 1)',
      borderWidth: 2.4,
      pointRadius: 2.2,
      pointHoverRadius: 4,
      tension: 0.36,
      cubicInterpolationMode: 'monotone',
      fill: false,
    },
    {
      label: 'Fee',
      data: chart.fees || [],
      backgroundColor: 'rgba(255, 193, 7, 0.2)',
      borderColor: 'rgba(255, 193, 7, 1)',
      borderWidth: 2.4,
      pointRadius: 2.2,
      pointHoverRadius: 4,
      tension: 0.36,
      cubicInterpolationMode: 'monotone',
      fill: false,
    },
    {
      label: 'Net',
      data: chart.net || [],
      backgroundColor: 'rgba(40, 167, 69, 0.2)',
      borderColor: 'rgba(40, 167, 69, 1)',
      borderWidth: 2.4,
      pointRadius: 2.2,
      pointHoverRadius: 4,
      tension: 0.36,
      cubicInterpolationMode: 'monotone',
      fill: false,
    },
  ],
});

const sumMoneySeries = (values = []) =>
  values.reduce((sum, value) => sum + toMoneyNumber(value, 0), 0);

const sumCountSeries = (values = []) =>
  values.reduce((sum, value) => sum + Number(value || 0), 0);

const buildWalletFundingPeriodSummary = (
  chart = {},
  fallback = {}
) => ({
  gross: toMoneyNumber(
    fallback.gross ?? sumMoneySeries(chart.gross || []),
    0
  ),
  fees: toMoneyNumber(
    fallback.fees ?? sumMoneySeries(chart.fees || []),
    0
  ),
  net: toMoneyNumber(
    fallback.net ?? sumMoneySeries(chart.net || []),
    0
  ),
  count: Number.isFinite(Number(fallback.count))
    ? Number(fallback.count)
    : sumCountSeries(chart.counts || []),
});

const incrementWalletFundingPeriodSummary = (previous = {}, delta = {}) =>
  buildWalletFundingPeriodSummary(
    {
      gross: [
        toMoneyNumber(previous.gross, 0) + toMoneyNumber(delta.gross, 0),
      ],
      fees: [toMoneyNumber(previous.fees, 0) + toMoneyNumber(delta.fees, 0)],
      net: [toMoneyNumber(previous.net, 0) + toMoneyNumber(delta.net, 0)],
      counts: [Number(previous.count || 0) + Number(delta.count || 0)],
    },
    {
      gross: toMoneyNumber(previous.gross, 0) + toMoneyNumber(delta.gross, 0),
      fees: toMoneyNumber(previous.fees, 0) + toMoneyNumber(delta.fees, 0),
      net: toMoneyNumber(previous.net, 0) + toMoneyNumber(delta.net, 0),
      count: Number(previous.count || 0) + Number(delta.count || 0),
    }
  );

const applyWalletFundingEventToChartData = (
  previous = {},
  point = {},
  maxLabels = null
) => {
  const baseChart =
    previous?.datasets?.length >= 3
      ? previous
      : makeWalletFundingEventChartData();
  let labels = [...(baseChart.labels || [])];
  let datasets = (baseChart.datasets || []).map((dataset) => ({
    ...dataset,
    data: [...(dataset.data || [])],
  }));

  let index = labels.indexOf(point.label);
  if (index === -1) {
    labels.push(point.label);
    datasets.forEach((dataset) => dataset.data.push(0));
    index = labels.length - 1;
  }

  datasets[0].data[index] = Number(datasets[0].data[index] || 0) + point.gross;
  datasets[1].data[index] = Number(datasets[1].data[index] || 0) + point.fee;
  datasets[2].data[index] = Number(datasets[2].data[index] || 0) + point.net;

  if (maxLabels && labels.length > maxLabels) {
    const startIndex = labels.length - maxLabels;
    labels = labels.slice(startIndex);
    datasets = datasets.map((dataset) => ({
      ...dataset,
      data: (dataset.data || []).slice(startIndex),
    }));
  }

  return {
    labels,
    datasets,
  };
};

const AdminDashboard = () => {
  const socket = useSocket();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socketStatus, setSocketStatus] = useState({
    connected: false,
    adminRoomJoined: false,
    state: 'disconnected',
    socketId: '',
    lastEvent: '',
    lastEventAt: '',
    error: '',
  });
  const [aidaPayBalance, setAidaPayBalance] = useState(null);
  const [aidaPayBalanceError, setAidaPayBalanceError] = useState('');
  const [paystackBalance, setPaystackBalance] = useState(null);
  const [paystackBalanceError, setPaystackBalanceError] = useState('');
  const [directortechBalance, setDirectortechBalance] = useState(null);
  const [directortechBalanceError, setDirectortechBalanceError] =
    useState('');
  const [lowBalanceWarning, setLowBalanceWarning] = useState(false);
  const [fundWalletModalOpen, setFundWalletModalOpen] = useState(false);
  const [fundWalletAmount, setFundWalletAmount] = useState('');
  const [fundWalletSubmitting, setFundWalletSubmitting] = useState(false);
  const [fundWalletOtpModalOpen, setFundWalletOtpModalOpen] = useState(false);
  const [fundWalletOtp, setFundWalletOtp] = useState('');
  const [fundWalletOtpSubmitting, setFundWalletOtpSubmitting] = useState(false);
  const [fundWalletOtpError, setFundWalletOtpError] = useState('');
  const [fundWalletTransferCode, setFundWalletTransferCode] = useState('');
  const [fundWalletTransferReference, setFundWalletTransferReference] =
    useState('');

  const [stats, setStats] = useState({
    totalUsers: 0,
    totalProfit: 0,
    todayProfit: 0,
    totalTransactions: 0,
    totalTransactionsAll: 0,
    dbStorage: buildDefaultDbStorage(),
  });

  const [weeklyProfitData, setWeeklyProfitData] = useState({
    labels: [],
    datasets: [],
  });
  const [todayProfitData, setTodayProfitData] = useState({
    labels: [],
    datasets: [],
  });
  const [todayProfitBreakdown, setTodayProfitBreakdown] = useState(
    buildTodayProfitBreakdown()
  );
  const [weeklyProfitSummary, setWeeklyProfitSummary] = useState({
    totalInPeriod: 0,
    totalGainInPeriod: 0,
    totalFeeInPeriod: 0,
    totalExtraInPeriod: 0,
    totalCommissionInPeriod: 0,
  });
  const [profitPeriodTab, setProfitPeriodTab] = useState('today');
  const [walletFundingPeriodTab, setWalletFundingPeriodTab] = useState('today');

  const [walletFundingEventTotals, setWalletFundingEventTotals] = useState({
    totalGross: 0,
    totalFees: 0,
    totalNet: 0,
    totalCount: 0,
    todayGross: 0,
    todayFees: 0,
    todayNet: 0,
    todayCount: 0,
  });
  const [walletFundingEventChartData, setWalletFundingEventChartData] = useState({
    labels: [],
    datasets: [],
  });
  const [walletFundingTodayChartData, setWalletFundingTodayChartData] = useState({
    labels: [],
    datasets: [],
  });
  const [walletFundingTodaySummary, setWalletFundingTodaySummary] = useState(
    buildWalletFundingPeriodSummary()
  );
  const [walletFundingWeeklySummary, setWalletFundingWeeklySummary] = useState(
    buildWalletFundingPeriodSummary()
  );
  const balanceRefreshTimeoutRef = useRef(null);
  const normalizedFundWalletAmount = parseCurrencyInput(fundWalletAmount);
  const formattedFundWalletAmount = normalizedFundWalletAmount
    ? new Intl.NumberFormat('en-NG').format(normalizedFundWalletAmount)
    : '';

  const resetFundWalletOtpState = () => {
    setFundWalletOtpModalOpen(false);
    setFundWalletOtp('');
    setFundWalletOtpSubmitting(false);
    setFundWalletOtpError('');
    setFundWalletTransferCode('');
    setFundWalletTransferReference('');
  };

  useEffect(() => {
    setProfitPeriodTab('today');
    setWalletFundingPeriodTab('today');
  }, []);

  useEffect(() => {
    setTodayProfitData(makeTodayProfitBreakdownChartData(todayProfitBreakdown));
  }, [todayProfitBreakdown]);

  const refreshAidapayBalance = async ({ silent = true } = {}) => {
    try {
      const currentUser = await Promise.resolve(getUser());
      const token = currentUser?.token;
      if (!token) return;

      const response = await axios.get('/api/admin/wallet/balance', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: networkTimeout,
      });

      const nextPaystackBalance = Number.isFinite(
        Number(response?.data?.paystackBalance)
      )
        ? toMoneyNumber(response.data.paystackBalance, 0)
        : null;
      setPaystackBalance(nextPaystackBalance);
      setPaystackBalanceError(response?.data?.paystackBalanceMessage || '');

      if (!response?.data?.success) {
        if (!silent) {
          const message =
            response?.data?.message || 'Unable to load Aidapay wallet balance';
          setAidaPayBalanceError(message);
        }
        return;
      }

      const nextBalance = toMoneyNumber(response.data.balance, 0);
      setAidaPayBalance(nextBalance);
      setLowBalanceWarning(nextBalance < LOW_BALANCE_THRESHOLD);
      setAidaPayBalanceError('');
    } catch (error) {
      console.error(
        '[Admin Dashboard] Failed to refresh Aidapay wallet balance:',
        error
      );

      if (!silent) {
        setAidaPayBalanceError(
          error.response?.data?.message ||
          error.message ||
            'Unable to load Aidapay wallet balance'
        );
      }
      setPaystackBalanceError((prev) =>
        prev || error.response?.data?.message || error.message || ''
      );
    }
  };

  const scheduleAidapayBalanceRefresh = (delayMs = 1200) => {
    if (balanceRefreshTimeoutRef.current) {
      window.clearTimeout(balanceRefreshTimeoutRef.current);
    }

    balanceRefreshTimeoutRef.current = window.setTimeout(() => {
      refreshAidapayBalance({ silent: true });
    }, delayMs);
  };

  const applyRealtimeWalletFundingEventToCharts = (
    payload,
    includeToday = true
  ) => {
    const label = getLagosDateKey(payload.timestamp || Date.now());
    const gross = toMoneyNumber(payload.grossAmount, 0);
    const fee = toMoneyNumber(payload.feeAmount, 0);
    const net = toMoneyNumber(payload.netAmount, 0);
    const point = { label, gross, fee, net };

    setWalletFundingEventChartData((prev) =>
      applyWalletFundingEventToChartData(prev, point, 7)
    );
    setWalletFundingWeeklySummary((prev) =>
      incrementWalletFundingPeriodSummary(prev, {
        gross,
        fees: fee,
        net,
        count: 1,
      })
    );

    if (includeToday) {
      setWalletFundingTodayChartData((prev) =>
        applyWalletFundingEventToChartData(prev, point, 1)
      );
      setWalletFundingTodaySummary((prev) =>
        incrementWalletFundingPeriodSummary(prev, {
          gross,
          fees: fee,
          net,
          count: 1,
        })
      );
    }
  };

  const loadDashboard = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    setAidaPayBalanceError('');
    setPaystackBalanceError('');
    setDirectortechBalanceError('');

    try {
      const currentUser = await getUser();
      const token = currentUser?.token;
      const headers = { Authorization: `Bearer ${token}` };

      const requestConfig = { headers, timeout: networkTimeout };
      const results = await Promise.allSettled([
        axios.get('/api/admin/stats', requestConfig),
        axios.get('/api/admin/wallet/balance', requestConfig),
        axios.get('/api/admin/profit/daily?days=7', requestConfig),
        axios.get('/api/admin/profit/daily?days=1', requestConfig),
        axios.get(
          '/api/admin/wallet-funding-events/overview?days=1',
          requestConfig
        ),
        axios.get(
          '/api/admin/wallet-funding-events/overview?days=7',
          requestConfig
        ),
      ]);

      const getRes = (index) =>
        results[index].status === 'fulfilled' ? results[index].value : null;

      const statsRes = getRes(0);
      const balanceRes = getRes(1);
      const weeklyProfitRes = getRes(2);
      const todayProfitRes = getRes(3);
      const walletFundingTodayOverviewRes = getRes(4);
      const walletFundingOverviewRes = getRes(5);

      if (statsRes?.data?.success) {
        const data = statsRes.data.data || {};
        setStats({
          totalUsers: Number(data.totalUsers) || 0,
          totalProfit: Number(data.totalProfit) || 0,
          todayProfit: Number(data.todayProfit) || 0,
          totalTransactions: Number(data.totalTransactions) || 0,
          totalTransactionsAll:
            Number(data.totalTransactionsAll ?? data.totalTransactions) || 0,
          dbStorage: data.dbStorage || buildDefaultDbStorage(),
        });
      }

      if (balanceRes?.data) {
        const nextPaystackBalance = Number.isFinite(
          Number(balanceRes.data.paystackBalance)
        )
          ? toMoneyNumber(balanceRes.data.paystackBalance, 0)
          : null;
        setPaystackBalance(nextPaystackBalance);
        setPaystackBalanceError(balanceRes.data.paystackBalanceMessage || '');
      } else if (results[1].status === 'rejected') {
        setPaystackBalance((prevBalance) =>
          Number.isFinite(Number(prevBalance))
            ? toMoneyNumber(prevBalance, 0)
            : null
        );
        setPaystackBalanceError(
          results[1].reason?.response?.data?.message ||
          results[1].reason?.message ||
            'Unable to load Paystack balance'
        );
      }

      if (balanceRes?.data) {
        const nextDirectortechBalance = Number.isFinite(
          Number(balanceRes.data.directortechBalance)
        )
          ? toMoneyNumber(balanceRes.data.directortechBalance, 0)
          : null;
        setDirectortechBalance(nextDirectortechBalance);
        setDirectortechBalanceError(
          balanceRes.data.directortechBalanceMessage || ''
        );
      } else if (results[1].status === 'rejected') {
        setDirectortechBalance((prevBalance) =>
          Number.isFinite(Number(prevBalance))
            ? toMoneyNumber(prevBalance, 0)
            : null
        );
        setDirectortechBalanceError(
          results[1].reason?.response?.data?.message ||
            results[1].reason?.message ||
            'Unable to load Directortech balance'
        );
      }

      if (balanceRes?.data?.success) {
        const bal = Number(balanceRes.data.balance ?? 0);
        setAidaPayBalance(bal);
        setLowBalanceWarning(bal < LOW_BALANCE_THRESHOLD);
        setAidaPayBalanceError('');
      } else {
        const balanceFailureMessage =
          results[1].status === 'rejected'
            ? results[1].reason?.response?.data?.message ||
              results[1].reason?.message ||
              'Unable to load Aidapay wallet balance'
            : balanceRes?.data?.message ||
              'Unable to load Aidapay wallet balance';

        setAidaPayBalance((prevBalance) => {
          const preservedBalance = Number.isFinite(Number(prevBalance))
            ? toMoneyNumber(prevBalance, 0)
            : null;
          setLowBalanceWarning(
            Number.isFinite(Number(preservedBalance))
              ? Number(preservedBalance) < LOW_BALANCE_THRESHOLD
              : false
          );
          return preservedBalance;
        });
        setAidaPayBalanceError(balanceFailureMessage);
      }

      if (weeklyProfitRes?.data?.success) {
        const {
          labels = [],
          profits = [],
          totalInPeriod = 0,
          totalGainInPeriod = 0,
          totalFeeInPeriod = 0,
          totalExtraInPeriod = 0,
          totalCommissionInPeriod = 0,
        } = weeklyProfitRes.data.data || {};
        setWeeklyProfitData({
          labels,
          datasets: [
            {
              label: 'Daily Profit (NGN)',
              data: profits,
              backgroundColor: 'rgba(54, 162, 235, 0.7)',
              borderColor: 'rgba(54, 162, 235, 1)',
              borderWidth: 2,
              borderRadius: 6,
            },
          ],
        });
        setWeeklyProfitSummary({
          totalInPeriod: toMoneyNumber(totalInPeriod, 0),
          totalGainInPeriod: toMoneyNumber(totalGainInPeriod, 0),
          totalFeeInPeriod: toMoneyNumber(totalFeeInPeriod, 0),
          totalExtraInPeriod: toMoneyNumber(totalExtraInPeriod, 0),
          totalCommissionInPeriod: toMoneyNumber(totalCommissionInPeriod, 0),
        });
      }

      if (todayProfitRes?.data?.success) {
        const {
          profits = [0],
          gains = [0],
          fees = [0],
          extras = [],
          commissions = [],
        } =
          todayProfitRes.data.data || {};
        const normalizedProfit = toMoneyNumber(profits?.[0], 0);
        const normalizedGain = toMoneyNumber(gains?.[0], 0);
        const normalizedFee = toMoneyNumber(fees?.[0], 0);
        const normalizedCommission = toMoneyNumber(commissions?.[0], 0);
        const normalizedExtra = toMoneyNumber(
          extras?.[0],
          0
        );
        setTodayProfitBreakdown({
          gain: normalizedGain,
          fee: normalizedFee,
          extra: normalizedExtra,
          commission: normalizedCommission,
          profit: normalizedProfit,
        });
        setStats((prev) => ({
          ...prev,
          todayProfit: normalizedProfit,
        }));
      }

      if (walletFundingOverviewRes?.data?.success) {
        const data = walletFundingOverviewRes.data.data || {};
        setWalletFundingEventTotals(data.totals || {});
        setWalletFundingEventChartData(
          makeWalletFundingEventChartData(data.chart || {})
        );
        setWalletFundingWeeklySummary(
          buildWalletFundingPeriodSummary(data.chart || {})
        );
      } else if (walletFundingTodayOverviewRes?.data?.success) {
        const data = walletFundingTodayOverviewRes.data.data || {};
        setWalletFundingEventTotals(data.totals || {});
      }

      if (walletFundingTodayOverviewRes?.data?.success) {
        const data = walletFundingTodayOverviewRes.data.data || {};
        setWalletFundingTodayChartData(
          makeWalletFundingEventChartData(data.chart || {})
        );
        setWalletFundingTodaySummary(
          buildWalletFundingPeriodSummary(data.chart || {}, {
            gross: data.totals?.todayGross,
            fees: data.totals?.todayFees,
            net: data.totals?.todayNet,
            count: data.totals?.todayCount,
          })
        );
      }

      const anyFailed = results.some((r) => r.status === 'rejected');
      if (anyFailed) {
        toast.warning(
          'Some admin dashboard data failed to load, showing partial results'
        );
      } else if (isRefresh) {
        toast.success('Dashboard refreshed successfully');
      }
    } catch (err) {
      const msg =
        err.response?.data?.message || err.message || 'Critical failure';
      console.error('[ADMIN DASHBOARD ERROR]', err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const submitManualFundTransfer = async ({
    otp = '',
    transferCode = '',
  } = {}) => {
    const currentUser = getUser();
    const token = currentUser?.token;
    const amount = normalizedFundWalletAmount;
    const nextTransferCode = String(transferCode || fundWalletTransferCode || '')
      .trim();
    const nextOtp = String(otp || fundWalletOtp || '').trim();

    if (!nextTransferCode && amount < MANUAL_FUND_MINIMUM) {
      toast.error('Enter an amount greater than NGN 0');
      return;
    }

    if (nextTransferCode && nextOtp.length !== 6) {
      setFundWalletOtpError('Enter the 6-digit OTP sent by Paystack.');
      return;
    }

    if (nextTransferCode) {
      setFundWalletOtpSubmitting(true);
    } else {
      setFundWalletSubmitting(true);
    }

    try {
      const response = await axios.post(
        '/api/admin/wallet/fund-manual',
        {
          amount,
          balanceObserved: paystackBalance,
          transferCode: nextTransferCode,
          otp: nextOtp,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
        }
      );

      const responseData = response.data || {};
      const transferData = responseData.data || {};

      if (transferData.requiresOtp) {
        setFundWalletTransferCode(transferData.transferCode || '');
        setFundWalletTransferReference(transferData.reference || '');
        setFundWalletOtp('');
        setFundWalletOtpError('');
        setFundWalletOtpModalOpen(true);
        setFundWalletModalOpen(false);
        toast.info(
          transferData.message ||
            'Paystack OTP required. Enter the code sent by Paystack to continue.'
        );
        return;
      }

      if (nextTransferCode) {
        resetFundWalletOtpState();
        setFundWalletAmount('');
      } else {
        setFundWalletAmount('');
        setFundWalletModalOpen(false);
      }

      toast.success(
        responseData?.message || 'Transfer initiated successfully'
      );
      await loadDashboard(true);
    } catch (error) {
      const responseMessage =
        error.response?.data?.message ||
        'Failed to initiate manual wallet funding transfer';

      if (nextTransferCode) {
        setFundWalletOtpError(responseMessage);
      } else {
        toast.error(responseMessage);
      }
    } finally {
      if (nextTransferCode) {
        setFundWalletOtpSubmitting(false);
      } else {
        setFundWalletSubmitting(false);
      }
    }
  };

  useEffect(() => {
    const user = getUser();
    if (!socket || !user?.token) {
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
        adminRoomJoined: false,
        state: 'missing-token',
        socketId: '',
        error: 'No authenticated socket connection available',
      }));
      return undefined;
    }

    setSocketStatus((prev) => ({
      ...prev,
      connected: socket.connected,
      adminRoomJoined: false,
      state: socket.connected ? 'connected' : 'connecting',
      socketId: socket.id || '',
      error: '',
    }));

    const handleSocketConnect = () => {
      console.log('[Admin Dashboard] Socket connected:', socket.id);
      setSocketStatus((prev) => ({
        ...prev,
        connected: true,
        adminRoomJoined: false,
        state: 'connected',
        socketId: socket.id || '',
        error: '',
      }));
      socket.emit('join-admin-room', 'admin-dashboard');
    };

    const handleSocketDisconnect = (reason) => {
      console.log('[Admin Dashboard] Socket disconnected:', reason);
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
        adminRoomJoined: false,
        state: 'disconnected',
        socketId: '',
        error: reason || '',
      }));
    };

    const handleSocketConnectError = (connectError) => {
      console.error('[Admin Dashboard] Socket connection error:', connectError);
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
        adminRoomJoined: false,
        state: 'connect-error',
        error: connectError?.message || 'Socket connection error',
      }));
    };

    const handleSocketAuthError = (payload) => {
      console.error('[Admin Dashboard] Socket auth error:', payload);
      setSocketStatus((prev) => ({
        ...prev,
        connected: false,
        adminRoomJoined: false,
        state: 'auth-error',
        error: payload?.message || 'Socket authentication failed',
      }));
      toast.error(payload?.message || 'Socket authentication failed');
    };

    const handleAdminRoomJoined = (payload) => {
      console.log('[Admin Dashboard] Joined admin room:', payload);
      setSocketStatus((prev) => ({
        ...prev,
        connected: true,
        adminRoomJoined: true,
        state: 'admin-room-joined',
        socketId: socket.id || '',
        error: '',
      }));
      toast.success('Admin realtime channel connected');
    };

    const handleAdminRoomJoinError = (payload) => {
      console.error('[Admin Dashboard] Admin room join error:', payload);
      setSocketStatus((prev) => ({
        ...prev,
        adminRoomJoined: false,
        state: 'admin-room-error',
        error: payload?.message || 'Could not join admin room',
      }));
      toast.error(payload?.message || 'Could not join admin room');
    };

    const handleNewTransaction = (tx) => {
      const normalizedTx = normalizeRealtimeTransaction(tx);
      console.log(
        '[Admin Dashboard] New transaction received via socket:',
        normalizedTx
      );
      setSocketStatus((prev) => ({
        ...prev,
        lastEvent: 'new-transaction',
        lastEventAt: new Date().toISOString(),
      }));
      if (normalizedTx.status !== 'success') {
        return;
      }

      const txProfit = toMoneyNumber(normalizedTx.profit, 0);
      const txAmount = toMoneyNumber(normalizedTx.amount, 0);
      const transactionTimestamp = normalizedTx.timestamp || Date.now();
      const isToday = isSameLagosDay(transactionTimestamp);

      setStats((prev) => ({
        ...prev,
        totalProfit: toMoneyNumber((prev.totalProfit || 0) + txProfit, 0),
        todayProfit: isToday
          ? toMoneyNumber((prev.todayProfit || 0) + txProfit, 0)
          : toMoneyNumber(prev.todayProfit || 0, 0),
        totalTransactions: (prev.totalTransactions || 0) + 1,
        totalTransactionsAll: (prev.totalTransactionsAll || 0) + 1,
      }));

      if (isToday) {
        setTodayProfitBreakdown((prev) =>
          incrementTodayProfitBreakdown(prev, {
            gain: normalizedTx.pricing?.gain,
            fee: normalizedTx.pricing?.fee,
            extra: normalizedTx.pricing?.extra,
            commission: normalizedTx.pricing?.commission,
            profit: txProfit,
          })
        );
      }

      scheduleAidapayBalanceRefresh(1000);

      toast.success(
        `New ${
          normalizedTx.type?.toUpperCase() || 'transaction'
        }: ${formatNGN(txAmount)}`
      );
    };

    const handleWalletBalanceUpdate = ({
      amount,
      direction,
      newBalance,
      source,
    } = {}) => {
      setSocketStatus((prev) => ({
        ...prev,
        lastEvent: 'wallet-balance-update',
        lastEventAt: new Date().toISOString(),
      }));

      // Only provider-wallet events should mutate the Aidapay tracker balance.
      // Ignore user wallet-funding and any unrelated balance sources.
      const normalizedSource = String(source || '')
        .toLowerCase()
        .trim();
      const isAidapayWalletEvent =
        normalizedSource === 'aidapay-wallet' ||
        normalizedSource === 'aidapay' ||
        normalizedSource === 'aidapay_wallet' ||
        (!normalizedSource && direction === 'debit');

      if (!isAidapayWalletEvent) {
        return;
      }

      const deltaAmount = toMoneyNumber(amount, 0);
      setAidaPayBalance((prevBalance) => {
        if (Number.isFinite(Number(newBalance))) {
          const resolvedBalance = toMoneyNumber(newBalance, 0);
          setLowBalanceWarning(resolvedBalance < LOW_BALANCE_THRESHOLD);
          setAidaPayBalanceError('');
          return resolvedBalance;
        }

        if (!Number.isFinite(Number(prevBalance))) {
          return prevBalance;
        }
        const normalizedDirection =
          direction === 'credit' || direction === 'debit'
            ? direction
            : source
            ? null
            : 'debit';
        if (!normalizedDirection) {
          return prevBalance;
        }

        const current = toMoneyNumber(prevBalance, 0);
        const nextBalance =
          normalizedDirection === 'credit'
            ? current + deltaAmount
            : current - deltaAmount;
        const normalizedNextBalance = toMoneyNumber(nextBalance, 0);
        const isLow = normalizedNextBalance < LOW_BALANCE_THRESHOLD;
        setLowBalanceWarning(isLow);
        return normalizedNextBalance;
      });

      scheduleAidapayBalanceRefresh(1200);
    };

    const handleWalletFundingEventReceived = (payload) => {
      console.log(
        '[Admin Dashboard] Wallet funding event received via socket:',
        payload
      );
      setSocketStatus((prev) => ({
        ...prev,
        lastEvent: 'wallet-funding-event-received',
        lastEventAt: new Date().toISOString(),
      }));
      const grossAmount = toMoneyNumber(payload.grossAmount, 0);
      const feeAmount = toMoneyNumber(payload.feeAmount, 0);
      const netAmount = toMoneyNumber(payload.netAmount, 0);
      const isTodayFundingEvent = isSameLagosDay(payload.timestamp || Date.now());
      const shouldCountTransaction = Boolean(payload.transactionId);

      setStats((prev) => ({
        ...prev,
        totalTransactions: shouldCountTransaction
          ? Number(prev.totalTransactions || 0) + 1
          : Number(prev.totalTransactions || 0),
        totalTransactionsAll: shouldCountTransaction
          ? Number(prev.totalTransactionsAll || 0) + 1
          : Number(prev.totalTransactionsAll || 0),
      }));

      setWalletFundingEventTotals((prev) => ({
        ...prev,
        totalGross: toMoneyNumber((prev.totalGross || 0) + grossAmount, 0),
        totalFees: toMoneyNumber((prev.totalFees || 0) + feeAmount, 0),
        totalNet: toMoneyNumber((prev.totalNet || 0) + netAmount, 0),
        totalCount: Number(prev.totalCount || 0) + 1,
        todayGross: isTodayFundingEvent
          ? toMoneyNumber((prev.todayGross || 0) + grossAmount, 0)
          : toMoneyNumber(prev.todayGross || 0, 0),
        todayFees: isTodayFundingEvent
          ? toMoneyNumber((prev.todayFees || 0) + feeAmount, 0)
          : toMoneyNumber(prev.todayFees || 0, 0),
        todayNet: isTodayFundingEvent
          ? toMoneyNumber((prev.todayNet || 0) + netAmount, 0)
          : toMoneyNumber(prev.todayNet || 0, 0),
        todayCount: isTodayFundingEvent
          ? Number(prev.todayCount || 0) + 1
          : Number(prev.todayCount || 0),
      }));

      applyRealtimeWalletFundingEventToCharts(
        payload,
        isTodayFundingEvent
      );

      toast.success(
        `Wallet funding event received: ${formatNGN(
          payload.grossAmount
        )} credited for ${payload.customerEmail || 'user'}`
      );
    };

    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('connect_error', handleSocketConnectError);
    socket.on('auth_error', handleSocketAuthError);
    socket.on('room-joined', handleAdminRoomJoined);
    socket.on('room-join-error', handleAdminRoomJoinError);
    socket.on('new-transaction', handleNewTransaction);
    socket.on('wallet-balance-update', handleWalletBalanceUpdate);
    socket.on('wallet-funding-event-received', handleWalletFundingEventReceived);

    if (socket.connected) {
      handleSocketConnect();
    }

    return () => {
      if (balanceRefreshTimeoutRef.current) {
        window.clearTimeout(balanceRefreshTimeoutRef.current);
      }
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleSocketDisconnect);
      socket.off('connect_error', handleSocketConnectError);
      socket.off('auth_error', handleSocketAuthError);
      socket.off('room-joined', handleAdminRoomJoined);
      socket.off('room-join-error', handleAdminRoomJoinError);
      socket.off('new-transaction', handleNewTransaction);
      socket.off('wallet-balance-update', handleWalletBalanceUpdate);
      socket.off('wallet-funding-event-received', handleWalletFundingEventReceived);
    };
  }, [socket]);

  useEffect(() => {
    loadDashboard(false);
    const interval = setInterval(() => loadDashboard(true), 240000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div
        className="d-flex flex-column justify-content-center align-items-center"
        style={{ minHeight: '80vh' }}
      >
        <Spinner color="primary" style={{ width: '4rem', height: '4rem' }} />
        <h4 className="mt-4">Loading Admin Dashboard...</h4>
      </div>
    );
  }

  const estimatedAtlasUsageMb = estimateAtlasUsageMb(stats);
  const atlasFreeTierMb =
    Number(stats.dbStorage?.atlasFreeTierMb) || ATLAS_FREE_TIER_MB;
  const estimatedAtlasUsagePercent = Math.min(
    (estimatedAtlasUsageMb / atlasFreeTierMb) * 100,
    999
  );
  const atlasUsageTone = getAtlasUsageTone(estimatedAtlasUsagePercent);
  const schemaUsageRows = Object.values(stats.dbStorage?.schemaCounts || {}).sort(
    (left, right) => Number(right?.count || 0) - Number(left?.count || 0)
  );

  return (
    <div className="content admin-dashboard-page">
      {error && (
        <Alert color="danger" className="mb-4">
          {error}
          <Button
            color="link"
            className="float-end"
            onClick={() => loadDashboard(false)}
          >
            Retry
          </Button>
        </Alert>
      )}

      {Number.isFinite(Number(aidaPayBalance)) && lowBalanceWarning && (
        <Alert
          color="danger"
          className="mb-4 d-flex justify-content-between align-items-center"
        >
          <div>
            <strong>Urgent warning:</strong> AidaPay wallet balance is low -{' '}
            {formatNGN(aidaPayBalance)}
          </div>
          <Button
            color="secondary"
            size="sm"
            onClick={() => setFundWalletModalOpen(true)}
          >
            Fund Wallet Now
          </Button>
        </Alert>
      )}

      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-copy">
          <div className="admin-dashboard-hero-kicker">Admin command center</div>
          <h1 className="admin-dashboard-hero-title">
            A cleaner cockpit for wallets, transactions, and provider health.
          </h1>
          <p className="admin-dashboard-hero-subtitle">
            Realtime socket activity, funding status, profit trends, and recent
            transactions are grouped into one polished command view.
          </p>

          <div className="admin-dashboard-hero-actions">
            <Button color="primary" onClick={() => setFundWalletModalOpen(true)}>
              Fund Wallet Now
            </Button>
            <Button
              color="secondary"
              outline
              onClick={() => {
                const started = Boolean(getUser()?.token && socket);
                if (started && !socket.connected) socket.connect();
                setSocketStatus((prev) => ({
                  ...prev,
                  state: started ? 'connecting' : 'missing-token',
                  error: started
                    ? ''
                    : 'No auth token available for socket connection',
                }));
              }}
            >
              Reconnect Realtime
            </Button>
            <Button
              color="info"
              outline
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new Event('admin:notification-sound-test')
                  );
                }
                toast.success('Notification sound test triggered');
              }}
            >
              Test Notification Sound
            </Button>
          </div>
        </div>

        <div className="admin-dashboard-hero-panel">
          <div className="admin-dashboard-hero-status">
            <div className="admin-dashboard-hero-status-label">Realtime status</div>
            <Badge
              color={
                socketStatus.adminRoomJoined
                  ? 'success'
                  : socketStatus.connected
                  ? 'warning'
                  : 'secondary'
              }
              pill
              className="px-3 py-2"
            >
              {socketStatus.state}
            </Badge>
            <div className="admin-dashboard-hero-status-copy text-muted small mt-3">
              {socketStatus.socketId ? (
                <div className="text-break">
                  Socket ID: {socketStatus.socketId}
                </div>
              ) : null}
              {socketStatus.lastEvent ? (
                <div className="text-break">
                  Last event: {socketStatus.lastEvent}
                </div>
              ) : null}
              {socketStatus.lastEventAt ? (
                <div>Updated: {formatDateTime(socketStatus.lastEventAt)}</div>
              ) : null}
              {socketStatus.error ? <div>{socketStatus.error}</div> : null}
            </div>
          </div>

          <div className="admin-dashboard-hero-metrics">
            <div className="admin-dashboard-hero-metric">
              <span>Today Profit</span>
              <strong>{formatNGN(stats.todayProfit)}</strong>
            </div>
            <div className="admin-dashboard-hero-metric">
              <span>Total Users</span>
              <strong>{stats.totalUsers.toLocaleString() || '-'}</strong>
            </div>
            <div className="admin-dashboard-hero-metric">
              <span>Aidapay</span>
              <strong>{formatProviderBalance(aidaPayBalance)}</strong>
            </div>
            <div className="admin-dashboard-hero-metric">
              <span>Directortech</span>
              <strong>{formatProviderBalance(directortechBalance)}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="admin-dashboard-sections">
        <Row className="mb-4">
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Provider Wallets</h6>
              <h3 className="fw-bold text-primary">
                {formatProviderBalance(paystackBalance)}
              </h3>
              <small>{paystackBalanceError || 'Paystack balance'}</small>
              <div className="mt-2 text-muted small">
                Aidapay available: {formatProviderBalance(aidaPayBalance)}
              </div>
              {aidaPayBalanceError ? (
                <div className="mt-1 text-warning small">
                  {aidaPayBalanceError}
                </div>
              ) : null}
              <div className="mt-2 text-muted small">
                Directortech available:{' '}
                {formatProviderBalance(directortechBalance)}
              </div>
              {directortechBalanceError ? (
                <div className="mt-1 text-warning small">
                  {directortechBalanceError}
                </div>
              ) : null}
              <div className="mt-3">
                <Button
                  color="secondary"
                  size="sm"
                  onClick={() => setFundWalletModalOpen(true)}
                >
                  Fund Wallet
                </Button>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Total Profit</h6>
              <h3 className="fw-bold text-success">
                {formatNGN(stats.totalProfit)}
              </h3>
              <small>All time</small>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Today's Profit</h6>
              <h3 className="fw-bold text-info">
                {formatNGN(stats.todayProfit)}
              </h3>
              <small>Current day</small>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Total Users</h6>
              <h3 className="fw-bold">
                {stats.totalUsers.toLocaleString() || '-'}
              </h3>
              <small>Registered</small>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col xs="12">
          <Card className="shadow-sm border-0">
            <CardBody>
              <Tabs
                className="kuku-tabs"
                aria-label="Admin dashboard profit periods"
                selectedKey={profitPeriodTab}
                onSelectionChange={(key) =>
                  setProfitPeriodTab(String(key || 'today'))
                }
              >
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
                  <div>
                    <CardTitle tag="h5" className="mb-2">
                      Profit Overview
                    </CardTitle>
                    <div className="text-muted">
                      Switch between today&apos;s numbers and the last 7 days.
                    </div>
                  </div>
                  <TabList className="kuku-tab-list">
                    <Tab className="kuku-tab" id="today">
                      Today&apos;s
                    </Tab>
                    <Tab className="kuku-tab" id="last7">
                      Last 7 Days
                    </Tab>
                  </TabList>
                </div>

                <TabPanel className="kuku-tab-panel" id="today">
                  <div style={{ height: '340px', position: 'relative' }}>
                    <Bar
                      data={todayProfitData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                          x: {
                            grid: { display: false },
                          },
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: (v) =>
                                `NGN ${Number(v).toLocaleString()}`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                  <div
                    className="mt-4 d-flex flex-wrap"
                    style={{ columnGap: '0.75rem', rowGap: '0.75rem' }}
                  >
                    <Badge color="success" pill className="px-3 py-2">
                      Profit: {formatNGN(todayProfitBreakdown.profit)}
                    </Badge>
                    <Badge color="primary" pill className="px-3 py-2">
                      Gain: {formatNGN(todayProfitBreakdown.gain)}
                    </Badge>
                    <Badge color="warning" pill className="px-3 py-2 text-dark">
                      Fee: {formatNGN(todayProfitBreakdown.fee)}
                    </Badge>
                    <Badge color="info" pill className="px-3 py-2">
                      Extra: {formatNGN(todayProfitBreakdown.extra)}
                    </Badge>
                    <Badge color="secondary" pill className="px-3 py-2">
                      Commission: {formatNGN(todayProfitBreakdown.commission)}
                    </Badge>
                  </div>
                </TabPanel>

                <TabPanel className="kuku-tab-panel" id="last7">
                  <div style={{ height: '340px', position: 'relative' }}>
                    <Bar
                      data={weeklyProfitData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: (v) =>
                                `NGN ${Number(v).toLocaleString()}`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                  <div
                    className="mt-4 d-flex flex-wrap"
                    style={{ columnGap: '0.75rem', rowGap: '0.75rem' }}
                  >
                    <Badge color="success" pill className="px-3 py-2">
                      Period Profit: {formatNGN(weeklyProfitSummary.totalInPeriod)}
                    </Badge>
                    <Badge color="primary" pill className="px-3 py-2">
                      Gain: {formatNGN(weeklyProfitSummary.totalGainInPeriod)}
                    </Badge>
                    <Badge color="warning" pill className="px-3 py-2 text-dark">
                      Fee: {formatNGN(weeklyProfitSummary.totalFeeInPeriod)}
                    </Badge>
                    <Badge color="info" pill className="px-3 py-2">
                      Extra: {formatNGN(weeklyProfitSummary.totalExtraInPeriod)}
                    </Badge>
                    <Badge color="secondary" pill className="px-3 py-2">
                      Commission:{' '}
                      {formatNGN(weeklyProfitSummary.totalCommissionInPeriod)}
                    </Badge>
                  </div>
                </TabPanel>
              </Tabs>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col xs="12">
          <Card className="shadow-sm border-0">
            <CardBody>
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
                <div>
                  <CardTitle tag="h5" className="mb-2">
                    Atlas Storage Reference
                  </CardTitle>
                  <div className="text-muted">
                    Rough planning guide based on the current Kuku schema.
                    Transactions and notifications will usually fill storage
                    before users do.
                  </div>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Badge color="secondary" pill className="px-3 py-2">
                    Atlas M0: {atlasFreeTierMb} MB
                  </Badge>
                  <Badge
                    color={atlasUsageTone.color}
                    pill
                    className="px-3 py-2"
                  >
                    {atlasUsageTone.label}:{' '}
                    {estimatedAtlasUsagePercent.toFixed(1)}%
                  </Badge>
                </div>
              </div>

              <Row>
                <Col lg="5" className="mb-4 mb-lg-0">
                  <div className="text-muted small mb-2">
                    Current rough footprint
                  </div>
                  <div className="fw-bold fs-3 mb-2">
                    {formatStorage(estimatedAtlasUsageMb)}
                  </div>
                  <div className="text-muted small mb-3">
                    Based on{' '}
                    {Number(stats.dbStorage?.totalRecords || 0).toLocaleString()}{' '}
                    total records across {schemaUsageRows.length} schemas.
                  </div>
                  <div className="text-muted small">
                    Successful transactions: {stats.totalTransactions.toLocaleString()}
                    {' '}| All transactions: {stats.totalTransactionsAll.toLocaleString()}
                  </div>
                  <div className="text-muted small mt-2">
                    Heuristic estimate using all schema collections.
                  </div>
                  <div
                    className="mt-3 d-flex flex-wrap"
                    style={{ columnGap: '0.5rem', rowGap: '0.5rem' }}
                  >
                    {schemaUsageRows.map((schemaItem) => (
                      <Badge
                        key={schemaItem.label}
                        color="light"
                        className="border text-dark"
                      >
                        {schemaItem.label}: {Number(schemaItem.count || 0).toLocaleString()}
                      </Badge>
                    ))}
                  </div>
                </Col>

                <Col lg="7">
                  <div className="text-muted small mb-2">
                    1,000-user reference
                  </div>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="border rounded p-3 h-100">
                        <div className="text-muted small mb-1">
                          User profiles
                        </div>
                        <div className="fw-bold">5-10 MB</div>
                        <div className="text-muted small">1,000 users only</div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="border rounded p-3 h-100">
                        <div className="text-muted small mb-1">
                          50,000 purchases
                        </div>
                        <div className="fw-bold">160-310 MB</div>
                        <div className="text-muted small">
                          Usually still okay
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="border rounded p-3 h-100">
                        <div className="text-muted small mb-1">
                          100,000 purchases
                        </div>
                        <div className="fw-bold">320-610 MB</div>
                        <div className="text-muted small">
                          Likely near or beyond M0
                        </div>
                      </div>
                    </div>
                  </div>
                </Col>
              </Row>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Wallet Funding Gross</h6>
              <h3 className="fw-bold text-primary">
                {formatNGN(walletFundingEventTotals.totalGross)}
              </h3>
              <small>{walletFundingEventTotals.totalCount || 0} processed</small>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Wallet Funding Fees</h6>
              <h3 className="fw-bold text-warning">
                {formatNGN(walletFundingEventTotals.totalFees)}
              </h3>
              <small>All time deductions</small>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Wallet Funding Net</h6>
              <h3 className="fw-bold text-success">
                {formatNGN(walletFundingEventTotals.totalNet)}
              </h3>
              <small>All time settlements</small>
            </CardBody>
          </Card>
        </Col>
        <Col lg="3" md="6" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody className="text-center">
              <h6 className="text-muted mb-1">Today's Funding Events</h6>
              <h3 className="fw-bold text-dark">
                {walletFundingEventTotals.todayCount || 0}
              </h3>
              <small>{formatNGN(walletFundingEventTotals.todayGross)} gross today</small>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mb-5">
        <Col xs="12" lg="8" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody>
              <Tabs
                className="kuku-tabs"
                aria-label="Wallet funding settlement periods"
                selectedKey={walletFundingPeriodTab}
                onSelectionChange={(key) =>
                  setWalletFundingPeriodTab(String(key || 'today'))
                }
              >
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
                  <div>
                    <CardTitle tag="h5" className="mb-2">
                      Wallet Funding Settlement Trend
                    </CardTitle>
                    <div className="text-muted">
                      Switch between today&apos;s settlements and the last 7 days.
                    </div>
                  </div>
                  <TabList className="kuku-tab-list">
                    <Tab className="kuku-tab" id="today">
                      Today&apos;s
                    </Tab>
                    <Tab className="kuku-tab" id="last7">
                      Last 7 Days
                    </Tab>
                  </TabList>
                </div>

                <TabPanel className="kuku-tab-panel" id="today">
                  <div style={{ height: '360px', position: 'relative' }}>
                    <Line
                      data={walletFundingTodayChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                          mode: 'index',
                          intersect: false,
                        },
                        plugins: { legend: { display: true, position: 'top' } },
                        scales: {
                          x: {
                            grid: { display: false },
                          },
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: (v) =>
                                `NGN ${Number(v).toLocaleString()}`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                  <div
                    className="mt-4 d-flex flex-wrap"
                    style={{ columnGap: '0.75rem', rowGap: '0.75rem' }}
                  >
                    <Badge color="primary" pill className="px-3 py-2">
                      Today Gross: {formatNGN(walletFundingTodaySummary.gross)}
                    </Badge>
                    <Badge color="warning" pill className="px-3 py-2 text-dark">
                      Today Fee: {formatNGN(walletFundingTodaySummary.fees)}
                    </Badge>
                    <Badge color="success" pill className="px-3 py-2">
                      Today Net: {formatNGN(walletFundingTodaySummary.net)}
                    </Badge>
                  </div>
                </TabPanel>

                <TabPanel className="kuku-tab-panel" id="last7">
                  <div style={{ height: '360px', position: 'relative' }}>
                    <Line
                      data={walletFundingEventChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                          mode: 'index',
                          intersect: false,
                        },
                        plugins: { legend: { display: true, position: 'top' } },
                        scales: {
                          x: {
                            grid: { display: false },
                          },
                          y: {
                            beginAtZero: true,
                            ticks: {
                              callback: (v) =>
                                `NGN ${Number(v).toLocaleString()}`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                  <div
                    className="mt-4 d-flex flex-wrap"
                    style={{ columnGap: '0.75rem', rowGap: '0.75rem' }}
                  >
                    <Badge color="primary" pill className="px-3 py-2">
                      7 Day Gross: {formatNGN(walletFundingWeeklySummary.gross)}
                    </Badge>
                    <Badge color="warning" pill className="px-3 py-2 text-dark">
                      7 Day Fee: {formatNGN(walletFundingWeeklySummary.fees)}
                    </Badge>
                    <Badge color="success" pill className="px-3 py-2">
                      7 Day Net: {formatNGN(walletFundingWeeklySummary.net)}
                    </Badge>
                  </div>
                </TabPanel>
              </Tabs>
            </CardBody>
          </Card>
        </Col>
        <Col xs="12" lg="4" className="mb-4">
          <Card className="shadow-sm border-0 h-100">
            <CardBody>
              <CardTitle tag="h5" className="mb-2">
                Wallet Funding Snapshot
              </CardTitle>
              <div className="text-muted small mb-4">
                {walletFundingPeriodTab === 'today'
                  ? "Today's settlement view"
                  : 'Last 7 days settlement view'}
              </div>
              <div className="mb-4">
                <div className="text-muted small">
                  {walletFundingPeriodTab === 'today'
                    ? 'Today Gross'
                    : '7 Day Gross'}
                </div>
                <div className="fw-bold fs-4">
                  {formatNGN(
                    walletFundingPeriodTab === 'today'
                      ? walletFundingTodaySummary.gross
                      : walletFundingWeeklySummary.gross
                  )}
                </div>
              </div>
              <div className="mb-4">
                <div className="text-muted small">
                  {walletFundingPeriodTab === 'today'
                    ? 'Today Fees'
                    : '7 Day Fees'}
                </div>
                <div className="fw-bold fs-4 text-warning">
                  {formatNGN(
                    walletFundingPeriodTab === 'today'
                      ? walletFundingTodaySummary.fees
                      : walletFundingWeeklySummary.fees
                  )}
                </div>
              </div>
              <div className="mb-4">
                <div className="text-muted small">
                  {walletFundingPeriodTab === 'today'
                    ? 'Today Net'
                    : '7 Day Net'}
                </div>
                <div className="fw-bold fs-4 text-success">
                  {formatNGN(
                    walletFundingPeriodTab === 'today'
                      ? walletFundingTodaySummary.net
                      : walletFundingWeeklySummary.net
                  )}
                </div>
              </div>
              <div>
                <div className="text-muted small">
                  {walletFundingPeriodTab === 'today'
                    ? 'Processed Count'
                    : '7 Day Count'}
                </div>
                <div className="fw-bold fs-4">
                  {walletFundingPeriodTab === 'today'
                    ? walletFundingTodaySummary.count || 0
                    : walletFundingWeeklySummary.count || 0}
                </div>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col xs="12">
          <RecentTransactionsSection />
        </Col>
      </Row>
      </div>

      <Modal
        isOpen={fundWalletModalOpen}
        toggle={() => setFundWalletModalOpen(false)}
        centered
      >
        <ModalHeader toggle={() => setFundWalletModalOpen(false)}>
          Fund Wallet Now
        </ModalHeader>
        <ModalBody>
          <Alert color="light">
            Recipient: <strong>aidapaay isah saidu</strong>
            <br />
            Bank: <strong>access bank</strong>
            <br />
            Account Number: <strong>1962721837</strong>
            <div className="mt-3">
              Paystack Balance:{' '}
              <strong>{formatProviderBalance(paystackBalance)}</strong>
            </div>
            {paystackBalanceError ? (
              <div className="mt-2 text-warning small">
                {paystackBalanceError}
              </div>
            ) : null}
            <div className="mt-2">
              Aidapay Balance: <strong>{formatProviderBalance(aidaPayBalance)}</strong>
            </div>
            {aidaPayBalanceError ? (
              <div className="mt-2 text-warning small">
                {aidaPayBalanceError}
              </div>
            ) : null}
            <div className="mt-2">
              Directortech Balance:{' '}
              <strong>{formatProviderBalance(directortechBalance)}</strong>
            </div>
            {directortechBalanceError ? (
              <div className="mt-2 text-warning small">
                {directortechBalanceError}
              </div>
            ) : null}
            <div className="wallet-fee-note mt-3">
              0% fees on manual funding transfers.
            </div>
          </Alert>
          <FormGroup>
            <Label>Amount</Label>
            <Input
              type="text"
              value={formattedFundWalletAmount}
              onChange={(e) => setFundWalletAmount(e.target.value)}
              placeholder="Enter amount"
            />
            <small className="text-muted">
              Any positive amount can be transferred from your Paystack balance.
            </small>
          </FormGroup>
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => setFundWalletModalOpen(false)}
            disabled={fundWalletSubmitting}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            onClick={submitManualFundTransfer}
            disabled={fundWalletSubmitting || normalizedFundWalletAmount < MANUAL_FUND_MINIMUM}
          >
            {fundWalletSubmitting ? <Spinner size="sm" /> : 'Send'}
          </Button>
        </ModalFooter>
      </Modal>

      <TransactionPinPrompt
        isOpen={fundWalletOtpModalOpen}
        onClose={resetFundWalletOtpState}
        onPinChange={(nextOtp) => {
          setFundWalletOtp(nextOtp);
          if (fundWalletOtpError) {
            setFundWalletOtpError('');
          }
        }}
        onConfirm={(enteredOtp) =>
          submitManualFundTransfer({
            otp: enteredOtp,
            transferCode: fundWalletTransferCode,
          })
        }
        loading={fundWalletOtpSubmitting}
        title="Enter Paystack OTP"
        subtitle={`Enter the 6-digit OTP Paystack sent to finalize transfer ${
          fundWalletTransferReference || fundWalletTransferCode || ''
        }.`.trim()}
        errorMessage={fundWalletOtpError}
        confirmLabel="Verify OTP"
        loadingLabel="Verifying..."
        length={6}
      />
    </div>
  );
};

export default AdminDashboard;



