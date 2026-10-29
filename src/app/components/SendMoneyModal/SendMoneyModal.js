import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Col,
  Input,
  InputGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
} from 'components/ui/primitives';
import axios from 'axios';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { FiCheckCircle, FiCopy, FiShield } from 'react-icons/fi';
import { toast } from 'sonner';
import { getUser, networkTimeout, signin } from '../../../lib/helper';

const SendMoneyModal = ({ isOpen, toggle }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [virtualAccount, setVirtualAccount] = useState(null);
  const [error, setError] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const currentUser = getUser();

  const accountName = useMemo(
    () => virtualAccount?.account_name || currentUser?.fullName || 'N/A',
    [currentUser?.fullName, virtualAccount?.account_name]
  );
  const bankName = virtualAccount?.bank_name || 'Paystack Bank Partner';

  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;

    const fetchVirtualAccount = async () => {
      setIsLoading(true);
      setError('');
      setPendingMessage('');
      try {
        const token = currentUser?.token;
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await axios.get('/api/wallet/virtual-account', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
        });

        if (isCancelled) return;
        const account = response.data?.data || null;
        const pending = Boolean(response.data?.pending);
        setVirtualAccount(account);
        setPendingMessage(pending ? response.data?.message || '' : '');

        if (account) {
          signin({
            ...(currentUser || {}),
            virtualAccount: account,
          });
        }
      } catch (requestError) {
        if (isCancelled) return;
        const responseMessage = requestError.response?.data?.message || '';
        const isPending = Boolean(requestError.response?.data?.pending);
        if (isPending) {
          setPendingMessage(responseMessage);
          setVirtualAccount(null);
        } else {
          const message =
            responseMessage ||
            requestError.message ||
            'Could not load your virtual account';
          setError(message);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchVirtualAccount();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, refreshKey]);

  const copyAccountNumber = () => {
    if (!virtualAccount?.virtual_account_number) return;
    setCopied(true);
    toast.success('Account number copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle} centered size="lg">
      <ModalHeader toggle={toggle} className="border-0 pb-2">
        Wallet Funding Account
      </ModalHeader>
      <ModalBody className="pt-0">
        <div className="checkout-hero mb-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div className="d-flex align-items-center gap-2">
              <FiShield className="checkout-hero-icon" />
              <div>
                <h5 className="wallet-modal-heading mb-1">Paystack Virtual Account</h5>
                <p className="wallet-modal-subcopy mb-0 small">
                  Transfer to this permanent account to fund your wallet.
                </p>
              </div>
            </div>
            <Badge
              color="success"
              pill
              className="px-3 py-2 d-flex align-items-center gap-2"
            >
              <FiCheckCircle /> Active
            </Badge>
          </div>
        </div>

        {isLoading ? (
          <div className="d-flex flex-column align-items-center py-4">
            <Spinner color="primary" />
            <p className="text-muted mt-3 mb-0">
              Loading your virtual account...
            </p>
          </div>
        ) : error ? (
          <Alert color="danger" className="mb-0">
            {error}
          </Alert>
        ) : pendingMessage ? (
          <Alert color="warning" className="mb-0">
            <div className="fw-semibold mb-2">Virtual account provisioning is in progress</div>
            <div className="small">{pendingMessage}</div>
          </Alert>
        ) : (
          <>
            <div className="checkout-account-box">
            <div className="checkout-account-header">
              <div className="wallet-bank-highlight">
                <span className="wallet-bank-highlight-label">Funding Bank</span>
                <span className="wallet-bank-highlight-name">
                  <i className="fas fa-building-columns" aria-hidden="true" />
                  {bankName}
                </span>
              </div>
              <small className="wallet-bank-highlight-meta">Permanent Account</small>
            </div>

            <div className="p-3">
              <small className="wallet-modal-label d-block mb-2">ACCOUNT NUMBER</small>
              <InputGroup className="mb-3 wallet-account-number-group">
                <Input
                  value={virtualAccount?.virtual_account_number || ''}
                  className="font-monospace fw-bold wallet-account-number-input"
                  style={{ cursor: 'pointer' }}
                  onClick={copyAccountNumber}
                  readOnly
                />
                <CopyToClipboard
                  text={virtualAccount?.virtual_account_number || ''}
                  onCopy={copyAccountNumber}
                >
                  <button
                    type="button"
                    className={`wallet-account-copy-button${
                      copied ? ' is-copied' : ''
                    }`}
                  >
                    {copied ? (
                      <>
                        <FiCheckCircle />
                        <span className="wallet-account-copy-button-label">
                          Copied
                        </span>
                      </>
                    ) : (
                      <>
                        <FiCopy />
                        <span className="wallet-account-copy-button-label">
                          Copy
                        </span>
                      </>
                    )}
                  </button>
                </CopyToClipboard>
              </InputGroup>
              <div className="wallet-fee-note mb-3">
                Transfer to this account with 0% fees. Your wallet updates
                automatically after payment confirmation.
              </div>

              <Row className="g-2 wallet-modal-value small">
                <Col md={6}>
                  <strong>Account Name:</strong>
                  <br />
                  {accountName}
                </Col>
                <Col md={6}>
                  <strong>Currency:</strong>
                  <br />
                  {virtualAccount?.currency || 'NGN'}
                </Col>
              </Row>
            </div>
            </div>

            <div className="wallet-modal-grid">
              <div className="wallet-modal-card">
                <h6>How to fund your wallet</h6>
                <p>
                  Open your banking app, transfer to this account number, and use your
                  name as the transfer narration if you want cleaner reconciliation.
                </p>
              </div>
              <div className="wallet-modal-card">
                <h6>What happens next</h6>
                <p>
                  Once Paystack confirms the credit webhook, your wallet balance and
                  transaction history update automatically.
                </p>
              </div>
            </div>
          </>
        )}
      </ModalBody>
      <ModalFooter className="border-0 px-3 pt-0">
        {(error || pendingMessage) && (
          <Button color="primary" outline onClick={() => setRefreshKey((prev) => prev + 1)}>
            Retry
          </Button>
        )}
        <Button color="secondary" onClick={toggle}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default SendMoneyModal;
