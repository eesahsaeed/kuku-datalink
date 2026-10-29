import React from 'react';
import {
  Route,
  Routes,
  Navigate,
  useLocation,
  matchPath,
} from 'react-router-dom';

// core components
import CustomerNavbar from 'components/Navbars/CustomerNavbar.js';
import Footer from 'components/Footer/Footer.js';
import Sidebar from 'components/Sidebar/Sidebar.js';

import routes from 'customerRoutes';
import {
  getUser,
  needsEmailVerification,
  needsTransactionPinSetup,
} from '../../../lib/helper';

import logo from 'assets/img/logo.png';
import { BackgroundColorContext } from 'contexts/BackgroundColorContext';

export default function CustomerLayout() {
  const location = useLocation();
  const mainPanelRef = React.useRef(null);
  const [sidebarOpened, setsidebarOpened] = React.useState(
    document.documentElement.className.indexOf('nav-open') !== -1
  );

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

  const getRoutes = (routes) => {
    const currentUser = getUser();

    return routes.map((prop, key) => {
      let element = prop.component;

      if (prop.requiresAuth) {
        if (!currentUser?.isAuthenticated) {
          element = <Navigate to="/signin" replace />;
        } else if (needsEmailVerification(currentUser)) {
          element = <Navigate to="/confirm-account" replace />;
        } else if (needsTransactionPinSetup(currentUser)) {
          element = <Navigate to="/setup-pin" replace />;
        }
      }

      return <Route path={prop.path} element={element} key={key} />;
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
      .filter((route) => route.fullPath !== '/')
      .sort((a, b) => b.fullPath.length - a.fullPath.length)
      .find((route) =>
        matchPath({ path: route.fullPath, end: false }, normalizedPath)
      );

    return partialMatch?.name || 'Brand';
  };
  return (
    <BackgroundColorContext.Consumer>
      {({ color }) => (
        <React.Fragment>
          <div className="wrapper">
            <Sidebar
              routes={routes}
              logo={{
                outterLink: 'https://www.creative-tim.com/',
                text: 'Kuku Data',
                imgSrc: logo,
              }}
              toggleSidebar={toggleSidebar}
            />
            <div className="main-panel" ref={mainPanelRef} data={color}>
              <CustomerNavbar
                brandText={getBrandText(location.pathname)}
                toggleSidebar={toggleSidebar}
                sidebarOpened={sidebarOpened}
              />
              <Routes>
                {getRoutes(routes)}
                <Route path="*" element={<Navigate to="/error" replace />} />
              </Routes>

              {
                // we don't want the Footer to be rendered on map page
                location.pathname === '/admin/maps' ? null : <Footer fluid />
              }
            </div>
          </div>
          {/* <FixedPlugin bgColor={color} handleBgClick={changeColor} /> */}
        </React.Fragment>
      )}
    </BackgroundColorContext.Consumer>
  );
}
