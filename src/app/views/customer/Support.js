import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Row,
  Col,
  Button,
  Badge,
  Table,
  Spinner,
} from 'components/ui/primitives';
import { toast } from 'sonner';
import axios from 'axios';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';

import {
  avatarName,
  buildAuthNavigationTarget,
  getUser,
  networkTimeout,
} from '../../../lib/helper';
import { useSocket } from 'contexts/SocketContext';
import TicketThread from 'components/TicketChat/TicketThread';
import useTicketThreadRuntime from 'components/TicketChat/useTicketThreadRuntime';
import {
  buildMessageId,
  buildThreadMessages,
  toSafeIsoString,
} from 'components/TicketChat/ticketChatUtils';
import {
  buildTicketNotificationReadScope,
  dispatchNotificationsScopeRead,
} from '../../utils/notificationEvents';

const SUPPORT_DISPLAY_NAME = 'Kuku Data Support';

const safeToIsoString = (value, fallbackValue = new Date()) => {
  try {
    return toSafeIsoString(value, fallbackValue);
  } catch (_error) {
    return new Date().toISOString();
  }
};

const safeFormatDistanceLabel = (value) => {
  try {
    const resolvedDate = new Date(value);
    if (!Number.isFinite(resolvedDate.getTime())) {
      return 'Just now';
    }

    return formatDistanceToNowStrict(resolvedDate, {
      addSuffix: true,
    });
  } catch (error) {
    console.error('[Support] Failed to format relative message time:', error);
    return 'Just now';
  }
};

const safeFormatDateTime = (value, locale = 'en-US', options = {}) => {
  try {
    const resolvedDate = new Date(value);
    if (!Number.isFinite(resolvedDate.getTime())) {
      return '-';
    }

    return resolvedDate.toLocaleString(locale, options);
  } catch (error) {
    console.error('[Support] Failed to format date/time:', error);
    return '-';
  }
};

const emitSupportSocketEvent = (socket, eventName, payload, ack) => {
  try {
    if (!socket) return;
    if (typeof ack === 'function') {
      socket.emit(eventName, payload, (response) => {
        try {
          ack(response || {});
        } catch (ackError) {
          console.error('[Support] Socket acknowledgement handler failed:', {
            eventName,
            message: ackError?.message || String(ackError),
          });
        }
      });
      return;
    }

    socket.emit(eventName, payload);
  } catch (error) {
    console.error('[Support] Socket emit failed:', {
      eventName,
      message: error?.message || String(error),
    });
  }
};

const safeSetComposerText = (runtime, text = '') => {
  try {
    runtime?.thread?.composer?.setText?.(text);
  } catch (error) {
    console.error('[Support] Failed to update composer text:', error);
  }
};

const safeGetComposerText = (runtime) => {
  try {
    return runtime?.thread?.composer?.getState?.()?.text || '';
  } catch (error) {
    console.error('[Support] Failed to read composer text:', error);
    return '';
  }
};

const mapConversationEntryToMessage = (
  entry = {},
  fallbackSenderName = 'Customer'
) => {
  const senderType = entry.fromType === 'agent' ? 'agent' : 'user';
  const createdAt = safeToIsoString(entry.createdAt);
  const senderEmail = entry.fromEmail || '';
  const senderName =
    senderType === 'agent'
      ? SUPPORT_DISPLAY_NAME
      : entry.fromName || fallbackSenderName || senderEmail || 'Customer';

  return {
    id: buildMessageId(createdAt, senderEmail, senderType),
    text: entry.text?.trim()
      ? entry.text
      : entry.html?.trim() || '(no content)',
    timestamp: createdAt,
    rawCreatedAt: createdAt,
    senderType,
    senderName,
    senderEmail,
    direction: senderType === 'agent' ? 'incoming' : 'outgoing',
    deliveryState:
      senderType === 'user'
        ? entry.readByAgent
          ? 'seen'
          : 'sent'
        : 'received',
    readByAgent: Boolean(entry.readByAgent),
    readByUser: Boolean(entry.readByUser),
    failed: false,
  };
};

const toConversationEntry = (message = {}) => ({
  fromName:
    message.senderType === 'agent' ? SUPPORT_DISPLAY_NAME : message.senderName,
  fromEmail: message.senderEmail || '',
  fromType: message.senderType === 'agent' ? 'agent' : 'user',
  text: message.text || '',
  createdAt: safeToIsoString(message.rawCreatedAt || message.timestamp),
  readByUser: message.senderType === 'agent',
  readByAgent: Boolean(message.readByAgent),
});

const normalizeMessageText = (value = '') => String(value || '').trim();

const timestampsAreClose = (left, right, thresholdMs = 120000) => {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  return Math.abs(leftTime - rightTime) <= thresholdMs;
};

