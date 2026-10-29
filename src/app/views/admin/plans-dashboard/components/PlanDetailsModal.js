import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';

import {
  Alert,
  Button,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Modal,
  Row,
  Spinner,
  AmountInput
} from 'components/ui/primitives';
import {
  aidapayMargins,
  calculateMargins,
  ddsMargins,
  getUrl,
  getUser,
  networkTimeout,
} from '../../../../../lib/helper';
import { getPlanCode, getPlanName } from '../utils/plans';

/**
 * Component 1: Renders the inner modal form content with editable inputs & CRUD handlers
 */
export function PlanDetailsContent({
  plan,
  close = () => {},
  onPlanSaved,
  onPlanDeleted,
  isCreateMode = false,
}) {
  // console.log('PlanDetailsContent: plan=', plan);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    network: 'mtn',
    category: 'Other',
    durationGroup: 'Standard',
    originalPrice: 0,
    sellingPrice: 0,
    charges: 0,
    fee: 0,
    gain: 0,
    source: 'configured',
    isNew: false,
    exclude: false,
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const originalPrice = Number(formData.originalPrice || 0);
  const displayedSellingPrice = (() => {
    try {
      return Number(calculateMargins(formData));
    } catch (_error) {
      return Number(formData.sellingPrice || 0);
    }
  })();
  const sellingPriceColor =
    displayedSellingPrice > originalPrice
      ? '#198754'
      : displayedSellingPrice < originalPrice
        ? '#dc3545'
        : '#374151';

  useEffect(() => {
    if (plan && !isCreateMode) {
      const planCode = getPlanCode(plan);
      const originalPriceValue = Number(
        plan?.package_original_amount ?? plan?.originalPrice ?? 0
      );
      const originalPrice = Number.isFinite(originalPriceValue)
        ? originalPriceValue
        : 0;
      const calculatedMargins =
        originalPrice > 0
          ? String(plan?.source || '').trim().toLowerCase() === 'aidapay'
            ? aidapayMargins(originalPrice)
            : ddsMargins(originalPrice)
          : { charges: 0, fee: 0, gain: 0 };
      setFormData({
        id: planCode,
        package_api_code: String(
          plan?.package_api_code || plan?.package_code || planCode
        ).trim(),
        name: getPlanName(plan),
        network: plan?.network || plan?.provider_code || 'mtn',
        category: plan?.category || 'Other',
        durationGroup:
          plan?.durationGroup || plan?.duration_group || 'Standard',
        originalPrice,
        sellingPrice: Number(plan?.sellingPrice || 0),
        charges: Number(plan?.charges ?? calculatedMargins.charges ?? 0),
        fee: Number(plan?.fee ?? calculatedMargins.fee ?? 0),
        gain: Number(plan?.gain ?? calculatedMargins.gain ?? 0),
        source: plan?.source || 'configured',
        isNew: Boolean(plan?.isNew),
        exclude: Boolean(plan?.exclude),
      });
    } else {
      setFormData({
        id: '',
        package_api_code: '',
        name: '',
        network: 'mtn',
        category: 'Data',
        durationGroup: '30 Days',
        originalPrice: 0,
        sellingPrice: 0,
        charges: 0,
        fee: 0,
        gain: 0,
        source: 'configured',
        isNew: true,
        exclude: false,
      });
    }
    setConfirmDelete(false);
    setErrorMessage('');
  }, [plan, isCreateMode]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const getAuthToken = () => {
    const session = getUser();
    const token = session?.token;
    if (!token) throw new Error('Admin session expired. Please sign in again.');
    return token;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving || deleting) {
      return;
    }

    setSaving(true);
    setErrorMessage('');

    try {
      const token = getAuthToken();
      const planCode = getPlanCode(formData);
      const payload = {
        ...formData,
        id: planCode,
        package_api_code: formData.package_api_code || planCode,
      };
      const response = await axios.post(
        getUrl('/api/admin/plan/save'),
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: networkTimeout,
        }
      );

      toast.success(response?.data?.message || 'Plan saved successfully');
      onPlanSaved?.(response?.data?.data || payload);
      close();
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || 'Failed to save plan';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || saving) {
      return;
    }

    setDeleting(true);
    setErrorMessage('');

    try {
      const token = getAuthToken();
      await axios.delete(`/api/admin/plans/delete/${formData.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { id: formData.id },
        timeout: networkTimeout,
      });

      toast.success('Plan deleted successfully');
      if (onPlanDeleted) onPlanDeleted(formData.id);
      close();
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || 'Failed to delete plan';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0, // Allows flex child scrolling
        padding: 10
      }}
    >
      {/* Fixed Sticky Header */}
      <div className="d-flex justify-content-between align-items-center pb-2 mb-2 border-bottom flex-shrink-0">
        <h4 className="mb-0 fw-bold">
          {isCreateMode ? 'Create New Plan' : `Edit: ${formData.name || formData.id}`}
        </h4>
        {/* <AriaButton
          slot="close"
          className="btn-close"
          aria-label="Close dialog"
          onPress={close}
        /> */}
      </div>

      {/* Fully Scrollable Form Area */}
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          minHeight: 0,
          paddingRight: '4px',
        }}
      >
        {errorMessage ? (
          <Alert color="danger" className="py-2 my-2 small">
            {errorMessage}
          </Alert>
        ) : null}

        <Form id="plan-details-form" onSubmit={handleSave}>
          <Row className="py-1 pe-3">
            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Plan Code / ID</Label>
                <Input
                  type="text"
                  name="id"
                  value={formData.id}
                  onChange={handleInputChange}
                  placeholder="e.g. mtn-500mb-30days"
                  disabled={!isCreateMode}
                  required
                />
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Plan Name</Label>
                <Input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="e.g. MTN 500MB Data"
                  required
                />
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Network Provider</Label>
                <Input
                  type="select"
                  name="network"
                  value={formData.network}
                  onChange={handleInputChange}
                  disabled={true}
                >
                  <option value="mtn">MTN</option>
                  <option value="glo">GLO</option>
                  <option value="airtel">AIRTEL</option>
                  <option value="9mobile">9mobile</option>
                </Input>
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Category</Label>
                <Input
                  type="text"
                  name="category"
                  disabled
                  value={formData.category}
                  onChange={handleInputChange}
                  placeholder="e.g. SME, Corporate, Gifting"
                />
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Duration Group</Label>
                <Input
                  type="text"
                  name="durationGroup"
                  value={formData.durationGroup}
                  onChange={handleInputChange}
                  placeholder="e.g. Daily, Monthly"
                />
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Source Provider</Label>
                <Input
                  type="select"
                  name="source"
                  value={formData.source}
                  onChange={handleInputChange}
                  disabled
                >
                  <option value="configured">Configured</option>
                  <option value="aidapay">Aidapay</option>
                  <option value="directortech">Directortech</option>
                </Input>
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Original Price</Label>
                <AmountInput 
                  name="originalPrice" 
                  value={formData.originalPrice}
                  onChange={handleInputChange}
                  disabled={true}
                />
                {/* <div className="text-muted small mt-1">
                  Formatted: {formatNairaFromKobo(formData.originalPriceKobo)}
                </div> */}
              </FormGroup>
            </Col>

            <Col md="6">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Selling Price</Label>
                <AmountInput 
                  name="sellingPrice" 
                  value={displayedSellingPrice}
                  onChange={handleInputChange}
                  style={{ color: sellingPriceColor, fontWeight: 700 }}
                  disabled={false}
                />
                {/* <Input
                  type="number"
                  name="sellingPriceKobo"
                  value={formData.sellingPrice}
                  onChange={handleInputChange}
                  min="0"
                /> */}
                {/* <div className="text-muted small mt-1">
                  Formatted: {formatNairaFromKobo(formData.sellingPriceKobo)}
                </div> */}
              </FormGroup>
            </Col>

            <Col md="4">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Charges</Label>
                <AmountInput
                  name="charges"
                  value={formData.charges}
                  onChange={handleInputChange}
                  disabled={saving || deleting}
                />
              </FormGroup>
            </Col>

            <Col md="4">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Fee</Label>
                <AmountInput
                  name="fee"
                  value={formData.fee}
                  onChange={handleInputChange}
                  disabled={saving || deleting}
                />
              </FormGroup>
            </Col>

            <Col md="4">
              <FormGroup className="mb-2">
                <Label className="fw-semibold small">Gain</Label>
                <AmountInput
                  name="gain"
                  value={formData.gain}
                  onChange={handleInputChange}
                  disabled={saving || deleting}
                />
              </FormGroup>
            </Col>

            <Col xs="12" className="mt-2">
              <div className="d-flex align-items-center gap-4">
                <FormGroup check inline className="mb-0">
                  <Label check className="small">
                    <Input
                      type="checkbox"
                      name="isNew"
                      checked={formData.isNew}
                      onChange={handleInputChange}
                    />{' '}
                    Mark as New
                  </Label>
                </FormGroup>

                <FormGroup check inline className="mb-0">
                  <Label check className="small text-danger">
                    <Input
                      type="checkbox"
                      name="exclude"
                      checked={formData.exclude}
                      onChange={handleInputChange}
                    />{' '}
                    Exclude Plan
                  </Label>
                </FormGroup>
              </div>
            </Col>
          </Row>

          {confirmDelete ? (
            <Alert color="warning" className="mt-3 p-2 small">
              <div className="fw-bold mb-1">Delete this plan permanently?</div>
              <div className="d-flex gap-2 mt-2">
                <Button
                  color="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Spinner size="sm" /> : 'Yes, Delete'}
                </Button>
                <Button
                  color="secondary"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </Alert>
          ) : null}
        </Form>
      </div>

      {/* Fixed Sticky Footer */}
      <div className="d-flex justify-content-between align-items-center pt-3 mt-2 border-top flex-shrink-0">
        <div>
          {!isCreateMode && !confirmDelete ? (
            <Button
              color="outline-danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete Plan
            </Button>
          ) : null}
        </div>

        <div className="d-flex">
          <Button
            color="secondary"
            size="sm"
            className="mr-2"
            onClick={close}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="plan-details-form"
              color="primary"
              size="sm"
            disabled={saving || deleting}
          >
            {saving ? (
              <>
                <Spinner size="sm" /> Saving...
              </>
            ) : isCreateMode ? (
              'Create Plan'
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Component 2: Modal Wrapper
 */
export function PlanDetailsModal({
  plan,
  onClose = () => {},
  onPlanSaved,
  onPlanDeleted,
}) {
  if (!plan) {
    return null;
  }

  return (
    <Modal
      isOpen
      toggle={onClose}
      size="xl"
      modalClassName="plans-editor-modal-shell plans-editor-modal"
      overlayClassName="plans-editor-modal-overlay"
    >
      <PlanDetailsContent
        plan={plan}
        close={onClose}
        onPlanSaved={onPlanSaved}
        onPlanDeleted={onPlanDeleted}
      />
    </Modal>
  );
}

export default PlanDetailsModal;
