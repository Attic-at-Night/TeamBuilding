const crypto = require('crypto');

function makeSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function sendJson(socket, payload) {
  if (!socket || typeof socket.send !== 'function') {
    return;
  }

  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Ignore errors from closed/disconnected sockets.
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(origin) {
    let sessionId = makeSessionId();
    while (this.sessions.has(sessionId)) {
      sessionId = makeSessionId();
    }

    const joinUrl = `${origin}/join?session=${sessionId}`;
    this.sessions.set(sessionId, {
      host: null,
      participants: new Map(),
    });

    return { sessionId, joinUrl };
  }

  registerHost(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJson(socket, { type: 'join_error', message: 'Session does not exist.' });
      return false;
    }

    session.host = socket;
    socket.meta = { role: 'host', sessionId };
    this.sendParticipantsUpdate(sessionId);
    return true;
  }

  joinParticipant(sessionId, name, socket) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.host) {
      sendJson(socket, { type: 'join_error', message: 'Session is unavailable.' });
      return false;
    }

    const participantId = crypto.randomUUID();
    const participant = {
      id: participantId,
      name: String(name || 'Player').trim() || 'Player',
    };

    session.participants.set(participantId, { socket, ...participant });
    socket.meta = { role: 'participant', sessionId, participantId };

    sendJson(socket, { type: 'joined', sessionId, participantId });
    this.sendParticipantsUpdate(sessionId);
    return true;
  }

  removeConnection(socket) {
    const meta = socket?.meta;
    if (!meta) {
      return;
    }

    const session = this.sessions.get(meta.sessionId);
    if (!session) {
      return;
    }

    if (meta.role === 'host') {
      for (const participant of session.participants.values()) {
        sendJson(participant.socket, { type: 'session_closed' });
      }
      this.sessions.delete(meta.sessionId);
      return;
    }

    if (meta.role === 'participant') {
      session.participants.delete(meta.participantId);
      this.sendParticipantsUpdate(meta.sessionId);
    }
  }

  sendParticipantsUpdate(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.host) {
      return;
    }

    const participants = [...session.participants.values()].map(({ id, name }) => ({ id, name }));
    sendJson(session.host, { type: 'participants_update', participants });
  }
}

module.exports = {
  SessionManager,
};
