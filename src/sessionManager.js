const crypto = require('crypto');
const { MessageType, GameStatus, ClientRole, MazeRole, ErrorCode } = require('./protocol');
const { generateMaze, movePlayer, moveGhosts, findKeyAt, findLifeAt, findGhostAt } = require('./maze');
const { getRoleOrder, shufflePlayers } = require('./roles/roleAssignments');
const { createSummaryState, createTimerState } = require('./gameplay/stateSchema');
const { encodeServerMessage } = require('./networking/messageEnvelope');
const { isClarityEventType } = require('./trainer/clarityEvents');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const START_LIVES = 3;
const MAX_LIVES = 5;
const MAZE_WIDTH = 14;
const MAZE_HEIGHT = 14;
const HAZARD_COUNT = 12;
const KEY_COUNT = 3;
const LIFE_PICKUP_COUNT = 0;
const RECENT_EVENT_LIMIT = 10;
const DEFAULT_TIMER_DURATION_MS = 5 * 60 * 1000;
const RESET_FEEDBACK_MS = 5000;

function makeSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function sendJson(socket, payload) {
  if (!socket || typeof socket.send !== 'function') {
    return;
  }

  try {
    socket.send(JSON.stringify(encodeServerMessage(payload)));
  } catch {
    // Ignore errors from closed/disconnected sockets.
  }
}

function sendJoinError(socket, message, code) {
  sendJson(socket, { type: MessageType.JOIN_ERROR, message, code });
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
    aiSuggestionDecisions: {},
    summary: createSummaryState(START_LIVES),
    timer: createTimerState(),
    pendingReset: null,
  };
}

function createRoundMaze() {
  return generateMaze(MAZE_WIDTH, MAZE_HEIGHT, HAZARD_COUNT, KEY_COUNT, LIFE_PICKUP_COUNT);
}

