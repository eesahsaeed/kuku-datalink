// TermsOfService.js
import React from 'react';
import { Container, Row, Col, Card, CardHeader, CardBody } from 'components/ui/primitives';

const TermsOfService = () => {
  return (
    <Container className="my-5">
      <Row className="justify-content-center">
        <Col lg="10">
          <Card>
            <CardHeader className="bg-primary text-white text-center">
              <h3 className="mb-0">Terms of Service</h3>
            </CardHeader>
            <CardBody>
              <p className="text-muted">
                <strong>Last updated: January 08, 2026</strong>
              </p>

              <p>
                By accessing or using https://kuku.com.ng (the "Service"), you
                agree to be bound by these Terms of Service ("Terms"). If you do
                not agree, please do not use the Service.
              </p>

              <h5 className="mt-4">1. Eligibility & Account</h5>
              <p>
                You must be at least 18 years old to use the Service. You are
                responsible for maintaining the confidentiality of your account.
                Signing in with Google means you also agree to Google's
                applicable terms.
              </p>

              <h5 className="mt-4">2. Virtual Account (Optional)</h5>
              <p>
                We offer an optional personalized virtual account for easier
                wallet funding. Creating one may require providing your BVN for
                KYC verification. This is completely optional — you can continue
                using the Service without it.
              </p>

              <h5 className="mt-4">3. Services & Transactions</h5>
              <p>
                We provide data bundles, airtime top-ups, TV subscriptions, and
                bill payments. All transactions are processed instantly where
                possible. You are responsible for providing correct recipient
                details (phone number, meter number, etc.). Transactions are
                generally non-refundable except in cases of system failure on
                our end.
              </p>

              <h5 className="mt-4">4. No Transaction Fees</h5>
              <p>
                We do not charge any additional transaction or service fees on
                purchases, wallet funding, or withdrawals.
              </p>

              <h5 className="mt-4">5. Prohibited Activities</h5>
              <p>You agree not to:</p>
              <ul>
                <li>Use the Service for illegal purposes.</li>
                <li>Attempt to interfere with or disrupt the Service.</li>
                <li>
                  Engage in fraudulent transactions or reselling without
                  authorization.
                </li>
              </ul>

              <h5 className="mt-4">6. Limitation of Liability</h5>
              <p>
                The Service is provided "as is" without warranties. We are not
                liable for network downtime, third-party failures, or incorrect
                details provided by you.
              </p>

              <h5 className="mt-4">7. Changes to Terms</h5>
              <p>
                We may update these Terms from time to time. Continued use of
                the Service after changes constitutes acceptance of the new
                Terms.
              </p>

              <h5 className="mt-4">8. Governing Law</h5>
              <p>
                These Terms are governed by the laws of the Federal Republic of
                Nigeria.
              </p>

              <h5 className="mt-4">9. Contact Us</h5>
              <p>
                For questions about these Terms, contact:{' '}
                <strong>support@kuku.com.ng</strong>
              </p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default TermsOfService;
