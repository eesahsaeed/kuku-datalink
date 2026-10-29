import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Col,
  FormGroup,
  Input,
  InputGroup,
  InputGroupText,
  Label,
  Row,
  Spinner,
} from 'components/ui/primitives';
import UserOverviewModal from './components/UserOverviewModal.js';
import { getUser, networkTimeout } from '../../../lib/helper.js';
import {
  ADMIN_DASHBOARD_ROLE,
  getPrimaryWorkspaceRole,
  isPrimaryAdminUser,
} from '../../utils/adminAccess.js';

const getRoleBadgeColor = (role = '') => {
  const normalizedRole = String(role || '').toLowerCase().trim();

  if (normalizedRole === 'admin') return 'danger';
  if (normalizedRole === ADMIN_DASHBOARD_ROLE) return 'primary';
  if (normalizedRole === 'staff') return 'info';
  return 'secondary';
};

const formatRoleBadgeLabel = (role = '', isPrimaryAdmin = false) => {
  const normalizedRole = String(role || '').toLowerCase().trim();

  if (normalizedRole === ADMIN_DASHBOARD_ROLE) {
    return 'Admin Dashboard';
  }

  if (normalizedRole === 'admin' && isPrimaryAdmin) {
    return 'Primary Admin';
  }

  if (!normalizedRole) {
    return 'Unknown';
  }

  return normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
};

const getStatusBadgeColor = (isBlocked = false) =>
  isBlocked ? 'danger' : 'success';

const formatUserDateTime = (value) => {
  if (!value) return 'N/A';

  try {
    return new Date(value).toLocaleString('en-NG');
  } catch (_error) {
    return String(value);
  }
};

