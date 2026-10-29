import React from 'react';
import {
  Route,
  Routes,
  Navigate,
  useLocation,
  matchPath,
} from 'react-router-dom';

// core components
import AdminNavbar from 'components/Navbars/AdminNavbar.js';
import Footer from 'components/Footer/Footer.js';
import Sidebar from 'components/Sidebar/Sidebar.js';

import routes from 'adminRoutes';

import {
  getUser,
  needsEmailVerification,
  needsTransactionPinSetup,
} from '../../../lib/helper';
import useAdminRealtimeSound from '../../hooks/useAdminRealtimeSound';
import {
  hasAdminDashboardAccess,
  isPrimaryAdminUser,
} from '../../utils/adminAccess';

import logo from 'assets/img/logo.png';
import { BackgroundColorContext } from 'contexts/BackgroundColorContext';

export default function Admin() {
  const location = useLocation();
  const mainPanelRef = React.useRef(null);
  const currentUser = getUser();
  const [sidebarOpened, setsidebarOpened] = React.useState(
    document.documentElement.className.indexOf('nav-open') !== -1
  );

  useAdminRealtimeSound(currentUser);

  React.useEffect(() => {
    document.documentElement.scrollTop = 0;
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }
    if (mainPanelRef.current) {
      mainPanelRef.current.scrollTop = 0;
    }
  }, [location]);
  // this function opens and closes the sidebar on small devices
  const toggleSidebar = () => {
    document.documentElement.classList.toggle('nav-open');
    setsidebarOpened((prev) => !prev);
  };

  let adminAccessRedirect = '';

  if (!currentUser?.isAuthenticated) {
    adminAccessRedirect = '/signin';
  } else if (!hasAdminDashboardAccess(currentUser)) {
    adminAccessRedirect = '/';
  } else if (needsEmailVerification(currentUser)) {
    adminAccessRedirect = '/confirm-account';
  } else if (needsTransactionPinSetup(currentUser)) {
    adminAccessRedirect = '/setup-pin';
  }

  const getRoutes = (routes) => {
    return routes.map((prop, key) => {
      if (prop.layout === '/admin') {
        let element = prop.component;

        if (prop.requiresPrimaryAdmin && !isPrimaryAdminUser(currentUser)) {
          element = <Navigate to="/admin/dashboard" replace />;
        }

        return <Route path={prop.path} element={element} key={key} exact />;
      } else {
        return null;
      }
    });
  };

  const getBrandText = (path) => {
    const normalizedPath =
      path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

    const routeEntries = routes.map((route) => {
      const fullPath = `${route.layout || ''}${route.path || ''}` || '/';
      const normalizedRoutePath =
        fullPath.length > 1 && fullPath.endsWith('/')
          ? fullPath.slice(0, -1)
          : fullPath;

      return {
        ...route,
        fullPath: normalizedRoutePath || '/',
      };
    });

    const exactMatch = routeEntries.find((route) =>
      matchPath({ path: route.fullPath, end: true }, normalizedPath)
    );

    if (exactMatch?.name) {
      return exactMatch.name;
    }

    const partialMatch = routeEntries
      .sort((a, b) => b.fullPath.length - a.fullPath.length)
      .find((route) =>
        matchPath({ path: route.fullPath, end: false }, normalizedPath)
      );

    return partialMatch?.name || 'Brand';
  };

  if (adminAccessRedirect) {
    return <Navigate to={adminAccessRedirect} replace />;
  }

  return (
    <BackgroundColorContext.Consumer>
      {({ color }) => (
        <React.Fragment>
          <div className="wrapper admin-shell">
            <Sidebar
              routes={routes}
              logo={{
                outterLink: '/',
                text: 'Kuku data',
                imgSrc: logo,
              }}
              toggleSidebar={toggleSidebar}
            />
            <div
              className="main-panel admin-main-panel"
              ref={mainPanelRef}
              data={color}
            >
              <AdminNavbar
                brandText={getBrandText(location.pathname)}
                toggleSidebar={toggleSidebar}
                sidebarOpened={sidebarOpened}
              />
              <Routes>
                {getRoutes(routes)}
                <Route
                  path="/"
                  element={<Navigate to="/admin/dashboard" replace />}
                />
              </Routes>
              {
                // we don't want the Footer to be rendered on map page
                location.pathname === '/admin/maps' ? null : <Footer fluid />
              }
            </div>
          </div>
        </React.Fragment>
      )}
    </BackgroundColorContext.Consumer>
  );
}
