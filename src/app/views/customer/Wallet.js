import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Col,
  Container,
  Input,
  Row,
} from 'components/ui/primitives';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';

import { getUser, networkTimeout } from '../../../lib/helper';
import SendMoneyModal from 'components/SendMoneyModal/SendMoneyModal';
import Loading from 'components/Loading/Loading';
import WalletTransactionList from 'components/WalletTransactions/WalletTransactionList';
import { useSocket } from 'contexts/SocketContext';

const TRANSACTION_FETCH_LIMIT = 200;

const NairaWallet = () => {
  const socket = useSocket();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(getUser());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [wallet, setWallet] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filteredTransactions, setFilteredTransactions] = useState([]);

  const formatAsNaira = (amount) => {
    const num =
      typeof amount === 'string' ? parseFloat(amount) : Number(amount || 0);
    const hasFraction = !Number.isInteger(num);
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(num);
  };

  useEffect(() => {
    let result = [...transactions];

    if (filterType !== 'all') {
      result = result.filter((tx) => tx.type === filterType);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter((tx) => {
        const desc = (tx.description || '').toLowerCase();
        const ref = (tx.reference || '').toLowerCase();
        const sender = (
          tx.providerResponse?.metadata?.sender ||
          tx.metadata?.sender ||
          ''
        ).toLowerCase();
        return (
          desc.includes(term) || ref.includes(term) || sender.includes(term)
        );
      });
    }

    setFilteredTransactions(result);
  }, [transactions, searchTerm, filterType]);

  useEffect(() => {
    if (!socket || !currentUser?.token) return undefined;

    const handleCreditReceived = (data) => {
      const eventUserId = String(data?.userId || data?.user?._id || data?.user?.id || '').trim();
      const currentUserId = String(currentUser?._id || currentUser?.id || '').trim();
      if (!eventUserId || !currentUserId || eventUserId !== currentUserId) return;
      if (!data?.amount) return;

      const amount = Number(data.amount);
      const status = (data.status || '').toLowerCase().trim();
      const message = data.message || '';
      const isSuccess =
        status.includes('success') ||
        status === 'successful' ||
        status === 'succeeded' ||
        status === 'completed' ||
        data.success === true;

      if (isSuccess) {
        setWallet((prev) => ({
          ...prev,
          balance:
            data.newBalance != null
              ? Number(data.newBalance)
              : Number(prev.balance || 0) + amount,
        }));

        setTransactions((prev) => {
          if (
            data.reference &&
            prev.some((tx) => tx.reference === data.reference)
          ) {
            return prev;
          }

          return [
            {
              _id: data.reference || `TXN-${Date.now()}`,
              type: 'credit',
              amount,
              description: data.description || 'Wallet funding',
              reference: data.reference,
              status: data.status || 'success',
              createdAt: data.timestamp || new Date().toISOString(),
              metadata: data.metadata || {},
            },
            ...prev,
          ];
        });

        toast.success(`N${amount.toLocaleString()} added to your wallet!`);
      } else {
        toast.error(message || 'Funding could not be completed');
      }
    };

    socket.on('wallet:updated', handleCreditReceived);
    return () => socket.off('wallet:updated', handleCreditReceived);
  }, [currentUser, currentUser?.token, socket]);

  useEffect(() => {
    const user = getUser();
    if (!user) {
      navigate('/signin');
      return;
    }

    const { fullName, token } = user;
    document.title = `Wallet - ${fullName}`;
    setCurrentUser(user);

    const fetchWallet = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };

        const [walletRes, transactionsRes] = await Promise.all([
          axios.get('/api/wallet/me', {
            headers,
            timeout: networkTimeout,
          }),
          axios.get(
            `/api/wallet/transactions?page=1&limit=${TRANSACTION_FETCH_LIMIT}`,
            {
              headers,
              timeout: networkTimeout,
            }
          ),
        ]);

        if (walletRes.data.success) {
          setWallet(walletRes.data.wallet);
          setTransactions(transactionsRes.data?.transactions || []);
        } else {
          toast.error('Failed to load wallet data');
        }
      } catch (err) {
        console.error('Wallet fetch error:', err);
        toast.error('Could not load wallet information');
      } finally {
        setLoading(false);
      }
    };

    fetchWallet();
  }, [navigate]);

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
    <Container className="wallet-shell">
      <Row className="justify-content-center">
        <Col md="8" lg="6">
          <Card
            className="wallet-balance-card border-0 shadow-lg rounded-4 mb-4 text-white overflow-hidden"
          >
            <CardBody>
              <div className="wallet-balance-meta">
                <div className="wallet-balance-summary">
                  <div className="wallet-balance-kicker">Available Balance</div>
                  <h1 className="wallet-balance-title">
                    {formatAsNaira(wallet.balance)}
                  </h1>
                </div>
                <div className="wallet-account-bank">
                  <i className="fas fa-shield-heart" />
                  Secure Wallet
                </div>
              </div>

              <div className="wallet-fee-note wallet-balance-fee-note mb-3">
                Transfer to this account with 0% fees. Your wallet updates
                automatically after payment confirmation.
              </div>

              <p className="wallet-balance-note">
                Fund this wallet by transferring to your personal virtual account.
                Credits appear here as soon as your webhook confirms the payment.
              </p>

              <div className="wallet-balance-actions">
                <Button
                  color="light"
                  onClick={() => setModalOpen(true)}
                  className="wallet-balance-button px-3 py-3 shadow"
                  disabled={loading}
                >
                  <i className="fas fa-building-columns me-2"></i>
                  View Funding Account
                </Button>
              </div>

              <div className="wallet-insight-grid">
                <div className="wallet-insight-card">
                  <strong>{transactions.length}</strong>
                  <span>Recorded transactions</span>
                </div>
                <div className="wallet-insight-card">
                  <strong>{filteredTransactions.length}</strong>
                  <span>Visible after filtering</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="wallet-section-card border-0 shadow-sm rounded-4">
            <CardBody className="p-3">
              <h5 className="wallet-section-title mb-4">Recent Activity</h5>

              <div className="wallet-filter-bar">
                <div>
                  <Input
                    type="text"
                    placeholder="Search by description, ref or sender..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div>
                  <Input
                    type="select"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="all">All Transactions</option>
                    <option value="credit">Credits Only</option>
                    <option value="debit">Debits Only</option>
                  </Input>
                </div>
              </div>
              <div className="wallet-filter-meta">
                {transactions.length === 0
                  ? 'No transactions to show'
                  : `Showing ${filteredTransactions.length} of ${
                      transactions.length
                    } transactions`}
              </div>

              {transactions.length === 0 ? (
                <Alert color="light" className="wallet-empty-state mb-0">
                  No wallet transactions yet.
                </Alert>
              ) : (
                <WalletTransactionList transactions={filteredTransactions} />
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <SendMoneyModal isOpen={modalOpen} toggle={() => setModalOpen(false)} />
    </Container>
  );
};

export default NairaWallet;
