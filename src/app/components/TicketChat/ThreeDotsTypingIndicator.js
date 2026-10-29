import React from 'react';

const ThreeDotsTypingIndicator = ({ label = 'Typing' }) => (
  <div
    className="aui-ticket-typing-indicator"
    role="status"
    aria-live="polite"
    aria-label={label}
    title={label}
  >
    <div
      className="aui-ticket-typing-indicator-dots"
      aria-hidden="true"
    >
      <span className="aui-ticket-typing-indicator-dot" />
      <span className="aui-ticket-typing-indicator-dot" />
      <span className="aui-ticket-typing-indicator-dot" />
    </div>
  </div>
);

export default ThreeDotsTypingIndicator;
