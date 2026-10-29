import React, { useEffect, useRef, useState } from 'react';
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
  NavbarBrand,
  Nav,
} from 'components/ui/primitives';
import Logo from '/img/logo.png';
import { FcGoogle } from 'react-icons/fc';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';

import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';

import { toast } from 'sonner';
import {
  buildAuthNavigationTarget,
  getAuthReturnTo,
  networkTimeout,
  resolvePostAuthRedirect,
  setPendingAuthRedirect,
  validEmailAddress,
  signin,
} from '../../lib/helper';
import Loading from 'components/Loading/Loading';
import useGoogleTokenClient from 'hooks/useGoogleTokenClient.js';

function Signin() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = getAuthReturnTo(location.search);
  const autoGoogleStartedRef = useRef(false);

  const [values, setValues] = useState({
    emailAddress: '',
    password: '',
  });

  const [emailError, setEmailError] = useState({ error: false, message: '' });
  const [passwordError, setPasswordError] = useState({
    error: false,
    message: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const notifySuccess = (message) => toast.success(message);

  const notifyError = (message) => toast.error(message);

  const notifyWarn = (message) => toast.warn(message);

  const handleGoogleSigninSuccess = async (credential) => {
    setLoading(true);
    try {
      const res = await axios.post(`/api/authentication/google-signin`, {
        access_token: credential?.access_token,
      }, {
        timeout: networkTimeout,
      });
      const user = {
        ...res.data.user,
        emailVerificationRequired: res.data.emailVerificationRequired,
        pinSetupRequired: res.data.pinSetupRequired,
      };

      if (!user.phoneNumber || user.phoneNumber.trim() === '') {
        navigate(
          {
            pathname: '/signup',
            search: `?id=${user._id}&authType=${user.authType}${
              returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''
            }`,
          },
          { replace: true }
        );
        notifyWarn(
          res.data.message ||
            'Please complete your registration with a phone number.'
        );
      } else {
        signin(user);
        setPendingAuthRedirect(returnTo);
        notifySuccess(`Welcome back, ${user.fullName}!`);
        navigate(resolvePostAuthRedirect(user, returnTo), { replace: true });
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || 'Google authentication failed';
      notifyError(
        typeof errorMsg === 'string' ? errorMsg : 'An error occurred'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSigninError = (error) => {
    notifyError(
      error?.message || 'Failed to connect to Google. Please try again.'
    );
    setLoading(false);
  };

  const { isReady: isGoogleReady, startGoogleLogin } = useGoogleTokenClient({
    onSuccess: handleGoogleSigninSuccess,
    onError: handleGoogleSigninError,
  });

  const searchParams = new URLSearchParams(location.search);
  const shouldAutoLaunchGoogle = searchParams.get('google') === '1';

  useEffect(() => {
    if (!shouldAutoLaunchGoogle || autoGoogleStartedRef.current || loading) {
      return;
    }

    if (!isGoogleReady) {
      return;
    }

    autoGoogleStartedRef.current = true;
    setLoading(true);
    const started = startGoogleLogin();

    if (!started) {
      autoGoogleStartedRef.current = false;
      setLoading(false);
    }
  }, [isGoogleReady, loading, shouldAutoLaunchGoogle, startGoogleLogin]);

  const googleLogin = () => {
    if (!isGoogleReady) {
      notifyError('Google Sign-In is still loading. Please try again.');
      return;
    }

    setLoading(true);
    const started = startGoogleLogin();
    if (!started) {
      setLoading(false);
    }
  };

  const resetError = (field) => {
    if (field === 'emailAddress') setEmailError({ error: false, message: '' });
    if (field === 'password') setPasswordError({ error: false, message: '' });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    resetError(name);

    if (name === 'emailAddress') {
      setValues((prev) => ({ ...prev, emailAddress: value }));
    } else {
      setValues((prev) => ({ ...prev, password: value }));
    }
  };

  const mapBackendErrors = (errorData) => {
    const processError = (msg) => {
      const lower = msg.toLowerCase();
      if (lower.includes('email') || lower.includes('user')) {
        setEmailError({ error: true, message: msg });
      } else if (lower.includes('password') || lower.includes('credential')) {
        setPasswordError({ error: true, message: msg });
      }
      notifyError(msg);
    };

    if (Array.isArray(errorData)) {
      errorData.forEach(processError);
    } else if (typeof errorData === 'string') {
      processError(errorData);
    }
  };

  const submit = async (e) => {
    e.preventDefault();

    if (!validEmailAddress(values.emailAddress)) {
      setEmailError({
        error: true,
        message: 'Please enter a valid email address',
      });
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(`/api/authentication/signin`, {
        emailAddress: values.emailAddress,
        password: values.password,
      }, {
        timeout: networkTimeout,
      });

      const user = {
        ...response.data.user,
        emailVerificationRequired: response.data.emailVerificationRequired,
        pinSetupRequired: response.data.pinSetupRequired,
      };
      signin(user);
      setPendingAuthRedirect(returnTo);

      notifySuccess(`Welcome back, ${user.fullName}!`);
      navigate(resolvePostAuthRedirect(user, returnTo), { replace: true });
    } catch (error) {
      const errorData =
        error.response?.data?.message || 'Invalid email or password';
      mapBackendErrors(errorData);
    } finally {
      setLoading(false);
    }
  };

  const getStyles = (errorObj) => ({
    border: `1px solid ${errorObj.error ? 'red' : '#ced4da'}`,
    borderRadius: '4px',
  });

  return (
    <>
      <div className="auth-shell">
        <Navbar className="auth-navbar navbar-absolute navbar-transparent">
          <Container fluid>
            <div className="navbar-wrapper">
              <NavbarBrand
                href="/"
                className="auth-brand"
                title="Go to home"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/');
                }}
              >
                <img
                  alt="logo"
                  src={Logo}
                  title="Kuku"
                  className="app-logo-mark auth-logo-mark"
                  style={{ height: 48, width: 48 }}
                />
              </NavbarBrand>
            </div>

            <Nav className="ml-auto align-items-center gap-2 auth-navbar-actions">
              <Button
                className="customer-navbar-cta customer-navbar-cta-secondary auth-navbar-home-link"
                title="Go to home"
                onClick={() => navigate('/')}
              >
                <i className="fas fa-house" />
                Home
              </Button>
              <Button
                className="customer-navbar-cta auth-navbar-page-cta"
                title="Go to sign up"
                onClick={() =>
                  navigate(buildAuthNavigationTarget('/signup', returnTo))
                }
              >
                <i className="fas fa-user-plus" />
                Sign Up
              </Button>
            </Nav>
          </Container>
        </Navbar>

        <Container
          fluid
          className="d-flex align-items-center justify-content-center min-vh-100"
        >
          <div className="auth-frame">
            <div className="auth-copy">
              <div className="auth-kicker">
                <i className="fas fa-wallet" />
                Wallet ready
              </div>
              <h1>Sign in and pick up right where you left off.</h1>
              <p>
                Access your wallet, funding account, purchases, and support
                tools from one secure customer dashboard.
              </p>
              <ul className="auth-highlight-list">
                <li>
                  <i className="fas fa-building-columns" />
                  View your dedicated virtual account instantly
                </li>
                <li>
                  <i className="fas fa-bolt" />
                  Complete airtime, data, TV, and electricity purchases faster
                </li>
                <li>
                  <i className="fas fa-lock" />
                  Protected with secure sign-in and transaction PIN
                </li>
              </ul>
            </div>

            <Card className="auth-card">
              <CardBody>
                {loading && <Loading />}
                <div className="auth-card-header">
                  <h3 className="auth-card-title">Welcome back</h3>
                  <p className="auth-card-subtitle">
                    Continue with Google or sign in with your email and
                    password.
                  </p>
                </div>

                <div className="mb-3 w-100 google-login-container">
                  <button
                    className="google-btn"
                    onClick={() => googleLogin()}
                    disabled={loading || !isGoogleReady}
                    type="button"
                  >
                    <FcGoogle className="google-icon" />
                    <span>
                      {isGoogleReady
                        ? 'Continue with Google'
                        : 'Preparing Google...'}
                    </span>
                  </button>
                </div>

                <div className="auth-divider">OR USE EMAIL</div>

                <Form onSubmit={submit}>
                  {/* Email Address */}
                  <FormGroup floating>
                    <Input
                      type="email"
                      placeholder="Email Address"
                      name="emailAddress"
                      value={values.emailAddress}
                      onChange={handleChange}
                      style={getStyles(emailError)}
                      disabled={loading}
                    />
                    {emailError.error ? (
                      <p
                        style={{
                          color: 'red',
                          fontSize: '12px',
                          marginTop: '5px',
                        }}
                      >
                        {emailError.message}
                      </p>
                    ) : (
                      <Label>Email Address</Label>
                    )}
                  </FormGroup>

                  {/* Password */}
                  <FormGroup floating className="position-relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password"
                      name="password"
                      value={values.password}
                      onChange={handleChange}
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
                      <Label>Password</Label>
                    )}
                    <div
                      className="eye-icon"
                      style={{
                        position: 'absolute',
                        right: '15px',
                        top: '8px',
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

                  {/* Forgot Password Link */}
                  <div className="text-end mb-4">
                    <a
                      href="/forgot-password"
                      className="auth-inline-link"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate('/forgot-password');
                      }}
                    >
                      Forgot Password?
                    </a>
                  </div>

                  <Button
                    color="primary"
                    block
                    size="lg"
                    className="auth-primary-action"
                    disabled={loading}
                    type="submit"
                  >
                    {loading ? 'Signing In...' : 'Sign In'}
                  </Button>
                </Form>

                <div className="auth-footer-note">
                  <p className="mb-0">
                    Don't have an account?{' '}
                    <a
                      href="/signup"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(
                          buildAuthNavigationTarget('/signup', returnTo)
                        );
                      }}
                    >
                      Create one here
                    </a>
                  </p>
                </div>
              </CardBody>
            </Card>
          </div>
        </Container>
      </div>
    </>
  );
}

export default Signin;
