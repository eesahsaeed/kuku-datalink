// src/views/errors/E404.js
import React from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  CardBody,
  Button,
  CardTitle,
} from 'components/ui/primitives';
import { Link } from 'react-router-dom';

const E404 = () => {
  return (
    <div className="content" style={{ minHeight: 'calc(100vh - 120px)' }}>
      <Container
        fluid
        className="d-flex align-items-center justify-content-center py-5 px-0"
        style={{ minHeight: '85vh' }}
      >
        <Row className="justify-content-center w-100">
          <Col
            xs={11} // mobile — comfortable but not touching edges
            sm={10}
            md={9}
            lg={8} // laptops/desktops — noticeably wider
            xl={7} // large screens
            xxl={6} // ultra-wide monitors (optional – remove if you want xl=7 everywhere)
            className="p-0"
          >
            <Card className="shadow-lg border-0 overflow-hidden fade-in">
              <CardBody className="text-center">
                <h1
                  className="display-1 fw-bolder text-primary mb-2"
                  style={{
                    fontSize: 'clamp(6rem, 18vw, 9rem)',
                    lineHeight: 0.85,
                  }}
                >
                  404
                </h1>

                <CardTitle tag="h2" className="h3 fw-bold mb-4">
                  Page Not Found
                </CardTitle>

                <p className="lead text-muted mb-5 px-3 px-md-4 px-lg-5">
                  The page you are looking for might have been removed, had its
                  name changed,
                  <br className="d-none d-sm-inline" />
                  or is temporarily unavailable.
                </p>

                <div className="d-flex flex-column flex-sm-row justify-content-center gap-3 mb-5">
                  <Button
                    color="primary"
                    size="lg"
                    tag={Link}
                    to="/"
                    className="px-5 py-3 d-flex align-items-center gap-2"
                  >
                    <i className="bi bi-arrow-left-circle-fill"></i>
                    Go Back Home
                  </Button>
                </div>

                {/* Easter egg */}
                <div className="mt-4 pt-4 border-top">
                  <small className="text-muted fst-italic">
                    This is not the page you are looking for...
                    <span role="img" aria-label="sparkles" className="ms-2">
                      ✨
                    </span>
                    <span role="img" aria-label="wizard">
                      🧙‍♂️
                    </span>
                  </small>
                </div>
              </CardBody>
            </Card>

            {/* Footer note */}
            <div className="text-center mt-5 pt-3">
              <small className="text-muted">
                © {new Date().getFullYear()} Kuku Data • Something seems broken?{' '}
                <a
                  href="mailto:support@kuku.com.ng?subject=404%20Error%20Report"
                  className="text-muted text-decoration-underline hover:text-primary"
                >
                  Contact support
                </a>
              </small>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default E404;

