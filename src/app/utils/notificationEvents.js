export const NOTIFICATIONS_SCOPE_READ_EVENT = 'kuku:notifications-scope-read';

export const buildTicketNotificationReadScope = (ticketId = '') => {
  const normalizedTicketId = String(ticketId || '').trim();
  if (!normalizedTicketId) return null;

  return {
    type: 'ticketId',
    value: normalizedTicketId,
  };
};

export const dispatchNotificationsScopeRead = ({
  readScope = null,
  unreadCount = null,
} = {}) => {
  if (typeof window === 'undefined' || !readScope?.type || !readScope?.value) {
    return;
  }

  const normalizedUnreadCount = Number(unreadCount);

  window.dispatchEvent(
    new CustomEvent(NOTIFICATIONS_SCOPE_READ_EVENT, {
      detail: {
        readScope,
        unreadCount: Number.isFinite(normalizedUnreadCount)
          ? normalizedUnreadCount
          : null,
      },
    })
  );
};
