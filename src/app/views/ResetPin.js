import React, { useEffect, useRef, useState } from 'react';
import {
  Container,
  Card,
  CardBody,
  Button,
  Navbar,
  Nav,
} from 'components/ui/primitives';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import Logo from '/img/logo.png';
import PinBoxes from '../components/PinBoxes/PinBoxes';
import { getUser, networkTimeout, updateUser } from '../../lib/helper';

function ResetPin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const pinRef = useRef(null);
  const confirmPinRef = useRef(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const idempotencyKeyRef = useRef(
    globalThis.crypto?.randomUUID?.() ||
      `reset-pin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  useEffect(() => {
    if (!token) {
      toast.error('Invalid PIN reset link. Please request a new one.');
      navigate('/forgot-pin');
    }
  }, [token, navigate]);

  const submitPinReset = async () => {
    if (pin.length !== 4 || confirmPin.length !== 4) {
      toast.error('Enter your new 4-digit PIN and confirm it');
      return;
    }

    if (pin !== confirmPin) {
      toast.error('PIN and confirm PIN do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        `/api/authentication/reset-pin/${token}`,
        {
          pin,
          confirmPin,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKeyRef.current,
          },
          timeout: networkTimeout,
        }
      );

      setSuccess(true);
      const currentUser = getUser();
      if (currentUser) {
        updateUser({ hasTransactionPin: true });
      }

      toast.success(
        response.data?.message || 'Transaction PIN reset successfully'
      );
      setTimeout(() => {
        navigate('/signin');
      }, 1800);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          'Invalid or expired PIN reset link. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar
        className="auth-navbar navbar-absolute navbar-transparent px-4 py-3"
        dark
      >
        <Nav tag="div" className="d-flex align-items-center me-auto">
          <img
            alt="logo"
            src={Logo}
            title="Kuku"
            style={{ height: 50, width: 50 }}
          />
        </Nav>
      </Navbar>

      <Container
        fluid
        className="auth-shell auth-standalone-shell d-flex align-items-center justify-content-center min-vh-100"
      >
        <div className="auth-standalone-frame">
          <Card className="auth-card auth-standalone-card border-0">
            <CardBody className="text-center">
              <div className="auth-card-header">
                <h3 className="auth-card-title">
                  {success ? 'PIN Updated!' : 'Reset Transaction PIN'}
                </h3>
                {!success ? (
                  <p className="auth-card-subtitle">
                    Enter your new 4-digit transaction PIN below.
                  </p>
                ) : null}
              </div>

              {success ? (
                <div className="py-4">
                  <i className="fas fa-check-circle fa-4x text-success mb-4"></i>
                  <p className="text-muted">
                    Your transaction PIN has been reset successfully.
                  </p>
                  <p className="text-muted small">Redirecting to sign in...</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <div className="mb-2 fw-bold">New PIN</div>
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
                      onComplete={submitPinReset}
                    />
                  </div>

                  <div className="d-flex gap-2 justify-content-center flex-wrap">
                    <Button
                      color="primary"
                      onClick={submitPinReset}
                      disabled={loading}
                    >
                      {loading ? 'Updating...' : 'Set New PIN'}
                    </Button>
                    <Button
                      color="secondary"
                      outline
                      onClick={() => navigate('/signin')}
                      disabled={loading}
                    >
                      Back to Sign In
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </Container>
    </>
  );
}

export default ResetPin;
