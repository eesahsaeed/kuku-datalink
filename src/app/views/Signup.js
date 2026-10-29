import React, { useState, useEffect, useMemo, useRef } from 'react';
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

import Loading from 'components/Loading/Loading';
import useGoogleTokenClient from 'hooks/useGoogleTokenClient.js';

import {
  buildAuthNavigationTarget,
  getAuthReturnTo,
  resolvePostAuthRedirect,
  networkTimeout,
  setPendingAuthRedirect,
  signin,
  validateEmailFormat,
  validFullNameString,
  validPhoneNumber,
  normalizePhoneInputValue,
} from '../../lib/helper';

function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = getAuthReturnTo(location.search);
  const autoGoogleStartedRef = useRef(false);
  const autoGoogleParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const shouldAutoLaunchGoogle =
    autoGoogleParams.get('google') === '1' &&
    !(
      autoGoogleParams.get('id') &&
      autoGoogleParams.get('authType') === 'google'
    );

  const [values, setValues] = useState({
    fullName: '',
    emailAddress: '',
    phoneNumber: '',
    bvn: '',
    password: '',
    confirmPassword: '',
  });

  const [fullNameError, setFullNameError] = useState({
    error: false,
    message: '',
  });

  const [emailAddressError, setEmailAddressError] = useState({
    error: false,
    message: '',
  });

  const [phoneNumberError, setPhoneNumberError] = useState({
    error: false,
    message: '',
  });

  const [passwordError, setPasswordError] = useState({
    error: false,
    message: '',
  });

  const [confirmPasswordError, setConfirmPasswordError] = useState({
    error: false,
    message: '',
  });

  const [googleAuth, setGoogleAuth] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  const notifySuccess = (message) => toast.success(message);

  const notifyError = (message) => toast.error(message);

  const notifyWarn = (message) => toast.warning(message);

  const handleGoogleSignupSuccess = (credential) => {
    setLoading(true);

    axios
      .post(`/api/authentication/google-signup`, {
        access_token: credential?.access_token,
      }, {
        timeout: networkTimeout,
      })
      .then((val) => {
        const user = {
          ...val.data.user,
          emailVerificationRequired: val.data.emailVerificationRequired,
          pinSetupRequired: val.data.pinSetupRequired,
        };

        if (!validPhoneNumber(user.phoneNumber || '')) {
          setGoogleAuth(true);
          setValues({
            ...user,
            fullName: user.fullName || '',
            emailAddress: user.emailAddress || '',
            phoneNumber: user.phoneNumber || '',
            bvn: user.bvn || '',
            password: '',
            confirmPassword: '',
          });

          navigate(
            {
              search: `?id=${user._id}&authType=${user.authType}${
                returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''
              }`,
            },
            { replace: true }
          );

          notifyWarn(val.data.message);
        } else {
          signin(user);
          setPendingAuthRedirect(returnTo);

          notifySuccess(`Welcome back, ${user.fullName}!`);
          navigate(resolvePostAuthRedirect(user, returnTo), { replace: true });
        }
      })
      .catch((err) => {
        console.error('Google Auth Error:', err);
        const errorData =
          err.response?.data?.error || 'Error occurred during Google Login';
        mapBackendErrors(errorData);
      })
      .finally(() => {
        window.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
        setLoading(false);
      });
  };

  const handleGoogleSignupError = (error) => {
    notifyError(
      error?.message || 'Failed to connect to Google. Please try again.'
    );
    setLoading(false);
  };

  const { isReady: isGoogleReady, startGoogleLogin } = useGoogleTokenClient({
    onSuccess: handleGoogleSignupSuccess,
    onError: handleGoogleSignupError,
  });

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
      notifyError('Google Sign-Up is still loading. Please try again.');
      return;
    }

    setLoading(true);
    const started = startGoogleLogin();
    if (!started) {
      setLoading(false);
    }
  };

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const id = queryParams.get('id');
    const authType = queryParams.get('authType');
    const redirectTarget = getAuthReturnTo(window.location.search);

    if (id && authType === 'google') {
      // 1. Fetch user data from database using the ID
      const fetchUser = async () => {
        try {
          setLoading(true);
          const response = await axios.get(`/api/authentication/user/${id}`, {
            timeout: networkTimeout,
          });

          const userData = response.data.user;

          // 2. Set googleAuth to true to show the phone input view
          setGoogleAuth(true);

          // 3. Populate state with the database user data
          setValues((prev) => ({
            ...prev,
            ...userData, // Spreading the fetched user object (includes _id, emailAddress, fullName, etc.)
            fullName: userData.fullName || '',
            emailAddress: userData.emailAddress || '',
            phoneNumber: userData.phoneNumber || '',
            bvn: userData.bvn || '',
            password: '',
            confirmPassword: '',
          }));

          if (validPhoneNumber(userData.phoneNumber || '')) {
            // If phone number exists, redirect to home or appropriate page
            navigate(resolvePostAuthRedirect(userData, redirectTarget), {
              replace: true,
            });
          }
        } catch (err) {
          console.error('Error restoring session:', err);
          notifyError(
            'Failed to restore registration session. Please try logging in again.'
          );
        } finally {
          setLoading(false);
        }
      };

      fetchUser();
    }
  }, []); // Empty dependency array ensures it runs only once on mount

  // Helper function to clear error for a specific field
  const resetErrorByName = (name) => {
    const cleanState = { error: false, message: '' };

    switch (name) {
      case 'fullName':
        setFullNameError(cleanState);
        break;
      case 'emailAddress':
        setEmailAddressError(cleanState);
        break;
      case 'phoneNumber':
        setPhoneNumberError(cleanState);
        break;
      case 'password':
        setPasswordError(cleanState);
        break;
      case 'confirmPassword':
        setConfirmPasswordError(cleanState);
        break;
      default:
        break;
    }
  };

  function handleChange(event) {
    const { name, value } = event.target;

    // 1. Reset the error state for this specific field immediately
    resetErrorByName(name);

    // 2. Existing validation logic to update the value
    setValues({
      ...values,
      [name]: name === 'phoneNumber' ? normalizePhoneInputValue(value) : value,
    });
  }

  function validateFormValues() {
    let isValid = true;

    // 1. Full Name Validation (Required for both Email and Google)
    if (!values.fullName || !validFullNameString(values.fullName)) {
      setFullNameError({
        error: true,
        message: 'Please enter a valid full name (min 3 characters).',
      });
      isValid = false;
    }

    // 2. Email Validation (Required for Email signup)
    if (!googleAuth) {
      if (!values.emailAddress || !validateEmailFormat(values.emailAddress)) {
        setEmailAddressError({
          error: true,
          message: 'Please enter a valid email address.',
        });
        isValid = false;
      }
    }

    // 3. Phone Number Validation (Required for both)
    if (
      !values.phoneNumber ||
      !validPhoneNumber(values.phoneNumber)
    ) {
      setPhoneNumberError({
        error: true,
        message:
          'Enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....',
      });
      isValid = false;
    }

    // 4. Password Validation (Only if NOT Google Auth)
    if (!googleAuth) {
      if (!values.password || values.password.length < 8) {
        setPasswordError({
          error: true,
          message:
            'Password must be at least 8 characters with one uppercase letter and one number.',
        });
        isValid = false;
      } else if (
        !/[A-Z]/.test(values.password) ||
        !/\d/.test(values.password)
      ) {
        setPasswordError({
          error: true,
          message:
            'Password must include at least one uppercase letter and one number.',
        });
        isValid = false;
      }

      if (!values.confirmPassword) {
        setConfirmPasswordError({
          error: true,
          message: 'Please confirm your password.',
        });
        isValid = false;
      }

      if (values.password !== values.confirmPassword) {
        setConfirmPasswordError({
          error: true,
          message: 'Passwords do not match.',
        });
        isValid = false;
      }
    }

    return isValid;
  }

  const mapBackendErrors = (errorData) => {
    const processError = (rawMessage) => {
      const msg =
        typeof rawMessage === 'string'
          ? rawMessage
          : rawMessage?.msg || rawMessage?.message || rawMessage?.error || '';
      if (!msg) return;

      const lowerMsg = msg.toLowerCase();

      if (lowerMsg.includes('email')) {
        setEmailAddressError({ error: true, message: msg });
      } else if (
        lowerMsg.includes('full name') ||
        lowerMsg.includes('fullname')
      ) {
        setFullNameError({ error: true, message: msg });
      } else if (lowerMsg.includes('phone')) {
        setPhoneNumberError({ error: true, message: msg });
      } else if (lowerMsg.includes('password')) {
        // FIX: Ensure this state setter is named correctly to match your state
        setPasswordError({ error: true, message: msg });

        // If the error is specifically about matching, set confirmPassword too
        if (lowerMsg.includes('match')) {
          setConfirmPasswordError({ error: true, message: msg });
        }
      }

      if (msg) {
        notifyError(msg);
      }
    };

    if (Array.isArray(errorData)) {
      errorData.forEach(processError);
    } else if (typeof errorData === 'string') {
      processError(errorData);
    }
  };

  async function submit(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (googleAuth) {
      await proceed();
      return;
    }

    const valid = validateFormValues(); // Assuming this returns TRUE if everything is correct

    // CHANGE: Remove the "!" so it runs when valid
    if (valid) {
      setLoading(true);

      try {
        const response = await axios.post(`/api/authentication/signup`, values, {
          timeout: networkTimeout,
        });
        const nextUser = {
          ...response.data.user,
          emailVerificationRequired: response.data.emailVerificationRequired,
          pinSetupRequired: response.data.pinSetupRequired,
        };

        notifySuccess('Registration Successful!');

        signin(nextUser);
        setPendingAuthRedirect(returnTo);

        setTimeout(() => {
          navigate(resolvePostAuthRedirect(nextUser, returnTo), {
            replace: true,
          });
        }, 1000);
      } catch (error) {
        const errorData = error.response?.data?.errors;
        mapBackendErrors(errorData);

        if (error.response?.data?.message) {
          notifyError(error.response.data.message);
        }
      } finally {
        setLoading(false);
      }
    } else {
      // This will now show correctly if the frontend validation fails
      notifyWarn('Please correct the form errors before submitting.');
    }
  }

  const getStyles = (errorObj) => ({
    border: `1px solid ${errorObj.error ? 'red' : '#ced4da'}`,
    borderRadius: '4px',
  });

  async function proceed() {
    // 1. Basic Frontend Check
    if (!validPhoneNumber(values.phoneNumber)) {
      setPhoneNumberError({
        error: true,
        message:
          'Enter a valid Nigerian mobile number. You can use 080..., 803..., or 234803....',
      });
      notifyWarn('Please enter a valid Nigerian mobile number.');
      return;
    }

    setLoading(true);

    try {
      // 2. Access _id directly from the values object
      const userId = values._id;

      if (!userId) {
        notifyError('User ID not found. Please refresh the page.');
        setLoading(false);
        return;
      }

      // 3. Make the PATCH request
      const response = await axios.patch(
        `/api/authentication/update-phone`,
        {
          phoneNumber: values.phoneNumber,
          userId,
        },
        {
          timeout: networkTimeout,
        }
      );
      const nextUser = {
        ...response.data.user,
        emailVerificationRequired: response.data.emailVerificationRequired,
        pinSetupRequired: response.data.pinSetupRequired,
      };

      // 4. Handle Success
      notifySuccess('Phone number updated successfully!');
      signin(nextUser);
      setPendingAuthRedirect(returnTo);

      navigate(resolvePostAuthRedirect(nextUser, returnTo), {
        replace: true,
      });
    } catch (error) {
      console.error('Update Phone Error:', error);

      // 5. Extract backend error from the API response
      const errorData = error.response?.data?.error;

      // 6. Map the error to the phoneNumber input field
      mapBackendErrors(errorData);
    } finally {
      setLoading(false);
    }
  }

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
                title="Go to sign in"
                onClick={() =>
                  navigate(buildAuthNavigationTarget('/signin', returnTo))
                }
              >
                <i className="fas fa-right-to-bracket" />
                Sign In
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
                <i className="fas fa-shield-heart" />
                Secure onboarding
              </div>
              <h1>Open your account and get your wallet ready in minutes.</h1>
              <p>
                Sign up once, create your transaction PIN, and start using your
                Paystack virtual account for instant wallet funding.
              </p>
              <ul className="auth-highlight-list">
                <li>
                  <i className="fas fa-envelope-open-text" />
                  Fast onboarding with instant access
                </li>
                <li>
                  <i className="fas fa-fingerprint" />
                  Dedicated 4-digit purchase PIN setup
                </li>
                <li>
                  <i className="fas fa-building-columns" />
                  Automatic wallet account provisioning after signup
                </li>
              </ul>
            </div>

            <Card className="auth-card">
              <CardBody style={{ position: 'relative' }}>
                {loading && <Loading />}

                <div className="auth-card-header">
                  <div className="auth-header-badge">
                    <i
                      className={
                        googleAuth ? 'fas fa-mobile-alt' : 'fas fa-user-plus'
                      }
                    />
                    {googleAuth ? 'Final signup step' : 'New account'}
                  </div>
                  <h3 className="auth-card-title">
                    {googleAuth ? 'Finish your account' : 'Create your account'}
                  </h3>
                  <p className="auth-card-subtitle">
                    {googleAuth
                      ? 'Add your phone number so we can complete your Google signup securely.'
                      : 'Use Google or your email to create a secure Kuku Data account.'}
                  </p>
                </div>

                {!googleAuth ? (
                  <>
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
                            ? 'Sign up with Google'
                            : 'Preparing Google...'}
                        </span>
                      </button>
                    </div>

                    <div className="auth-divider">OR CONTINUE WITH EMAIL</div>
                  </>
                ) : (
                  <div className="auth-phone-completion-panel mb-4">
                    <div className="auth-phone-completion-icon">
                      <i className="fas fa-mobile-alt" />
                    </div>
                    <div className="auth-phone-completion-copy">
                      <p className="auth-phone-completion-text mb-0">
                        Proceed to the next step by confirming your phone
                        number to complete your registration securely.
                      </p>
                    </div>
                  </div>
                )}

                <Form
                  onSubmit={submit}
                >
                  {/* Full Name */}
                  {!googleAuth && (
                    <FormGroup floating>
                      <Input
                        type="text"
                        placeholder="Full Name"
                        name="fullName"
                        value={values.fullName}
                        onChange={handleChange}
                        style={getStyles(fullNameError, 'fullName')}
                        disabled={loading || googleAuth}
                      />
                      {fullNameError.error ? (
                        <p
                          style={{
                            color: 'red',
                            fontSize: '12px',
                            marginTop: '5px',
                          }}
                        >
                          {fullNameError.message}
                        </p>
                      ) : (
                        <Label for="fullName">Full Name</Label>
                      )}
                    </FormGroup>
                  )}

                  {/* Email Address */}
                  {!googleAuth && (
                    <FormGroup floating>
                      <Input
                        type="email"
                        placeholder="Email"
                        name="emailAddress"
                        onChange={handleChange}
                        value={values.emailAddress}
                        style={getStyles(emailAddressError, 'emailAddress')}
                        disabled={loading || googleAuth}
                      />
                      {emailAddressError.error ? (
                        <p
                          style={{
                            color: 'red',
                            fontSize: '12px',
                            marginTop: '5px',
                          }}
                        >
                          {emailAddressError.message}
                        </p>
                      ) : (
                        <Label for="emailAddress">Email Address</Label>
                      )}
                    </FormGroup>
                  )}

                  {/* Phone Number */}
                  <FormGroup floating>
                    <Input
                      type="text"
                      placeholder="Phone Number"
                      name="phoneNumber"
                      onChange={handleChange}
                      value={values.phoneNumber}
                      style={getStyles(phoneNumberError, 'phoneNumber')}
                    />
                    {phoneNumberError.error ? (
                      <p
                        style={{
                          color: 'red',
                          fontSize: '12px',
                          marginTop: '5px',
                        }}
                      >
                        {phoneNumberError.message}
                      </p>
                    ) : (
                      <Label for="phoneNumber">Phone Number</Label>
                    )}
                  </FormGroup>

                  {/* Password */}
                  {!googleAuth && (
                    <FormGroup floating className="position-relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Password"
                        name="password"
                        id="password"
                        onChange={handleChange}
                        value={values.password}
                        style={getStyles(passwordError, 'password')}
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
                        <Label for="password">Password</Label>
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
                  )}

                  {/* Confirm Password */}
                  {!googleAuth && (
                    <FormGroup floating className="position-relative">
                      <Input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Confirm Password"
                        name="confirmPassword"
                        onChange={handleChange}
                        value={values.confirmPassword}
                        style={getStyles(
                          confirmPasswordError,
                          'confirmPassword'
                        )}
                        disabled={loading || googleAuth}
                      />
                      {confirmPasswordError.error ? (
                        <p
                          style={{
                            color: 'red',
                            fontSize: '12px',
                            marginTop: '5px',
                          }}
                        >
                          {confirmPasswordError.message}
                        </p>
                      ) : (
                        <Label for="confirmPassword">Confirm Password</Label>
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
                  )}

                  {googleAuth ? (
                    <Button
                      color="primary"
                      block
                      size="lg"
                      className="auth-primary-action"
                      disabled={loading}
                      type="submit"
                    >
                      {loading ? 'Processing...' : 'Proceed'}
                    </Button>
                  ) : (
                    <Button
                      color="primary"
                      block
                      size="lg"
                      className="auth-primary-action"
                      disabled={loading}
                      type="submit"
                    >
                      {loading ? 'Processing...' : 'Sign Up'}
                    </Button>
                  )}
                </Form>

                <div className="auth-footer-note">
                  Already have an account?{' '}
                  <a
                    href="/signin"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(buildAuthNavigationTarget('/signin', returnTo));
                    }}
                  >
                    Sign in here
                  </a>
                </div>
              </CardBody>
            </Card>
          </div>
        </Container>
      </div>
    </>
  );
}

export default Signup;