function buildEventSnapshot(state) {
  return cloneJsonValue({
    players: state.players,
    roles: state.roles,
    summary: state.summary,
    timer: state.timer,
    mazeMeta: buildMazeMeta(state.maze),
    maze: state.maze ? {
      seed: state.maze.seed || null,
      width: state.maze.width,
      height: state.maze.height,
      cells: state.maze.cells,
      hazards: state.maze.hazards,
      ghosts: state.maze.ghosts,
      keys: state.maze.keys,
      lifePickups: state.maze.lifePickups,
      goal: state.maze.goal,
      playerPos: state.maze.playerPos,
      reached: state.maze.reached,
    } : null,
  });
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

  if (logEntry.captureSnapshot !== false) {
    logEntry.snapshot = buildEventSnapshot(state);
  }

  delete logEntry.captureSnapshot;

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

function getRoleForPlayer(state, playerId) {
  const assigned = state.roles[playerId];
  if (Array.isArray(assigned)) {
    return assigned.filter((role) => typeof role === 'string' && role.length > 0);
  }
  if (typeof assigned === 'string' && assigned.length > 0) {
    return [assigned];
  }
  return [];
}

function getPrimaryRole(roles) {
  const ordered = [MazeRole.MOVER, MazeRole.GUIDE, MazeRole.KEY_SEER, MazeRole.NAVIGATOR];
  return ordered.find((role) => roles.includes(role)) || null;
}

function getRecentEventsForRole(state, role) {
  const relevantEvents = state.log.filter((entry) => {
    if (role === MazeRole.NAVIGATOR) {
      return ['move', 'hazard_hit', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.KEY_SEER) {
      return ['key_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.GUIDE) {
      return ['hazard_hit', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    return ['move', 'hazard_hit', 'reset', 'goal_locked', 'session_end', 'game_start'].includes(entry.event);
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
    playerPos: maze.playerPos,
    reached: maze.reached,
  };
}

function buildRoleData(state, role) {
  const roles = Array.isArray(role) ? role : (role ? [role] : []);
  const maze = state.maze;
  const byEventId = new Map();
  for (const assignedRole of roles) {
    for (const event of getRecentEventsForRole(state, assignedRole)) {
      const key = event.eventId || `${event.ts || 0}:${event.event || 'event'}`;
      byEventId.set(key, event);
    }
  }

  const recentEvents = [...byEventId.values()]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .slice(-RECENT_EVENT_LIMIT);

  const roleData = {
    assignedRoles: roles,
    recentEvents,
  };

  if (roles.includes(MazeRole.MOVER)) {
    roleData.maze = buildMazeForMover(maze);
  }

  if (roles.includes(MazeRole.GUIDE)) {
    roleData.hazards = maze ? maze.hazards : [];
    roleData.ghosts = maze ? maze.ghosts : [];
    roleData.playerPos = maze ? maze.playerPos : null;
  }

  if (roles.includes(MazeRole.KEY_SEER)) {
    roleData.keys = maze ? maze.keys.map((key) => ({
      id: key.id,
      row: key.row,
      col: key.col,
      key: key.key,
      collected: key.collected,
    })) : [];
    if (!roleData.playerPos) {
      roleData.playerPos = maze ? maze.playerPos : null;
    }
  }

  if (roles.includes(MazeRole.NAVIGATOR)) {
    roleData.maze = maze ? {
      width: maze.width,
      height: maze.height,
      cells: maze.cells,
      playerPos: maze.playerPos,
      reached: maze.reached,
    } : null;
    roleData.hazardLog = state.log.filter((entry) => entry.event === 'hazard_hit');
    if (!roleData.playerPos) {
      roleData.playerPos = maze ? maze.playerPos : null;
    }
  }

  return roleData;
}

function buildDisplayState(state, session) {
  return {
    status: state.status,
    players: state.players,
    summary: state.summary,
    timer: state.timer,
    mazeMeta: buildMazeMeta(state.maze),
    log: state.log,
    trainerBroadcast: state.trainerBroadcast,
    displayConnected: Boolean(session && session.display),
    trainerConnected: Boolean(session && session.trainerId && session.controllers.has(session.trainerId)),
    ready: state.players.length >= MIN_PLAYERS,
    canRestart: state.status === GameStatus.ENDED && state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
    pendingReset: state.pendingReset || null,
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
    ghosts: maze.ghosts,
    keys: maze.keys,
    lifePickups: maze.lifePickups,
    goal: maze.goal,
    playerPos: maze.playerPos,
    reached: maze.reached,
  };
}

function buildMazeMeta(maze) {
  if (!maze) {
    return null;
  }
  return {
    seed: maze.seed || null,
    width: maze.width,
    height: maze.height,
    hazardCount: Array.isArray(maze.hazards) ? maze.hazards.length : 0,
    ghostCount: Array.isArray(maze.ghosts) ? maze.ghosts.length : 0,
    keyCount: Array.isArray(maze.keys) ? maze.keys.length : 0,
    layoutVariant: maze.layoutVariant || 'default',
    hardMode: Boolean(maze.hardMode),
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
    hazardType: entry.hazardType || null,
    clarityType: entry.clarityType || null,
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
    remainingMs: typeof entry.remainingMs === 'number' ? entry.remainingMs : null,
    snapshot: entry.snapshot || null,
    highlighted: isHighlightedEvent(state, entry.eventId),
  }));
}

function buildObserverSignals(state) {
  return state.log
    .filter((entry) => {
      return [
        'input',
        'hazard_hit',
        'reset',
        'ghost_move',
        'ghost_collision',
        'timer_start',
        'timer_stop',
        'timer_reset',
        'timer_expired',
        'clarity_event',
      ].includes(entry.event);
    })
    .map((entry) => ({
      eventId: entry.eventId,
      ts: entry.ts,
      t: entry.t,
      category: entry.event.startsWith('timer_')
        ? 'timer'
        : (entry.event === 'clarity_event'
          ? 'clarity'
          : (entry.event === 'hazard_hit' || entry.event === 'reset' || entry.event === 'ghost_move' || entry.event === 'ghost_collision'
            ? 'state'
            : 'input')),
      type: entry.event,
      playerId: entry.playerId || null,
      player: entry.player || null,
      role: entry.role || null,
      result: entry.result || null,
      reason: entry.reason || null,
      hazardType: entry.hazardType || null,
      clarityType: entry.clarityType || null,
      durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : null,
      remainingMs: typeof entry.remainingMs === 'number' ? entry.remainingMs : null,
    }));
}

function buildReplaySnippet(state, eventId, windowSeconds = 5) {
  const anchor = state.log.find((entry) => entry.eventId === eventId);
  if (!anchor) {
    return null;
  }

  const anchorTime = typeof anchor.t === 'number' ? anchor.t : 0;
  const replayEvents = state.log.filter((entry) => {
    const eventTime = typeof entry.t === 'number' ? entry.t : anchorTime;
    return Math.abs(eventTime - anchorTime) <= windowSeconds;
  }).map((entry) => ({
    eventId: entry.eventId,
    event: entry.event,
    t: entry.t,
    ts: entry.ts,
    player: entry.player || null,
    dir: entry.dir || null,
    result: entry.result || null,
    hazardType: entry.hazardType || null,
    clarityType: entry.clarityType || null,
    position: entry.position || null,
    snapshot: entry.snapshot || null,
  }));

  return {
    type: 'replay_snippet',
    eventId: anchor.eventId,
    event: anchor.event,
    t: anchor.t,
    windowSeconds,
    replayEvents,
    startSnapshot: replayEvents[0] ? replayEvents[0].snapshot : null,
    focusSnapshot: anchor.snapshot || null,
    endSnapshot: replayEvents.length ? replayEvents[replayEvents.length - 1].snapshot : null,
  };
}

function buildAiSuggestions(state) {
  const observerSignals = buildObserverSignals(state);
  const suggestions = [];
  const decisions = state.aiSuggestionDecisions || {};

  const wallHazards = observerSignals.filter((entry) => entry.type === 'hazard_hit' && entry.hazardType === 'wall');
  if (wallHazards.length >= 2) {
    suggestions.push({
      id: 'suggestion-wall-hazards',
      type: 'repeated_failed_instruction',
      summary: 'Repeated wall hazard resets suggest unclear navigation instructions.',
    });
  }

  const timerExpired = observerSignals.find((entry) => entry.type === 'timer_expired');
  if (timerExpired) {
    suggestions.push({
      id: 'suggestion-timer-expired',
      type: 'silence_during_critical_moment',
      summary: 'Timer expiry may indicate silence or stalled coordination during a critical moment.',
    });
  }

  const roleUnclear = observerSignals.find((entry) => entry.type === 'clarity_event' && entry.clarityType === 'role_unclear');
  if (roleUnclear) {
    suggestions.push({
      id: 'suggestion-role-confusion',
      type: 'role_confusion_pattern',
      summary: 'Trainer-marked role confusion suggests players were unclear on responsibilities.',
    });
  }

  const silentConfusion = observerSignals.find((entry) => entry.type === 'clarity_event' && entry.clarityType === 'silent_confusion');
  if (silentConfusion) {
    suggestions.push({
      id: 'suggestion-silent-confusion',
      type: 'silent_confusion_pattern',
      summary: 'Silent confusion marker suggests players hesitated without communicating clearly.',
    });
  }

  const resetSignals = observerSignals.filter((entry) => entry.type === 'reset');
  if (resetSignals.length >= 2) {
    suggestions.push({
      id: 'suggestion-high-reset-load',
      type: 'high_communication_load',
      summary: 'Multiple resets in one session suggest communication load spiked around navigation.',
    });
  }

  return suggestions.map((suggestion) => ({
    ...suggestion,
    status: decisions[suggestion.id] || 'pending',
  }));
}

function buildTrainerState(state, session) {
  const trainerMaze = buildTrainerCombinedMaze(state.maze);
  const trainerEvents = buildTrainerEvents(state);
  const observerSignals = buildObserverSignals(state);
  const aiSuggestions = buildAiSuggestions(state);
  const mazeMeta = buildMazeMeta(state.maze);
  return {
    status: state.status,
    players: state.players,
    summary: state.summary,
    timer: state.timer,
    log: state.log,
    maze: state.maze,
    mazeMeta,
    trainerMaze,
    trainerEvents,
    observerSignals,
    aiSuggestions,
    trainerHighlightEventIds: state.trainerHighlightEventIds,
    roleData: {
      trainerMaze,
      trainerEvents,
      observerSignals,
      aiSuggestions,
      mazeMeta,
      trainerHighlightEventIds: state.trainerHighlightEventIds,
    },
    trainer: state.trainer,
    trainerBroadcast: state.trainerBroadcast,
    displayConnected: Boolean(session && session.display),
    viewerRole: 'trainer',
    canBroadcast: true,
    ready: state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
  };
}

function buildControllerState(state, session, playerId) {
  const roles = getRoleForPlayer(state, playerId);
  const role = getPrimaryRole(roles);
  const { livesRemaining, ...controllerSummary } = state.summary;
  const mazeMeta = buildMazeMeta(state.maze);
  return {
    status: state.status,
    players: state.players,
    summary: controllerSummary,
    timer: state.timer,
    mazeMeta,
    displayConnected: Boolean(session && session.display),
    viewerRole: role,
    roleData: buildRoleData(state, roles),
    trainerBroadcast: state.trainerBroadcast,
    ready: state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
    pendingReset: state.pendingReset || null,
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

function createRoundMazeForState(state) {
  const resets = state.summary && typeof state.summary.resets === 'number' ? state.summary.resets : 0;
  const hardMode = resets >= 2;
  const loopFraction = hardMode ? 0.15 : (resets % 2 === 1 ? 0.28 : 0.42);
  const ghostCount = hardMode ? 1 : 0;
  const hazardCount = hardMode ? HAZARD_COUNT + 2 : HAZARD_COUNT;
  const layoutVariant = hardMode ? 'hard-mode' : (resets % 2 === 1 ? 'tight-corners' : 'open-loops');

  return generateMaze(
    MAZE_WIDTH,
    MAZE_HEIGHT,
    hazardCount,
    KEY_COUNT,
    LIFE_PICKUP_COUNT,
    { loopFraction, ghostCount, layoutVariant, hardMode }
  );
}

function resetRound(state, reason, metadata = {}) {
  const resetAt = Date.now();
  state.summary.resets += 1;
  state.summary.keysCollected = 0;
  state.maze = createRoundMazeForState(state);

  appendLog(state, {
    ts: resetAt,
    event: 'reset',
    reason,
    hazardType: metadata.hazardType || null,
    mazeSeed: state.maze.seed || null,
  });
}

function applyHazardOutcome(state, controller, playerId, input, hazardType, position) {
  const ts = Date.now();
  const beforeLives = state.summary.livesRemaining;
  state.summary.livesRemaining -= 1;
  state.summary.livesLost += 1;
  if (state.maze) {
    state.maze.hitHazards += 1;
  }

  appendLog(state, {
    ts,
    event: 'hazard_hit',
    playerId,
    player: controller.name,
    direction: input?.dir || null,
    position,
    hazardType,
    livesRemaining: state.summary.livesRemaining,
  });

  appendLog(state, {
    ts,
    event: 'life_change',
    delta: state.summary.livesRemaining - beforeLives,
    lives: state.summary.livesRemaining,
  });

  if (state.summary.livesRemaining <= 0) {
    finishGame(state, 'fail', `${hazardType}_hazard`);
    return false;
  }

  return true;
}

function applyGhostHazard(state, ghost) {
  appendLog(state, {
    ts: Date.now(),
    event: 'ghost_collision',
    hazardType: 'ghost',
    ghostId: ghost.id,
    position: { row: ghost.row, col: ghost.col },
  });
  return applyHazardOutcome(
    state,
    { name: 'Ghost' },
    'ghost',
    { dir: null },
    'ghost',
    { row: ghost.row, col: ghost.col }
  );
}

function beginGameState(session, startedAt) {
  const players = session.controllers.size ? [...session.controllers.values()] : [];
  const activePlayers = players.filter((player) => !player.isTrainer);
  const roles = {};
  const roleOrder = getRoleOrder(activePlayers.length);
  const randomizedPlayers = shufflePlayers(activePlayers);

  randomizedPlayers.forEach((player, index) => {
    roles[player.id] = roleOrder[index] || [];
  });

  session.state.roles = roles;
  session.state.maze = createRoundMazeForState(session.state);
  session.state.log = [];
  session.state.nextEventId = 1;
  session.state.trainerBroadcast = null;
  session.state.trainerHighlightEventIds = [];
  session.state.pendingReset = null;
  session.state.summary = {
    ...createSummaryState(START_LIVES),
    startedAt,
  };
  session.state.timer = createTimerState();
  session.state.status = GameStatus.PLAYING;

  appendLog(session.state, {
    ts: startedAt,
    event: 'game_start',
    players: activePlayers.map((player) => ({ id: player.id, name: player.name })),
    roles: Object.entries(roles).map(([playerId, role]) => ({
      playerId,
      roles: Array.isArray(role) ? role : [role],
    })),
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

function makeReconnectToken() {
  return crypto.randomUUID();
}

function normalizeTimerDuration(durationMs, fallbackDurationMs = DEFAULT_TIMER_DURATION_MS) {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.floor(durationMs);
  }
  return fallbackDurationMs;
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
      participants: new Map(),
      reconnectTokens: new Map(),
      state: makeInitialState(),
    });

    this._persistSession(sessionId);
    return { sessionId, joinUrl };
  }

  registerDisplay(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJoinError(socket, 'Session does not exist.', ErrorCode.SESSION_NOT_FOUND);
      return false;
    }

    const wasDisconnected = !session.display;
    session.display = socket;
    socket.meta = { role: ClientRole.DISPLAY, sessionId };

    if (wasDisconnected) {
      appendLog(session.state, {
        event: 'display_connected',
      });
    }

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
    if (!session) {
      sendJoinError(socket, 'Session is unavailable.', ErrorCode.SESSION_UNAVAILABLE);
      return false;
    }

    const reconnectToken = String(name && typeof name === 'object' ? name.reconnectToken || '' : '') || '';
    const requestedTrainer = Boolean(name && typeof name === 'object' && name.requestedTrainer);
    const playerNameInput = name && typeof name === 'object' ? name.name : name;

    if (reconnectToken) {
      const reconnected = this._reconnectController(sessionId, session, socket, reconnectToken);
      if (reconnected !== null) {
        return reconnected;
      }
    }

    if (!session.display) {
      sendJoinError(socket, 'Session is unavailable.', ErrorCode.SESSION_UNAVAILABLE);
      return false;
    }

    if (session.state.status !== GameStatus.LOBBY) {
      sendJoinError(socket, 'Game already started.', ErrorCode.GAME_ALREADY_STARTED);
      return false;
    }

    if (requestedTrainer && session.trainerId !== null) {
      sendJoinError(socket, 'Trainer role is already taken.', ErrorCode.TRAINER_ROLE_TAKEN);
      return false;
    }

    const isTrainer = requestedTrainer;
    if (!isTrainer && this._getGameplayControllers(session).length >= MAX_PLAYERS) {
      sendJoinError(socket, 'Session is full.', ErrorCode.SESSION_FULL);
      return false;
    }

    const playerId = crypto.randomUUID();
    const reconnectTokenForPlayer = makeReconnectToken();
    const playerName = String(playerNameInput || 'Player').trim() || 'Player';
    const participant = {
      id: playerId,
      name: playerName,
      isTrainer,
      reconnectToken: reconnectTokenForPlayer,
    };

    session.participants.set(playerId, participant);
    session.reconnectTokens.set(reconnectTokenForPlayer, playerId);
    session.controllers.set(playerId, { socket, ...participant });
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
      reconnectToken: reconnectTokenForPlayer,
      reconnected: false,
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

  startTimer(sessionId, durationMs) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    const timer = session.state.timer || createTimerState();
    const nextDurationMs = normalizeTimerDuration(durationMs, normalizeTimerDuration(timer.durationMs));
    const nextRemainingMs = timer.status === 'stopped' && typeof timer.remainingMs === 'number'
      ? timer.remainingMs
      : nextDurationMs;

    session.state.timer = createTimerState({
      status: 'running',
      durationMs: nextDurationMs,
      remainingMs: nextRemainingMs,
      startedAt: now,
      expiresAt: now + nextRemainingMs,
      stoppedAt: null,
    });
    appendLog(session.state, {
      ts: now,
      event: 'timer_start',
      durationMs: nextDurationMs,
      remainingMs: nextRemainingMs,
    });

    this.broadcastState(sessionId);
    return true;
  }

  stopTimer(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const timer = session.state.timer || createTimerState();
    if (timer.status !== 'running') {
      return false;
    }

    const now = Date.now();
    const remainingMs = Math.max(0, (timer.expiresAt || now) - now);
    session.state.timer = createTimerState({
      status: 'stopped',
      durationMs: normalizeTimerDuration(timer.durationMs),
      remainingMs,
      startedAt: timer.startedAt,
      expiresAt: null,
      stoppedAt: now,
    });
    appendLog(session.state, {
      ts: now,
      event: 'timer_stop',
      remainingMs,
    });

    this.broadcastState(sessionId);
    return true;
  }

  resetTimer(sessionId, durationMs) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const timer = session.state.timer || createTimerState();
    const nextDurationMs = normalizeTimerDuration(durationMs, normalizeTimerDuration(timer.durationMs));
    session.state.timer = createTimerState({
      status: 'idle',
      durationMs: nextDurationMs,
      remainingMs: nextDurationMs,
      startedAt: null,
      expiresAt: null,
      stoppedAt: null,
    });
    appendLog(session.state, {
      event: 'timer_reset',
      durationMs: nextDurationMs,
      remainingMs: nextDurationMs,
    });

    this.broadcastState(sessionId);
    return true;
  }

  tickTimers(now = Date.now()) {
    let changed = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const timer = session.state.timer;
      if (!timer || timer.status !== 'running' || typeof timer.expiresAt !== 'number') {
        continue;
      }

      const remainingMs = Math.max(0, timer.expiresAt - now);
      const didExpire = remainingMs === 0;
      if (timer.remainingMs === remainingMs && !didExpire) {
        continue;
      }

      session.state.timer = createTimerState({
        ...timer,
        status: didExpire ? 'expired' : 'running',
        remainingMs,
        expiresAt: didExpire ? null : timer.expiresAt,
        stoppedAt: didExpire ? now : null,
      });

      if (didExpire) {
        appendLog(session.state, {
          ts: now,
          event: 'timer_expired',
          durationMs: timer.durationMs,
        });
      }

      this.broadcastState(sessionId);
      changed += 1;
    }

    return changed;
  }

  tickWorld() {
    let changed = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const { state } = session;
      if (state.status !== GameStatus.PLAYING || !state.maze || state.pendingReset) {
        continue;
      }

      const ghostMoves = moveGhosts(state.maze);
      if (!ghostMoves.length) {
        continue;
      }

      appendLog(state, {
        event: 'ghost_move',
        ghostMoves,
      });

      const ghostAtPlayer = findGhostAt(state.maze, state.maze.playerPos.row, state.maze.playerPos.col);
      if (ghostAtPlayer) {
        const needsReset = applyGhostHazard(state, ghostAtPlayer);
        if (needsReset) {
          this._applyResetFeedback(sessionId, 'ghost', { row: ghostAtPlayer.row, col: ghostAtPlayer.col });
          changed += 1;
          continue;
        }
      }

      this.broadcastState(sessionId);
      changed += 1;
    }

    return changed;
  }

  handleInput(sessionId, playerId, input) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.controllers.has(playerId)) {
      return false;
    }

    const { state } = session;
    const controller = session.controllers.get(playerId);
    const isTrainer = controller.isTrainer;
    const roles = getRoleForPlayer(state, playerId);
    const role = getPrimaryRole(roles);
    const ts = Date.now();

    appendLog(state, {
      ts,
      event: 'input',
      playerId,
      player: controller.name,
      role: isTrainer ? 'trainer' : (roles.length ? roles.join('+') : null),
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

    if (isTrainer && input?.action === 'trainer_add_clarity_event') {
      if (!isClarityEventType(input.clarityType)) {
        appendLog(state, {
          ts,
          event: 'input_rejected',
          playerId,
          reason: 'invalid_clarity_type',
        });
        this.broadcastState(sessionId);
        return false;
      }

      appendLog(state, {
        ts,
        event: 'clarity_event',
        playerId,
        trainerName: controller.name,
        clarityType: input.clarityType,
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

    if (isTrainer && input?.action === 'trainer_share_replay') {
      const replay = buildReplaySnippet(state, input.eventId || null, 5);
      if (!replay) {
        appendLog(state, {
          ts,
          event: 'input_rejected',
          playerId,
          reason: 'invalid_replay_event',
        });
        this.broadcastState(sessionId);
        return false;
      }

      state.trainerBroadcast = {
        ts,
        trainerId: playerId,
        trainerName: controller.name,
        payload: replay,
      };

      appendLog(state, {
        ts,
        event: 'trainer_replay_shared',
        playerId,
        trainerName: controller.name,
        targetEventId: input.eventId,
      });
      this.broadcastState(sessionId);
      return true;
    }

    if (isTrainer && input?.action === 'trainer_review_suggestion') {
      const aiSuggestions = buildAiSuggestions(state);
      const suggestion = aiSuggestions.find((entry) => entry.id === input.suggestionId);
      if (!suggestion || !['approved', 'rejected'].includes(input.decision)) {
        appendLog(state, {
          ts,
          event: 'input_rejected',
          playerId,
          reason: 'invalid_suggestion_review',
        });
        this.broadcastState(sessionId);
        return false;
      }

      state.aiSuggestionDecisions[suggestion.id] = input.decision;
      appendLog(state, {
        ts,
        event: 'ai_suggestion_reviewed',
        playerId,
        trainerName: controller.name,
        suggestionId: suggestion.id,
        decision: input.decision,
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

    if (state.pendingReset && !isTrainer) {
      appendLog(state, {
        ts,
        event: 'input_rejected',
        playerId,
        reason: 'reset_pending',
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

    if (!roles.includes(MazeRole.MOVER)) {
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

    if (moveResult.result === 'invalid') {
      this.broadcastState(sessionId);
      return true;
    }

    if (moveResult.result === 'wall') {
      const wallPos = clonePoint(moveResult.from || maze.playerPos);
      const needsReset = applyHazardOutcome(state, controller, playerId, input, 'wall', wallPos);
      if (needsReset) {
        this._applyResetFeedback(sessionId, 'wall', wallPos);
      } else {
        this.broadcastState(sessionId);
      }
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
      const needsReset = applyHazardOutcome(state, controller, playerId, input, 'grid', position);
      if (needsReset) {
        this._applyResetFeedback(sessionId, 'grid', position);
      } else {
        this.broadcastState(sessionId);
      }
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

    this.cancelDisconnectGrace(socket);
    const meta = socket.meta || {};
    const state = this._buildStateForSocket(session, meta);
    sendJson(socket, { type: MessageType.STATE_SYNC, state });
    return true;
  }

  beginDisconnectGrace(socket, reason = 'socket_closed', delayMs = 0) {
    const meta = socket?.meta;
    if (!meta || socket._disconnectFinalized) {
      return false;
    }

    if (socket._disconnectTimer) {
      return true;
    }

    socket._disconnectReason = reason;
    socket._disconnectTimer = setTimeout(() => {
      socket._disconnectTimer = null;
      this._finalizeDisconnect(socket, socket._disconnectReason || reason);
    }, delayMs);

    return true;
  }

  cancelDisconnectGrace(socket) {
    if (!socket || !socket._disconnectTimer) {
      return false;
    }

    clearTimeout(socket._disconnectTimer);
    socket._disconnectTimer = null;
    socket._disconnectReason = null;
    return true;
  }

  removeConnection(socket) {
    this.cancelDisconnectGrace(socket);
    this._finalizeDisconnect(socket, 'immediate_disconnect');
  }

  _finalizeDisconnect(socket, reason = 'disconnect') {
    const meta = socket?.meta;
    if (!meta || socket._disconnectFinalized) {
      return;
    }
    socket._disconnectFinalized = true;

    const session = this.sessions.get(meta.sessionId);
    if (!session) {
      return;
    }

    if (meta.role === ClientRole.DISPLAY) {
      session.display = null;
      appendLog(session.state, {
        event: 'display_disconnected',
        reason,
      });
      this._persistSession(meta.sessionId);
      this.broadcastState(meta.sessionId);
      return;
    }

    if (meta.role === ClientRole.CONTROLLER) {
      session.controllers.delete(meta.playerId);

      if (session.state.status === GameStatus.LOBBY) {
        this._deleteParticipant(session, meta.playerId);
      }

      if (meta.playerId === session.trainerId && session.state.status === GameStatus.LOBBY) {
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

  _applyResetFeedback(sessionId, hazardType, position) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const message = hazardType === 'wall'
      ? 'You walked into a wall!'
      : hazardType === 'ghost'
        ? 'A ghost found you!'
        : 'You stepped on a hazard!';

    session.state.pendingReset = {
      cause: hazardType,
      hazardType,
      position: position || null,
      message,
      expiresAt: Date.now() + RESET_FEEDBACK_MS,
    };

    this.broadcastState(sessionId);

    setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s || !s.state.pendingReset) {
        return;
      }
      s.state.pendingReset = null;
      resetRound(s.state, 'hazard_hit', { hazardType });
      this.broadcastState(sessionId);
    }, RESET_FEEDBACK_MS);
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
      return buildDisplayState(state, session);
    }

    if (meta.role === ClientRole.CONTROLLER) {
      if (meta.playerId === session.trainerId || meta.isTrainer) {
        return buildTrainerState(state, session);
      }
      return buildControllerState(state, session, meta.playerId);
    }

    return buildDisplayState(state, session);
  }

  _getGameplayControllers(session) {
    return [...session.controllers.values()].filter((controller) => !controller.isTrainer);
  }

  _getGameplayParticipants(session) {
    return [...session.participants.values()].filter((participant) => !participant.isTrainer);
  }

  _getPlayers(session) {
    const source = session.state.status === GameStatus.LOBBY
      ? this._getGameplayControllers(session)
      : this._getGameplayParticipants(session);
    return source.map(({ id, name }) => ({ id, name }));
  }

  _deleteParticipant(session, playerId) {
    const participant = session.participants.get(playerId);
    if (!participant) {
      return;
    }

    session.participants.delete(playerId);
    if (participant.reconnectToken) {
      session.reconnectTokens.delete(participant.reconnectToken);
    }
  }

  _reconnectController(sessionId, session, socket, reconnectToken) {
    const existingPlayerId = session.reconnectTokens.get(reconnectToken);
    if (!existingPlayerId) {
      sendJoinError(socket, 'Reconnect token is invalid.', ErrorCode.INVALID_RECONNECT_TOKEN);
      return false;
    }

    const participant = session.participants.get(existingPlayerId);
    if (!participant || session.controllers.has(existingPlayerId)) {
      sendJoinError(socket, 'Reconnect slot is unavailable.', ErrorCode.RECONNECT_SLOT_UNAVAILABLE);
      return false;
    }

    session.controllers.set(existingPlayerId, { socket, ...participant });
    socket.meta = {
      role: ClientRole.CONTROLLER,
      sessionId,
      playerId: existingPlayerId,
      isTrainer: participant.isTrainer,
    };

    if (participant.isTrainer) {
      session.trainerId = existingPlayerId;
      session.state.trainer = { id: existingPlayerId, name: participant.name };
    }

    sendJson(socket, {
      type: MessageType.CLIENT_REGISTERED,
      role: ClientRole.CONTROLLER,
      sessionId,
      playerId: existingPlayerId,
      isTrainer: participant.isTrainer,
      reconnectToken,
      reconnected: true,
    });

    session.state.players = this._getPlayers(session);
    this.broadcastState(sessionId);
    return true;
  }

  _buildSessionExport(sessionId, state) {
    const summary = state.summary || {};
    return {
      session_id: sessionId,
      maze_seed: state.maze && state.maze.seed ? state.maze.seed : null,
      maze_meta: buildMazeMeta(state.maze),
      started_at: summary.startedAt,
      ended_at: summary.endedAt,
      outcome: summary.outcome,
      timer: state.timer || null,
      trainer: state.trainer,
      highlighted_event_ids: state.trainerHighlightEventIds,
      observer_signals: buildObserverSignals(state),
      ai_suggestions: buildAiSuggestions(state),
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
