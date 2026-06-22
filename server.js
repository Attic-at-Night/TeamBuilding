const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');
const { detectNetworkConnection } = require('./src/network');
const { getJoinRedirectLocation, getPublicSessionOrigin, getSessionOrigin } = require('./src/url');
const { MessageType, ClientRole } = require('./src/protocol');

const app = express();
const sessionManager = new SessionManager();

app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join', (req, res) => {
  res.redirect(302, getJoinRedirectLocation(req.originalUrl));
});

app.post('/api/session', async (req, res) => {
  const port = server.address().port;
  const requestHost = req.get('host');
  const requestHostname = req.hostname;
  const publicOrigin = getPublicSessionOrigin({
    publicOrigin: process.env.PUBLIC_ORIGIN,
    requestProtocol: req.protocol,
    requestHost,
    requestHostname,
  });
  const connection = publicOrigin ? null : await detectNetworkConnection();
  const origin = getSessionOrigin({
    publicOrigin: process.env.PUBLIC_ORIGIN,
    requestProtocol: req.protocol,
    requestHost,
    requestHostname,
    port,
    localIpAddress: connection?.ipAddress,
  });
  const { sessionId, joinUrl } = sessionManager.createSession(origin);

  const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
    margin: 1,
    width: 320,
  });

  res.json({ sessionId, joinUrl, qrCodeDataUrl, connection });
});

const server = app.listen(process.env.PORT || 3000, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${server.address().port}`);
});

const wss = new WebSocketServer({ server });

const handlers = {
  [MessageType.DISPLAY_REGISTER](message, socket) {
    sessionManager.registerDisplay(message.sessionId, socket);
  },

  [MessageType.CONTROLLER_JOIN](message, socket) {
    sessionManager.joinController(message.sessionId, message.name, socket);
  },

  [MessageType.GAME_START](_message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.startGame(meta.sessionId);
    }
  },

  [MessageType.PLAYER_INPUT](message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.CONTROLLER) {
      sessionManager.handleInput(meta.sessionId, meta.playerId, message.input);
    }
  },

  [MessageType.RESYNC_REQUEST](_message, socket) {
    const meta = socket.meta;
    if (meta?.sessionId) {
      sessionManager.resync(meta.sessionId, socket);
    }
  },
};

wss.on('connection', (socket) => {
  socket.on('message', (rawMessage) => {
    let message;
    try {
      message = JSON.parse(String(rawMessage));
    } catch {
      socket.send(JSON.stringify({ type: MessageType.JOIN_ERROR, message: 'Invalid message format.' }));
      return;
    }

    const handler = handlers[message.type];
    if (handler) {
      handler(message, socket);
      return;
    }

    socket.send(JSON.stringify({ type: MessageType.JOIN_ERROR, message: 'Unknown message type.' }));
  });

  socket.on('close', () => {
    sessionManager.removeConnection(socket);
  });
});
