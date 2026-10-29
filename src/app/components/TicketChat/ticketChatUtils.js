import {
  format,
  isSameDay,
  isToday,
  isYesterday,
} from 'date-fns';

export const toSafeDate = (dateValue, fallbackValue = new Date()) => {
  try {
    const fallbackDate =
      fallbackValue instanceof Date
        ? new Date(fallbackValue.getTime())
        : new Date(fallbackValue || Date.now());
    const resolvedDate =
      dateValue instanceof Date ? new Date(dateValue.getTime()) : new Date(dateValue);

    if (Number.isFinite(resolvedDate.getTime())) {
      return resolvedDate;
    }

    if (Number.isFinite(fallbackDate.getTime())) {
      return fallbackDate;
    }
  } catch (_error) {
    // Fall through to the final fallback below.
  }

  return new Date();
};

export const toSafeIsoString = (dateValue, fallbackValue = new Date()) =>
  toSafeDate(dateValue, fallbackValue).toISOString();

export const buildMessageId = (
  createdAt,
  senderEmail,
  senderType = 'user'
) =>
  `${createdAt || 'draft'}-${String(
    senderEmail || senderType || 'unknown'
  ).toLowerCase()}`;

export const formatSeparatorDate = (dateValue) => {
  const resolvedDate = toSafeDate(dateValue);

  if (isToday(resolvedDate)) return 'Today';
  if (isYesterday(resolvedDate)) return 'Yesterday';
  return format(resolvedDate, 'EEEE, d MMM yyyy');
};

export const getDateSeparatorLabel = (messages = [], index = 0) => {
  const currentMessage = messages[index];
  if (!currentMessage?.createdAt) return null;

  const previousMessage = messages[index - 1];
  if (
    previousMessage?.createdAt &&
    isSameDay(
      toSafeDate(previousMessage.createdAt, currentMessage.createdAt),
      toSafeDate(currentMessage.createdAt)
    )
  ) {
    return null;
  }

  return formatSeparatorDate(currentMessage.createdAt);
};

export const extractTextFromAppendMessage = (appendMessage = {}) => {
  const { content } = appendMessage;

  if (typeof content === 'string') {
    return content.replace(/\u00a0/g, ' ').trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (
        part.type === 'text' ||
        part.type === 'reasoning' ||
        part.type === 'source'
      ) {
        return part.text || part.title || '';
      }

      if (part.type === 'data' && typeof part.data === 'string') {
        return part.data;
      }

      return '';
    })
    .join('\n')
    .replace(/\u00a0/g, ' ')
    .trim();
};

export const buildThreadMessages = (
  items = [],
  formatFooter = () => ''
) => {
  return items.map((item) => {
    const createdAt = toSafeDate(item?.timestamp);
    const baseMessage = {
      id: item.id,
      createdAt,
      content: [
        {
          type: 'text',
          text: item.text || '(no content)',
        },
      ],
      metadata: {
        custom: {
          senderName: item.senderName || '',
          senderEmail: item.senderEmail || '',
          senderType: item.senderType || 'user',
          deliveryState: item.deliveryState || 'sent',
          direction: item.direction || 'incoming',
          footer: formatFooter(item),
          failed: Boolean(item.failed),
        },
      },
    };

    if (item.senderType === 'agent') {
      return {
        ...baseMessage,
        role: 'assistant',
        status: {
          type: 'complete',
          reason: 'stop',
        },
      };
    }

    return {
      ...baseMessage,
      role: 'user',
      attachments: [],
    };
  });
};
