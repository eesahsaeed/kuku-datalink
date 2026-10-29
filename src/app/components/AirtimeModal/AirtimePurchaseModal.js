import React, { useState, useEffect } from 'react';
import {
  Button,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Form,
  FormGroup,
  Label,
  Alert,
  Spinner,
  Row,
  Col,
} from 'components/ui/primitives';
import NaturalComboBox from 'components/NaturalComboBox/NaturalComboBox';
import axios from 'axios';
import CelebrationConfetti from 'components/CelebrationConfetti/CelebrationConfetti';
import { getFriendlyPurchaseErrorMessage } from '../../utils/purchaseErrors';
import {
  clearPendingAuthRedirect,
  detectNigerianMobileNetwork,
  getUser,
  formatToNaira,
  isValidNigerianMobileNumber,
  networkProviderMatchesPhone,
  networkTimeout,
  normalizeNigerianPhoneNumber,
  normalizePhoneInputValue,
  airtimeProviders,
} from '../../../lib/helper';
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

const AirtimePurchase = ({
  networkProvider,
  isOpen,
  toggleModal,
  draftState,
  onDraftChange,
  onRequireAuth,
  onPurchaseSuccess,
}) => {
  const [modal, setModal] = useState(isOpen);
  const [phoneNumber, setPhoneNumber] = useState(''); // always string
  const [phoneError, setPhoneError] = useState('');
  const [detectedNetwork, setDetectedNetwork] = useState('');
  const [airtimeAmount, setAirtimeAmount] = useState('');
  const [walletBalance, setWalletBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [beneficiariesLoading, setBeneficiariesLoading] = useState(false);

  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinPromptError, setPinPromptError] = useState('');
  const pinFieldsRef = React.useRef(null);
  const purchaseReferenceRef = React.useRef('');

  const [showConfetti, setShowConfetti] = useState(false);

  const provider = airtimeProviders?.[networkProvider] || null;
  const isAuthenticated = Boolean(getUser()?.token);
  const selectedProviderCode = provider?.provider_code?.toLowerCase() || '';
  const minimumAmount = Number(provider?.min_amount) || 50;
  const maximumAmount = Number(provider?.max_amount) || 5000;

  const faceValue = Number(airtimeAmount) || 0;
  const amountToPay = faceValue;

  const quickAmounts = [50, 100, 200, 500, 1000, 2000, 5000].filter(
    (amount) => amount >= minimumAmount && amount <= maximumAmount
  );

  useEffect(() => {
    setModal(isOpen);
    if (isOpen) {
      fetchWalletBalance();
      fetchBeneficiaries();
    } else {
      resetForm();
    }
  }, [isOpen]);

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
    const nextPhone = normalizePhoneInputValue(draftState?.phoneNumber || '');
    const nextAmount = String(draftState?.amount || '').replace(/\D/g, '');

    if (nextPhone !== phoneNumber) {
      setPhoneNumber(nextPhone);
      if (nextPhone.length >= 10) {
        validatePhone(nextPhone);
      } else {
        setPhoneError('');
        setDetectedNetwork('');
      }
    }

    if (nextAmount !== airtimeAmount) {
      setAirtimeAmount(nextAmount);
    }
  }, [draftState?.amount, draftState?.phoneNumber]);

  const resetForm = () => {
    setPhoneNumber('');
    setPhoneError('');
    setDetectedNetwork('');
    setAirtimeAmount('');
    setStatus(null);
    setMessage('');
    setShowPinPrompt(false);
    setShowConfetti(false);
    setPinPromptError('');
    purchaseReferenceRef.current = '';
    onDraftChange?.({
      phoneNumber: '',
      amount: '',
    });
  };

  const toggle = () => {
    toggleModal();
    setShowConfetti(false);
    setPinPromptError('');
  };

  const isIncorrectPinError = (errorMessage = '', statusCode = 0) => {
    const normalizedMessage = String(errorMessage || '').toLowerCase();

    return (
      statusCode === 403 &&
      normalizedMessage.includes('incorrect transaction pin')
    );
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
    } catch (err) {
      setWalletBalance('Error loading balance');
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
      console.warn('Beneficiaries fetch failed', err);
    } finally {
      setBeneficiariesLoading(false);
    }
  };

  const validatePhone = (number) => {
    const cleaned = normalizeNigerianPhoneNumber(number);

    if (!cleaned || !isValidNigerianMobileNumber(cleaned)) {
      setPhoneError(
        'Enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....'
      );
      setDetectedNetwork('');
      return false;
    }

    const matched = detectNigerianMobileNetwork(cleaned);

    setDetectedNetwork(matched || '');

    if (matched && !networkProviderMatchesPhone(cleaned, selectedProviderCode)) {
      setPhoneError('This phone number does not belong to the selected network.');
      return false;
    }

    setPhoneError('');
    return true;
  };

  const handlePurchase = async () => {
    if (!provider?.provider_code) {
      setStatus('error');
      setMessage(
        'This airtime provider is currently unavailable. Please try again later.'
      );
      return;
    }

    if (!validatePhone(phoneNumber)) return;

    const amountNum = Number(airtimeAmount);
    if (amountNum < minimumAmount) {
      setPhoneError(`Minimum ${formatToNaira(minimumAmount)}`);
      return;
    }

    if (amountNum > maximumAmount) {
      setPhoneError(`Maximum ${formatToNaira(maximumAmount)}`);
      return;
    }

    if (typeof walletBalance === 'number' && amountToPay > walletBalance) {
      setStatus('error');
      setMessage('Insufficient wallet balance. Please fund your wallet.');
      return;
    }

    const user = getUser();
    if (!user?.token) {
      onRequireAuth?.('/signin');
      return;
    }

    setPinPromptError('');
    purchaseReferenceRef.current =
      purchaseReferenceRef.current ||
      `AIR-${Date.now()}-${
        crypto.randomUUID?.()?.slice(0, 8)?.toUpperCase() ||
        Math.random().toString(36).slice(2, 10)
      }`;
    setShowPinPrompt(true);
  };

  const handleRetry = () => {
    setShowPinPrompt(false);
    purchaseReferenceRef.current = '';
    resetForm();
    fetchWalletBalance({ force: true });
    fetchBeneficiaries({ force: true });
  };

  const handlePinStepBack = () => {
    if (status === 'processing') return;
    setPinPromptError('');
    setShowPinPrompt(false);
  };

  const submitPurchase = async (transactionPin) => {
    if (!provider?.provider_code) {
      setShowPinPrompt(false);
      setStatus('error');
      setMessage(
        'This airtime provider is currently unavailable. Please try again later.'
      );
      return false;
    }

    const user = getUser();
    const amountNum = Number(airtimeAmount);
    const normalizedPhoneNumber = normalizeNigerianPhoneNumber(phoneNumber);
    const idempotencyKey =
      purchaseReferenceRef.current ||
      `AIR-${Date.now()}-${
        crypto.randomUUID?.()?.slice(0, 8)?.toUpperCase() ||
        Math.random().toString(36).slice(2, 10)
      }`;
    purchaseReferenceRef.current = idempotencyKey;
    setStatus('processing');
    setMessage('');
    setPinPromptError('');

    try {
      const payload = {
        phone_number: normalizedPhoneNumber,
        provider_code: provider.provider_code,
        amount: amountNum,
        transactionPin,
        reference: idempotencyKey,
        idempotency_key: idempotencyKey,
      };

      const res = await axios.post(`/api/purchase/purchase-airtime`, payload, {
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'x-idempotency-key': idempotencyKey,
        },
        timeout: networkTimeout,
      });

      if (res.data?.success) {
        clearPendingAuthRedirect();
        onPurchaseSuccess?.();
        setShowPinPrompt(false);
        setPinPromptError('');
        setStatus('success');
        setMessage(
          `${formatToNaira(amountNum)} airtime sent to ${normalizedPhoneNumber}! (You paid ${formatToNaira(amountToPay)})`
        );
        setShowConfetti(true);
        fetchWalletBalance({ force: true });
        fetchBeneficiaries({ force: true });
        dispatchPhoneBeneficiariesUpdated();
      } else {
        const responseMessage = res.data?.message || 'Purchase failed';

        if (isIncorrectPinError(responseMessage, 403)) {
          setStatus(null);
          purchaseReferenceRef.current = '';
          setPinPromptError(responseMessage);
          return false;
        }

        setShowPinPrompt(false);
        setStatus('error');
        setMessage(responseMessage);
      }
    } catch (err) {
      let msg = getFriendlyPurchaseErrorMessage(err);
      if (err.response?.status === 401)
        msg = 'Session expired. Please login again.';

      if (isIncorrectPinError(msg, err.response?.status)) {
        setStatus(null);
        purchaseReferenceRef.current = '';
        setPinPromptError(msg);
        return false;
      }

      setShowPinPrompt(false);
      setStatus('error');
      setMessage(msg);
      return false;
    }

    return true;
  };

  const isFormValid =
    Boolean(normalizeNigerianPhoneNumber(phoneNumber)) &&
    !phoneError &&
    faceValue >= minimumAmount &&
    faceValue <= maximumAmount &&
    !!networkProvider &&
    !beneficiariesLoading;

  const renderBody = () => {
    if (showPinPrompt && status !== 'success' && status !== 'error') {
      return (
        <div className="p-3">
          <h5 className="mb-3 text-center fw-bold">Enter Transaction PIN</h5>
          <TransactionPinFields
            ref={pinFieldsRef}
            onConfirm={submitPurchase}
            loading={status === 'processing'}
            subtitle="Enter your 4-digit transaction PIN to buy airtime."
            errorMessage={pinPromptError}
            autoFocus={showPinPrompt}
            active={showPinPrompt}
          />
        </div>
      );
    }

    if (status === 'success') {
      return (
        <>
          <CelebrationConfetti
            active={showConfetti}
            onComplete={() => setShowConfetti(false)}
          />
          <Alert color="success" className="m-3 text-center">
            <strong>Success!</strong>
            <br />
            {message}
            {typeof walletBalance === 'number' && (
              <div className="mt-3">
                New balance: <strong>{formatToNaira(walletBalance)}</strong>
              </div>
            )}
          </Alert>
        </>
      );
    }

    if (status === 'error')
      return (
        <Alert color="danger" className="m-3">
          {message}
        </Alert>
      );

    if (status === 'processing') {
      return (
        <div className="text-center py-5">
          <Spinner color="primary"> </Spinner>
          <p className="mt-3">Processing...</p>
        </div>
      );
    }

    return (
      <div className="p-3">
        <h5 className="mb-4 text-center fw-bold">
          Buy {networkProvider?.toUpperCase() || ''} Airtime
        </h5>

        <div className="mb-4 p-3 bg-light rounded border">
          <Row>
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

        <Form>
          <FormGroup>
            <NaturalComboBox
              id="phone-typeahead-data"
              label="Recipient Phone"
              placeholder="080xxxxxxxx"
              inputValue={phoneNumber}
              onInputChange={(text) => {
                const cleaned = normalizePhoneInputValue(text);
                setPhoneNumber(cleaned);
                onDraftChange?.({
                  phoneNumber: cleaned,
                  amount: airtimeAmount,
                });

                if (cleaned.length >= 10) {
                  validatePhone(cleaned);
                } else {
                  setPhoneError('');
                  setDetectedNetwork('');
                }
              }}
              items={beneficiaries}
              getKey={(item) => item.phoneNumber || item.label}
              getLabel={(item) => item.phoneNumber || item.label}
              getDescription={() => ''}
              onSelectionChange={(item) => {
                const value = normalizePhoneInputValue(
                  item.phoneNumber || item.label || ''
                );
                setPhoneNumber(value);
                onDraftChange?.({
                  phoneNumber: value,
                  amount: airtimeAmount,
                });
                validatePhone(value);
              }}
              maxLength={18}
                          emptyState="No saved beneficiaries match this number"
                        />
            {phoneError && (
              <div className="text-danger small mt-1">{phoneError}</div>
            )}
            {Boolean(normalizeNigerianPhoneNumber(phoneNumber)) &&
              !phoneError &&
              detectedNetwork && (
                <small className="text-success d-block mt-1">
                  verified
                </small>
              )}
          </FormGroup>

          <FormGroup className="mt-4">
            <Label>Amount (Recipient Gets)</Label>
            <div className="airtime-quick-suggestions">
              {quickAmounts.map((amt) => (
                <Button
                  key={amt}
                  size="sm"
                  color={
                    airtimeAmount === String(amt) ? 'primary' : 'secondary'
                  }
                  className="airtime-quick-suggestion-btn"
                  onClick={() => {
                    const value = String(amt);
                    setAirtimeAmount(value);
                    onDraftChange?.({
                      phoneNumber,
                      amount: value,
                    });
                  }}
                >
                  {formatToNaira(amt)}
                </Button>
              ))}
            </div>
            <input
              className="form-control"
              placeholder="e.g. 1000"
              value={
                airtimeAmount
                  ? Number(airtimeAmount).toLocaleString('en-NG')
                  : ''
              }
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                setAirtimeAmount(value);
                onDraftChange?.({
                  phoneNumber,
                  amount: value,
                });
              }}
            />
            {airtimeAmount && faceValue < minimumAmount && (
              <div className="text-danger small mt-1">
                Minimum {formatToNaira(minimumAmount)}
              </div>
            )}
            {airtimeAmount && faceValue > maximumAmount && (
              <div className="text-danger small mt-1">
                Maximum {formatToNaira(maximumAmount)}
              </div>
            )}
          </FormGroup>

          {typeof walletBalance === 'number' &&
            amountToPay > walletBalance &&
            faceValue > 0 && (
              <Alert color="warning" className="mt-3 small">
                Insufficient balance (you have {formatToNaira(walletBalance)}).
                Need {formatToNaira(amountToPay - walletBalance)} more.
              </Alert>
            )}
        </Form>
      </div>
    );
  };

  return (
    <Modal
      isOpen={modal}
      toggle={toggle}
      centered
      size="md"
      className="service-purchase-modal"
      modalClassName="service-purchase-modal-shell"
      overlayClassName="ra-modal-overlay-flat"
      backdrop={status === 'processing' ? 'static' : true}
      keyboard={status !== 'processing'}
    >
      <ModalHeader toggle={toggle}>
        <div className="purchase-modal-header">
          {provider?.provider_image_url ? (
            <img
              src={provider.provider_image_url}
              alt="Airtime logo"
              className="purchase-modal-header-logo"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
          <span className="purchase-modal-header-title">
            {showPinPrompt && status !== 'success' && status !== 'error'
              ? 'Enter Transaction PIN'
              : status === 'success'
              ? 'Purchase Successful'
              : status === 'error'
              ? 'Purchase Failed'
              : 'Buy Airtime'}
          </span>
        </div>
      </ModalHeader>
      <ModalBody
        className="service-purchase-modal-body"
        disableCustomScrollbar
        style={{ position: 'relative' }}
      >
        {renderBody()}
      </ModalBody>
      <ModalFooter className="service-purchase-modal-footer justify-content-between flex-wrap gap-2">
        {status !== 'success' &&
          status !== 'error' &&
          !showPinPrompt &&
          !isAuthenticated && (
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

        {status === 'success' || status === 'error' ? (
          <>
            <Button color="secondary" onClick={handleRetry}>
              Buy Again
            </Button>
            <Button color="success" onClick={toggle}>
              Done
            </Button>
          </>
        ) : showPinPrompt ? (
          <>
            <Button
              color="primary"
              size="lg"
              onClick={() => pinFieldsRef.current?.submit()}
              disabled={status === 'processing'}
            >
              {status === 'processing' ? 'Verifying...' : 'Continue'}
            </Button>
            <Button
              color="secondary"
              onClick={handlePinStepBack}
              disabled={status === 'processing'}
            >
              Back
            </Button>
            <Button color="secondary" onClick={toggle} disabled={status === 'processing'}>
              Cancel
            </Button>
          </>
        ) : status === 'processing' ? null : (
          <>
            <Button
              color="primary"
              size="lg"
              onClick={handlePurchase}
              disabled={
                !isFormValid ||
                balanceLoading ||
                beneficiariesLoading ||
                (typeof walletBalance === 'number' &&
                  amountToPay > walletBalance)
              }
            >
              Pay {formatToNaira(amountToPay)} & Buy
            </Button>
            <Button color="secondary" onClick={toggle}>
              Cancel
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default AirtimePurchase;
