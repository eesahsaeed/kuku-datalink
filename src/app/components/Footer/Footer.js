import React from 'react';
import { Link } from 'react-router-dom';
import { Container } from 'components/ui/primitives';

function Footer() {
  return (
    <footer className="footer">
      <Container fluid className="footer-shell">
        <nav className="footer-nav" aria-label="Footer">
          <Link className="footer-link" to="/about-us">
            About Us
          </Link>
          <Link className="footer-link" to="/contact-us">
            Contact Us
          </Link>
          <Link className="footer-link" to="/privacy-policy">
            Privacy Policy
          </Link>
          <Link className="footer-link" to="/terms-of-service">
            Terms of Service
          </Link>
        </nav>
        <div className="copyright">
          &copy; {new Date().getFullYear()} Kuku Data. All rights reserved.
        </div>
      </Container>
    </footer>
  );
}

export default Footer;
