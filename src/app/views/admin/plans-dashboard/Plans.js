import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Col,
  Row as BootstrapRow,
  Spinner,
} from 'components/ui/primitives';
import {
  calculateMargins,
  formatNaira,
  getUser,
  networkTimeout,
  parseDataPlan,
} from '../../../../lib/helper';
import {
  formatSourceLabel,
  getPlanCode,
  getPlanName,
  getPlanSellingPriceClass,
  getSourceBadgeColor,
} from './utils/plans';
import PlanDetailsModal from './components/PlanDetailsModal';

import './plansDashboard.css';

const NETWORK_ORDER = ['mtn', 'glo', 'airtel', '9mobile'];
const NETWORK_LABELS = {
  mtn: 'MTN',
  glo: 'GLO',
  airtel: 'Airtel',
  '9mobile': '9mobile',
};
const PLANS_TABLE_PAGE_SIZE = 10;

const PLAN_TABLE_FEATURES = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

function createEmptyPlanGroups() {
  return {
    mtn: [],
    glo: [],
    airtel: [],
    '9mobile': [],
  };
}

function getPlanStatusRank(plan = {}) {
  const isDatabasePlan = Boolean(plan?.planCode || plan?.packageCode);

  if (!isDatabasePlan) {
    return 0;
  }

  return plan?.exclude ? 2 : 1;
}

