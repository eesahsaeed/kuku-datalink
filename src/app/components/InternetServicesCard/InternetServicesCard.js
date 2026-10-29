import React, { useEffect, useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Label,
  FormGroup,
  Alert,
  Spinner,
} from 'components/ui/primitives';
import { KukuTooltipTrigger } from 'components/ui/Tooltip';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildAuthNavigationTarget,
  clearPendingAuthRedirect,
  getUser,
  normalizeNigerianPhoneNumber,
  normalizePhoneInputValue,
  networkTimeout,
  setPendingAuthRedirect,
  toKebabAndLowercase,
} from '../../../lib/helper';
import axios from 'axios';
import { getFriendlyPurchaseErrorMessage } from '../../utils/purchaseErrors';
import {
  buildServiceContinuationReturnTo,
  clearServiceContinuationSearch,
  hasServiceContinuationMatch,
} from '../../utils/serviceContinuation';

const INTERNET_SERVICE_CATEGORY = 'internet';

function InternetServicesCard({ provider, onActivateView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialContinuationMatch = hasServiceContinuationMatch(
    searchParams,
    INTERNET_SERVICE_CATEGORY,
    provider.provider_code
  );
  const [modalOpen, setModalOpen] = useState(initialContinuationMatch);

  const [phoneNumber, setPhoneNumber] = useState(
    initialContinuationMatch
      ? String(searchParams.get('internetPhone') || '')
      : ''
  );
  const [selectedPlan, setSelectedPlan] = useState(
    initialContinuationMatch
      ? String(searchParams.get('internetPlan') || '')
      : ''
  );
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const ownsContinuation = hasServiceContinuationMatch(
    searchParams,
    INTERNET_SERVICE_CATEGORY,
    provider.provider_code
  );

  const buildReturnTo = () => {
    return buildServiceContinuationReturnTo({
      pathname: location.pathname,
      search: location.search,
      category: INTERNET_SERVICE_CATEGORY,
      providerCode: provider.provider_code,
      values: {
        internetPhone: phoneNumber,
        internetPlan: selectedPlan,
      },
    });
  };

  const redirectToAuthWithContinuation = (targetPath = '/signup') => {
    const returnTo = buildReturnTo();
    setPendingAuthRedirect(returnTo);
    navigate(buildAuthNavigationTarget(targetPath, returnTo));
  };

  const toggleModal = () => {
    if (!modalOpen) {
      onActivateView?.();
    }

    if (modalOpen) {
      setPhoneNumber('');
      setSelectedPlan('');
      setError('');
    }
    if (modalOpen && ownsContinuation) {
      setSearchParams(clearServiceContinuationSearch(searchParams), {
        replace: true,
      });
    }
    setModalOpen((prev) => !prev);
  };

  const cardId = `internet-card-${toKebabAndLowercase(provider.provider_code)}`;

  const proceedToPayment = async () => {
    const user = getUser();
    setError('');
    const normalizedPhoneNumber = normalizeNigerianPhoneNumber(phoneNumber);

    if (!normalizedPhoneNumber) {
      setError(
        'Enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....'
      );
      return;
    }
    if (!selectedPlan) {
      setError('Please select a data plan');
      return;
    }

    if (!user?.token) {
      redirectToAuthWithContinuation('/signup');
      return;
    }

    setPaying(true);

    try {
      const payload = {
        provider_code: provider.provider_code,
        phone_number: normalizedPhoneNumber,
        plan_code: selectedPlan,
      };

      const response = await axios.post(
        '/api/purchase/purchase-data',
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
        alert('Data bundle purchased successfully!');
        toggleModal();
      } else {
        setError(response.data.message || 'Purchase failed');
      }
    } catch (err) {
      setError(getFriendlyPurchaseErrorMessage(err));
    } finally {
      setPaying(false);
    }
  };

  useEffect(() => {
    if (modalOpen && ownsContinuation) {
      onActivateView?.();
    }
  }, [modalOpen, onActivateView, ownsContinuation]);

  return (
    <>
      <KukuTooltipTrigger
        content={`${provider.provider_name} - Buy Data`}
        placement="top"
      >
        <div
          className="other-services-card text-center border rounded position-relative"
          id={cardId}
          onClick={toggleModal}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleModal();
            }
          }}
        >
          <img
            src={provider.provider_image_url}
            alt={`${provider.provider_name} logo`}
            className="mb-3"
            style={{ height: '70px', objectFit: 'contain' }}
          />
        </div>
      </KukuTooltipTrigger>

      <Modal isOpen={modalOpen} toggle={toggleModal} centered size="md">
        <ModalHeader toggle={toggleModal}>
          <div className="d-flex align-items-center">
            <img
              src={provider.provider_image_url}
              alt={provider.provider_name}
              style={{ width: '60px', marginRight: '15px' }}
            />
            <h5 className="mb-0">Buy {provider.provider_name} Data</h5>
          </div>
        </ModalHeader>

        <ModalBody>
          <FormGroup>
            <Label for="phone">Phone Number</Label>
            <Input
              id="phone"
              placeholder="e.g. 08031234567, 8031234567, or 2348031234567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(normalizePhoneInputValue(e.target.value))}
              maxLength="15"
            />
          </FormGroup>

          <FormGroup>
            <Label>Select Data Plan</Label>
            <Input
              type="select"
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
            >
              <option value="">Choose a plan...</option>
              <option value="daily_1gb">1GB Daily - ₦300</option>
              <option value="weekly_2gb">2GB Weekly - ₦500</option>
              <option value="monthly_10gb">10GB Monthly - ₦3,000</option>
              <option value="monthly_20gb">20GB Monthly - ₦5,000</option>
              {/* Add more plans dynamically if available from API */}
            </Input>
          </FormGroup>

          {error && (
            <Alert color="danger" className="small mt-2">
              {error}
            </Alert>
          )}
        </ModalBody>

        <ModalFooter>
          <Button
            color="info"
            onClick={proceedToPayment}
            disabled={
              paying ||
              !normalizeNigerianPhoneNumber(phoneNumber) ||
              !selectedPlan
            }
          >
            {paying ? (
              <>
                Processing <Spinner size="sm"> </Spinner>
              </>
            ) : (
              'Buy Data'
            )}
          </Button>
          <Button color="secondary" onClick={toggleModal}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

export default InternetServicesCard;
