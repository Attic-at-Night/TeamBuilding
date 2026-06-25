const crypto = require('crypto');
const { MessageType, GameStatus, ClientRole, MazeRole } = require('./protocol');
const { generateMaze, movePlayer, findKeyAt, findLifeAt } = require('./maze');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const START_LIVES = 3;
const MAX_LIVES = 5;
const MAZE_WIDTH = 14;
const MAZE_HEIGHT = 14;
const HAZARD_COUNT = 12;
const KEY_COUNT = 3;
const LIFE_PICKUP_COUNT = 2;
const RECENT_EVENT_LIMIT = 10;

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
    roles: {},
    maze: null,
    log: [],
    summary: {
      startedAt: null,
      endedAt: null,
      durationMs: null,
      resets: 0,
      livesRemaining: START_LIVES,
      livesLost: 0,
      livesPickedUp: 0,
      keysCollected: 0,
      outcome: null,
    },
  };
}

function createRoundMaze() {
  return generateMaze(MAZE_WIDTH, MAZE_HEIGHT, HAZARD_COUNT, KEY_COUNT, LIFE_PICKUP_COUNT);
}

function appendLog(state, entry) {
  state.log.push(entry);
}

function clonePoint(point) {
  return point ? { row: point.row, col: point.col } : null;
}

function getRoleOrder(playerCount) {
  const roles = [MazeRole.MOVER, MazeRole.GUIDE];
  if (playerCount >= 3) {
    roles.push(MazeRole.KEY_SEER);
  }
  if (playerCount >= 4) {
    roles.push(MazeRole.LIFE_KEEPER);
  }
  return roles;
}

function getRoleForPlayer(state, playerId) {
  return state.roles[playerId] || null;
}

