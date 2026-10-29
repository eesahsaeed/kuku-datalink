import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';

import { avatarName } from '../../../lib/helper';

export default function ComplainList({
  complain,
  onlineUsers,
  isTyping = false,
}) {
  const navigate = useNavigate();

  const entries = complain.conversation || [];
  const lastMessage = entries[entries.length - 1] || null;
  const unreadMessages = entries.filter(
    (conversation) => conversation.fromType === 'user' && !conversation.readByAgent
  ).length;

  const previewText = isTyping
    ? 'typing...'
    : lastMessage?.text?.trim() || lastMessage?.html?.trim() || 'No messages yet';

  const previewWeight = !isTyping && unreadMessages > 0 ? 600 : 500;
  const lastUpdatedAt =
    lastMessage?.createdAt || complain.updatedAt || complain.createdAt;
  const displayName = avatarName(complain.senderName) || 'Customer';
  const isOnline = onlineUsers.includes((complain.senderEmail || '').toLowerCase());

  function navigateToTicket() {
    navigate(`/admin/ticket?id=${complain._id}`);
  }

  return (
    <button type="button" className="chat-list-item" onClick={navigateToTicket}>
      <div className="chat-list-avatar-wrap">
        <img
          className="chat-list-avatar"
          src={`https://ui-avatars.com/api/?name=${displayName}&background=random`}
          alt={displayName}
        />
        <span
          className={`chat-list-avatar-status ${
            isOnline ? 'chat-list-avatar-status-online' : 'chat-list-avatar-status-offline'
          }`}
        />
      </div>

      <div className="chat-list-item-body">
        <div className="chat-list-item-head">
          <div className="chat-list-item-title-block">
            <strong className="chat-list-item-title">
              {complain.subject || `Ticket ${complain.ticket || ''}`.trim()}
            </strong>
            <span className="chat-list-item-subtitle">{displayName}</span>
          </div>
          <div className="chat-list-item-meta">
            <span className="chat-list-item-time">
              {lastUpdatedAt
                ? formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })
                : ''}
            </span>
            {unreadMessages > 0 ? (
              <span className="chat-list-item-unread">{unreadMessages}</span>
            ) : null}
          </div>
        </div>

        <div
          className={isTyping ? 'chat-list-typing' : 'chat-list-preview'}
          style={{ fontWeight: previewWeight }}
        >
          {previewText}
        </div>
      </div>
    </button>
  );
}
