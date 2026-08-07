const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');
const { SessionLogStore } = require('./src/sessionLogStore');
const { SessionModel } = require('./src/mvc/session/sessionModel');
const { SessionController } = require('./src/mvc/session/sessionController');
const { registerSessionRoutes } = require('./src/mvc/session/sessionRoutes');
const { createSessionSocketController } = require('./src/mvc/session/sessionSocketController');
const { detectNetworkConnection } = require('./src/network');
const { getPublicSessionOrigin, getSessionOrigin } = require('./src/url');
const { getServerPort } = require('./src/serverConfig');

const app = express();
const logStore = new SessionLogStore();
const sessionManager = new SessionManager({ logStore, logger: console });
const sessionModel = new SessionModel({ sessionManager });

const allowedCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowNullOrigin = process.env.CORS_ALLOW_NULL_ORIGIN === 'true';

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
    if (!normalizedOrigin) {
      callback(null, true);
      return;
    }
    if (normalizedOrigin === 'null') {
      callback(null, allowNullOrigin);
      return;
    }
    callback(null, allowedCorsOrigins.includes(normalizedOrigin));
  },
  credentials: true,
};

const fallbackPort = getServerPort();
let server;
const sessionController = new SessionController({
  sessionModel,
  detectNetworkConnection,
  getPublicSessionOrigin,
  getSessionOrigin,
  toQrDataUrl: (value, options) => QRCode.toDataURL(value, options),
  resolveServerPort: () => {
    const address = server && typeof server.address === 'function' ? server.address() : null;
    return address && typeof address === 'object' && typeof address.port === 'number' ? address.port : fallbackPort;
  },
  publicOrigin: process.env.PUBLIC_ORIGIN || null,
});

app.set('trust proxy', true);
app.use(cors(corsOptions));
app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/join' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'frontend/dist')));

const distIndexPath = path.join(__dirname, 'frontend/dist/index.html');
const sendIndexOrServiceUnavailable = (req, res) => {
  if (fs.existsSync(distIndexPath)) {
    return res.sendFile(distIndexPath);
  }
  res.status(503).send('Frontend build not found. Run "npm run build" first.');
};

app.get('/', sendIndexOrServiceUnavailable);
app.get('/join', sendIndexOrServiceUnavailable);

registerSessionRoutes(app, sessionController);

server = app.listen(fallbackPort, () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : fallbackPort;
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}`);
});

server.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('HTTP server error', {
    message: error.message,
    code: error.code || null,
  });
});

const wss = new WebSocketServer({ server });
const socketController = createSessionSocketController({ sessionManager, logger: console });

wss.on('connection', socketController.createConnectionHandler());

const heartbeatInterval = socketController.createHeartbeatInterval(wss);
const timerInterval = socketController.createTimerInterval();
const worldInterval = socketController.createWorldInterval();

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(timerInterval);
  clearInterval(worldInterval);
});
