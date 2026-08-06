const crypto = require('crypto');
const { MessageType, GameStatus, GameMode, ClientRole, MazeRole, ErrorCode } = require('./protocol');
const { movePlayer, moveGhosts, findKeyAt, findLifeAt, findGhostAt } = require('./maze');
const { getRoleOrder, shufflePlayers } = require('./roles/roleAssignments');
const { createSummaryState, createTimerState } = require('./gameplay/stateSchema');
const { createPhaseFlowState, makeInitialState, createRoundMaze } = require('./gameplay/sessionStateFactory');
const { normalizeRoleArray, buildCycledRoles, rebalanceRoles } = require('./gameplay/roleBalancing');
const { makeSessionId, makeReconnectToken } = require('./session/sessionIdentity');
const { gameplaySettings } = require('./config/gameplaySettings');
const { encodeServerMessage } = require('./networking/messageEnvelope');
const { isClarityEventType } = require('./trainer/clarityEvents');

const MAX_PLAYERS = gameplaySettings.players.max;
const MIN_PLAYERS = gameplaySettings.players.min;
const START_LIVES = gameplaySettings.lives.start;
const MAX_LIVES = gameplaySettings.lives.max;
const HAZARD_COUNT = gameplaySettings.maze.hazardCount;
const KEY_COUNT = gameplaySettings.maze.keyCount;
const RECENT_EVENT_LIMIT = gameplaySettings.events.recentLimit;
const DEFAULT_TIMER_DURATION_MS = gameplaySettings.timer.defaultDurationMs;
const GAMEPLAY_PHASE_DURATIONS_MS = gameplaySettings.timer.gameplayPhaseDurationsMs;
const RESET_FEEDBACK_MS = gameplaySettings.events.resetFeedbackMs;
const DEFAULT_ABANDONED_SESSION_TIMEOUT_MS = gameplaySettings.session.abandonedTimeoutMs;
const MOVEMENT_PAUSE_THRESHOLD_MS = 15 * 1000;
const DEFAULT_GAME_MODE = GameMode.COMMUNICATION_CLARITY;

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

function normalizeCleanupTimeoutMs(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_ABANDONED_SESSION_TIMEOUT_MS;
  }
  return Math.max(1000, Math.floor(value));
}

function normalizeGameMode(mode) {
  if (typeof mode !== 'string') {
    return null;
  }
  const trimmed = mode.trim();
  if (!trimmed) {
    return null;
  }
  const lookup = {
    [GameMode.COMMUNICATION_CLARITY.toLowerCase()]: GameMode.COMMUNICATION_CLARITY,
    [GameMode.COLLABORATION_TEAMWORK.toLowerCase()]: GameMode.COLLABORATION_TEAMWORK,
  };
  return lookup[trimmed.toLowerCase()] || null;
}

function getStateGameMode(state) {
  const normalized = normalizeGameMode(state && state.gameMode);
  return normalized || DEFAULT_GAME_MODE;
}

function cloneRoleAssignment(roleAssignment) {
  if (Array.isArray(roleAssignment)) {
    return roleAssignment.slice();
  }
  if (typeof roleAssignment === 'string' && roleAssignment.length > 0) {
    return roleAssignment;
  }
  return null;
}

function buildRoundRoles(activePlayers, previousRoles = {}, gameMode = DEFAULT_GAME_MODE, shouldCycleRoles = false) {
  if (shouldCycleRoles) {
    const roles = buildCycledRoles(activePlayers, previousRoles, gameMode);
    if (roles && Object.keys(roles).length) {
      return roles;
    }
  }

  if (shouldCycleRoles && gameMode === GameMode.COMMUNICATION_CLARITY) {
    const canPreserveRoles = activePlayers.length > 0
      && activePlayers.every((player) => {
        const previousAssignment = cloneRoleAssignment(previousRoles[player.id]);
        return Array.isArray(previousAssignment)
          ? previousAssignment.length > 0
          : typeof previousAssignment === 'string' && previousAssignment.length > 0;
      });
    if (canPreserveRoles) {
      const preservedRoles = {};
      for (const player of activePlayers) {
        const assigned = cloneRoleAssignment(previousRoles[player.id]);
        if (assigned) {
          preservedRoles[player.id] = assigned;
        }
      }
      return preservedRoles;
    }
  }

  const roleOrder = getRoleOrder(activePlayers.length);
  const randomizedPlayers = shufflePlayers(activePlayers);
  const roles = {};
  randomizedPlayers.forEach((player, index) => {
    roles[player.id] = roleOrder[index] || [];
  });
  return roles;
}

