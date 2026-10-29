import React from 'react';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import {
  Button as AriaButton,
  MenuTrigger,
  Popover,
  Separator,
} from 'react-aria-components';
import { KukuTooltipTrigger } from 'components/ui/Tooltip';

import {
  Badge,
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
import { getUser, signout } from '../../../lib/helper';
import useNavbarNotifications from '../../hooks/useNavbarNotifications';
import { hasAdminDashboardAccess } from '../../utils/adminAccess';

function AdminNavbar(props) {
  const navigate = useNavigate();
  const user = getUser();
  const canAccessAdmin = hasAdminDashboardAccess(user);
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = React.useState(false);
  const [selectedNotification, setSelectedNotification] = React.useState(null);
  const [expandedSections, setExpandedSections] = React.useState({
    complain: true,
    contact_request: true,
  });
  const {
    notifications,
    unreadCount,
    notificationsLoading,
    fetchNotifications,
    markNotificationRead,
    markNotificationsPreviewed,
  } = useNavbarNotifications(user, {
    limit: 12,
    enabled: Boolean(user?.token),
    adminInboxOnly: true,
  });

  React.useEffect(() => {
    if (!isNotificationMenuOpen || !notifications.length) return;

    const unreadVisibleNotifications = notifications.filter(
      (notification) => !notification.isRead
    );

    if (!unreadVisibleNotifications.length) return;

    void markNotificationsPreviewed(unreadVisibleNotifications);
  }, [isNotificationMenuOpen, markNotificationsPreviewed, notifications]);

  const initials =
    user?.fullName
      ?.split(' ')
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'AD';

  const formatNotificationTime = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleNotificationOpen = async (notification) => {
    if (!notification) return;

    if (!notification.isRead) {
      await markNotificationRead(notification);
    }

    const actionUrl = notification?.actionUrl || '';
    if (actionUrl.startsWith('/')) {
      navigate(actionUrl);
      return;
    }

    setSelectedNotification(notification);
  };

  const inferNotificationSection = React.useCallback((notification) => {
    const inboxType = notification?.meta?.adminInboxType;
    if (inboxType === 'contact_request') return 'contact_request';
    if (inboxType === 'complain') return 'complain';
    if (notification?.meta?.contactRequestId) return 'contact_request';
    if (notification?.meta?.ticketId) return 'complain';
    if (
      typeof notification?.notificationGroupKey === 'string' &&
      notification.notificationGroupKey.startsWith('contact-request:')
    ) {
      return 'contact_request';
    }
    return 'complain';
  }, []);

  const groupedNotifications = React.useMemo(() => {
    const sections = {
      complain: [],
      contact_request: [],
    };

    notifications.forEach((notification) => {
      const section = inferNotificationSection(notification);
      sections[section].push(notification);
    });

    return [
      {
        key: 'complain',
        title: 'Complains',
        subtitle: 'Support tickets and replies',
        items: sections.complain,
      },
      {
        key: 'contact_request',
        title: 'Contact Us',
        subtitle: 'Development and enquiry requests',
        items: sections.contact_request,
      },
    ];
  }, [inferNotificationSection, notifications]);

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const sectionUnreadCount = (items = []) =>
    items.reduce((total, item) => total + (item.isRead ? 0 : 1), 0);

  return (
    <>
      <Navbar
        className={classNames(
          'navbar-absolute',
          'navbar-transparent',
          'admin-navbar-shell'
        )}
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
            <KukuTooltipTrigger content="Admin notifications" placement="bottom">
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
                  aria-label="Open admin notifications"
                >
                  <i className="tim-icons icon-bell-55 large-bell" />
                  {unreadCount > 0 ? (
                    <Badge color="danger" pill className="navbar-unread-badge">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  ) : null}
                </AriaButton>
                <Popover placement="bottom end" offset={12} className="navbar-menu-popover">
                  <div className="navbar-menu-panel navbar-notification-panel">
                    <div className="navbar-menu-header">
                      <div>
                        <strong>Support Inbox</strong>
                        <span>Complains and Contact Us requests only</span>
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
                        {groupedNotifications.map((section) => (
                          <div
                            key={section.key}
                            className={classNames('navbar-notification-group', {
                              'navbar-notification-group-read':
                                sectionUnreadCount(section.items) === 0,
                            })}
                          >
                            <button
                              type="button"
                              className="navbar-notification-group-trigger"
                              title={`${section.title} notifications`}
                              onClick={() => toggleSection(section.key)}
                            >
                              <div className="navbar-notification-copy">
                                <div className="navbar-notification-title-row">
                                  <strong>{section.title}</strong>
                                  {sectionUnreadCount(section.items) > 0 ? (
                                    <span className="navbar-status-dot" />
                                  ) : null}
                                </div>
                                <span>{section.subtitle}</span>
                              </div>
                              <div className="navbar-notification-group-meta">
                                <span className="navbar-notification-group-count">
                                  {section.items.length}
                                </span>
                                <i
                                  className={classNames(
                                    'fas fa-chevron-down navbar-notification-group-chevron',
                                    {
                                      'navbar-notification-group-chevron-open':
                                        expandedSections[section.key],
                                    }
                                  )}
                                />
                              </div>
                            </button>
                            {expandedSections[section.key] ? (
                              <div className="navbar-notification-group-items">
                                {section.items.length > 0 ? (
                                  section.items.map((item) => (
                                  <button
                                    key={item._id}
                                    type="button"
                                    title={item.title || 'Notification'}
                                    className={classNames(
                                      'navbar-notification-item navbar-notification-child',
                                      {
                                        'navbar-notification-item-read': item.isRead,
                                      }
                                    )}
                                    onClick={() => handleNotificationOpen(item)}
                                  >
                                    <div className="navbar-notification-copy">
                                      <div className="navbar-notification-title-row">
                                        <strong>{item.title}</strong>
                                        {!item.isRead ? (
                                          <span className="navbar-status-dot" />
                                        ) : null}
                                      </div>
                                      <span>{item.message}</span>
                                    </div>
                                    <small className="navbar-notification-meta">
                                      {formatNotificationTime(item.createdAt)}
                                    </small>
                                  </button>
                                  ))
                                ) : (
                                  <div className="navbar-menu-state navbar-menu-state-compact">
                                    <span>No {section.title.toLowerCase()} yet</span>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
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
                  className="navbar-action-trigger"
                  aria-label="Open admin dashboard"
                  onPress={() => navigate('/admin/dashboard')}
                >
                  <i className="tim-icons icon-chart-pie-36" />
                </AriaButton>
              </KukuTooltipTrigger>
            ) : null}

            <KukuTooltipTrigger content="Admin account menu" placement="bottom">
              <MenuTrigger>
                <AriaButton
                  className="navbar-action-trigger navbar-avatar-container navbar-avatar-expandable"
                  aria-label="Open admin account menu"
                >
                  <div className="navbar-name-avatar">{initials}</div>
                  <div className="navbar-identity-copy d-none d-lg-flex">
                    <strong>{user?.fullName || 'Admin'}</strong>
                    <span>{user?.emailAddress || 'Administrator'}</span>
                  </div>
                  <i className="fas fa-chevron-down navbar-menu-chevron" />
                </AriaButton>
                <Popover placement="bottom end" offset={12} className="navbar-menu-popover">
                  <div className="navbar-menu-panel navbar-account-panel">
                    <div className="navbar-menu-header">
                      <div>
                        <strong>{user?.fullName || 'Admin account'}</strong>
                        <span>{user?.emailAddress || 'Manage your admin tools'}</span>
                      </div>
                    </div>
                    <div className="navbar-menu-links">
                      <button
                        type="button"
                        className="navbar-menu-button"
                        title="Dashboard"
                        onClick={() => navigate('/admin/dashboard')}
                      >
                        <i className="tim-icons icon-chart-pie-36" />
                        <span>Dashboard</span>
                      </button>
                      <button
                        type="button"
                        className="navbar-menu-button"
                        title="Plans"
                        onClick={() => navigate('/admin/plans')}
                      >
                        <i className="tim-icons icon-chart-bar-32" />
                        <span>Plans</span>
                      </button>
                      <button
                        type="button"
                        className="navbar-menu-button"
                        title="Complains"
                        onClick={() => navigate('/admin/complains')}
                      >
                        <i className="tim-icons icon-bell-55" />
                        <span>Complains</span>
                      </button>
                      <Separator className="navbar-menu-separator" />
                      <button
                        type="button"
                        className="navbar-menu-button navbar-menu-button-danger"
                        title="Log out"
                        onClick={signout}
                      >
                        <i className="fas fa-arrow-right-from-bracket" />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>
                </Popover>
              </MenuTrigger>
            </KukuTooltipTrigger>
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
          {selectedNotification?.createdAt ? (
            <small className="text-muted d-block">
              {formatNotificationTime(selectedNotification.createdAt)}
            </small>
          ) : null}
          {selectedNotification?.meta?.reference ? (
            <small className="text-muted d-block mt-2">
              Reference: {selectedNotification.meta.reference}
            </small>
          ) : null}
        </ModalBody>
      </Modal>
    </>
  );
}

export default AdminNavbar;
