import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Container,
  Row,
  Col,
  Badge,
  Button,
  Spinner,
} from 'components/ui/primitives';
import axios from 'axios';
import { formatDistanceToNowStrict } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { avatarName, getUser, networkTimeout } from '../../../lib/helper';
import { useSocket } from 'contexts/SocketContext.js';
import TicketThread from 'components/TicketChat/TicketThread';
import useTicketThreadRuntime from 'components/TicketChat/useTicketThreadRuntime';
import {
  buildMessageId,
  buildThreadMessages,
  toSafeIsoString,
} from 'components/TicketChat/ticketChatUtils';

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
    console.error('[Admin Ticket] Failed to format relative time:', error);
    return 'Just now';
  }
};

const safeFormatDateTime = (value, locale = undefined, options = undefined) => {
  try {
    const resolvedDate = new Date(value);
    if (!Number.isFinite(resolvedDate.getTime())) {
      return '-';
    }

    return resolvedDate.toLocaleString(locale, options);
  } catch (error) {
    console.error('[Admin Ticket] Failed to format date/time:', error);
    return '-';
  }
};

const normalizePresenceEmails = (users = []) =>
  Array.isArray(users)
    ? users
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean)
    : [];

const emitTicketSocketEvent = (socket, eventName, payload, ack) => {
  try {
    if (!socket) return;
    if (typeof ack === 'function') {
      socket.emit(eventName, payload, (response) => {
        try {
          ack(response || {});
        } catch (ackError) {
          console.error('[Admin Ticket] Socket acknowledgement failed:', {
            eventName,
            message: ackError?.message || String(ackError),
          });
        }
      });
      return;
    }

    socket.emit(eventName, payload);
  } catch (error) {
    console.error('[Admin Ticket] Socket emit failed:', {
      eventName,
      message: error?.message || String(error),
    });
  }
};

const safeSetComposerText = (runtime, text = '') => {
  try {
    runtime?.thread?.composer?.setText?.(text);
  } catch (error) {
    console.error('[Admin Ticket] Failed to set composer text:', error);
  }
};

const safeGetComposerText = (runtime) => {
  try {
    return runtime?.thread?.composer?.getState?.()?.text || '';
  } catch (error) {
    console.error('[Admin Ticket] Failed to read composer text:', error);
    return '';
  }
};

const mapConversationEntryToMessage = (
  entry = {},
  fallbackSenderName = 'Customer'
) => {
  const senderType = entry.fromType === 'user' ? 'user' : 'agent';
  const createdAt = safeToIsoString(entry.createdAt);
  const senderEmail = entry.fromEmail || '';
  const senderName =
    senderType === 'user'
      ? entry.fromName || fallbackSenderName || senderEmail || 'Customer'
      : SUPPORT_DISPLAY_NAME;

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
    direction: senderType === 'user' ? 'incoming' : 'outgoing',
    deliveryState:
      senderType === 'agent'
        ? entry.readByUser
          ? 'seen'
          : 'sent'
        : 'received',
    readByUser: Boolean(entry.readByUser),
    readByAgent: Boolean(entry.readByAgent),
    failed: false,
  };
};

const toConversationEntry = (message = {}) => ({
  fromName:
    message.senderType === 'user' ? message.senderName : SUPPORT_DISPLAY_NAME,
  fromEmail: message.senderEmail || '',
  fromType: message.senderType === 'user' ? 'user' : 'agent',
  text: message.text || '',
  createdAt: safeToIsoString(message.rawCreatedAt || message.timestamp),
  readByUser: Boolean(message.readByUser),
  readByAgent: message.senderType === 'user',
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

const markMessagesReadByUser = (items = []) =>
  items.map((item) =>
    item.senderType === 'agent'
      ? {
          ...item,
          readByUser: true,
          deliveryState: item.failed ? 'failed' : 'seen',
        }
      : item
  );

const markIncomingMessagesReadByAgent = (items = []) =>
  items.map((item) =>
    item.senderType === 'user'
      ? {
          ...item,
          readByAgent: true,
        }
      : item
  );

const getFirstUnreadIncomingMessageId = (items = []) => {
  const firstUnread = items.find(
    (item) => item.senderType === 'user' && !item.readByAgent
  );

  return firstUnread?.id || null;
};

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
    return `${timeLabel} - Seen by customer`;
  }

  return `${timeLabel} - Delivered`;
};

