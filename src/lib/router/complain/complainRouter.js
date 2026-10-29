const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Complain = require('../../schema/ComplainSchema');
const ContactRequest = require('../../schema/ContactRequestSchema');
const SupportEmailDigest = require('../../schema/SupportEmailDigestSchema');
const User = require('../../schema/UserSchema');
const {
  createUserNotification,
} = require('../../services/notificationService.js');

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const {
  support,
  noreply,
  getFrontendUrl,
  getBackendUrl,
} = require('../../helper.js');
const {
  sendNoReplyMail,
  sendSupportMail,
} = require('../../services/mailService');
const { authMiddleware } = require('../../middleware/index.js');
const {
  hasAdminDashboardAccess,
} = require('../../utils/roles');

const CONTACT_SERVICE_LABELS = {
  general: 'General Enquiry',
  website: 'Website Development',
  mobile: 'Mobile App Development',
  desktop: 'Desktop App Development',
  mac: 'Mac App Development',
};
const SUPPORT_DISPLAY_NAME = 'Kuku Data Support';
const SUPPORT_SENDER_NAME = 'kuku data support';
const SUPPORT_DIGEST_DELAY_MS = 5 * 60 * 1000;
const MAILBOX_READ_NAME = 'Mailbox open';
const SUPPORT_TRACKING_DEBUG_VISIBLE = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.SUPPORT_TRACKING_DEBUG || '')
    .trim()
    .toLowerCase()
);
const TRACKING_PIXEL_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64'
);
const isAgentRole = (user = {}) => hasAdminDashboardAccess(user);
const normalizeEmail = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase();
const buildTicketNotificationGroupKey = (ticketId) =>
  ticketId ? `ticket:${ticketId}` : null;
const buildContactRequestNotificationGroupKey = (requestId) =>
  requestId ? `contact-request:${requestId}` : null;
const SUPPORT_REQUEST_SUCCESS_MESSAGE =
  'Your message has been received successfully. We will get back to you soon.';
const CONTACT_REQUEST_SUCCESS_MESSAGE =
  'Your request has been received successfully. We will get back to you soon.';
const SUPPORT_INITIAL_AUTO_REPLY_TEXT =
  'Thank you for contacting Kuku Data Support. We have received your message and our team is reviewing it now. You can reply here again anytime if you want to add more details.';
const generateHexToken = (byteLength = 32) => {
  const tokenSource = `${uuidv4().replace(/-/g, '')}${uuidv4()
    .replace(/-/g, '')}`;

  return tokenSource.slice(0, byteLength * 2);
};

const runBestEffortSupportTask = (label, task, meta = {}) =>
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`[complainRouter] ${label} failed (best effort):`, {
        ...meta,
        message: error?.message || String(error),
      });
    });

async function notifyAgentsOfTicketActivity(
  source,
  ticketDoc,
  { title, message, priority = 'normal', replyPreview = '' } = {}
) {
  if (!ticketDoc?._id || !title || !message) return;

  try {
    const agents = await User.find({
      $or: [{ roles: 'admin' }, { adminDashboardAccess: true }],
      blocked: { $ne: true },
    })
      .select('_id emailAddress')
      .lean();

    if (!agents.length) return;

    const groupKey = buildTicketNotificationGroupKey(ticketDoc._id);
    const meta = {
      adminInboxType: 'complain',
      ticketId: ticketDoc._id.toString(),
      ticket: ticketDoc.ticket,
      senderEmail: ticketDoc.senderEmail,
      senderName: ticketDoc.senderName,
      subject: ticketDoc.subject,
      replyPreview,
    };

    await Promise.allSettled(
      agents.map((agent) =>
        createUserNotification(source, {
          userId: agent._id,
          emailAddress: agent.emailAddress,
          category: 'system',
          title,
          message,
          actionUrl: `/admin/ticket?id=${ticketDoc._id}`,
          priority,
          groupKey,
          meta,
        })
      )
    );
  } catch (error) {
    console.error('[complainRouter] Failed to notify agents of ticket activity:', {
      ticketId: String(ticketDoc?._id || ''),
      title,
      message: error?.message || String(error),
    });
  }
}

async function notifyAgentsOfContactRequest(source, contactRequest) {
  if (!contactRequest?._id) return;

  try {
    const agents = await User.find({
      $or: [{ roles: 'admin' }, { adminDashboardAccess: true }],
      blocked: { $ne: true },
    })
      .select('_id emailAddress')
      .lean();

    if (!agents.length) return;

    const serviceLabel =
      CONTACT_SERVICE_LABELS[contactRequest.service] || 'Contact Request';
    const groupKey = buildContactRequestNotificationGroupKey(contactRequest._id);
    const meta = {
      adminInboxType: 'contact_request',
      contactRequestId: contactRequest._id.toString(),
      reference: contactRequest.reference,
      service: contactRequest.service,
      serviceLabel,
      requesterName: contactRequest.fullName,
      requesterEmail: contactRequest.emailAddress,
      source: contactRequest.source,
    };

    await Promise.allSettled(
      agents.map((agent) =>
        createUserNotification(source, {
          userId: agent._id,
          emailAddress: agent.emailAddress,
          category: 'system',
          title: 'New contact request',
          message: `${
            contactRequest.fullName || 'A visitor'
          } requested ${serviceLabel.toLowerCase()}.`,
          actionUrl: null,
          priority: 'high',
          groupKey,
          meta,
        })
      )
    );
  } catch (error) {
    console.error('[complainRouter] Failed to notify agents of contact request:', {
      contactRequestId: String(contactRequest?._id || ''),
      message: error?.message || String(error),
    });
  }
}

const serializeConversationEntry = (entry = {}, index = 0) => ({
  ...entry,
  _id: entry?._id ? entry._id.toString() : `conversation-${index}`,
  text: sanitizeSupportConversationText(entry?.text || ''),
  createdAt: entry?.createdAt ? new Date(entry.createdAt).toISOString() : null,
  readAtUser: entry?.readAtUser
    ? new Date(entry.readAtUser).toISOString()
    : null,
  readAtAgent: entry?.readAtAgent
    ? new Date(entry.readAtAgent).toISOString()
    : null,
});

const serializeTicket = (ticketDoc) => {
  if (!ticketDoc) return null;

  const ticket = ticketDoc.toObject ? ticketDoc.toObject() : ticketDoc;
  return {
    ...ticket,
    _id: ticket._id?.toString ? ticket._id.toString() : ticket._id,
    createdAt: ticket.createdAt
      ? new Date(ticket.createdAt).toISOString()
      : null,
    updatedAt: ticket.updatedAt
      ? new Date(ticket.updatedAt).toISOString()
      : null,
    conversation: (ticket.conversation || []).map(serializeConversationEntry),
  };
};

const buildTicketMessagePayload = (ticketDoc, replyEntry) => {
  const ticket = serializeTicket(ticketDoc);
  const createdAt = replyEntry?.createdAt
    ? new Date(replyEntry.createdAt).toISOString()
    : new Date().toISOString();

  return {
    ticketId: ticket?._id || '',
    ticket: ticket?.ticket || '',
    subject: ticket?.subject || '',
    status: ticket?.status || 'open',
    priority: ticket?.priority || 'medium',
    senderName: ticket?.senderName || '',
    senderEmail: ticket?.senderEmail || '',
    text: sanitizeSupportConversationText(replyEntry?.text || ''),
    createdAt,
    fromType: replyEntry?.fromType || 'user',
    fromName: replyEntry?.fromName || '',
    fromEmail: replyEntry?.fromEmail || '',
    readByUser: Boolean(replyEntry?.readByUser),
    readByAgent: Boolean(replyEntry?.readByAgent),
  };
};

const getUserUnreadReplyCount = (ticketDoc) => {
  const ticket = ticketDoc?.toObject ? ticketDoc.toObject() : ticketDoc;
  return (ticket?.conversation || []).reduce((count, entry) => {
    if (entry?.fromType === 'agent' && !entry?.readByUser) {
      return count + 1;
    }
    return count;
  }, 0);
};

const buildSupportDigestToken = () => generateHexToken(24);

const getTokenPreview = (token = '') => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return '<empty>';
  if (normalizedToken.length <= 12) return normalizedToken;
  return `${normalizedToken.slice(0, 6)}...${normalizedToken.slice(-6)}`;
};

