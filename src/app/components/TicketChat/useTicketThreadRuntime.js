import { useCallback, useEffect, useMemo } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';

import { extractTextFromAppendMessage, toSafeIsoString } from './ticketChatUtils';

const useTicketThreadRuntime = ({
  messages = [],
  onSend,
  disabled = false,
  composerRole = 'user',
}) => {
  const handleNewMessage = useCallback(
    async (appendMessage) => {
      try {
        const text = extractTextFromAppendMessage(appendMessage);
        if (!text) return;

        const createdAt =
          appendMessage?.createdAt instanceof Date
            ? appendMessage.createdAt.toISOString()
            : appendMessage?.createdAt
            ? toSafeIsoString(appendMessage.createdAt)
            : new Date().toISOString();

        await onSend?.({
          text,
          createdAt,
          appendMessage,
        });
      } catch (error) {
        console.error(
          '[TicketThreadRuntime] Failed to handle outgoing message:',
          error
        );
      }
    },
    [onSend]
  );

  const store = useMemo(
    () => ({
      isDisabled: disabled,
      messages,
      onNew: handleNewMessage,
    }),
    [disabled, messages, handleNewMessage]
  );

  const runtime = useExternalStoreRuntime(store);

  useEffect(() => {
    try {
      runtime.thread.composer.setRole(composerRole);
    } catch (error) {
      console.error(
        '[TicketThreadRuntime] Failed to set composer role:',
        error
      );
    }
  }, [composerRole, runtime]);

  return runtime;
};

export default useTicketThreadRuntime;
