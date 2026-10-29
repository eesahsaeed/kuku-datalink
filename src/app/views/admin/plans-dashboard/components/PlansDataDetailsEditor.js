import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Tab, TabList, Tabs } from 'react-aria-components';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Table,
} from 'components/ui/primitives';
import { getUser, networkTimeout } from '../../../../../lib/helper';
import { getEditableSellingPriceClass } from '../utils/plans';

const PLAN_DETAILS_UPDATE_EVENT = 'kuku-plan-details-updated';
const PLAN_DETAILS_UPDATE_STORAGE_KEY = 'kuku-plan-details-updated';

const toKey = (value = '') => String(value || '').trim().toLowerCase();
const toLabel = (value = '') => String(value || '').trim();

const inferSourceLabel = (value = '') => {
  const normalized = toKey(value);

  if (normalized === 'aidapay') {
    return 'Aidapay';
  }

  if (normalized === 'directortech') {
    return 'Directortech';
  }

  if (!normalized || normalized === 'configured') {
    return 'Configured';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const inferDurationLabel = (value = '') => {
  const normalized = toLabel(value).replace(/\s+/g, ' ').trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  if (normalized.includes('daily') || /\b1\s*day\b/.test(normalized)) {
    return 'Daily';
  }

  if (normalized.includes('weekly') || /\b7\s*days?\b/.test(normalized)) {
    return 'Weekly';
  }

  const durationMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years)\b/
  );

  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = String(durationMatch[2] || '').toLowerCase();
    const amountLabel = Number.isInteger(amount)
      ? String(amount)
      : String(Number(amount.toFixed(1)));

    if (unit.startsWith('day')) {
      return amount === 1 ? 'Daily' : `${amountLabel} Days`;
    }

    if (unit.startsWith('week')) {
      return amount === 1 ? 'Weekly' : `${amountLabel} Weeks`;
    }

    if (unit.startsWith('month')) {
      return amount === 1 ? 'Monthly' : `${amountLabel} Months`;
    }

    if (unit.startsWith('year')) {
      return amount === 1 ? 'Yearly' : `${amountLabel} Years`;
    }
  }

  return toLabel(value);
};

const normalizeDurationLabel = (value = '', fallback = '') => {
  const normalizedValue = toLabel(value);

  if (!normalizedValue) {
    return inferDurationLabel(fallback);
  }

  if (normalizedValue.toLowerCase() === 'more') {
    return inferDurationLabel(fallback) || 'More';
  }

  return normalizedValue;
};

const inferNetworkLabel = (row = {}) => {
  const fingerprint = `${row.network || ''} ${row.package_name || ''} ${row.packageCode || ''} ${
    row.provider_code || ''
  }`.toLowerCase();

  if (
    fingerprint.includes('9mobile') ||
    fingerprint.includes('t2mobile') ||
    fingerprint.includes('etisalat')
  ) {
    return '9MOBILE';
  }

  if (fingerprint.includes('mtn')) {
    return 'MTN';
  }

  if (fingerprint.includes('airtel')) {
    return 'AIRTEL';
  }

  if (fingerprint.includes('glo') || fingerprint.includes('globacom')) {
    return 'GLO';
  }

  return toLabel(row.network || row.networkLabel || '').toUpperCase() || 'OTHER';
};

const buildTabOptions = (values = [], { includeAll = true, allLabel = 'All' } = {}) => {
  const seen = new Set();
  const options = [];

  if (includeAll) {
    options.push({ key: 'all', label: allLabel });
  }

  (Array.isArray(values) ? values : []).forEach((value) => {
    const label = toLabel(value);
    const key = toKey(label);

    if (!key || key === 'all' || seen.has(key)) {
      return;
    }

    seen.add(key);
    options.push({ key, label });
  });

  return options;
};

const findTabLabel = (options = [], key = 'all') => {
  const normalizedKey = toKey(key);

  if (!normalizedKey || normalizedKey === 'all') {
    return '';
  }

  return options.find((option) => option.key === normalizedKey)?.label || '';
};

const collectUniqueLabels = (records = [], selector = (_record) => '') => [
  ...new Set(
    (Array.isArray(records) ? records : [])
      .map(selector)
      .map(toLabel)
      .filter(Boolean)
  ),
];

