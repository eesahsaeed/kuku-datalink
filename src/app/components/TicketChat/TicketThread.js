import React from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';

import { getDateSeparatorLabel } from './ticketChatUtils';
import ThreeDotsTypingIndicator from './ThreeDotsTypingIndicator';

const TicketThread = ({
  runtime,
  threadMessages = [],
  unreadMarkerMessageId = null,
  typingText = '',
  emptyCopy = 'No messages yet.',
  composerPlaceholder = 'Write a message...',
  composerHelper = 'Press Enter to send. Use Shift + Enter for a new line.',
  assistantIsOutgoing = false,
  viewportRef,
  composerRef,
  composerDisabled = false,
  onComposerTextChange,
}) => {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="aui-ticket-thread">
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          className="aui-ticket-thread-viewport kuku-scrollbar kuku-scrollbar-y"
          autoScroll
          scrollToBottomOnInitialize
          scrollToBottomOnThreadSwitch
        >
          {threadMessages.length > 0 ? (
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const separatorLabel = getDateSeparatorLabel(
                  threadMessages,
                  message.index
                );
                const metadata = message.metadata?.custom || {};
                const isOutgoing = assistantIsOutgoing
                  ? message.role === 'assistant'
                  : message.role === 'user';

                return (
                  <React.Fragment key={message.id}>
                    {separatorLabel ? (
                      <div className="aui-ticket-separator">
                        <span>{separatorLabel}</span>
                      </div>
                    ) : null}

                    {unreadMarkerMessageId === message.id ? (
                      <div className="aui-ticket-separator aui-ticket-separator-unread">
                        <span>New messages</span>
                      </div>
                    ) : null}

                    <MessagePrimitive.Root
                      className={`aui-ticket-message ${
                        isOutgoing
                          ? 'aui-ticket-message-outgoing'
                          : 'aui-ticket-message-incoming'
                      }${metadata.failed ? ' aui-ticket-message-failed' : ''}`}
                    >
                      <div className="aui-ticket-message-card">
                        <div className="aui-ticket-message-sender">
                          {metadata.senderName ||
                            (message.role === 'assistant'
                              ? 'Support'
                              : 'Customer')}
                        </div>
                        <div className="aui-ticket-message-bubble">
                          <MessagePrimitive.Parts />
                        </div>
                        {metadata.footer ? (
                          <div className="aui-ticket-message-footer">
                            {metadata.footer}
                          </div>
                        ) : null}
                      </div>
                    </MessagePrimitive.Root>
                  </React.Fragment>
                );
              }}
            </ThreadPrimitive.Messages>
          ) : (
            <div className="aui-ticket-empty-state">{emptyCopy}</div>
          )}

          <ThreadPrimitive.ViewportFooter className="aui-ticket-composer-region">
            <div className="chat-composer-shell aui-ticket-composer-shell">
              {typingText ? (
                <ThreeDotsTypingIndicator label={typingText} />
              ) : null}

              <div className="chat-composer-helper">{composerHelper}</div>

              <ComposerPrimitive.Root className="aui-ticket-composer">
                <ComposerPrimitive.Input
                  ref={composerRef}
                  className="aui-ticket-composer-input kuku-scrollbar kuku-scrollbar-y"
                  placeholder={composerPlaceholder}
                  minRows={1}
                  maxRows={6}
                  submitMode="enter"
                  disabled={composerDisabled}
                  onChange={(event) => {
                    try {
                      onComposerTextChange?.(event?.currentTarget?.value || '');
                    } catch (error) {
                      console.error(
                        '[TicketThread] Composer change handler failed:',
                        error
                      );
                    }
                  }}
                />
                <ComposerPrimitive.Send
                  className="aui-ticket-composer-send"
                  aria-label="Send message"
                >
                  <i className="tim-icons icon-send" />
                  <span>Send</span>
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};

export default TicketThread;