const resolveSupportTrackingBaseUrl = () => {
  const configuredTrackingBaseUrl = String(
    process.env.SUPPORT_TRACKING_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (configuredTrackingBaseUrl) {
    return {
      baseUrl: configuredTrackingBaseUrl,
      source: 'SUPPORT_TRACKING_BASE_URL',
    };
  }

  return {
    baseUrl: getBackendUrl(),
    source: 'getBackendUrl',
  };
};

const buildEmailTrackingUrl = (token) => {
  const { baseUrl: trackingBaseUrl, source } = resolveSupportTrackingBaseUrl();
  const trackingUrl = `${trackingBaseUrl}/api/complains/email/open/${encodeURIComponent(
    token
  )}/pixel.gif`;

  console.log('[Support Digest] Built tracking URL', {
    trackingBaseUrl,
    source,
    tokenPreview: getTokenPreview(token),
    trackingUrl,
  });

  return trackingUrl;
};

const buildEmailOpenTicketUrl = (token, ticketId = '') => {
  const { baseUrl: trackingBaseUrl } = resolveSupportTrackingBaseUrl();
  const normalizedTicketId = String(ticketId || '').trim();
  const query = normalizedTicketId
    ? `?ticketId=${encodeURIComponent(normalizedTicketId)}`
    : '';

  return `${trackingBaseUrl}/api/complains/email/open/${encodeURIComponent(
    token
  )}/ticket${query}`;
};

const buildFrontendSupportUrl = (ticketId = '') => {
  const normalizedTicketId = String(ticketId || '').trim();
  const frontendUrl = getFrontendUrl();

  if (!normalizedTicketId) {
    return `${frontendUrl}/support`;
  }

  return `${frontendUrl}/support?ticketId=${encodeURIComponent(
    normalizedTicketId
  )}`;
};

const buildFrontendSupportOpenTokenUrl = (token, ticketId = '') => {
  const supportUrl = buildFrontendSupportUrl(ticketId);
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    return supportUrl;
  }

  const joiner = supportUrl.includes('?') ? '&' : '?';
  return `${supportUrl}${joiner}openToken=${encodeURIComponent(
    normalizedToken
  )}`;
};
const TRACKING_PIXEL_PATH_PATTERN =
  /\/api\/complains\/email\/open\/([^/?#"'<>]+)\/pixel\.gif/i;
const TRACKING_PIXEL_IMG_TAG_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*\/?>/gi;

const extractTrackingTokenFromUrl = (value = '') => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return '';

  const match = normalizedValue.match(TRACKING_PIXEL_PATH_PATTERN);
  if (!match?.[1]) return '';

  try {
    return decodeURIComponent(match[1]).trim();
  } catch (_error) {
    return String(match[1] || '').trim();
  }
};

const extractTrackingTokenFromContent = (value = '') => {
  const normalizedValue = String(value || '');
  if (!normalizedValue) return '';

  TRACKING_PIXEL_IMG_TAG_PATTERN.lastIndex = 0;
  let matchedTag = TRACKING_PIXEL_IMG_TAG_PATTERN.exec(normalizedValue);
  while (matchedTag) {
    const token = extractTrackingTokenFromUrl(matchedTag[2]);
    if (token) {
      TRACKING_PIXEL_IMG_TAG_PATTERN.lastIndex = 0;
      return token;
    }
    matchedTag = TRACKING_PIXEL_IMG_TAG_PATTERN.exec(normalizedValue);
  }
  TRACKING_PIXEL_IMG_TAG_PATTERN.lastIndex = 0;

  return extractTrackingTokenFromUrl(normalizedValue);
};

const buildMailboxReadPayload = (ticketId, viewerName = MAILBOX_READ_NAME) => ({
  ticketId: String(ticketId),
  readBy: {
    id: 'mailbox-open',
    name: viewerName,
    type: 'user',
  },
  timestamp: new Date().toISOString(),
});

let client = null;
let isConnected = false;
let isStartingListener = false;
let isProcessingUnseenEmails = false;
let shouldReprocessUnseenEmails = false;
let reconnectTimer = null;
let isImapShuttingDown = false;
let ticketIo = null;

const IMAP_RECONNECT_DELAY_MS = 5000;
const IMAP_MAILBOX = 'INBOX';

const getImapConfig = () => {
  const host = String(process.env.SUPPORT_IMAP_HOST || '').trim();
  const port = Number(process.env.SUPPORT_IMAP_PORT || 993);
  const secureSetting = String(process.env.SUPPORT_IMAP_SECURE || 'true')
    .trim()
    .toLowerCase();

  if (!host || !support.email || !support.password || !Number.isInteger(port)) {
    return null;
  }

  return {
    host,
    port,
    secure: !['0', 'false', 'no', 'off'].includes(secureSetting),
  };
};

const resolveIo = (source) => {
  if (source?.app?.get) {
    return source.app.get('io');
  }

  if (source?.to && source?.emit) {
    return source;
  }

  return ticketIo;
};

const resolveExcludedSocketId = (source) => {
  const socketId =
    source?.get?.('x-socket-id') ||
    source?.headers?.['x-socket-id'] ||
    source?.headers?.['X-Socket-Id'] ||
    '';

  return String(socketId || '').trim();
};

const emitToRoom = (
  io,
  roomName,
  eventName,
  payload,
  excludedSocketId = ''
) => {
  if (!io || !roomName || !eventName) return;

  try {
    const emitter = excludedSocketId ? io.except(excludedSocketId) : io;
    emitter.to(roomName).emit(eventName, payload);
  } catch (error) {
    console.error('[complainRouter] Failed to emit support realtime event:', {
      roomName,
      eventName,
      message: error?.message || String(error),
    });
  }
};

const setTicketIo = (io) => {
  ticketIo = io || null;
};

const logImapTaskError = (label, error) => {
  if (!error) {
    console.error(`[IMAP] ${label} failed with an unknown error`);
    return;
  }

  console.error(
    `[IMAP] ${label} failed:`,
    error?.stack || error?.message || error
  );
};

const runImapTaskSafely = (label, task) => {
  void Promise.resolve()
    .then(task)
    .catch((error) => {
      logImapTaskError(label, error);
    });
};

const clearReconnectTimer = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const scheduleReconnect = (reason = 'unknown') => {
  if (isImapShuttingDown || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log(`[IMAP] Reconnecting after ${reason}...`);
    runImapTaskSafely(`Reconnect after ${reason}`, () =>
      startListeningUnseenEmails()
    );
  }, IMAP_RECONNECT_DELAY_MS);
};

const cleanupImapClient = async () => {
  if (!client) return;

  const activeClient = client;
  client = null;
  isConnected = false;

  try {
    activeClient.removeAllListeners();
  } catch (_error) {
    // no-op
  }

  try {
    await activeClient.logout();
  } catch (_error) {
    try {
      await Promise.resolve(activeClient.close?.());
    } catch (_closeError) {
      // no-op
    }
  }
};

const emitTicketCreated = (source, ticketDoc) => {
  try {
    const io = resolveIo(source);
    if (!io) return;

    const serializedTicket = serializeTicket(ticketDoc);
    if (!serializedTicket?._id) return;

    io.to('admin-dashboard').emit('ticket:created', serializedTicket);
  } catch (error) {
    console.error('[complainRouter] Failed to emit ticket created event:', {
      ticketId: String(ticketDoc?._id || ''),
      message: error?.message || String(error),
    });
  }
};

const emitTicketReply = (source, ticketDoc, replyEntry) => {
  try {
    const io = resolveIo(source);
    if (!io) return;

    const serializedTicket = serializeTicket(ticketDoc);
    const payload = buildTicketMessagePayload(ticketDoc, replyEntry);
    const excludedSocketId = resolveExcludedSocketId(source);
    const customerRoom = normalizeEmail(serializedTicket?.senderEmail || '');

    emitToRoom(
      io,
      `ticket:${serializedTicket._id}`,
      'ticket:message',
      payload,
      excludedSocketId
    );
    emitToRoom(
      io,
      'admin-dashboard',
      'ticket:message',
      payload,
      excludedSocketId
    );
    emitToRoom(
      io,
      'admin-dashboard',
      'ticket:updated',
      serializedTicket,
      excludedSocketId
    );
    if (customerRoom) {
      console.log('[Support Realtime] Emitting ticket update to customer room', {
        ticketId: String(serializedTicket._id || ''),
        customerRoom,
        event: 'ticket:message',
      });
      emitToRoom(
        io,
        customerRoom,
        'ticket:message',
        payload,
        excludedSocketId
      );
      emitToRoom(
        io,
        customerRoom,
        'ticket:updated',
        serializedTicket,
        excludedSocketId
      );
    }
  } catch (error) {
    console.error('[complainRouter] Failed to emit ticket reply event:', {
      ticketId: String(ticketDoc?._id || ''),
      message: error?.message || String(error),
    });
  }
};

const emitTicketMessagesReadByUser = (
  source,
  ticketId,
  viewerName = MAILBOX_READ_NAME,
  recipientEmail = ''
) => {
  try {
    const io = resolveIo(source);
    if (!io || !ticketId) return;

    const payload = buildMailboxReadPayload(ticketId, viewerName);
    const customerRoom = normalizeEmail(recipientEmail);
    emitToRoom(io, `ticket:${ticketId}`, 'ticket:messages-read', payload);
    emitToRoom(io, 'admin-dashboard', 'ticket:messages-read', payload);
    if (customerRoom) {
      console.log('[Support Realtime] Emitting read update to customer room', {
        ticketId: String(ticketId),
        customerRoom,
        event: 'ticket:messages-read',
      });
      emitToRoom(io, customerRoom, 'ticket:messages-read', payload);
    }
  } catch (error) {
    console.error('[complainRouter] Failed to emit ticket read event:', {
      ticketId: String(ticketId || ''),
      message: error?.message || String(error),
    });
  }
};

