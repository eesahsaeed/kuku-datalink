import React, { useEffect, useState } from 'react';
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
import axios from 'axios';
import { toast } from 'sonner';
import { networkTimeout, validEmailAddress } from '../../lib/helper';

function ForgotPin() {
  const EMAIL_FOLDER_REMINDER =
    'Please check your inbox and also your spam, junk, or promotions folder.';
  const normalizeEmailForMessage = (value = '') =>
    String(value || '').trim().toLowerCase();
  const buildPinResetSentMessage = (value = '') =>
    `A transaction PIN reset link has been sent to ${normalizeEmailForMessage(
      value
    )}. ${EMAIL_FOLDER_REMINDER}`;
  const [emailAddress, setEmailAddress] = useState('');
  const [emailError, setEmailError] = useState({ error: false, message: '' });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState(
    buildPinResetSentMessage('name@domain.com')
  );

  useEffect(() => {
    document.documentElement.classList.add('auth-edge-to-edge');
    document.body.classList.add('auth-edge-to-edge');

    return () => {
      document.documentElement.classList.remove('auth-edge-to-edge');
      document.body.classList.remove('auth-edge-to-edge');
    };
  }, []);

  const handleChange = (event) => {
    setEmailAddress(event.target.value);
    if (emailError.error) {
      setEmailError({ error: false, message: '' });
    }
  };

  const getStyles = (errorObj) => ({
    border: `1px solid ${errorObj.error ? 'red' : '#ced4da'}`,
    borderRadius: '4px',
  });

  const submit = async (event) => {
    event.preventDefault();

    if (!emailAddress.trim() || !validEmailAddress(emailAddress)) {
      setEmailError({
        error: true,
        message: 'Please enter a valid email address',
      });
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post(
        '/api/authentication/forgot-pin',
        {
          emailAddress: emailAddress.trim().toLowerCase(),
        },
        {
          timeout: networkTimeout,
        }
      );

      const apiMessage = String(response?.data?.message || '').trim();
      const finalMessage =
        apiMessage || buildPinResetSentMessage(emailAddress);

      setSuccessMessage(finalMessage);
      setSubmitted(true);
      toast.success(finalMessage);
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          'Unable to send PIN reset email right now.'
      );
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
                <h3 className="auth-card-title">Forgot Transaction PIN</h3>
                <p className="auth-card-subtitle">
                  Enter your email address and we&apos;ll send you a secure link
                  to reset your 4-digit transaction PIN.
                </p>
              </div>

              {!submitted ? (
                <Form onSubmit={submit}>
                  <FormGroup floating>
                    <Input
                      type="email"
                      placeholder="Email Address"
                      name="emailAddress"
                      value={emailAddress}
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

                  <Button
                    color="primary"
                    block
                    size="lg"
                    style={{
                      borderRadius: 25,
                      border: 'none',
                      marginTop: '30px',
                    }}
                    disabled={loading}
                    type="submit"
                  >
                    {loading ? 'Sending...' : 'Send PIN Reset Link'}
                  </Button>
                </Form>
              ) : (
                <div className="text-center py-4">
                  <i className="fas fa-key fa-3x text-success mb-3"></i>
                  <p className="text-muted">{successMessage}</p>
                </div>
              )}

              <div className="text-center mt-4 pt-2 border-top">
                <p className="text-muted small mb-0">
                  Remembered your PIN?{' '}
                  <a
                    href="/signin"
                    className="text-primary text-decoration-none fw-bold"
                  >
                    Sign in here
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

export default ForgotPin;
