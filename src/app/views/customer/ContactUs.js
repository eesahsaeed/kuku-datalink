import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Col,
  Row,
} from 'components/ui/primitives';
import ContactUsModal from 'components/ContactUsModal/ContactUsModal';

const ContactUs = () => {
  const [searchParams] = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('open') === '1') {
      setIsModalOpen(true);
    }
  }, [searchParams]);

  return (
    <>
      <div className="content">
        <Row>
          <Col lg="12">
            <Card>
              <CardHeader>
                <CardTitle tag="h4">Send us a Complaint</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-muted mb-4">
                  Report an issue, ask for help, or send a support complaint and
                  we will create a ticket for follow-up.
                </p>
                <Button color="info" onClick={() => setIsModalOpen(true)}>
                  Open Complaint Form
                </Button>
              </CardBody>
            </Card>
          </Col>

          <Col lg="12">
            <Card>
              <CardHeader>
                <CardTitle tag="h4">Contact Support</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-muted">
                  We are here to help. Reach out anytime with your questions,
                  project ideas, or support needs.
                </p>

                <div className="mt-4">
                  <h6>Email Support</h6>
                  <p>
                    <strong>support@kuku.com.ng</strong>
                    <br />
                    Response time: within 24 hours
                  </p>
                </div>

                <div className="mt-4">
                  <h6>Phone Support</h6>
                  <p>
                    <strong>+234 800 000 0000</strong>
                    <br />
                    Available: Monday - Friday, 9AM - 5PM WAT
                  </p>
                </div>

                <div className="mt-4">
                  <h6>Office Location</h6>
                  <p>Abuja, Nigeria</p>
                </div>

                <div className="mt-4 p-3 bg-light rounded">
                  <p className="small text-muted mb-0">
                    <strong>Need development instead?</strong> Use the
                    development cards on the dashboard to send a project
                    request.
                  </p>
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      </div>

      <ContactUsModal
        isOpen={isModalOpen}
        toggle={() => setIsModalOpen(false)}
        mode="complaint"
        title="Send Complaint"
      />
    </>
  );
};

export default ContactUs;