const createImapClient = () => {
  const imapConfig = getImapConfig();
  if (!imapConfig) {
    throw new Error(
      'Support IMAP is not configured. Set SUPPORT_IMAP_HOST, SUPPORT_EMAIL, and SUPPORT_PASSWORD.'
    );
  }

  return new ImapFlow({
    ...imapConfig,
    auth: {
      user: support.email,
      pass: support.password,
    },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 30000,
    // IDLE will be used automatically after mailboxOpen
  });
};

const buildReplySubject = (subject = '') => {
  const cleanSubject = String(subject || '').trim() || 'Support Request';
  return /^re:/i.test(cleanSubject) ? cleanSubject : `Re: ${cleanSubject}`;
};

const escapeHtml = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatSupportEmailDateTime = (value = new Date()) =>
  new Date(value).toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const buildSupportEmailShell = ({
  preheader = '',
  eyebrow = SUPPORT_DISPLAY_NAME,
  title = '',
  greeting = '',
  introLines = [],
  summaryRows = [],
  bodyHtml = '',
  trackingPixelUrl = '',
  ctaLabel = '',
  ctaUrl = '',
  closingLines = [],
}) => {
  const introHtml = introLines
    .filter(Boolean)
    .map(
      (line) => `
        <p style="margin: 0 0 14px; color: #334155; font-size: 15px; line-height: 1.7;">
          ${escapeHtml(line)}
        </p>
      `
    )
    .join('');

  const summaryHtml = summaryRows.length
    ? `
      <div style="margin: 24px 0; padding: 18px 20px; border: 1px solid #dbe5f1; border-radius: 14px; background: #f8fafc;">
        ${summaryRows
          .filter((row) => row?.label && row?.value)
          .map(
            (row) => `
              <div style="margin: 0 0 12px;">
                <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">
                  ${escapeHtml(row.label)}
                </div>
                <div style="font-size: 15px; color: #0f172a; line-height: 1.6;">
                  ${escapeHtml(row.value)}
                </div>
              </div>
            `
          )
          .join('')}
      </div>
    `
    : '';

  const ctaHtml =
    ctaLabel && ctaUrl
      ? `
        <div style="margin: 28px 0 0;">
          <a
            href="${ctaUrl}"
            style="display: inline-block; padding: 12px 22px; background: #1d4ed8; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700;"
          >
            ${escapeHtml(ctaLabel)}
          </a>
        </div>
      `
      : '';

  const closingHtml = closingLines
    .filter(Boolean)
    .map(
      (line) => `
        <p style="margin: 0 0 10px; color: #475569; font-size: 14px; line-height: 1.7;">
          ${escapeHtml(line)}
        </p>
      `
    )
    .join('');

  const trackingPixelSrc = String(trackingPixelUrl || '').trim();
  const trackingPixelHtml = trackingPixelSrc
    ? SUPPORT_TRACKING_DEBUG_VISIBLE
      ? `
        <div style="margin: 16px auto 0; max-width: 680px; padding: 10px 12px; border: 1px dashed #ef4444; border-radius: 10px; background: #fff5f5;">
          <p style="margin: 0 0 8px; color: #b91c1c; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;">
            Debug: Visible Email Tracking Pixel
          </p>
          <img src="${escapeHtml(
            trackingPixelSrc
          )}" alt="Support open tracking pixel" width="24" height="24" style="display: inline-block; width: 24px; height: 24px; border: 2px solid #ef4444; background: #ffffff;" />
          <div style="margin-top: 8px; color: #991b1b; font-size: 11px; line-height: 1.5; word-break: break-all;">
            ${escapeHtml(trackingPixelSrc)}
          </div>
        </div>
      `
      : `
        <div style="width: 1px; height: 1px; overflow: hidden; margin: 0; padding: 0;">
          <img src="${escapeHtml(
            trackingPixelSrc
          )}" alt="" width="1" height="1" style="display: block; width: 1px; height: 1px; border: 0;" />
        </div>
      `
    : '';

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin: 0; padding: 0; width: 100%; background: #eef2f7; font-family: Arial, sans-serif; color: #0f172a; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
        <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">
          ${escapeHtml(preheader)}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background: #eef2f7; margin: 0; padding: 0;">
          <tr>
            <td align="center" style="padding: 0; margin: 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 680px; border-collapse: separate; border-spacing: 0; overflow: hidden; border-radius: 22px; border: 1px solid #dbe5f1; background: #ffffff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);">
                <tr>
                  <td style="padding: 28px 32px; background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #38bdf8 100%); color: #ffffff;">
                    <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.85; margin-bottom: 12px;">
                      ${escapeHtml(eyebrow)}
                    </div>
                    <h1 style="margin: 0; font-size: 28px; line-height: 1.25;">
                      ${escapeHtml(title)}
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px 32px;">
                    <p style="margin: 0 0 16px; color: #0f172a; font-size: 15px; line-height: 1.7;">
                      ${escapeHtml(greeting)}
                    </p>
                    ${introHtml}
                    ${summaryHtml}
                    ${bodyHtml}
                    ${ctaHtml}
                    <div style="margin: 28px 0 0;">
                      ${closingHtml}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 32px 24px; border-top: 1px solid #e2e8f0; background: #f8fafc;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.7;">
                      ${SUPPORT_DISPLAY_NAME}<br />
                      <a href="mailto:${
                        support.email
                      }" style="color: #1d4ed8; text-decoration: none;">${escapeHtml(
    support.email
  )}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        ${trackingPixelHtml}
      </body>
    </html>
  `;
};

const syncTicketThreadMessageId = async (ticketDoc, nextMessageId = '') => {
  const normalizedMessageId = String(nextMessageId || '').trim();
  if (!ticketDoc?._id || !normalizedMessageId) return false;

  const threadMessageIds = new Set(
    (ticketDoc.threadMessageIds || []).map((value) =>
      String(value || '').trim()
    )
  );

  if (ticketDoc.messageId) {
    threadMessageIds.add(String(ticketDoc.messageId).trim());
  }

  if (ticketDoc.rootMessageId) {
    threadMessageIds.add(String(ticketDoc.rootMessageId).trim());
  }

  threadMessageIds.add(normalizedMessageId);
  ticketDoc.messageId = normalizedMessageId;

  if (!ticketDoc.rootMessageId) {
    ticketDoc.rootMessageId = normalizedMessageId;
  }

  ticketDoc.threadMessageIds = [...threadMessageIds].filter(Boolean);
  await ticketDoc.save({ validateBeforeSave: false });
  return true;
};

const buildInitialSupportAutoReplyEntry = (createdAt = new Date()) => ({
  fromName: SUPPORT_DISPLAY_NAME,
  fromEmail: support.email,
  fromType: 'agent',
  text: SUPPORT_INITIAL_AUTO_REPLY_TEXT,
  createdAt,
  readByUser: true,
  readByAgent: true,
  emailDigestSentAt: createdAt,
});

const sendInitialSupportTicketAcknowledgement = async (ticketDoc) => {
  if (!ticketDoc?._id || !ticketDoc?.senderEmail) return null;

  const ticketNumber = ticketDoc.ticket || 'Support Request';
  const cleanSubject =
    String(ticketDoc.subject || '').trim() || 'Support Request';
  const recipientName = ticketDoc.senderName || 'there';
  const supportUrl = `${getFrontendUrl()}/support?ticketId=${ticketDoc._id}`;
  const submittedAt = formatSupportEmailDateTime(
    ticketDoc.createdAt || new Date()
  );

  const response = await sendSupportMail(
    {
      from: `"${SUPPORT_SENDER_NAME}" <${support.email}>`,
      to: ticketDoc.senderEmail,
      replyTo: support.email,
      subject: buildReplySubject(cleanSubject),
      text: `Hello ${recipientName},

Thank you for contacting Kuku Data Support. Your ticket has been received and is now being reviewed.

Ticket reference: ${ticketNumber}
Subject: ${cleanSubject}
Submitted: ${submittedAt}

