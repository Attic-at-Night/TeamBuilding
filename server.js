const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');
const { SessionLogStore } = require('./src/sessionLogStore');
const { detectNetworkConnection } = require('./src/network');
const { getJoinRedirectLocation, getPublicSessionOrigin, getSessionOrigin } = require('./src/url');
const { MessageType, ClientRole, ErrorCode } = require('./src/protocol');
const { normalizeIncomingMessage, encodeServerMessage } = require('./src/networking/messageEnvelope');
const { HEARTBEAT_INTERVAL_MS, DISCONNECT_GRACE_MS } = require('./src/networking/heartbeat');

const app = express();
const logStore = new SessionLogStore();
const sessionManager = new SessionManager({ logStore });

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

app.get('/api/session/:sessionId/log', (req, res) => {
  const sessionId = String(req.params.sessionId || '').toUpperCase();
  const sessionLog = sessionManager.getSessionExport(sessionId);
  if (!sessionLog) {
    res.status(404).json({ error: 'Session log not found.' });
    return;
  }
  res.json(sessionLog);
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
    sessionManager.joinController(message.sessionId, {
      name: message.name,
      reconnectToken: message.reconnectToken,
      requestedTrainer: message.requestedTrainer,
    }, socket);
  },

  [MessageType.GAME_START](_message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.startGame(meta.sessionId);
    }
  },

  [MessageType.GAME_RESTART](_message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.restartGame(meta.sessionId);
    }
  },

  [MessageType.TIMER_START](message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.startTimer(meta.sessionId, message.durationMs);
    }
  },

  [MessageType.TIMER_STOP](_message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.stopTimer(meta.sessionId);
    }
  },

  [MessageType.TIMER_RESET](message, socket) {
    const meta = socket.meta;
    if (meta?.role === ClientRole.DISPLAY) {
      sessionManager.resetTimer(meta.sessionId, message.durationMs);
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
  socket.isAlive = true;

  const sendJoinError = (message, code) => {
    socket.send(JSON.stringify(encodeServerMessage({
      type: MessageType.JOIN_ERROR,
      message,
      code,
    })));
  };

  socket.on('message', (rawMessage) => {
    socket.isAlive = true;
    sessionManager.cancelDisconnectGrace(socket);

    let parsedMessage;
    try {
      parsedMessage = JSON.parse(String(rawMessage));
    } catch {
      sendJoinError('Invalid message format.', ErrorCode.INVALID_MESSAGE_FORMAT);
      return;
    }

    const message = normalizeIncomingMessage(parsedMessage);
    if (!message) {
      sendJoinError('Invalid message format.', ErrorCode.INVALID_MESSAGE_FORMAT);
      return;
    }

    const handler = handlers[message.type];
    if (handler) {
      handler(message, socket);
      return;
    }

    sendJoinError('Unknown message type.', ErrorCode.UNKNOWN_MESSAGE_TYPE);
  });

  socket.on('pong', () => {
    socket.isAlive = true;
    sessionManager.cancelDisconnectGrace(socket);
  });

  socket.on('close', () => {
    sessionManager.beginDisconnectGrace(socket, 'socket_closed', DISCONNECT_GRACE_MS);
  });
});

const heartbeatInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      sessionManager.beginDisconnectGrace(socket, 'heartbeat_timeout', DISCONNECT_GRACE_MS);
      try {
        socket.terminate();
      } catch {
        // Ignore terminate failures on already-closed sockets.
      }
      continue;
    }

    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
      sessionManager.beginDisconnectGrace(socket, 'ping_failed', DISCONNECT_GRACE_MS);
    }
  }
}, HEARTBEAT_INTERVAL_MS);

const timerInterval = setInterval(() => {
  sessionManager.tickTimers();
}, 1000);

const worldInterval = setInterval(() => {
  sessionManager.tickWorld();
}, 1000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(timerInterval);
  clearInterval(worldInterval);
});