function buildEventSnapshot(state) {
  return cloneJsonValue({
    players: state.players,
    roles: state.roles,
    gameMode: getStateGameMode(state),
    summary: state.summary,
    timer: state.timer,
    phaseFlow: state.phaseFlow,
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
      return ['move', 'hazard_hit', 'key_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.KEY_SEER) {
      return ['key_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    if (role === MazeRole.GUIDE) {
      return ['hazard_hit', 'key_pickup', 'reset', 'session_end', 'game_start'].includes(entry.event);
    }
    return ['move', 'hazard_hit', 'key_pickup', 'reset', 'goal_locked', 'session_end', 'game_start'].includes(entry.event);
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
    if (!roleData.playerPos) {
      roleData.playerPos = maze ? maze.playerPos : null;
    }
  }

  if (roles.includes(MazeRole.GUIDE)) {
    roleData.hazards = maze ? maze.hazards : [];
    roleData.ghosts = maze ? maze.ghosts : [];
    if (!roleData.playerPos) {
      roleData.playerPos = maze ? maze.playerPos : null;
    }
    if (!roleData.maze && maze) {
      roleData.maze = {
        width: maze.width,
        height: maze.height,
        cells: maze.cells,
      };
    }
  }

  if (roles.includes(MazeRole.KEY_SEER)) {
    roleData.keys = maze ? maze.keys.map((key) => ({
      id: key.id,
      row: key.row,
      col: key.col,
      key: key.key,
      collected: key.collected,
    })) : [];
    roleData.goal = maze && state.summary.keysCollected >= KEY_COUNT ? maze.goal : null;
    if (!roleData.playerPos) {
      roleData.playerPos = maze ? maze.playerPos : null;
    }
    if (!roleData.maze && maze) {
      roleData.maze = {
        width: maze.width,
        height: maze.height,
        cells: maze.cells,
      };
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
  const trainerControllers = session
    ? [...session.controllers.values()].filter((controller) => controller.isTrainer)
    : [];
  const trainerConnected = trainerControllers.length > 0;
  const trainers = trainerControllers.map(({ id, name }) => ({ id, name }));
  return {
    status: state.status,
    players: state.players,
    gameMode: getStateGameMode(state),
    trainers,
    summary: state.summary,
    timer: state.timer,
    phaseFlow: state.phaseFlow,
    displayMaze: buildTrainerCombinedMaze(state.maze),
    mazeMeta: buildMazeMeta(state.maze),
    log: state.log,
    trainerBroadcast: state.trainerBroadcast,
    displayConnected: Boolean(session && session.display),
    trainerConnected,
    ready: state.players.length >= MIN_PLAYERS,
    canRestart: (state.status === GameStatus.ENDED || state.status === GameStatus.SESSION_OVERVIEW) && state.players.length >= MIN_PLAYERS,
    capacity: MAX_PLAYERS,
    pendingReset: state.pendingReset || null,
    followUpFocusedEventId: state.followUpFocusedEventId || null,
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
        'phase_start',
        'follow_up_end',
        'clarity_event',
      ].includes(entry.event);
    })
    .map((entry) => ({
      eventId: entry.eventId,
      ts: entry.ts,
      t: entry.t,
      category: entry.event.startsWith('timer_')
        ? 'timer'
        : (entry.event === 'phase_start' || entry.event === 'follow_up_end'
          ? 'flow'
        : (entry.event === 'clarity_event'
          ? 'clarity'
          : (entry.event === 'hazard_hit' || entry.event === 'reset' || entry.event === 'ghost_move' || entry.event === 'ghost_collision'
            ? 'state'
            : 'input'))),
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
  if (!anchor || anchor.event !== 'clarity_event') {
    return null;
  }
  const replayEvents = [{
    eventId: anchor.eventId,
    event: anchor.event,
    t: anchor.t,
    ts: anchor.ts,
    player: anchor.player || null,
    dir: anchor.dir || null,
    result: anchor.result || null,
    hazardType: anchor.hazardType || null,
    clarityType: anchor.clarityType || null,
    position: anchor.position || null,
    snapshot: anchor.snapshot || null,
  }];

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

function buildTrainerRoleViews(state) {
  return (state.players || []).map((player) => {
    const assignedRoles = getRoleForPlayer(state, player.id);
    return {
      playerId: player.id,
      playerName: player.name,
      assignedRoles,
      viewerRole: getPrimaryRole(assignedRoles),
      roleData: buildRoleData(state, assignedRoles),
    };
  }).filter((view) => view.viewerRole);
}

function buildTrainerState(state, session) {
  const trainerMaze = buildTrainerCombinedMaze(state.maze);
  const trainerEvents = buildTrainerEvents(state);
  const observerSignals = buildObserverSignals(state);
  const aiSuggestions = buildAiSuggestions(state);
  const trainerRoleViews = buildTrainerRoleViews(state);
  const mazeMeta = buildMazeMeta(state.maze);
  return {
    status: state.status,
    players: state.players,
    gameMode: getStateGameMode(state),
    summary: state.summary,
    timer: state.timer,
    phaseFlow: state.phaseFlow,
    log: state.log,
    maze: state.maze,
    mazeMeta,
    canRestart: (state.status === GameStatus.ENDED || state.status === GameStatus.SESSION_OVERVIEW) && state.players.length >= MIN_PLAYERS,
    trainerMaze,
    trainerEvents,
    trainerRoleViews,
    observerSignals,
    aiSuggestions,
    trainerHighlightEventIds: state.trainerHighlightEventIds,
    roleData: {
      trainerMaze,
      trainerEvents,
      trainerRoleViews,
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
    followUpFocusedEventId: state.followUpFocusedEventId || null,
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
    gameMode: getStateGameMode(state),
    summary: controllerSummary,
    timer: state.timer,
    phaseFlow: state.phaseFlow,
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
  state.phaseFlow = createPhaseFlowState({
    phaseType: 'ended',
    currentPhase: null,
  });
  state.timer = createTimerState();

  appendLog(state, {
    ts: endedAt,
    event: 'session_end',
    outcome,
    reason,
    keys: state.summary.keysCollected,
    lives: state.summary.livesRemaining,
  });
}

function enterSessionOverview(state, outcome, reason) {
  if (state.status === GameStatus.SESSION_OVERVIEW) {
    return;
  }

  const endedAt = Date.now();
  state.status = GameStatus.SESSION_OVERVIEW;
  state.summary.endedAt = endedAt;
  state.summary.durationMs = state.summary.startedAt ? endedAt - state.summary.startedAt : null;
  if (typeof outcome === 'string' && outcome.length > 0) {
    state.summary.outcome = outcome;
  }
  state.phaseFlow = createPhaseFlowState({
    phaseType: 'session_overview',
    currentPhase: null,
  });
  state.timer = createTimerState();
}

function createRoundMazeForState(state) {
  const resets = state.summary && typeof state.summary.resets === 'number' ? state.summary.resets : 0;
  const hardMode = resets >= 2;
  const loopFraction = hardMode ? 0.15 : (resets % 2 === 1 ? 0.28 : 0.42);
  const ghostCount = 0;
  const hazardCount = hardMode ? HAZARD_COUNT + 1 : HAZARD_COUNT;
  const layoutVariant = hardMode ? 'hard-mode' : (resets % 2 === 1 ? 'tight-corners' : 'open-loops');

  return createRoundMaze(
    {
      hazardCount,
      keyCount: KEY_COUNT,
    },
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
    const phaseFlow = state.phaseFlow || createPhaseFlowState();
    if (state.status === GameStatus.PLAYING && phaseFlow.phaseType === 'gameplay') {
      const ts = Date.now();
      const currentPhase = Number.isInteger(phaseFlow.currentPhase) ? phaseFlow.currentPhase : 1;
      const terminalReason = `${hazardType}_hazard`;
      appendLog(state, {
        ts,
        event: 'session_end',
        outcome: 'fail',
        reason: terminalReason,
        keys: state.summary.keysCollected,
        lives: state.summary.livesRemaining,
      });
      beginFollowUpPhase(state, currentPhase, ts, {
        terminalOutcome: 'fail',
        terminalReason,
      });
    } else {
      finishGame(state, 'fail', `${hazardType}_hazard`);
    }
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

function initializeMovementAnalytics(state) {
  state.movementAnalytics = {
    firstMovementLogged: false,
    lastMovementAt: null,
  };
}

function recordMovementMoments(state, ts) {
  const analytics = state.movementAnalytics || (state.movementAnalytics = {});
  if (!analytics.firstMovementLogged) {
    analytics.firstMovementLogged = true;
    analytics.lastMovementAt = ts;
    appendLog(state, {
      ts,
      event: 'first_movement',
    });
    return;
  }

  if (typeof analytics.lastMovementAt === 'number' && ts - analytics.lastMovementAt >= MOVEMENT_PAUSE_THRESHOLD_MS) {
    appendLog(state, {
      ts,
      event: 'movement_pause',
      durationMs: ts - analytics.lastMovementAt,
    });
  }

  analytics.lastMovementAt = ts;
}

function beginGameState(session, startedAt, options = {}) {
  const players = session.controllers.size ? [...session.controllers.values()] : [];
  const activePlayers = players.filter((player) => !player.isTrainer);
  const shouldCycleRoles = Boolean(options.cycleRoles);
  const previousRoles = options.previousRoles || {};
  const gameMode = getStateGameMode(session.state);
  const roles = buildRoundRoles(activePlayers, previousRoles, gameMode, shouldCycleRoles);

  session.state.roles = roles;
  session.state.maze = createRoundMazeForState(session.state);
  session.state.log = [];
  session.state.nextEventId = 1;
  session.state.trainerBroadcast = null;
  session.state.trainerHighlightEventIds = [];
  session.state.pendingReset = null;
  session.state.followUpFocusedEventId = null;
  session.state.summary = {
    ...createSummaryState(START_LIVES),
    startedAt,
  };
  session.state.status = GameStatus.PLAYING;
  session.state.phaseFlow = createPhaseFlowState({
    phaseType: 'gameplay',
    currentPhase: 1,
  });
  initializeMovementAnalytics(session.state);

  appendLog(session.state, {
    ts: startedAt,
    event: 'mode_set',
    mode: gameMode,
  });
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

  beginGameplayPhase(session.state, 1, startedAt);
}

const MOI_EVENT_TYPES = new Set([
  'mode_set',
  'level_progression',
  'level_start',
  'first_movement',
  'movement_pause',
  'hazard_hit',
  'key_pickup',
  'session_end',
  'timer_expired',
]);

function isMoiEvent(entry) {
  if (entry.event === 'mode_set') return true;
  if (entry.event === 'level_progression') return true;
  if (entry.event === 'level_start') return true;
  if (entry.event === 'first_movement') return true;
  if (entry.event === 'movement_pause') return true;
  if (entry.event === 'hazard_hit') return true;
  if (entry.event === 'key_pickup') return true;
  if (entry.event === 'session_end' && entry.reason === 'goal_reached') return true;
  if (entry.event === 'timer_expired') return true;
  if (entry.event === 'session_end' && entry.outcome === 'fail') return true;
  return false;
}

function getPhaseLogBoundaries(log, phase) {
  let startIndex = -1;
  let endIndex = log.length;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry.event === 'phase_start' && entry.phaseType === 'gameplay' && entry.phase === phase) {
      startIndex = i;
    }
    if (startIndex >= 0 && i > startIndex && entry.event === 'phase_start') {
      endIndex = i;
      break;
    }
  }
  return { startIndex, endIndex };
}

function getMoiEventsForPhase(log, phase) {
  if (!Number.isInteger(phase) || phase < 1) {
    return log.filter(isMoiEvent);
  }
  const { startIndex, endIndex } = getPhaseLogBoundaries(log, phase);
  if (startIndex < 0) {
    return [];
  }
  const phaseEvents = log.slice(startIndex + 1, endIndex).filter(isMoiEvent);
  const prePhaseEvents = phase === 1
    ? log.slice(0, startIndex).filter((entry) => entry.event === 'mode_set' && isMoiEvent(entry))
    : [];
  return [...prePhaseEvents, ...phaseEvents].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

function beginGameplayPhase(state, phase, startedAt = Date.now()) {
  const phaseDurationMs = GAMEPLAY_PHASE_DURATIONS_MS[phase - 1];
  if (!phaseDurationMs) {
    return false;
  }
  state.status = GameStatus.PLAYING;
  state.phaseFlow = createPhaseFlowState({
    phaseType: 'gameplay',
    currentPhase: phase,
    phaseDurationMs,
    phaseRemainingMs: phaseDurationMs,
    phaseStartedAt: startedAt,
    phaseEndsAt: startedAt + phaseDurationMs,
  });
  state.timer = createTimerState({
    status: 'running',
    durationMs: phaseDurationMs,
    remainingMs: phaseDurationMs,
    startedAt,
    expiresAt: startedAt + phaseDurationMs,
    stoppedAt: null,
  });
  initializeMovementAnalytics(state);
  appendLog(state, {
    ts: startedAt,
    event: 'phase_start',
    phaseType: 'gameplay',
    phase,
    durationMs: phaseDurationMs,
  });
  appendLog(state, {
    ts: startedAt,
    event: 'level_progression',
    phase,
    level: phase,
  });
  appendLog(state, {
    ts: startedAt,
    event: 'level_start',
    phase,
    level: phase,
  });
  return true;
}

function beginFollowUpPhase(state, followingPhase, startedAt = Date.now(), options = {}) {
  const terminalOutcome = options?.terminalOutcome || null;
  const terminalReason = options?.terminalReason || null;
  state.status = GameStatus.FOLLOW_UP;
  state.phaseFlow = createPhaseFlowState({
    phaseType: 'follow_up',
    currentPhase: null,
    followingPhase: Number.isInteger(followingPhase) ? followingPhase : null,
    phaseDurationMs: null,
    phaseRemainingMs: null,
    phaseStartedAt: startedAt,
    phaseEndsAt: null,
    terminalOutcome,
    terminalReason,
  });
  state.timer = createTimerState();
  const moiEvents = getMoiEventsForPhase(state.log, followingPhase);
  state.followUpFocusedEventId = moiEvents.length > 0 ? moiEvents[0].eventId : null;
  appendLog(state, {
    ts: startedAt,
    event: 'phase_start',
    phaseType: 'follow_up',
    followingPhase: Number.isInteger(followingPhase) ? followingPhase : null,
  });
}

function cloneJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
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
    this.logger = options.logger || null;
    this.abandonedSessionTimeoutMs = normalizeCleanupTimeoutMs(options.abandonedSessionTimeoutMs);
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
      cleanupTimer: null,
    });

    this._persistSession(sessionId);
    this._log('info', 'Session created.', { sessionId, origin });
    this._scheduleAbandonedSessionCleanup(sessionId, 'session_created');
    return { sessionId, joinUrl };
  }

  registerDisplay(sessionId, socket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendJoinError(socket, 'Session does not exist.', ErrorCode.SESSION_NOT_FOUND);
      return false;
    }

    this._cancelAbandonedSessionCleanup(sessionId, 'display_registered');
    const wasDisconnected = !session.display;
    session.display = socket;
    socket.meta = { role: ClientRole.DISPLAY, sessionId };

    if (wasDisconnected) {
      appendLog(session.state, {
        event: 'display_connected',
      });
    }

    this._log('info', 'Display registered.', {
      sessionId,
      reattached: !wasDisconnected,
      controllerCount: session.controllers.size,
      participantCount: session.participants.size,
      status: session.state.status,
    });

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
      this._log('warn', 'Rejected controller join for missing session.', { sessionId });
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
      this._log('warn', 'Rejected controller join because display is disconnected.', {
        sessionId,
        requestedTrainer,
        status: session.state.status,
      });
      sendJoinError(socket, 'Session is unavailable.', ErrorCode.SESSION_UNAVAILABLE);
      return false;
    }

    const isTrainer = requestedTrainer;
    if (!isTrainer) {
      if (session.state.status === GameStatus.LOBBY) {
        if (this._getGameplayControllers(session).length >= MAX_PLAYERS) {
          this._log('warn', 'Rejected controller join because session is full.', {
            sessionId,
            requestedTrainer,
            status: session.state.status,
            controllerCount: session.controllers.size,
          });
          sendJoinError(socket, 'Session is full.', ErrorCode.SESSION_FULL);
          return false;
        }
      } else {
        const openSlot = this._findOpenGameplaySlot(session);
        if (openSlot) {
          const playerName = String(playerNameInput || 'Player').trim() || 'Player';
          const reconnectTokenForPlayer = makeReconnectToken();
          if (openSlot.reconnectToken) {
            session.reconnectTokens.delete(openSlot.reconnectToken);
          }
          openSlot.name = playerName;
          openSlot.reconnectToken = reconnectTokenForPlayer;
          session.reconnectTokens.set(reconnectTokenForPlayer, openSlot.id);
          session.controllers.set(openSlot.id, { socket, ...openSlot });
          socket.meta = { role: ClientRole.CONTROLLER, sessionId, playerId: openSlot.id, isTrainer: false };
          this._cancelAbandonedSessionCleanup(sessionId, 'controller_joined');
          this._log('info', 'Controller claimed disconnected gameplay slot.', {
            sessionId,
            playerId: openSlot.id,
            playerName,
            controllerCount: session.controllers.size,
            participantCount: session.participants.size,
            status: session.state.status,
          });

          sendJson(socket, {
            type: MessageType.CLIENT_REGISTERED,
            role: ClientRole.CONTROLLER,
            sessionId,
            playerId: openSlot.id,
            isTrainer: false,
            reconnectToken: reconnectTokenForPlayer,
            reconnected: false,
          });

          session.state.players = this._getPlayers(session);
          this.broadcastState(sessionId);
          return true;
        }
      }
      if (this._getGameplayParticipants(session).length >= MAX_PLAYERS) {
        this._log('warn', 'Rejected controller join because session is full.', {
          sessionId,
          requestedTrainer,
          status: session.state.status,
          controllerCount: session.controllers.size,
          participantCount: session.participants.size,
        });
        sendJoinError(socket, 'Session is full.', ErrorCode.SESSION_FULL);
        return false;
      }
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
    this._cancelAbandonedSessionCleanup(sessionId, 'controller_joined');
    this._log('info', 'Controller joined session.', {
      sessionId,
      playerId,
      playerName,
      isTrainer,
      controllerCount: session.controllers.size,
      participantCount: session.participants.size,
      status: session.state.status,
    });

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
    if (!isTrainer && session.state.status === GameStatus.PLAYING) {
      this._rebalanceActiveGameRoles(session.state, sessionId, 'player_joined');
    }
    this.broadcastState(sessionId);
    return true;
  }

  setGameMode(sessionId, mode, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.state.status !== GameStatus.LOBBY && session.state.status !== GameStatus.SESSION_OVERVIEW) {
      return false;
    }

    const normalizedMode = normalizeGameMode(mode);
    if (!normalizedMode) {
      return false;
    }

    const trainerId = options.playerId || session.trainerId || session.state.trainer?.id || null;
    const isTrainer = Boolean(options.isTrainer);
    if (!isTrainer || !trainerId || (session.trainerId && trainerId !== session.trainerId)) {
      return false;
    }

    if (session.state.gameMode === normalizedMode) {
      return true;
    }

    session.state.gameMode = normalizedMode;
    appendLog(session.state, {
      ts: Date.now(),
      event: 'mode_set',
      mode: normalizedMode,
    });
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

    if (session.state.status !== GameStatus.ENDED && session.state.status !== GameStatus.SESSION_OVERVIEW) {
      return false;
    }

    const players = this._getPlayers(session);
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      return false;
    }

    beginGameState(session, Date.now(), {
      cycleRoles: true,
      previousRoles: session.state.roles,
    });
    this.broadcastState(sessionId);
    return true;
  }

  startTimer(sessionId, durationMs) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.state.phaseFlow && session.state.phaseFlow.phaseType === 'follow_up') {
      return false;
    }

    const now = Date.now();
    const timer = session.state.timer || createTimerState();
    const phaseFlow = session.state.phaseFlow || createPhaseFlowState();

    if (phaseFlow.phaseType === 'gameplay') {
      const nextDurationMs = normalizeTimerDuration(durationMs, normalizeTimerDuration(phaseFlow.phaseDurationMs || timer.durationMs));
      const nextRemainingMs = timer.status === 'stopped' && typeof timer.remainingMs === 'number'
        ? timer.remainingMs
        : (typeof phaseFlow.phaseRemainingMs === 'number' && phaseFlow.phaseRemainingMs > 0
          ? phaseFlow.phaseRemainingMs
          : nextDurationMs);

      session.state.timer = createTimerState({
        status: 'running',
        durationMs: nextDurationMs,
        remainingMs: nextRemainingMs,
        startedAt: now,
        expiresAt: now + nextRemainingMs,
        stoppedAt: null,
      });
      session.state.phaseFlow = {
        ...phaseFlow,
        phaseDurationMs: nextDurationMs,
        phaseRemainingMs: nextRemainingMs,
        phaseStartedAt: now,
        phaseEndsAt: now + nextRemainingMs,
      };
      appendLog(session.state, {
        ts: now,
        event: 'timer_start',
        durationMs: nextDurationMs,
        remainingMs: nextRemainingMs,
      });

      this.broadcastState(sessionId);
      return true;
    }

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

    if (session.state.phaseFlow && session.state.phaseFlow.phaseType === 'follow_up') {
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
    if (session.state.phaseFlow && session.state.phaseFlow.phaseType === 'gameplay') {
      session.state.phaseFlow = {
        ...session.state.phaseFlow,
        phaseRemainingMs: remainingMs,
        phaseEndsAt: null,
      };
    }
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

    if (session.state.phaseFlow && session.state.phaseFlow.phaseType === 'follow_up') {
      return false;
    }

    const timer = session.state.timer || createTimerState();
    const phaseFlow = session.state.phaseFlow || createPhaseFlowState();
    if (phaseFlow.phaseType === 'gameplay') {
      const nextDurationMs = normalizeTimerDuration(durationMs, normalizeTimerDuration(phaseFlow.phaseDurationMs || timer.durationMs));
      session.state.timer = createTimerState({
        status: 'idle',
        durationMs: nextDurationMs,
        remainingMs: nextDurationMs,
        startedAt: null,
        expiresAt: null,
        stoppedAt: null,
      });
      session.state.phaseFlow = {
        ...phaseFlow,
        phaseDurationMs: nextDurationMs,
        phaseRemainingMs: nextDurationMs,
        phaseStartedAt: null,
        phaseEndsAt: null,
      };
      appendLog(session.state, {
        event: 'timer_reset',
        durationMs: nextDurationMs,
        remainingMs: nextDurationMs,
      });

      this.broadcastState(sessionId);
      return true;
    }

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

      const phaseFlow = session.state.phaseFlow || createPhaseFlowState();
      if (didExpire && session.state.status === GameStatus.PLAYING && phaseFlow.phaseType === 'gameplay') {
        const currentPhase = Number.isInteger(phaseFlow.currentPhase) ? phaseFlow.currentPhase : 1;
        appendLog(session.state, {
          ts: now,
          event: 'timer_expired',
          durationMs: timer.durationMs,
        });
        beginFollowUpPhase(session.state, currentPhase, now);
        this.broadcastState(sessionId);
        changed += 1;
        continue;
      }

      session.state.timer = createTimerState({
        ...timer,
        status: didExpire ? 'expired' : 'running',
        remainingMs,
        expiresAt: didExpire ? null : timer.expiresAt,
        stoppedAt: didExpire ? now : null,
      });

      if (session.state.phaseFlow && session.state.phaseFlow.phaseType === 'gameplay') {
        session.state.phaseFlow = {
          ...session.state.phaseFlow,
          phaseRemainingMs: remainingMs,
          phaseEndsAt: didExpire ? null : timer.expiresAt,
        };
      }

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

  endFollowUp(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.state.status !== GameStatus.FOLLOW_UP) {
      return false;
    }

    const now = Date.now();
    const phaseFlow = session.state.phaseFlow || {};
    const followingPhase = phaseFlow.followingPhase;
    const totalPhases = phaseFlow.totalGameplayPhases || GAMEPLAY_PHASE_DURATIONS_MS.length;
    const terminalOutcome = phaseFlow.terminalOutcome;
    const terminalReason = phaseFlow.terminalReason;

    appendLog(session.state, {
      ts: now,
      event: 'follow_up_end',
      followingPhase: followingPhase || null,
    });

    if (terminalOutcome) {
      finishGame(session.state, terminalOutcome, terminalReason || 'follow_up_completed');
    } else if (Number.isInteger(followingPhase) && followingPhase < totalPhases) {
      session.state.summary.keysCollected = 0;
      session.state.summary.resets = 0;
      session.state.maze = createRoundMazeForState(session.state);
      beginGameplayPhase(session.state, followingPhase + 1, now);
    } else {
      enterSessionOverview(session.state, session.state.summary.livesRemaining > 0 ? 'success' : 'fail', 'session_overview');
    }

    this.broadcastState(sessionId);
    return true;
  }

  navigateFollowUp(sessionId, direction) {
    const session = this.sessions.get(sessionId);
    if (!session || session.state.status !== GameStatus.FOLLOW_UP) {
      return false;
    }

    const state = session.state;
    const phaseFlow = state.phaseFlow || {};
    const followingPhase = phaseFlow.followingPhase;
    const moiEvents = getMoiEventsForPhase(state.log, followingPhase);
    if (moiEvents.length === 0) {
      return false;
    }

    const currentIndex = moiEvents.findIndex((e) => e.eventId === state.followUpFocusedEventId);
    let nextIndex;
    if (direction === 'prev') {
      nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
    } else {
      nextIndex = currentIndex >= moiEvents.length - 1 ? moiEvents.length - 1 : currentIndex + 1;
    }

    state.followUpFocusedEventId = moiEvents[nextIndex].eventId;
    this.broadcastState(sessionId);
    return true;
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

    if (input?.action === 'signal') {
      appendLog(state, {
        ts,
        event: 'signal',
        playerId,
        playerName: controller.name,
        signalType: input.type || input.signalType || 'callout',
      });
      this.broadcastState(sessionId);
      return true;
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
    const exitUnlocked = state.summary.keysCollected >= KEY_COUNT;
    const moveResultLabel = moveResult.result === 'goal' && !exitUnlocked ? 'ok' : moveResult.result;
    if (moveResult.result !== 'invalid') {
      recordMovementMoments(state, ts);
    }

    appendLog(state, {
      ts,
      event: 'move',
      playerId,
      player: controller.name,
      dir: input.dir,
      result: moveResultLabel,
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
        keyIndex: state.summary.keysCollected - 1,
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
      if (exitUnlocked) {
        const phaseFlow = state.phaseFlow || createPhaseFlowState();
        if (state.status === GameStatus.PLAYING && phaseFlow.phaseType === 'gameplay') {
          const endedAt = Date.now();
          const currentPhase = Number.isInteger(phaseFlow.currentPhase) ? phaseFlow.currentPhase : 1;
          const totalPhases = phaseFlow.totalGameplayPhases || GAMEPLAY_PHASE_DURATIONS_MS.length;
          const terminalReason = 'goal_reached';
          appendLog(state, {
            ts: endedAt,
            event: 'session_end',
            outcome: 'success',
            reason: terminalReason,
            keys: state.summary.keysCollected,
            lives: state.summary.livesRemaining,
          });
          beginFollowUpPhase(state, currentPhase, endedAt);
        } else {
          finishGame(state, 'success', 'goal_reached');
        }
      } else {
        maze.reached = false;
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
    this._log('info', 'Started disconnect grace window.', {
      sessionId: meta.sessionId,
      role: meta.role,
      playerId: meta.playerId || null,
      isTrainer: Boolean(meta.isTrainer),
      reason,
      delayMs,
    });
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
    const meta = socket.meta || {};
    this._log('info', 'Cancelled disconnect grace window.', {
      sessionId: meta.sessionId || null,
      role: meta.role || null,
      playerId: meta.playerId || null,
      isTrainer: Boolean(meta.isTrainer),
    });
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
      this._log('warn', 'Display disconnected.', {
        sessionId: meta.sessionId,
        reason,
        controllerCount: session.controllers.size,
        participantCount: session.participants.size,
        status: session.state.status,
      });
      this._scheduleAbandonedSessionCleanup(meta.sessionId, 'display_disconnected');
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
      this._log('warn', 'Controller disconnected.', {
        sessionId: meta.sessionId,
        reason,
        playerId: meta.playerId,
        isTrainer: Boolean(meta.isTrainer),
        controllerCount: session.controllers.size,
        participantCount: session.participants.size,
        status: session.state.status,
      });
      this._scheduleAbandonedSessionCleanup(meta.sessionId, 'controller_disconnected');
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

  _rebalanceActiveGameRoles(state, sessionId, reason) {
    if (state.status !== GameStatus.PLAYING) {
      return false;
    }

    const players = state.players || [];
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      return false;
    }

    const nextRoles = rebalanceRoles(players, state.roles || {}, getStateGameMode(state));
    state.roles = nextRoles;
    appendLog(state, {
      ts: Date.now(),
      event: 'roles_rebalanced',
      reason,
      players: players.map((player) => ({ id: player.id, name: player.name })),
      roles: Object.entries(nextRoles).map(([playerId, role]) => ({
        playerId,
        roles: Array.isArray(role) ? role : [role],
      })),
    });
    this._log('info', 'Rebalanced gameplay roles during active session.', {
      sessionId,
      reason,
      playerCount: players.length,
    });
    return true;
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

  _findOpenGameplaySlot(session) {
    for (const participant of session.participants.values()) {
      if (participant.isTrainer) {
        continue;
      }
      if (!session.controllers.has(participant.id)) {
        return participant;
      }
    }
    return null;
  }

  _reconnectController(sessionId, session, socket, reconnectToken) {
    const existingPlayerId = session.reconnectTokens.get(reconnectToken);
    if (!existingPlayerId) {
      this._log('warn', 'Rejected reconnect with invalid token.', { sessionId });
      sendJoinError(socket, 'Reconnect token is invalid.', ErrorCode.INVALID_RECONNECT_TOKEN);
      return false;
    }

    const participant = session.participants.get(existingPlayerId);
    if (!participant) {
      this._log('warn', 'Rejected reconnect because slot is unavailable.', {
        sessionId,
        playerId: existingPlayerId,
      });
      sendJoinError(socket, 'Reconnect slot is unavailable.', ErrorCode.RECONNECT_SLOT_UNAVAILABLE);
      return false;
    }

    const existingController = session.controllers.get(existingPlayerId);
    if (existingController && existingController.socket && existingController.socket !== socket) {
      this.cancelDisconnectGrace(existingController.socket);
      sendJoinError(
        existingController.socket,
        'This player joined from another device.',
        ErrorCode.RECONNECT_REPLACED
      );
      existingController.socket._disconnectFinalized = true;
      existingController.socket.meta = null;
      try {
        existingController.socket.close();
      } catch {
        // Ignore close failures on stale sockets.
      }
    }

    this._cancelAbandonedSessionCleanup(sessionId, 'controller_reconnected');
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
    this._log('info', 'Controller reconnected to session.', {
      sessionId,
      playerId: existingPlayerId,
      isTrainer: participant.isTrainer,
      controllerCount: session.controllers.size,
      participantCount: session.participants.size,
      status: session.state.status,
    });
    this.broadcastState(sessionId);
    return true;
  }

  _scheduleAbandonedSessionCleanup(sessionId, trigger) {
    const session = this.sessions.get(sessionId);
    if (!session || session.display || session.controllers.size > 0 || session.cleanupTimer) {
      return false;
    }

    this._log('info', 'Scheduled abandoned session cleanup.', {
      sessionId,
      trigger,
      timeoutMs: this.abandonedSessionTimeoutMs,
      participantCount: session.participants.size,
      status: session.state.status,
    });

    session.cleanupTimer = setTimeout(() => {
      const currentSession = this.sessions.get(sessionId);
      if (!currentSession) {
        return;
      }
      currentSession.cleanupTimer = null;
      if (currentSession.display || currentSession.controllers.size > 0) {
        this._log('info', 'Skipped abandoned session cleanup because clients reconnected.', {
          sessionId,
          controllerCount: currentSession.controllers.size,
          participantCount: currentSession.participants.size,
          status: currentSession.state.status,
        });
        return;
      }

      appendLog(currentSession.state, {
        event: 'session_closed',
        reason: 'abandoned_timeout',
        captureSnapshot: false,
      });
      this._persistSession(sessionId);
      this.sessions.delete(sessionId);
      this._log('warn', 'Closed abandoned session.', {
        sessionId,
        participantCount: currentSession.participants.size,
        status: currentSession.state.status,
      });
    }, this.abandonedSessionTimeoutMs);
    if (typeof session.cleanupTimer.unref === 'function') {
      session.cleanupTimer.unref();
    }
    return true;
  }

  _cancelAbandonedSessionCleanup(sessionId, trigger) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.cleanupTimer) {
      return false;
    }

    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
    this._log('info', 'Cancelled abandoned session cleanup.', { sessionId, trigger });
    return true;
  }

  _log(level, message, metadata = null) {
    if (!this.logger) {
      return;
    }

    const method = typeof this.logger[level] === 'function'
      ? level
      : (typeof this.logger.log === 'function' ? 'log' : null);
    if (!method) {
      return;
    }

    if (metadata && Object.keys(metadata).length > 0) {
      this.logger[method](`[session-manager] ${message}`, metadata);
      return;
    }

    this.logger[method](`[session-manager] ${message}`);
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
      phase_flow: state.phaseFlow || null,
      game_mode: getStateGameMode(state),
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
