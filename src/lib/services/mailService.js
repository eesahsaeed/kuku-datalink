const nodemailer = require('nodemailer');

const { networkTimeout, noreply, support } = require('../helper.js');

const DEFAULT_SMTP_HOST = 'smtp.larksuite.com';
const SMTP_TIMEOUT_MS = Math.max(Number(networkTimeout || 30000), 10000);

const normalizeEnvValue = (value = '') => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const parseBooleanEnv = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized) return fallback;

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseNumberEnv = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getMailboxAccount = (accountKey = 'noreply') => {
  if (accountKey === 'support') {
    return {
      key: 'support',
      email: normalizeEnvValue(support.email),
      password: normalizeEnvValue(support.password),
    };
  }

  return {
    key: 'noreply',
    email: normalizeEnvValue(noreply.email),
    password: normalizeEnvValue(noreply.password),
  };
};

const buildSmtpAttemptConfigs = () => {
  const primaryHost = normalizeEnvValue(process.env.SMTP_HOST) || DEFAULT_SMTP_HOST;
  const primaryPort = parseNumberEnv(process.env.SMTP_PORT, 465);
  const primarySecure = parseBooleanEnv(
    process.env.SMTP_SECURE,
    primaryPort === 465
  );
  const rejectUnauthorized = parseBooleanEnv(
    process.env.SMTP_TLS_REJECT_UNAUTHORIZED,
    true
  );

  const attempts = [
    {
      name: 'primary',
      host: primaryHost,
      port: primaryPort,
      secure: primarySecure,
      requireTLS: !primarySecure,
      rejectUnauthorized,
    },
  ];

  const fallbackEnabled = parseBooleanEnv(process.env.SMTP_ENABLE_FALLBACK, true);
  if (!fallbackEnabled) {
    return attempts;
  }

  const fallbackPort = parseNumberEnv(
    process.env.SMTP_FALLBACK_PORT,
    primarySecure ? 587 : 465
  );
  const fallbackSecure = parseBooleanEnv(
    process.env.SMTP_FALLBACK_SECURE,
    fallbackPort === 465
  );

  if (fallbackPort !== primaryPort || fallbackSecure !== primarySecure) {
    attempts.push({
      name: 'fallback',
      host: normalizeEnvValue(process.env.SMTP_FALLBACK_HOST) || primaryHost,
      port: fallbackPort,
      secure: fallbackSecure,
      requireTLS: !fallbackSecure,
      rejectUnauthorized,
    });
  }

  return attempts;
};

const buildTransporter = (account, attemptConfig) => {
  if (!account?.email || !account?.password) {
    const error = new Error(
      `Mail account "${account?.key || 'unknown'}" is not configured properly.`
    );
    error.code = 'MAIL_ACCOUNT_NOT_CONFIGURED';
    throw error;
  }

  return nodemailer.createTransport({
    host: attemptConfig.host,
    port: attemptConfig.port,
    secure: attemptConfig.secure,
    requireTLS: Boolean(attemptConfig.requireTLS),
    auth: {
      user: account.email,
      pass: account.password,
    },
    tls: {
      rejectUnauthorized: attemptConfig.rejectUnauthorized,
    },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
};

const closeTransporterQuietly = async (transporter) => {
  if (!transporter?.close) return;

  try {
    await Promise.resolve(transporter.close());
  } catch (_error) {
    // best effort cleanup
  }
};

const extractMailErrorMessage = (error) =>
  error?.response?.data ||
  error?.response ||
  error?.message ||
  String(error || 'Unknown mail error');

const getMailErrorCode = (error) =>
  String(error?.code || '').trim().toUpperCase();

const getMailErrorCommand = (error) =>
  String(error?.command || '').trim().toUpperCase();

const getMailErrorText = (error) =>
  String(extractMailErrorMessage(error) || '').trim().toLowerCase();

const CONNECTIVITY_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNECTION',
  'ESOCKET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

const isSmtpTimeoutError = (error) => {
  const errorCode = getMailErrorCode(error);
  const errorText = getMailErrorText(error);

  return (
    errorCode === 'ETIMEDOUT' ||
    errorText.includes('connection timeout') ||
    errorText.includes('timed out')
  );
};

const isSmtpConnectivityError = (error) => {
  const errorCode = getMailErrorCode(error);
  const errorCommand = getMailErrorCommand(error);
  const errorText = getMailErrorText(error);

  return (
    CONNECTIVITY_CODES.has(errorCode) ||
    errorCommand === 'CONN' ||
    errorText.includes('timed out') ||
    errorText.includes('connection timeout') ||
    errorText.includes('connection refused') ||
    errorText.includes('getaddrinfo') ||
    errorText.includes('could not connect') ||
    errorText.includes('greeting never received')
  );
};

const shouldRetryMailSend = (error) => {
  const errorCode = getMailErrorCode(error);

  if (errorCode === 'MAIL_ACCOUNT_NOT_CONFIGURED') {
    return false;
  }

  return isSmtpConnectivityError(error);
};

const attachMailAttemptMetadata = (error, meta = {}) => {
  if (!error || typeof error !== 'object') {
    return error;
  }

  error.mailAttempt = {
    ...(error.mailAttempt || {}),
    ...meta,
  };

  return error;
};

const sendMailWithAccount = async (
  accountKey,
  mailOptions = {},
  { label = 'mail' } = {}
) => {
  const account = getMailboxAccount(accountKey);
  const attempts = buildSmtpAttemptConfigs();
  let lastError = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attempt = attempts[attemptIndex];
    let transporter = null;

    try {
      transporter = buildTransporter(account, attempt);
      const result = await transporter.sendMail(mailOptions);

      if (attemptIndex > 0) {
        console.warn('[mailService] Mail recovered on fallback SMTP config.', {
          label,
          mailbox: account.key,
          host: attempt.host,
          port: attempt.port,
          secure: attempt.secure,
        });
      }

      return result;
    } catch (error) {
      attachMailAttemptMetadata(error, {
        label,
        mailbox: account.key,
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        attemptName: attempt.name,
      });

      console.error('[mailService] SMTP send attempt failed:', {
        label,
        mailbox: account.key,
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        attemptName: attempt.name,
        code: error?.code || null,
        command: error?.command || null,
        message: extractMailErrorMessage(error),
      });

      lastError = error;

      if (
        attemptIndex >= attempts.length - 1 ||
        !shouldRetryMailSend(error)
      ) {
        throw error;
      }
    } finally {
      await closeTransporterQuietly(transporter);
    }
  }

  throw lastError;
};

const sendNoReplyMail = (mailOptions = {}, options = {}) =>
  sendMailWithAccount('noreply', mailOptions, options);

const sendSupportMail = (mailOptions = {}, options = {}) =>
  sendMailWithAccount('support', mailOptions, options);

module.exports = {
  SMTP_TIMEOUT_MS,
  isSmtpTimeoutError,
  isSmtpConnectivityError,
  sendMailWithAccount,
  sendNoReplyMail,
  sendSupportMail,
};
