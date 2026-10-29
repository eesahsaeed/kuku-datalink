import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  Container,
} from 'components/ui/primitives';

import Logo from '/img/logo.png';

function ResetPasswordLanding() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [hasAttemptedOpen, setHasAttemptedOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const mobileUrl = useMemo(
    () => `kukumobile://reset-password/${token || ''}`,
    [token]
  );
  const webResetUrl = useMemo(
    () => `/reset-password/${token || ''}?fromLanding=1`,
    [token]
  );

  useEffect(() => {
    if (!token) {
      navigate('/forgot-password', { replace: true });
      return;
    }

    const attemptTimer = window.setTimeout(() => {
      setHasAttemptedOpen(true);
      window.location.href = mobileUrl;
    }, 300);

    const fallbackTimer = window.setTimeout(() => {
      setShowFallback(true);
    }, 1800);

    return () => {
      window.clearTimeout(attemptTimer);
      window.clearTimeout(fallbackTimer);
    };
  }, [mobileUrl, navigate, token]);

  return (
    <Container
      className="auth-shell auth-standalone-shell d-flex align-items-center justify-content-center min-vh-100"
      fluid
    >
      <div className="auth-standalone-frame">
        <Card className="auth-card auth-standalone-card border-0">
          <CardBody>
            <div className="d-flex align-items-center gap-3 mb-4">
              <img
                alt="Kuku"
                src={Logo}
                style={{ width: 56, height: 56, objectFit: 'contain' }}
              />
              <div>
                <p
                  className="mb-1 text-uppercase fw-bold"
                  style={{
                    letterSpacing: '0.08em',
                    color: '#0E3B88',
                    fontSize: '0.8rem',
                  }}
                >
                  Password Reset
                </p>
                <h2
                  className="mb-0"
                  style={{ color: '#071B4D', fontWeight: 800 }}
                >
                  Open in Kuku Mobile
                </h2>
              </div>
            </div>

            <p className="text-muted mb-3" style={{ lineHeight: 1.7 }}>
              We are trying to open your reset link in the Kuku mobile app. If
              the app does not open automatically, you can continue in your
              browser instead.
            </p>

            <div className="auth-callout-panel mb-4">
              <p className="mb-2 fw-semibold" style={{ color: '#071B4D' }}>
                Reset token detected
              </p>
              <p className="mb-0 text-muted" style={{ wordBreak: 'break-all' }}>
                {token}
              </p>
            </div>

            <div className="d-grid gap-3">
              <Button
                color="primary"
                size="lg"
                style={{
                  borderRadius: '999px',
                  fontWeight: 700,
                }}
                onClick={() => {
                  setHasAttemptedOpen(true);
                  window.location.href = mobileUrl;
                }}
              >
                Open Kuku Mobile
              </Button>

              <Button
                color="primary"
                outline
                size="lg"
                style={{ borderRadius: '999px', fontWeight: 700 }}
                onClick={() => navigate(webResetUrl)}
              >
                Continue on Web
              </Button>
            </div>

            {hasAttemptedOpen || showFallback ? (
              <p
                className="mt-4 mb-0 text-muted small"
                style={{ lineHeight: 1.7 }}
              >
                If nothing happens, your device may not have the Kuku mobile app
                installed yet. The web reset page is ready as a fallback.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </Container>
  );
}

export default ResetPasswordLanding;
