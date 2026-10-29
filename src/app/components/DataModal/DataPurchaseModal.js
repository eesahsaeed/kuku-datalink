import React, { useState, useEffect } from 'react';
import {
  Button,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ListGroup,
  ListGroupItem,
  Alert,
  Spinner,
  FormGroup,
  Row,
  Col,
} from 'components/ui/primitives';
import NaturalComboBox from 'components/NaturalComboBox/NaturalComboBox';
import axios from 'axios';
import CelebrationConfetti from 'components/CelebrationConfetti/CelebrationConfetti';

import {
  clearPendingAuthRedirect,
  getUser,
  isValidNigerianMobileNumber,
  networkTimeout,
  formatToNaira,
  normalizeNigerianPhoneNumber,
  normalizePhoneInputValue,
  getDataPlanPricingMeta,
} from '../../../lib/helper';
import { getFriendlyPurchaseErrorMessage } from '../../utils/purchaseErrors';
import { validateAidapayRecipient } from '../../utils/aidapayValidation';
import Loading from 'components/Loading/Loading';
import { TransactionPinFields } from '../TransactionPinPrompt/TransactionPinPrompt';
import {
  dispatchPhoneBeneficiariesUpdated,
  normalizePhoneBeneficiaries,
  prioritizeBeneficiariesByUserPhone,
  PHONE_BENEFICIARIES_UPDATED_EVENT,
} from '../../utils/beneficiaryEvents';
import {
  readCachedBeneficiaries,
  readCachedWalletBalance,
  writeCachedBeneficiaries,
  writeCachedWalletBalance,
} from '../../utils/purchaseUiCache';
import {
  clearDataPurchaseDraft,
  readDataPurchaseDraft,
  saveDataPurchaseDraft,
} from '../../utils/dataPurchaseJourney';

function resolveDataProviderBranding(providerCode = '') {
  const normalizedProviderCode = String(providerCode || '')
    .trim()
    .toLowerCase();

  if (normalizedProviderCode.includes('mtn')) {
    return { label: 'MTN', logoUrl: '/img/mtn-logo.jpg' };
  }

  if (normalizedProviderCode.includes('airtel')) {
    return { label: 'Airtel', logoUrl: '/img/airtel-logo.png' };
  }

  if (normalizedProviderCode.includes('glo')) {
    return { label: 'GLO', logoUrl: '/img/glo-logo.png' };
  }

  if (
    normalizedProviderCode.includes('9mobile') ||
    normalizedProviderCode.includes('t2mobile')
  ) {
    return { label: '9mobile', logoUrl: '/img/t2mobile.png' };
  }

  return { label: '', logoUrl: '' };
}

function is9mobileProviderCode(providerCode = '') {
  const normalizedProviderCode = String(providerCode || '')
    .trim()
    .toLowerCase();

  return (
    normalizedProviderCode.includes('9mobile') ||
    normalizedProviderCode.includes('t2mobile') ||
    normalizedProviderCode.includes('etisalat')
  );
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue;
}

function resolvePackageInfo(dataPlan = {}) {
  const packageCode = String(dataPlan?.package_api_code || '').trim();
  const packageFromDetails = packageCode
    ? getDataPlanPricingMeta(packageCode)
    : null;

  const amount = toFiniteNumber(
    dataPlan?.sellingPrice ??
      dataPlan?.price ??
      packageFromDetails?.sellingPrice ??
      packageFromDetails?.price ??
      dataPlan?.package_amount ??
      dataPlan?.package_original_amount ??
      packageFromDetails?.package_original_amount ??
      packageFromDetails?.originalPrice ??
      dataPlan?.amount ??
      dataPlan?.rawPrice
  );

  if (amount != null && amount > 0) {
    return {
      amount,
      packageName:
        packageFromDetails?.package_name ||
        dataPlan?.package_name ||
        packageCode ||
        'Data plan',
    };
  }

  return null;
}

