import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  FormGroup,
  Label,
  Input,
  Spinner,
  Alert,
  Container,
  Row,
  Col,
} from 'components/ui/primitives';
import axios from 'axios';
import { toast } from 'sonner';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import CelebrationConfetti from 'components/CelebrationConfetti/CelebrationConfetti';

import {
  buildAuthNavigationTarget,
  clearPendingAuthRedirect,
  getUser,
  networkTimeout,
  regions,
  removeLastNonWordChar,
  setPendingAuthRedirect,
  toKebabAndLowercase,
} from '../../../lib/helper';
import { getFriendlyPurchaseErrorMessage } from '../../utils/purchaseErrors';

import ElectricityMeterInput from 'components/ElectricityMeterInput/ElectricityMeterInput';
import TransactionPinPrompt from '../TransactionPinPrompt/TransactionPinPrompt';
import {
  buildServiceContinuationReturnTo,
  clearServiceContinuationSearch,
  hasServiceContinuationMatch,
} from '../../utils/serviceContinuation';

const ELECTRICITY_SERVICE_CATEGORY = 'electricity';

function ElectricityServicesCard({ provider, onActivateView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const providerCode = provider.provider_code || provider.code;
  const initialContinuationMatch = hasServiceContinuationMatch(
    searchParams,
    ELECTRICITY_SERVICE_CATEGORY,
    providerCode
  );

  const [modalOpen, setModalOpen] = useState(initialContinuationMatch);
  const [showUnavailableModal, setShowUnavailableModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const [isVerified, setIsVerified] = useState(false);
  const [meterNumber, setMeterNumber] = useState(
    initialContinuationMatch
      ? String(searchParams.get('electricityMeter') || '')
      : ''
  );
  const [meterInfo, setMeterInfo] = useState(null);
  const [meterType, setMeterType] = useState(
    initialContinuationMatch
      ? String(searchParams.get('electricityType') || '') || 'prepaid'
      : 'prepaid'
  );
  const [amount, setAmount] = useState(
    initialContinuationMatch
      ? String(searchParams.get('electricityAmount') || '')
      : ''
  );

  const [verifying, setVerifying] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [alertKey, setAlertKey] = useState(0);
  const [electricityBeneficiaries, setElectricityBeneficiaries] = useState([]);
  const [showPinPrompt, setShowPinPrompt] = useState(false);

  const restoredVerificationKeyRef = useRef('');

  const ownsContinuation = hasServiceContinuationMatch(
    searchParams,
    ELECTRICITY_SERVICE_CATEGORY,
    providerCode
  );

  const currentRegion = regions.find(
    (region) => region.Provider === providerCode
  );

  const resetForm = () => {
    setMeterNumber('');
    setMeterInfo(null);
    setAmount('');
    setError('');
    setIsVerified(false);
    setPaymentSuccess(false);
    setShowConfetti(false);
    setShowPinPrompt(false);
    setAlertKey(0);
    restoredVerificationKeyRef.current = '';
  };

  const toggleModal = () => {
    if (modalOpen) {
      resetForm();
      if (ownsContinuation) {
        setSearchParams(clearServiceContinuationSearch(searchParams), {
          replace: true,
        });
      }
    }

    setModalOpen((prev) => !prev);
  };

  const showServiceUnavailable = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onActivateView?.();
    setShowUnavailableModal(true);
  };

  const buildReturnTo = React.useCallback(() => {
    return buildServiceContinuationReturnTo({
      pathname: location.pathname,
      search: location.search,
      category: ELECTRICITY_SERVICE_CATEGORY,
      providerCode,
      values: {
        electricityMeter: meterNumber,
        electricityType: meterType,
        electricityAmount: amount,
      },
    });
  }, [
    amount,
    location.pathname,
    location.search,
    meterNumber,
    meterType,
    providerCode,
  ]);

  const redirectToAuthWithContinuation = React.useCallback(
    (targetPath = '/signup') => {
      const returnTo = buildReturnTo();
      setPendingAuthRedirect(returnTo);
      navigate(buildAuthNavigationTarget(targetPath, returnTo));
    },
    [buildReturnTo, navigate]
  );

  const fetchElectricityBeneficiaries = async () => {
    const user = getUser();
    if (!user?._id || !user?.token) return;

    try {
      const res = await axios.get(`/api/wallet/electricity-beneficiaries`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: networkTimeout,
      });

      if (res.data.success && Array.isArray(res.data.data)) {
        setElectricityBeneficiaries(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to load electricity beneficiaries:', err.message);
    }
  };

  const formatCurrency = (value) => {
    if (!value) return '';
    const num = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
    return Number.isNaN(num) ? '' : num.toLocaleString('en-NG');
  };

  const handleAmountChange = (event) => {
    const rawValue = event.target.value.replace(/[^0-9]/g, '');
    setAmount(rawValue);
  };

  useEffect(() => {
    setError('');
  }, [meterNumber]);

  useEffect(() => {
    setAlertKey((prev) => prev + 1);
  }, [error, isVerified]);

  const verifyMeter = async (meter = meterNumber) => {
    setError('');
    setIsVerified(false);
    setMeterInfo(null);
    setVerifying(true);

    const trimmed = String(meter || '').trim();
    if (!trimmed || trimmed.length < 10) {
      setError('Meter number must be at least 10 digits');
      setVerifying(false);
      return;
    }

    try {
      const response = await axios({
        method: 'get',
        url: `/api/purchase/catalog/validation/${encodeURIComponent(
          providerCode
        )}/${encodeURIComponent(trimmed)}`,
        timeout: networkTimeout,
      });
      const data = response.data;

      if (data.success && data.verified) {
        setIsVerified(true);
        setMeterInfo(data);
        setError('');
        toast.success('Meter verified successfully!');
      } else {
        const errorMessage =
          data.message || 'Invalid meter number or lookup failed';
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (err) {
      console.error(err);
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error ||
        'Meter lookup failed. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setVerifying(false);
    }
  };

  const proceedToPayment = async () => {
    const user = getUser();
    setError('');

    if (!user?.token) {
      redirectToAuthWithContinuation('/signup');
      return;
    }

    const numAmount = Number(amount);

    if (!numAmount || numAmount < 1000) {
      setError('Minimum amount is NGN 1,000');
      toast.error('Minimum amount is NGN 1,000');
      return;
    }

    if (!meterInfo) {
      setError('Please verify meter first');
      toast.error('Please verify meter first');
      return;
    }

    setShowPinPrompt(true);
  };

  const submitPayment = async (transactionPin) => {
    const user = getUser();
    setError('');
    setPaying(true);

    if (!user?.token) {
      setShowPinPrompt(false);
      setPaying(false);
      redirectToAuthWithContinuation('/signup');
      return;
    }

    const numAmount = Number(amount);

    try {
      const payload = {
        meter_number: meterNumber.trim(),
        provider_code: providerCode,
        amount: numAmount,
        meter_info: meterInfo,
        meter_type: meterType,
        transactionPin,
      };

      const response = await axios.post(
        `/api/purchase/purchase-electricity`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${user.token}`,
            'Content-Type': 'application/json',
          },
          timeout: networkTimeout,
        }
      );

      if (response.data.success) {
        clearPendingAuthRedirect();
        setShowPinPrompt(false);
        setPaymentSuccess(true);
        setShowConfetti(true);

        toast.success(`Payment Successful!`, {
          description: `NGN ${numAmount.toLocaleString()} has been paid to ${
            provider.provider_name || provider.name
          }`,
          duration: 5000,
        });
      } else {
        setShowPinPrompt(false);
        const errorMessage = response.data.message || 'Payment failed';
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (err) {
      setShowPinPrompt(false);
      const errorMessage = getFriendlyPurchaseErrorMessage(err);
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setPaying(false);
    }
  };

  useEffect(() => {
    if (modalOpen) {
      fetchElectricityBeneficiaries();
    }
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen && ownsContinuation) {
      onActivateView?.();
    }
  }, [modalOpen, onActivateView, ownsContinuation]);

  useEffect(() => {
    if (!modalOpen || !ownsContinuation || isVerified || verifying) {
      return;
    }

    const trimmedMeterNumber = meterNumber.trim();
    if (trimmedMeterNumber.length < 10) {
      return;
    }

    const verificationKey = `${providerCode}:${trimmedMeterNumber}:${meterType}`;
    if (restoredVerificationKeyRef.current === verificationKey) {
      return;
    }

    restoredVerificationKeyRef.current = verificationKey;
    void verifyMeter(trimmedMeterNumber);
  }, [
    isVerified,
    meterNumber,
    meterType,
    modalOpen,
    ownsContinuation,
    providerCode,
    verifying,
  ]);

  const providerImageUrl =
    provider.provider_image_url ||
    provider.logo_url ||
    `/img/${providerCode.toLowerCase()}-logo.png`;

  const getFallbackLogo = (code) => `/img/${code.toLowerCase()}-logo.png`;

  const cardId = `service-card-${toKebabAndLowercase(providerCode)}`;

  return (
    <>
      <CelebrationConfetti
        active={showConfetti}
        onComplete={() => setShowConfetti(false)}
      />

      <div
        className="other-services-card text-center position-relative"
        id={cardId}
        onClick={showServiceUnavailable}
        style={{ cursor: 'pointer' }}
      >
        <img
          src={providerImageUrl}
          alt={`${provider.provider_name || provider.name} logo`}
          className="mb-3"
          style={{ height: '70px', objectFit: 'contain' }}
          onError={(event) => {
            event.target.src = getFallbackLogo(providerCode);
          }}
        />
      </div>

      <Modal
        isOpen={modalOpen}
        toggle={toggleModal}
        centered
        size="md"
        backdrop="static"
      >
        <ModalHeader toggle={toggleModal}>
          <div className="d-flex align-items-center">
            <img
              src={providerImageUrl}
              alt={provider.provider_name || provider.name}
              style={{ width: '60px', marginRight: '15px' }}
              onError={(event) => {
                event.target.src = getFallbackLogo(providerCode);
              }}
            />
            <h5 className="mb-0">
              {provider.provider_name || provider.name} - Electricity
            </h5>
          </div>
        </ModalHeader>

        <ModalBody className="py-1 service-purchase-modal-body">
          {currentRegion && (
            <div className="mb-3">
              <small className="text-success fw-semibold">SERVING AREAS</small>
              <p
                className="text-success small mb-0 mt-1"
                style={{ lineHeight: '1.4' }}
              >
                {currentRegion.Region}
              </p>
            </div>
          )}

          {!paymentSuccess ? (
            <>
              <ElectricityMeterInput
                electricityBeneficiaries={electricityBeneficiaries}
                value={meterNumber}
                onChange={setMeterNumber}
                onSelect={(selected) => {
                  if (selected.length > 0) {
                    setMeterNumber(selected[0].meterNumber);
                  }
                }}
                provider={provider}
                verifyMeter={verifyMeter}
              />

              <FormGroup className="mt-3">
                <Label>Meter Type</Label>
                <Container>
                  <Row>
                    <Col>
                      <input
                        type="radio"
                        id="prepaid"
                        checked={meterType === 'prepaid'}
                        onChange={() => setMeterType('prepaid')}
                      />
                      <label htmlFor="prepaid" className="ms-2">
                        Prepaid
                      </label>
                    </Col>
                    <Col>
                      <input
                        type="radio"
                        id="postpaid"
                        checked={meterType === 'postpaid'}
                        onChange={() => setMeterType('postpaid')}
                      />
                      <label htmlFor="postpaid" className="ms-2">
                        Postpaid
                      </label>
                    </Col>
                  </Row>
                </Container>
              </FormGroup>

              <Button
                color="info"
                className="w-100 mb-3"
                outline={!isVerified}
                onClick={() => verifyMeter()}
                disabled={verifying || !meterNumber.trim()}
              >
                {verifying ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Verifying Meter...
                  </>
                ) : isVerified ? (
                  'Meter Verified'
                ) : (
                  'Verify Meter'
                )}
              </Button>

              <div key={alertKey}>
                {error && (
                  <Alert color="danger" className="mt-2">
                    {error}
                  </Alert>
                )}

                {isVerified && meterInfo && (
                  <Alert color="success" className="mt-3 text-start small">
                    <strong>Customer:</strong>{' '}
                    {removeLastNonWordChar(meterInfo.message) || 'Verified'}
                    <br />
                    {meterInfo.address && (
                      <>
                        <strong>Address:</strong> {meterInfo.address}
                        <br />
                      </>
                    )}
                    <strong>Type:</strong> {meterType.toUpperCase()} Meter
                  </Alert>
                )}
              </div>

              {isVerified && (
                <FormGroup className="mt-4">
                  <Label
                    htmlFor="amount"
                    className="small fw-semibold text-uppercase tracking-wider text-muted"
                  >
                    Transaction Amount
                  </Label>

                  <div className="position-relative">
                    <span
                      className="position-absolute top-50 start-0 translate-middle-y pl-3 pt-1 text-muted fw-bold"
                      style={{ zIndex: 10, fontSize: '1.25rem' }}
                    >
                      NGN
                    </span>

                    <Input
                      id="amount"
                      type="text"
                      value={formatCurrency(amount)}
                      onChange={handleAmountChange}
                      className="ps-5 py-3 fw-bold"
                      style={{
                        fontSize: '1.3rem',
                        borderRadius: '10px',
                        backgroundColor: '#f8f9fa',
                        border: '1px solid #ced4da',
                      }}
                    />
                  </div>

                  <div className="d-flex justify-content-between align-items-center mt-2">
                    <small className="text-muted">
                      Min:{' '}
                      <span className="fw-medium text-dark">NGN 1,000</span>
                    </small>
                    <small className="text-info" style={{ fontSize: '0.8rem' }}>
                      Instant token delivery
                    </small>
                  </div>
                </FormGroup>
              )}
            </>
          ) : (
            <div className="text-center py-5">
              <h3 className="text-success mb-3">Payment Successful!</h3>
              <p className="lead mb-3">
                Electricity bill payment completed successfully.
              </p>
              <Alert color="success">
                Token has been generated and will be sent to your registered
                phone number.
              </Alert>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {paymentSuccess ? (
            <Button
              color="success"
              onClick={toggleModal}
              className="w-100"
              size="lg"
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                color="info"
                onClick={proceedToPayment}
                disabled={
                  !isVerified || paying || !amount || Number(amount) < 1000
                }
                className="px-5"
                size="lg"
              >
                {paying ? (
                  <>
                    Processing <Spinner size="sm" className="ms-2" />
                  </>
                ) : (
                  `Pay NGN ${formatCurrency(amount) || '0'}`
                )}
              </Button>
              <Button color="secondary" onClick={toggleModal}>
                Cancel
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>

      <TransactionPinPrompt
        isOpen={showPinPrompt}
        onClose={() => setShowPinPrompt(false)}
        onConfirm={submitPayment}
        loading={paying}
        subtitle="Enter your 4-digit transaction PIN to buy electricity."
      />

      <Modal
        isOpen={showUnavailableModal}
        toggle={() => setShowUnavailableModal(false)}
        centered
        size="sm"
        backdrop="static"
        keyboard={false}
      >
        <ModalHeader toggle={() => setShowUnavailableModal(false)}>
          Service Temporarily Unavailable
        </ModalHeader>
        <ModalBody className="text-center py-4">
          <div className="mb-4">
            <i
              className="bi bi-clock-history text-warning"
              style={{ fontSize: '3.8rem' }}
            ></i>
          </div>
          <h5 className="mb-3">This service is currently unavailable</h5>
          <p className="text-muted mb-0 px-2">
            We're working to restore electricity bill payments.
            <br />
            Please try again after some time.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="primary"
            onClick={() => setShowUnavailableModal(false)}
            className="w-100"
            size="lg"
          >
            Okay, Got it
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

export default ElectricityServicesCard;
