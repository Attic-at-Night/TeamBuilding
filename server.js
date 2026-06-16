const os = require('os');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { SessionManager } = require('./src/sessionManager');

function getLocalIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

const app = express();
const sessionManager = new SessionManager();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join', (_req, res) => {
  res.redirect(302, '/join.html');
});

app.post('/api/session', async (req, res) => {
  const port = server.address().port;
  const host = getLocalIp() || req.hostname;
  const origin = `${req.protocol}://${host}:${port}`;
  const { sessionId, joinUrl } = sessionManager.createSession(origin);

  const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
    margin: 1,
    width: 320,
  });

  res.json({ sessionId, joinUrl, qrCodeDataUrl });
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
