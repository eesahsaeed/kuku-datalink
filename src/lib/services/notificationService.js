const { Expo } = require('expo-server-sdk');

const Notification = require('../schema/NotificationSchema');
const User = require('../schema/UserSchema');
const { buildClientNavigationTarget } = require('../helper.js');

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
const EXPO_RECEIPT_CHECK_DELAY_MS = 4000;

function waitFor(delayMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    if (typeof timer?.unref === 'function') {
      timer.unref();
    }
  });
}

function normalizeEmail(emailAddress) {
  return typeof emailAddress === 'string'
    ? emailAddress.toLowerCase().trim()
    : '';
}

function logNotificationServiceError(label, context = {}, error) {
  console.error(`[notificationService] ${label}`, {
    ...context,
    message: error?.message || String(error),
    response: error?.response?.data || null,
  });
}

function isExpoPushToken(token) {
  return typeof token === 'string' && Expo.isExpoPushToken(token.trim());
}

function maskExpoPushToken(token = '') {
  const normalized = String(token || '').trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 10)}...${normalized.slice(-5)}`;
}

async function dispatchPushNotifications(tokens, payload, options = {}) {
  // console.log('[expo-push] Dispatching push notifications', {
  //   tokens: (tokens || []).map(maskExpoPushToken),
  //   payload: {
  //     title: payload?.title || null,
  //     message: payload?.message || null,
  //     data: payload?.data || null,
  //   },
  //   options,
  // });
  const { awaitReceipts = false } = options || {};
  const validTokens = [...new Set((tokens || []).filter(isExpoPushToken))];
  if (!validTokens.length) {
    return {
      attempted: 0,
      accepted: 0,
      receiptIds: [],
      ticketErrors: [],
      receiptErrors: [],
    };
  }

  const messages = validTokens.map((token) => ({
    to: token,
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    title: payload.title,
    body: payload.message,
    data: payload.data || {},
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
    }

    const ticketErrors = tickets
      .map((ticket, index) => ({
        index,
        token: maskExpoPushToken(validTokens[index]),
        status: ticket?.status || null,
        message: ticket?.message || null,
        details: ticket?.details || null,
      }))
      .filter((entry) => entry.status && entry.status !== 'ok');
    const receiptTokenById = new Map();
    const receiptIds = [];
    tickets.forEach((ticket, index) => {
      const receiptId = String(ticket?.id || '').trim();
      if (ticket?.status !== 'ok' || !receiptId) return;
      receiptIds.push(receiptId);
      receiptTokenById.set(receiptId, validTokens[index]);
    });

    console.log('[expo-push] Dispatch response', {
      attempted: validTokens.length,
      accepted: receiptIds.length,
      ticketErrors,
    });

    if (receiptIds.length) {
      if (awaitReceipts) {
        await waitFor(EXPO_RECEIPT_CHECK_DELAY_MS);
        const receipts = await fetchExpoPushReceipts(
          receiptIds,
          receiptTokenById
        );
        const receiptErrors = receipts.filter(
          (entry) => entry?.status && entry.status !== 'ok'
        );

        console.log('[expo-push] Receipt audit', {
          checked: receipts.length,
          receiptErrors,
        });

        return {
          attempted: validTokens.length,
          accepted: receiptIds.length,
          receiptIds,
          ticketErrors,
          receiptErrors,
        };
      }

      scheduleExpoPushReceiptAudit(receiptIds, receiptTokenById);
    }

    return {
      attempted: validTokens.length,
      accepted: receiptIds.length,
      receiptIds,
      ticketErrors,
      receiptErrors: [],
    };
  } catch (error) {
    console.error(
      'Failed to dispatch Expo push notification:',
      error.message || error
    );
    return {
      attempted: validTokens.length,
      accepted: 0,
      receiptIds: [],
      ticketErrors: [
        {
          status: 'error',
          message: error.response?.data || error.message,
        },
      ],
      receiptErrors: [],
    };
  }
}

async function fetchExpoPushReceipts(receiptIds = [], receiptTokenById = new Map()) {
  if (!receiptIds.length) return [];

  const receipts = [];
  const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);

  for (const chunk of chunks) {
    const receiptMap = await expo.getPushNotificationReceiptsAsync(chunk);
    receipts.push(
      ...chunk.map((receiptId) => ({
        receiptId,
        token: maskExpoPushToken(receiptTokenById.get(receiptId)),
        ...(receiptMap?.[receiptId] || {}),
      }))
    );
  }

  return receipts;
}

function scheduleExpoPushReceiptAudit(receiptIds = [], receiptTokenById = new Map()) {
  if (!receiptIds.length) return;

  const timer = setTimeout(async () => {
    try {
      const receipts = await fetchExpoPushReceipts(receiptIds, receiptTokenById);
      const receiptErrors = receipts.filter(
        (entry) => entry?.status && entry.status !== 'ok'
      );

      console.log('[expo-push] Receipt audit', {
        checked: receipts.length,
        receiptErrors,
      });
    } catch (error) {
      console.error(
        '[expo-push] Failed to fetch receipt audit:',
        error.response?.data || error.message
      );
    }
  }, EXPO_RECEIPT_CHECK_DELAY_MS);

  if (typeof timer?.unref === 'function') {
    timer.unref();
  }
}

function resolveRealtimeIo(source) {
  if (source?.app?.get) {
    return source.app.get('io');
  }

  if (source?.to && source?.emit) {
    return source;
  }

  return null;
}

async function emitRealtimeNotification(source, notification, emailAddress) {
  try {
    const io = resolveRealtimeIo(source);
    if (!io) return;

    const normalizedEmail = normalizeEmail(emailAddress);
    const navigationTarget = buildClientNavigationTarget(
      notification.actionUrl,
      notification.meta || {}
    );
    const payload = {
      _id: notification._id.toString(),
      title: notification.title,
      message: notification.message,
      actionUrl: navigationTarget.actionUrl,
      actionPath: navigationTarget.actionPath,
      webActionUrl: navigationTarget.webActionUrl,
      mobileActionUrl: navigationTarget.mobileActionUrl,
      category: notification.category,
      priority: notification.priority,
      createdAt: notification.createdAt,
      isRead: notification.isRead,
      meta: notification.meta || {},
    };

    if (normalizedEmail) {
      io.to(normalizedEmail).emit('notification:new', payload);
    }

    if (notification.user) {
      io.to(`user:${notification.user.toString()}`).emit(
        'notification:new',
        payload
      );
    }
  } catch (error) {
    logNotificationServiceError(
      'realtime emit failed',
      {
        notificationId: notification?._id?.toString?.() || null,
        emailAddress: normalizeEmail(emailAddress),
      },
      error
    );
  }
}

async function createUserNotification(
  req,
  {
    userId,
    emailAddress,
    category = 'info',
    title,
    message,
    actionUrl = null,
    priority = 'normal',
    meta = {},
    groupKey = null,
  }
) {
  if (!userId || !title || !message) return null;

  try {
    const user = await User.findById(userId)
      .select('_id emailAddress mobilePushTokens')
      .lean();

    if (!user?._id) return null;

    const notification = await Notification.create({
      user: user._id,
      category,
      title,
      message,
      actionUrl,
      priority,
      meta,
      groupKey:
        typeof groupKey === 'string' && groupKey.trim()
          ? groupKey.trim()
          : null,
    });
    const navigationTarget = buildClientNavigationTarget(actionUrl, meta);

    await emitRealtimeNotification(
      req,
      notification,
      emailAddress || user.emailAddress
    );
    await dispatchPushNotifications(
      (user.mobilePushTokens || []).map((entry) => entry.token),
      {
        title,
        message,
        data: {
          notificationId: notification._id.toString(),
          actionUrl: navigationTarget.actionUrl,
          actionPath: navigationTarget.actionPath,
          webActionUrl: navigationTarget.webActionUrl,
          mobileActionUrl: navigationTarget.mobileActionUrl,
          category,
          ...meta,
        },
      }
    );

    return notification;
  } catch (error) {
    logNotificationServiceError(
      'create notification failed',
      {
        userId: String(userId || ''),
        emailAddress: normalizeEmail(emailAddress),
        category,
        title,
      },
      error
    );
    return null;
  }
}

module.exports = {
  createUserNotification,
  dispatchPushNotifications,
  isExpoPushToken,
  normalizeEmail,
};
