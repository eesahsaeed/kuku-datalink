import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  CardBody,
  CardTitle,
  Button,
  ListGroup,
  ListGroupItem,
  Badge,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Form,
  FormGroup,
  Label,
  Input,
  FormFeedback,
  InputGroup,
} from 'components/ui/primitives';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  getUser,
  networkTimeout,
  normalizePhoneInputValue,
  signin,
  signout,
} from '../../../lib/helper';
import PinBoxes from '../../components/PinBoxes/PinBoxes';

import Loading from 'components/Loading/Loading';

const EditProfileModal = ({ isOpen, toggle, user, onUpdate }) => {
  const [formData, setFormData] = useState({
    fullName: user?.fullName || '',
    phoneNumber: user?.phoneNumber || '',
    emailAddress: user?.emailAddress || '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (user) {
      setFormData({
        fullName: user.fullName || '',
        phoneNumber: user.phoneNumber || '',
        emailAddress: user.emailAddress || '',
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'phoneNumber' ? normalizePhoneInputValue(value) : value,
    }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!formData.emailAddress.trim())
      newErrors.emailAddress = 'Email is required';
    if (formData.emailAddress && !/\S+@\S+\.\S+/.test(formData.emailAddress)) {
      newErrors.emailAddress = 'Invalid email format';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const loadingToast = toast.loading('Updating your profile...');
    setIsLoading(true);

    try {
      const token = user?.token || getUser()?.token;
      const response = await axios.put(
        `/api/authentication/update-profile`,
        formData,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
        }
      );

      if (response.data.user) {
        const updatedWithToken = { ...(response.data.user || {}), token };
        onUpdate(updatedWithToken);

        toast.update(loadingToast, {
          render: 'Profile updated successfully!',
          type: 'success',
          isLoading: false,
        });

        toggle();
      }
    } catch (err) {
      toast.update(loadingToast, {
        render: err.response?.data?.message || 'Failed to update profile',
        type: 'error',
        isLoading: false,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle} centered>
      <ModalHeader toggle={toggle} className="border-0">
        Edit Profile
      </ModalHeader>
      <Form onSubmit={handleSubmit}>
        <ModalBody>
          <FormGroup>
            <Label for="fullName">Full Name</Label>
            <Input
              type="text"
              name="fullName"
              id="fullName"
              value={formData.fullName}
              onChange={handleChange}
              invalid={!!errors.fullName}
              disabled={isLoading}
            />
            {errors.fullName && <FormFeedback>{errors.fullName}</FormFeedback>}
          </FormGroup>

          <FormGroup>
            <Label for="emailAddress">Email Address</Label>
            <Input
              type="email"
              name="emailAddress"
              id="emailAddress"
              value={formData.emailAddress}
              onChange={handleChange}
              invalid={!!errors.emailAddress}
              disabled={true}
            />
            {errors.emailAddress && (
              <FormFeedback>{errors.emailAddress}</FormFeedback>
            )}
          </FormGroup>

          <FormGroup>
            <Label for="phoneNumber">Phone Number</Label>
            <Input
              type="tel"
              name="phoneNumber"
              id="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              placeholder="e.g. 0803XXX1234"
              disabled={isLoading}
            />
          </FormGroup>
        </ModalBody>
        <ModalFooter className="border-0">
          <Button color="secondary" onClick={toggle} disabled={isLoading}>
            Cancel
          </Button>
          <Button color="primary" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
};

const ChangePinModal = ({ isOpen, toggle, user, onUpdate }) => {
  const currentPinRef = useRef(null);
  const newPinRef = useRef(null);
  const confirmNewPinRef = useRef(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (
      currentPin.length !== 4 ||
      newPin.length !== 4 ||
      confirmNewPin.length !== 4
    ) {
      toast.error('Enter all PIN fields with 4 digits each');
      return;
    }

    if (newPin !== confirmNewPin) {
      toast.error('New PIN and confirm PIN do not match');
      return;
    }

    setIsLoading(true);
    try {
      const token = user?.token || getUser()?.token;
      const response = await axios.post(
        '/api/authentication/change-pin',
        {
          currentPin,
          newPin,
          confirmNewPin,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
        }
      );

      if (response.data?.user) {
        onUpdate({
          ...(response.data.user || {}),
          token,
          hasTransactionPin: true,
        });
      }

      toast.success(
        response.data?.message || 'Transaction PIN changed successfully'
      );
      toggle();
    } catch (error) {
      toast.error(
        error.response?.data?.message || 'Could not change transaction PIN'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle} centered>
      <ModalHeader toggle={toggle} className="border-0">
        Change Transaction PIN
      </ModalHeader>
      <ModalBody>
        <div className="mb-4 text-center">
          <div className="mb-2 fw-bold">Current PIN</div>
          <PinBoxes
            ref={currentPinRef}
            value={currentPin}
            onChange={setCurrentPin}
            disabled={isLoading}
            onComplete={() => newPinRef.current?.focus()}
          />
        </div>

        <div className="mb-4 text-center">
          <div className="mb-2 fw-bold">New PIN</div>
          <PinBoxes
            ref={newPinRef}
            value={newPin}
            onChange={setNewPin}
            disabled={isLoading}
            onComplete={() => confirmNewPinRef.current?.focus()}
          />
        </div>

        <div className="text-center">
          <div className="mb-2 fw-bold">Confirm New PIN</div>
          <PinBoxes
            ref={confirmNewPinRef}
            value={confirmNewPin}
            onChange={setConfirmNewPin}
            disabled={isLoading}
            onComplete={handleSubmit}
          />
        </div>
      </ModalBody>
      <ModalFooter className="border-0">
        <Button color="secondary" onClick={toggle} disabled={isLoading}>
          Cancel
        </Button>
        <Button color="primary" onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Update PIN'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

const Profile = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [changePinModalOpen, setChangePinModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (!user) {
      navigate('/signin');
      return;
    }
    const { fullName } = user;
    document.title = `Profile - ${fullName}`;
    setCurrentUser(user);

    // Fetch latest user data
    axios
      .get(`/api/authentication/me`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: networkTimeout,
      })
      .then((res) => {
        if (res.data.success) {
          const merged = { ...user, ...res.data.user };
          setCurrentUser(merged);
        }
      })
      .catch((err) => console.error('Failed to fetch user details:', err))
      .finally(() => setLoading(false));
  }, [navigate]);

  const formatMemberSince = (createdAt) => {
    if (!createdAt) return 'Not available';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const hasVirtualAccount = currentUser?.virtualAccount?.virtual_account_number;
  const virtualAccountBankName =
    currentUser?.virtualAccount?.bank_name || 'Paystack Bank Partner';

  const copyAccountNumber = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const retryVirtualAccountProvision = async () => {
    try {
      const token = currentUser?.token || getUser()?.token;
      const response = await axios.get('/api/wallet/virtual-account', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: networkTimeout,
      });

      if (response.data?.success) {
        const merged = {
          ...(currentUser || {}),
          virtualAccount: response.data.data,
        };
        setCurrentUser(merged);
        signin(merged);
        toast.success('Virtual account is ready');
      } else if (response.data?.pending) {
        toast.warning(
          response.data.message || 'Provisioning is still in progress'
        );
      }
    } catch (error) {
      const pending = error.response?.data?.pending;
      toast[pending ? 'warning' : 'error'](
        error.response?.data?.message ||
          'Could not provision virtual account right now'
      );
    }
  };

  if (loading) {
    return (
      <div className="content">
        <div style={{ position: 'relative', marginTop: '20%' }}>
          <Loading />
        </div>
      </div>
    );
  }

  return (
    <Container style={{ backgroundColor: '#f4f7f9', marginTop: 5 }}>
      <Row className="justify-content-center">
        <Col md="8" lg="6">
          {/* Profile Card */}
          <Card className="profile-hero-card border-0 shadow-lg rounded-4 mb-4">
            <div className="profile-hero-cover" />
            <CardBody className="pb-5 pt-0 text-center position-relative profile-container">
              <div
                className="profile-hero-avatar rounded-circle bg-white p-2 shadow position-absolute start-50 translate-middle-x"
                style={{ top: '-68px', width: '136px', height: '136px' }}
              >
                <div className="profile-hero-avatar-inner rounded-circle w-100 h-100 d-flex align-items-center justify-content-center bg-primary text-white fs-2 fw-bold">
                  <div className="profile-name-avatar">
                    {currentUser?.fullName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                </div>
              </div>
              <div className="profile-hero-copy">
                <h2 className="fw-bold mb-1">
                  {currentUser?.fullName || 'User'}
                </h2>
                <p className="text-muted mb-4">{currentUser?.emailAddress}</p>
                <Button
                  color="primary"
                  className="px-5 py-2 fw-bold rounded-pill shadow-md mb-4"
                  onClick={() => setEditModalOpen(true)}
                >
                  <i className="fas fa-edit me-2"></i> Edit Profile
                </Button>
              </div>

              {/* User Information */}
              <ListGroup flush className="text-start mt-4 w-100">
                <ListGroupItem className="px-0 py-3 border-top">
                  <Row>
                    <Col xs="5" className="text-muted">
                      Email
                    </Col>
                    <Col xs="7" className="fw-medium">
                      {currentUser?.emailAddress || '—'}
                    </Col>
                  </Row>
                </ListGroupItem>
                <ListGroupItem className="px-0 py-3">
                  <Row>
                    <Col xs="5" className="text-muted">
                      Phone
                    </Col>
                    <Col xs="7" className="fw-medium">
                      {currentUser?.phoneNumber || 'Not added yet'}
                    </Col>
                  </Row>
                </ListGroupItem>
                <ListGroupItem className="px-0 py-3">
                  <Row>
                    <Col xs="5" className="text-muted">
                      Member Since
                    </Col>
                    <Col xs="7" className="fw-medium">
                      {formatMemberSince(currentUser?.createdAt)}
                    </Col>
                  </Row>
                </ListGroupItem>
                <ListGroupItem className="px-0 py-3 border-bottom">
                  <Row>
                    <Col xs="5" className="text-muted">
                      Account Status
                    </Col>
                    <Col xs="7">
                      <Badge
                        color={currentUser?.blocked ? 'danger' : 'success'}
                        className="fs-6 px-3 py-2"
                      >
                        {currentUser?.blocked ? 'Blocked' : 'Active'}
                      </Badge>
                    </Col>
                  </Row>
                </ListGroupItem>
              </ListGroup>
            </CardBody>
          </Card>

          {/* Virtual Account Section */}
          <Card className="border-0 shadow-sm rounded-4 mb-4">
            <CardBody className="p-4">
              <CardTitle tag="h5" className="mb-4 fw-bold">
                Virtual Account
              </CardTitle>
              {hasVirtualAccount ? (
                <div className="mb-5">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="text-muted mb-0 fw-semibold fs-5">
                      Personal Virtual Account
                    </h6>
                    <Badge color="success" pill className="px-4 py-2 fw-medium">
                      Active
                    </Badge>
                  </div>
                  <div className="bg-white border rounded-4 shadow-sm overflow-hidden">
                    <div className="d-flex align-items-center justify-content-between px-4 py-3 bg-light border-bottom">
                      <div className="wallet-bank-highlight">
                        <span className="wallet-bank-highlight-label">
                          Funding Bank
                        </span>
                        <span className="wallet-bank-highlight-name">
                          <i
                            className="fas fa-building-columns"
                            aria-hidden="true"
                          />
                          {virtualAccountBankName}
                        </span>
                      </div>
                      <small className="wallet-bank-highlight-meta">
                        Virtual Account
                      </small>
                    </div>
                    <div className="p-4">
                      <div className="text-center mb-4">
                        <h6 className="text-muted mb-2 small fw-semibold">
                          ACCOUNT NUMBER
                        </h6>
                        <InputGroup
                          size="lg"
                          className="mb-3 justify-content-center wallet-account-number-group"
                        >
                          <Input
                            value={
                              currentUser.virtualAccount.virtual_account_number
                            }
                            onClick={copyAccountNumber}
                            className="text-center font-monospace fw-bold border-0 bg-transparent shadow-none wallet-account-number-input"
                            style={{
                              background: 'transparent !important',
                              border: 'none',
                              outline: 'none',
                              boxShadow: 'none',
                              cursor: 'pointer',
                            }}
                            readOnly
                          />
                          <CopyToClipboard
                            text={
                              currentUser.virtualAccount.virtual_account_number
                            }
                            onCopy={copyAccountNumber}
                          >
                            <button
                              type="button"
                              className={`wallet-account-copy-button${
                                copied ? ' is-copied' : ''
                              }`}
                            >
                              {copied ? (
                                <span className="d-flex align-items-center justify-content-center">
                                  <i className="fas fa-check"></i>
                                  <span className="wallet-account-copy-button-label">
                                    Copied
                                  </span>
                                </span>
                              ) : (
                                <span className="d-flex align-items-center justify-content-center">
                                  <i className="far fa-copy"></i>
                                  <span className="wallet-account-copy-button-label">
                                    Copy
                                  </span>
                                </span>
                              )}
                            </button>
                          </CopyToClipboard>
                        </InputGroup>
                        <div className="wallet-fee-note wallet-fee-note-centered">
                          Transfer to this account with 0% fees. Your wallet
                          updates automatically after payment confirmation.
                        </div>
                      </div>
                      <Row className="text-center small text-muted g-0">
                        <Col>
                          <strong>Account Name:</strong>
                          <br />
                          {currentUser.fullName}
                        </Col>
                        <Col className="border-start border-end">
                          <strong>Bank:</strong>
                          <br />
                          <span className="wallet-bank-inline">
                            <i
                              className="fas fa-building-columns"
                              aria-hidden="true"
                            />
                            {virtualAccountBankName}
                          </span>
                        </Col>
                        <Col>
                          <strong>Currency:</strong>
                          <br />
                          NGN
                        </Col>
                      </Row>
                    </div>
                  </div>
                  <div className="text-center mt-4">
                    <div className="wallet-fee-note wallet-fee-note-centered wallet-profile-fee-note">
                      Use this account number to receive payments directly into
                      your wallet with 0% fees. Funds are usually credited
                      instantly.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <i className="fas fa-bank fa-3x text-muted mb-3"></i>
                  <h6 className="text-muted mb-3">
                    No personal virtual account yet
                  </h6>
                  <p className="text-muted small mb-4">
                    Your Paystack virtual account is not ready yet. Retry
                    provisioning.
                  </p>
                  <Button
                    color="primary"
                    className="px-5 rounded-pill"
                    onClick={retryVirtualAccountProvision}
                  >
                    Retry Provisioning
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card className="border-0 shadow-sm rounded-4">
            <CardBody className="p-4">
              <CardTitle tag="h5" className="mb-4 fw-bold">
                Quick Actions
              </CardTitle>
              <div className="profile-quick-actions d-grid">
                {currentUser.authType === 'email' && (
                  <Button
                    color="secondary"
                    className="profile-quick-action-btn py-3 text-start"
                    onClick={() => navigate('/forgot-password')}
                  >
                    <i className="fas fa-lock me-3"></i> Change Password
                  </Button>
                )}
                <Button
                  color="info"
                  className="profile-quick-action-btn py-3 text-start"
                  onClick={() => setChangePinModalOpen(true)}
                >
                  <i className="fas fa-key me-3"></i> Change Transaction PIN
                </Button>
                <Button
                  color="light"
                  className="profile-quick-action-btn py-3 text-start"
                  onClick={() => navigate('/forgot-pin')}
                >
                  <i className="fas fa-unlock-alt me-3"></i> Forgot Transaction
                  PIN
                </Button>
                <Button
                  color="danger"
                  className="profile-quick-action-btn py-3 text-start"
                  onClick={signout}
                >
                  <i className="fas fa-sign-out-alt me-3"></i> Log Out
                </Button>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Modals */}
      {currentUser && (
        <>
          <EditProfileModal
            isOpen={editModalOpen}
            toggle={() => setEditModalOpen(false)}
            user={currentUser}
            onUpdate={(updatedUser) => {
              setCurrentUser((prev) => {
                const merged = { ...(prev || {}), ...(updatedUser || {}) };
                try {
                  signin(merged);
                } catch (err) {
                  console.error('Failed to update local session:', err);
                }
                return merged;
              });
            }}
          />
          <ChangePinModal
            isOpen={changePinModalOpen}
            toggle={() => setChangePinModalOpen(false)}
            user={currentUser}
            onUpdate={(updatedUser) => {
              setCurrentUser((prev) => {
                const merged = { ...(prev || {}), ...(updatedUser || {}) };
                try {
                  signin(merged);
                } catch (err) {
                  console.error('Failed to update local session:', err);
                }
                return merged;
              });
            }}
          />
        </>
      )}
    </Container>
  );
};

export default Profile;
