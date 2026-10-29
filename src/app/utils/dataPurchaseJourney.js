const DATA_PURCHASE_SELECTION_KEY = 'kuku:data-purchase-selection:v1';
const DATA_PURCHASE_DRAFT_KEY = 'kuku:data-purchase-draft:v1';

export const getDataPlanCode = (plan = {}) =>
  String(plan?.package_api_code || plan?.package_code || plan?.id || '').trim();

const readStorageValue = (key) => {
  if (typeof window === 'undefined') return {};

  try {
    const value = window.localStorage.getItem(key);
    const parsedValue = value ? JSON.parse(value) : {};
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch (_error) {
    return {};
  }
};

const writeStorageValue = (key, value) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // A failed local write must never prevent a user from buying data.
  }
};

export const readDataPurchaseSelection = () =>
  readStorageValue(DATA_PURCHASE_SELECTION_KEY);

export const saveDataPurchaseSelection = (nextSelection = {}) => {
  writeStorageValue(DATA_PURCHASE_SELECTION_KEY, {
    ...readDataPurchaseSelection(),
    ...nextSelection,
    updatedAt: Date.now(),
  });
};

const getPlanDraftKey = (plan = {}) =>
  `${DATA_PURCHASE_DRAFT_KEY}:${getDataPlanCode(plan) || 'unknown'}`;

export const readDataPurchaseDraft = (plan) => readStorageValue(getPlanDraftKey(plan));

export const saveDataPurchaseDraft = (plan, nextDraft = {}) => {
  writeStorageValue(getPlanDraftKey(plan), {
    ...readDataPurchaseDraft(plan),
    ...nextDraft,
    updatedAt: Date.now(),
  });
};

export const clearDataPurchaseDraft = (plan) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getPlanDraftKey(plan));
  } catch (_error) {
    // Ignore unavailable storage; the visible form is still usable.
  }
};
