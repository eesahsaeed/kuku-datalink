// PrivacyPolicy.js
import React from 'react';
import { Container, Row, Col, Card, CardHeader, CardBody } from 'components/ui/primitives';

const PrivacyPolicy = () => {
  return (
    <Container className="my-5">
      <Row className="justify-content-center">
        <Col lg="10">
          <Card>
            <CardHeader className="bg-primary text-white text-center">
              <h3 className="mb-0">Privacy Policy</h3>
            </CardHeader>
            <CardBody>
              <p className="text-muted">
                <strong>Last updated: January 08, 2026</strong>
              </p>

              <p>
                Kuku Data ("we", "us", or "our") operates the website
                https://kuku.com.ng (the "Service"). This Privacy Policy
                explains how we collect, use, disclose, and safeguard your
                information when you visit our website or use our services.
              </p>

              <h5 className="mt-4">1. Information We Collect</h5>
              <ul>
                <li>
                  <strong>Account Information:</strong> When you sign up using
                  Google OAuth, we receive your name, email address, and profile
                  picture from Google.
                </li>
                <li>
                  <strong>Virtual Account (Optional):</strong> If you choose to
                  create a personalized virtual account for easier wallet
                  funding, we may collect your Bank Verification Number (BVN)
                  solely for KYC verification as required by our payment
                  partners and Nigerian regulations. Providing BVN is entirely
                  optional and only used if you opt-in.
                </li>
                <li>
                  <strong>Transaction Data:</strong> Phone numbers, selected
                  networks, data/airtime amounts, bill details, and payment
                  information.
                </li>
                <li>
                  <strong>Usage Data:</strong> IP address, browser type, device
                  information, pages visited, and time spent on the Service.
                </li>
                <li>
                  <strong>Cookies & Analytics:</strong> We use cookies and
                  similar technologies for session management, security, and
                  improving user experience.
                </li>
              </ul>

              <h5 className="mt-4">2. How We Use Your Information</h5>
              <ul>
                <li>
                  To provide, maintain, and improve the Service (e.g., process
                  recharges, airtime, TV subscriptions, and bill payments).
                </li>
                <li>To authenticate you securely via Google Sign-In.</li>
                <li>
                  To create and manage your optional virtual account (using BVN
                  only if provided).
                </li>
                <li>
                  To send transactional notifications and support messages.
                </li>
                <li>To detect and prevent fraud or abuse.</li>
                <li>
                  To comply with legal and regulatory requirements in Nigeria.
                </li>
              </ul>

              <h5 className="mt-4">3. Google OAuth & Third-Party Data</h5>
              <p>
                We use Google Sign-In to access only basic profile information
                (name, email, profile picture). We do not request or store
                access to your Gmail, Drive, contacts, or any other Google
                services. Your data is handled in accordance with Google's API
                Services User Data Policy.
              </p>

              <h5 className="mt-4">4. Sharing Your Information</h5>
              <p>We may share information with:</p>
              <ul>
                <li>
                  Telecom operators (MTN, Airtel, Glo, 9mobile) to fulfill data
                  and airtime requests.
                </li>
                <li>
                  Payment processors and banks for transaction processing and
                  optional virtual account creation.
                </li>
                <li>
                  Service providers for hosting, analytics, and customer support
                  (under strict confidentiality).
                </li>
                <li>
                  Law enforcement or regulatory authorities when required by
                  Nigerian law.
                </li>
              </ul>
              <p>We do not sell your personal information to third parties.</p>

              <h5 className="mt-4">5. Data Security & Retention</h5>
              <p>
                We implement industry-standard security measures to protect your
                data. Transaction records are retained for up to 7 years as
                required by Nigerian financial regulations. Account data is kept
                only as long as your account remains active or as needed for
                legal purposes.
              </p>

              <h5 className="mt-4">6. Your Rights</h5>
              <p>
                You have the right to access, correct, or request deletion of
                your personal data. You may revoke Google access at any time via
                your Google account settings. Contact us to manage or delete
                your BVN or other information.
              </p>

              <h5 className="mt-4">7. Contact Us</h5>
              <p>
                If you have questions about this Privacy Policy, please contact
                us at: <strong>support@kuku.com.ng</strong>
              </p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default PrivacyPolicy;
