const path = require('path');
require('dotenv').config();

const DEFAULT_JWT_SECRET = 'kukudata-secret';
const ensureJwtSecret = () => {
  const configuredSecret = String(process.env.JWT_SECRET || '').trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  process.env.JWT_SECRET = DEFAULT_JWT_SECRET;
  console.warn('[Startup] JWT_SECRET is not configured. Using fallback secret.');
  return DEFAULT_JWT_SECRET;
};

const jwtSecret = ensureJwtSecret();

const express = require('express');
const { createServer } = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');

const authRouter = require('./lib/router/authentication/authRouter.js');
const purchaseRouter = require('./lib/router/purchase/purchaseRouter.js');
const nineMobileRouter = require('./lib/router/ninemobile/nineMobileRouter.js');
const walletRouter = require('./lib/router/wallet/walletRouter.js');
const conplainsRouter = require('./lib/router/complain/complainRouter.js');
const notificationRouter = require('./lib/router/notification/notificationRouter.js');
const masterWalletRouter = require('./lib/router/master-wallet/masterWalletRouter.js');
const adminRouter = require('./lib/router/admin/adminRouter.js');
const planRouter = require('./lib/router/plan/planRouter.js');
const numberRouter = require('./lib/router/number/numberRouter.js');

const { networkTimeout } = require('./lib/helper.js');
const { initSocketServer } = require('./lib/socket/initSocketServer');
const User = require('./lib/schema/UserSchema.js');
const {
  dispatchPushNotifications,
  isExpoPushToken,
} = require('./lib/services/notificationService.js');
const {
  setPurchaseAutoRequeryNotificationSource,
  startPurchaseAutoRequeryJobs,
} = require('./lib/services/purchaseAutoRequeryService.js');

const app = express();
const server = createServer(app);

const DEV_HEALTHCHECK_PUSH_COOLDOWN_MS = Math.max(
  Number(process.env.DEV_HEALTHCHECK_PUSH_COOLDOWN_MS) || 30000,
  0
);
let lastDevHealthcheckPushAt = 0;

function parseBooleanEnv(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isDevelopmentRuntime() {
  const normalizedEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  return ['development', 'dev', 'local'].includes(normalizedEnv);
}

function parsePushTokens(rawValue = '') {
  return String(rawValue || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((token) => isExpoPushToken(token));
}

function captureRawJsonBody(req, res, buffer) {
  if (buffer && buffer.length > 0) {
    req.rawBody = buffer.toString('utf8');
  }
}

async function resolveDevHealthcheckPushTokens(req) {
  const configuredTokens = [
    ...parsePushTokens(process.env.DEV_HEALTHCHECK_PUSH_TOKEN),
    ...parsePushTokens(process.env.DEV_HEALTHCHECK_PUSH_TOKENS),
  ];
  const requestHintTokens = [
    ...parsePushTokens(req?.body?.pushToken),
    ...parsePushTokens(req?.body?.expoPushToken),
    ...parsePushTokens(req?.query?.pushToken),
    ...parsePushTokens(req?.query?.expoPushToken),
    ...parsePushTokens(req?.headers?.['x-dev-push-token']),
    ...parsePushTokens(req?.headers?.['x-expo-push-token']),
  ];

  const emailHint = String(
    process.env.DEV_HEALTHCHECK_PUSH_EMAIL ||
      req?.body?.emailAddress ||
      req?.query?.emailAddress ||
      ''
  )
    .trim()
    .toLowerCase();

  let userTokens = [];
  if (emailHint && mongoose.connection.readyState === 1) {
    const user = await User.findOne({ emailAddress: emailHint })
      .select('mobilePushTokens')
      .lean();
    userTokens = (user?.mobilePushTokens || [])
      .map((entry) => String(entry?.token || '').trim())
      .filter((token) => isExpoPushToken(token));
  }

  return [...new Set([...configuredTokens, ...requestHintTokens, ...userTokens])];
}

async function triggerDevHealthcheckPush(req, source = 'healthz') {
  const isEnabled =
    parseBooleanEnv(process.env.DEV_HEALTHCHECK_PUSH_ENABLED, true) &&
    isDevelopmentRuntime();
  if (!isEnabled) {
    return { sent: false, reason: 'disabled' };
  }

  const now = Date.now();
  if (
    DEV_HEALTHCHECK_PUSH_COOLDOWN_MS > 0 &&
    now - lastDevHealthcheckPushAt < DEV_HEALTHCHECK_PUSH_COOLDOWN_MS
  ) {
    return { sent: false, reason: 'cooldown' };
  }

  const tokens = await resolveDevHealthcheckPushTokens(req);
  if (!tokens.length) {
    return { sent: false, reason: 'no_tokens' };
  }

  await dispatchPushNotifications(tokens, {
    title: 'Kuku Health Check (Dev)',
    message: `${source} is healthy on ${new Date().toLocaleString('en-NG')}`,
    data: {
      type: 'health_check_dev_test',
      source,
      timestamp: new Date().toISOString(),
    },
  });

  lastDevHealthcheckPushAt = now;
  return { sent: true, tokenCount: tokens.length };
}

function logDevHealthcheckPushResult(source, result) {
  if (!result) return;
  if (result.sent) {
    console.log(
      `[healthcheck][dev-push] Sent test push from ${source} to ${result.tokenCount} device(s).`
    );
    return;
  }

  if (result.reason === 'disabled' || result.reason === 'cooldown') return;

  if (result.reason === 'no_tokens') {
    console.log(
      '[healthcheck][dev-push] No test tokens found. Set DEV_HEALTHCHECK_PUSH_TOKEN(S) or DEV_HEALTHCHECK_PUSH_EMAIL.'
    );
    return;
  }

  console.log(`[healthcheck][dev-push] Skipped from ${source}: ${result.reason}`);
}

app.set('trust proxy', true);
initSocketServer({ server, app, jwtSecret });
if (typeof conplainsRouter.setIo === 'function') {
  conplainsRouter.setIo(app.get('io'));
}
setPurchaseAutoRequeryNotificationSource({ app });

app.use(
  '/api/wallet/webhook/paystack',
  express.raw({ type: 'application/json' })
);
app.use(express.json({ verify: captureRawJsonBody }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use('/api/complains', conplainsRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/authentication', authRouter);
app.use('/api/purchase', purchaseRouter);
app.use('/api/9mobile', nineMobileRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/master-wallet', masterWalletRouter);
app.use('/api/admin', adminRouter);
app.use('/api/plan', planRouter);
app.use('/api/number', numberRouter);

app.use('/api/rewards', (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Rewards feature has been removed.',
  });
});

app.post('/api/flag', (req, res) => {
  console.log('Health check received: ', req.body);
  void triggerDevHealthcheckPush(req, 'api/flag')
    .then((result) => {
      logDevHealthcheckPushResult('api/flag', result);
    })
    .catch((error) => {
      console.error('[healthcheck][dev-push] api/flag failed:', error.message);
    });

  res.status(200).json({ message: 'Server is alive' });
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    dbState: mongoose.connection.readyState,
  });
});

app.get('/readyz', (_req, res) => {
  const isDbReady = mongoose.connection.readyState === 1;
  res.status(isDbReady ? 200 : 503).json({
    status: isDbReady ? 'ready' : 'not-ready',
    dbState: mongoose.connection.readyState,
  });
});

app.use(express.static(path.join(__dirname, '..', 'dist', 'app')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'app', 'index.html'));
});

