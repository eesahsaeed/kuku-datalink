import React from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { PropTypes } from 'prop-types';
import { Nav } from 'components/ui/primitives';
import { KukuTooltipTrigger } from 'components/ui/Tooltip';
import { BackgroundColorContext } from 'contexts/BackgroundColorContext';
import { getUser } from '../../../lib/helper';
import { isPrimaryAdminUser } from '../../utils/adminAccess';

function Sidebar(props) {
  const location = useLocation();

  // verifies if routeName is the one active
  const activeRoute = (routeName) => {
    return location.pathname === routeName ? 'active' : '';
  };

  const { routes, logo } = props;
  const hasLogoText =
    typeof logo?.text === 'string'
      ? logo.text.trim().length > 0
      : Boolean(logo?.text);

  // Get current authenticated user
  const user = getUser();
  const isAuthenticated = !!user;

  // Filter routes: hide those with requiresAuth: true if not logged in,
  // and hide routes with explicit showInSidebar: false
  const visibleRoutes = routes.filter((prop) => {
    if (prop.redirect) return false;
    if (prop.showInSidebar === false) return false;
    if (prop.requiresPrimaryAdmin && !isPrimaryAdminUser(user)) {
      return false;
    }
    if (prop.requiresAuth) {
      return isAuthenticated;
    }
    return true;
  });

  let logoImg = null;
  let logoText = null;
  if (logo !== undefined) {
    if (logo.outterLink !== undefined) {
      logoImg = (
        <KukuTooltipTrigger content="Go to home" placement="right">
          <a
            href={'/'}
            className="simple-text logo-mini"
            target="_blank"
            rel="noreferrer"
            onClick={props.toggleSidebar}
          >
            <div className="logo-img">
              <img
                src={logo.imgSrc}
                alt="logo"
                title="Kuku"
                className="app-logo-mark sidebar-logo-mark"
              />
            </div>
          </a>
        </KukuTooltipTrigger>
      );
      if (hasLogoText) {
        logoText = (
          <KukuTooltipTrigger
            content={typeof logo.text === 'string' ? logo.text : 'Kuku'}
            placement="right"
          >
            <a
              href={'/'}
              className="simple-text logo-normal"
              target="_blank"
              rel="noreferrer"
              onClick={props.toggleSidebar}
            >
              {logo.text}
            </a>
          </KukuTooltipTrigger>
        );
      }
    } else {
      logoImg = (
        <KukuTooltipTrigger content="Go to home" placement="right">
          <Link
            to={logo.innerLink}
            className="simple-text logo-mini"
            onClick={props.toggleSidebar}
          >
            <div className="logo-img">
              <img
                src={logo.imgSrc}
                alt="logo"
                title="Kuku"
                className="app-logo-mark sidebar-logo-mark"
              />
            </div>
          </Link>
        </KukuTooltipTrigger>
      );
      if (hasLogoText) {
        logoText = (
          <KukuTooltipTrigger
            content={typeof logo.text === 'string' ? logo.text : 'Kuku'}
            placement="right"
          >
            <Link
              to={logo.innerLink}
              className="simple-text logo-normal"
              onClick={props.toggleSidebar}
            >
              {logo.text}
            </Link>
          </KukuTooltipTrigger>
        );
      }
    }
  }

  return (
    <BackgroundColorContext.Consumer>
      {({ color }) => (
        <div className="sidebar" data={color}>
          {/* Make wrapper a column so footer can sit at bottom */}
          <div
            className="sidebar-wrapper d-flex flex-column kuku-scrollbar kuku-scrollbar-y"
            style={{ minHeight: '100%' }}
          >
            {logoImg !== null || logoText !== null ? (
              <div className="logo">
                {logoImg}
                {logoText}
              </div>
            ) : null}
            <Nav className="flex-grow-1">
              {visibleRoutes.map((prop, key) => {
                const routePath = prop.layout + prop.path;
                const isActive = activeRoute(routePath) === 'active';
                return (
                  <li
                    className={
                      (isActive ? 'active sidebar-current-page' : '') +
                      (prop.pro ? ' active-pro' : '')
                    }
                    key={key}
                  >
                    <KukuTooltipTrigger
                      content={prop.rtlName ? prop.rtlName : prop.name}
                      placement="right"
                    >
                      <NavLink
                        to={routePath}
                        className={({ isActive: navIsActive }) =>
                          `nav-link${navIsActive ? ' sidebar-link-active' : ''}`
                        }
                        onClick={props.toggleSidebar}
                      >
                        <i className={prop.icon} />
                        <p>{prop.rtlName ? prop.rtlName : prop.name}</p>
                      </NavLink>
                    </KukuTooltipTrigger>
                  </li>
                );
              })}
            </Nav>

            {/* Bottom area */}
            <div
              className="sidebar-footer mt-auto p-3 text-center"
              style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}
            >
              <div className="small mb-1">
                Need help?{' '}
                <KukuTooltipTrigger content="Contact support" placement="right">
                  <Link
                    to="/contact-us"
                    onClick={props.toggleSidebar}
                  >
                    Contact Support
                  </Link>
                </KukuTooltipTrigger>
              </div>
              <div className="small">support@kuku.com.ng</div>
              <div className="small mt-2">
                &copy; {new Date().getFullYear()} Kuku
              </div>
            </div>
          </div>
        </div>
      )}
    </BackgroundColorContext.Consumer>
  );
}

Sidebar.propTypes = {
  rtlActive: PropTypes.bool,
  routes: PropTypes.arrayOf(PropTypes.object),
  logo: PropTypes.shape({
    innerLink: PropTypes.string,
    outterLink: PropTypes.string,
    text: PropTypes.node,
    imgSrc: PropTypes.string,
  }),
  toggleSidebar: PropTypes.func,
};

export default Sidebar;