Open your ticket: ${supportUrl}
Reply email: ${support.email}`,
      html: buildSupportEmailShell({
        preheader: `Your support ticket ${ticketNumber} has been received.`,
        eyebrow: 'Kuku Data Support',
        title: 'Your support ticket has been received',
        greeting: `Hello ${recipientName},`,
        introLines: [
          'Thank you for contacting Kuku Data Support.',
          'Your request has been logged and our team is reviewing it now. We will follow up as soon as possible.',
        ],
        summaryRows: [
          {
            label: 'Ticket Reference',
            value: ticketNumber,
          },
          {
            label: 'Subject',
            value: cleanSubject,
          },
          {
            label: 'Submitted',
            value: submittedAt,
          },
        ],
        bodyHtml: `
          <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.7;">
            You can reply to this email at any time or open your ticket online to add more details.
          </p>
        `,
        ctaLabel: 'Open Support Ticket',
        ctaUrl: supportUrl,
        closingLines: ['Thank you for reaching out.', 'Kuku Data Support'],
      }),
    },
    {
      label: 'sendInitialSupportTicketAcknowledgement',
    }
  );

  const supportMessageId = String(response?.messageId || '').trim();
  if (supportMessageId) {
    await syncTicketThreadMessageId(ticketDoc, supportMessageId);
  }

  return response;
};

const sendContactRequestAcknowledgement = async (contactRequest) => {
  if (!contactRequest?._id || !contactRequest?.emailAddress) return null;

  const serviceLabel =
    CONTACT_SERVICE_LABELS[contactRequest.service] || 'General Enquiry';
  const submittedAt = formatSupportEmailDateTime(
    contactRequest.createdAt || new Date()
  );

  return sendNoReplyMail(
    {
      from: `"${SUPPORT_SENDER_NAME}" <${noreply.email}>`,
      to: contactRequest.emailAddress,
      replyTo: support.email,
      subject: `We received your ${serviceLabel.toLowerCase()} request`,
      text: `Hello ${contactRequest.fullName || 'there'},

Thank you for reaching out to Kuku Data. Your request has been received and our team will review it shortly.

Reference: ${contactRequest.reference}
Service: ${serviceLabel}${
      contactRequest.subject
        ? `\nSubject: ${String(contactRequest.subject).trim()}`
        : ''
    }
Submitted: ${submittedAt}

If you need to share anything else, you can reply to ${support.email}.`,
      html: buildSupportEmailShell({
        preheader: `Your ${serviceLabel.toLowerCase()} request ${
          contactRequest.reference
        } has been received.`,
        eyebrow: 'Kuku Data',
        title: 'Your request has been received',
        greeting: `Hello ${contactRequest.fullName || 'there'},`,
        introLines: [
          'Thank you for reaching out to Kuku Data.',
          'Your request has been logged successfully and our team will get back to you with the next steps shortly.',
        ],
        summaryRows: [
          {
            label: 'Reference',
            value: contactRequest.reference,
          },
          {
            label: 'Service',
            value: serviceLabel,
          },
          ...(contactRequest.subject
            ? [
                {
                  label: 'Subject',
                  value: String(contactRequest.subject).trim(),
                },
              ]
            : []),
          {
            label: 'Submitted',
            value: submittedAt,
          },
        ],
        bodyHtml: `
          <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.7;">
            We will review your request and reach out with the most relevant next steps as soon as possible.
          </p>
        `,
        closingLines: ['Thank you for contacting us.', 'Kuku Data Support'],
      }),
    },
    {
      label: 'sendContactRequestAcknowledgement',
    }
  );
};

const normalizeEmailReplyText = (value = '') =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u202f/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

const collapseWhitespace = (value = '') =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const stripQuotePrefix = (value = '') =>
  String(value || '').replace(/^\s*>+\s?/, '');

const EMAIL_REPLY_LINE_PATTERNS = [
  /^From:\s.+$/i,
  /^Sent:\s.+$/i,
  /^To:\s.+$/i,
  /^Cc:\s.+$/i,
  /^Bcc:\s.+$/i,
  /^Date:\s.+$/i,
  /^Subject:\s.+$/i,
  /^Reply-To:\s.+$/i,
  /^Begin forwarded message:\s*$/i,
  /^Forwarded message:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{5,}\s*$/i,
  /^<[^>\n]+>\s*wrote:\s*$/i,
  /^##-\s*Reply ABOVE THIS LINE\s*-##$/i,
];

const EMAIL_REPLY_TAIL_PATTERNS = [
  /\n+(?:>+\s*)?On\s.+?(?:\n(?:>+\s*)?.*?){0,5}\bwrote:\s*[\s\S]*$/i,
  /\n+On\s.+?\bwrote:\s*[\s\S]*$/i,
  /\n+(?:From|Sent|To|Cc|Bcc|Date|Subject|Reply-To):\s.+[\s\S]*$/i,
  /\n+Begin forwarded message:\s*[\s\S]*$/i,
  /\n+Forwarded message:\s*[\s\S]*$/i,
  /\n+-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
  /\n+_{5,}\s*[\s\S]*$/i,
  /\n+##-\s*Reply ABOVE THIS LINE\s*-##[\s\S]*$/i,
];

const hasReplyLinePattern = (value = '') =>
  EMAIL_REPLY_LINE_PATTERNS.some((pattern) =>
    pattern.test(collapseWhitespace(stripQuotePrefix(value)))
  );

const isReplyHeaderLine = (value = '') => {
  const normalizedLine = collapseWhitespace(stripQuotePrefix(value));

  return (
    /^On\s.+?\bwrote:\s*$/i.test(normalizedLine) ||
    /^.+<[^>\n]+>\s*wrote:\s*$/i.test(normalizedLine) ||
    hasReplyLinePattern(normalizedLine)
  );
};

const containsEmailReplyArtifacts = (rawText = '') => {
  const normalizedText = normalizeEmailReplyText(rawText);
  if (!normalizedText.trim()) return false;

  return (
    normalizedText
      .split('\n')
      .map((line) => line.trim())
      .some(
        (line) => (line && isReplyHeaderLine(line)) || line.startsWith('>')
      ) || /On\s.+?\bwrote:\s*$/im.test(normalizedText)
  );
};

const stripEmailReplyTail = (value = '') => {
  let cleaned = String(value || '');

  EMAIL_REPLY_TAIL_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });

  return cleaned.trim();
};

const SUPPORT_EMAIL_NOISE_PATTERNS = [
  /^##-\s*Reply ABOVE THIS LINE\s*-##$/i,
  /^Kuku Data Support sent \d+ updates? on your support ticket/i,
  /^You can reply directly to this email/i,
  /^You can reply to this email or continue the conversation/i,
  /^Open Support Ticket$/i,
  /^Ticket reference:\s*TKT-[A-Z0-9-]+$/i,
  /^https?:\/\/\S+$/i,
];

const stripSupportEmailNoise = (value = '') =>
  String(value || '')
    .split('\n')
    .filter((line) => {
      const normalizedLine = collapseWhitespace(stripQuotePrefix(line));

      return (
        !normalizedLine ||
        !SUPPORT_EMAIL_NOISE_PATTERNS.some((pattern) =>
          pattern.test(normalizedLine)
        )
      );
    })
    .join('\n')
    .trim();

const dequoteEmailReplyLevel = (value = '') =>
  String(value || '')
    .split('\n')
    .map((line) => line.replace(/^(\s*)>(?:\s?)/, '$1'))
    .join('\n');

const stripLeadingReplyHeaderBlock = (value = '') => {
  const lines = String(value || '').split('\n');
  let index = 0;

  while (index < lines.length) {
    const trimmedLine = lines[index].trim();

    if (!trimmedLine) {
      index += 1;
      continue;
    }

    const combinedPreview = collapseWhitespace(
      lines
        .slice(index, index + 6)
        .map((line) => stripQuotePrefix(line))
        .join(' ')
    );

    const isLeadingHeader =
      isReplyHeaderLine(trimmedLine) ||
      /^On\s.+?\bwrote:\s*$/i.test(combinedPreview) ||
      /^.+<[^>\n]+>\s*wrote:\s*$/i.test(combinedPreview);

    if (!isLeadingHeader) {
      break;
    }

    index += 1;
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }
  }

  return lines.slice(index).join('\n').trim();
};

const extractLatestEmailReply = (rawText = '') => {
  const normalizedText = normalizeEmailReplyText(rawText);

  if (!normalizedText.trim()) return '';

  const lines = normalizedText.split('\n');
  const capturedLines = [];

  const isQuotedReplyHeader = (startIndex) => {
    const combinedPreview = collapseWhitespace(
      lines.slice(startIndex, startIndex + 6).join(' ')
    );
    const currentLine = collapseWhitespace(
      stripQuotePrefix(lines[startIndex] || '')
    );

    return (
      /^On\s.+?\bwrote:\s*$/i.test(combinedPreview) ||
      isReplyHeaderLine(currentLine)
    );
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedLine = line.trim();

    if (
      trimmedLine &&
      (isReplyHeaderLine(trimmedLine) ||
        isQuotedReplyHeader(index) ||
        (trimmedLine.startsWith('>') &&
          capturedLines.some((capturedLine) => String(capturedLine).trim())))
    ) {
      break;
    }

    capturedLines.push(line);
  }

  let cleaned = capturedLines.join('\n').trim();

  cleaned = stripEmailReplyTail(cleaned);
  cleaned = stripSupportEmailNoise(cleaned);

  if (!cleaned && !containsEmailReplyArtifacts(normalizedText)) {
    cleaned = normalizedText.trim();
  }

  return String(cleaned || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const sanitizeSupportConversationText = (rawText = '') => {
  const normalizedText = normalizeEmailReplyText(rawText).trim();
  if (!normalizedText) return '';

  let candidate = normalizedText;
  let cleanedText = '';

  for (let depth = 0; depth < 6; depth += 1) {
    cleanedText = stripSupportEmailNoise(
      extractLatestEmailReply(candidate) || ''
    );

    if (cleanedText) {
      break;
    }

    const dequotedCandidate = stripLeadingReplyHeaderBlock(
      dequoteEmailReplyLevel(candidate)
    ).trim();
    if (!dequotedCandidate || dequotedCandidate === candidate) {
      break;
    }

    candidate = dequotedCandidate;
  }

  if (!cleanedText) {
    cleanedText = stripSupportEmailNoise(
      stripEmailReplyTail(normalizedText) || normalizedText
    );
  }

  return String(cleanedText || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const sendSupportDigestEmail = async ({
  ticket,
  digestToken,
  messageEntries = [],
}) => {
  const references = [
    ...new Set((ticket.threadMessageIds || []).filter(Boolean)),
  ];
  const inReplyTo =
    ticket.messageId || ticket.rootMessageId || references.at(-1) || undefined;
  const trackingUrl = buildEmailTrackingUrl(digestToken);
  const trackedSupportUrl = buildEmailOpenTicketUrl(digestToken, ticket._id);
  const frontendOpenTicketUrl = buildFrontendSupportOpenTokenUrl(
    digestToken,
    ticket._id
  );
  const safeAgentName = SUPPORT_DISPLAY_NAME;
  const safeMessages = messageEntries
    .map((entry) => ({
      text: sanitizeSupportConversationText(entry?.text || ''),
      createdAt: entry?.createdAt ? new Date(entry.createdAt) : new Date(),
    }))
    .filter((entry) => entry.text);

  if (!safeMessages.length) {
    return null;
  }

  console.log('[Support Digest] Preparing digest email payload', {
    ticketId: String(ticket?._id || ''),
    ticketRef: ticket?.ticket || '',
    recipientEmail: normalizeEmail(ticket?.senderEmail || ''),
    messageCount: safeMessages.length,
    tokenPreview: getTokenPreview(digestToken),
    trackingUrl,
    frontendOpenTicketUrl,
    trackedSupportUrl,
  });

  const htmlMessages = safeMessages
    .map(
      (entry) => `
        <div style="margin: 0 0 14px; padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f8fafc;">
          <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">
            ${escapeHtml(
              new Date(entry.createdAt).toLocaleString('en-US', {
                timeZone: 'Africa/Lagos',
              })
            )}
          </div>
          <div>${escapeHtml(entry.text).replace(/\r?\n/g, '<br />')}</div>
        </div>
      `
    )
    .join('');

  const textMessages = safeMessages
    .map(
      (entry) =>
        `${new Date(entry.createdAt).toLocaleString('en-US', {
          timeZone: 'Africa/Lagos',
        })}\n${entry.text}`
    )
    .join('\n\n---\n\n');

  const htmlBody = `
    <div style="margin: 24px 0 0;">
      <p style="margin: 0 0 16px; color: #334155; font-size: 15px; line-height: 1.7;">
        ${escapeHtml(safeAgentName)} posted ${
    safeMessages.length === 1
      ? 'a new update'
      : `${safeMessages.length} new updates`
  } on your support ticket.
      </p>
      ${htmlMessages}
      <p style="margin: 16px 0 0; color: #334155; font-size: 15px; line-height: 1.7;">
        You can reply to this email or continue the conversation in your support workspace.
      </p>
    </div>
  `;

  const html = buildSupportEmailShell({
    preheader: `${safeMessages.length} new support ${
      safeMessages.length === 1 ? 'update' : 'updates'
    } for ticket ${ticket.ticket || ''}.`,
    eyebrow: 'Kuku Data Support',
    title:
      safeMessages.length === 1
        ? 'A new support update is ready'
        : `${safeMessages.length} new support updates are ready`,
    greeting: `Hello ${ticket.senderName || 'there'},`,
    introLines: [],
    summaryRows: [
      {
        label: 'Ticket Reference',
        value: ticket.ticket || 'Support Request',
      },
      {
        label: 'Subject',
        value: ticket.subject || 'Support Request',
      },
      {
        label: 'Latest Update',
        value: formatSupportEmailDateTime(
          safeMessages[safeMessages.length - 1]?.createdAt
        ),
      },
    ],
    bodyHtml: htmlBody,
    trackingPixelUrl: trackingUrl,
    ctaLabel: 'Open Support Ticket',
    ctaUrl: frontendOpenTicketUrl,
    closingLines: [
      'We are here if you need any clarification.',
      'Kuku Data Support',
    ],
  });

  const mailOptions = {
    from: `"${SUPPORT_SENDER_NAME}" <${support.email}>`,
    to: ticket.senderEmail,
    replyTo: support.email,
    subject: buildReplySubject(ticket.subject),
    text: `Hello ${ticket.senderName || 'there'},