function formatDataPlanDisplayName(packageName = '') {
  return String(packageName || '')
    .replace(/\bwhatsapp\b/gi, 'WhatsApp')
    .replace(/\byoutube\b/gi, 'YouTube')
    .replace(/\btiktok\b/gi, 'TikTok')
    .replace(/\bfacebook\b/gi, 'Facebook')
    .replace(/\binstagram\b/gi, 'Instagram')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildUsageWarning(appLabels = [], label = 'App-limited plan') {
  const appSummary =
    appLabels.length > 0 ? appLabels.join(', ') : 'selected apps';

  return {
    tone: 'warning',
    label,
    message: `This bundle is for ${appSummary} only. Regular browsing, downloads, streaming, and most other apps will not work with this plan.`,
  };
}

function resolveDataPlanUsageNotice(packageName = '') {
  const normalizedName = formatDataPlanDisplayName(packageName);
  const loweredName = normalizedName.toLowerCase();
  const limitedApps = [];

  if (loweredName.includes('whatsapp')) limitedApps.push('WhatsApp');
  if (loweredName.includes('facebook')) limitedApps.push('Facebook');
  if (loweredName.includes('youtube')) limitedApps.push('YouTube');
  if (loweredName.includes('instagram')) limitedApps.push('Instagram');
  if (loweredName.includes('tiktok')) limitedApps.push('TikTok');

  if (limitedApps.length === 1) {
    return buildUsageWarning(limitedApps, `${limitedApps[0]} only`);
  }

  if (limitedApps.length > 1) {
    return buildUsageWarning(
      limitedApps,
      `${limitedApps.join(' / ')} only`
    );
  }

  if (
    loweredName.includes('social media') ||
    loweredName.includes('social plan')
  ) {
    return {
      tone: 'warning',
      label: 'Social media only',
      message:
        'This bundle is for social media apps only. General browsing, large downloads, streaming, and most non-social apps will not work with this plan.',
    };
  }

  if (
    loweredName.includes('all night') ||
    loweredName.includes('night bonus')
  ) {
    return {
      tone: 'info',
      label: 'Includes a night-only bonus',
      message:
        'Part of this plan may be reserved for night use only, so daytime usage can be lower than the full advertised bundle.',
    };
  }

  // Special note for AWUF / Awoof-style bundles (carrier-side activation caveats)
  if (loweredName.includes('awuf') || loweredName.includes('awoof') || loweredName.includes('awof')) {
    return {
      tone: 'warning',
      label: 'Activation Notice',
      message:
        "This MTN AWUF bundle may not activate if the recipient's line has outstanding charges, unpaid subscriptions, or other carrier-imposed restrictions. To minimise the risk of failed activation, please ensure the recipient's line is active and free of outstanding balances before purchasing.",
    };
  }

  return null;
}

function createPurchaseReference() {
  return [
    'DATA',
    Date.now(),
    Math.random().toString(36).slice(2, 8).toUpperCase(),
  ].join('-');
}

function DataModal({
  dataPlan,
  isOpen,
  toggleModal,
  draftState,
  onDraftChange,
  onRequireAuth,
  onPurchaseSuccess,
}) {
  const [modal, setModal] = useState(Boolean(isOpen));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState(() =>
    normalizePhoneInputValue(
      draftState?.phoneNumber || readDataPurchaseDraft(dataPlan).phoneNumber || ''
    )
  );
  const [phoneError, setPhoneError] = useState('');
  const [phoneValidationState, setPhoneValidationState] = useState({
    loading: false,
    verified: false,
    label: '',
  });

  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);

  const [walletBalance, setWalletBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [beneficiariesLoading, setBeneficiariesLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinPromptError, setPinPromptError] = useState('');
  const pinFieldsRef = React.useRef(null);
  const phoneValidationRequestRef = React.useRef(0);
  const purchaseReferenceRef = React.useRef('');
  const providerBranding = React.useMemo(
    () => resolveDataProviderBranding(dataPlan?.provider_code),
    [dataPlan?.provider_code]
  );
  const resolvedPackageInfo = React.useMemo(
    () => resolvePackageInfo(dataPlan),
    [dataPlan]
  );
  const displayPackageName = React.useMemo(
    () =>
      formatDataPlanDisplayName(
        resolvedPackageInfo?.packageName || dataPlan?.package_name || 'Data plan'
      ),
    [dataPlan?.package_name, resolvedPackageInfo?.packageName]
  );
  const usageNotice = React.useMemo(
    () => resolveDataPlanUsageNotice(displayPackageName),
    [displayPackageName]
  );
  const isAuthenticated = Boolean(getUser()?.token);
  const isPlanUnavailable = false;

  const toggle = () => {
    const nextOpen = !modal;
    setModal(nextOpen);
    toggleModal?.();
    if (!nextOpen) resetForm();
  };

  const resetForm = () => {
    phoneValidationRequestRef.current += 1;
    setPhoneNumber('');
    setPhoneError('');
    setPhoneValidationState({
      loading: false,
      verified: false,
      label: '',
    });
    setResult(null);
    setProcessing(false);
    setConfirmOpen(false);
    setShowPinPrompt(false);
    setShowConfetti(false);
    setPinPromptError('');
    purchaseReferenceRef.current = '';
    clearDataPurchaseDraft(dataPlan);
    onDraftChange?.({
      phoneNumber: '',
    });
  };

  const isIncorrectPinError = (errorMessage = '', statusCode = 0) => {
    const normalizedMessage = String(errorMessage || '').toLowerCase();

    return (
      statusCode === 403 &&
      normalizedMessage.includes('incorrect transaction pin')
    );
  };

  useEffect(() => {
    if (modal) {
      fetchWalletBalance();
      fetchBeneficiaries();
    }
  }, [modal]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleBeneficiarySync = () => {
      fetchBeneficiaries();
    };

    window.addEventListener(
      PHONE_BENEFICIARIES_UPDATED_EVENT,
      handleBeneficiarySync
    );

    return () => {
      window.removeEventListener(
        PHONE_BENEFICIARIES_UPDATED_EVENT,
        handleBeneficiarySync
      );
    };
  }, []);

  useEffect(() => {
    if (typeof isOpen === 'boolean') {
      setModal(isOpen);
      if (!isOpen) {
        resetForm();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    purchaseReferenceRef.current = '';
  }, [dataPlan?.provider_code, dataPlan?.package_api_code]);

  useEffect(() => {
    const nextPhone = normalizePhoneInputValue(
      draftState?.phoneNumber || readDataPurchaseDraft(dataPlan).phoneNumber || ''
    );
    if (nextPhone !== phoneNumber) {
      setPhoneNumber(nextPhone);

      if (nextPhone.length >= 10) {
        void validatePhone(nextPhone);
      } else {
        setPhoneError('');
        setPhoneValidationState({
          loading: false,
          verified: false,
          label: '',
        });
      }
    }
  }, [dataPlan?.package_api_code, draftState?.phoneNumber]);

  const updatePhoneNumber = (value) => {
    const nextPhone = normalizePhoneInputValue(value || '');
    setPhoneNumber(nextPhone);
    saveDataPurchaseDraft(dataPlan, { phoneNumber: nextPhone });
    onDraftChange?.({ phoneNumber: nextPhone });
  };

  const fetchWalletBalance = async ({ force = false } = {}) => {
    const user = getUser();

    if (!user?.token) {
      setWalletBalance('Login required');
      setBalanceLoading(false);
      return;
    }

    const cachedWalletBalance = force
      ? undefined
      : readCachedWalletBalance(user.token);

    if (typeof cachedWalletBalance !== 'undefined') {
      setWalletBalance(cachedWalletBalance);
      setBalanceLoading(false);
      return;
    }

    setBalanceLoading(true);

    try {
      const res = await axios.get(`/api/wallet/me`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: networkTimeout,
      });

      if (res.data?.success && res.data.wallet?.balance != null) {
        const nextWalletBalance = Number(res.data.wallet.balance);
        writeCachedWalletBalance(user.token, nextWalletBalance);
        setWalletBalance(nextWalletBalance);
      } else {
        setWalletBalance('Unavailable');
      }
    } catch {
      setWalletBalance('Error');
    } finally {
      setBalanceLoading(false);
    }
  };

  const fetchBeneficiaries = async ({ force = false } = {}) => {
    const user = getUser();
    if (!user?.token) return;

    const cachedBeneficiaries = force
      ? undefined
      : readCachedBeneficiaries(user.token);

    if (Array.isArray(cachedBeneficiaries)) {
      setBeneficiaries(cachedBeneficiaries);
      setBeneficiariesLoading(false);
      return;
    }

    setBeneficiariesLoading(true);

    try {
      const res = await axios.get(`/api/wallet/beneficiaries`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: networkTimeout,
      });

      //console.log(res.data)

      if (res.data?.success) {
        const normalizedBeneficiaries = normalizePhoneBeneficiaries(
          res.data.beneficiaries || []
        );
        const prioritizedBeneficiaries = prioritizeBeneficiariesByUserPhone(
          normalizedBeneficiaries,
          user.phoneNumber || user.phone_number || ''
        );

        writeCachedBeneficiaries(user.token, prioritizedBeneficiaries);
        setBeneficiaries(prioritizedBeneficiaries);
      }
    } catch (err) {
      console.error('Failed to load beneficiaries:', err);
    } finally {
      setBeneficiariesLoading(false);
    }
  };

  const validatePhone = async (number) => {
    const cleaned = normalizeNigerianPhoneNumber(number);

    if (!cleaned || !isValidNigerianMobileNumber(cleaned)) {
      setPhoneError(
        'Enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....'
      );
      setPhoneValidationState({
        loading: false,
        verified: false,
        label: '',
      });
      return false;
    }

    const providerCode = String(dataPlan?.provider_code || '').trim();

    if (!providerCode) {
      setPhoneError(
        'Unable to verify this phone number for the selected plan right now.'
      );
      setPhoneValidationState({
        loading: false,
        verified: false,
        label: '',
      });
      return false;
    }

    const requestId = ++phoneValidationRequestRef.current;
    setPhoneValidationState({
      loading: true,
      verified: false,
      label: '',
    });

    const verification = await validateAidapayRecipient(providerCode, cleaned);

    if (requestId !== phoneValidationRequestRef.current) {
      return false;
    }

    if (!verification?.success || verification?.verified === false) {
      setPhoneError(
        verification?.message ||
          'Enter a valid Nigerian mobile number for this plan.'
      );
      setPhoneValidationState({
        loading: false,
        verified: false,
        label: '',
      });
      return false;
    }

    setPhoneError('');
    setPhoneValidationState({
      loading: false,
      verified: true,
      label: '',
    });
    return true;
  };

  const initiatePurchase = async () => {
    const user = getUser();
    if (!user?.token) {
      onRequireAuth?.('/signin');
      return;
    }

    if (isPlanUnavailable) {
      setResult({
        success: false,
        message:
          'This plan is unavailable right now. Please choose another available plan.',
      });
      return;
    }

    if (!(await validatePhone(phoneNumber))) return;
    purchaseReferenceRef.current = createPurchaseReference();
    setConfirmOpen(true);
  };

  const requestPinAndPay = () => {
    setPinPromptError('');
    setShowPinPrompt(true);
    setConfirmOpen(false);
  };

  const confirmAndPay = async (transactionPin) => {
    if (isPlanUnavailable) {
      setShowPinPrompt(false);
      setResult({
        success: false,
        message:
          'This plan is unavailable right now. Please choose another available plan.',
      });
      return false;
    }

    setProcessing(true);
    setResult(null);
    setPinPromptError('');

    const user = getUser();

    if (!user?.token) {
      setShowPinPrompt(false);
      setResult({ success: false, message: 'Please log in' });
      setProcessing(false);
      return false;
    }

    const packageInfo = resolvedPackageInfo;

    if (!packageInfo) {
      setResult({ success: false, message: 'Invalid plan pricing' });
      setProcessing(false);
      return false;
    }

    const amount = Number(packageInfo.amount);
    const selectedPackageName =
      packageInfo.packageName || dataPlan?.package_name || 'Data plan';
    const normalizedPhoneNumber = normalizeNigerianPhoneNumber(phoneNumber);
    const idempotencyKey =
      purchaseReferenceRef.current || createPurchaseReference();
    purchaseReferenceRef.current = idempotencyKey;
    const endpoint = is9mobileProviderCode(dataPlan?.provider_code)
      ? '/api/9mobile/purchase-data'
      : '/api/purchase/purchase-data';

    if (typeof walletBalance === 'number' && amount > walletBalance) {
      setResult({
        success: false,
        message: `Insufficient balance. Need ${formatToNaira(
          amount - walletBalance
        )} more.`,
      });
      setProcessing(false);
      return false;
    }

    try {
        const payload = {
          phone_number: normalizedPhoneNumber,
          provider_code: dataPlan.provider_code,
          package_code: dataPlan.package_api_code,
          amount,
          transactionPin,
          reference: idempotencyKey,
          idempotency_key: idempotencyKey,
          package_name: selectedPackageName,
        };

        const res = await axios.post(endpoint, payload, {
          headers: {
            Authorization: `Bearer ${user.token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          timeout: networkTimeout,
        });

      if (res.data.success) {
        const responseStatus = String(res.data.status || '').trim().toLowerCase();
        const isProcessing =
          responseStatus === 'processing' || responseStatus === 'pending';
        const isFinalSuccess = !isProcessing;

        clearPendingAuthRedirect();
        setShowPinPrompt(false);
        setPinPromptError('');
        setResult({
          success: isFinalSuccess,
          processing: isProcessing,
          message: isProcessing
            ? res.data.message || `${displayPackageName} is processing`
            : `${displayPackageName} delivered to ${normalizedPhoneNumber}`,
          newBalance: res.data.newBalance,
        });

        if (isFinalSuccess) {
          onPurchaseSuccess?.();
          setShowConfetti(true);
        }

        fetchWalletBalance({ force: true });
        fetchBeneficiaries({ force: true });
        dispatchPhoneBeneficiariesUpdated();
      } else {
        const responseMessage = res.data.message || 'Failed';

        if (isIncorrectPinError(responseMessage, 403)) {
          purchaseReferenceRef.current = '';
          setPinPromptError(responseMessage);
          return false;
        }

        setShowPinPrompt(false);
        setResult({
          success: false,
          message: responseMessage,
        });
      }
    } catch (err) {
      let msg = getFriendlyPurchaseErrorMessage(err);

      if (err.response?.status === 401) msg = 'Session expired';

      if (isIncorrectPinError(msg, err.response?.status)) {
        purchaseReferenceRef.current = '';
        setPinPromptError(msg);
        return false;
      }

      setShowPinPrompt(false);
      setResult({ success: false, message: msg });
      return false;
    } finally {
      setProcessing(false);
    }

    return true;
  };

  const displayPrice = Number(resolvedPackageInfo?.amount || 0);

  const isFormValid =
    Boolean(normalizeNigerianPhoneNumber(phoneNumber)) &&
    !phoneError &&
    !phoneValidationState.loading &&
    phoneValidationState.verified &&
    !processing &&
    !balanceLoading &&
    !beneficiariesLoading;

  const handleRetry = () => {
    setShowPinPrompt(false);
    setConfirmOpen(false);
    resetForm();
    fetchWalletBalance({ force: true });
    fetchBeneficiaries({ force: true });
  };

  const handlePinStepBack = () => {
    if (processing) return;
    setPinPromptError('');
    setShowPinPrompt(false);
  };

  return (
    <div>
      {typeof isOpen !== 'boolean' ? (
        <Button color="info" size="lg" className="w-75" onClick={toggle}>
          Buy Data Now
        </Button>
      ) : null}

      <Modal
        isOpen={modal}
        toggle={toggle}
        centered
        backdrop="static"
        className="service-purchase-modal"
        modalClassName="service-purchase-modal-shell"
        overlayClassName="ra-modal-overlay-flat"
      >
        {processing && <Loading />}

        <ModalHeader toggle={toggle}>
          <div className="purchase-modal-header">
            {providerBranding.logoUrl ? (
              <img
                src={providerBranding.logoUrl}
                alt="Data logo"
                className="purchase-modal-header-logo"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <span className="purchase-modal-header-title">
              {showPinPrompt && !result
                ? 'Enter Transaction PIN'
                : result
                ? result.processing
                  ? 'Purchase Processing'
                  : result.success
                  ? 'Purchase Successful'
                  : 'Purchase Failed'
                : `Buy ${displayPackageName}`}
            </span>
          </div>
        </ModalHeader>

        <ModalBody
          className="service-purchase-modal-body"
          disableCustomScrollbar
        >
          <CelebrationConfetti
            active={showConfetti && result?.success && !result?.processing}
            onComplete={() => setShowConfetti(false)}
          />

          {result ? (
            <Alert
              color={
                result.processing
                  ? 'warning'
                  : result.success
                  ? 'success'
                  : 'danger'
              }
            >
              {result.message}
            </Alert>
          ) : showPinPrompt ? (
            <div className="p-3">
              <h5 className="mb-3 text-center fw-bold">
                Enter Transaction PIN
              </h5>
              <TransactionPinFields
                ref={pinFieldsRef}
                onConfirm={confirmAndPay}
                loading={processing}
                subtitle="Enter your 4-digit transaction PIN to complete this data purchase."
                errorMessage={pinPromptError}
                autoFocus={showPinPrompt}
                active={showPinPrompt}
              />
            </div>
          ) : (
            <>
              {/* WALLET BALANCE */}
              <div className="service-purchase-balance-card mb-4 p-3 bg-light px-2 rounded border">
                <Row className="service-purchase-balance-row g-2">
                  <Col>
                    <small className="text-muted">Wallet Balance</small>

                    {balanceLoading ? (
                      <div className="mt-1">
                        <Spinner size="sm"> </Spinner> Loading...
                      </div>
                    ) : (
                      <h5 className="fw-bold mb-0">
                        {typeof walletBalance === 'number'
                          ? formatToNaira(walletBalance)
                          : walletBalance}
                      </h5>
                    )}
                  </Col>

                  <Col className="modal-refresh-col">
                    <Button
                      className="wallet-balance-refresh-btn"
                      disabled={balanceLoading}
                      onClick={() => fetchWalletBalance({ force: true })}
                    >
                      {balanceLoading ? (
                        <Spinner size="sm" className="mr-1" />
                      ) : (
                        <i className="tim-icons icon-refresh-01 mr-1" />
                      )}{' '}
                      {balanceLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                  </Col>
                </Row>
              </div>

              {/* PHONE INPUT */}
              <FormGroup className="service-purchase-form-group mb-0">
                <NaturalComboBox
                  id="phone-typeahead"
                  label="Phone Number"
                  placeholder="080xxxxxxxx"
                  inputValue={phoneNumber}
                  onInputChange={(text) => {
                    const cleaned = normalizePhoneInputValue(text);
                    updatePhoneNumber(cleaned);

                    if (cleaned.length >= 10) {
                      void validatePhone(cleaned);
                    } else {
                      setPhoneError('');
                      setPhoneValidationState({
                        loading: false,
                        verified: false,
                        label: '',
                      });
                    }
                  }}
                  items={beneficiaries}
                  getKey={(item) => item.phoneNumber || item.label}
                  getLabel={(item) => item.phoneNumber || item.label}
                  getDescription={(item) =>
                    item.network ? item.network.toUpperCase() : ''
                  }
                  onSelectionChange={(item) => {
                    const value = normalizePhoneInputValue(
                      item.phoneNumber || item.label || ''
                    );
                    updatePhoneNumber(value);
                    void validatePhone(value);
                  }}
                  maxLength={18}
                        emptyState="No saved beneficiaries match this number"
                      />

                {phoneError && (
                  <div className="text-danger small mt-1">{phoneError}</div>
                )}

                {Boolean(normalizeNigerianPhoneNumber(phoneNumber)) &&
                  !phoneError &&
                  (phoneValidationState.loading ? (
                    <small className="text-muted d-inline-flex align-items-center gap-1">
                      <Spinner size="sm" /> Validating...
                    </small>
                  ) : phoneValidationState.verified ? (
                    <small className="text-success">
                      verified
                    </small>
                  ) : null)}
              </FormGroup>

              {/* PLAN INFO */}
              <ListGroup className="mt-3 service-purchase-plan-list">
                <ListGroupItem>
                  <strong>Plan:</strong> {displayPackageName}
                </ListGroupItem>

                <ListGroupItem>
                  <strong>Total:</strong> {formatToNaira(displayPrice)}
                </ListGroupItem>
              </ListGroup>

              {usageNotice && (
                <Alert
                  color={usageNotice.tone === 'warning' ? 'warning' : 'info'}
                  className="mt-3 mb-0"
                >
                  <strong>{usageNotice.label}</strong>
                  <div className="small mt-2">{usageNotice.message}</div>
                </Alert>
              )}

              {typeof walletBalance === 'number' &&
                displayPrice > walletBalance && (
                  <Alert color="warning" className="mt-3">
                    Insufficient balance. You need{' '}
                    {formatToNaira(displayPrice - walletBalance)} more.
                  </Alert>
                )}
              {isPlanUnavailable && (
                <Alert color="danger" className="mt-3 mb-0">
                  plan unavailable
                </Alert>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter className="service-purchase-modal-footer justify-content-between flex-wrap gap-2">
          {!result && !showPinPrompt && !isAuthenticated && (
            <div className="modal-login-guard bg-danger text-white">
              <span className="modal-login-guard-message">
                Please login to continue this purchase.
              </span>
              <Button
                color="light"
                size="sm"
                className="modal-login-guard-button"
                onClick={() => onRequireAuth?.('/signin')}
              >
                Login
              </Button>
            </div>
          )}

          {result && (
            <Button color="secondary" onClick={handleRetry} disabled={processing}>
              Buy Again
            </Button>
          )}

          {!result && showPinPrompt && (
            <>
              <Button
                color="primary"
                onClick={() => pinFieldsRef.current?.submit()}
                disabled={processing}
              >
                {processing ? 'Verifying...' : 'Continue'}
              </Button>
              <Button
                color="secondary"
                onClick={handlePinStepBack}
                disabled={processing}
              >
                Back
              </Button>
            </>
          )}

          {!result && !showPinPrompt && (
            <Button
              color="primary"
              onClick={initiatePurchase}
              disabled={!isFormValid || isPlanUnavailable}
            >
              Confirm & Pay
            </Button>
          )}

          <Button color="secondary" onClick={toggle}>
            {result ? 'Done' : 'Cancel'}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={confirmOpen} centered size="sm" fade={false}>
        <ModalHeader>Confirm Purchase</ModalHeader>

        <ModalBody>
          Buy <strong>{displayPackageName}</strong> for{' '}
          <strong>{formatToNaira(displayPrice)}</strong> to{' '}
          <strong>{phoneNumber}</strong>?
          {usageNotice && (
            <Alert
              color={usageNotice.tone === 'warning' ? 'warning' : 'info'}
              className="mt-3 mb-0"
            >
              <strong>{usageNotice.label}</strong>
              <div className="small mt-2">{usageNotice.message}</div>
            </Alert>
          )}
        </ModalBody>

      <ModalFooter>
          <Button color="primary" onClick={requestPinAndPay}>
            {processing ? <Spinner size="sm"> </Spinner> : 'Pay Now'}
          </Button>

          <Button color="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export default DataModal;
