import React from 'react';
import axios from 'axios';

import { useSocket } from 'contexts/SocketContext';
import { NOTIFICATIONS_SCOPE_READ_EVENT } from '../utils/notificationEvents';
import { networkTimeout } from '../../lib/helper';

function useNavbarNotifications(
  user,
  {
    limit = 5,
    enabled = true,
    includeGroupItems = false,
    groupItemLimit = 5,
    adminInboxOnly = false,
  } = {}
) {
  const socket = useSocket();
  const [notifications, setNotifications] = React.useState([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [notificationsLoading, setNotificationsLoading] = React.useState(false);
  const notificationsCountRef = React.useRef(0);
  const lastNotificationsFetchRef = React.useRef(0);
  const inflightNotificationsFetchRef = React.useRef(null);

  React.useEffect(() => {
    notificationsCountRef.current = notifications.length;
  }, [notifications.length]);

  const getNotificationReadScope = React.useCallback((notification) => {
    if (!notification) return null;

    if (notification.groupKey) {
      return {
        type: 'groupKey',
        value: notification.groupKey,
      };
    }

    const ticketId = notification?.meta?.ticketId;
    if (ticketId) {
      return {
        type: 'ticketId',
        value: ticketId,
      };
    }

    if (notification._id) {
      return {
        type: 'id',
        value: notification._id,
      };
    }

    return null;
  }, []);

  const matchesReadScope = React.useCallback((entry, readScope) => {
    if (!entry || !readScope) return false;

    switch (readScope.type) {
      case 'groupKey':
        return entry.groupKey === readScope.value;
      case 'ticketId':
        return entry?.meta?.ticketId === readScope.value;
      case 'id':
        return entry._id === readScope.value;
      default:
        return false;
    }
  }, []);

  const serializeReadScope = React.useCallback((readScope) => {
    if (!readScope?.type || !readScope?.value) return null;
    return `${readScope.type}:${String(readScope.value)}`;
  }, []);

  const applyReadScopeLocally = React.useCallback(
    (readScope, nextUnreadCount = null) => {
      if (!readScope?.type || !readScope?.value) return;

      const matchedUnreadCount = notifications.reduce((count, entry) => {
        if (matchesReadScope(entry, readScope) && !entry.isRead) {
          return count + 1;
        }
        return count;
      }, 0);

      setNotifications((prev) =>
        prev.map((entry) => {
          if (!matchesReadScope(entry, readScope) || entry.isRead) {
            return entry;
          }

          return {
            ...entry,
            isRead: true,
            groupUnreadCount: 0,
          };
        })
      );

      if (Number.isFinite(Number(nextUnreadCount))) {
        setUnreadCount(Math.max(0, Number(nextUnreadCount)));
        return;
      }

      if (matchedUnreadCount > 0) {
        setUnreadCount((prev) => Math.max(0, prev - matchedUnreadCount));
      }
    },
    [matchesReadScope, notifications]
  );

  const fetchNotifications = React.useCallback(
    async ({ force = false } = {}) => {
      if (!enabled || !user?.token) return null;

      const hasCachedNotifications = notificationsCountRef.current > 0;
      const now = Date.now();
      const isFresh = now - lastNotificationsFetchRef.current < 30000;

      if (!force && (inflightNotificationsFetchRef.current || isFresh)) {
        return inflightNotificationsFetchRef.current;
      }

      try {
        if (!hasCachedNotifications) {
          setNotificationsLoading(true);
        }

        const searchParams = new URLSearchParams({
          limit: String(limit),
        });
        if (includeGroupItems) {
          searchParams.set('includeGroupItems', 'true');
          searchParams.set('groupItemLimit', String(groupItemLimit));
        }
        if (adminInboxOnly) {
          searchParams.set('adminInboxOnly', 'true');
        }

        const request = axios.get(
          `/api/notifications?${searchParams.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${user.token}`,
            },
            timeout: networkTimeout,
          }
        );

        inflightNotificationsFetchRef.current = request;
        const response = await request;

        if (response.data?.success) {
          setNotifications(response.data.notifications || []);
          setUnreadCount(Number(response.data.unreadCount || 0));
          lastNotificationsFetchRef.current = Date.now();
        }

        return response;
      } catch (error) {
        console.error('Failed to load notifications:', error);
        return null;
      } finally {
        inflightNotificationsFetchRef.current = null;
        setNotificationsLoading(false);
      }
    },
    [
      adminInboxOnly,
      enabled,
      groupItemLimit,
      includeGroupItems,
      limit,
      user?.token,
    ]
  );

  const markNotificationRead = React.useCallback(
    async (notificationOrId) => {
      const notification =
        typeof notificationOrId === 'object' && notificationOrId
          ? notificationOrId
          : notifications.find((entry) => entry._id === notificationOrId);
      const notificationId = notification?._id || notificationOrId;

      if (!enabled || !user?.token || !notificationId) return false;

      try {
        const readScope = getNotificationReadScope(notification);

        if (notification && !notification.isRead) {
          setNotifications((prev) =>
            prev.map((entry) =>
              matchesReadScope(entry, readScope)
                ? {
                    ...entry,
                    isRead: true,
                    groupUnreadCount: 0,
                  }
                : entry
            )
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }

        const response = await axios.patch(
          `/api/notifications/${notificationId}/read`,
          {},
          {
            headers: {
              Authorization: `Bearer ${user.token}`,
            },
            timeout: networkTimeout,
          }
        );

        if (response.data?.success) {
          setUnreadCount(Number(response.data.unreadCount || 0));
        } else {
          await fetchNotifications({ force: true });
        }
        return true;
      } catch (error) {
        console.error('Failed to mark notification as read:', error);
        await fetchNotifications({ force: true });
        return false;
      }
    },
    [
      enabled,
      fetchNotifications,
      getNotificationReadScope,
      matchesReadScope,
      notifications,
      serializeReadScope,
      user?.token,
    ]
  );

  const markNotificationsPreviewed = React.useCallback(
    async (items = []) => {
      if (!enabled || !user?.token || !Array.isArray(items) || !items.length) {
        return false;
      }

      const previewTargets = [];
      const seenScopeKeys = new Set();

      items.forEach((item) => {
        if (!item || item.isRead || !item._id) return;

        const readScope = getNotificationReadScope(item);
        const scopeKey = serializeReadScope(readScope);

        if (!scopeKey || seenScopeKeys.has(scopeKey)) return;

        seenScopeKeys.add(scopeKey);
        previewTargets.push({
          notificationId: item._id,
          scopeKey,
        });
      });

      if (!previewTargets.length) {
        return true;
      }

      const previewScopeKeys = new Set(
        previewTargets.map((target) => target.scopeKey)
      );

      setNotifications((prev) =>
        prev.map((entry) => {
          const scopeKey = serializeReadScope(getNotificationReadScope(entry));
          if (!scopeKey || !previewScopeKeys.has(scopeKey) || entry.isRead) {
            return entry;
          }

          return {
            ...entry,
            isRead: true,
            groupUnreadCount: 0,
          };
        })
      );
      setUnreadCount((prev) => Math.max(0, prev - previewTargets.length));

      try {
        await Promise.all(
          previewTargets.map((target) =>
            axios.patch(
              `/api/notifications/${target.notificationId}/read`,
              {},
              {
                headers: {
                  Authorization: `Bearer ${user.token}`,
                },
                timeout: networkTimeout,
              }
            )
          )
        );

        void fetchNotifications({ force: true });
        return true;
      } catch (error) {
        console.error('Failed to preview notifications:', error);
        await fetchNotifications({ force: true });
        return false;
      }
    },
    [
      enabled,
      fetchNotifications,
      getNotificationReadScope,
      serializeReadScope,
      user?.token,
    ]
  );

  React.useEffect(() => {
    if (!enabled) return undefined;
    void fetchNotifications({ force: true });
    return undefined;
  }, [enabled, fetchNotifications]);

  React.useEffect(() => {
    if (!enabled || !user?.token || !socket) {
      return undefined;
    }

    const handleIncomingNotification = () => {
      void fetchNotifications({ force: true });
    };

    socket.on('notification:new', handleIncomingNotification);

    return () => {
      socket.off('notification:new', handleIncomingNotification);
    };
  }, [enabled, fetchNotifications, socket, user?.token]);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleScopeRead = (event) => {
      const readScope = event?.detail?.readScope || null;
      const nextUnreadCount = event?.detail?.unreadCount;

      applyReadScopeLocally(readScope, nextUnreadCount);
    };

    window.addEventListener(NOTIFICATIONS_SCOPE_READ_EVENT, handleScopeRead);

    return () => {
      window.removeEventListener(
        NOTIFICATIONS_SCOPE_READ_EVENT,
        handleScopeRead
      );
    };
  }, [applyReadScopeLocally]);

  return {
    notifications,
    unreadCount,
    notificationsLoading,
    fetchNotifications,
    markNotificationRead,
    markNotificationsPreviewed,
  };
}

export default useNavbarNotifications;