${safeAgentName} posted ${
      safeMessages.length === 1
        ? 'a new update'
        : `${safeMessages.length} new updates`
    } on your support ticket ${ticket.ticket || ''}.

${textMessages}

Open ticket: ${frontendOpenTicketUrl}
Reply email: ${support.email}`,
    html,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length > 0 ? { references: references.join(' ') } : {}),
  };

  const sendResult = await sendSupportMail(mailOptions, {
    label: 'sendSupportDigestEmail',
  });
  console.log('[Support Digest] Digest email sent', {
    ticketId: String(ticket?._id || ''),
    ticketRef: ticket?.ticket || '',
    recipientEmail: normalizeEmail(ticket?.senderEmail || ''),
    tokenPreview: getTokenPreview(digestToken),
    messageId: String(sendResult?.messageId || '').trim(),
  });

  return sendResult;
};

let isProcessingPendingReplyDigests = false;

const collectPendingDigestMessages = (ticket) => {
  const pendingMessages = [];

  (ticket.conversation || []).forEach((entry, index) => {
    const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
    const isPending =
      entry?.fromType === 'agent' &&
      !entry?.readByUser &&
      !entry?.emailDigestSentAt &&
      createdAt &&
      sanitizeSupportConversationText(entry?.text || '');

    if (!isPending) return;

    pendingMessages.push({
      index,
      entry,
      id: entry?._id ? String(entry._id) : null,
      createdAt,
    });
  });

  return pendingMessages;
};

const processPendingReplyDigests = async (trigger = 'manual') => {
  if (isProcessingPendingReplyDigests) {
    return { skipped: true, reason: 'already-running' };
  }

  isProcessingPendingReplyDigests = true;

  try {
    const cutoffTime = new Date(Date.now() - SUPPORT_DIGEST_DELAY_MS);
    const candidateTickets = await Complain.find({
      conversation: {
        $elemMatch: {
          fromType: 'agent',
          readByUser: false,
        },
      },
    });

    let sentCount = 0;

    for (const ticket of candidateTickets) {
      try {
        const pendingMessages = collectPendingDigestMessages(ticket);
        const latestPendingReplyAt = pendingMessages.reduce(
          (latestDate, item) =>
            !latestDate || item.createdAt > latestDate
              ? item.createdAt
              : latestDate,
          null
        );

        if (
          !pendingMessages.length ||
          !ticket.senderEmail ||
          !latestPendingReplyAt ||
          latestPendingReplyAt > cutoffTime
        ) {
          continue;
        }

        const digestToken = buildSupportDigestToken();
        const emailResult = await sendSupportDigestEmail({
          ticket,
          digestToken,
          messageEntries: pendingMessages.map(({ entry }) => entry),
        });

        if (!emailResult) {
          continue;
        }

        const mailMessageId = String(emailResult?.messageId || '').trim();
        const sentAt = new Date();

        ticket.conversation.forEach((entry, index) => {
          const matched = pendingMessages.find((item) => item.index === index);
          if (!matched) return;

          entry.emailDigestSentAt = sentAt;
          entry.emailDigestToken = digestToken;
          entry.emailDigestMessageId = mailMessageId;
        });

        const threadMessageIds = new Set(
          (ticket.threadMessageIds || []).map((value) =>
            String(value || '').trim()
          )
        );
        if (ticket.messageId) {
          threadMessageIds.add(String(ticket.messageId).trim());
        }
        if (ticket.rootMessageId) {
          threadMessageIds.add(String(ticket.rootMessageId).trim());
        }
        if (mailMessageId) {
          threadMessageIds.add(mailMessageId);
          ticket.messageId = mailMessageId;
          if (!ticket.rootMessageId) {
            ticket.rootMessageId = mailMessageId;
          }
        }

        ticket.threadMessageIds = [...threadMessageIds].filter(Boolean);
        ticket.processed = true;
        ticket.metadata = {
          ...(ticket.metadata || {}),
          lastSupportEmailSentAt: sentAt,
          lastSupportEmailTrigger: trigger,
        };

        await ticket.save({ validateBeforeSave: false });

        await SupportEmailDigest.create({
          token: digestToken,
          ticket: ticket._id,
          recipientEmail: normalizeEmail(ticket.senderEmail),
          conversationEntryIds: pendingMessages
            .map(({ id }) => id)
            .filter(Boolean),
          conversationIndexes: pendingMessages.map(({ index }) => index),
          mailMessageId,
          sentAt,
        });

        sentCount += 1;
      } catch (ticketError) {
        console.error(
          `[Support Digest] Failed for ticket ${ticket?._id || 'unknown'}:`,
          ticketError.message
        );
      }
    }

    if (sentCount > 0) {
      console.log(
        `[Support Digest] Sent ${sentCount} digest email(s) via ${trigger}`
      );
    }

    return { sentCount };
  } catch (error) {
    console.error('[Support Digest] Failed to process pending digests:', error);
    return { sentCount: 0, error: error.message };
  } finally {
    isProcessingPendingReplyDigests = false;
  }
};

const markDigestMessagesOpened = async (digestDoc, source = null) => {
  if (!digestDoc?.ticket) return false;

  const ticket = await Complain.findById(digestDoc.ticket);
  if (!ticket?._id) return false;

  const now = new Date();
  const idSet = new Set(
    (digestDoc.conversationEntryIds || []).map((entryId) => String(entryId))
  );
  const indexSet = new Set((digestDoc.conversationIndexes || []).map(Number));

  let changed = false;

  (ticket.conversation || []).forEach((entry, index) => {
    const matchesById = entry?._id && idSet.has(String(entry._id));
    const matchesByIndex = indexSet.has(index);
    if (!matchesById && !matchesByIndex) return;

    if (entry.fromType === 'agent' && !entry.readByUser) {
      entry.readByUser = true;
      entry.readAtUser = now;
      entry.mailboxSeenAt = now;
      changed = true;
    }
  });

  if (changed) {
    ticket.metadata = {
      ...(ticket.metadata || {}),
      lastSupportEmailOpenedAt: now,
    };
    await ticket.save({ validateBeforeSave: false });
    emitTicketMessagesReadByUser(
      source,
      ticket._id,
      MAILBOX_READ_NAME,
      ticket.senderEmail
    );
  }

  return changed;
};

const markDigestOpenedByToken = async (
  token,
  source = null,
  expectedRecipientEmail = ''
) => {
  const normalizedToken = String(token || '').trim();
  const tokenPreview = getTokenPreview(normalizedToken);
  if (!normalizedToken) {
    console.log(
      '[Support Digest] markDigestOpenedByToken skipped (empty token)'
    );
    return false;
  }

  console.log('[Support Digest] markDigestOpenedByToken start', {
    tokenPreview,
    expectedRecipientEmail: normalizeEmail(expectedRecipientEmail),
  });

  const digest = await SupportEmailDigest.findOne({ token: normalizedToken });
  if (!digest) {
    console.log('[Support Digest] No digest found for token', { tokenPreview });
    return false;
  }

  const normalizedExpectedRecipient = normalizeEmail(expectedRecipientEmail);
  const normalizedDigestRecipient = normalizeEmail(digest.recipientEmail || '');
  if (
    normalizedExpectedRecipient &&
    normalizedDigestRecipient &&
    normalizedExpectedRecipient !== normalizedDigestRecipient
  ) {
    console.log('[Support Digest] Recipient mismatch for token', {
      tokenPreview,
      expectedRecipient: normalizedExpectedRecipient,
      digestRecipient: normalizedDigestRecipient,
    });
    return false;
  }

  const wasAlreadyOpened = Boolean(digest.openedAt);
  if (!digest.openedAt) {
    digest.openedAt = new Date();
    await digest.save({ validateBeforeSave: false });
  }

  const didMarkAnyMessage = await markDigestMessagesOpened(digest, source);
  console.log('[Support Digest] markDigestOpenedByToken complete', {
    tokenPreview,
    digestId: String(digest?._id || ''),
    ticketId: String(digest?.ticket || ''),
    wasAlreadyOpened,
    openedAt: digest.openedAt ? new Date(digest.openedAt).toISOString() : null,
    didMarkAnyMessage,
  });

  return true;
};

async function processUnseenEmailsBatch(trigger = 'manual') {
  if (!client || !isConnected) {
    console.log('[IMAP] Client not connected');
    return;
  }

  let lock;
  try {
    lock = await client.getMailboxLock(IMAP_MAILBOX);

    const uidList = await client.search({ seen: false }, { uid: true });

    if (!uidList || uidList.length === 0) {
      console.log(`[IMAP] No unseen emails (${trigger})`);
      return;
    }

    console.log(
      `[IMAP] Found ${uidList.length} unseen email(s) via ${trigger}`
    );

    for (const uid of uidList) {
      try {
        const message = await client.fetchOne(
          uid,
          {
            source: true,
            envelope: true,
          },
          { uid: true }
        );

        if (!message?.envelope) continue;

        const from = normalizeEmail(message.envelope.from?.[0]?.address || '');
        const subject = message.envelope.subject || 'No Subject';
        const messageId = message.envelope.messageId?.trim() || null;

        console.log(
          `[IMAP] Processing uid=${uid} from ${
            from || 'unknown'
          } | Subject: ${subject}`
        );

        if (!message.source || !from) continue;

        const parsed = await simpleParser(message.source);
        const parsedText = String(parsed.text || '').trim();
        const parsedHtml = String(parsed.html || '').trim();
        const trackingTokenFromReply =
          extractTrackingTokenFromContent(parsedHtml) ||
          extractTrackingTokenFromContent(parsedText);

        if (trackingTokenFromReply) {
          console.log('[Support Digest] Tracking token found in inbound reply', {
            uid,
            from,
            tokenPreview: getTokenPreview(trackingTokenFromReply),
          });
          try {
            await markDigestOpenedByToken(
              trackingTokenFromReply,
              ticketIo,
              from
            );
          } catch (trackingError) {
            console.error(
              '[Support Digest] Failed to mark digest from reply content:',
              trackingError.message
            );
          }
        } else if (
          /\/api\/complains\/email\/open\//i.test(parsedHtml) ||
          /\/api\/complains\/email\/open\//i.test(parsedText)
        ) {
          console.log(
            '[Support Digest] Inbound reply contained tracking path but token parsing returned empty',
            { uid, from }
          );
        }

        const latestReplyText =
          extractLatestEmailReply(parsedText) ||
          sanitizeSupportConversationText(parsedText);
        const normalizedReferences = []
          .concat(parsed.references || [])
          .map((ref) => String(ref || '').trim())
          .filter(Boolean);

        const inReplyTo = String(parsed.inReplyTo || '').trim();
        const messageEntry = {
          fromName: parsed.from?.text || from,
          fromEmail: from,
          fromType: 'user',
          text: latestReplyText,
          html: '',
          createdAt: new Date(),
          readByUser: true,
          readByAgent: false,
        };

        let complain = null;

        if (messageId) {
          complain = await Complain.findOne({
            $or: [
              { messageId },
              { rootMessageId: messageId },
              { threadMessageIds: messageId },
            ],
          });
        }

        if (!complain && inReplyTo) {
          complain = await Complain.findOne({
            $or: [
              { messageId: inReplyTo },
              { rootMessageId: inReplyTo },
              { threadMessageIds: inReplyTo },
            ],
          });
        }

        if (!complain && normalizedReferences.length > 0) {
          complain = await Complain.findOne({
            threadMessageIds: { $in: normalizedReferences },
          }).sort({ createdAt: -1 });
        }

        if (!complain) {
          complain = await Complain.findOne({
            senderEmail: from,
            subject: {
              $regex: subject.replace(/^(Re: |Fwd: )/i, ''),
              $options: 'i',
            },
            createdAt: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          }).sort({ createdAt: -1 });
        }

        if (complain) {
          const threadMessageIds = new Set(
            (complain.threadMessageIds || []).map((entry) =>
              String(entry || '').trim()
            )
          );

          if (complain.messageId) {
            threadMessageIds.add(String(complain.messageId).trim());
          }
          if (complain.rootMessageId) {
            threadMessageIds.add(String(complain.rootMessageId).trim());
          }
          if (messageId) {
            threadMessageIds.add(messageId);
          }
          normalizedReferences.forEach((ref) => threadMessageIds.add(ref));
          if (inReplyTo) {
            threadMessageIds.add(inReplyTo);
          }

          if (messageId) {
            complain.messageId = messageId;
          }
          if (['resolved', 'closed'].includes(complain.status)) {
            complain.status = 'open';
          }

          complain.threadMessageIds = [...threadMessageIds].filter(Boolean);
          complain.processed = true;
          complain.metadata = {
            ...(complain.metadata || {}),
            lastEmailReceivedAt: new Date(),
            lastEmailSubject: subject,
          };

          await complain.appendMessage(messageEntry);
          const appendedEntry =
            complain.conversation?.[complain.conversation.length - 1] ||
            messageEntry;

          emitTicketReply(ticketIo, complain, appendedEntry);
          await notifyAgentsOfTicketActivity(ticketIo, complain, {
            title: 'Customer replied by email',
            message: `${
              complain.senderName || 'A customer'
            } replied to ticket "${complain.subject || complain.ticket}".`,
            priority: 'normal',
            replyPreview: appendedEntry.text,
          });
          console.log(
            `[IMAP] Appended email to ticket ${complain.ticket} (${complain._id})`
          );
        } else {
          complain = new Complain({
            ticket: undefined,
            subject,
            senderName: messageEntry.fromName || 'Unknown',
            senderEmail: from,
            source: 'email',
            priority: 'medium',
            status: 'open',
            messageId,
            rootMessageId: messageId || null,
            threadMessageIds: [
              messageId,
              inReplyTo,
              ...normalizedReferences,
            ].filter(Boolean),
            conversation: [
              messageEntry,
              buildInitialSupportAutoReplyEntry(new Date()),
            ],
            bodyHtml: messageEntry.html,
            processed: true,
            metadata: {
              firstEmailReceived: new Date(),
              originalSubject: subject,
            },
          });

          await complain.save();
          emitTicketCreated(ticketIo, complain);
          await notifyAgentsOfTicketActivity(ticketIo, complain, {
            title: 'New email support ticket',
            message: `${complain.senderName || 'A customer'} opened ticket "${
              complain.subject || complain.ticket
            }" by email.`,
            priority: 'high',
            replyPreview: messageEntry.text,
          });
          try {
            await sendInitialSupportTicketAcknowledgement(complain);
          } catch (mailError) {
            console.error(
              `[IMAP] Failed to send initial support acknowledgement for ${complain.ticket}:`,
              mailError.message
            );
          }
          console.log(
            `[IMAP] Created new ticket ${complain.ticket} for ${from} (${complain._id})`
          );
        }

        await client.messageFlagsAdd(uid, ['\\Seen'], {
          uid: true,
          silent: true,
        });
        console.log(`[IMAP] Marked uid=${uid} as read`);
      } catch (err) {
        console.error(`[IMAP] Error processing uid=${uid}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[IMAP] Error in processUnseenEmails:', err.message);
  } finally {
    if (lock?.release) {
      try {
        await lock.release();
      } catch (e) {
        console.error('[IMAP] Failed to release lock:', e.message);
      }
    }
  }
}

async function processUnseenEmails(trigger = 'manual') {
  if (isProcessingUnseenEmails) {
    shouldReprocessUnseenEmails = true;
    return;
  }

  isProcessingUnseenEmails = true;

  try {
    let nextTrigger = trigger;
    do {
      shouldReprocessUnseenEmails = false;
      await processUnseenEmailsBatch(nextTrigger);
      nextTrigger = 'queued';
    } while (shouldReprocessUnseenEmails);
  } finally {
    isProcessingUnseenEmails = false;
  }
}

async function startListeningUnseenEmails() {
  if (isImapShuttingDown || isStartingListener) {
    return false;
  }

  if (!getImapConfig()) {
    console.warn(
      '[IMAP] Listener disabled: configure SUPPORT_IMAP_HOST, SUPPORT_EMAIL, and SUPPORT_PASSWORD.'
    );
    return false;
  }

  if (client && isConnected) {
    return true;
  }

  isStartingListener = true;
  clearReconnectTimer();

  try {
    await cleanupImapClient();

    client = createImapClient();

    client.on('error', (err) => {
      console.error('[IMAP] Error:', err.message);
      isConnected = false;
      scheduleReconnect('error');
    });

    client.on('close', () => {
      console.log('[IMAP] Connection closed');
      isConnected = false;
      scheduleReconnect('close');
    });

    client.on('exists', (event) => {
      const count = Number(event?.count || 0);
      const prevCount = Number(event?.prevCount || 0);
      if (count <= prevCount) return;

      console.log(`[IMAP] exists event received (${prevCount} -> ${count})`);
      runImapTaskSafely('Process unseen emails (exists event)', () =>
        processUnseenEmails('exists')
      );
    });

    await client.connect();
    console.log('[IMAP] Connected');

    await client.mailboxOpen(IMAP_MAILBOX, { readOnly: false });
    console.log(`[IMAP] ${IMAP_MAILBOX} opened`);

    isConnected = true;
    await processUnseenEmails('startup');

    console.log('[IMAP] Email listener started (realtime IDLE mode)');
    return true;
  } catch (err) {
    logImapTaskError('Failed to start listener', err);
    isConnected = false;
    await cleanupImapClient();
    scheduleReconnect('startup failure');
    return false;
  } finally {
    isStartingListener = false;
  }
}

router.startListeningUnseenEmails = startListeningUnseenEmails;
router.processPendingReplyDigests = processPendingReplyDigests;
router.setIo = setTicketIo;

const shutdownImapListener = async () => {
  isImapShuttingDown = true;
  clearReconnectTimer();
  await cleanupImapClient();
};

process.on('SIGINT', async () => {
  console.log('[IMAP] Shutting down listener...');
  await shutdownImapListener();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[IMAP] Received SIGTERM, shutting down listener...');
  await shutdownImapListener();
  process.exit(0);
});

// POST /api/complains/complain – Create new complaint/ticket from contact form
router.post('/new-complain', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    // Basic validation
    if (
      !name?.trim() ||
      !email?.trim() ||
      !subject?.trim() ||
      !message?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'All fields (name, email, subject, message) are required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ emailAddress: normalizedEmail });

    const createdAt = new Date();
    const newComplain = new Complain({
      subject: subject.trim(),
      senderName: name.trim(),
      senderEmail: normalizedEmail,
      priority: 'medium',
      status: 'open',
      source: 'web',
      conversation: [
        {
          fromName: name.trim(),
          fromEmail: normalizedEmail,
          fromType: 'user',
          text: message.trim(),
          createdAt,
          readByUser: true,
          readByAgent: false,
        },
        buildInitialSupportAutoReplyEntry(createdAt),
      ],
      assignedTo: user?._id || null,
    });

    await newComplain.save();
    emitTicketCreated(req, newComplain);
    void runBestEffortSupportTask(
      'notifyAgentsOfTicketActivity',
      () =>
        notifyAgentsOfTicketActivity(req, newComplain, {
          title: 'New support ticket',
          message: `${newComplain.senderName || 'A customer'} opened ticket "${
            newComplain.subject || newComplain.ticket
          }".`,
          priority: 'high',
          replyPreview: message.trim(),
        }),
      {
        ticketId: String(newComplain?._id || ''),
        ticket: newComplain?.ticket || '',
      }
    );
    void runBestEffortSupportTask(
      'sendInitialSupportTicketAcknowledgement',
      () => sendInitialSupportTicketAcknowledgement(newComplain),
      {
        ticketId: String(newComplain?._id || ''),
        ticket: newComplain?.ticket || '',
        emailAddress: normalizeEmail(newComplain?.senderEmail || ''),
      }
    );

    return res.status(201).json({
      success: true,
      message: SUPPORT_REQUEST_SUCCESS_MESSAGE,
      id: newComplain._id,
      ticketId: newComplain._id,
      ticket: newComplain.ticket,
    });
  } catch (error) {
    console.error('Error saving complaint:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
    });
  }
});

