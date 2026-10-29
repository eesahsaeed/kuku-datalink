import React, { useEffect, useState } from 'react';
import { Alert, Spinner } from 'components/ui/primitives';
import axios from 'axios';
import ComplainListElement from 'components/ComplainListElement/ComplainListElement';
import { getUser, networkTimeout } from '../../../lib/helper';

import { useSocket } from 'contexts/SocketContext.js';

function Complains() {
  const socket = useSocket();
  const [complains, setComplains] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingByTicket, setTypingByTicket] = useState({});
  const [realtimeState, setRealtimeState] = useState('connecting');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const currentUser = getUser();

  useEffect(() => {
    const upsertTicket = (items, ticketPayload, moveToTop = true) => {
      if (!ticketPayload?._id) return items;

      const nextTicket = {
        ...ticketPayload,
        conversation: ticketPayload.conversation || [],
      };
      const index = items.findIndex((item) => item._id === nextTicket._id);

      if (index === -1) {
        return moveToTop ? [nextTicket, ...items] : [...items, nextTicket];
      }

      const merged = {
        ...items[index],
        ...nextTicket,
        conversation:
          nextTicket.conversation || items[index].conversation || [],
      };

      const nextItems = [...items];
      nextItems.splice(index, 1);
      if (moveToTop) {
        nextItems.unshift(merged);
      } else {
        nextItems.splice(index, 0, merged);
      }
      return nextItems;
    };

    const fetchOpenComplains = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axios.get('/api/complains/open', {
          headers: {
            Authorization: `Bearer ${currentUser?.token}`,
          },
          params: { limit: 50 },
          timeout: networkTimeout,
        });

        setComplains(response.data.data || []);
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Network error');
        console.error('Fetch complains error:', err);
      } finally {
        setLoading(false);
      }
    };

    const handleOnlineUsers = (data) => {
      setOnlineUsers((data.users || []).map((email) => email.toLowerCase()));
    };

    const handlePresenceSnapshot = (data) => {
      setOnlineUsers((data.users || []).map((email) => email.toLowerCase()));
    };

    const handleTicketCreated = (ticket) => {
      setComplains((prev) => upsertTicket(prev, ticket, true));
    };

    const handleTicketUpdated = (ticket) => {
      setComplains((prev) => upsertTicket(prev, ticket, false));
    };

    const handleTicketMessage = (message) => {
      if (!message?.ticketId) return;

      setComplains((prev) => {
        const idx = prev.findIndex((item) => item._id === message.ticketId);
        if (idx === -1) return prev;

        const existing = prev[idx];
        const nextConversation = [...(existing.conversation || [])];
        const alreadyExists = nextConversation.some(
          (msg) =>
            msg.createdAt === message.createdAt &&
            msg.text === message.text &&
            (msg.fromEmail || '') === (message.fromEmail || '')
        );

        if (!alreadyExists) {
          nextConversation.push({
            fromName: message.fromName,
            fromEmail: message.fromEmail,
            fromType: message.fromType,
            text: message.text,
            createdAt: message.createdAt,
            readByAgent: message.fromType === 'agent',
            readByUser: message.fromType === 'user',
          });
        }

        const updated = {
          ...existing,
          conversation: nextConversation,
          updatedAt: message.createdAt,
        };

        const next = [...prev];
        next.splice(idx, 1);
        next.unshift(updated);
        return next;
      });
    };

    const handleTicketMessagesRead = ({ ticketId, readBy }) => {
      if (!ticketId || readBy?.type !== 'agent') return;

      setComplains((prev) =>
        prev.map((complain) => {
          if (complain._id !== ticketId) return complain;

          return {
            ...complain,
            conversation: (complain.conversation || []).map((entry) =>
              entry.fromType === 'user'
                ? { ...entry, readByAgent: true }
                : entry
            ),
          };
        })
      );
    };

    const handleUserTyping = (data) => {
      if (!data?.ticketId) return;

      const ticketId = String(data.ticketId);
      const shouldShowTyping =
        data.senderType === 'user' && Boolean(data.isTyping);

      setTypingByTicket((prev) => ({
        ...prev,
        [ticketId]: shouldShowTyping,
      }));
    };

    fetchOpenComplains();
    if (!socket || !currentUser?.token) {
      setRealtimeState('offline');
      return undefined;
    }
    const handleSocketConnect = () => {
      setRealtimeState('connected');
      socket.emit('join-admin-room', 'admin-dashboard');
      socket.emit('presence:sync');
    };

    const handleDisconnect = () => {
      setRealtimeState('offline');
    };

    const handleConnectError = () => {
      setRealtimeState('error');
    };

    const handleRoomJoined = ({ room }) => {
      if (room === 'admin-dashboard') {
        setRealtimeState('live');
      }
    };

    const handleRoomJoinError = ({ room, message }) => {
      if (room === 'admin-dashboard') {
        setRealtimeState('error');
        setError(message || 'Unable to join admin realtime room.');
      }
    };

    handleSocketConnect();
    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room-joined', handleRoomJoined);
    socket.on('room-join-error', handleRoomJoinError);
    socket.on('onlineUsers', handleOnlineUsers);
    socket.on('presence:snapshot', handlePresenceSnapshot);
    socket.on('ticket:created', handleTicketCreated);
    socket.on('ticket:updated', handleTicketUpdated);
    socket.on('ticket:message', handleTicketMessage);
    socket.on('ticket:messages-read', handleTicketMessagesRead);
    socket.on('ticket:typing', handleUserTyping);

    return () => {
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room-joined', handleRoomJoined);
      socket.off('room-join-error', handleRoomJoinError);
      socket.off('onlineUsers', handleOnlineUsers);
      socket.off('presence:snapshot', handlePresenceSnapshot);
      socket.off('ticket:created', handleTicketCreated);
      socket.off('ticket:updated', handleTicketUpdated);
      socket.off('ticket:message', handleTicketMessage);
      socket.off('ticket:messages-read', handleTicketMessagesRead);
      socket.off('ticket:typing', handleUserTyping);
    };
  }, [currentUser?.token, socket]);

  return (
    <div className="content admin-complains-page">
      {error && <Alert color="danger">{error}</Alert>}
      <div className="chat-list-header">
        <div>
          <h4 className="mb-1">Open Conversations</h4>
          <p className="text-muted mb-0">
            New tickets, replies, typing, and read states update here live.
          </p>
        </div>
        <span
          className={`chat-status-pill ${
            realtimeState === 'live'
              ? 'chat-status-pill-success'
              : realtimeState === 'offline'
              ? 'chat-status-pill-warning'
              : realtimeState === 'error'
              ? 'chat-status-pill-danger'
              : 'chat-status-pill-info'
          }`}
        >
          {realtimeState === 'live'
            ? 'Realtime live'
            : realtimeState === 'offline'
            ? 'Reconnecting'
            : realtimeState === 'error'
            ? 'Realtime issue'
            : 'Connecting'}
        </span>
      </div>
      {loading ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : (
        <div className="chat-list-shell">
          <div className="chat-list-collection kuku-scrollbar kuku-scrollbar-y">
            {complains.map((complain) => (
              <ComplainListElement
                key={complain._id}
                complain={complain}
                onlineUsers={onlineUsers}
                isTyping={Boolean(typingByTicket[complain._id])}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Complains;
