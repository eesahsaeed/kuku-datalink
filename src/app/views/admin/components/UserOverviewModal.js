import React from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Col,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
} from 'components/ui/primitives';

const money = (value = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateTime = (value) => {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleString('en-NG');
  } catch {
    return String(value);
  }
};

const getStatusColor = (status = '') => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['success', 'successful', 'completed'].includes(normalized)) return 'success';
  if (['refund', 'refunded', 'reversed', 'reversal'].includes(normalized)) return 'warning';
  if (['failed', 'failure', 'error', 'rejected', 'declined'].includes(normalized)) return 'danger';
  if (['processing', 'pending', 'queued'].includes(normalized)) return 'info';
  return 'secondary';
};

const getTypeColor = (type = '') => {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'data') return 'primary';
  if (normalized === 'airtime') return 'warning';
  if (normalized === 'wallet-adjustment') return 'dark';
  if (normalized === 'tv') return 'info';
  if (normalized === 'electricity') return 'success';
  return 'secondary';
};

const getRecipient = (transaction = {}) =>
  String(
    transaction?.recipientPhone ||
      transaction?.recipientMeterNumber ||
      transaction?.recipientSmartCardNumber ||
      transaction?.metadata?.recipient ||
      ''
  ).trim() || 'N/A';

function UserOverviewModal({
  isOpen,
  onClose,
  loading,
  error,
  overview,
  actionBusy,
  walletMode,
  onWalletModeChange,
  walletBalance,
  onWalletBalanceChange,
  walletDelta,
  onWalletDeltaChange,
  walletReason,
  onWalletReasonChange,
  messageTitle,
  onMessageTitleChange,
  messageBody,
  onMessageBodyChange,
  messageActionUrl,
  onMessageActionUrlChange,
  messagePriority,
  onMessagePriorityChange,
  messageCategory,
  onMessageCategoryChange,
  transactionNote,
  onTransactionNoteChange,
  onSubmitWallet,
  onSubmitMessage,
  onTransactionAction,
  onOpenTransactions,
  onRefresh,
}) {
  const user = overview?.user || {};
  const wallet = overview?.wallet || null;
  const transactions = Array.isArray(overview?.transactions) ? overview.transactions : [];
  const summary = overview?.summary || {};
  const isLocked = Boolean(user?.isPrimaryAdmin);

  return (
    <Modal isOpen={isOpen} toggle={onClose} size="xl">
      <ModalHeader toggle={onClose}>User wallet, messages, and transactions</ModalHeader>
      <ModalBody>
        {error ? (
          <Alert color="danger" className="mb-3">
            {error}
          </Alert>
        ) : null}

        {loading && !overview ? (
          <div className="text-center py-5">
            <Spinner />
            <div className="mt-2 text-muted">Loading user overview...</div>
          </div>
        ) : overview ? (
          <>
            <Row className="g-3">
              <Col lg="5" xs="12">
                <Card className="border shadow-sm h-100 user-overview-summary-card">
                  <CardBody>
                    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                      <div>
                        <div className="fw-bold fs-5">{user.fullName || 'Unnamed user'}</div>
                        <div className="text-muted small">{user.emailAddress || 'N/A'}</div>
                        <div className="text-muted small">{user.phoneNumber || 'No phone number'}</div>
                      </div>
                      <Button color="info" outline type="button" onClick={onOpenTransactions}>
                        Open Transactions
                      </Button>
                    </div>

                    <div className="d-flex gap-2 mb-3">
                      <Card className="border flex-fill user-overview-mini-card">
                        <CardBody>
                          <div className="text-muted small">Wallet balance</div>
                          <div className="fw-bold fs-4">
                            {wallet ? money(wallet.balance) : 'N/A'}
                          </div>
                          <div className="text-muted small">
                            {wallet?.currency || 'NGN'} | {wallet?.status || 'active'}
                          </div>
                        </CardBody>
                      </Card>
                      <Card className="border flex-fill user-overview-mini-card">
                        <CardBody>
                          <div className="text-muted small">Recent tx</div>
                          <div className="fw-bold fs-4">
                            {transactions.length}
                          </div>
                          <div className="text-muted small">
                            {summary.successCount || 0} successful
                          </div>
                        </CardBody>
                      </Card>
                    </div>

                    {isLocked ? (
                      <Alert color="light" className="mb-3">
                        This is the primary admin account. Wallet edits are locked, but you can still inspect transactions and send messages.
                      </Alert>
                    ) : null}

                    <FormGroup className="mb-3">
                      <Label>Wallet action mode</Label>
                      <Input
                        type="select"
                        value={walletMode}
                        onChange={(event) => onWalletModeChange(event.target.value)}
                        disabled={actionBusy === 'wallet' || isLocked}
                      >
                        <option value="adjust">Adjust balance</option>
                        <option value="set">Set exact balance</option>
                      </Input>
                    </FormGroup>

                    <form onSubmit={onSubmitWallet}>
                      {walletMode === 'set' ? (
                        <FormGroup className="mb-3">
                          <Label>New wallet balance</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={walletBalance}
                            onChange={(event) => onWalletBalanceChange(event.target.value)}
                            disabled={actionBusy === 'wallet' || isLocked}
                          />
                        </FormGroup>
                      ) : (
                        <FormGroup className="mb-3">
                          <Label>Balance adjustment</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={walletDelta}
                            onChange={(event) => onWalletDeltaChange(event.target.value)}
                            placeholder="Use positive for credit, negative for debit"
                            disabled={actionBusy === 'wallet' || isLocked}
                          />
                        </FormGroup>
                      )}

                      <FormGroup className="mb-3">
                        <Label>Wallet note</Label>
                        <Input
                          type="textarea"
                          rows="3"
                          value={walletReason}
                          onChange={(event) => onWalletReasonChange(event.target.value)}
                          placeholder="Optional internal note for the wallet update"
                          disabled={actionBusy === 'wallet' || isLocked}
                        />
                      </FormGroup>

                      <Button
                        color="primary"
                        type="submit"
                        disabled={actionBusy === 'wallet' || isLocked}
                      >
                        {actionBusy === 'wallet' ? <Spinner size="sm" /> : 'Save Wallet Change'}
                      </Button>
                    </form>
                  </CardBody>
                </Card>
              </Col>

              <Col lg="7" xs="12">
                <Card className="border shadow-sm h-100 user-overview-message-card">
                  <CardBody>
                    <CardTitle tag="h5" className="mb-3">
                      Send user message
                    </CardTitle>

                    <form onSubmit={onSubmitMessage}>
                      <Row className="g-3">
                        <Col md="6" xs="12">
                          <FormGroup>
                            <Label>Title</Label>
                            <Input
                              type="text"
                              value={messageTitle}
                              onChange={(event) => onMessageTitleChange(event.target.value)}
                              placeholder="Message title"
                              disabled={actionBusy === 'message'}
                            />
                          </FormGroup>
                        </Col>
                        <Col md="6" xs="12">
                          <FormGroup>
                            <Label>Priority</Label>
                            <Input
                              type="select"
                              value={messagePriority}
                              onChange={(event) => onMessagePriorityChange(event.target.value)}
                              disabled={actionBusy === 'message'}
                            >
                              <option value="low">Low</option>
                              <option value="normal">Normal</option>
                              <option value="high">High</option>
                            </Input>
                          </FormGroup>
                        </Col>
                        <Col md="6" xs="12">
                          <FormGroup>
                            <Label>Action URL</Label>
                            <Input
                              type="text"
                              value={messageActionUrl}
                              onChange={(event) => onMessageActionUrlChange(event.target.value)}
                              placeholder="/notifications"
                              disabled={actionBusy === 'message'}
                            />
                          </FormGroup>
                        </Col>
                        <Col md="6" xs="12">
                          <FormGroup>
                            <Label>Category</Label>
                            <Input
                              type="text"
                              value={messageCategory}
                              onChange={(event) => onMessageCategoryChange(event.target.value)}
                              placeholder="system"
                              disabled={actionBusy === 'message'}
                            />
                          </FormGroup>
                        </Col>
                        <Col xs="12">
                          <FormGroup>
                            <Label>Message</Label>
                            <Input
                              type="textarea"
                              rows="5"
                              value={messageBody}
                              onChange={(event) => onMessageBodyChange(event.target.value)}
                              placeholder="Write the message the user will see"
                              disabled={actionBusy === 'message'}
                            />
                          </FormGroup>
                        </Col>
                      </Row>

                      <Button color="success" type="submit" disabled={actionBusy === 'message'}>
                        {actionBusy === 'message' ? <Spinner size="sm" /> : 'Send Message'}
                      </Button>
                    </form>

                    <div className="mt-4 user-overview-transactions-card">
                      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                        <CardTitle tag="h5" className="mb-0">
                          Recent transactions
                        </CardTitle>
                        <div className="d-flex flex-wrap gap-2">
                          <Button color="secondary" outline type="button" onClick={onRefresh}>
                            Refresh
                          </Button>
                          <Button color="secondary" outline type="button" onClick={onOpenTransactions}>
                            Open full workspace
                          </Button>
                        </div>
                      </div>

                      <FormGroup className="mb-3">
                        <Label>Transaction note</Label>
                        <Input
                          type="textarea"
                          rows="3"
                          value={transactionNote}
                          onChange={(event) => onTransactionNoteChange(event.target.value)}
                          placeholder="Optional note for status changes"
                          disabled={actionBusy.startsWith('transaction:')}
                        />
                      </FormGroup>

                      {transactions.length ? (
                        <div className="table-responsive">
                          <table className="table table-sm align-middle">
                            <thead>
                              <tr>
                                <th>Reference</th>
                                <th>Status</th>
                                <th>Amount</th>
                                <th>Type</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transactions.map((transaction) => {
                                const rowKey = String(transaction._id || transaction.reference || '');
                                return (
                                  <tr key={rowKey}>
                                    <td>
                                      <div className="fw-bold">
                                        {String(transaction.reference || '').trim() || 'N/A'}
                                      </div>
                                      <div className="text-muted small">{dateTime(transaction.createdAt)}</div>
                                      <div className="text-muted small">{getRecipient(transaction)}</div>
                                    </td>
                                    <td>
                                      <Badge color={getStatusColor(transaction.status)} pill>
                                        {String(transaction.status || 'pending')}
                                      </Badge>
                                    </td>
                                    <td>{money(transaction.amount)}</td>
                                    <td>
                                      <Badge color={getTypeColor(transaction.type)} pill>
                                        {String(transaction.type || 'transaction')}
                                      </Badge>
                                    </td>
                                    <td>
                                      <div className="d-flex flex-wrap gap-2">
                                        <Button
                                          color="success"
                                          size="sm"
                                          type="button"
                                          outline
                                          disabled={actionBusy === `transaction:${rowKey}:success`}
                                          onClick={() => onTransactionAction(transaction, 'success')}
                                        >
                                          Success
                                        </Button>
                                        <Button
                                          color="warning"
                                          size="sm"
                                          type="button"
                                          outline
                                          disabled={actionBusy === `transaction:${rowKey}:refund`}
                                          onClick={() => onTransactionAction(transaction, 'refund')}
                                        >
                                          Refund
                                        </Button>
                                        <Button
                                          color="danger"
                                          size="sm"
                                          type="button"
                                          outline
                                          disabled={actionBusy === `transaction:${rowKey}:failed`}
                                          onClick={() => onTransactionAction(transaction, 'failed')}
                                        >
                                          Failed
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Alert color="light" className="mb-0">
                          No recent transactions were found for this user.
                        </Alert>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </Col>
            </Row>
          </>
        ) : (
          <Alert color="light" className="mb-0">
            Select a user to inspect wallet and transaction details.
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" outline type="button" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default UserOverviewModal;