const resolveRealtimeState = (connectionState, roomState) => {
  if (connectionState === 'error') {
    return {
      tone: 'danger',
      label: 'Realtime issue',
      helper: 'Socket events are not healthy right now.',
    };
  }

  if (connectionState === 'offline') {
    return {
      tone: 'warning',
      label: 'Reconnecting',
      helper: 'Trying to restore the ticket room.',
    };
  }

  if (roomState === 'joined' && connectionState === 'connected') {
    return {
      tone: 'success',
      label: 'Live room active',
      helper: 'Replies, typing, and seen states are updating in real time.',
    };
  }

  return {
    tone: 'info',
    label: 'Connecting',
    helper: 'Joining the ticket room and syncing current activity.',
  };
};

const getPriorityBadgeColor = (priority) => {
  if (priority === 'high' || priority === 'urgent') {
    return 'danger';
  }

  if (priority === 'medium') {
    return 'warning';
  }

  return 'info';
};

const getStatusBadgeColor = (status) => {
  if (status === 'resolved') {
    return 'success';
  }

  if (status === 'closed') {
    return 'secondary';
  }

  return 'info';
};

const getRealtimeIconClass = (tone) => {
  switch (tone) {
    case 'success':
      return 'tim-icons icon-check-2';
    case 'warning':
      return 'tim-icons icon-time-alarm';
    case 'danger':
      return 'tim-icons icon-alert-circle-exc';
    default:
      return 'tim-icons icon-world';
  }
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

export default function TicketChat() {
  const socket = useSocket();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState(null);
  const [isSomeoneTyping, setIsSomeoneTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingName, setTypingName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState('connecting');
  const [roomState, setRoomState] = useState('idle');

  const joinRoomTimeoutRef = useRef(null);
  const chatViewportRef = useRef(null);
  const composerInputRef = useRef(null);
  const runtimeRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const ticketRef = useRef(null);

  const currentUser = getUser();
  const currentUserEmail = currentUser?.emailAddress || '';
  const currentUserFullName = currentUser?.fullName || '';
  const navigate = useNavigate();

  const realtimeState = useMemo(
    () => resolveRealtimeState(connectionState, roomState),
    [connectionState, roomState]
  );

  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);

  const getTicketIdFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }, []);

  const threadMessages = useMemo(
    () => buildThreadMessages(messages, formatMessageFooter),
    [messages]
  );

  const updateTicketConversation = useCallback((updater) => {
    setTicket((prev) => {
      if (!prev?._id) return prev;
      return {
        ...prev,
        conversation: updater(prev.conversation || []),
      };
    });
  }, []);

  const emitMessagesSeen = useCallback((ticketData = null) => {
    const activeTicket = ticketData || ticketRef.current;
    if (!activeTicket?._id) return;

    const hasUnreadUserMessages = (activeTicket.conversation || []).some(
      (entry) => entry.fromType === 'user' && !entry.readByAgent
    );

    if (hasUnreadUserMessages) {
      emitTicketSocketEvent(socket, 'messagesSeen', { ticketId: activeTicket._id });
      setUnreadMarkerMessageId(null);
    }
  }, [socket]);

  const emitTypingState = useCallback(
    (draftText = '') => {
      if (!ticket?._id) return;

      emitTicketSocketEvent(socket, 'typing', {
        ticketId: ticket._id,
        isTyping: draftText.trim().length > 0,
        senderEmail: currentUserEmail,
        fullName: currentUserFullName || 'Support',
        ticketOwner: ticket.senderEmail,
      });
    },
    [
      currentUserEmail,
      currentUserFullName,
      socket,
      ticket?._id,
      ticket?.senderEmail,
    ]
  );

  const handleRuntimeSend = useCallback(
    async ({ text, createdAt }) => {
      if (!text || !ticket?._id) return;

      const optimisticMessage = {
        id: buildMessageId(createdAt, currentUserEmail, 'agent'),
        text,
        timestamp: createdAt,
        rawCreatedAt: createdAt,
        senderType: 'agent',
        senderName: SUPPORT_DISPLAY_NAME,
        senderEmail: currentUserEmail,
        direction: 'outgoing',
        deliveryState: 'sending',
        readByUser: false,
        failed: false,
      };

      setMessages((prev) => [...prev, optimisticMessage]);
      updateTicketConversation((conversation) => [
        ...conversation,
        toConversationEntry(optimisticMessage),
      ]);

      emitTicketSocketEvent(socket, 'typing', {
        ticketId: ticket._id,
        isTyping: false,
        senderEmail: currentUserEmail,
        fullName: SUPPORT_DISPLAY_NAME,
        ticketOwner: ticket.senderEmail,
      });

      try {
        const response = await axios.post(
          `/api/complains/${ticket._id}/reply`,
          { text, createdAt },
          {
            headers: {
              Authorization: `Bearer ${currentUser?.token || ''}`,
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
                  deliveryState: reply.readByUser ? 'seen' : 'sent',
                  readByUser: Boolean(reply.readByUser),
                  failed: false,
                }
              : message
          )
        );
        updateTicketConversation((conversation) =>
          conversation.map((entry) =>
            safeToIsoString(entry.createdAt, optimisticMessage.rawCreatedAt) ===
              optimisticMessage.rawCreatedAt &&
            (entry.fromEmail || '') === optimisticMessage.senderEmail
              ? {
                  ...entry,
                  readByAgent: true,
                  readByUser: Boolean(reply.readByUser),
                }
              : entry
          )
        );
      } catch (err) {
        console.error('Failed to send reply:', err);
        toast.error('Failed to send message');
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
      currentUserFullName,
      currentUser?.token,
      ticket,
      updateTicketConversation,
    ]
  );

  const runtime = useTicketThreadRuntime({
    messages: threadMessages,
    onSend: handleRuntimeSend,
    disabled: loading || !ticket?._id,
    composerRole: 'assistant',
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
    const ticketId = getTicketIdFromUrl();

    if (!ticketId) {
      setError('No ticket ID provided in URL (?id=...)');
      setLoading(false);
      return;
    }

    const fetchTicket = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await axios.get(`/api/complains/ticket/${ticketId}`, {
          headers: {
            Authorization: `Bearer ${currentUser.token}`,
            
          },
          timeout: networkTimeout,
        });

        const { success, ticket: loadedTicket } = response.data;

        if (success && loadedTicket) {
          const nextMessages = (loadedTicket.conversation || []).map((entry) =>
            mapConversationEntryToMessage(
              entry,
              avatarName(loadedTicket.senderName) || loadedTicket.senderEmail
            )
          );

          setTicket(loadedTicket);
          setMessages(nextMessages);
          setUnreadMarkerMessageId(
            getFirstUnreadIncomingMessageId(nextMessages)
          );
          emitMessagesSeen(loadedTicket);
        } else {
          setError(response.data.error || 'Ticket not found');
        }
      } catch (err) {
        setError(
          err.response?.data?.error || err.message || 'Failed to load ticket'
        );
        console.error('Fetch ticket error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [emitMessagesSeen, getTicketIdFromUrl, currentUser?.token]);

  useEffect(() => {
    const activeTicketId = ticket?._id;
    const customerName =
      avatarName(ticket?.senderName) || ticket?.senderEmail || 'Customer';

    if (!activeTicketId || !socket) return undefined;

    setConnectionState(socket.connected ? 'connected' : 'connecting');
    setRoomState('joining');

    const joinActiveRoom = () => {
      clearJoinRoomTimeout();
      setConnectionState('connected');
      setRoomState('joining');

      emitTicketSocketEvent(socket, 'join-admin-room', 'admin-dashboard');
      emitTicketSocketEvent(
        socket,
        'join-ticket-room',
        { ticketId: activeTicketId },
        (ack = {}) => {
          if (ack?.success) {
            markRoomJoined();
          }
        }
      );
      emitTicketSocketEvent(socket, 'presence:sync');
      emitMessagesSeen(ticketRef.current);

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
      setError('Your session expired. Please sign in again.');
      navigate('/signin', { replace: true });
    };

    const handleOnlineUsers = (data = {}) => {
      try {
        if (Array.isArray(data?.users) && data.users.length >= 0) {
          markRoomJoined();
        }
        setOnlineUsers(normalizePresenceEmails(data.users));
      } catch (error) {
        console.error('[Admin Ticket] Failed to process online users:', error);
      }
    };

    const handlePresenceSnapshot = (data = {}) => {
      try {
        markRoomJoined();
        setOnlineUsers(normalizePresenceEmails(data.users));
      } catch (error) {
        console.error('[Admin Ticket] Failed to process presence snapshot:', error);
      }
    };

    const handleNewMessage = (msg = {}) => {
      try {
        if (msg.ticketId !== activeTicketId) return;

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
          customerName
        );

        setMessages((prev) => upsertMessage(prev, mappedMessage));
        updateTicketConversation((conversation) => {
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

        if (mappedMessage.senderType === 'user') {
          const shouldAutoRead =
            shouldStickToBottomRef.current &&
            (typeof document === 'undefined' ||
              document.visibilityState === 'visible');

          if (!shouldAutoRead) {
            setUnreadMarkerMessageId((prev) => prev || mappedMessage.id);
          }

          if (shouldAutoRead) {
            emitTicketSocketEvent(socket, 'messagesSeen', { ticketId: activeTicketId });
          }
        }
      } catch (error) {
        console.error('[Admin Ticket] Failed to process incoming message:', error);
      }
    };

    const handleTyping = (data = {}) => {
      try {
        if (data.ticketId !== activeTicketId) return;
        if (data.senderType !== 'user') return;
        if (
          data.senderEmail &&
          currentUserEmail &&
          data.senderEmail === currentUserEmail
        ) {
          return;
        }
        markRoomJoined();
        setIsSomeoneTyping(Boolean(data.isTyping));
        setTypingName(data.isTyping ? data.fullName || 'Customer' : '');
      } catch (error) {
        console.error('[Admin Ticket] Failed to process typing state:', error);
      }
    };

    const handleMessagesRead = ({ ticketId, readBy } = {}) => {
      try {
        if (ticketId !== activeTicketId) return;

        markRoomJoined();

        if (readBy?.type === 'user') {
          setMessages((prev) => markMessagesReadByUser(prev));
          updateTicketConversation((conversation) =>
            conversation.map((entry) =>
              entry.fromType === 'agent'
                ? { ...entry, readByUser: true }
                : entry
            )
          );
        }

        if (readBy?.type === 'agent') {
          setMessages((prev) => markIncomingMessagesReadByAgent(prev));
          updateTicketConversation((conversation) =>
            conversation.map((entry) =>
              entry.fromType === 'user'
                ? { ...entry, readByAgent: true }
                : entry
            )
          );
          setUnreadMarkerMessageId(null);
        }
      } catch (error) {
        console.error('[Admin Ticket] Failed to process read receipt:', error);
      }
    };

    const handleTicketRoomJoined = (payload) => {
      if (payload?.ticketId !== activeTicketId) return;
      markRoomJoined();
    };

    const handleTicketRoomError = (payload) => {
      if (!payload?.ticketId || payload.ticketId !== activeTicketId) return;
      clearJoinRoomTimeout();
      setRoomState('error');
      toast.error(payload.message || 'Unable to join this ticket room.');
      navigate('/admin/complains', { replace: true });
    };

    joinActiveRoom();

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('auth_error', handleAuthError);
    socket.on('onlineUsers', handleOnlineUsers);
    socket.on('presence:snapshot', handlePresenceSnapshot);
    socket.on('ticket:message', handleNewMessage);
    socket.on('ticket:typing', handleTyping);
    socket.on('ticket:messages-read', handleMessagesRead);
    socket.on('ticket-room-joined', handleTicketRoomJoined);
    socket.on('ticket-room-error', handleTicketRoomError);

    return () => {
      clearJoinRoomTimeout();
      emitTicketSocketEvent(socket, 'leave-ticket-room', { ticketId: activeTicketId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('auth_error', handleAuthError);
      socket.off('onlineUsers', handleOnlineUsers);
      socket.off('presence:snapshot', handlePresenceSnapshot);
      socket.off('ticket:message', handleNewMessage);
      socket.off('ticket:typing', handleTyping);
      socket.off('ticket:messages-read', handleMessagesRead);
      socket.off('ticket-room-joined', handleTicketRoomJoined);
      socket.off('ticket-room-error', handleTicketRoomError);
    };
  }, [
    currentUser?.token,
    socket,
    clearJoinRoomTimeout,
    emitMessagesSeen,
    markRoomJoined,
    navigate,
    ticket?._id,
    ticket?.senderName,
    ticket?.senderEmail,
    updateTicketConversation,
  ]);

  useEffect(() => {
    if (!ticket?._id) return undefined;

    emitTypingState(safeGetComposerText(runtime));

    return () => {
      emitTypingState('');
    };
  }, [emitTypingState, runtime, ticket?._id]);

  useEffect(() => {
    if (!ticket?._id) return undefined;

    const viewport = chatViewportRef.current;
    if (!viewport) return undefined;

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom < 120;

      if (
        shouldStickToBottomRef.current &&
        messages.some(
          (message) => message.senderType === 'user' && !message.readByAgent
        )
      ) {
        emitMessagesSeen(ticketRef.current);
      }
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll);

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, [emitMessagesSeen, messages, ticket?._id]);

  useEffect(() => {
    if (!ticket?._id || !shouldStickToBottomRef.current) return;
    scrollChatToBottom(messages.length > 1 ? 'smooth' : 'auto');
  }, [messages.length, scrollChatToBottom, ticket?._id]);

  const customerOnline = onlineUsers.includes(
    (ticket?.senderEmail || '').toLowerCase()
  );
  const subjectIsCritical = isCriticalSupportSubject(ticket?.subject);

  if (loading) {
    return (
      <div className="content">
        <div className="text-center py-5">
          <Spinner color="primary" />
          <p className="mt-3 text-muted">Loading ticket...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="content">
        <div className="text-danger text-center p-5">Error: {error}</div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="content">
        <div className="text-center p-5">Ticket not found</div>
      </div>
    );
  }

  return (
    <div className="content admin-ticket-page">
      <Container fluid className="p-0">
        <Row className="g-0">
          <Col xs="12">
            <div className="support-ticket-shell admin-ticket-shell">
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
                        title={ticket.subject}
                      >
                        {ticket.subject || 'No subject'}
                      </span>
                      <span
                        className={`chat-status-pill chat-status-pill-${realtimeState.tone}`}
                      >
                        <i
                          className={getRealtimeIconClass(realtimeState.tone)}
                          aria-hidden="true"
                        />
                        {realtimeState.label}
                      </span>
                      <Badge
                        color={getPriorityBadgeColor(ticket.priority)}
                        className="support-chat-outline-badge"
                      >
                        {(ticket.priority || 'medium').toUpperCase()}
                      </Badge>
                      <Badge
                        color={getStatusBadgeColor(ticket.status)}
                        className="support-chat-outline-badge"
                      >
                        {(ticket.status || 'open').toUpperCase()}
                      </Badge>
                    </div>
                    <Button
                      color="secondary"
                      size="sm"
                      onClick={() => navigate('/admin/complains')}
                    >
                      Back to Complaints
                    </Button>
                  </div>
                  <div className="support-chat-meta-strip support-chat-meta-strip-admin">
                    <span className="support-chat-meta-pill">
                      <i
                        className="tim-icons icon-single-02"
                        aria-hidden="true"
                      />
                      {avatarName(ticket.senderName) || ticket.senderEmail}
                    </span>
                    <span className="support-chat-reference">
                      <i className="tim-icons icon-tag" aria-hidden="true" />
                      Ref: {ticket.ticket}
                    </span>
                    <span
                      className={`support-chat-presence-badge ${
                        customerOnline
                          ? 'support-chat-presence-badge-online'
                          : 'support-chat-presence-badge-offline'
                      }`}
                    >
                      <span
                        className="support-chat-presence-dot"
                        aria-hidden="true"
                      />
                      {customerOnline ? 'Online' : 'Offline'}
                    </span>
                    <span className="support-chat-meta-pill support-chat-meta-pill-compact">
                      <i
                        className="tim-icons icon-time-alarm"
                        aria-hidden="true"
                      />
                      {safeFormatDateTime(ticket.createdAt)}
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
                    emptyCopy="No messages yet. Start the conversation!"
                    composerPlaceholder="Type your reply here..."
                    assistantIsOutgoing
                    viewportRef={chatViewportRef}
                    composerRef={composerInputRef}
                    composerDisabled={loading || !ticket?._id}
                    onComposerTextChange={emitTypingState}
                  />
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
}
