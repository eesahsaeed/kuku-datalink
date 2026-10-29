import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Container,
  Spinner,
} from 'components/ui/primitives';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  buildAuthNavigationTarget,
  getAuthReturnTo,
  getUser,
  networkTimeout,
  resolvePostAuthRedirect,
  updateUser,
} from '../../lib/helper';

function ConfirmEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useParams();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('Verifying your email...');
  const currentUser = getUser();
  const hasSignedInSession = Boolean(
    currentUser?.isAuthenticated && currentUser?.token
  );
  const returnTo = getAuthReturnTo(location.search);
  const cameFromLanding =
    new URLSearchParams(location.search).get('fromLanding') === '1';

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        const response = await axios.get(
          `/api/authentication/verify-email/${token}`,
          {
            timeout: networkTimeout,
          }
        );

        const verifiedUser = response.data?.user || null;

        if (
          verifiedUser &&
          currentUser?.emailAddress &&
          currentUser.emailAddress.toLowerCase() ===
            String(verifiedUser.emailAddress || '').toLowerCase()
        ) {
          updateUser({
            emailVerified: true,
            emailVerificationRequired: false,
          });
        }

        setStatus('success');
        setMessage(response.data?.message || 'Email confirmed successfully.');
        toast.success(response.data?.message || 'Email confirmed successfully');
      } catch (error) {
        const errorMessage =
          error.response?.data?.message ||
          'Verification link is invalid or expired.';

        if (error.response?.status === 400 && token && !cameFromLanding) {
          navigate(`/open-confirm-email/${token}?reason=invalid`, {
            replace: true,
          });
          return;
        }

        setStatus('error');
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    };

    verifyEmail();
  }, [cameFromLanding, navigate, token]);

  return (
    <Container
      fluid
      className="auth-shell auth-standalone-shell d-flex align-items-center justify-content-center min-vh-100"
    >
      <div className="auth-standalone-frame">
        <Card
          className="auth-card auth-standalone-card border-0"
          style={{ maxWidth: '520px', marginInline: 'auto' }}
        >
          <CardBody className="text-center">
            <div className="auth-card-header">
              {status !== 'verifying' ? (
                <div className="auth-header-badge mx-auto">
                  <i className="fas fa-circle-check" />
                  Email status
                </div>
              ) : null}
              {status === 'verifying' ? (
                <Spinner color="primary" />
              ) : (
                <h2 className="auth-card-title mb-3">
                  {status === 'success'
                    ? 'Email Confirmed'
                    : 'Confirmation Failed'}
                </h2>
              )}
              <p className="auth-card-subtitle mb-0">{message}</p>
            </div>
            {status !== 'verifying' ? (
              <div className="d-flex gap-2 justify-content-center flex-wrap">
                <Button
                  color="primary"
                  onClick={() => {
                    if (status === 'success') {
                      if (hasSignedInSession) {
                        const nextUser = updateUser({
                          emailVerified: true,
                          emailVerificationRequired: false,
                        }) || {
                          ...getUser(),
                          emailVerified: true,
                          emailVerificationRequired: false,
                        };
                        navigate(resolvePostAuthRedirect(nextUser, returnTo), {
                          replace: true,
                        });
                        return;
                      }

                      navigate(buildAuthNavigationTarget('/signin', returnTo), {
                        replace: true,
                      });
                      return;
                    }

                    navigate(
                      buildAuthNavigationTarget('/confirm-account', returnTo)
                    );
                  }}
                >
                  {status === 'success'
                    ? hasSignedInSession
                      ? 'Continue To PIN Setup'
                      : 'Sign In To Continue'
                    : 'Go To Confirmation Page'}
                </Button>
                <Button
                  color="secondary"
                  outline
                  onClick={() => navigate('/signin')}
                >
                  Sign In
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </Container>
  );
}

export default ConfirmEmail;
