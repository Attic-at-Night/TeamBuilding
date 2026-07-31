const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');
const { SessionLogStore } = require('./src/sessionLogStore');
const { SessionModel } = require('./src/mvc/session/sessionModel');
const { SessionController } = require('./src/mvc/session/sessionController');
const { registerSessionRoutes } = require('./src/mvc/session/sessionRoutes');
const { createSessionSocketController } = require('./src/mvc/session/sessionSocketController');
const { detectNetworkConnection } = require('./src/network');
const { getJoinRedirectLocation, getPublicSessionOrigin, getSessionOrigin } = require('./src/url');

const app = express();
const logStore = new SessionLogStore();
const sessionManager = new SessionManager({ logStore, logger: console });
const sessionModel = new SessionModel({ sessionManager });
let server;
const sessionController = new SessionController({
  sessionModel,
  detectNetworkConnection,
  getPublicSessionOrigin,
  getSessionOrigin,
  toQrDataUrl: (value, options) => QRCode.toDataURL(value, options),
  resolveServerPort: () => {
    const address = server && typeof server.address === 'function' ? server.address() : null;
    return address && typeof address === 'object' && address.port ? address.port : Number(process.env.PORT || 3000);
  },
  publicOrigin: process.env.PUBLIC_ORIGIN || null,
});

app.set('trust proxy', true);
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join', (req, res) => {
  const distJoinPath = path.join(__dirname, 'frontend/dist/index.html');
  if (fs.existsSync(distJoinPath)) {
    return res.sendFile(distJoinPath);
  }
  res.redirect(302, getJoinRedirectLocation(req.originalUrl));
});

registerSessionRoutes(app, sessionController);

server = app.listen(process.env.PORT || 3000, () => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : process.env.PORT || 3000;
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
