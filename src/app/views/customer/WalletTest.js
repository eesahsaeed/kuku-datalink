import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Col,
  Container,
  Form,
  FormGroup,
  Input,
  Label,
  Row,
  Spinner,
} from 'components/ui/primitives';
import axios from 'axios';
import { toast } from 'sonner';
import { getUser, networkTimeout } from '../../../lib/helper';

const WalletTest = () => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [preferredBank, setPreferredBank] = useState('test-bank');
  const [simulateForm, setSimulateForm] = useState({
    amount: '1000',
    status: 'success',
    reference: '',
    description: 'Wallet test simulated payment',
  });
  const [webhookForm, setWebhookForm] = useState({
    event: 'charge.success',
    amount: '1000',
    reference: '',
    channel: 'bank_transfer',
    gateway_response: 'Approved',
  });

  const user = getUser();
  const headers = { Authorization: `Bearer ${user?.token}` };

  const runAction = async (requestFn, successMessage) => {
    setLoading(true);
    try {
      const response = await requestFn();
      setLastResult(response.data);
      if (successMessage) {
        toast.success(successMessage);
      }
      return response.data;
    } catch (error) {
      const message =
        error.response?.data?.message || error.message || 'Request failed';
      toast.error(message);
      setLastResult({
        success: false,
        message,
        error: error.response?.data || null,
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    const data = await runAction(
      () =>
        axios.get('/api/wallet/test/status', {
          headers,
          timeout: networkTimeout,
        }),
      ''
    );

    if (data) {
      setStatus(data);
      if (Array.isArray(data.preferredBanks) && data.preferredBanks.length > 0) {
        setPreferredBank((currentValue) => {
          const hasCurrentValue = data.preferredBanks.some(
            (bank) => bank.value === currentValue
          );
          return hasCurrentValue ? currentValue : data.preferredBanks[0].value;
        });
      }
    }
  };

  const fetchTransactions = async () => {
    const data = await runAction(
      () =>
        axios.get('/api/wallet/transactions?page=1&limit=10', {
          headers,
          timeout: networkTimeout,
        }),
      ''
    );

    if (data?.success) {
      setTransactions(data.transactions || []);
    }
  };

  const createVirtualAccount = async () => {
    await runAction(
      () =>
        axios.post(
          '/api/wallet/test/create-virtual-account',
          { preferredBank },
          { headers, timeout: networkTimeout }
        ),
      'Current user virtual account request completed'
    );
    await fetchStatus();
  };

  const simulatePayment = async (e) => {
    e.preventDefault();
    await runAction(
      () =>
        axios.post('/api/wallet/test/simulate-payment', simulateForm, {
          headers,
          timeout: networkTimeout,
        }),
      'Current user payment simulation completed'
    );
    await fetchStatus();
    await fetchTransactions();
  };

  const simulateWebhook = async (e) => {
    e.preventDefault();
    await runAction(
      () =>
        axios.post('/api/wallet/test/webhook', webhookForm, {
          headers,
          timeout: networkTimeout,
        }),
      'Current user webhook simulation completed'
    );
    await fetchStatus();
    await fetchTransactions();
  };

  useEffect(() => {
    document.title = 'Wallet Test Tools';
    fetchStatus();
    fetchTransactions();
  }, []);

  return (
    <div className="content">
      <Container className="py-5" style={{ backgroundColor: '#f4f7f9' }}>
        <Row className="mb-3">
          <Col>
            <h3 className="mb-1">Wallet Test Tools</h3>
            <p className="text-muted mb-0">
              This page tests only the currently logged in user wallet and virtual
              account.
            </p>
          </Col>
        </Row>

        <Row className="g-3">
          <Col lg="6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="bg-light fw-bold">Environment Status</CardHeader>
              <CardBody>
                <Alert color="info" className="border-0">
                  Every action here targets the signed-in user only. Simulated
                  payments create test records, while webhook calls are the only
                  actions that credit this account holder wallet.
                </Alert>

                <div className="mb-2">
                  Test tools enabled: <strong>{status?.testToolsEnabled ? 'Yes' : 'No'}</strong>
                </div>
                <div className="mb-2">
                  Node environment: <strong>{status?.nodeEnv || 'N/A'}</strong>
                </div>
                <div className="mb-2">
                  Paystack configured: <strong>{status?.paystackConfigured ? 'Yes' : 'No'}</strong>
                </div>
                <div className="mb-2">
                  Paystack mode: <strong>{status?.paystackMode || 'N/A'}</strong>
                </div>
                <div className="mb-2">
                  Logged in user: <strong>{status?.user?.emailAddress || 'N/A'}</strong>
                </div>
                <div className="mb-2">
                  Wallet balance: <strong>?{Number(status?.user?.walletBalance || 0).toLocaleString()}</strong>
                </div>
                <div className="mb-3">
                  Virtual account status: <strong>{status?.user?.hasVirtualAccount ? 'Ready' : 'Not created yet'}</strong>
                </div>

                {status?.user?.virtualAccount?.virtual_account_number ? (
                  <div className="p-3 rounded border bg-light mb-3">
                    <div className="small text-muted">Current user virtual account</div>
                    <div className="fw-bold">{status.user.virtualAccount.account_name || 'N/A'}</div>
                    <div className="small">{status.user.virtualAccount.bank_name || 'Paystack Bank Partner'}</div>
                    <div className="font-monospace fw-bold mt-1">
                      {status.user.virtualAccount.virtual_account_number}
                    </div>
                  </div>
                ) : null}

                <FormGroup>
                  <Label>Select Preferred Bank</Label>
                  <Input
                    type="select"
                    value={preferredBank}
                    onChange={(e) => setPreferredBank(e.target.value)}
                    disabled={loading}
                  >
                    {(status?.preferredBanks || []).map((bank) => (
                      <option key={bank.value} value={bank.value}>
                        {bank.label}
                      </option>
                    ))}
                  </Input>
                </FormGroup>

                <Button
                  color="primary"
                  disabled={loading}
                  onClick={fetchStatus}
                  className="me-2"
                >
                  {loading ? <Spinner size="sm" /> : 'Refresh Status'}
                </Button>
                <Button
                  color="info"
                  disabled={loading}
                  onClick={createVirtualAccount}
                >
                  {loading ? <Spinner size="sm" /> : 'Create/Fetch My Virtual Account'}
                </Button>
              </CardBody>
            </Card>
          </Col>

          <Col lg="6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="bg-light fw-bold">
                Simulate Payment To Current User
              </CardHeader>
              <CardBody>
                <div className="small text-muted mb-3">
                  This creates a test transaction only. It does not change wallet
                  balance. Use the webhook simulation below to credit the wallet.
                </div>
                <Form onSubmit={simulatePayment}>
                  <Row>
                    <Col md="6">
                      <FormGroup>
                        <Label>Amount (NGN)</Label>
                        <Input
                          type="number"
                          min="1"
                          step="0.01"
                          value={simulateForm.amount}
                          onChange={(e) =>
                            setSimulateForm((prev) => ({
                              ...prev,
                              amount: e.target.value,
                            }))
                          }
                        />
                      </FormGroup>
                    </Col>
                    <Col md="6">
                      <FormGroup>
                        <Label>Status</Label>
                        <Input
                          type="select"
                          value={simulateForm.status}
                          onChange={(e) =>
                            setSimulateForm((prev) => ({
                              ...prev,
                              status: e.target.value,
                            }))
                          }
                        >
                          <option value="success">success</option>
                          <option value="failed">failed</option>
                          <option value="mismatch">mismatch</option>
                          <option value="pending">pending</option>
                        </Input>
                      </FormGroup>
                    </Col>
                  </Row>
                  <FormGroup>
                    <Label>Reference (optional)</Label>
                    <Input
                      value={simulateForm.reference}
                      onChange={(e) =>
                        setSimulateForm((prev) => ({
                          ...prev,
                          reference: e.target.value,
                        }))
                      }
                      placeholder="Leave empty to auto-generate"
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label>Description</Label>
                    <Input
                      value={simulateForm.description}
                      onChange={(e) =>
                        setSimulateForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                    />
                  </FormGroup>
                  <Button color="success" type="submit" disabled={loading}>
                    {loading ? <Spinner size="sm" /> : 'Run Payment Simulation'}
                  </Button>
                </Form>
              </CardBody>
            </Card>
          </Col>
        </Row>

        <Row className="g-3 mt-1">
          <Col lg="6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="bg-light fw-bold">
                Simulate Paystack Webhook For Current User
              </CardHeader>
              <CardBody>
                <div className="small text-muted mb-3">
                  This is the only wallet test action that updates wallet balance.
                </div>
                <Form onSubmit={simulateWebhook}>
                  <Row>
                    <Col md="6">
                      <FormGroup>
                        <Label>Event</Label>
                        <Input
                          value={webhookForm.event}
                          onChange={(e) =>
                            setWebhookForm((prev) => ({
                              ...prev,
                              event: e.target.value,
                            }))
                          }
                        />
                      </FormGroup>
                    </Col>
                    <Col md="6">
                      <FormGroup>
                        <Label>Amount (NGN)</Label>
                        <Input
                          type="number"
                          min="1"
                          step="0.01"
                          value={webhookForm.amount}
                          onChange={(e) =>
                            setWebhookForm((prev) => ({
                              ...prev,
                              amount: e.target.value,
                            }))
                          }
                        />
                      </FormGroup>
                    </Col>
                  </Row>
                  <FormGroup>
                    <Label>Reference (optional)</Label>
                    <Input
                      value={webhookForm.reference}
                      onChange={(e) =>
                        setWebhookForm((prev) => ({
                          ...prev,
                          reference: e.target.value,
                        }))
                      }
                      placeholder="Leave empty to auto-generate"
                    />
                  </FormGroup>
                  <div className="small text-muted mb-3">
                    Webhook simulation automatically uses the signed-in user email
                    and current user virtual account details, then credits the wallet.
                  </div>
                  <Button color="warning" type="submit" disabled={loading}>
                    {loading ? <Spinner size="sm" /> : 'Run Webhook Simulation'}
                  </Button>
                </Form>
              </CardBody>
            </Card>
          </Col>

          <Col lg="6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="bg-light fw-bold d-flex justify-content-between align-items-center">
                <span>Recent Wallet Transactions (10)</span>
                <Button
                  color="secondary"
                  size="sm"
                  onClick={fetchTransactions}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </CardHeader>
              <CardBody style={{ maxHeight: 350, overflowY: 'auto' }}>
                {transactions.length === 0 ? (
                  <p className="text-muted mb-0">No transactions found.</p>
                ) : (
                  transactions.map((tx) => (
                    <div key={tx._id || tx.reference} className="mb-3 pb-2 border-bottom">
                      <div className="fw-bold">{tx.description || 'Transaction'}</div>
                      <div className="small text-muted">{tx.reference}</div>
                      <div className="small">
                        {tx.type} | {tx.status} | ?{Number(tx.amount || 0).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </Col>
        </Row>

        <Row className="mt-3">
          <Col>
            <Card className="border-0 shadow-sm">
              <CardHeader className="bg-light fw-bold">Last API Result</CardHeader>
              <CardBody>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    marginBottom: 0,
                  }}
                >
                  {JSON.stringify(lastResult, null, 2)}
                </pre>
              </CardBody>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default WalletTest;