router.post('/contact-request', async (req, res) => {
  try {
    const {
      name,
      email,
      phoneNumber,
      companyName,
      service,
      subject,
      message,
      source,
      meta,
    } = req.body || {};

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedService = CONTACT_SERVICE_LABELS[service]
      ? service
      : 'general';
    const matchedUser = await User.findOne({ emailAddress: normalizedEmail })
      .select('_id')
      .lean();

    const contactRequest = await ContactRequest.create({
      user: matchedUser?._id || null,
      fullName: name.trim(),
      emailAddress: normalizedEmail,
      phoneNumber: String(phoneNumber || '').trim(),
      companyName: String(companyName || '').trim(),
      service: normalizedService,
      subject: String(subject || '').trim(),
      message: message.trim(),
      source: ['contact_page', 'web_development', 'support', 'other'].includes(
        source
      )
        ? source
        : 'other',
      meta: typeof meta === 'object' && meta ? meta : {},
    });

    void runBestEffortSupportTask(
      'notifyAgentsOfContactRequest',
      () => notifyAgentsOfContactRequest(req, contactRequest),
      {
        contactRequestId: String(contactRequest?._id || ''),
        reference: contactRequest?.reference || '',
      }
    );
    void runBestEffortSupportTask(
      'sendContactRequestAcknowledgement',
      () => sendContactRequestAcknowledgement(contactRequest),
      {
        contactRequestId: String(contactRequest?._id || ''),
        reference: contactRequest?.reference || '',
        emailAddress: normalizeEmail(contactRequest?.emailAddress || ''),
      }
    );

    return res.status(201).json({
      success: true,
      message: CONTACT_REQUEST_SUCCESS_MESSAGE,
      data: {
        id: contactRequest._id,
        reference: contactRequest.reference,
        service: normalizedService,
      },
    });
  } catch (error) {
    console.error('Error saving contact request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
    });
  }
});

