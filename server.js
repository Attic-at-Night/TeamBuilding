const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');
const { detectNetworkConnection } = require('./src/network');
const { getJoinRedirectLocation } = require('./src/url');

const app = express();
const sessionManager = new SessionManager();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join', (req, res) => {
  res.redirect(302, getJoinRedirectLocation(req.originalUrl));
});

app.post('/api/session', async (req, res) => {
  const port = server.address().port;
  const connection = await detectNetworkConnection();
  const host = connection?.ipAddress || req.hostname;
  const origin = `${req.protocol}://${host}:${port}`;
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

wss.on('connection', (socket) => {
  socket.on('message', (rawMessage) => {
    let message;
    try {
      message = JSON.parse(String(rawMessage));
    } catch {
      socket.send(JSON.stringify({ type: 'join_error', message: 'Invalid message format.' }));
      return;
    }

    if (message.type === 'host_register') {
      sessionManager.registerHost(message.sessionId, socket);
      return;
    }

    if (message.type === 'participant_join') {
      sessionManager.joinParticipant(message.sessionId, message.name, socket);
      return;
    }

    socket.send(JSON.stringify({ type: 'join_error', message: 'Unknown message type.' }));
  });

  socket.on('close', () => {
    sessionManager.removeConnection(socket);
  });
});
