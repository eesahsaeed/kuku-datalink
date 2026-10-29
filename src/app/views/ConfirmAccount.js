import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Container,
  Input,
  Label,
} from 'components/ui/primitives';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import PinBoxes from '../components/PinBoxes/PinBoxes';
import {
  buildAuthNavigationTarget,
  getAuthReturnTo,
  networkTimeout,
  getUser,
  updateUser,
} from '../../lib/helper';

function ConfirmAccount() {
  const RESEND_COOLDOWN_SECONDS = 60;
  const RESEND_STORAGE_KEY = 'confirm_account_resend_available_at';
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getUser();
  const returnTo = getAuthReturnTo(location.search);
  const [emailAddress, setEmailAddress] = useState(
    currentUser?.emailAddress || ''
  );
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const hasSignedInSession = Boolean(
    currentUser?.isAuthenticated && currentUser?.token
  );

  const authHeaders = useMemo(() => {
    if (!currentUser?.token) return {};
    return { Authorization: `Bearer ${currentUser.token}` };
  }, [currentUser?.token]);

  useEffect(() => {
    try {
      const storedAvailableAt = Number(
        sessionStorage.getItem(RESEND_STORAGE_KEY) || 0
      );

      if (storedAvailableAt > Date.now()) {
        const remainingSeconds = Math.ceil(
          (storedAvailableAt - Date.now()) / 1000
        );
        setCooldownSeconds(Math.max(remainingSeconds, 0));
      }
    } catch (error) {
      console.error('Failed to restore resend cooldown:', error);
    }
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setCooldownSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (cooldownSeconds > 0) return;

    try {
      sessionStorage.removeItem(RESEND_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear resend cooldown:', error);
    }
  }, [cooldownSeconds]);

  const resendVerification = async () => {
    if (!emailAddress.trim()) {
      toast.error('Enter your email address first');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        '/api/authentication/resend-verification',
        { emailAddress: emailAddress.trim().toLowerCase() },
        {
          headers: authHeaders,
          timeout: networkTimeout,
        }
      );
      const availableAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
      try {
        sessionStorage.setItem(RESEND_STORAGE_KEY, String(availableAt));
      } catch (error) {
        console.error('Failed to persist resend cooldown:', error);
      }
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      toast.success(response.data?.message || 'Verification code sent');
    } catch (error) {
      toast.error(
        error.response?.data?.message || 'Could not resend verification code'
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!emailAddress.trim()) {
      toast.error('Enter your email address first');
      return;
    }

    if (code.length !== 6) {
      toast.error('Enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        '/api/authentication/verify-email-code',
        {
          emailAddress: emailAddress.trim().toLowerCase(),
          code,
        },
        {
          timeout: networkTimeout,
        }
      );

      if (hasSignedInSession) {
        updateUser({
          ...(response.data?.user || {}),
          emailVerified: true,
          emailVerificationRequired: false,
        });
      }

      toast.success(response.data?.message || 'Email confirmed successfully');
      navigate(
        hasSignedInSession
          ? buildAuthNavigationTarget('/setup-pin', returnTo)
          : buildAuthNavigationTarget('/signin', returnTo),
        { replace: true }
      );
    } catch (error) {
      toast.error(
        error.response?.data?.message || 'Could not verify email code'
      );
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
          <CardBody>
            <div className="auth-card-header text-center">
              <div className="auth-header-badge mx-auto">
                <i className="fas fa-envelope-open-text" />
                Email verification
              </div>
              <h2 className="auth-card-title">Confirm your email</h2>
              <p className="auth-card-subtitle">
                Enter the 6-digit code we sent to your inbox before you continue
                {hasSignedInSession ? ' to PIN setup.' : ' to sign in.'}
              </p>
            </div>

            <div className="auth-email-verification-panel mb-4">
              <div className="auth-email-verification-icon">
                <i className="fas fa-envelope-open-text" />
              </div>
              <div className="auth-email-verification-copy">
                <p className="auth-email-verification-text mb-1">
                  We&apos;ve sent a 6-digit verification code to your email
                  address. Enter it below to verify and activate your account.
                </p>
                <p className="auth-email-verification-note mb-0">
                  If you don&apos;t see the message, please check your Spam,
                  Junk, or Promotions folders.
                  {!hasSignedInSession
                    ? ' After verification, sign in to continue with PIN setup.'
                    : ''}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <Label>Email Address</Label>
              <Input
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
              />
            </div>

            <div className="mb-4 text-center">
              <Label className="mb-3 d-block">Verification Code</Label>
              <PinBoxes
                value={code}
                onChange={setCode}
                disabled={loading}
                length={6}
                onComplete={verifyCode}
              />
            </div>

            <div className="auth-action-row auth-action-row-center">
              <Button color="primary" onClick={verifyCode} disabled={loading}>
                {loading ? 'Verifying...' : 'Verify Email'}
              </Button>
              <Button
                color="secondary"
                outline
                onClick={resendVerification}
                disabled={loading || cooldownSeconds > 0}
              >
                {cooldownSeconds > 0
                  ? `Resend Code In ${cooldownSeconds}s`
                  : 'Resend Code'}
              </Button>
              <Button
                color="secondary"
                outline
                onClick={() => navigate('/signin')}
              >
                Back to Sign In
              </Button>
            </div>

            {cooldownSeconds > 0 ? (
              <p className="text-muted small mt-3 mb-0 text-center">
                You can request another code in {cooldownSeconds} seconds.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </Container>
    </div>
  );
}

export default ConfirmAccount;
