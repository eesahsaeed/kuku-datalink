import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Button,
  Form,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'components/ui/primitives';
import {
  getUser,
  networkTimeout,
  normalizePhoneInputValue,
} from '../../../lib/helper';

const serviceOptions = [
  { value: 'general', label: 'General Enquiry' },
  { value: 'website', label: 'Website' },
  { value: 'mobile', label: 'Mobile (iOS & Android)' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'mac', label: 'Mac' },
];

const modeConfig = {
  complaint: {
    endpoint: '/api/complains/new-complain',
    submitLabel: 'Send Complaint',
    successMessage: 'Your complaint has been sent successfully.',
    validationMessage: 'Please fill in your name, email, subject, and message.',
    intro:
      'Send your complaint or support issue and our team will follow up with a ticket response.',
  },
  development: {
    endpoint: '/api/complains/contact-request',
    submitLabel: 'Send Request',
    successMessage: 'Your development request has been sent successfully.',
    validationMessage: 'Please fill in your name, email, and message.',
    intro:
      'Tell us what you want to build and we will reach out with the next steps.',
  },
};

function ContactUsModal({
  isOpen,
  toggle,
  mode = 'development',
  defaultService = 'general',
  source = 'other',
  title = 'Contact Us',
}) {
  const currentUser = getUser();
  const activeMode = mode === 'complaint' ? 'complaint' : 'development';
  const config = modeConfig[activeMode];
  const initialValues = useMemo(
    () => ({
      name: currentUser?.fullName || '',
      email: currentUser?.emailAddress || '',
      phoneNumber: currentUser?.phoneNumber || '',
      companyName: '',
      service: defaultService || 'general',
      subject: '',
      message: '',
    }),
    [currentUser?.emailAddress, currentUser?.fullName, currentUser?.phoneNumber, defaultService]
  );

  const [values, setValues] = useState(initialValues);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setValues(initialValues);
    }
  }, [initialValues, isOpen]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValues((prev) => ({
      ...prev,
      [name]: name === 'phoneNumber' ? normalizePhoneInputValue(value) : value,
    }));
  };

  const handleClose = () => {
    if (sending) return;
    toggle();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const complaintInvalid =
      activeMode === 'complaint' &&
      (!values.name.trim() ||
        !values.email.trim() ||
        !values.subject.trim() ||
        !values.message.trim());

    const developmentInvalid =
      activeMode === 'development' &&
      (!values.name.trim() || !values.email.trim() || !values.message.trim());

    if (complaintInvalid || developmentInvalid) {
      toast.error(config.validationMessage);
      return;
    }

    setSending(true);

    try {
      const payload =
        activeMode === 'complaint'
          ? {
              name: values.name,
              email: values.email,
              subject: values.subject,
              message: values.message,
            }
          : {
              ...values,
              source,
            };

      const response = await axios.post(
        config.endpoint,
        payload,
        {
          timeout: networkTimeout,
        }
      );

      if (response.data?.success) {
        toast.success(response.data.message || config.successMessage);
        setValues(initialValues);
        toggle();
        return;
      }

      toast.error(response.data?.message || 'Unable to send your request.');
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.message ||
          'Unable to send your request right now.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={handleClose} centered size="md">
      <ModalHeader toggle={handleClose}>{title}</ModalHeader>
      <ModalBody>
        <p className="text-muted mb-4">{config.intro}</p>
        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label for="contact-name">Full Name</Label>
            <Input
              id="contact-name"
              name="name"
              value={values.name}
              onChange={handleChange}
              placeholder="Your full name"
              disabled={sending}
            />
          </FormGroup>

          <FormGroup>
            <Label for="contact-email">Email Address</Label>
            <Input
              id="contact-email"
              name="email"
              type="email"
              value={values.email}
              onChange={handleChange}
              placeholder="your@email.com"
              disabled={sending}
            />
          </FormGroup>

          {activeMode === 'development' && (
            <>
              <FormGroup>
                <Label for="contact-phone">Phone Number</Label>
                <Input
                  id="contact-phone"
                  name="phoneNumber"
                  value={values.phoneNumber}
                  onChange={handleChange}
                  placeholder="080..."
                  disabled={sending}
                />
              </FormGroup>

              <FormGroup>
                <Label for="contact-company">Company / Brand</Label>
                <Input
                  id="contact-company"
                  name="companyName"
                  value={values.companyName}
                  onChange={handleChange}
                  placeholder="Optional"
                  disabled={sending}
                />
              </FormGroup>

              <FormGroup>
                <Label for="contact-service">Service</Label>
                <Input
                  id="contact-service"
                  name="service"
                  type="select"
                  value={values.service}
                  onChange={handleChange}
                  disabled={sending}
                >
                  {serviceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Input>
              </FormGroup>
            </>
          )}

          <FormGroup>
            <Label for="contact-subject">Subject</Label>
            <Input
              id="contact-subject"
              name="subject"
              value={values.subject}
              onChange={handleChange}
              placeholder="What do you need?"
              disabled={sending}
            />
          </FormGroup>

          <FormGroup className="mb-0">
            <Label for="contact-message">Message</Label>
            <Input
              id="contact-message"
              name="message"
              type="textarea"
              rows="5"
              value={values.message}
              onChange={handleChange}
              placeholder="Tell us what you want to build..."
              disabled={sending}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="info" onClick={handleSubmit} disabled={sending}>
          {sending ? 'Sending...' : config.submitLabel}
        </Button>
        <Button color="secondary" onClick={handleClose} disabled={sending}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default ContactUsModal;
