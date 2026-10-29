import React, { useEffect, useState, useRef } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Label,
  FormGroup,
  FormFeedback,
  Spinner,
  Alert,
} from 'components/ui/primitives';
import axios from 'axios';
import { toast } from 'sonner';
import CelebrationConfetti from 'components/CelebrationConfetti/CelebrationConfetti';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import {
  buildAuthNavigationTarget,
  toKebabAndLowercase,
  clearPendingAuthRedirect,
  findTvPackageByCode,
  setPendingAuthRedirect,
  trimEndSpecialChars,
  formatToNaira,
  getUser,
  networkTimeout,
} from '../../../lib/helper';
import { getFriendlyPurchaseErrorMessage } from '../../utils/purchaseErrors';
import SmartCardInput from 'components/SmartCardInput/SmartCardInput';
import TransactionPinPrompt from '../TransactionPinPrompt/TransactionPinPrompt';
import {
  buildServiceContinuationReturnTo,
  clearServiceContinuationSearch,
  hasServiceContinuationMatch,
} from '../../utils/serviceContinuation';

const TV_SERVICE_CATEGORY = 'tv';

function TvServicesCard({ provider, onActivateView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialContinuationMatch = hasServiceContinuationMatch(
    searchParams,
    TV_SERVICE_CATEGORY,
    provider.provider_code
  );
  const initialSmartCardNumber = initialContinuationMatch
    ? String(searchParams.get('tvSmartCard') || '')
    : '';
  const initialSelectedPackage = initialContinuationMatch
    ? String(searchParams.get('tvPackage') || '')
    : '';

  const [modalOpen, setModalOpen] = useState(initialContinuationMatch);

  // Form states
  const [smartCardNumber, setSmartCardNumber] = useState(
    initialSmartCardNumber
  );
  const [customerInfo, setCustomerInfo] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const [selectedPackage, setSelectedPackage] = useState(
    initialSelectedPackage
  );
  const [selectedPackageInfo, setSelectedPackageInfo] = useState({});
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const [packages, setPackages] = useState([]);
  const [showConfetti, setShowConfetti] = useState(false);

  // TV Beneficiaries for Typeahead
  const [tvBeneficiaries, setTvBeneficiaries] = useState([]);
  const [, setSelectedBeneficiary] = useState([]);
  const [showPinPrompt, setShowPinPrompt] = useState(false);

  const modalBodyRef = useRef(null);
  const restoredVerificationKeyRef = useRef('');

  const resetForm = () => {
    setSmartCardNumber('');
    setCustomerInfo(null);
    setVerifyError('');
    setSelectedPackage('');
    setSelectedPackageInfo({});
    setPaymentError('');
    setPaymentSuccess(false);
    setShowConfetti(false);
    setSelectedBeneficiary([]);
    restoredVerificationKeyRef.current = '';
  };

  const toggleModal = () => {
    if (!modalOpen) {
      onActivateView?.();
    }

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

  const cardId = `tv-card-${toKebabAndLowercase(provider.provider_code)}`;
  const ownsContinuation = hasServiceContinuationMatch(
    searchParams,
    TV_SERVICE_CATEGORY,
    provider.provider_code
  );

  const buildReturnTo = React.useCallback(() => {
    return buildServiceContinuationReturnTo({
      pathname: location.pathname,
      search: location.search,
      category: TV_SERVICE_CATEGORY,
      providerCode: provider.provider_code,
      values: {
        tvSmartCard: smartCardNumber,
        tvPackage: selectedPackage,
      },
    });
  }, [
    location.pathname,
    location.search,
    provider.provider_code,
    selectedPackage,
    smartCardNumber,
  ]);

  const redirectToAuthWithContinuation = React.useCallback(
    (targetPath = '/signup') => {
      const returnTo = buildReturnTo();
      setPendingAuthRedirect(returnTo);
      navigate(buildAuthNavigationTarget(targetPath, returnTo));
    },
    [buildReturnTo, navigate]
  );

  // Fetch user's saved TV beneficiaries
  const fetchTvBeneficiaries = async () => {
    const user = getUser();
    if (!user?._id || !user?.token) return;

    try {
      const res = await axios.get(`/api/wallet/tv-beneficiaries`, {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
        timeout: networkTimeout,
      });

      if (res.data.success && Array.isArray(res.data.data)) {
        setTvBeneficiaries(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to load TV beneficiaries:', err.message);
    }
  };

  // Verify Smart Card
  const verifySmartCard = async () => {
    setVerifyError('');
    setVerifying(true);

    const trimmed = smartCardNumber.trim();
    if (!trimmed || trimmed.length < 10) {
      setVerifyError('Smart card / IUC number must be at least 10 digits');
      setVerifying(false);
      return;
    }

    try {
      const config = {
        method: 'get',
        url: `/api/purchase/catalog/validation/${encodeURIComponent(
          provider.provider_code
        )}/${encodeURIComponent(trimmed)}`,
        timeout: networkTimeout,
      };

      const response = await axios(config);
      const data = response.data;

      if (data.success && data.verified) {
        setCustomerInfo(data);
        setVerifyError('');
      } else {
        setVerifyError(data.message || 'Invalid smart card number');
        setCustomerInfo(null);
      }
    } catch (err) {
      setVerifyError(
        err.response?.data?.message || 'Verification failed. Please try again.'
      );
      setCustomerInfo(null);
    } finally {
      setVerifying(false);
    }
  };

  const verifySmartCardArgument = async (iucNumber) => {
    setVerifyError('');
    setVerifying(true);

    const trimmed = iucNumber.trim();
    if (!trimmed || trimmed.length < 10) {
      setVerifyError('Smart card / IUC number must be at least 10 digits');
      setVerifying(false);
      return;
    }

    try {
      const config = {
        method: 'get',
        url: `/api/purchase/catalog/validation/${encodeURIComponent(
          provider.provider_code
        )}/${encodeURIComponent(trimmed)}`,
        timeout: networkTimeout,
      };

      const response = await axios(config);
      const data = response.data;

      if (data.success && data.verified) {
        setCustomerInfo(data);
        setVerifyError('');
      } else {
        setVerifyError(data.message || 'Invalid smart card number');
        setCustomerInfo(null);
      }
    } catch (err) {
      setVerifyError(
        err.response?.data?.message || 'Verification failed. Please try again.'
      );
      setCustomerInfo(null);
    } finally {
      setVerifying(false);
    }
  };

  // Handle Typeahead selection (existing beneficiary or new input)
  const handleBeneficiarySelect = (selected) => {
    setSelectedBeneficiary(selected);

    if (selected.length > 0) {
      const option = selected[0];

      if (option && typeof option === 'object' && option.smartCardNumber) {
        // Existing saved beneficiary
        setSmartCardNumber(option.smartCardNumber);
      } else if (typeof option === 'string') {
        // New input from user typing
        const trimmed = option.trim();
        // Only accept if it looks like a valid IUC length (10 or 11 digits)
        if (/^\d{10,11}$/.test(trimmed)) {
          setSmartCardNumber(trimmed);
        } else {
          // Clear invalid new entry
          setSmartCardNumber('');
        }
      }
    } else {
      setSmartCardNumber('');
    }
  };

  const proceedToPayment = async () => {
    const user = getUser();
    const trimmed = smartCardNumber.trim();

    if (!user?.token) {
      redirectToAuthWithContinuation('/signup');
      return;
    }

    if (!selectedPackage) {
      setPaymentError('Please select a subscription package');
      return;
    }

    if (!trimmed || trimmed.length < 10) {
      setPaymentError('Valid smart card number (10-11 digits) is required');
      return;
    }

    setPaymentError('');
    setShowPinPrompt(true);
  };

  const submitPayment = async (transactionPin) => {
    const user = getUser();
    const trimmed = smartCardNumber.trim();
    setPaymentError('');
    setPaying(true);

    if (!user?.token) {
      setShowPinPrompt(false);
      setPaying(false);
      redirectToAuthWithContinuation('/signup');
      return;
    }

    try {
      const payload = {
        provider_code: provider.provider_code,
        smart_card_number: trimmed,
        package_code: selectedPackage,
        customer_info: customerInfo,
        package_amount: selectedPackageInfo.package_original_amount || 0,
        transactionPin,
      };

      const response = await axios.post('/api/purchase/purchase-tv', payload, {
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json',
        },
        timeout: networkTimeout,
      });

      if (response.data.success) {
        clearPendingAuthRedirect();
        setShowPinPrompt(false);
        setPaymentSuccess(true);
        setShowConfetti(true);
        toast.success(
          `Subscription successful! ${customerInfo?.customer_name || ''}`
        );
      } else {
        setShowPinPrompt(false);
        setPaymentError(response.data.message || 'Payment failed');
      }
    } catch (err) {
      setShowPinPrompt(false);
      setPaymentError(getFriendlyPurchaseErrorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  // Fetch packages and beneficiaries when modal opens
  useEffect(() => {
    async function fetchPlans() {
      try {
        const pConfig = {
          method: 'get',
          url: `/api/purchase/catalog/packages/${encodeURIComponent(
            provider.provider_code
          )}`,
          timeout: networkTimeout,
        };

        const pResponse = await axios(pConfig);
        const pData = pResponse.data;

        if (pData.success && pData.message === 'success') {
          setPackages(pData.data || []);
        }
      } catch (err) {
        console.error('Error fetching TV packages:', err);
      }
    }

    if (modalOpen) {
      fetchPlans();
      fetchTvBeneficiaries();
    }
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen && ownsContinuation) {
      onActivateView?.();
    }
  }, [modalOpen, onActivateView, ownsContinuation]);

  useEffect(() => {
    if (!selectedPackage) {
      setSelectedPackageInfo({});
      return;
    }

    setSelectedPackageInfo(
      findTvPackageByCode(packages, selectedPackage) || {}
    );
  }, [packages, selectedPackage]);

  useEffect(() => {
    if (!modalOpen || !ownsContinuation || customerInfo || verifying) {
      return;
    }

    const trimmedSmartCardNumber = smartCardNumber.trim();

    if (trimmedSmartCardNumber.length < 10) {
      return;
    }

    const verificationKey = `${provider.provider_code}:${trimmedSmartCardNumber}`;
    if (restoredVerificationKeyRef.current === verificationKey) {
      return;
    }

    restoredVerificationKeyRef.current = verificationKey;
    void verifySmartCardArgument(trimmedSmartCardNumber);
  }, [
    customerInfo,
    modalOpen,
    ownsContinuation,
    provider.provider_code,
    smartCardNumber,
    verifying,
  ]);

  const isVerified = !!customerInfo;
  const canVerify = smartCardNumber.trim().length >= 10 && !verifying;

  return (
    <>
      <CelebrationConfetti
        active={showConfetti}
        onComplete={() => setShowConfetti(false)}
      />

      <div
        className="other-services-card text-center position-relative"
        id={cardId}
        onClick={toggleModal}
        style={{ cursor: 'pointer' }}
      >
        <img
          src={provider.provider_image_url}
          alt={`${provider.provider_name} logo`}
          className="mb-3"
          style={{ height: '70px', objectFit: 'contain' }}
        />
      </div>

      <Modal
        isOpen={modalOpen}
        toggle={toggleModal}
        backdrop="static"
        centered
        size="md"
        keyboard={false}
      >
        <ModalHeader toggle={toggleModal}>
          <div className="d-flex align-items-center">
            <img
              src={provider.provider_image_url}
              alt={provider.provider_name}
              style={{ width: '60px', marginRight: '15px' }}
            />
            <h5 className="mb-0">{provider.provider_name} Subscription</h5>
          </div>
        </ModalHeader>

        <ModalBody
          className="service-purchase-modal-body"
          ref={modalBodyRef}
          style={{
            position: 'relative',
            minHeight: '420px',
          }}
        >
          {!paymentSuccess ? (
            <>
              <SmartCardInput
                tvBeneficiaries={tvBeneficiaries}
                onSelect={handleBeneficiarySelect}
                onChange={setSmartCardNumber}
                provider={provider.provider_code}
                verifySmartCard={verifySmartCardArgument}
              />

              {/* Verify Button */}
              <FormGroup>
                <Button
                  color="info"
                  style={{ zIndex: 100 }}
                  outline={!isVerified}
                  className="w-100"
                  onClick={verifySmartCard}
                  disabled={!canVerify}
                >
                  {verifying ? (
                    <>
                      <Spinner size="sm" className="me-2">
                        {' '}
                      </Spinner>
                      Verifying...
                    </>
                  ) : isVerified ? (
                    'Verified ✓'
                  ) : (
                    'Verify Customer'
                  )}
                </Button>

                {verifyError && (
                  <FormFeedback className="d-block text-danger mt-1">
                    {verifyError}
                  </FormFeedback>
                )}
              </FormGroup>

              {/* Customer Info */}
              {isVerified && customerInfo && (
                <Alert color="success" className="small">
                  <strong>Customer:</strong>{' '}
                  {customerInfo.customer_name || customerInfo.message}
                  {customerInfo.due_date && (
                    <>
                      <br />
                      <strong>Due Date:</strong> {customerInfo.due_date}
                    </>
                  )}
                  <br />
                  <strong>Status:</strong> Active
                </Alert>
              )}

              {/* Package Selection */}
              <FormGroup className="mt-4">
                <Label className="mb-2">Select Subscription Package</Label>
                <Input
                  type="select"
                  value={selectedPackage}
                  style={{ zIndex: 100, position: 'relative' }}
                  onChange={(e) => {
                    const pkgCode = e.target.value;
                    setSelectedPackage(pkgCode);
                    setSelectedPackageInfo(
                      findTvPackageByCode(packages, pkgCode) || {}
                    );
                  }}
                >
                  <option value="">Choose subscription plan...</option>
                  {packages.map((p, i) => (
                    <option
                      value={p.package_api_code}
                      key={p.package_api_code || i}
                    >
                      {trimEndSpecialChars(p.package_name)}
                    </option>
                  ))}
                </Input>
              </FormGroup>

              {/* Package Details */}
              {selectedPackageInfo && selectedPackageInfo.package_name && (
                <Alert color="info">
                  <div>
                    <strong>Package: </strong>
                    {trimEndSpecialChars(selectedPackageInfo.package_name)}
                  </div>
                  <div>
                    <strong>Price: </strong>
                    {formatToNaira(selectedPackageInfo.package_original_amount)}
                  </div>
                </Alert>
              )}

              {paymentError && (
                <Alert color="danger" className="mt-3">
                  {paymentError}
                </Alert>
              )}
            </>
          ) : (
            /* Success Screen */
            <div className="text-center py-5">
              <h3 className="text-success mb-3">✓ Payment Successful!</h3>
              <p className="lead mb-2">
                Subscription renewed successfully for:
              </p>
              <p className="fw-bold mb-1">
                {customerInfo?.customer_name || 'Valued Customer'}
              </p>
              <p className="text-muted mb-4">
                {trimEndSpecialChars(selectedPackageInfo.package_name)}
              </p>

              <Alert color="success" className="mb-4">
                Your payment has been processed successfully.
                <br />
                Thank you for subscribing with {provider.provider_name}!
              </Alert>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          {paymentSuccess ? (
            <Button
              color="success"
              style={{ zIndex: 100 }}
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
                style={{ zIndex: 100 }}
                onClick={proceedToPayment}
                disabled={
                  !isVerified ||
                  paying ||
                  !selectedPackage ||
                  !smartCardNumber ||
                  smartCardNumber.length < 10
                }
                className="px-5"
              >
                {paying ? (
                  <>
                    Processing
                    <Spinner size="sm" className="ms-2">
                      {' '}
                    </Spinner>
                  </>
                ) : (
                  'Pay Now'
                )}
              </Button>
              <Button
                color="secondary"
                onClick={toggleModal}
                style={{ zIndex: 100 }}
              >
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
        subtitle="Enter your 4-digit transaction PIN to renew this TV subscription."
      />
    </>
  );
}

export default TvServicesCard;