function getRecentEventsForRole(state, role) {
  const relevantEvents = state.log.filter((entry) => {
    if (role === MazeRole.LIFE_KEEPER) {
      return ['hazard_hit', 'life_change', 'life_pickup', 'reset', 'game_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.KEY_SEER) {
      return ['key_pickup', 'reset', 'game_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.GUIDE) {
      return ['hazard_hit', 'reset', 'life_change', 'life_pickup', 'game_end', 'game_start'].includes(entry.event);
    }
    return ['move', 'key_pickup', 'life_pickup', 'hazard_hit', 'reset', 'goal_locked', 'game_end', 'game_start'].includes(entry.event);
  });

  return relevantEvents.slice(-RECENT_EVENT_LIMIT);
}

function buildMazeForMover(maze) {
  if (!maze) {
    return null;
  }

  return {
    width: maze.width,
    height: maze.height,
    cells: maze.cells,
    goal: maze.goal,
    playerPos: maze.playerPos,
    reached: maze.reached,
    lifePickups: maze.lifePickups,
  };
}

function buildRoleData(state, role) {
  const maze = state.maze;

  if (role === MazeRole.MOVER) {
    return {
      maze: buildMazeForMover(maze),
      recentEvents: getRecentEventsForRole(state, role),
    };
  }

  if (role === MazeRole.GUIDE) {
    return {
      hazards: maze ? maze.hazards : [],
      goal: maze ? maze.goal : null,
      playerPos: maze ? maze.playerPos : null,
      recentEvents: getRecentEventsForRole(state, role),
    };
  }

  if (role === MazeRole.KEY_SEER) {
    return {
      keys: maze ? maze.keys.map((key) => ({
        id: key.id,
        row: key.row,
        col: key.col,
        collected: key.collected,
      })) : [],
      playerPos: maze ? maze.playerPos : null,
      recentEvents: getRecentEventsForRole(state, role),
    };
  }

  if (role === MazeRole.LIFE_KEEPER) {
    return {
      livesRemaining: state.summary.livesRemaining,
      playerPos: maze ? maze.playerPos : null,
      hazardLog: state.log.filter((entry) => entry.event === 'hazard_hit'),
      recentEvents: getRecentEventsForRole(state, role),
    };
  }

  return {
    recentEvents: getRecentEventsForRole(state, role),
  };
}

function buildDisplayState(state) {
  return {
    status: state.status,
    players: state.players,
    summary: state.summary,
    log: state.log,
    ready: state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
  };
}

function buildControllerState(state, playerId) {
  const role = getRoleForPlayer(state, playerId);
  return {
    status: state.status,
    players: state.players,
    summary: state.summary,
    viewerRole: role,
    roleData: buildRoleData(state, role),
    ready: state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
  };
}

function finishGame(state, outcome, reason) {
  if (state.status === GameStatus.ENDED) {
    return;
  }

  const endedAt = Date.now();
  state.status = GameStatus.ENDED;
  state.summary.endedAt = endedAt;
  state.summary.durationMs = state.summary.startedAt ? endedAt - state.summary.startedAt : null;
  state.summary.outcome = outcome;

  appendLog(state, {
    ts: endedAt,
    event: 'game_end',
    outcome,
    reason,
  });
}

function resetRound(state, reason) {
  const resetAt = Date.now();
  state.summary.resets += 1;
  state.summary.keysCollected = 0;
  state.maze = createRoundMaze();

  appendLog(state, {
    ts: resetAt,
    event: 'reset',
    reason,
    mazeSeed: state.maze.seed || null,
  });
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

    if (session.state.status !== GameStatus.LOBBY) {
      sendJson(socket, { type: MessageType.JOIN_ERROR, message: 'Game already started.' });
      return false;
    }

    if (session.controllers.size >= MAX_PLAYERS) {
      sendJson(socket, { type: MessageType.JOIN_ERROR, message: 'Session is full.' });
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
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      return false;
    }

    const roles = {};
    const roleOrder = getRoleOrder(players.length);
    players.forEach((player, index) => {
      roles[player.id] = roleOrder[index];
    });

    const now = Date.now();
    session.state.roles = roles;
    session.state.maze = createRoundMaze();
    session.state.log = [];
    session.state.summary = {
      startedAt: now,
      endedAt: null,
      durationMs: null,
      resets: 0,
      livesRemaining: START_LIVES,
      livesLost: 0,
      livesPickedUp: 0,
      keysCollected: 0,
      outcome: null,
    };
    session.state.status = GameStatus.PLAYING;

    appendLog(session.state, {
      ts: now,
      event: 'game_start',
      players: players.map((player) => ({ id: player.id, name: player.name })),
      roles: Object.entries(roles).map(([playerId, role]) => ({ playerId, role })),
    });

    this.broadcastState(sessionId);
    return true;
  }

  handleInput(sessionId, playerId, input) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.controllers.has(playerId)) {
      return false;
    }

    const { state } = session;
    const controller = session.controllers.get(playerId);
    const role = getRoleForPlayer(state, playerId);
    const ts = Date.now();

    appendLog(state, {
      ts,
      event: 'input',
      playerId,
      player: controller.name,
      role,
      action: input?.action || null,
      dir: input?.dir || null,
    });

    if (state.status !== GameStatus.PLAYING) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'not_playing',
      });
      this.broadcastState(sessionId);
      return false;
    }

    if (role !== MazeRole.MOVER) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'wrong_role',
      });
      this.broadcastState(sessionId);
      return false;
    }

    if (!input || input.action !== 'move' || !['n', 'e', 's', 'w'].includes(input.dir)) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'invalid_input',
      });
      this.broadcastState(sessionId);
      return false;
    }

    const maze = state.maze;
    if (!maze || maze.reached) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'round_inactive',
      });
      this.broadcastState(sessionId);
      return false;
    }

    const moveResult = movePlayer(maze, input.dir);
    appendLog(state, {
      ts,
      event: 'move',
      playerId,
      player: controller.name,
      dir: input.dir,
      result: moveResult.result,
      from: moveResult.from || null,
      to: moveResult.to || null,
    });

    if (moveResult.result === 'wall' || moveResult.result === 'invalid') {
      this.broadcastState(sessionId);
      return true;
    }

    const position = clonePoint(maze.playerPos);
    const key = position ? findKeyAt(maze, position.row, position.col) : null;

    if (key) {
      key.collected = true;
      state.summary.keysCollected += 1;
      appendLog(state, {
        ts,
        event: 'key_pickup',
        playerId,
        keyId: key.id,
        position,
        keysCollected: state.summary.keysCollected,
      });
    }

    const lifePickup = position ? findLifeAt(maze, position.row, position.col) : null;
    if (lifePickup) {
      lifePickup.collected = true;
      const beforeLives = state.summary.livesRemaining;
      state.summary.livesRemaining = Math.min(MAX_LIVES, state.summary.livesRemaining + 1);
      state.summary.livesPickedUp += 1;
      appendLog(state, {
        ts,
        event: 'life_pickup',
        playerId,
        pickupId: lifePickup.id,
        position,
        livesBefore: beforeLives,
        livesAfter: state.summary.livesRemaining,
      });
      appendLog(state, {
        ts,
        event: 'life_change',
        livesRemaining: state.summary.livesRemaining,
      });
    }

    const hitHazard = position
      ? maze.hazards.some((hazard) => hazard.row === position.row && hazard.col === position.col)
      : false;

    if (hitHazard) {
      state.summary.livesRemaining -= 1;
      state.summary.livesLost += 1;
      maze.hitHazards += 1;

      appendLog(state, {
        ts,
        event: 'hazard_hit',
        playerId,
        player: controller.name,
        direction: input.dir,
        position,
        livesRemaining: state.summary.livesRemaining,
      });

      appendLog(state, {
        ts,
        event: 'life_change',
        livesRemaining: state.summary.livesRemaining,
      });

      if (state.summary.livesRemaining <= 0) {
        finishGame(state, 'fail', 'lives_exhausted');
      } else {
        resetRound(state, 'hazard_hit');
      }

      this.broadcastState(sessionId);
      return true;
    }

    if (maze.reached) {
      if (state.summary.keysCollected >= KEY_COUNT) {
        finishGame(state, 'success', 'goal_reached');
      } else {
        maze.reached = false;
        appendLog(state, {
          ts,
          event: 'goal_locked',
          playerId,
          player: controller.name,
          keysCollected: state.summary.keysCollected,
        });
      }
    }

    this.broadcastState(sessionId);
    return true;
  }

  resync(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const meta = socket.meta || {};
    const state = this._buildStateForSocket(session, meta);
    sendJson(socket, { type: MessageType.STATE_SYNC, state });
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

    if (session.display) {
      sendJson(session.display, {
        type: MessageType.STATE_SYNC,
        state: this._buildStateForSocket(session, session.display.meta || {}),
      });
    }

    for (const controller of session.controllers.values()) {
      sendJson(controller.socket, {
        type: MessageType.STATE_SYNC,
        state: this._buildStateForSocket(session, controller.socket.meta || {}),
      });
    }
  }

  _buildStateForSocket(session, meta) {
    const { state } = session;

    if (meta.role === ClientRole.DISPLAY) {
      return buildDisplayState(state);
    }

    if (meta.role === ClientRole.CONTROLLER) {
      return buildControllerState(state, meta.playerId);
    }

    return buildDisplayState(state);
  }

  _getPlayers(session) {
    return [...session.controllers.values()].map(({ id, name }) => ({ id, name }));
  }
}

module.exports = {
  SessionManager,
};
