import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Container,
} from 'components/ui/primitives';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  buildAuthNavigationTarget,
  getAuthReturnTo,
  getUser,
  networkTimeout,
  resolvePostAuthRedirect,
  signout,
  updateUser,
} from '../../lib/helper';
import PinBoxes from 'components/PinBoxes/PinBoxes';

const PIN_LENGTH = 4;

function SetupPin() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getUser();
  const returnTo = getAuthReturnTo(location.search);
  const pinRef = useRef(null);
  const confirmPinRef = useRef(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentUser?.isAuthenticated && currentUser?.token) {
      return;
    }

    navigate(buildAuthNavigationTarget('/signin', returnTo), {
      replace: true,
    });
  }, [currentUser?.isAuthenticated, currentUser?.token, navigate, returnTo]);

  const authHeaders = useMemo(() => {
    if (!currentUser?.token) return {};
    return { Authorization: `Bearer ${currentUser.token}` };
  }, [currentUser?.token]);

  const submitPin = async () => {
    if (pin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH) {
      toast.error('Enter your 4-digit PIN and confirm it');
      return;
    }

    if (pin !== confirmPin) {
      toast.error('PIN and confirm PIN do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        '/api/authentication/set-pin',
        {
          pin,
          confirmPin,
        },
        {
          headers: authHeaders,
          timeout: networkTimeout,
        }
      );

      const nextUser =
        updateUser({
          ...(response.data?.user || {}),
          hasTransactionPin: true,
          pinSetupRequired: false,
        }) || getUser();
      toast.success(response.data?.message || 'PIN set successfully');

      navigate(resolvePostAuthRedirect(nextUser, returnTo), { replace: true });
    } catch (error) {
      const statusCode = Number(error.response?.status || 0);
      const errorMessage = error.response?.data?.message || 'Could not set PIN';

      if (
        statusCode === 401 &&
        /token|authoriz|access denied/i.test(errorMessage)
      ) {
        toast.error('Your session has expired. Please sign in again.');
        localStorage.removeItem('user');
        navigate(buildAuthNavigationTarget('/signin', returnTo), {
          replace: true,
        });
        return;
      }

      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <Container
        fluid
        className="d-flex align-items-center justify-content-center min-vh-100"
      >
        <Card className="auth-card auth-pin-card">
          <CardBody className="text-center">
            <div className="auth-card-header">
              <div className="auth-header-badge mx-auto">
                <i className="fas fa-key" />
                Security step
              </div>
              <h2 className="auth-card-title">Set your 4-digit PIN</h2>
              <p className="auth-card-subtitle">
                This PIN will be required before purchases can be completed from
                your wallet.
              </p>
            </div>

            <div className="auth-info-panel mb-4 text-start">
              <strong className="d-block mb-1">
                Keep it memorable and private
              </strong>
              <p className="mb-0">
                Your transaction PIN is checked securely on the server and is
                never kept in local storage.
              </p>
            </div>

            <div className="mb-4">
              <div className="mb-2 fw-bold">PIN</div>
              <PinBoxes
                ref={pinRef}
                value={pin}
                onChange={setPin}
                disabled={loading}
                onComplete={() => confirmPinRef.current?.focus()}
              />
            </div>

            <div className="mb-4">
              <div className="mb-2 fw-bold">Confirm PIN</div>
              <PinBoxes
                ref={confirmPinRef}
                value={confirmPin}
                onChange={setConfirmPin}
                disabled={loading}
                onComplete={submitPin}
              />
            </div>

            <div
              className="d-flex justify-content-center flex-wrap"
              style={{ gap: 5 }}
            >
              <Button color="primary" onClick={submitPin} disabled={loading}>
                {loading ? 'Saving...' : 'Save PIN'}
              </Button>
              <Button color="danger" onClick={signout} disabled={loading}>
                Sign Out
              </Button>
            </div>
          </CardBody>
        </Card>
      </Container>
    </div>
  );
}

export default SetupPin;
