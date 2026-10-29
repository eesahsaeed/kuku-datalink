import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Card,
  CardBody,
  Form,
  FormGroup,
  Label,
  Input,
  Button,
  Navbar,
  Nav,
} from 'components/ui/primitives';
import Logo from '/img/logo.png';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';

import { toast } from 'sonner';
import { networkTimeout, validPassword } from '../../lib/helper';

function ResetPassword() {
  const { token } = useParams(); // Extract :token from URL
  const navigate = useNavigate();
  const location = useLocation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [passwordError, setPasswordError] = useState({
    error: false,
    message: '',
  });
  const [confirmError, setConfirmError] = useState({
    error: false,
    message: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isValidatingToken, setIsValidatingToken] = useState(true);
  const [isTokenValidated, setIsTokenValidated] = useState(false);
  const idempotencyKeyRef = useRef(
    globalThis.crypto?.randomUUID?.() ||
      `reset-password-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  const notifySuccess = (message) => toast.success(message);

  const notifyError = (message) => toast.error(message);
  const cameFromLanding =
    new URLSearchParams(location.search).get('fromLanding') === '1';

  useEffect(() => {
    document.documentElement.classList.add('auth-edge-to-edge');
    document.body.classList.add('auth-edge-to-edge');

    return () => {
      document.documentElement.classList.remove('auth-edge-to-edge');
      document.body.classList.remove('auth-edge-to-edge');
    };
  }, []);

  // Validate token on page load (exists, valid, not expired)
  useEffect(() => {
    let isActive = true;

    const validateResetToken = async () => {
      if (!token) {
        notifyError('Invalid reset link. Please request a new password reset.');
        navigate('/forgot-password', { replace: true });
        return;
      }

      setIsValidatingToken(true);

      try {
        await axios.get(`/api/authentication/reset-password/${token}/validate`, {
          timeout: networkTimeout,
        });

        if (!isActive) return;
        setIsTokenValidated(true);
      } catch (error) {
        if (!isActive) return;

        const errorMsg =
          error.response?.data?.error ||
          'Invalid or expired reset link. Please request a new password reset.';

        setIsTokenValidated(false);
        notifyError(errorMsg);

        if (error.response?.status === 400 && token && !cameFromLanding) {
          navigate(`/open-reset/${token}?reason=invalid`, {
            replace: true,
          });
          return;
        }
      } finally {
        if (isActive) {
          setIsValidatingToken(false);
        }
      }
    };

    validateResetToken();

    return () => {
      isActive = false;
    };
  }, [cameFromLanding, location.search, navigate, token]);

  const handlePasswordChange = (e) => {
    const value = e.target.value;
    setPassword(value);
    if (passwordError.error) setPasswordError({ error: false, message: '' });
    if (confirmError.error && value === confirmPassword)
      setConfirmError({ error: false, message: '' });
  };

  const handleConfirmChange = (e) => {
    const value = e.target.value;
    setConfirmPassword(value);
    if (confirmError.error) setConfirmError({ error: false, message: '' });
  };

  const getStyles = (errorObj) => ({
    border: `1px solid ${errorObj.error ? 'red' : '#ced4da'}`,
    borderRadius: '4px',
  });

  const submit = async (e) => {
    e.preventDefault();

    setPasswordError({ error: false, message: '' });
    setConfirmError({ error: false, message: '' });

    let hasError = false;

    if (!validPassword(password)) {
      setPasswordError({
        error: true,
        message:
          'Password must be at least 6 characters with letters, number or symbol',
      });
      hasError = true;
    }

    if (password !== confirmPassword) {
      setConfirmError({ error: true, message: 'Passwords do not match' });
      hasError = true;
    }

    if (hasError || !token) return;

    if (isValidatingToken || !isTokenValidated) {
      notifyError('This reset link is invalid or has expired.');
      return;
    }

    setLoading(true);

    try {
      await axios.post(
        `/api/authentication/reset-password/${token}`,
        {
          password,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKeyRef.current,
          },
          timeout: networkTimeout,
        }
      );

      setSuccess(true);
      notifySuccess('Your password has been successfully reset!');

      setTimeout(() => {
        navigate('/signin');
      }, 2000);
    } catch (error) {
      const errorMsg =
        error.response?.data?.error ||
        'Invalid or expired reset link. Please try again.';
      notifyError(errorMsg);

      if (error.response?.status === 400 && token && !cameFromLanding) {
        navigate(`/open-reset/${token}?reason=invalid`, {
          replace: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar
        className="auth-navbar auth-edge-navbar navbar-absolute navbar-transparent px-4 py-3"
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
        className="auth-shell auth-standalone-shell auth-edge-shell d-flex align-items-center justify-content-center"
      >
        <div className="auth-standalone-frame">
          <Card className="auth-card auth-standalone-card border-0">
            <CardBody>
              <div className="auth-card-header text-center">
                <h3 className="auth-card-title">
                  {isValidatingToken
                    ? 'Validating Reset Link'
                    : success
                    ? 'Password Updated!'
                    : 'Reset Your Password'}
                </h3>
                {!success && !isValidatingToken ? (
                  <p className="auth-card-subtitle">
                    Enter your new password below.
                  </p>
                ) : null}
              </div>

              {isValidatingToken ? (
                <div className="text-center py-5">
                  <i className="fas fa-spinner fa-spin fa-3x text-primary mb-4"></i>
                  <p className="text-muted">
                    Validating your reset link. Please wait...
                  </p>
                </div>
              ) : success ? (
                <div className="text-center py-5">
                  <i className="fas fa-check-circle fa-4x text-success mb-4"></i>
                  <p className="text-muted">
                    Your password has been changed successfully.
                  </p>
                  <p className="text-muted small">Redirecting to sign in...</p>
                </div>
              ) : !isTokenValidated ? (
                <div className="text-center py-5">
                  <i className="fas fa-exclamation-triangle fa-3x text-warning mb-4"></i>
                  <p className="text-muted mb-3">
                    This reset link is invalid or has expired.
                  </p>
                  <Button
                    color="primary"
                    onClick={() => navigate('/forgot-password')}
                  >
                    Request New Reset Link
                  </Button>
                </div>
              ) : (
                <>
                  <Form onSubmit={submit}>
                    {/* New Password */}
                    <FormGroup floating className="position-relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="New Password"
                        value={password}
                        onChange={handlePasswordChange}
                        style={getStyles(passwordError)}
                        disabled={loading}
                      />
                      {passwordError.error ? (
                        <p
                          style={{
                            color: 'red',
                            fontSize: '12px',
                            marginTop: '5px',
                          }}
                        >
                          {passwordError.message}
                        </p>
                      ) : (
                        <Label>New Password</Label>
                      )}
                      <div
                        className="eye-icon"
                        style={{
                          position: 'absolute',
                          right: '15px',
                          top: '5px',
                          cursor: 'pointer',
                          zIndex: 10,
                        }}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <AiFillEyeInvisible size={22} />
                        ) : (
                          <AiFillEye size={22} />
                        )}
                      </div>
                    </FormGroup>

                    {/* Confirm Password */}
                    <FormGroup floating className="position-relative">
                      <Input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Confirm New Password"
                        value={confirmPassword}
                        onChange={handleConfirmChange}
                        style={getStyles(confirmError)}
                        disabled={loading}
                      />
                      {confirmError.error ? (
                        <p
                          style={{
                            color: 'red',
                            fontSize: '12px',
                            marginTop: '5px',
                          }}
                        >
                          {confirmError.message}
                        </p>
                      ) : (
                        <Label>Confirm New Password</Label>
                      )}
                      <div
                        className="eye-icon"
                        style={{
                          position: 'absolute',
                          right: '15px',
                          top: '5px',
                          cursor: 'pointer',
                          zIndex: 10,
                        }}
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                      >
                        {showConfirmPassword ? (
                          <AiFillEyeInvisible size={22} />
                        ) : (
                          <AiFillEye size={22} />
                        )}
                      </div>
                    </FormGroup>

                    <Button
                      color="primary"
                      block
                      size="lg"
                      style={{
                        borderRadius: 25,
                        border: 'none',
                        marginTop: '30px',
                      }}
                      disabled={loading || isValidatingToken || !isTokenValidated}
                      type="submit"
                    >
                      {loading ? 'Updating...' : 'Set New Password'}
                    </Button>
                  </Form>
                </>
              )}

              <div className="text-center mt-4 pt-2 border-top">
                <p className="text-muted small mb-0">
                  Back to{' '}
                  <a
                    className="text-primary text-decoration-none fw-bold"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate('/signin')}
                  >
                    Sign In
                  </a>
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </Container>
    </>
  );
}

export default ResetPassword;
