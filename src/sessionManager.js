const crypto = require('crypto');
const { MessageType, GameStatus, ClientRole } = require('./protocol');

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

function makeInitialState() {
  return {
    status: GameStatus.LOBBY,
    players: [],
  };
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
      display: null,
      controllers: new Map(),
      state: makeInitialState(),
    });

    return { sessionId, joinUrl };
  }

  registerDisplay(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJson(socket, { type: MessageType.JOIN_ERROR, message: 'Session does not exist.' });
      return false;
    }

    session.display = socket;
    socket.meta = { role: ClientRole.DISPLAY, sessionId };

    sendJson(socket, {
      type: MessageType.CLIENT_REGISTERED,
      role: ClientRole.DISPLAY,
      sessionId,
    });

    this.broadcastState(sessionId);
    return true;
  }

  joinController(sessionId, name, socket) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.display) {
      sendJson(socket, { type: MessageType.JOIN_ERROR, message: 'Session is unavailable.' });
      return false;
    }

    const playerId = crypto.randomUUID();
    const player = {
      id: playerId,
      name: String(name || 'Player').trim() || 'Player',
    };

    session.controllers.set(playerId, { socket, ...player });
    socket.meta = { role: ClientRole.CONTROLLER, sessionId, playerId };

    sendJson(socket, {
      type: MessageType.CLIENT_REGISTERED,
      role: ClientRole.CONTROLLER,
      sessionId,
      playerId,
    });

    session.state.players = this._getPlayers(session);
    this.broadcastState(sessionId);
    return true;
  }

  startGame(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.state.status = GameStatus.PLAYING;
    this.broadcastState(sessionId);
    return true;
  }

  handleInput(sessionId, playerId, input) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.controllers.has(playerId)) {
      return false;
    }

    // Forward validated input to the display for game-specific handling.
    // Future minigame modules can intercept here to update server-side state.
    sendJson(session.display, {
      type: MessageType.PLAYER_INPUT,
      playerId,
      input,
    });
    return true;
  }

  resync(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    sendJson(socket, { type: MessageType.STATE_SYNC, state: session.state });
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

    if (meta.role === ClientRole.DISPLAY) {
      for (const controller of session.controllers.values()) {
        sendJson(controller.socket, { type: MessageType.SESSION_CLOSED });
      }
      this.sessions.delete(meta.sessionId);
      return;
    }

    if (meta.role === ClientRole.CONTROLLER) {
      session.controllers.delete(meta.playerId);
      session.state.players = this._getPlayers(session);
      this.broadcastState(meta.sessionId);
    }
  }

  broadcastState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const payload = { type: MessageType.STATE_SYNC, state: session.state };
    sendJson(session.display, payload);
    for (const controller of session.controllers.values()) {
      sendJson(controller.socket, payload);
    }
  }

  _getPlayers(session) {
    return [...session.controllers.values()].map(({ id, name }) => ({ id, name }));
  }
}

module.exports = {
  SessionManager,
};