router.get('/email/open/:token/pixel.gif', async (req, res) => {
  const { token } = req.params;
  const tokenPreview = getTokenPreview(token);
  const requestIp =
    req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '';
  const userAgent = req.get('user-agent') || '';
  const referer = req.get('referer') || '';

  console.log('[Support Digest] Pixel endpoint hit', {
    tokenPreview,
    path: req.originalUrl,
    ip: requestIp,
    userAgent,
    referer,
    query: req.query || {},
  });

  try {
    if (token) {
      const marked = await markDigestOpenedByToken(token, ticketIo);
      console.log('[Support Digest] Pixel endpoint processed', {
        tokenPreview,
        marked,
      });
    }
  } catch (error) {
    console.error('[Support Digest] Tracking pixel failed:', {
      tokenPreview,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRACKING_PIXEL_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });

  return res.status(200).end(TRACKING_PIXEL_BUFFER);
});

router.get('/email/open/:token/mark', async (req, res) => {
  const { token } = req.params;
  const tokenPreview = getTokenPreview(token);
  const requestIp =
    req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '';
  const userAgent = req.get('user-agent') || '';
  const skipWarningHeader = req.get('ngrok-skip-browser-warning') || '';
  const referer = req.get('referer') || '';
  let digestTicketId = '';

  console.log('[Support Digest] Mark endpoint hit', {
    tokenPreview,
    path: req.originalUrl,
    ip: requestIp,
    userAgent,
    referer,
    hasNgrokSkipHeader: Boolean(skipWarningHeader),
    query: req.query || {},
  });

  try {
    if (token) {
      const digest = await SupportEmailDigest.findOne({ token })
        .select('ticket')
        .lean();
      digestTicketId = digest?.ticket ? String(digest.ticket) : '';

      const marked = await markDigestOpenedByToken(token, ticketIo);
      console.log('[Support Digest] Mark endpoint processed', {
        tokenPreview,
        marked,
        digestTicketId,
      });

      return res.status(200).json({
        success: true,
        marked,
        ticketId: digestTicketId || null,
      });
    }
  } catch (error) {
    console.error('[Support Digest] Mark endpoint failed:', {
      tokenPreview,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }

  return res.status(200).json({
    success: true,
    marked: false,
    ticketId: digestTicketId || null,
  });
});

router.get('/email/open/:token/ticket', async (req, res) => {
  const { token } = req.params;
  const tokenPreview = getTokenPreview(token);
  const queryTicketId = String(req.query?.ticketId || '').trim();
  const requestIp =
    req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '';
  const userAgent = req.get('user-agent') || '';
  let fallbackTicketId = '';

  console.log('[Support Digest] Ticket redirect hit', {
    tokenPreview,
    path: req.originalUrl,
    ip: requestIp,
    userAgent,
    queryTicketId,
  });

  try {
    if (token) {
      const digest = await SupportEmailDigest.findOne({ token })
        .select('ticket')
        .lean();
      fallbackTicketId = digest?.ticket ? String(digest.ticket) : '';

      const marked = await markDigestOpenedByToken(token, ticketIo);
      console.log('[Support Digest] Ticket redirect processed', {
        tokenPreview,
        marked,
        fallbackTicketId,
      });
    }
  } catch (error) {
    console.error('[Support Digest] Ticket redirect failed:', {
      tokenPreview,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }

  const targetUrl = buildFrontendSupportUrl(queryTicketId || fallbackTicketId);
  return res.redirect(302, targetUrl);
});

// GET /api/complains/tickets – Fetch tickets by email
router.get('/tickets', authMiddleware, async (req, res) => {
  try {
    const authEmail = (req.user?.email || '').trim().toLowerCase();
    const requestedEmail = (req.query?.email || '').trim().toLowerCase();
    const isAdmin = isAgentRole(req.user);
    const emailToUse = isAdmin && requestedEmail ? requestedEmail : authEmail;

    if (!emailToUse) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const tickets = await Complain.find({
      senderEmail: emailToUse,
    })
      .sort({ createdAt: -1 })
      .select(
        'ticket subject status priority senderName senderEmail createdAt conversation'
      );

    return res.json({
      success: true,
      tickets: tickets.map((ticket) => ({
        ...serializeTicket(ticket),
        unreadCount: getUserUnreadReplyCount(ticket),
      })),
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
    });
  }
});

// GET /api/complains/ticket/:id – Fetch single ticket by ID
router.get('/ticket/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const authEmail = (req.user?.email || '').trim().toLowerCase();
    const isAdmin = isAgentRole(req.user);

    //console.log(id)

    const ticket = await Complain.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    const ticketOwnerEmail = (ticket.senderEmail || '').trim().toLowerCase();
    if (!isAdmin && ticketOwnerEmail !== authEmail) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this ticket',
      });
    }

    return res.json({
      success: true,
      ticket,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.',
    });
  }
});