const createBlankRecord = () => ({
  packageCode: '',
  source: 'aidapay',
  sourceLabel: 'Aidapay',
  network: '',
  networkLabel: '',
  provider_code: '',
  durationGroup: '',
  durationLabel: '',
  package_name: '',
  isNew: false,
  commission: 0,
  fee: 0,
  gain: 0,
  extra: 0,
  markup: 0,
  exclude: false,
  sellingPrice: 0,
  package_original_amount: 0,
  replacement_package_api_codes: [],
});

const broadcastPlanDetailsUpdated = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      PLAN_DETAILS_UPDATE_STORAGE_KEY,
      String(Date.now())
    );
  } catch (_error) {
    // Ignore storage write failures and still notify the current tab.
  }

  window.dispatchEvent(new Event(PLAN_DETAILS_UPDATE_EVENT));
};

const mapRecordsToRows = (records = []) =>
  (Array.isArray(records) ? records : []).map((record) => ({
    ...createBlankRecord(),
    ...record,
    rowId: `${toKey(record?.source || 'aidapay')}:${toKey(inferNetworkLabel(record))}:${String(
      record?.packageCode || record?.package_code || record?.package_api_code || ''
    ).trim()}`,
    originalPackageCode: String(
      record?.packageCode || record?.package_code || record?.package_api_code || ''
    ).trim(),
    originalSource: toKey(record?.source || 'aidapay'),
    source: toKey(record?.source || 'aidapay'),
    sourceLabel: inferSourceLabel(record?.source || 'aidapay'),
    provider_code: String(record?.provider_code || '').trim().toLowerCase(),
    network: inferNetworkLabel(record),
    networkLabel: inferNetworkLabel(record),
    durationGroup: normalizeDurationLabel(
      record?.durationGroup || record?.duration_group || record?.durationLabel,
      record?.package_name || record?.packageCode || ''
    ),
    durationLabel: normalizeDurationLabel(
      record?.durationGroup || record?.duration_group || record?.durationLabel,
      record?.package_name || record?.packageCode || ''
    ),
    isNew: Boolean(record?.isNew),
    replacementCodesText: Array.isArray(record?.replacement_package_api_codes)
      ? record.replacement_package_api_codes.join(', ')
      : '',
    isDraftNew: false,
  }));

const buildPayloadFromRow = (row = {}) => ({
  packageCode: String(row.packageCode || '').trim(),
  source: String(row.source || 'aidapay').trim().toLowerCase(),
  originalPackageCode: String(row.originalPackageCode || '').trim(),
  originalSource: String(
    row.originalSource || row.source || 'aidapay'
  ).trim().toLowerCase(),
  provider_code: String(row.provider_code || '').trim().toLowerCase(),
  network: String(row.network || row.networkLabel || '').trim(),
  durationGroup: String(row.durationGroup || row.durationLabel || '').trim(),
  duration_group: String(row.durationGroup || row.durationLabel || '').trim(),
  package_name: String(row.package_name || '').trim(),
  commission: Number(row.commission || 0),
  fee: Number(row.fee || 0),
  gain: Number(row.gain || 0),
  extra: Number(row.extra || 0),
  markup: Number(row.markup || 0),
  exclude: Boolean(row.exclude),
  isNew: Boolean(row.isNew),
  sellingPrice: Number(row.sellingPrice || 0),
  package_original_amount: Number(row.package_original_amount || 0),
  replacement_package_api_codes: String(row.replacementCodesText || '')
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean),
});

const normalizeDurationTab = (value = '') => {
  const normalizedValue = toKey(value);
  return normalizedValue || 'all';
};

const getRowDurationGroup = (row = {}) =>
  normalizeDurationLabel(
    row?.durationLabel || row?.durationGroup || row?.duration_group,
    row?.package_name || row?.packageCode || ''
  );

