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
    nextEventId: 1,
    trainer: null,
    trainerBroadcast: null,
    trainerHighlightEventIds: [],
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
  const logEntry = { ...entry };
  if (!logEntry.eventId) {
    logEntry.eventId = `evt-${state.nextEventId}`;
    state.nextEventId += 1;
  }
  if (typeof logEntry.ts !== 'number') {
    logEntry.ts = Date.now();
  }

  if (state.summary.startedAt) {
    const deltaSeconds = Math.max(0, (logEntry.ts - state.summary.startedAt) / 1000);
    logEntry.t = Number(deltaSeconds.toFixed(3));
  } else if (logEntry.event === 'game_start') {
    logEntry.t = 0;
  }

  state.log.push(logEntry);
  return logEntry;
}

function isHighlightedEvent(state, eventId) {
  return state.trainerHighlightEventIds.includes(eventId);
}

function toggleHighlightedEvent(state, eventId) {
  if (!eventId) {
    return false;
  }
  const existingIndex = state.trainerHighlightEventIds.indexOf(eventId);
  if (existingIndex >= 0) {
    state.trainerHighlightEventIds.splice(existingIndex, 1);
    return false;
  }
  state.trainerHighlightEventIds.push(eventId);
  return true;
}

function clonePoint(point) {
  return point ? { row: point.row, col: point.col } : null;
}

function pointToArray(point) {
  return point ? [point.row, point.col] : null;
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
      return ['hazard_hit', 'life_change', 'life_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.KEY_SEER) {
      return ['key_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.GUIDE) {
      return ['hazard_hit', 'reset', 'life_change', 'life_pickup', 'session_end', 'game_start'].includes(entry.event);
    }
    return ['move', 'key_pickup', 'life_pickup', 'hazard_hit', 'reset', 'goal_locked', 'session_end', 'game_start'].includes(entry.event);
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
        key: key.key,
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
      lifePickups: maze ? maze.lifePickups.map((pickup) => ({
        row: pickup.row,
        col: pickup.col,
        collected: pickup.collected,
      })) : [],
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
    trainerBroadcast: state.trainerBroadcast,
    ready: state.players.length >= MIN_PLAYERS,
    canRestart: state.status === GameStatus.ENDED && state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
  };
}

function buildTrainerCombinedMaze(maze) {
  if (!maze) {
    return null;
  }
  return {
    width: maze.width,
    height: maze.height,
    cells: maze.cells,
    hazards: maze.hazards,
    keys: maze.keys,
    lifePickups: maze.lifePickups,
    goal: maze.goal,
    playerPos: maze.playerPos,
    reached: maze.reached,
  };
}

function buildTrainerEvents(state) {
  return state.log.map((entry) => ({
    eventId: entry.eventId,
    ts: entry.ts,
    t: entry.t,
    event: entry.event,
    player: entry.player || null,
    dir: entry.dir || null,
    outcome: entry.outcome || null,
    reason: entry.reason || null,
    result: entry.result || null,
    position: entry.position || null,
    highlighted: isHighlightedEvent(state, entry.eventId),
  }));
}

function buildTrainerState(state) {
  const trainerMaze = buildTrainerCombinedMaze(state.maze);
  const trainerEvents = buildTrainerEvents(state);
  return {
    status: state.status,
    players: state.players,
    summary: state.summary,
    log: state.log,
    maze: state.maze,
    trainerMaze,
    trainerEvents,
    trainerHighlightEventIds: state.trainerHighlightEventIds,
    roleData: {
      trainerMaze,
      trainerEvents,
      trainerHighlightEventIds: state.trainerHighlightEventIds,
    },
    trainer: state.trainer,
    trainerBroadcast: state.trainerBroadcast,
    viewerRole: 'trainer',
    canBroadcast: true,
    ready: state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
  };
}