router.get('/open', authMiddleware, async (req, res) => {
  try {
    const requester = req.user;
    if (!requester || !isAgentRole(requester)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 100);
    const complains = await Complain.find({ status: 'open' })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      success: true,
      count: complains.length,
      data: complains,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/complains/:id/reply
router.post('/:id/reply', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const replyData = req.body;

    // ────────────────────────────────────────────────
    // 1. Get authenticated user from request
    //    (you must have authentication middleware before this route)
    // ────────────────────────────────────────────────
    const authUser = req.user; // ← comes from your auth middleware (JWT, session, etc.)

    if (!authUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // ────────────────────────────────────────────────
    // 2. Basic input validation
    // ────────────────────────────────────────────────
    if (!replyData.text?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply text is required',
      });
    }

    // ────────────────────────────────────────────────
    // 3. Find the ticket
    // ────────────────────────────────────────────────
    const ticket = await Complain.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found',
      });
    }

    // ────────────────────────────────────────────────
    // 4. Authorization: who is allowed to reply?
    // ────────────────────────────────────────────────
    const authEmail = normalizeEmail(
      authUser.email || authUser.emailAddress || ''
    );
    const isAgent = isAgentRole(authUser);
    const isTicketOwner = normalizeEmail(ticket.senderEmail) === authEmail;

    if (!isAgent && !isTicketOwner) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reply to this ticket',
      });
    }

    // ────────────────────────────────────────────────
    // 5. Determine fromType & override sender info
    //    → prevent impersonation
    // ────────────────────────────────────────────────
    const fromType = isAgent ? 'agent' : 'user';

    // Use authenticated user's real info (ignore whatever client sent)
    const fromName = isAgent
      ? SUPPORT_DISPLAY_NAME
      : authUser.fullName || authUser.name || 'User';
    const fromEmail = isAgent ? support.email : authEmail;

    const readByAgent = isAgentRole(authUser);
    const readByUser = ticket.senderEmail === authEmail;

    // Build clean reply object
    const cleanReply = {
      fromType,
      fromName,
      fromEmail,
      text: replyData.text.trim(),
      createdAt: replyData.createdAt
        ? new Date(replyData.createdAt)
        : new Date(),
      readByUser,
      readByAgent,
      // you can add more fields later: html, attachments: [], read: false, etc.
    };

    // ────────────────────────────────────────────────
    // 6. Atomic update
    // ────────────────────────────────────────────────
    const updatedTicket = await Complain.findByIdAndUpdate(
      id,
      {
        $push: { conversation: cleanReply },
        $set: { updatedAt: new Date() },
      },
      {
        returnDocument: 'after',
        runValidators: true,
      }
    );

    emitTicketReply(req, updatedTicket, cleanReply);

    let emailReplyQueued = false;

    if (isAgent) {
      emailReplyQueued = true;

      const ticketOwner = await User.findOne({
        emailAddress: ticket.senderEmail,
      })
        .select('_id emailAddress')
        .lean();

      if (ticketOwner?._id) {
        await createUserNotification(req, {
          userId: ticketOwner._id,
          emailAddress: ticketOwner.emailAddress,
          category: 'system',
          title: 'New support reply',
          message: `${SUPPORT_DISPLAY_NAME} replied to your ticket "${
            ticket.subject || ticket.ticket
          }".`,
          actionUrl: `/support?ticketId=${ticket._id}`,
          priority: 'normal',
          groupKey: buildTicketNotificationGroupKey(ticket._id),
          meta: {
            ticketId: ticket._id.toString(),
            ticket: ticket.ticket,
            replyPreview: cleanReply.text,
          },
        });
      }
    } else {
      await notifyAgentsOfTicketActivity(req, updatedTicket, {
        title: 'Customer replied to a ticket',
        message: `${fromName} replied to ticket "${
          ticket.subject || ticket.ticket
        }".`,
        priority: 'normal',
        replyPreview: cleanReply.text,
      });
    }

    // ────────────────────────────────────────────────
    // 7. Optional: real-time notification via socket.io
    // ────────────────────────────────────────────────
    // if (req.io) {
    //   const room = `ticket:${updatedTicket._id}`;
    //   req.io.to(room).emit('message', {
    //     ticketId: updatedTicket._id.toString(),
    //     ...cleanReply
    //   });
    // }

    // ────────────────────────────────────────────────
    // 8. Response
    // ────────────────────────────────────────────────
    return res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      reply: serializeConversationEntry(cleanReply),
      emailReplyQueued,
      // optional: full updated ticket
      // ticket: updatedTicket
    });
  } catch (error) {
    console.error('Error adding reply:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error while adding reply',
    });
  }
});

module.exports = router;