const findMatchingMessageIndex = (items = [], nextMessage = {}) => {
  const nextText = normalizeMessageText(nextMessage.text);
  const nextSenderEmail = nextMessage.senderEmail || '';
  const nextSenderType = nextMessage.senderType || '';
  const nextTimestamp = nextMessage.rawCreatedAt || nextMessage.timestamp;

  const exactIndex = items.findIndex(
    (item) =>
      item.rawCreatedAt === nextMessage.rawCreatedAt &&
      normalizeMessageText(item.text) === nextText &&
      (item.senderEmail || '') === nextSenderEmail &&
      item.senderType === nextSenderType
  );

  if (exactIndex !== -1) {
    return exactIndex;
  }

  return items.findIndex(
    (item) =>
      item.senderType === nextSenderType &&
      (item.senderEmail || '') === nextSenderEmail &&
      normalizeMessageText(item.text) === nextText &&
      timestampsAreClose(item.rawCreatedAt || item.timestamp, nextTimestamp) &&
      (item.deliveryState === 'sending' ||
        item.deliveryState === 'sent' ||
        item.failed)
  );
};

const findMatchingConversationIndex = (entries = [], nextMessage = {}) => {
  const nextText = normalizeMessageText(nextMessage.text);
  const nextSenderEmail = nextMessage.senderEmail || '';
  const nextSenderType = nextMessage.senderType || '';
  const nextTimestamp = nextMessage.rawCreatedAt || nextMessage.timestamp;

  const exactIndex = entries.findIndex(
    (entry) =>
      safeToIsoString(entry.createdAt, nextMessage.rawCreatedAt) ===
        nextMessage.rawCreatedAt &&
      normalizeMessageText(entry.text || entry.html || '(no content)') ===
        nextText &&
      (entry.fromEmail || '') === nextSenderEmail &&
      (entry.fromType === 'agent' ? 'agent' : 'user') === nextSenderType
  );

  if (exactIndex !== -1) {
    return exactIndex;
  }

  return entries.findIndex(
    (entry) =>
      (entry.fromType === 'agent' ? 'agent' : 'user') === nextSenderType &&
      (entry.fromEmail || '') === nextSenderEmail &&
      normalizeMessageText(entry.text || entry.html || '(no content)') ===
        nextText &&
      timestampsAreClose(entry.createdAt, nextTimestamp)
  );
};

const upsertMessage = (items = [], nextMessage) => {
  const existingIndex = findMatchingMessageIndex(items, nextMessage);

  if (existingIndex === -1) {
    return [...items, nextMessage];
  }

  const nextItems = [...items];
  nextItems[existingIndex] = {
    ...nextItems[existingIndex],
    ...nextMessage,
    deliveryState:
      nextMessage.deliveryState ||
      nextItems[existingIndex].deliveryState ||
      'sent',
    failed: Boolean(nextMessage.failed),
  };
  return nextItems;
};

const markMessagesReadByAgent = (items = []) =>
  items.map((item) =>
    item.senderType === 'user'
      ? {
          ...item,
          readByAgent: true,
          deliveryState: item.failed ? 'failed' : 'seen',
        }
      : item
  );

const markIncomingMessagesReadByUser = (items = []) =>
  items.map((item) =>
    item.senderType === 'agent'
      ? {
          ...item,
          readByUser: true,
        }
      : item
  );

const getFirstUnreadIncomingMessageId = (items = []) => {
  const firstUnread = items.find(
    (item) => item.senderType === 'agent' && !item.readByUser
  );

  return firstUnread?.id || null;
};

const getUnreadTicketCount = (ticket = {}) =>
  Number(
    ticket.unreadCount ??
      (ticket.conversation || []).filter(
        (entry) => entry.fromType === 'agent' && !entry.readByUser
      ).length ??
      0
  );

const mapSocketMessageToConversationEntry = (payload = {}) => ({
  fromName:
    payload.fromName ||
    payload.senderName ||
    (payload.fromType === 'agent' ? SUPPORT_DISPLAY_NAME : 'Customer'),
  fromEmail: payload.fromEmail || payload.senderEmail || '',
  fromType: payload.fromType === 'agent' ? 'agent' : 'user',
  text: payload.text || '',
  createdAt: safeToIsoString(payload.createdAt),
  readByUser: Boolean(payload.readByUser),
  readByAgent: Boolean(payload.readByAgent),
});

const formatMessageFooter = (message) => {
  if (!message?.timestamp) {
    return '';
  }

  const timeLabel = safeFormatDistanceLabel(message.timestamp);

  if (message.direction === 'incoming') {
    return timeLabel;
  }

  if (message.deliveryState === 'failed') {
    return `${timeLabel} - Failed to send`;
  }

  if (message.deliveryState === 'sending') {
    return timeLabel;
  }

  if (message.deliveryState === 'seen') {
    return `${timeLabel} - Seen by support`;
  }

  return `${timeLabel} - Delivered`;
};

const resolveRealtimeState = (connectionState, roomState) => {
  if (connectionState === 'error') {
    return {
      tone: 'danger',
      label: 'Realtime issue',
      helper: 'Messages can still send, but live updates may be delayed.',
    };
  }

  if (connectionState === 'offline') {
    return {
      tone: 'warning',
      label: 'Reconnecting',
      helper: 'Trying to restore the live support connection.',
    };
  }

  if (roomState === 'joined' && connectionState === 'connected') {
    return {
      tone: 'success',
      label: 'Live chat active',
      helper: 'New replies, typing, and seen states update instantly.',
    };
  }

  return {
    tone: 'info',
    label: 'Connecting',
    helper: 'Joining your support room and syncing messages.',
  };
};

