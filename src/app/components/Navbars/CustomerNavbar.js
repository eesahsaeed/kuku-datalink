import React from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
} from 'react-aria-components';
import { KukuTooltipTrigger } from 'components/ui/Tooltip';

import {
  Badge,
  Button,
  Container,
  Modal,
  ModalBody,
  ModalHeader,
  Navbar,
  NavbarBrand,
  NavbarToggler,
  Nav,
  Spinner,
} from 'components/ui/primitives';
import {
  buildAuthNavigationTarget,
  getUser,
  setPendingAuthRedirect,
  signout,
} from '../../../lib/helper';
import useNavbarNotifications from '../../hooks/useNavbarNotifications';
import { hasAdminDashboardAccess } from '../../utils/adminAccess';

const normalizeNotificationTarget = (actionUrl = '', ticketId = '') => {
  const normalizedActionUrl = String(actionUrl || '').trim();

  if (normalizedActionUrl.startsWith('/transactions')) {
    return normalizedActionUrl.replace('/transactions', '/wallet');
  }

  if (normalizedActionUrl.startsWith('/')) {
    return normalizedActionUrl;
  }

  if (ticketId) {
    return `/ticket/${ticketId}`;
  }

  return null;
};

function CustomerNavbar(props) {
  const user = getUser();
  const isAuthenticated = Boolean(user?.isAuthenticated && user?.token);
  const canAccessAdmin = hasAdminDashboardAccess(user);
  const navigate = useNavigate();
  const location = useLocation();
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] =
    React.useState(false);
  const [selectedNotification, setSelectedNotification] = React.useState(null);
  const {
    notifications,
    unreadCount,
    notificationsLoading,
    fetchNotifications,
    markNotificationRead,
    markNotificationsPreviewed,
  } = useNavbarNotifications(user, {
    limit: 5,
    enabled: isAuthenticated,
  });

  React.useEffect(() => {
    if (!isNotificationMenuOpen || !notifications.length) return;

    const unreadVisibleNotifications = notifications.filter(
      (notification) => !notification.isRead
    );

    if (!unreadVisibleNotifications.length) return;

    void markNotificationsPreviewed(unreadVisibleNotifications);
  }, [isNotificationMenuOpen, markNotificationsPreviewed, notifications]);

  const handleNotificationOpen = async (notification) => {
    const actionUrl = notification?.actionUrl || '';
    const parsedParams = new URLSearchParams(
      actionUrl.includes('?') ? actionUrl.split('?')[1] : ''
    );
    const ticketId =
      notification?.meta?.ticketId ||
      parsedParams.get('ticketId') ||
      parsedParams.get('ticket');
    const targetPath = normalizeNotificationTarget(actionUrl, ticketId);

    if (!notification.isRead && user?.token) {
      await markNotificationRead(notification);
    }

    if (targetPath) {
      navigate(targetPath);
      return;
    }

    setSelectedNotification(notification);
  };

  const formatNotificationTime = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getContinuationTarget = () => {
    const returnTo = `${location.pathname}${location.search || ''}`;
    setPendingAuthRedirect(returnTo);
    return returnTo;
  };

  return (
    <>
      <Navbar
        className={classNames('navbar-absolute', 'navbar-transparent')}
        expand="lg"
      >
        <Container fluid>
          <div className="navbar-wrapper">
            <div
              className={classNames('navbar-toggle d-inline d-lg-none', {
                toggled: props.sidebarOpened,
              })}
            >
              <KukuTooltipTrigger content="Toggle menu" placement="bottom">
                <NavbarToggler onClick={props.toggleSidebar}>
                  <span className="navbar-toggler-bar bar1" />
                  <span className="navbar-toggler-bar bar2" />
                  <span className="navbar-toggler-bar bar3" />
                </NavbarToggler>
              </KukuTooltipTrigger>
            </div>
            <KukuTooltipTrigger
              content={props.brandText || 'Current page'}
              placement="bottom"
            >
              <NavbarBrand
                href="#pablo"
                onClick={(e) => e.preventDefault()}
              >
                <span>{props.brandText}</span>
              </NavbarBrand>
            </KukuTooltipTrigger>
          </div>

          <Nav className="ml-auto align-items-center gap-2 customer-navbar-actions">
            {!isAuthenticated ? (
              <>
                <KukuTooltipTrigger content="Sign in" placement="bottom">
                  <Button
                    className="customer-navbar-cta customer-navbar-cta-secondary"
                    onClick={() =>
                      navigate(
                        buildAuthNavigationTarget(
                          '/signin',
                          getContinuationTarget()
                        )
                      )
                    }
                  >
                    <i className="fas fa-right-to-bracket" />
                    Sign In
                  </Button>
                </KukuTooltipTrigger>
                <KukuTooltipTrigger content="Sign up" placement="bottom">
                  <Button
                    className="customer-navbar-cta customer-navbar-cta-primary"
                    onClick={() =>
                      navigate(
                        buildAuthNavigationTarget(
                          '/signup',
                          getContinuationTarget()
                        )
                      )
                    }
                  >
                    <i className="fas fa-user-plus" />
                    Sign Up
                  </Button>
                </KukuTooltipTrigger>
              </>
            ) : (
              <div className="customer-navbar-profile-cluster">
                <KukuTooltipTrigger content="Notifications" placement="bottom">
                  <MenuTrigger
                    onOpenChange={(isOpen) => {
                      setIsNotificationMenuOpen(isOpen);
                      if (isOpen) {
                        void fetchNotifications({
                          force: notifications.length === 0,
                        });
                      }
                    }}
                  >
                    <AriaButton
                      className="navbar-action-trigger navbar-notification-trigger"
                      aria-label="Open notifications"
                    >
                      <i className="tim-icons icon-bell-55 large-bell" />
                      {unreadCount > 0 && (
                        <Badge
                          color="danger"
                          pill
                          className="navbar-unread-badge"
                        >
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                      )}
                    </AriaButton>
                    <Popover
                      placement="bottom end"
                      offset={12}
                      className="navbar-menu-popover"
                    >
                      <div className="navbar-menu-panel navbar-notification-panel">
                        <div className="navbar-menu-header">
                          <div>
                            <strong>Notifications</strong>
                            <span>Stay on top of new activity</span>
                          </div>
                          {unreadCount > 0 ? (
                            <Badge color="info">{unreadCount} unread</Badge>
                          ) : null}
                        </div>

                        {notificationsLoading ? (
                          <div className="navbar-menu-state">
                            <Spinner size="sm" color="primary" />
                            <span>Loading notifications...</span>
                          </div>
                        ) : notifications.length > 0 ? (
                          <div className="navbar-notification-scroll">
                            <Menu
                              className="navbar-notification-list"
                              onAction={(key) => {
                                const notification = notifications.find(
                                  (item) => item._id === key
                                );
                                if (notification) {
                                  handleNotificationOpen(notification);
                                }
                              }}
                            >
                              {notifications.map((notification) => (
                                <MenuItem
                                  key={notification._id}
                                  id={notification._id}
                                  title={notification.title || 'Notification'}
                                  className={classNames(
                                    'navbar-notification-item',
                                    {
                                      'navbar-notification-item-read':
                                        notification.isRead,
                                    }
                                  )}
                                  textValue={`${notification.title} ${
                                    notification.message || ''
                                  }`}
                                >
                                  <div className="navbar-notification-copy">
                                    <div className="navbar-notification-title-row">
                                      <strong>{notification.title}</strong>
                                      {!notification.isRead ? (
                                        <span className="navbar-status-dot" />
                                      ) : null}
                                    </div>
                                    <span>{notification.message}</span>
                                  </div>
                                  <small className="navbar-notification-meta">
                                    {notification.groupedCount > 1 ? (
                                      <span className="navbar-notification-thread-count">
                                        {notification.groupedCount} in thread
                                      </span>
                                    ) : null}
                                    {formatNotificationTime(
                                      notification.createdAt
                                    )}
                                  </small>
                                </MenuItem>
                              ))}
                            </Menu>
                          </div>
                        ) : (
                          <div className="navbar-menu-state">
                            <i className="tim-icons icon-check-2" />
                            <span>No new notifications</span>
                          </div>
                        )}
                      </div>
                    </Popover>
                  </MenuTrigger>
                </KukuTooltipTrigger>

                {canAccessAdmin ? (
                  <KukuTooltipTrigger content="Open admin dashboard" placement="bottom">
                    <AriaButton
                      className="navbar-action-trigger navbar-action-trigger-icon"
                      aria-label="Open admin dashboard"
                      onPress={() => navigate('/admin/dashboard')}
                    >
                      <i className="tim-icons icon-chart-pie-36" />
                    </AriaButton>
                  </KukuTooltipTrigger>
                ) : null}

                <KukuTooltipTrigger content="Account menu" placement="bottom">
                  <MenuTrigger>
                    <AriaButton
                      className="navbar-action-trigger navbar-avatar-container navbar-avatar-expandable"
                      aria-label="Open account menu"
                    >
                      <div className="navbar-name-avatar">
                        {user?.fullName?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div className="navbar-identity-copy d-none d-lg-flex">
                        <strong>{user?.fullName || 'My Account'}</strong>
                        <span>{user?.emailAddress || 'Signed in'}</span>
                      </div>
                      <i className="fas fa-chevron-down navbar-menu-chevron" />
                    </AriaButton>
                    <Popover
                      placement="bottom end"
                      offset={12}
                      className="navbar-menu-popover"
                    >
                      <div className="navbar-menu-panel navbar-account-panel">
                        <div className="navbar-menu-header">
                          <div>
                            <strong>{user?.fullName || 'Account'}</strong>
                            <span>
                              {user?.emailAddress || 'Manage your profile'}
                            </span>
                          </div>
                        </div>
                        <Menu className="navbar-menu-links">
                          <MenuItem
                            id="profile"
                            className="navbar-menu-button"
                            title="Profile"
                            onAction={() => navigate('/profile')}
                            textValue="Profile"
                          >
                            <i className="fas fa-user-circle" />
                            <span>Profile</span>
                          </MenuItem>
                          <MenuItem
                            id="about"
                            className="navbar-menu-button"
                            title="About Us"
                            onAction={() => navigate('/about-us')}
                            textValue="About Us"
                          >
                            <i className="fas fa-circle-info" />
                            <span>About Us</span>
                          </MenuItem>
                          <MenuItem
                            id="contact"
                            className="navbar-menu-button"
                            title="Contact Us"
                            onAction={() => navigate('/contact-us')}
                            textValue="Contact Us"
                          >
                            <i className="fas fa-headset" />
                            <span>Contact Us</span>
                          </MenuItem>
                          <MenuItem
                            id="support"
                            className="navbar-menu-button"
                            title="Support"
                            onAction={() => navigate('/support')}
                            textValue="Support"
                          >
                            <i className="fas fa-comments" />
                            <span>Support</span>
                          </MenuItem>
                          <Separator className="navbar-menu-separator" />
                          <MenuItem
                            id="logout"
                            className="navbar-menu-button navbar-menu-button-danger"
                            title="Log out"
                            onAction={signout}
                            textValue="Log out"
                          >
                            <i className="fas fa-arrow-right-from-bracket" />
                            <span>Log out</span>
                          </MenuItem>
                        </Menu>
                      </div>
                    </Popover>
                  </MenuTrigger>
                </KukuTooltipTrigger>
              </div>
            )}
          </Nav>
        </Container>
      </Navbar>

      <Modal
        isOpen={Boolean(selectedNotification)}
        toggle={() => setSelectedNotification(null)}
      >
        <ModalHeader toggle={() => setSelectedNotification(null)}>
          {selectedNotification?.title || 'Notification'}
        </ModalHeader>
        <ModalBody>
          <p>{selectedNotification?.message}</p>
          {selectedNotification?.createdAt && (
            <small className="text-muted d-block">
              {formatNotificationTime(selectedNotification.createdAt)}
            </small>
          )}
        </ModalBody>
      </Modal>
    </>
  );
}

export default CustomerNavbar;

CustomerNavbar.propTypes = {
  sidebarOpened: PropTypes.bool,
  toggleSidebar: PropTypes.func,
  brandText: PropTypes.string,
};
