import React from 'react';
import { Card, CardHeader, CardBody, CardTitle, Row, Col } from 'components/ui/primitives';

const AboutUs = () => {
  return (
    <div className="content">
      <Row>
        <Col md="12">
          <Card>
            <CardHeader>
              <CardTitle tag="h2">About Kuku Data</CardTitle>
            </CardHeader>
            <CardBody>
              <Row>
                <Col lg="6">
                  <h5>Who We Are</h5>
                  <p>
                    Kuku Data is a leading digital services platform in Nigeria,
                    delivering instant mobile data bundles, airtime top-ups, TV
                    subscriptions, electricity bill payments, and other
                    essential utilities. We are committed to making digital
                    connectivity affordable, seamless, and accessible to every
                    Nigerian.
                  </p>

                  <h5 className="mt-4">Our Mission</h5>
                  <p>
                    To empower Nigerians with fast, reliable, and cost-effective
                    digital solutions that eliminate the frustrations of
                    traditional recharge and payment methods. We strive to
                    bridge the gap between technology and everyday convenience.
                  </p>

                  <h5 className="mt-4">Our Vision</h5>
                  <p>
                    To become Nigeria’s most trusted and preferred platform for
                    all digital utilities and financial services, serving
                    millions of satisfied customers with unmatched speed,
                    transparency, and innovation.
                  </p>
                </Col>

                <Col lg="6">
                  <h5>Why Choose Kuku Data?</h5>
                  <ul className="mt-3">
                    <li>
                      <strong>Lightning-Fast Delivery:</strong> Instant
                      transactions — data, airtime, and bills credited within
                      seconds.
                    </li>
                    <li>
                      <strong>Transparent Pricing:</strong> Competitive rates
                      with zero hidden fees or surprise charges.
                    </li>
                    <li>
                      <strong>Bank-Grade Security:</strong> Advanced encryption
                      and secure payment gateways to protect your data and
                      funds.
                    </li>
                    <li>
                      <strong>24/7 Dedicated Support:</strong> Our professional
                      customer service team is always available via phone,
                      email, and live chat.
                    </li>
                    <li>
                      <strong>Multi-Network Support:</strong> Seamless services
                      across MTN, Airtel, Glo, and 9mobile.
                    </li>
                    <li>
                      <strong>Flexible Payments:</strong> Multiple secure
                      options including bank transfers, virtual accounts, and
                      cards.
                    </li>
                    <li>
                      <strong>Reliable Infrastructure:</strong> Built for
                      high-volume transactions with 99.9% uptime.
                    </li>
                  </ul>
                </Col>
              </Row>

              {/* Dedication Section - In Memory of Grandfather */}
              <Row className="mt-5">
                <Col md="12">
                  <Card className="bg-light border-0 shadow-sm">
                    <CardBody className="text-center py-5">
                      <h5 className="text-muted mb-3">In Loving Memory</h5>
                      <h4 className="mb-4" style={{ color: '#d32f2f' }}>
                        Ibrahim (Kuku)
                      </h4>
                      <p
                        className="lead mb-4"
                        style={{
                          fontStyle: 'italic',
                          maxWidth: '700px',
                          margin: '0 auto',
                        }}
                      >
                        "This platform is proudly dedicated to the loving memory
                        of my late grandfather, Ibrahim (Kuku), whose wisdom,
                        kindness, and legacy continue to inspire everything we
                        do."
                      </p>
                      <p className="small text-muted">
                        May his gentle soul rest in perfect peace. Amen.
                      </p>
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              {/* Our Story / Journey Section */}
              <Row className="mt-5">
                <Col md="12">
                  <Card className="bg-light border-0">
                    <CardBody>
                      <h5>Our Story</h5>
                      <p>
                        Founded in 2024, Kuku Data emerged from a simple yet
                        powerful observation: Nigerians deserve better than long
                        queues at recharge centers and unreliable online
                        platforms. We set out to build a modern, customer-first
                        solution that combines cutting-edge technology with deep
                        understanding of local needs.
                      </p>
                      <p>
                        Today, we proudly serve thousands of active users daily,
                        processing millions of naira in transactions. Through
                        strategic partnerships with major telecom operators and
                        utility providers, we continue to expand our offerings
                        while maintaining the highest standards of service
                        delivery.
                      </p>
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              {/* Values & Contact Side-by-Side */}
              <Row className="mt-4">
                <Col md="6">
                  <Card className="bg-light border-0 h-100">
                    <CardBody>
                      <h6>Our Core Values</h6>
                      <ul className="small mb-0">
                        <li>
                          <strong>Integrity:</strong> Transparency and honesty
                          in every transaction.
                        </li>
                        <li>
                          <strong>Innovation:</strong> Continuously evolving to
                          meet the changing needs of our users.
                        </li>
                        <li>
                          <strong>Reliability:</strong> Consistent, dependable
                          service you can count on anytime.
                        </li>
                        <li>
                          <strong>Customer-Centricity:</strong> Putting your
                          satisfaction and convenience first in everything we
                          do.
                        </li>
                        <li>
                          <strong>Excellence:</strong> Delivering superior
                          service and value at all times.
                        </li>
                      </ul>
                    </CardBody>
                  </Card>
                </Col>
                <Col md="6">
                  <Card className="bg-light border-0 h-100">
                    <CardBody>
                      <h6>Get in Touch</h6>
                      <p className="small mb-0">
                        We’d love to hear from you. Whether you have questions,
                        feedback, or partnership inquiries, our team is ready to
                        assist.
                        <br />
                        <br />
                        <strong>Email:</strong> support@kuku.com.ng
                        <br />
                        <strong>Phone:</strong> +234 810 590 9910
                        <br />
                        <strong>Hours:</strong> Available 24 hours a day, 7 days
                        a week
                      </p>
                    </CardBody>
                  </Card>
                </Col>
              </Row>

              {/* Key Milestones */}
              <Row className="mt-5">
                <Col md="12">
                  <Card className="bg-light border-0">
                    <CardBody>
                      <h5>Our Journey So Far</h5>
                      <Row>
                        <Col md="4" className="mb-3">
                          <strong>2024</strong>
                          <br />
                          Platform Launch — Started with data and airtime
                          services
                        </Col>
                        <Col md="4" className="mb-3">
                          <strong>2025</strong>
                          <br />
                          Expanded to TV subscriptions, bill payments, and
                          multi-network automation
                        </Col>
                        <Col md="4" className="mb-3">
                          <strong>2026</strong>
                          <br />
                          Thousands of daily transactions and growing
                          partnerships with leading operators
                        </Col>
                      </Row>
                      <p className="mt-3 small text-muted">
                        We remain focused on scaling responsibly while keeping
                        customer trust at the heart of our operations.
                      </p>
                    </CardBody>
                  </Card>
                </Col>
              </Row>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AboutUs;