function comparePlansByStatus(left, right) {
  const statusDifference = left.statusRank - right.statusRank;
  if (statusDifference !== 0) {
    return statusDifference;
  }

  const codeDifference = String(left.planCode).localeCompare(
    String(right.planCode),
    undefined,
    { numeric: true, sensitivity: 'base' }
  );
  if (codeDifference !== 0) {
    return codeDifference;
  }

  return String(left.rowId).localeCompare(String(right.rowId), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function BasicPlansTable({
  plans = [],
  emptyMessage = 'No plans found.',
  onViewDetails = () => {},
  loading = false,
}) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: PLANS_TABLE_PAGE_SIZE,
  });

  const tableItems = useMemo(() => {
    const rowKeyCounts = new Map();
    const rows = plans.map((plan, index) => {
      const baseCode = getPlanCode(plan) || `plan-${index}`;
      const sourceKey = String(plan?.source || 'provider')
        .trim()
        .toLowerCase();
      const identityKey = `${sourceKey}:${baseCode.toUpperCase()}`;
      const occurrence = rowKeyCounts.get(identityKey) || 0;
      rowKeyCounts.set(identityKey, occurrence + 1);
      const rowId = `${identityKey}:${occurrence}`;
      const statusLabel = plan?.active ? 'Active' : 'New / Inactive';
      const sourceLabel = formatSourceLabel(plan?.sourceLabel || plan?.source);

      return {
        ...plan,
        // Keep UI identity separate from the provider code used by the modal.
        rowId,
        package_api_code:
          plan?.package_api_code ||
          plan?.package_code ||
          plan?.packageCode ||
          plan?.planCode ||
          baseCode,
        planCode: baseCode,
        planName: getPlanName(plan) || baseCode,
        statusLabel,
        statusRank: getPlanStatusRank(plan),
        originalPrice: Number(plan?.package_original_amount),
        sellingPrice: Number(plan?.sellingPrice),
        sourceLabel,
        searchText: [
          getPlanName(plan) || baseCode,
          baseCode,
          statusLabel,
          sourceLabel,
          plan?.durationGroup || plan?.duration_group,
          plan?.category,
        ]
          .filter(Boolean)
          .join(' '),
      };
    });

    return rows.sort(comparePlansByStatus);
  }, [plans]);

  const columns = useMemo(
    () => [
      {
        id: 'rowNumber',
        header: '#',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => row.getDisplayIndex() + 1,
      },
      {
        accessorKey: 'planName',
        header: 'Plan',
        cell: ({ row }) => {
          const plan = row.original;

          return (
            <div className="plans-datatable-plan-cell">
              <div className="plans-table-minimal-title text-truncate">
                {parseDataPlan(plan.planName)}
              </div>
              <div className="plans-table-minimal-meta">
                <span className="text-muted small">{plan.planCode}</span>
                {plan?.isNew ? (
                  <Badge color="primary" pill>
                    New
                  </Badge>
                ) : null}
              </div>
              <div className="text-muted small text-truncate">
                {plan?.durationGroup || plan?.duration_group || 'More'} -{' '}
                {plan?.category || 'Other'}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'statusRank',
        id: 'status',
        header: 'Status',
        enableGlobalFilter: false,
        sortFn: (left, right, columnId) =>
          Number(left.getValue(columnId)) - Number(right.getValue(columnId)),
        cell: ({ row }) => {
          const plan = row.original;

          return (
            <span className="d-inline-flex align-items-center gap-1 flex-wrap">
              <Badge color={plan?.active ? 'success' : 'secondary'} pill>
                {plan.statusLabel}
              </Badge>
              {plan?.exclude ? (
                <Badge color="danger" pill>
                  Excluded
                </Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'originalPrice',
        header: 'Original',
        enableGlobalFilter: false,
        cell: ({ row }) => formatNaira(row.original.originalPrice),
      },
      {
        accessorKey: 'sellingPrice',
        header: 'Selling',
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const plan = row.original;

          return (
            <span
              className={getPlanSellingPriceClass(plan)}
              style={{
                color:
                  plan.sellingPrice <= plan.originalPrice ? 'red' : 'green',
              }}
            >
              {formatNaira(calculateMargins(plan))}
            </span>
          );
        },
      },
      {
        accessorKey: 'sourceLabel',
        header: 'Source',
        cell: ({ row }) => {
          const plan = row.original;

          return (
            <Badge color={getSourceBadgeColor(plan?.source)} pill>
              {plan.sourceLabel}
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: 'Action',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <Button
            color="info"
            size="sm"
            className="mr-2"
            onClick={() => onViewDetails(row.original)}
          >
            Edit
          </Button>
        ),
      },
      {
        accessorKey: 'searchText',
        id: 'searchText',
        enableSorting: false,
        meta: { hidden: true },
      },
    ],
    [onViewDetails]
  );

  const table = useTable({
    data: tableItems,
    columns,
    features: PLAN_TABLE_FEATURES,
    state: { globalFilter, pagination, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getRowId: (plan) => plan.rowId,
    globalFilterFn: 'includesString',
    getColumnCanGlobalFilter: (column) =>
      ['planName', 'sourceLabel', 'statusLabel', 'searchText'].includes(
        column.id
      ),
  });

  const visibleColumnCount = table
    .getAllLeafColumns()
    .filter((column) => !column.columnDef.meta?.hidden).length;
  const pageRows = table.getRowModel().rows;
  const filteredPlanCount = table.getFilteredRowModel().rows.length;
  const currentPage = table.state.pagination.pageIndex + 1;
  const pageCount = Math.max(table.getPageCount(), 1);

  const getRowClassName = (plan) => {
    if (plan?.exclude) {
      return 'plans-tanstack-row plans-datatable-row-excluded';
    }

    return plan?.active
      ? 'plans-tanstack-row plans-datatable-row-active'
      : 'plans-tanstack-row plans-datatable-row-inactive';
  };

  return (
    <div className="plans-datatable plans-tanstack-table">
      <div className="plans-tanstack-toolbar">
        <label className="plans-tanstack-search">
          <span className="visually-hidden">Search plans</span>
          <input
            type="search"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Search plans..."
          />
        </label>
        <span className="text-muted small">
          {filteredPlanCount} {filteredPlanCount === 1 ? 'plan' : 'plans'}
        </span>
      </div>

      <div className="plans-tanstack-table-shell">
        <table className="plans-tanstack-table-element">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers
                  .filter((header) => !header.column.columnDef.meta?.hidden)
                  .map((header) => {
                    const column = header.column;
                    const sortDirection = column.getIsSorted();

                    return (
                      <th key={header.id} scope="col">
                        {header.isPlaceholder ? null : column.getCanSort() ? (
                          <button
                            type="button"
                            className="plans-tanstack-sort-button"
                            onClick={column.getToggleSortingHandler()}
                            aria-label={`Sort by ${String(
                              column.columnDef.header
                            )}`}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden="true">
                              {sortDirection === 'asc'
                                ? ' ^'
                                : sortDirection === 'desc'
                                ? ' v'
                                : ''}
                            </span>
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <div className="plans-tanstack-loading">
                    <Spinner size="sm" /> Loading plans...
                  </div>
                </td>
              </tr>
            ) : pageRows.length ? (
              pageRows.map((row) => (
                <tr key={row.id} className={getRowClassName(row.original)}>
                  {row
                    .getAllCells()
                    .filter((cell) => !cell.column.columnDef.meta?.hidden)
                    .map((cell) => (
                      <td key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={visibleColumnCount}
                  className="plans-tanstack-empty"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="plans-tanstack-pagination">
        <span className="text-muted small">
          Page {currentPage} of {pageCount}
        </span>
        <div className="plans-tanstack-pagination-actions">
          <Button
            color="secondary"
            size="sm"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
          >
            First
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
          >
            Last
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminPlansDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [plansByNetwork, setPlansByNetwork] = useState(createEmptyPlanGroups);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [activeNetworkTab, setActiveNetworkTab] = useState(NETWORK_ORDER[0]);
  const hasUserChosenTabRef = useRef(false);

  const loadPlans = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');

    try {
      const session = getUser();
      const token = session?.token;

      if (!token) {
        throw new Error('Admin session expired. Please sign in again.');
      }

      const response = await axios.get('/api/admin/plans/get-plans', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: networkTimeout,
      });

      const payload = response?.data || {};
      const rawPlans = payload.plans;
      const nextPlansByNetwork = Array.isArray(rawPlans)
        ? { all: rawPlans }
        : rawPlans && typeof rawPlans === 'object'
        ? rawPlans
        : createEmptyPlanGroups();

      setPlansByNetwork(nextPlansByNetwork);
      setLastUpdatedAt(
        payload.generatedAt ||
          response?.data?.generatedAt ||
          new Date().toISOString()
      );
    } catch (fetchError) {
      const message =
        fetchError?.response?.data?.message ||
        fetchError?.message ||
        'Failed to load plans dashboard';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const networkSummary = useMemo(() => {
    const additionalNetworkKeys = Object.keys(plansByNetwork).filter(
      (networkKey) =>
        !NETWORK_ORDER.includes(networkKey) &&
        Array.isArray(plansByNetwork[networkKey])
    );

    return [...NETWORK_ORDER, ...additionalNetworkKeys].map((networkKey) => ({
      key: networkKey,
      label:
        NETWORK_LABELS[networkKey] ||
        String(networkKey)
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      count: (plansByNetwork[networkKey] || []).length,
    }));
  }, [plansByNetwork]);

  const totalPlans = useMemo(
    () => networkSummary.reduce((sum, item) => sum + item.count, 0),
    [networkSummary]
  );

  useEffect(() => {
    if (hasUserChosenTabRef.current || !networkSummary.length) {
      return;
    }

    const activeSummary = networkSummary.find(
      (summary) => summary.key === activeNetworkTab
    );
    if (activeSummary?.count > 0) {
      return;
    }

    const nextActiveTab =
      networkSummary.find((summary) => summary.count > 0)?.key ||
      networkSummary[0]?.key ||
      NETWORK_ORDER[0];

    if (nextActiveTab && nextActiveTab !== activeNetworkTab) {
      setActiveNetworkTab(nextActiveTab);
    }
  }, [activeNetworkTab, networkSummary]);

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString('en-NG')
    : 'N/A';

  const handleViewDetails = useCallback((plan) => {
    setSelectedPlan(plan || null);
  }, []);

  const handleClosePlanDetails = useCallback(() => {
    setSelectedPlan(null);
  }, []);

  const handlePlanSaved = useCallback(() => {
    handleClosePlanDetails();
    loadPlans({ silent: true });
  }, [handleClosePlanDetails, loadPlans]);

  const handlePlanDeleted = useCallback(() => {
    handleClosePlanDetails();
    loadPlans({ silent: true });
  }, [handleClosePlanDetails, loadPlans]);

  return (
    <div className="content plans-dashboard-shell admin-plans-page">
      {error ? (
        <BootstrapRow className="mb-3">
          <Col xs="12">
            <Alert color="danger" className="mb-0">
              {error}
            </Alert>
          </Col>
        </BootstrapRow>
      ) : null}

      {loading ? (
        <BootstrapRow>
          <Col xs="12">
            <Card className="plans-dashboard-card">
              <CardBody className="text-center py-5">
                <Spinner />
                <div className="mt-2 text-muted">Loading plans...</div>
              </CardBody>
            </Card>
          </Col>
        </BootstrapRow>
      ) : (
        <BootstrapRow>
          <Col xs="12">
            <Card className="plans-dashboard-card">
              <CardHeader className="plans-dashboard-card-header d-flex flex-wrap justify-content-between align-items-center gap-3">
                <div>
                  <CardTitle tag="h3" className="mb-1">
                    Plans
                  </CardTitle>
                  <div className="text-muted small">
                    {totalPlans} total plans loaded. Last updated:{' '}
                    {lastUpdatedLabel}
                  </div>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Badge color="secondary" pill>
                    {totalPlans}
                  </Badge>
                  <Button
                    color="info"
                    size="sm"
                    onClick={() => loadPlans({ silent: true })}
                    disabled={refreshing}
                  >
                    {refreshing ? (
                      <>
                        <Spinner size="sm" /> Refreshing...
                      </>
                    ) : (
                      'Refresh Data'
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardBody className="plans-page-header-body">
                <Tabs
                  className="kuku-tabs"
                  aria-label="Admin plans by network"
                  selectedKey={activeNetworkTab}
                  onSelectionChange={(key) => {
                    hasUserChosenTabRef.current = true;
                    setActiveNetworkTab(String(key || NETWORK_ORDER[0]));
                  }}
                >
                  <TabList className="kuku-tab-list plans-page-tab-list">
                    {networkSummary.map((summary) => (
                      <Tab
                        className="kuku-tab"
                        id={summary.key}
                        key={summary.key}
                      >
                        <span className="d-flex align-items-center gap-2">
                          <span>{summary.label}</span>
                          <Badge color="secondary" pill>
                            {summary.count}
                          </Badge>
                        </span>
                      </Tab>
                    ))}
                  </TabList>

                  {networkSummary.map((summary) => (
                    <TabPanel id={summary.key} key={summary.key}>
                      {summary.key === activeNetworkTab ? (
                        <BasicPlansTable
                          plans={plansByNetwork[summary.key] || []}
                          emptyMessage={`No ${summary.label} plans were returned.`}
                          onViewDetails={handleViewDetails}
                          loading={refreshing}
                        />
                      ) : null}
                    </TabPanel>
                  ))}
                </Tabs>
                <PlanDetailsModal
                  plan={selectedPlan}
                  onClose={handleClosePlanDetails}
                  onPlanSaved={handlePlanSaved}
                  onPlanDeleted={handlePlanDeleted}
                />
              </CardBody>
            </Card>
          </Col>
        </BootstrapRow>
      )}
    </div>
  );
}

export default AdminPlansDashboard;