function buildControllerState(state, playerId) {
  const role = getRoleForPlayer(state, playerId);
  const { livesRemaining, ...controllerSummary } = state.summary;
  return {
    status: state.status,
    players: state.players,
    summary: controllerSummary,
    viewerRole: role,
    roleData: buildRoleData(state, role),
    trainerBroadcast: state.trainerBroadcast,
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
    event: 'session_end',
    outcome,
    reason,
    keys: state.summary.keysCollected,
    lives: state.summary.livesRemaining,
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

function beginGameState(session, startedAt) {
  const players = session.controllers.size ? [...session.controllers.values()] : [];
  const activePlayers = players.filter((player) => !player.isTrainer);
  const roles = {};
  const roleOrder = getRoleOrder(activePlayers.length);

  activePlayers.forEach((player, index) => {
    roles[player.id] = roleOrder[index];
  });

  session.state.roles = roles;
  session.state.maze = createRoundMaze();
  session.state.log = [];
  session.state.nextEventId = 1;
  session.state.trainerBroadcast = null;
  session.state.trainerHighlightEventIds = [];
  session.state.summary = {
    startedAt,
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
    ts: startedAt,
    event: 'game_start',
    players: activePlayers.map((player) => ({ id: player.id, name: player.name })),
    roles: Object.entries(roles).map(([playerId, role]) => ({ playerId, role })),
    trainer: session.state.trainer,
  });
}

function cloneJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.logStore = options.logStore || null;
  }

  createSession(origin) {
    let sessionId = makeSessionId();
    while (this.sessions.has(sessionId)) {
      sessionId = makeSessionId();
    }

    const joinUrl = `${origin}/join?session=${sessionId}`;
    this.sessions.set(sessionId, {
      display: null,
      trainerId: null,
      controllers: new Map(),
      state: makeInitialState(),
    });

    this._persistSession(sessionId);
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

    const isTrainer = session.trainerId === null;
    if (!isTrainer && this._getGameplayControllers(session).length >= MAX_PLAYERS) {
      sendJson(socket, { type: MessageType.JOIN_ERROR, message: 'Session is full.' });
      return false;
    }

    const playerId = crypto.randomUUID();
    const playerName = String(name || 'Player').trim() || 'Player';
    const player = {
      id: playerId,
      name: playerName,
      isTrainer,
    };

    session.controllers.set(playerId, { socket, ...player });
    if (isTrainer) {
      session.trainerId = playerId;
      session.state.trainer = { id: playerId, name: playerName };
    }

    socket.meta = { role: ClientRole.CONTROLLER, sessionId, playerId, isTrainer };

    sendJson(socket, {
      type: MessageType.CLIENT_REGISTERED,
      role: ClientRole.CONTROLLER,
      sessionId,
      playerId,
      isTrainer,
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

    const now = Date.now();
    beginGameState(session, now);

    this.broadcastState(sessionId);
    return true;
  }

  restartGame(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.state.status !== GameStatus.ENDED) {
      return false;
    }

    const players = this._getPlayers(session);
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      return false;
    }

    beginGameState(session, Date.now());
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
    const isTrainer = controller.isTrainer;
    const role = getRoleForPlayer(state, playerId);
    const ts = Date.now();

    appendLog(state, {
      ts,
      event: 'input',
      playerId,
      player: controller.name,
      role: isTrainer ? 'trainer' : role,
      action: input?.action || null,
      dir: input?.dir || null,
    });

    if (isTrainer && input?.action === 'trainer_toggle_highlight') {
      const highlighted = toggleHighlightedEvent(state, input.eventId);
      appendLog(state, {
        ts,
        event: 'trainer_highlight_toggle',
        playerId,
        trainerName: controller.name,
        targetEventId: input.eventId || null,
        highlighted,
      });
      this.broadcastState(sessionId);
      return true;
    }

    if (isTrainer && input?.action === 'trainer_share_highlights') {
      const highlights = state.log
        .filter((entry) => isHighlightedEvent(state, entry.eventId))
        .map((entry) => ({
          eventId: entry.eventId,
          event: entry.event,
          ts: entry.ts,
          t: entry.t,
          player: entry.player || null,
          dir: entry.dir || null,
          outcome: entry.outcome || null,
          reason: entry.reason || null,
          result: entry.result || null,
          position: entry.position || null,
        }));

      const payload = {
        type: 'highlight_set',
        session_id: sessionId,
        highlight_count: highlights.length,
        highlights,
      };
      state.trainerBroadcast = {
        ts,
        trainerId: playerId,
        trainerName: controller.name,
        payload,
      };

      appendLog(state, {
        ts,
        event: 'trainer_highlights_shared',
        playerId,
        trainerName: controller.name,
        highlightCount: highlights.length,
      });
      this.broadcastState(sessionId);
      return true;
    }

    if (isTrainer && input?.action === 'trainer_share_log') {
      const payload = this._buildSessionExport(sessionId, state);
      const sharedEventCount = Array.isArray(payload.events) ? payload.events.length : 0;

      state.trainerBroadcast = {
        ts,
        trainerId: playerId,
        trainerName: controller.name,
        payload,
      };

      appendLog(state, {
        ts,
        event: 'trainer_broadcast',
        playerId,
        trainerName: controller.name,
        payloadType: 'session_export',
        sharedEventCount,
      });

      this.broadcastState(sessionId);
      return true;
    }

    if (isTrainer && input?.action === 'trainer_broadcast') {
      const payload = cloneJsonValue(input.payload);
      if (!payload || typeof payload !== 'object') {
        appendLog(state, {
          ts,
          event: 'input_rejected',
          playerId,
          reason: 'invalid_trainer_payload',
        });
        this.broadcastState(sessionId);
        return false;
      }

      state.trainerBroadcast = {
        ts,
        trainerId: playerId,
        trainerName: controller.name,
        payload,
      };

      appendLog(state, {
        ts,
        event: 'trainer_broadcast',
        playerId,
        trainerName: controller.name,
        payload,
      });

      this.broadcastState(sessionId);
      return true;
    }

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

    if (isTrainer) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'trainer_observer',
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
        key: key.key || null,
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
        delta: state.summary.livesRemaining - beforeLives,
        lives: state.summary.livesRemaining,
      });
    }

    const hitHazard = position
      ? maze.hazards.some((hazard) => hazard.row === position.row && hazard.col === position.col)
      : false;

    if (hitHazard) {
      const beforeLives = state.summary.livesRemaining;
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
        delta: state.summary.livesRemaining - beforeLives,
        lives: state.summary.livesRemaining,
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
      if (session.state.status === GameStatus.PLAYING) {
        finishGame(session.state, 'aborted', 'display_disconnected');
      }
      this._persistSession(meta.sessionId);

      for (const controller of session.controllers.values()) {
        sendJson(controller.socket, { type: MessageType.SESSION_CLOSED });
      }
      this.sessions.delete(meta.sessionId);
      return;
    }

    if (meta.role === ClientRole.CONTROLLER) {
      session.controllers.delete(meta.playerId);
      if (meta.playerId === session.trainerId) {
        session.trainerId = null;
        session.state.trainer = null;
      }
      session.state.players = this._getPlayers(session);
      this.broadcastState(meta.sessionId);
    }
  }

  broadcastState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this._persistSession(sessionId);

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

  getSessionExport(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      return this._buildSessionExport(sessionId, session.state);
    }
    if (!this.logStore) {
      return null;
    }
    return this.logStore.load(sessionId);
  }

  _buildStateForSocket(session, meta) {
    const { state } = session;

    if (meta.role === ClientRole.DISPLAY) {
      return buildDisplayState(state);
    }

    if (meta.role === ClientRole.CONTROLLER) {
      if (meta.playerId === session.trainerId || meta.isTrainer) {
        return buildTrainerState(state);
      }
      return buildControllerState(state, meta.playerId);
    }

    return buildDisplayState(state);
  }

  _getGameplayControllers(session) {
    return [...session.controllers.values()].filter((controller) => !controller.isTrainer);
  }

  _getPlayers(session) {
    return this._getGameplayControllers(session).map(({ id, name }) => ({ id, name }));
  }

  _buildSessionExport(sessionId, state) {
    const summary = state.summary || {};
    return {
      session_id: sessionId,
      started_at: summary.startedAt,
      ended_at: summary.endedAt,
      outcome: summary.outcome,
      trainer: state.trainer,
      highlighted_event_ids: state.trainerHighlightEventIds,
      events: state.log.map((entry) => this._mapLogEntryForExport(entry, summary, state.trainerHighlightEventIds)),
    };
  }

  _mapLogEntryForExport(entry, summary, highlightedEventIds = []) {
    const eventType = entry.event === 'game_end' ? 'session_end' : entry.event;
    const exported = {
      id: entry.eventId || null,
      t: typeof entry.t === 'number'
        ? entry.t
        : (summary.startedAt && typeof entry.ts === 'number'
          ? Number(Math.max(0, (entry.ts - summary.startedAt) / 1000).toFixed(3))
          : null),
      type: eventType,
    };

    if (eventType === 'move') {
      exported.dir = entry.dir || null;
      if (entry.from) {
        exported.from = pointToArray(entry.from);
      }
      if (entry.to) {
        exported.to = pointToArray(entry.to);
      }
    } else if (eventType === 'key_pickup') {
      exported.key = entry.key || null;
    } else if (eventType === 'life_change') {
      exported.delta = typeof entry.delta === 'number' ? entry.delta : null;
      exported.lives = typeof entry.lives === 'number'
        ? entry.lives
        : (typeof entry.livesRemaining === 'number' ? entry.livesRemaining : null);
    } else if (eventType === 'session_end') {
      exported.outcome = entry.outcome || null;
      exported.keys = typeof entry.keys === 'number'
        ? entry.keys
        : (typeof entry.keysCollected === 'number' ? entry.keysCollected : null);
      exported.lives = typeof entry.lives === 'number'
        ? entry.lives
        : (typeof entry.livesRemaining === 'number' ? entry.livesRemaining : null);
    }

    exported.highlighted = highlightedEventIds.includes(entry.eventId);

    return exported;
  }

  _persistSession(sessionId) {
    if (!this.logStore) {
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.logStore.save(sessionId, this._buildSessionExport(sessionId, session.state));
  }
}

module.exports = {
  SessionManager,
};