const isCriticalSupportSubject = (subject = '') => {
  const normalizedSubject = String(subject || '')
    .trim()
    .toLowerCase();

  return (
    normalizedSubject.includes('fund error') ||
    normalizedSubject.includes('funding error')
  );
};

const Support = () => {
  const socket = useSocket();
  const location = useLocation();
  const navigate = useNavigate();
  const { id: ticketIdFromPath } = useParams();
  const [searchParams] = useSearchParams();
  const ticketIdFromQuery =
    searchParams.get('ticketId') || searchParams.get('ticket');
  const activeTicketIdFromUrl = String(
    ticketIdFromPath || ticketIdFromQuery || ''
  ).trim();
  const openTokenFromQuery = String(
    searchParams.get('openToken') || searchParams.get('digestToken') || ''
  ).trim();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState(null);
  const [isSomeoneTyping, setIsSomeoneTyping] = useState(false);
  const [typingName, setTypingName] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [roomState, setRoomState] = useState('idle');

  const joinRoomTimeoutRef = useRef(null);
  const chatViewportRef = useRef(null);
  const composerInputRef = useRef(null);
  const runtimeRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const selectedTicketRef = useRef(null);
  const processedOpenTokenRef = useRef('');

  const currentUser = getUser();
  const currentUserEmail = currentUser?.emailAddress || '';
  const selectedTicketId = selectedTicket?._id || null;

  const currentUserDisplayName = useMemo(
    () => currentUser?.fullName || currentUser?.name || 'Customer',
    [currentUser]
  );

  const realtimeState = useMemo(
    () => resolveRealtimeState(connectionState, roomState),
    [connectionState, roomState]
  );
  const subjectIsCritical = isCriticalSupportSubject(selectedTicket?.subject);
  const listTicketRoomIdsKey = useMemo(
    () =>
      [
        ...new Set(
          tickets
            .map((ticket) => String(ticket?._id || '').trim())
            .filter(Boolean)
        ),
      ].join('|'),
    [tickets]
  );

  useEffect(() => {
    selectedTicketRef.current = selectedTicket;
  }, [selectedTicket]);

  const threadMessages = useMemo(
    () => buildThreadMessages(messages, formatMessageFooter),
    [messages]
  );

  const updateSelectedTicketConversation = useCallback((updater) => {
    setSelectedTicket((prev) => {
      if (!prev?._id) return prev;
      return {
        ...prev,
        conversation: updater(prev.conversation || []),
      };
    });
  }, []);

  const markTicketNotificationsRead = useCallback(
    async (ticketId) => {
      const normalizedTicketId = String(ticketId || '').trim();
      if (!normalizedTicketId || !currentUser?.token) return false;

      try {
        const response = await axios.patch(
          '/api/notifications/read-scope',
          { ticketId: normalizedTicketId },
          {
            headers: {
              Authorization: `Bearer ${currentUser.token}`,
              'Content-Type': 'application/json',
            },
            timeout: networkTimeout,
          }
        );

        if (!response.data?.success) {
          return false;
        }

        dispatchNotificationsScopeRead({
          readScope: buildTicketNotificationReadScope(normalizedTicketId),
          unreadCount: response.data.unreadCount,
        });

        return true;
      } catch (error) {
        console.error('Failed to sync ticket notifications:', error);
        return false;
      }
    },
    [currentUser?.token]
  );

  const emitMessagesSeen = useCallback(
    (ticketData = null) => {
      const activeTicket = ticketData || selectedTicketRef.current;
      if (!activeTicket?._id) return;

      const hasUnreadAgentMessages = (activeTicket.conversation || []).some(
        (entry) => entry.fromType === 'agent' && !entry.readByUser
      );

      if (hasUnreadAgentMessages) {
        emitSupportSocketEvent(socket, 'messagesSeen', { ticketId: activeTicket._id });
        setUnreadMarkerMessageId(null);
        void markTicketNotificationsRead(activeTicket._id);
      }
    },
    [markTicketNotificationsRead, socket]
  );

  const emitTypingState = useCallback(
    (draftText = '') => {
      if (!selectedTicketId) return;

      emitSupportSocketEvent(socket, 'typing', {
        ticketId: selectedTicketId,
        isTyping: draftText.trim().length > 0,
        fullName: currentUserDisplayName,
        senderEmail: currentUser?.emailAddress,
        ticketOwner: selectedTicketRef.current?.senderEmail,
        ticket: selectedTicketRef.current?.ticket,
      });
    },
    [currentUser?.emailAddress, currentUserDisplayName, selectedTicketId, socket]
  );

  const handleRuntimeSend = useCallback(
    async ({ text, createdAt }) => {
      if (!text || !selectedTicketId || !currentUser?.token) return;

      const optimisticMessage = {
        id: buildMessageId(createdAt, currentUserEmail, 'user'),
        text,
        timestamp: createdAt,
        rawCreatedAt: createdAt,
        senderType: 'user',
        senderName: currentUserDisplayName,
        senderEmail: currentUserEmail,
        direction: 'outgoing',
        deliveryState: 'sending',
        readByAgent: false,
        failed: false,
      };

      setMessages((prev) => [...prev, optimisticMessage]);
      updateSelectedTicketConversation((conversation) => [
        ...conversation,
        toConversationEntry(optimisticMessage),
      ]);

      try {
        emitSupportSocketEvent(socket, 'typing', {
          ticketId: selectedTicketId,
          isTyping: false,
          fullName: currentUserDisplayName,
          senderEmail: currentUserEmail,
          ticketOwner: selectedTicketRef.current?.senderEmail,
          ticket: selectedTicketRef.current?.ticket,
        });

        const response = await axios.post(
          `/api/complains/${selectedTicketId}/reply`,
          { text, createdAt },
          {
            headers: {
              Authorization: `Bearer ${currentUser?.token || ''}`,
              'Content-Type': 'application/json',
              'X-Socket-Id': socket.id || '',
            },
            timeout: networkTimeout,
          }
        );

        const reply = response.data?.reply || {};

        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
                  deliveryState: reply.readByAgent ? 'seen' : 'sent',
                  readByAgent: Boolean(reply.readByAgent),
                  failed: false,
                }
              : message
          )
        );
        updateSelectedTicketConversation((conversation) =>
          conversation.map((entry) =>
            safeToIsoString(entry.createdAt, optimisticMessage.rawCreatedAt) ===
              optimisticMessage.rawCreatedAt &&
            (entry.fromEmail || '') === optimisticMessage.senderEmail
              ? {
                  ...entry,
                  readByAgent: Boolean(reply.readByAgent),
                  readByUser: true,
                }
              : entry
          )
        );
      } catch (err) {
        console.error('Failed to send message:', err);
        toast.error('Message failed to send. Please try again.');

        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id
              ? {
                  ...message,
                  deliveryState: 'failed',
                  failed: true,
                }
              : message
          )
        );

        safeSetComposerText(runtimeRef.current, text);
        requestAnimationFrame(() => {
          composerInputRef.current?.focus?.();
        });
      }
    },
    [
      currentUserEmail,
      currentUser?.token,
      currentUserDisplayName,
      selectedTicketId,
      updateSelectedTicketConversation,
    ]
  );

  const runtime = useTicketThreadRuntime({
    messages: threadMessages,
    onSend: handleRuntimeSend,
    disabled: loading || !selectedTicketId,
    composerRole: 'user',
  });

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const scrollChatToBottom = useCallback((behavior = 'smooth') => {
    const viewport = chatViewportRef.current;
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    });
  }, []);

  const clearJoinRoomTimeout = useCallback(() => {
    if (joinRoomTimeoutRef.current) {
      clearTimeout(joinRoomTimeoutRef.current);
      joinRoomTimeoutRef.current = null;
    }
  }, []);

  const markRoomJoined = useCallback(() => {
    clearJoinRoomTimeout();
    setConnectionState('connected');
    setRoomState('joined');
  }, [clearJoinRoomTimeout]);

  useEffect(() => {
    if (!selectedTicketId) {
      safeSetComposerText(runtime, '');
      setConnectionState('connecting');
      setRoomState('idle');
      setUnreadMarkerMessageId(null);
      return undefined;
    }

    if (!socket) {
      setConnectionState('offline');
      setRoomState('idle');
      return undefined;
    }

    setConnectionState(socket.connected ? 'connected' : 'connecting');
    setRoomState('joining');

    const joinActiveRoom = () => {
      clearJoinRoomTimeout();
      setConnectionState('connected');
      setRoomState('joining');

      emitSupportSocketEvent(
        socket,
        'join-ticket-room',
        { ticketId: selectedTicketId },
        (ack = {}) => {
          if (ack?.success) {
            markRoomJoined();
          }
        }
      );

      emitSupportSocketEvent(socket, 'presence:sync');
      emitMessagesSeen();

      joinRoomTimeoutRef.current = setTimeout(() => {
        if (socket.connected) {
          setRoomState((prev) => (prev === 'joining' ? 'joined' : prev));
        }
      }, 1500);
    };

    const handleConnect = () => {
      joinActiveRoom();
    };

    const handleDisconnect = () => {
      clearJoinRoomTimeout();
      setConnectionState('offline');
      setRoomState('idle');
    };

    const handleConnectError = () => {
      setConnectionState('error');
    };

    const handleAuthError = () => {
      setConnectionState('error');
      toast.error('Your live support session expired. Please sign in again.');
      navigate('/signin', { replace: true });
    };

    const handleMessage = (msg = {}) => {
      try {
        if (msg.ticketId !== selectedTicketId) return;

        markRoomJoined();

        const mappedMessage = mapConversationEntryToMessage(
          {
            fromType: msg.fromType,
            fromName: msg.fromName || msg.senderName,
            fromEmail: msg.fromEmail || msg.senderEmail,
            text: msg.text,
            createdAt: msg.createdAt,
            readByAgent: msg.readByAgent,
            readByUser: msg.readByUser,
          },
          currentUserDisplayName
        );

        setMessages((prev) => upsertMessage(prev, mappedMessage));
        updateSelectedTicketConversation((conversation) => {
          const existingIndex = findMatchingConversationIndex(
            conversation,
            mappedMessage
          );

          if (existingIndex !== -1) {
            const nextConversation = [...conversation];
            nextConversation[existingIndex] = {
              ...nextConversation[existingIndex],
              ...toConversationEntry(mappedMessage),
              readByAgent: mappedMessage.readByAgent,
              readByUser: mappedMessage.readByUser,
            };
            return nextConversation;
          }

          return [...conversation, toConversationEntry(mappedMessage)];
        });

        if (mappedMessage.senderType === 'agent') {
          const shouldAutoRead =
            shouldStickToBottomRef.current &&
            (typeof document === 'undefined' ||
              document.visibilityState === 'visible');

          if (!shouldAutoRead) {
            setUnreadMarkerMessageId((prev) => prev || mappedMessage.id);
          }

          if (shouldAutoRead) {
            emitSupportSocketEvent(socket, 'messagesSeen', { ticketId: selectedTicketId });
          }
        }
      } catch (error) {
        console.error('[Support] Failed to process incoming ticket message:', error);
      }
    };

    const handleTyping = (data = {}) => {
      try {
        if (data.ticketId !== selectedTicketId) return;
        if (data.senderType !== 'agent') return;
        if (
          data.senderEmail &&
          currentUserEmail &&
          data.senderEmail === currentUserEmail
        ) {
          return;
        }

        markRoomJoined();

        setIsSomeoneTyping(Boolean(data.isTyping));
        setTypingName(data.isTyping ? SUPPORT_DISPLAY_NAME : '');
      } catch (error) {
        console.error('[Support] Failed to process typing state:', error);
      }
    };

    const handleMessagesRead = (payload = {}) => {
      try {
        if (payload?.ticketId !== selectedTicketId) {
          return;
        }

        markRoomJoined();

        if (payload?.readBy?.type === 'agent') {
          setMessages((prev) => markMessagesReadByAgent(prev));
          updateSelectedTicketConversation((conversation) =>
            conversation.map((entry) =>
              entry.fromType === 'user'
                ? { ...entry, readByAgent: true }
                : entry
            )
          );
        }

        if (payload?.readBy?.type === 'user') {
          setMessages((prev) => markIncomingMessagesReadByUser(prev));
          updateSelectedTicketConversation((conversation) =>
            conversation.map((entry) =>
              entry.fromType === 'agent'
                ? { ...entry, readByUser: true }
                : entry
            )
          );
          setUnreadMarkerMessageId(null);
          void markTicketNotificationsRead(selectedTicketId);
        }
      } catch (error) {
        console.error('[Support] Failed to process read receipt:', error);
      }
    };

    const handleTicketRoomJoined = (payload) => {
      if (payload?.ticketId !== selectedTicketId) return;
      markRoomJoined();
    };

    const handleTicketRoomError = (payload) => {
      if (!payload?.ticketId || payload.ticketId !== selectedTicketId) return;

      clearJoinRoomTimeout();
      setRoomState('error');
      toast.error(payload.message || 'Unable to join this support ticket.');
      navigate('/support', { replace: true });
    };

    joinActiveRoom();

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('auth_error', handleAuthError);
    socket.on('ticket:message', handleMessage);
    socket.on('ticket:typing', handleTyping);
    socket.on('ticket:messages-read', handleMessagesRead);
    socket.on('ticket-room-joined', handleTicketRoomJoined);
    socket.on('ticket-room-error', handleTicketRoomError);

    return () => {
      clearJoinRoomTimeout();
      emitSupportSocketEvent(socket, 'leave-ticket-room', { ticketId: selectedTicketId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('auth_error', handleAuthError);
      socket.off('ticket:message', handleMessage);
      socket.off('ticket:typing', handleTyping);
      socket.off('ticket:messages-read', handleMessagesRead);
      socket.off('ticket-room-joined', handleTicketRoomJoined);
      socket.off('ticket-room-error', handleTicketRoomError);
    };
  }, [
    currentUser?.token,
    socket,
    currentUserDisplayName,
    clearJoinRoomTimeout,
    emitMessagesSeen,
    markRoomJoined,
    navigate,
    runtime,
    selectedTicketId,
    updateSelectedTicketConversation,
    markTicketNotificationsRead,
  ]);

  useEffect(() => {
    if (!selectedTicketId) return;

    void markTicketNotificationsRead(selectedTicketId);
  }, [markTicketNotificationsRead, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId) return undefined;

    emitTypingState(safeGetComposerText(runtime));

    return () => {
      emitTypingState('');
    };
  }, [emitTypingState, runtime, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId) return undefined;

    const viewport = chatViewportRef.current;
    if (!viewport) return undefined;

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom < 120;

      if (
        shouldStickToBottomRef.current &&
        messages.some(
          (message) => message.senderType === 'agent' && !message.readByUser
        )
      ) {
        emitMessagesSeen(selectedTicketRef.current);
      }
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll);

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, [emitMessagesSeen, messages, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId || !shouldStickToBottomRef.current) return;
    scrollChatToBottom(messages.length > 1 ? 'smooth' : 'auto');
  }, [messages.length, scrollChatToBottom, selectedTicketId]);

  useEffect(() => {
    if (!currentUser?.token || !socket || selectedTicketId || !listTicketRoomIdsKey) {
      return undefined;
    }

    const ticketIds = listTicketRoomIdsKey.split('|').filter(Boolean);

    ticketIds.forEach((ticketId) => {
      emitSupportSocketEvent(socket, 'join-ticket-room', { ticketId });
    });

    const handleListTicketMessage = (payload = {}) => {
      try {
        const incomingTicketId = String(payload.ticketId || '').trim();
        if (!incomingTicketId) return;

        setTickets((prevTickets) =>
          prevTickets.map((ticket) => {
            if (String(ticket?._id || '') !== incomingTicketId) {
              return ticket;
            }

            const existingConversation = Array.isArray(ticket.conversation)
              ? ticket.conversation
              : [];
            const nextEntry = mapSocketMessageToConversationEntry(payload);
            const existingIndex = existingConversation.findIndex((entry) => {
              const entryText = normalizeMessageText(
                entry?.text || entry?.html || '(no content)'
              );
              const nextText = normalizeMessageText(nextEntry.text);
              const entryType = entry?.fromType === 'agent' ? 'agent' : 'user';

              return (
                entryType === nextEntry.fromType &&
                (entry?.fromEmail || '') === nextEntry.fromEmail &&
                entryText === nextText &&
                timestampsAreClose(entry?.createdAt, nextEntry.createdAt)
              );
            });

            let nextConversation = existingConversation;
            if (existingIndex === -1) {
              nextConversation = [...existingConversation, nextEntry];
            } else {
              nextConversation = [...existingConversation];
              nextConversation[existingIndex] = {
                ...nextConversation[existingIndex],
                ...nextEntry,
                readByUser:
                  typeof payload.readByUser === 'boolean'
                    ? Boolean(payload.readByUser)
                    : Boolean(nextConversation[existingIndex]?.readByUser),
                readByAgent:
                  typeof payload.readByAgent === 'boolean'
                    ? Boolean(payload.readByAgent)
                    : Boolean(nextConversation[existingIndex]?.readByAgent),
              };
            }

            const unreadCount = nextConversation.filter(
              (entry) => entry?.fromType === 'agent' && !entry?.readByUser
            ).length;

            return {
              ...ticket,
              conversation: nextConversation,
              unreadCount,
            };
          })
        );
      } catch (error) {
        console.error('[Support] Failed to update ticket list from new message:', error);
      }
    };

    const handleListMessagesRead = (payload = {}) => {
      try {
        const incomingTicketId = String(payload.ticketId || '').trim();
        if (!incomingTicketId || payload?.readBy?.type !== 'user') {
          return;
        }

        setTickets((prevTickets) =>
          prevTickets.map((ticket) => {
            if (String(ticket?._id || '') !== incomingTicketId) {
              return ticket;
            }

            const nextConversation = (ticket.conversation || []).map((entry) =>
              entry?.fromType === 'agent'
                ? { ...entry, readByUser: true }
                : entry
            );

            return {
              ...ticket,
              conversation: nextConversation,
              unreadCount: 0,
            };
          })
        );
      } catch (error) {
        console.error('[Support] Failed to update ticket list read state:', error);
      }
    };

    const handleListTicketUpdated = (payload = {}) => {
      try {
        const incomingTicketId = String(
          payload?._id || payload?.ticketId || ''
        ).trim();
        if (!incomingTicketId) return;

        setTickets((prevTickets) =>
          prevTickets.map((ticket) => {
            if (String(ticket?._id || '') !== incomingTicketId) {
              return ticket;
            }

            const incomingConversation = Array.isArray(payload.conversation)
              ? payload.conversation
              : ticket.conversation || [];
            const unreadCount = incomingConversation.filter(
              (entry) => entry?.fromType === 'agent' && !entry?.readByUser
            ).length;

            return {
              ...ticket,
              ...payload,
              conversation: incomingConversation,
              unreadCount,
            };
          })
        );
      } catch (error) {
        console.error('[Support] Failed to process ticket update event:', error);
      }
    };

    socket.on('ticket:message', handleListTicketMessage);
    socket.on('ticket:messages-read', handleListMessagesRead);
    socket.on('ticket:updated', handleListTicketUpdated);

    return () => {
      socket.off('ticket:message', handleListTicketMessage);
      socket.off('ticket:messages-read', handleListMessagesRead);
      socket.off('ticket:updated', handleListTicketUpdated);
      ticketIds.forEach((ticketId) => {
        emitSupportSocketEvent(socket, 'leave-ticket-room', { ticketId });
      });
    };
  }, [currentUser?.token, selectedTicketId, listTicketRoomIdsKey, socket]);

  useEffect(() => {
    if (!openTokenFromQuery || !currentUser?.token) {
      return undefined;
    }

    if (processedOpenTokenRef.current === openTokenFromQuery) {
      return undefined;
    }

    processedOpenTokenRef.current = openTokenFromQuery;
    let cancelled = false;

    const markDigestOpen = async () => {
      try {
        const response = await axios.get(
          `/api/complains/email/open/${encodeURIComponent(
            openTokenFromQuery
          )}/mark`,
          {
            headers: {
              'ngrok-skip-browser-warning': '1',
              'Cache-Control': 'no-cache',
            },
            timeout: networkTimeout,
          }
        );

        if (cancelled) {
          return;
        }

        if (!response.data?.success) {
          processedOpenTokenRef.current = '';
          return;
        }

        const resolvedTicketId = String(
          response.data?.ticketId || activeTicketIdFromUrl || ''
        ).trim();

        if (resolvedTicketId) {
          setTickets((prevTickets) =>
            prevTickets.map((ticket) => {
              if (String(ticket?._id || '') !== resolvedTicketId) {
                return ticket;
              }

              const nextConversation = (ticket.conversation || []).map((entry) =>
                entry?.fromType === 'agent'
                  ? { ...entry, readByUser: true }
                  : entry
              );

              return {
                ...ticket,
                conversation: nextConversation,
                unreadCount: 0,
              };
            })
          );

          if (String(selectedTicketId || '') === resolvedTicketId) {
            setMessages((prev) => markIncomingMessagesReadByUser(prev));
            updateSelectedTicketConversation((conversation) =>
              conversation.map((entry) =>
                entry.fromType === 'agent'
                  ? { ...entry, readByUser: true }
                  : entry
              )
            );
            setUnreadMarkerMessageId(null);
            void markTicketNotificationsRead(resolvedTicketId);
          }
        }
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.delete('openToken');
        nextParams.delete('digestToken');
        const nextSearch = nextParams.toString();
        const nextUrl = `${location.pathname}${
          nextSearch ? `?${nextSearch}` : ''
        }`;

        navigate(nextUrl, { replace: true });
      } catch (error) {
        processedOpenTokenRef.current = '';
        console.error('Support digest token tracking failed:', error);
      }
    };

    void markDigestOpen();

    return () => {
      cancelled = true;
    };
  }, [
    currentUser?.token,
    openTokenFromQuery,
    searchParams,
    location.pathname,
    navigate,
    activeTicketIdFromUrl,
    selectedTicketId,
    updateSelectedTicketConversation,
    markTicketNotificationsRead,
  ]);

  useEffect(() => {
    if (!currentUser?.token) {
      const returnToPath = `${location.pathname}${location.search || ''}`;
      navigate(buildAuthNavigationTarget('/signin', returnToPath), {
        replace: true,
      });
      return;
    }

    if (activeTicketIdFromUrl) {
      fetchTicketById(activeTicketIdFromUrl);
      return;
    }

    fetchUserTickets();
    setSelectedTicket(null);
    setMessages([]);
  }, [currentUser?.token, navigate, location.pathname, location.search, activeTicketIdFromUrl]);

  const fetchUserTickets = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/complains/tickets', {
        headers: {
          Authorization: `Bearer ${currentUser?.token || ''}`,
        },
        timeout: networkTimeout,
      });

      if (res.data?.success) {
        setTickets(res.data.tickets || []);
        if (res.data.tickets?.length === 0) {
          toast.info('No tickets found for your account');
        }
      } else {
        toast.error(res.data?.message || 'Failed to load tickets');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const fetchTicketById = async (ticketId) => {
    if (!ticketId) return;

    setLoading(true);
    try {
      const res = await axios.get(`/api/complains/ticket/${ticketId}`, {
        headers: {
          Authorization: `Bearer ${currentUser?.token || ''}`,
        },
        timeout: networkTimeout,
      });

      if (res.data?.success) {
        setSelectedTicket(res.data.ticket);
        const nextMessages = (res.data.ticket?.conversation || []).map(
          (entry) =>
            mapConversationEntryToMessage(
              entry,
              avatarName(res.data.ticket?.senderName) || currentUserDisplayName
            )
        );
        setMessages(nextMessages);
        setUnreadMarkerMessageId(getFirstUnreadIncomingMessageId(nextMessages));
        setTickets([]);
      } else {
        toast.error(res.data?.message || 'Ticket not found');
        navigate('/support', { replace: true });
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Network error');
      navigate('/support', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshTickets = () => {
    fetchUserTickets();
  };

  const handleViewTicket = (ticket) => {
    if (!ticket?._id) {
      toast.error('This support ticket is unavailable right now.');
      return;
    }

    setSelectedTicket(ticket);
    setTickets([]);
    navigate(`/ticket/${ticket._id}`, { replace: true });
  };

  const handleBackToList = () => {
    setSelectedTicket(null);
    setMessages([]);
    setUnreadMarkerMessageId(null);
    setRoomState('idle');
    safeSetComposerText(runtime, '');
    navigate('/support', { replace: true });
    fetchUserTickets();
  };

  const getStatusBadgeColor = (status) => {
    const colors = {
      open: 'warning',
      pending: 'info',
      in_progress: 'info',
      resolved: 'success',
      closed: 'secondary',
    };
    return colors[status?.toLowerCase()] || 'secondary';
  };

  const getPriorityBadgeColor = (priority) => {
    const colors = {
      low: 'info',
      medium: 'warning',
      high: 'danger',
      urgent: 'danger',
    };
    return colors[priority?.toLowerCase()] || 'secondary';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return safeFormatDateTime(dateStr, 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="content">
      {selectedTicket ? (
        <Row>
          <Col lg="12">
            <Card className="support-ticket-card">
              <CardBody>
                <div className="support-chat-shell">
                  <div className="support-chat-topline support-chat-topline-admin">
                    <div className="support-chat-topline-head">
                      <div className="support-chat-title-inline">
                        <span
                          className={`support-chat-subject${
                            subjectIsCritical
                              ? ' support-chat-subject-critical'
                              : ''
                          }`}
                          title={selectedTicket.subject}
                        >
                          {selectedTicket.subject || 'No subject'}
                        </span>
                        <span
                          className={`chat-status-pill chat-status-pill-${realtimeState.tone}`}
                        >
                          {realtimeState.label}
                        </span>
                        <Badge
                          color={getPriorityBadgeColor(selectedTicket.priority)}
                          className="support-chat-outline-badge"
                        >
                          {selectedTicket.priority?.toUpperCase() || '-'}
                        </Badge>
                        <Badge
                          color={getStatusBadgeColor(selectedTicket.status)}
                          className="support-chat-outline-badge"
                        >
                          {selectedTicket.status?.toUpperCase() || 'UNKNOWN'}
                        </Badge>
                      </div>
                      <Button
                        color="secondary"
                        size="sm"
                        onClick={handleBackToList}
                      >
                        Back to List
                      </Button>
                    </div>
                    <div className="support-chat-meta-strip support-chat-meta-strip-admin">
                      <span className="support-chat-meta-pill">
                        <i
                          className="tim-icons icon-single-02"
                          aria-hidden="true"
                        />
                        {SUPPORT_DISPLAY_NAME}
                      </span>
                      <span className="support-chat-reference">
                        <i className="tim-icons icon-tag" aria-hidden="true" />
                        Ref: {selectedTicket.ticket}
                      </span>
                      <span className="support-chat-meta-pill">
                        <i
                          className="tim-icons icon-time-alarm"
                          aria-hidden="true"
                        />
                        {formatDate(selectedTicket.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="chat-container support-chat-container">
                    <TicketThread
                      runtime={runtime}
                      threadMessages={threadMessages}
                      unreadMarkerMessageId={unreadMarkerMessageId}
                      typingText={
                        isSomeoneTyping ? `${typingName} is typing...` : ''
                      }
                      emptyCopy="No messages yet. Send a message and our support team will respond here."
                      composerPlaceholder="Write a message to support..."
                      assistantIsOutgoing={false}
                      viewportRef={chatViewportRef}
                      composerRef={composerInputRef}
                      composerDisabled={loading || !selectedTicketId}
                      onComposerTextChange={emitTypingState}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      ) : null}

      {!selectedTicket && tickets.length > 0 ? (
        <Row>
          <Col lg="12">
            <Card>
              <CardHeader className="support-ticket-toolbar">
                <div>
                  <CardTitle tag="h4">Your Support Tickets</CardTitle>
                </div>
                <div className="support-ticket-toolbar-actions">
                  <Button
                    color="info"
                    type="button"
                    disabled={loading}
                    onClick={handleRefreshTickets}
                  >
                    {loading ? (
                      <>
                        <Spinner size="sm"> </Spinner> Loading...
                      </>
                    ) : (
                      'Refresh'
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                <div style={{ overflowX: 'auto' }}>
                  <Table hover responsive>
                    <thead>
                      <tr>
                        <th>Ticket #</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((ticket) => {
                        const unreadTicketCount = getUnreadTicketCount(ticket);

                        return (
                          <tr
                            key={ticket._id}
                            className="support-ticket-row-clickable"
                            onClick={() => handleViewTicket(ticket)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleViewTicket(ticket);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <td>
                              <strong>{ticket.ticket}</strong>
                            </td>
                            <td className="support-ticket-subject-cell">
                              <span className="support-ticket-subject-text">
                                {ticket.subject || '-'}
                              </span>
                            </td>
                            <td>
                              <Badge color={getStatusBadgeColor(ticket.status)}>
                                {ticket.status?.toUpperCase() || '-'}
                              </Badge>
                            </td>
                            <td>
                              <Badge
                                color={getPriorityBadgeColor(ticket.priority)}
                              >
                                {ticket.priority?.toUpperCase() || '-'}
                              </Badge>
                            </td>
                            <td className="support-ticket-created-cell">
                              <span className="support-ticket-created-text">
                                {formatDate(ticket.createdAt)}
                              </span>
                              {unreadTicketCount > 0 ? (
                                <Badge
                                  color="danger"
                                  className="support-ticket-unread-badge support-ticket-unread-badge-absolute"
                                >
                                  {unreadTicketCount}
                                </Badge>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      ) : null}

      {!selectedTicket &&
      !loading &&
      tickets.length === 0 &&
      currentUser?.emailAddress ? (
        <Row>
          <Col lg="12">
            <Card>
              <CardHeader className="support-ticket-toolbar">
                <CardTitle tag="h4">Your Support Tickets</CardTitle>
                <div className="support-ticket-toolbar-actions">
                  <Button
                    color="info"
                    type="button"
                    disabled={loading}
                    onClick={handleRefreshTickets}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="text-center py-5">
                  <h5 className="text-muted">
                    No tickets found for your account.
                  </h5>
                  <p className="text-muted small mt-2">
                    Need help?{' '}
                    <Link to="/contact-us">Create a new support request</Link>
                  </p>
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      ) : null}

      {loading ? (
        <Row>
          <Col lg="12">
            <Card>
              <CardBody className="text-center py-5">
                <Spinner color="primary"> </Spinner>
                <p className="mt-3 text-muted">Loading...</p>
              </CardBody>
            </Card>
          </Col>
        </Row>
      ) : null}
    </div>
  );
};

export default Support;