const formatMoney = (value = 0) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '\u20A60.00';
  }

  return `\u20A6${numericValue.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

function PlansDataDetailsEditor({ onDataChanged }) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceTab, setSourceTab] = useState('all');
  const [networkTab, setNetworkTab] = useState('all');
  const [durationTab, setDurationTab] = useState('all');
  const [availableSources, setAvailableSources] = useState([]);
  const [availableNetworks, setAvailableNetworks] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [savingRowIds, setSavingRowIds] = useState({});
  const [deletingRowIds, setDeletingRowIds] = useState({});
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordDraft, setRecordDraft] = useState(null);

  const sourceSelectOptions = useMemo(
    () => buildTabOptions(availableSources, { includeAll: false }),
    [availableSources]
  );

  const networkSelectOptions = useMemo(
    () => buildTabOptions(availableNetworks, { includeAll: false }),
    [availableNetworks]
  );

  useEffect(() => {
    if (!sourceSelectOptions.some((tab) => tab.key === sourceTab)) {
      setSourceTab('all');
    }
  }, [sourceSelectOptions, sourceTab]);

  useEffect(() => {
    if (!networkSelectOptions.some((tab) => tab.key === networkTab)) {
      setNetworkTab('all');
    }
  }, [networkSelectOptions, networkTab]);

  const getScopedRows = useCallback(
    (omitDimension = '') => {
      const normalizedSearch = String(search || '').trim().toLowerCase();
      const normalizedDurationTab = normalizeDurationTab(durationTab);

      return records.filter((record) => {
        if (
          omitDimension !== 'source' &&
          sourceTab !== 'all' &&
          toKey(record.source || record.sourceLabel || '') !== sourceTab
        ) {
          return false;
        }

        if (
          omitDimension !== 'network' &&
          networkTab !== 'all' &&
          toKey(
            record.network || record.networkLabel || inferNetworkLabel(record)
          ) !== networkTab
        ) {
          return false;
        }

        if (
          omitDimension !== 'duration' &&
          normalizedDurationTab !== 'all' &&
          toKey(getRowDurationGroup(record)) !== normalizedDurationTab
        ) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        return [
          record.packageCode,
          record.package_name,
          record.replacementCodesText,
          record.sourceLabel || record.source,
          record.networkLabel || record.network,
          getRowDurationGroup(record),
          record.provider_code,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      });
    },
    [durationTab, networkTab, records, search, sourceTab]
  );

  const sourceTabs = useMemo(
    () =>
      buildTabOptions(
        collectUniqueLabels(
          getScopedRows('source'),
          (record) => inferSourceLabel(record.source || record.sourceLabel || 'aidapay')
        ),
        { includeAll: true }
      ),
    [getScopedRows]
  );

  const networkTabs = useMemo(
    () =>
      buildTabOptions(
        collectUniqueLabels(getScopedRows('network'), (record) =>
          inferNetworkLabel(record)
        ),
        { includeAll: true }
      ),
    [getScopedRows]
  );

  const durationTabs = useMemo(
    () =>
      buildTabOptions(
        collectUniqueLabels(getScopedRows('duration'), (record) =>
          getRowDurationGroup(record)
        ),
        { includeAll: true }
      ),
    [getScopedRows]
  );

  useEffect(() => {
    if (!durationTabs.some((tab) => tab.key === durationTab)) {
      setDurationTab('all');
    }
  }, [durationTab, durationTabs]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const session = getUser();
      const token = session?.token;

      if (!token) {
        throw new Error('Admin session expired. Please sign in again.');
      }

      const response = await axios.get('/api/admin/plans/data-details', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: networkTimeout,
      });

      const payload = response?.data?.data || {};
      const fetchedRecords = Array.isArray(payload.records) ? payload.records : [];
      const mappedRecords = mapRecordsToRows(fetchedRecords);

      setReadOnly(Boolean(payload?.readOnly));
      setRecords(mappedRecords);
      setAvailableSources(
        collectUniqueLabels(
          Array.isArray(payload.availableSources) && payload.availableSources.length
            ? payload.availableSources
            : mappedRecords.map((record) => record.sourceLabel || record.source || ''),
          (value) => inferSourceLabel(value)
        )
      );
      setAvailableNetworks(
        collectUniqueLabels(
          Array.isArray(payload.availableNetworks) && payload.availableNetworks.length
            ? payload.availableNetworks
            : mappedRecords.map((record) => inferNetworkLabel(record)),
          (value) => String(value || '').trim().toUpperCase() || 'OTHER'
        )
      );
    } catch (loadError) {
      const message =
        loadError?.response?.data?.message ||
        loadError?.message ||
        'Failed to load data details editor';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const openRecordEditor = (row = createBlankRecord()) => {
    const normalizedDuration = normalizeDurationLabel(
      row.durationLabel || row.durationGroup || row.duration_group,
      row.package_name || row.packageCode || ''
    );
    const normalizedNetwork = toLabel(row.network || row.networkLabel || inferNetworkLabel(row))
      .trim()
      .toUpperCase();
    const normalizedSource = toKey(row.source || 'aidapay');
    const normalizedProviderCode = String(row.provider_code || '').trim().toLowerCase();
    const normalizedRow = {
      ...createBlankRecord(),
      ...row,
      rowId: row.rowId || `new-${Date.now()}`,
      source: normalizedSource,
      sourceLabel: inferSourceLabel(normalizedSource),
      originalPackageCode: String(row.originalPackageCode || row.packageCode || '').trim(),
      originalSource: String(row.originalSource || row.source || 'aidapay')
        .trim()
        .toLowerCase(),
      network: normalizedNetwork,
      networkLabel: normalizedNetwork,
      provider_code:
        normalizedProviderCode ||
        (normalizedNetwork && normalizedNetwork !== 'OTHER' ? toKey(normalizedNetwork) : ''),
      durationGroup: normalizedDuration,
      durationLabel: normalizedDuration,
      replacementCodesText: Array.isArray(row.replacement_package_api_codes)
        ? row.replacement_package_api_codes.join(', ')
        : String(row.replacementCodesText || ''),
      isDraftNew: Boolean(row.isDraftNew),
    };

    setSelectedRecord(normalizedRow);
    setRecordDraft(normalizedRow);
  };

  const closeRecordEditor = (force = false) => {
    if (!force && Object.keys(savingRowIds).length > 0) {
      return;
    }

    setSelectedRecord(null);
    setRecordDraft(null);
  };

  const visibleRows = useMemo(() => {
    const normalizedSearch = String(search || '').trim().toLowerCase();

    const matchesSourceTab = (record = {}) => {
      if (sourceTab === 'all') {
        return true;
      }

      return toKey(record.source || record.sourceLabel || '') === sourceTab;
    };

    const matchesNetworkTab = (record = {}) => {
      if (networkTab === 'all') {
        return true;
      }

      return (
        toKey(record.network || record.networkLabel || inferNetworkLabel(record)) ===
        networkTab
      );
    };

    const matchesDurationTab = (row = {}) => {
      const normalizedDurationGroup = normalizeDurationTab(durationTab);
      if (normalizedDurationGroup === 'all') {
        return true;
      }

      return toKey(getRowDurationGroup(row)) === normalizedDurationGroup;
    };

    const scopedRows = records.filter(
      (record) =>
        matchesSourceTab(record) && matchesNetworkTab(record) && matchesDurationTab(record)
    );

    if (!normalizedSearch) {
      return scopedRows;
    }

    return scopedRows.filter((record) =>
      [
        record.packageCode,
        record.package_name,
        record.replacementCodesText,
        record.sourceLabel || record.source,
        record.networkLabel || record.network,
        getRowDurationGroup(record),
        record.provider_code,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [durationTab, networkTab, records, search, sourceTab]);

  const updateRow = (rowId, field, value) => {
    setRecords((previousRecords) =>
      previousRecords.map((record) => {
        if (record.rowId !== rowId) {
          return record;
        }

        const nextRecord = {
          ...record,
          [field]: value,
        };

        if (field === 'source') {
          nextRecord.source = toKey(value);
          nextRecord.sourceLabel = inferSourceLabel(value);
        }

        if (field === 'network') {
          nextRecord.network = toLabel(value).trim().toUpperCase();
          nextRecord.networkLabel = nextRecord.network;
          nextRecord.provider_code = toKey(value);
        }

        if (field === 'durationGroup' || field === 'durationLabel' || field === 'package_name') {
          const nextDuration = normalizeDurationLabel(
            field === 'package_name'
              ? record.durationGroup || record.durationLabel
              : value,
            field === 'package_name' ? value : record.package_name || record.packageCode || ''
          );

          nextRecord.durationGroup = nextDuration;
          nextRecord.durationLabel = nextDuration;
        }

        return nextRecord;
      })
    );

    setSelectedRecord((previousRecord) =>
      previousRecord?.rowId === rowId
        ? {
            ...previousRecord,
            [field]: value,
            ...(field === 'source'
              ? {
                  source: toKey(value),
                  sourceLabel: inferSourceLabel(value),
                }
              : {}),
            ...(field === 'network'
              ? {
                  network: toLabel(value).trim().toUpperCase(),
                  networkLabel: toLabel(value).trim().toUpperCase(),
                  provider_code: toKey(value),
                }
              : {}),
            ...(field === 'durationGroup' ||
            field === 'durationLabel' ||
            field === 'package_name'
              ? (() => {
                  const nextDuration = normalizeDurationLabel(
                    field === 'package_name'
                      ? previousRecord.durationGroup || previousRecord.durationLabel
                      : value,
                    field === 'package_name'
                      ? value
                      : previousRecord.package_name || previousRecord.packageCode || ''
                  );

                  return {
                    durationGroup: nextDuration,
                    durationLabel: nextDuration,
                  };
                })()
              : {}),
          }
        : previousRecord
    );

    setRecordDraft((previousDraft) =>
      previousDraft?.rowId === rowId
        ? {
            ...previousDraft,
            [field]: value,
            ...(field === 'source'
              ? {
                  source: toKey(value),
                  sourceLabel: inferSourceLabel(value),
                }
              : {}),
            ...(field === 'network'
              ? {
                  network: toLabel(value).trim().toUpperCase(),
                  networkLabel: toLabel(value).trim().toUpperCase(),
                  provider_code: toKey(value),
                }
              : {}),
            ...(field === 'durationGroup' ||
            field === 'durationLabel' ||
            field === 'package_name'
              ? (() => {
                  const nextDuration = normalizeDurationLabel(
                    field === 'package_name'
                      ? previousDraft.durationGroup || previousDraft.durationLabel
                      : value,
                    field === 'package_name'
                      ? value
                      : previousDraft.package_name || previousDraft.packageCode || ''
                  );

                  return {
                    durationGroup: nextDuration,
                    durationLabel: nextDuration,
                  };
                })()
              : {}),
          }
        : previousDraft
    );
  };

  const addDraftRow = () => {
    const rowId = `new-${Date.now()}`;
    const nextSource = sourceTab === 'all' ? 'configured' : sourceTab;
    const nextNetwork = networkTab === 'all' ? '' : findTabLabel(networkTabs, networkTab);
    const nextDuration = durationTab === 'all' ? '' : findTabLabel(durationTabs, durationTab);
    const draftRow = {
      ...createBlankRecord(),
      source: nextSource,
      sourceLabel: inferSourceLabel(nextSource),
      network: nextNetwork ? String(nextNetwork).trim().toUpperCase() : '',
      networkLabel: nextNetwork ? String(nextNetwork).trim().toUpperCase() : '',
      provider_code: nextNetwork ? toKey(nextNetwork) : '',
      durationGroup: nextDuration,
      durationLabel: nextDuration,
      rowId,
      originalPackageCode: '',
      originalSource: nextSource,
      replacementCodesText: '',
      isDraftNew: true,
    };

    setRecords((previousRecords) => [draftRow, ...previousRecords]);
    openRecordEditor(draftRow);
  };

  const refreshDashboardData = () => {
    if (typeof onDataChanged === 'function') {
      window.setTimeout(() => {
        onDataChanged();
      }, 450);
    }
  };

  const handleSaveRow = async (row) => {
    const targetRow = row || recordDraft || selectedRecord;
    if (!targetRow) {
      return;
    }

    const session = getUser();
    const token = session?.token;

    if (!token) {
      toast.error('Admin session expired. Please sign in again.');
      return;
    }

    setSavingRowIds((previous) => ({
      ...previous,
      [targetRow.rowId]: true,
    }));

    try {
      const payload = buildPayloadFromRow(targetRow);
      const response = targetRow.isDraftNew
        ? await axios.post('/api/admin/plans/data-details', payload, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: networkTimeout,
          })
        : await axios.put(
            `/api/admin/plans/data-details/${encodeURIComponent(
              targetRow.originalPackageCode || targetRow.packageCode
            )}`,
            payload,
            {
              headers: { Authorization: `Bearer ${token}` },
              timeout: networkTimeout,
            }
          );

      const nextRecords = response?.data?.data?.records || [];
      setRecords(mapRecordsToRows(nextRecords));
      toast.success(response?.data?.message || 'Plan saved successfully');
      await loadRecords();
      broadcastPlanDetailsUpdated();
      refreshDashboardData();
      closeRecordEditor(true);
    } catch (saveError) {
      toast.error(
        saveError?.response?.data?.message ||
          saveError?.message ||
          'Failed to save plan'
      );
    } finally {
      setSavingRowIds((previous) => {
        const nextState = { ...previous };
        delete nextState[targetRow.rowId];
        return nextState;
      });
    }
  };

  const handleDeleteRow = async (row) => {
    if (row.isDraftNew) {
      setRecords((previousRecords) =>
        previousRecords.filter((record) => record.rowId !== row.rowId)
      );
      if (selectedRecord?.rowId === row.rowId) {
        closeRecordEditor(true);
      }
      return;
    }

    const session = getUser();
    const token = session?.token;

    if (!token) {
      toast.error('Admin session expired. Please sign in again.');
      return;
    }

    const shouldDelete = window.confirm(
      `Delete plan ${row.packageCode}? This removes the saved override for this source.`
    );

    if (!shouldDelete) {
      return;
    }

    setDeletingRowIds((previous) => ({
      ...previous,
      [row.rowId]: true,
    }));

    try {
      const response = await axios.delete(
        `/api/admin/plans/data-details/${encodeURIComponent(
          row.originalPackageCode || row.packageCode
        )}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            source: row.source,
          },
          timeout: networkTimeout,
        }
      );

      const nextRecords = response?.data?.data?.records || [];
      setRecords(mapRecordsToRows(nextRecords));
      toast.success(response?.data?.message || 'Plan deleted successfully');
      await loadRecords();
      broadcastPlanDetailsUpdated();
      refreshDashboardData();
      if (selectedRecord?.rowId === row.rowId) {
        closeRecordEditor(true);
      }
    } catch (deleteError) {
      toast.error(
        deleteError?.response?.data?.message ||
          deleteError?.message ||
          'Failed to delete plan'
      );
    } finally {
      setDeletingRowIds((previous) => {
        const nextState = { ...previous };
        delete nextState[row.rowId];
        return nextState;
      });
    }
  };

  return (
    <Card className="plans-dashboard-card mt-4">
      <CardHeader className="plans-dashboard-card-header plans-editor-header">
        <div>
          <CardTitle tag="h3" className="mb-1">
            Data Details Editor
          </CardTitle>
          <div className="text-muted small">
            {readOnly
              ? 'Live provider data supplies these plan details. Saved overrides remain read-only here.'
              : 'Edit Aidapay and Directortech plan overrides here. Use the source, network, and duration tabs to keep them separate.'}
          </div>
        </div>
        <div className="plans-editor-toolbar">
          <Input
            type="text"
            className="plans-editor-search"
            value={search}
            placeholder="Search package code, name, source, network, or duration"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button color="secondary" outline size="sm" onClick={loadRecords}>
            Refresh Table
          </Button>
          {!readOnly ? (
            <Button color="info" size="sm" onClick={addDraftRow}>
              Add New Plan
            </Button>
          ) : null}
        </div>
        <Tabs
          className="kuku-tabs plans-editor-source-tabs"
          aria-label="Plan sources"
          selectedKey={
            sourceTabs.some((tab) => tab.key === sourceTab) ? sourceTab : 'all'
          }
          onSelectionChange={(key) => setSourceTab(toKey(key || 'all') || 'all')}
        >
          <TabList className="kuku-tab-list plans-editor-source-tab-list">
            {sourceTabs.map((tab) => (
              <Tab className="kuku-tab" id={tab.key} key={tab.key}>
                {tab.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>

        <Tabs
          className="kuku-tabs plans-editor-network-tabs"
          aria-label="Plan networks"
          selectedKey={
            networkTabs.some((tab) => tab.key === networkTab)
              ? networkTab
              : 'all'
          }
          onSelectionChange={(key) => setNetworkTab(toKey(key || 'all') || 'all')}
        >
          <TabList className="kuku-tab-list plans-editor-network-tab-list">
            {networkTabs.map((tab) => (
              <Tab className="kuku-tab" id={tab.key} key={tab.key}>
                {tab.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>

        <Tabs
          className="kuku-tabs plans-editor-duration-tabs"
          aria-label="Plan durations"
          selectedKey={
            durationTabs.some((tab) => tab.key === durationTab)
              ? durationTab
              : 'all'
          }
          onSelectionChange={(key) => setDurationTab(normalizeDurationTab(key))}
        >
          <TabList className="kuku-tab-list plans-editor-duration-tab-list">
            {durationTabs.map((tab) => (
              <Tab className="kuku-tab" id={tab.key} key={tab.key}>
                {tab.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </CardHeader>
      <CardBody className="p-0">
        {error ? (
          <div className="p-3">
            <Alert color="danger" className="mb-0">
              {error}
            </Alert>
          </div>
        ) : null}

        {loading ? (
          <div className="text-center py-5">
            <Spinner />
            <div className="mt-2 text-muted">Loading editable data details...</div>
          </div>
        ) : (
          <>
            <div className="plans-editor-table-wrapper">
              <Table
                responsive
                hover
                className="mb-0 plans-editor-table plans-table-minimal"
              >
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Network</th>
                    <th>Source</th>
                    <th>Duration</th>
                    <th>Selling Price</th>
                    <th>Provider Price</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td className="text-center text-muted py-4" colSpan={7}>
                        No plan rows match your search.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => {
                      return (
                        <tr
                          key={row.rowId}
                          className={`${row.isDraftNew ? 'plans-editor-row-new' : ''} plans-table-row-clickable`}
                          role="button"
                          tabIndex={0}
                          onClick={() => openRecordEditor(row)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openRecordEditor(row);
                            }
                          }}
                        >
                          <td>
                            <div className="plans-table-minimal-title">
                              {row.packageCode}
                            </div>
                            <div className="plans-table-minimal-meta text-muted small">
                              {row.package_name}
                            </div>
                          </td>
                          <td>
                            <span className="badge rounded-pill text-bg-light border text-uppercase">
                              {row.networkLabel || row.network || 'OTHER'}
                            </span>
                          </td>
                          <td>
                            <span className="badge rounded-pill text-bg-light border text-uppercase">
                              {row.sourceLabel || row.source}
                            </span>
                          </td>
                          <td>{getRowDurationGroup(row)}</td>
                          <td>
                            <strong className={getEditableSellingPriceClass(row)}>
                              {formatMoney(row.sellingPrice)}
                            </strong>
                          </td>
                          <td>{formatMoney(row.package_original_amount)}</td>
                          <td>
                            <div className="plans-table-minimal-meta">
                              {row.isNew ? (
                                <span className="badge rounded-pill text-bg-success">New</span>
                              ) : null}
                              <span
                                className={`badge rounded-pill ${
                                  row.exclude
                                    ? 'text-bg-danger'
                                    : 'text-bg-secondary'
                                }`}
                              >
                                {row.exclude ? 'Excluded' : 'Active'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>

            <Modal
              isOpen={Boolean(selectedRecord && recordDraft)}
              size="lg"
              className="plans-editor-modal"
              modalClassName="plans-editor-modal-shell"
              overlayClassName="plans-editor-modal-overlay"
              toggle={() => closeRecordEditor()}
            >
              <ModalHeader toggle={() => closeRecordEditor()}>
                {recordDraft?.isDraftNew ? 'Create Plan Override' : 'Edit Plan Override'}
              </ModalHeader>
              <ModalBody>
                {selectedRecord && recordDraft ? (
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="plans-plan-edit-label">Package Code</label>
                      <Input
                        value={recordDraft.packageCode || ''}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'packageCode', event.target.value)
                        }
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="plans-plan-edit-label">Source</label>
                      <select
                        className="form-select"
                        value={recordDraft.source || 'aidapay'}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'source', event.target.value)
                        }
                        disabled={readOnly}
                      >
                        {sourceSelectOptions
                          .filter((tab) => tab.key !== 'all')
                          .map((tab) => (
                            <option key={tab.key} value={tab.key}>
                              {tab.label}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="plans-plan-edit-label">Network</label>
                      <select
                        className="form-select"
                        value={toKey(recordDraft.network || recordDraft.networkLabel || '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'network', event.target.value)
                        }
                        disabled={readOnly}
                      >
                        <option value="">Select network</option>
                        {networkSelectOptions
                          .filter((tab) => tab.key !== 'all')
                          .map((tab) => (
                            <option key={tab.key} value={tab.key}>
                              {tab.label}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="plans-plan-edit-label">Duration</label>
                      <Input
                        value={recordDraft.durationGroup || ''}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'durationGroup', event.target.value)
                        }
                        placeholder="Daily, Weekly, 14 Days, 1 Month..."
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="plans-plan-edit-label">Package Name</label>
                      <Input
                        value={recordDraft.package_name || ''}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'package_name', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Original Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={String(recordDraft.package_original_amount ?? '')}
                        onChange={(event) =>
                          updateRow(
                            recordDraft.rowId,
                            'package_original_amount',
                            event.target.value
                          )
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Selling Price</label>
                      <Input
                        type="number"
                        step="0.01"
                        className={getEditableSellingPriceClass(recordDraft)}
                        value={String(recordDraft.sellingPrice ?? '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'sellingPrice', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Commission</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={String(recordDraft.commission ?? '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'commission', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Fee</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={String(recordDraft.fee ?? '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'fee', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Gain</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={String(recordDraft.gain ?? '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'gain', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="plans-plan-edit-label">Markup</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={String(recordDraft.markup ?? '')}
                        onChange={(event) =>
                          updateRow(recordDraft.rowId, 'markup', event.target.value)
                        }
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-12">
                      <label className="plans-plan-edit-label">Replacement Package Codes</label>
                      <textarea
                        className="form-control plans-editor-textarea"
                        value={recordDraft.replacementCodesText || ''}
                        onChange={(event) =>
                          updateRow(
                            recordDraft.rowId,
                            'replacementCodesText',
                            event.target.value
                          )
                        }
                        placeholder="One code per line or comma separated"
                        disabled={readOnly}
                      />
                    </div>
                    <div className="col-md-12">
                      <div className="plans-plan-edit-checks">
                        <label className="plans-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(recordDraft.isNew)}
                            onChange={(event) =>
                              updateRow(
                                recordDraft.rowId,
                                'isNew',
                                Boolean(event.target.checked)
                              )
                            }
                            disabled={readOnly}
                          />
                          <span>Mark as new</span>
                        </label>
                        <label className="plans-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(recordDraft.exclude)}
                            onChange={(event) =>
                              updateRow(
                                recordDraft.rowId,
                                'exclude',
                                Boolean(event.target.checked)
                              )
                            }
                            disabled={readOnly}
                          />
                          <span>Exclude from users</span>
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </ModalBody>
              <ModalFooter>
                <Button color="secondary" onClick={() => closeRecordEditor()}>
                  Close
                </Button>
                {!readOnly ? (
                  <Button
                    color="danger"
                    outline
                    onClick={() => handleDeleteRow(recordDraft)}
                    disabled={
                      !recordDraft || Boolean(deletingRowIds[recordDraft.rowId])
                    }
                  >
                    {recordDraft && deletingRowIds[recordDraft.rowId]
                      ? 'Deleting...'
                      : recordDraft?.isDraftNew
                      ? 'Discard'
                      : 'Delete'}
                  </Button>
                ) : null}
                <Button
                  color="info"
                  onClick={() => handleSaveRow(recordDraft)}
                  disabled={
                    readOnly ||
                    !recordDraft ||
                    Boolean(savingRowIds[recordDraft.rowId])
                  }
                >
                  {recordDraft && savingRowIds[recordDraft.rowId] ? 'Saving...' : 'Save Changes'}
                </Button>
              </ModalFooter>
            </Modal>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default PlansDataDetailsEditor;