function UserManager() {
  const currentUser = useMemo(() => getUser(), []);
  const isPrimaryAdmin = useMemo(
    () => isPrimaryAdminUser(currentUser),
    [currentUser]
  );
  const authToken = String(currentUser?.token || '').trim();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusUserId = useMemo(
    () => String(searchParams.get('focusUser') || '').trim(),
    [searchParams]
  );
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({
    customer: 0,
    staff: 0,
    admin: 0,
    dashboardAccess: 0,
    active: 0,
    blocked: 0,
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [submittingUserId, setSubmittingUserId] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [userOverviewOpen, setUserOverviewOpen] = useState(false);
  const [userOverviewLoading, setUserOverviewLoading] = useState(false);
  const [userOverviewError, setUserOverviewError] = useState('');
  const [selectedUserOverview, setSelectedUserOverview] = useState(null);
  const [userWalletMode, setUserWalletMode] = useState('adjust');
  const [userWalletBalance, setUserWalletBalance] = useState('');
  const [userWalletDelta, setUserWalletDelta] = useState('');
  const [userWalletReason, setUserWalletReason] = useState('');
  const [userMessageTitle, setUserMessageTitle] = useState('');
  const [userMessageBody, setUserMessageBody] = useState('');
  const [userMessageActionUrl, setUserMessageActionUrl] = useState('/notifications');
  const [userMessagePriority, setUserMessagePriority] = useState('normal');
  const [userMessageCategory, setUserMessageCategory] = useState('system');
  const [userTransactionNote, setUserTransactionNote] = useState('');
  const [userOverviewActionBusy, setUserOverviewActionBusy] = useState('');

  const loadUsers = useCallback(
    async ({
      silent = false,
      searchOverride = '',
      roleOverride = 'all',
      statusOverride = 'all',
    } = {}) => {
      if (!isPrimaryAdmin) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        if (!authToken) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const activeSearch =
          typeof searchOverride === 'string' ? searchOverride : '';
        const activeRole =
          typeof roleOverride === 'string' ? roleOverride : 'all';
        const activeStatus =
          typeof statusOverride === 'string' ? statusOverride : 'all';

        const response = await axios.get('/api/admin/users/roles', {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
          params: {
            search: activeSearch || undefined,
            role: activeRole !== 'all' ? activeRole : undefined,
            status: activeStatus !== 'all' ? activeStatus : undefined,
            limit: 60,
          },
        });

        if (!response?.data?.success) {
          throw new Error(
            response?.data?.message || 'Unable to load users for role management'
          );
        }

        const payload = response.data.data || {};
        setUsers(Array.isArray(payload.users) ? payload.users : []);
        setCounts({
          customer: Number(payload.counts?.customer || 0),
          staff: Number(payload.counts?.staff || 0),
          admin: Number(payload.counts?.admin || 0),
          dashboardAccess: Number(payload.counts?.dashboardAccess || 0),
          active: Number(payload.counts?.active || 0),
          blocked: Number(payload.counts?.blocked || 0),
        });
        setError('');
        setLastUpdatedAt(new Date().toISOString());
      } catch (loadError) {
        const message =
          loadError.response?.data?.message ||
          loadError.message ||
          'Unable to load users for user management';
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authToken, isPrimaryAdmin]
  );

  useEffect(() => {
    if (!isPrimaryAdmin) {
      return undefined;
    }

    loadUsers({
      searchOverride: '',
      roleOverride: 'all',
      statusOverride: 'all',
    });
    return undefined;
  }, [isPrimaryAdmin, loadUsers]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    loadUsers({
      searchOverride: search,
      roleOverride: roleFilter,
      statusOverride: statusFilter,
    });
  };

  const handleRoleFilterChange = (nextFilter) => {
    setRoleFilter(nextFilter);
    loadUsers({
      searchOverride: search,
      roleOverride: nextFilter,
      statusOverride: statusFilter,
    });
  };

  const handleStatusFilterChange = (nextFilter) => {
    setStatusFilter(nextFilter);
    loadUsers({
      searchOverride: search,
      roleOverride: roleFilter,
      statusOverride: nextFilter,
    });
  };

  const updateUserAccess = async (
    userItem,
    {
      nextRole = getPrimaryWorkspaceRole(userItem),
      nextAdminDashboardAccess = userItem?.canAccessAdminDashboard,
    } = {}
  ) => {
    if (!userItem?.id || !nextRole) return;

    try {
      if (!authToken) {
        throw new Error('Admin session expired. Please sign in again.');
      }

      setSubmittingUserId(userItem.id);
      setError('');

      const response = await axios.patch(
        `/api/admin/users/${userItem.id}/role`,
        {
          role: nextRole,
          adminDashboardAccess: nextAdminDashboardAccess,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
        }
      );

      if (!response?.data?.success) {
        throw new Error(response?.data?.message || 'Unable to update user role');
      }

      const updatedUser = response.data.data?.user;
      if (updatedUser?.id) {
        setUsers((previousUsers) =>
          previousUsers.map((userItem) =>
            userItem.id === updatedUser.id ? updatedUser : userItem
          )
        );
      }

      toast.success(response?.data?.message || 'User access updated');
      await loadUsers({
        silent: true,
        searchOverride: search,
        roleOverride: roleFilter,
        statusOverride: statusFilter,
      });
    } catch (updateError) {
      const message =
        updateError.response?.data?.message ||
        updateError.message ||
        'Unable to update user access';
      setError(message);
      toast.error(message);
    } finally {
      setSubmittingUserId('');
    }
  };

  const handleRoleChange = async (userItem, nextRole) => {
    await updateUserAccess(userItem, {
      nextRole,
      nextAdminDashboardAccess: userItem?.canAccessAdminDashboard,
    });
  };

  const handleAdminDashboardAccessChange = async (
    userItem,
    nextDashboardAccess
  ) => {
    if (!userItem?.id) return;

    const shouldProceed = window.confirm(
      nextDashboardAccess
        ? 'Grant admin dashboard access to this user?'
        : 'Remove admin dashboard access from this user?'
    );

    if (!shouldProceed) {
      return;
    }

    await updateUserAccess(userItem, {
      nextRole: getPrimaryWorkspaceRole(userItem),
      nextAdminDashboardAccess: nextDashboardAccess,
    });
  };

  const handleStatusChange = async (userId, nextBlockedState) => {
    if (!userId) return;

    const shouldProceed = window.confirm(
      nextBlockedState
        ? 'Block this user from accessing their account?'
        : 'Reactivate this user account?'
    );

    if (!shouldProceed) {
      return;
    }

    try {
      if (!authToken) {
        throw new Error('Admin session expired. Please sign in again.');
      }

      setSubmittingUserId(userId);
      setError('');

      const response = await axios.patch(
        `/api/admin/users/${userId}/status`,
        { blocked: nextBlockedState },
        {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
        }
      );

      if (!response?.data?.success) {
        throw new Error(
          response?.data?.message || 'Unable to update user status'
        );
      }

      const updatedUser = response.data.data?.user;
      if (updatedUser?.id) {
        setUsers((previousUsers) =>
          previousUsers.map((userItem) =>
            userItem.id === updatedUser.id ? updatedUser : userItem
          )
        );
      }

      toast.success(response?.data?.message || 'User status updated');
      await loadUsers({
        silent: true,
        searchOverride: search,
        roleOverride: roleFilter,
        statusOverride: statusFilter,
      });
    } catch (updateError) {
      const message =
        updateError.response?.data?.message ||
        updateError.message ||
        'Unable to update user status';
      setError(message);
      toast.error(message);
    } finally {
      setSubmittingUserId('');
    }
  };

  const handleSendUserPushTest = async (userItem) => {
    if (!userItem?.id) return;

    try {
      if (!authToken) {
        throw new Error('Admin session expired. Please sign in again.');
      }

      setSubmittingUserId(userItem.id);
      setError('');

      const response = await axios.post(
        `/api/admin/users/${userItem.id}/push-test`,
        {
          source: 'admin-user-manager',
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
        }
      );

      if (!response?.data?.success) {
        throw new Error(
          response?.data?.message || 'Unable to send push test notification'
        );
      }

      const dispatchResult = response?.data?.data?.dispatchResult || {};
      const ticketErrors = Array.isArray(dispatchResult?.ticketErrors)
        ? dispatchResult.ticketErrors
        : [];
      const receiptErrors = Array.isArray(dispatchResult?.receiptErrors)
        ? dispatchResult.receiptErrors
        : [];
      const firstError =
        ticketErrors[0]?.message ||
        ticketErrors[0]?.details?.error ||
        receiptErrors[0]?.message ||
        receiptErrors[0]?.details?.error ||
        '';

      console.log('[push-test] dispatch result', dispatchResult);

      if (ticketErrors.length || receiptErrors.length) {
        const diagnosticMessage =
          firstError ||
          response?.data?.message ||
          'Push delivery issues were detected.';
        setError(diagnosticMessage);
        toast.error(diagnosticMessage);
        return;
      }

      toast.success(
        response?.data?.message ||
          `Push test sent to ${userItem.emailAddress || 'user'}`
      );
    } catch (pushError) {
      const statusCode = Number(pushError?.response?.status || 0);
      const message =
        statusCode === 404
          ? 'Push test endpoint was not found. Restart/deploy the backend so /api/admin/users/:userId/push-test is available.'
          : pushError.response?.data?.message ||
            pushError.message ||
            'Unable to send push test notification';
      setError(message);
      toast.error(message);
    } finally {
      setSubmittingUserId('');
    }
  };

  const resetOverviewForms = useCallback(() => {
    setUserWalletMode('adjust');
    setUserWalletBalance('');
    setUserWalletDelta('');
    setUserWalletReason('');
    setUserMessageTitle('');
    setUserMessageBody('');
    setUserMessageActionUrl('/notifications');
    setUserMessagePriority('normal');
    setUserMessageCategory('system');
    setUserTransactionNote('');
  }, []);

  const closeUserOverview = useCallback(() => {
    setUserOverviewOpen(false);
    setSelectedUserOverview(null);
    setUserOverviewError('');
    setUserOverviewLoading(false);
    setUserOverviewActionBusy('');
    resetOverviewForms();
  }, [resetOverviewForms]);

  const openUserOverview = useCallback(
    async (userItem) => {
      const userId = String(userItem?.id || '').trim();
      if (!userId) return;

      setUserOverviewOpen(true);
      setSelectedUserOverview(null);
      setUserOverviewLoading(true);
      setUserOverviewError('');
      resetOverviewForms();

      try {
        if (!authToken) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        const response = await axios.get(`/api/admin/users/${userId}/overview`, {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: networkTimeout,
          params: { limit: 8 },
        });

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to load user overview');
        }

        const payload = response?.data?.data || null;
        setSelectedUserOverview(payload);
        setUserWalletBalance(
          payload?.wallet?.balance !== null && typeof payload?.wallet?.balance !== 'undefined'
            ? String(payload.wallet.balance)
            : ''
        );
      } catch (overviewError) {
        const message =
          overviewError?.response?.data?.message ||
          overviewError?.message ||
          'Failed to load user overview';
        setUserOverviewError(message);
        toast.error(message);
      } finally {
        setUserOverviewLoading(false);
      }
    },
    [authToken, resetOverviewForms]
  );

  useEffect(() => {
    if (!focusUserId || userOverviewOpen || !users.length) {
      return;
    }

    const matchUser = users.find(
      (userItem) => String(userItem.id || '').trim() === focusUserId
    );

    if (matchUser) {
      openUserOverview(matchUser);
    }
  }, [focusUserId, openUserOverview, userOverviewOpen, users]);

  const submitUserWallet = useCallback(
    async (event) => {
      event.preventDefault();
      const userId = String(selectedUserOverview?.user?.id || '').trim();
      if (!userId) return;

      try {
        if (!authToken) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        setUserOverviewActionBusy('wallet');
        const payload =
          userWalletMode === 'set'
            ? {
                mode: 'set',
                balance: userWalletBalance,
                reason: userWalletReason,
              }
            : {
                mode: 'adjust',
                delta: userWalletDelta,
                reason: userWalletReason,
              };

        const response = await axios.patch(`/api/admin/users/${userId}/wallet`,
          payload,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: networkTimeout,
          }
        );

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to update wallet');
        }

        toast.success(response?.data?.message || 'Wallet updated');
        await openUserOverview({ id: userId });
        await loadUsers({
          silent: true,
          searchOverride: search,
          roleOverride: roleFilter,
          statusOverride: statusFilter,
        });
      } catch (walletError) {
        const message =
          walletError?.response?.data?.message ||
          walletError?.message ||
          'Failed to update wallet';
        toast.error(message);
        setUserOverviewError(message);
      } finally {
        setUserOverviewActionBusy('');
      }
    },
    [
      authToken,
      loadUsers,
      openUserOverview,
      roleFilter,
      search,
      selectedUserOverview?.user?.id,
      statusFilter,
      userWalletBalance,
      userWalletDelta,
      userWalletMode,
      userWalletReason,
    ]
  );

  const submitUserMessage = useCallback(
    async (event) => {
      event.preventDefault();
      const userId = String(selectedUserOverview?.user?.id || '').trim();
      if (!userId || !userMessageTitle.trim() || !userMessageBody.trim()) return;

      try {
        if (!authToken) {
          throw new Error('Admin session expired. Please sign in again.');
        }

        setUserOverviewActionBusy('message');
        const response = await axios.post(
          `/api/admin/users/${userId}/message`,
          {
            title: userMessageTitle.trim(),
            message: userMessageBody.trim(),
            actionUrl: userMessageActionUrl.trim() || '/notifications',
            priority: userMessagePriority,
            category: userMessageCategory,
          },
          {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: networkTimeout,
          }
        );

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to send message');
        }

        toast.success(response?.data?.message || 'Message sent successfully');
        setUserMessageTitle('');
        setUserMessageBody('');
      } catch (messageError) {
        const message =
          messageError?.response?.data?.message ||
          messageError?.message ||
          'Failed to send message';
        toast.error(message);
        setUserOverviewError(message);
      } finally {
        setUserOverviewActionBusy('');
      }
    },
    [
      authToken,
      selectedUserOverview?.user?.id,
      userMessageActionUrl,
      userMessageBody,
      userMessageCategory,
      userMessagePriority,
      userMessageTitle,
    ]
  );

  const submitUserTransactionAction = useCallback(
    async (transaction, nextAction) => {
      const transactionId = String(
        transaction?._id || transaction?.id || transaction?.reference || ''
      ).trim();
      if (!transactionId) return;

      const confirmMessage =
        nextAction === 'success'
          ? 'Mark this transaction as successful?'
          : nextAction === 'refund'
            ? 'Refund this transaction and return the wallet debit?'
            : 'Mark this transaction as failed?';

      if (!window.confirm(confirmMessage)) return;

      try {
        setUserOverviewActionBusy(`transaction:${transactionId}:${nextAction}`);
        const response = await axios.patch(
          `/api/admin/transactions/${encodeURIComponent(transactionId)}/status`,
          {
            status: nextAction,
            action: nextAction,
            note: userTransactionNote.trim() || undefined,
            reason: userTransactionNote.trim() || undefined,
          },
          {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: networkTimeout,
          }
        );

        if (!response?.data?.success) {
          throw new Error(response?.data?.message || 'Failed to update transaction');
        }

        toast.success(response?.data?.message || 'Transaction updated');
        setUserTransactionNote('');
        if (selectedUserOverview?.user?.id) {
          await openUserOverview({ id: selectedUserOverview.user.id });
        }
        await loadUsers({
          silent: true,
          searchOverride: search,
          roleOverride: roleFilter,
          statusOverride: statusFilter,
        });
      } catch (transactionError) {
        const message =
          transactionError?.response?.data?.message ||
          transactionError?.message ||
          'Failed to update transaction';
        toast.error(message);
        setUserOverviewError(message);
      } finally {
        setUserOverviewActionBusy('');
      }
    },
    [
      authToken,
      loadUsers,
      openUserOverview,
      roleFilter,
      search,
      selectedUserOverview?.user?.id,
      statusFilter,
      userTransactionNote,
    ]
  );

  if (!isPrimaryAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString('en-NG')
    : 'N/A';

  return (
    <div className="content admin-role-manager-page">
      <Row className="mb-4">
        <Col xs="12">
          <Card className="shadow-sm border-0 user-manager-intro-card">
            <CardHeader className="d-flex flex-wrap justify-content-between align-items-center gap-3">
              <div>
                <CardTitle tag="h2" className="mb-1">
                  User Manager
                </CardTitle>
                <div className="text-muted small">
                  Manage workspace roles, admin dashboard access, and account
                  status from one primary-admin workspace.
                </div>
              </div>
              <Button
                color="info"
                size="sm"
                onClick={() =>
                  loadUsers({
                    silent: true,
                    searchOverride: search,
                    roleOverride: roleFilter,
                    statusOverride: statusFilter,
                  })
                }
                disabled={refreshing}
              >
                {refreshing ? (
                  <>
                    <Spinner size="sm" /> Refreshing...
                  </>
                ) : (
                  'Refresh Users'
                )}
              </Button>
            </CardHeader>
            <CardBody>
              Keep the primary admin locked to `admin` plus `admin-dashboard`,
              assign workspace roles here, and grant or revoke dashboard access
              separately when needed.
            </CardBody>
          </Card>
        </Col>
      </Row>

      {error ? (
        <Row className="mb-4">
          <Col xs="12">
            <Alert color="warning" className="mb-0">
              {error}
            </Alert>
          </Col>
        </Row>
      ) : null}

      <Row className="mb-4">
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--customers">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-single-02" />
              </div>
              <div className="user-manager-stat-label">Customers</div>
              <div className="user-manager-stat-value">{counts.customer}</div>
              <div className="user-manager-stat-caption">
                Registered customer accounts
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--staff">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-badge" />
              </div>
              <div className="user-manager-stat-label">Staff</div>
              <div className="user-manager-stat-value text-info">{counts.staff}</div>
              <div className="user-manager-stat-caption">
                Team members with staff access
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--admins">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-shape-star" />
              </div>
              <div className="user-manager-stat-label">Admins</div>
              <div className="user-manager-stat-value text-danger">{counts.admin}</div>
              <div className="user-manager-stat-caption">
                Elevated administrative accounts
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--dashboard">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-lock-circle" />
              </div>
              <div className="user-manager-stat-label">Dashboard Access</div>
              <div className="user-manager-stat-value text-primary">
                {counts.dashboardAccess}
              </div>
              <div className="user-manager-stat-caption">
                Users allowed into the admin workspace
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--active">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-check-2" />
              </div>
              <div className="user-manager-stat-label">Active</div>
              <div className="user-manager-stat-value text-success">{counts.active}</div>
              <div className="user-manager-stat-caption">
                Ready-to-login user accounts
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col lg="4" md="6" className="mb-3">
          <Card className="shadow-sm border-0 h-100 user-manager-stat-card user-manager-stat-card--blocked">
            <CardBody className="user-manager-stat-card-body">
              <div className="user-manager-stat-icon">
                <i className="tim-icons icon-alert-circle-exc" />
              </div>
              <div className="user-manager-stat-label">Blocked</div>
              <div className="user-manager-stat-value text-warning">{counts.blocked}</div>
              <div className="user-manager-stat-caption">
                Restricted and paused accounts
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col xs="12">
          <Card className="shadow-sm border-0 user-manager-list-card">
            <CardHeader>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div>
                  <CardTitle tag="h4" className="mb-1">
                    Manage Users
                  </CardTitle>
                  <div className="text-muted small">
                    Showing {users.length} user{users.length === 1 ? '' : 's'} |
                    Last updated: {lastUpdatedLabel}
                  </div>
                </div>
                <Badge color="light" className="border text-dark px-3 py-2">
                  Primary admin only
                </Badge>
              </div>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSearchSubmit} className="user-manager-filter-panel">
                <div className="user-manager-filter-panel-head">
                  <div>
                    <div className="user-manager-filter-kicker">Quick filters</div>
                    <div className="user-manager-filter-subtitle">
                      Search users, narrow by role or status, and refresh in one place.
                    </div>
                  </div>
                  <Badge color="light" className="border text-dark px-3 py-2">
                    Live user list
                  </Badge>
                </div>

                <Row className="g-3 user-manager-filter-grid">
                  <Col lg="5" md="6" className="mb-3 mb-lg-0">
                    <FormGroup className="mb-0 user-manager-filter-field">
                      <Label>Find user</Label>
                      <InputGroup className="user-manager-filter-input-group">
                        <InputGroupText className="user-manager-filter-input-addon">
                          <i className="tim-icons icon-zoom-split" />
                        </InputGroupText>
                        <Input
                          type="text"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Name, email, or phone"
                          className="user-manager-filter-input"
                        />
                      </InputGroup>
                    </FormGroup>
                  </Col>
                  <Col lg="3" md="6" className="mb-3 mb-lg-0">
                    <FormGroup className="mb-0 user-manager-filter-field">
                      <Label>Filter by role or access</Label>
                      <Input
                        type="select"
                        value={roleFilter}
                        onChange={(event) =>
                          handleRoleFilterChange(event.target.value)
                        }
                        className="user-manager-filter-input user-manager-filter-select"
                      >
                        <option value="all">All roles</option>
                        <option value="customer">Customers</option>
                        <option value="staff">Staff</option>
                        <option value="admin">Admins</option>
                        <option value={ADMIN_DASHBOARD_ROLE}>
                          Dashboard access
                        </option>
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col lg="3" md="6" className="mb-3 mb-lg-0">
                    <FormGroup className="mb-0 user-manager-filter-field">
                      <Label>Filter by status</Label>
                      <Input
                        type="select"
                        value={statusFilter}
                        onChange={(event) =>
                          handleStatusFilterChange(event.target.value)
                        }
                        className="user-manager-filter-input user-manager-filter-select"
                      >
                        <option value="all">All statuses</option>
                        <option value="active">Active</option>
                        <option value="blocked">Blocked</option>
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col lg="1" className="mb-3 mb-lg-0 d-flex align-items-end">
                    <div className="d-flex flex-wrap gap-2 user-manager-filter-actions">
                      <Button color="primary" type="submit" disabled={loading}>
                        Search
                      </Button>
                      <Button
                        color="secondary"
                        outline
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setSearch('');
                          setRoleFilter('all');
                          setStatusFilter('all');
                          loadUsers({
                            searchOverride: '',
                            roleOverride: 'all',
                            statusOverride: 'all',
                          });
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </Col>
                </Row>
              </form>

              {loading ? (
                <div className="text-center py-5">
                  <Spinner />
                  <div className="mt-2 text-muted">
                    Loading users for role management...
                  </div>
                </div>
              ) : users.length ? (
                <Row>
                  {users.map((userItem) => (
                    <Col lg="6" xl="4" className="mb-4" key={userItem.id}>
                      <Card className="shadow-sm border h-100 user-manager-user-card">
                        <CardBody className="user-manager-user-card-body">
                          <div className="user-manager-user-card-head">
                            <div className="user-manager-user-card-identity">
                              <div className="user-manager-user-card-name">
                                {userItem.fullName || 'Unnamed user'}
                              </div>
                              <div className="user-manager-user-card-email">
                                {userItem.emailAddress}
                              </div>
                            </div>
                          </div>

                          <div className="user-manager-user-card-badges">
                            {userItem.roles.map((roleName) => (
                              <Badge
                                key={`${userItem.id}-${roleName}`}
                                color={getRoleBadgeColor(roleName)}
                                pill
                                className="px-3 py-2"
                              >
                                {formatRoleBadgeLabel(
                                  roleName,
                                  userItem.isPrimaryAdmin
                                )}
                              </Badge>
                            ))}
                            <Badge
                              color={getStatusBadgeColor(userItem.blocked)}
                              pill
                              className="px-3 py-2"
                            >
                              {userItem.blocked ? 'Blocked' : 'Active'}
                            </Badge>
                          </div>

                          <div className="user-manager-user-card-meta">
                            {userItem.phoneNumber ? (
                              <div className="user-manager-user-card-meta-row">
                                <span>Phone</span>
                                <strong>{userItem.phoneNumber}</strong>
                              </div>
                            ) : null}
                            <div className="user-manager-user-card-meta-row">
                              <span>Joined</span>
                              <strong>{formatUserDateTime(userItem.createdAt)}</strong>
                            </div>
                            <div className="user-manager-user-card-meta-row">
                              <span>Updated</span>
                              <strong>{formatUserDateTime(userItem.lastUpdated)}</strong>
                            </div>
                          </div>

                          {userItem.isPrimaryAdmin ? (
                            <>
                              <Alert color="light" className="mb-3 user-manager-user-card-alert">
                                This account stays locked as the main admin.
                              </Alert>
                              <div className="user-manager-user-card-actions">
                                <Button
                                  color="info"
                                  outline
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() => handleSendUserPushTest(userItem)}
                                >
                                  Send Test Push
                                </Button>
                                <Button
                                  color="primary"
                                  outline
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() => openUserOverview(userItem)}
                                >
                                  View Wallet & Transactions
                                </Button>
                              </div>

                              {submittingUserId === userItem.id ? (
                                <div className="d-flex align-items-center gap-2 small mt-2 text-muted">
                                  <Spinner size="sm" />
                                  Sending push test...
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <FormGroup className="mb-3">
                                <Label>Workspace role</Label>
                                <Input
                                  type="select"
                                  value={getPrimaryWorkspaceRole(userItem)}
                                  onChange={(event) =>
                                    handleRoleChange(userItem, event.target.value)
                                  }
                                  disabled={submittingUserId === userItem.id}
                                >
                                  {getPrimaryWorkspaceRole(userItem) === 'admin' ? (
                                    <option value="admin" disabled>
                                      Admin (legacy)
                                    </option>
                                  ) : null}
                                  <option value="customer">Customer</option>
                                  <option value="staff">Staff</option>
                                </Input>
                              </FormGroup>

                              <div className="user-manager-user-card-actions">
                                <Button
                                  color="primary"
                                  outline
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() => openUserOverview(userItem)}
                                >
                                  View Wallet & Transactions
                                </Button>
                                <Button
                                  color={
                                    userItem.canAccessAdminDashboard
                                      ? 'primary'
                                      : 'secondary'
                                  }
                                  outline={!userItem.canAccessAdminDashboard}
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() =>
                                    handleAdminDashboardAccessChange(
                                      userItem,
                                      !userItem.canAccessAdminDashboard
                                    )
                                  }
                                >
                                  {userItem.canAccessAdminDashboard
                                    ? 'Remove Dashboard Access'
                                    : 'Grant Dashboard Access'}
                                </Button>
                                <Button
                                  color={userItem.blocked ? 'success' : 'danger'}
                                  outline={userItem.blocked}
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() =>
                                    handleStatusChange(
                                      userItem.id,
                                      !userItem.blocked
                                    )
                                  }
                                >
                                  {userItem.blocked ? 'Unblock User' : 'Block User'}
                                </Button>
                                <Button
                                  color="info"
                                  outline
                                  size="sm"
                                  type="button"
                                  disabled={submittingUserId === userItem.id}
                                  onClick={() => handleSendUserPushTest(userItem)}
                                >
                                  Send Test Push
                                </Button>
                              </div>

                              {submittingUserId === userItem.id ? (
                                <div className="d-flex align-items-center gap-2 small mt-2 text-muted">
                                  <Spinner size="sm" />
                                  Processing action...
                                </div>
                              ) : null}
                            </>
                          )}
                        </CardBody>
                      </Card>
                    </Col>
                  ))}
                </Row>
              ) : (
                <Alert color="light" className="mb-0">
                  No users matched the current search.
                </Alert>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <UserOverviewModal
        isOpen={userOverviewOpen}
        onClose={closeUserOverview}
        loading={userOverviewLoading}
        error={userOverviewError}
        overview={selectedUserOverview}
        actionBusy={userOverviewActionBusy}
        walletMode={userWalletMode}
        onWalletModeChange={setUserWalletMode}
        walletBalance={userWalletBalance}
        onWalletBalanceChange={setUserWalletBalance}
        walletDelta={userWalletDelta}
        onWalletDeltaChange={setUserWalletDelta}
        walletReason={userWalletReason}
        onWalletReasonChange={setUserWalletReason}
        messageTitle={userMessageTitle}
        onMessageTitleChange={setUserMessageTitle}
        messageBody={userMessageBody}
        onMessageBodyChange={setUserMessageBody}
        messageActionUrl={userMessageActionUrl}
        onMessageActionUrlChange={setUserMessageActionUrl}
        messagePriority={userMessagePriority}
        onMessagePriorityChange={setUserMessagePriority}
        messageCategory={userMessageCategory}
        onMessageCategoryChange={setUserMessageCategory}
        transactionNote={userTransactionNote}
        onTransactionNoteChange={setUserTransactionNote}
        onSubmitWallet={submitUserWallet}
        onSubmitMessage={submitUserMessage}
        onTransactionAction={submitUserTransactionAction}
        onOpenTransactions={() =>
          navigate(
            `/admin/transactions?userId=${encodeURIComponent(
              selectedUserOverview?.user?.id || ''
            )}`
          )
        }
        onRefresh={() =>
          selectedUserOverview?.user?.id
            ? openUserOverview({ id: selectedUserOverview.user.id })
            : undefined
        }
      />
    </div>
  );
}

export default UserManager;
