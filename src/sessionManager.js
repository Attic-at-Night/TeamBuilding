const crypto = require('crypto');
const { MessageType, GameStatus, ClientRole, MazeRole } = require('./protocol');
const { generateMaze, movePlayer } = require('./maze');

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
    // Maze-game fields (populated when game starts):
    roles: {},    // { [playerId]: 'mover' | 'guide' }
    maze: null,   // maze sub-state (see src/maze.js)
    log: [],      // event log for debrief
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

    const players = this._getPlayers(session);

    // Assign roles: first player to join becomes the mover, all others are guides.
    const roles = {};
    players.forEach((p, i) => {
      roles[p.id] = i === 0 ? MazeRole.MOVER : MazeRole.GUIDE;
    });

    session.state.roles = roles;
    session.state.maze = generateMaze(7, 7, 4);
    session.state.log = [{ ts: Date.now(), event: 'game_start' }];
    session.state.status = GameStatus.PLAYING;
    this.broadcastState(sessionId);
    return true;
  }

  handleInput(sessionId, playerId, input) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.controllers.has(playerId)) {
      return false;
    }

    const { state } = session;

    // Only process maze moves while the game is active.
    if (state.status !== GameStatus.PLAYING) return false;

    // Only the mover role can send movement inputs.
    if (state.roles[playerId] !== MazeRole.MOVER) return false;

    // Validate input shape: { action: 'move', dir: 'n'|'e'|'s'|'w' }
    if (input.action !== 'move' || !['n', 'e', 's', 'w'].includes(input.dir)) return false;

    const maze = state.maze;
    if (!maze || maze.reached) return false;

    const controller = session.controllers.get(playerId);
    const moveResult = movePlayer(maze, input.dir);

    state.log.push({
      ts: Date.now(),
      event: 'move',
      player: controller.name,
      dir: input.dir,
      ...moveResult,
    });

    if (moveResult.result === 'goal') {
      state.status = GameStatus.ENDED;
      state.log.push({ ts: Date.now(), event: 'game_end', player: controller.name });
    }

    this.broadcastState(sessionId);
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