cron.schedule('*/10 * * * *', async () => {
  try {
    await axios.get(`https://kuku-ahjz.onrender.com/api/flag`, {
      timeout: networkTimeout,
    });
  } catch (err) {
    console.log('cron ping failed:', err.message);
  }
});

const configuredMongoUri = String(process.env.MONGO_URI || '').trim();
const MONGO_URI =
  configuredMongoUri ||
  (process.env.NODE_ENV === 'development'
    ? 'mongodb://127.0.0.1:27017/kukudata'
    : '');
const PORT =
  Number(process.env.PORT) ||
  (process.env.NODE_ENV === 'development' ? 3001 : 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_RETRY_DELAY_MS = Number(process.env.DB_RETRY_DELAY_MS) || 10000;
let hasStartedBackgroundJobs = false;
let isDbConnectInProgress = false;

const startBackgroundJobs = () => {
  if (hasStartedBackgroundJobs) return;
  hasStartedBackgroundJobs = true;

  if (typeof conplainsRouter.startListeningUnseenEmails === 'function') {
    void Promise.resolve(
      conplainsRouter.startListeningUnseenEmails()
    ).catch((error) => {
      console.error('[Startup] IMAP listener failed to start:', error.message);
    });
  }
  if (typeof conplainsRouter.processPendingReplyDigests === 'function') {
    cron.schedule(
      '* * * * *',
      () => {
        void conplainsRouter.processPendingReplyDigests('cron');
      },
      { timezone: 'Africa/Lagos' }
    );
  }

  startPurchaseAutoRequeryJobs();
};

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error(
      '[Startup] MONGO_URI is not configured. Running without database connectivity.'
    );
    return false;
  }

  if (isDbConnectInProgress) {
    return false;
  }

  isDbConnectInProgress = true;
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB Connected');
    startBackgroundJobs();
    return true;
  } catch (err) {
    console.error('MongoDB Error:', err.message);
    return false;
  } finally {
    isDbConnectInProgress = false;
  }
};

const connectDBWithRetry = async () => {
  const connected = await connectDB();
  if (connected) return;

  console.log(`[Startup] Retrying MongoDB connection in ${DB_RETRY_DELAY_MS}ms`);
  setTimeout(() => {
    void connectDBWithRetry();
  }, DB_RETRY_DELAY_MS);
};

console.log('[Startup] Runtime config', {
  nodeEnv: process.env.NODE_ENV || 'undefined',
  host: HOST,
  port: PORT,
  hasMongoUri: Boolean(configuredMongoUri),
  hasJwtSecret: Boolean(String(process.env.JWT_SECRET || '').trim()),
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error('[Startup] HTTP server error:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Startup] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Startup] Uncaught exception:', error);
});

void connectDBWithRetry();
