import React, { useMemo, useState } from 'react';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'components/ui/primitives';
import ContactUsModal from 'components/ContactUsModal/ContactUsModal';

const developmentServices = [
  {
    key: 'website',
    label: 'Website',
    iconClass: 'fas fa-globe',
    title: 'Website Development',
    summary:
      'Clean business websites, landing pages, dashboards, school portals, e-commerce stores, and custom web platforms.',
    affordability:
      'Affordable for startups, small businesses, and growing brands that want something professional without overspending.',
    details: [
      'Responsive design for phone, tablet, and desktop',
      'Admin panel, contact forms, login, and payment integration',
      'Good for company websites, client portals, and online stores',
    ],
  },
  {
    key: 'mobile',
    label: 'Mobile (iOS & Android)',
    iconClass: 'fas fa-mobile-alt',
    title: 'Mobile App Development',
    summary:
      'Cross-platform mobile apps that work on both iPhone and Android with one product flow.',
    affordability:
      'A practical option when you want both iOS and Android coverage while keeping development cost under control.',
    details: [
      'User accounts, wallet, push notifications, and API connection',
      'Good for service apps, booking apps, and customer apps',
      'Designed to feel simple, modern, and easy to use',
    ],
  },
  {
    key: 'desktop',
    label: 'Desktop',
    iconClass: 'fas fa-desktop',
    title: 'Desktop App Development',
    summary:
      'Desktop software for offices, schools, internal teams, and businesses that need fast local workflows.',
    affordability:
      'Useful when a business needs a focused system without the cost of overbuilding a large platform.',
    details: [
      'Good for business tools, dashboards, reporting, and operations',
      'Can connect to your web backend and existing APIs',
      'Simple, stable interfaces for everyday work',
    ],
  },
  {
    key: 'mac',
    label: 'Mac',
    iconClass: 'fab fa-apple',
    title: 'Mac App Development',
    summary:
      'Mac-friendly applications for premium workflows, internal operations, admin tools, and focused business software.',
    affordability:
      'A smart option when your team or users work on Apple devices and you still want a clean, affordable build path.',
    details: [
      'Good for internal business tools and Mac-first workflows',
      'Works well for dashboards, utilities, and productivity tools',
      'Built with a polished look and practical feature set',
    ],
  },
];

function WebDevelopmentSection({ onActivateView }) {
  const [selectedServiceKey, setSelectedServiceKey] = useState('');
  const [contactModalService, setContactModalService] = useState('');

  const selectedService = useMemo(
    () =>
      developmentServices.find(
        (service) => service.key === selectedServiceKey
      ) || null,
    [selectedServiceKey]
  );

  const closeDetailsModal = () => setSelectedServiceKey('');

  const handleServiceOpen = (serviceKey) => {
    onActivateView?.();
    setSelectedServiceKey(serviceKey);
  };

  const openContactModal = (serviceKey) => {
    onActivateView?.();
    setSelectedServiceKey('');
    setContactModalService(serviceKey || 'general');
  };

  return (
    <>
      <div className="web-development-section">
        <div className="other-service-row">
          <p className="title">FULLSTACK WEB DEVELOPMENT</p>
          <p className="text-muted web-development-copy">
            Affordable builds for web, mobile, desktop, and Mac. Tap any option
            to see details.
          </p>

          <div className="other-service-sub-row other-service-scroll-row kuku-scrollbar kuku-scrollbar-x">
            {developmentServices.map((service) => (
              <button
                key={service.key}
                type="button"
                className="other-services-card web-development-card"
                onClick={() => handleServiceOpen(service.key)}
              >
                <span className="web-development-icon">
                  <i className={service.iconClass} aria-hidden="true" />
                </span>
                <span className="web-development-label">{service.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Modal
        isOpen={Boolean(selectedService)}
        toggle={closeDetailsModal}
        centered
        size="md"
      >
        <ModalHeader toggle={closeDetailsModal}>
          {selectedService && (
            <div className="web-development-modal-header">
              <span className="web-development-icon web-development-icon-modal">
                <i className={selectedService.iconClass} aria-hidden="true" />
              </span>
              <div>
                <h5 className="mb-1">{selectedService.title}</h5>
                <p className="mb-0 text-muted">Affordable and professional</p>
              </div>
            </div>
          )}
        </ModalHeader>

        <ModalBody>
          {selectedService && (
            <div className="web-development-modal-content">
              <p className="web-development-modal-summary">
                {selectedService.summary}
              </p>

              <div className="web-development-modal-note">
                {selectedService.affordability}
              </div>

              <ul className="web-development-modal-list">
                {selectedService.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button
            color="info"
            onClick={() => openContactModal(selectedService?.key || 'website')}
          >
            Contact Us
          </Button>
          <Button color="secondary" onClick={closeDetailsModal}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <ContactUsModal
        isOpen={Boolean(contactModalService)}
        toggle={() => setContactModalService('')}
        mode="development"
        defaultService={contactModalService || 'general'}
        source="web_development"
        title="Contact Us"
      />
    </>
  );
}

export default WebDevelopmentSection;
