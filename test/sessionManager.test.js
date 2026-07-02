const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('../src/sessionManager');
const { MessageType, GameStatus, ClientRole, MazeRole } = require('../src/protocol');

function createFakeSocket() {
  return {
    sent: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
  };
}

function openCellWalls(n, e, s, w) {
  return { walls: { n, e, s, w } };
}

function makeOpenMaze(overrides = {}) {
  const cells = [
    [openCellWalls(true, false, false, true), openCellWalls(true, true, false, false)],
    [openCellWalls(false, false, true, true), openCellWalls(false, true, true, false)],
  ];

  return {
    seed: overrides.seed || 'test-seed',
    layoutVariant: overrides.layoutVariant || 'test-layout',
    hardMode: overrides.hardMode || false,
    width: 2,
    height: 2,
    cells,
    hazards: overrides.hazards || [],
    ghosts: overrides.ghosts || [],
    keys: overrides.keys || [],
    lifePickups: overrides.lifePickups || [],
    goal: overrides.goal || { row: 1, col: 1 },
    playerPos: overrides.playerPos || { row: 0, col: 0 },
    reached: overrides.reached || false,
    hitHazards: overrides.hitHazards || 0,
  };
}

function registerPlayerId(socket) {
  return socket.sent.find((message) => message.type === MessageType.CLIENT_REGISTERED).playerId;
}

function latestState(socket) {
  return socket.sent.at(-1).state;
}

function findControllerByRole(controllers, role) {
  return controllers.find((socket) => latestState(socket).viewerRole === role) || null;
}

function bootstrapGame(gameplayPlayerCount) {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const session = manager.createSession('http://localhost:3000');
  manager.registerDisplay(session.sessionId, display);

  const trainer = createFakeSocket();
  manager.joinController(session.sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);

  const controllers = [];
  for (let i = 0; i < gameplayPlayerCount; i++) {
    const socket = createFakeSocket();
    controllers.push(socket);
    manager.joinController(session.sessionId, `P${i + 1}`, socket);
  }

  manager.startGame(session.sessionId);
  return { manager, display, trainer, controllers, sessionId: session.sessionId };
}

test('display registers and receives lobby state without the maze', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.registerDisplay(sessionId, display), true);

  const sync = display.sent.find((m) => m.type === MessageType.STATE_SYNC);
  assert.ok(sync, 'state_sync message sent');
  assert.equal(sync.state.status, GameStatus.LOBBY);
  assert.deepEqual(sync.state.players, []);
  assert.equal(sync.state.ready, false);
  assert.equal(sync.state.summary.livesRemaining, 3);
  assert.equal(sync.state.maze, undefined);
});

test('trainer must be explicitly selected in lobby', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const player = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Alex', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'Pat', player);

  assert.equal(trainer.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(trainer.sent.at(-1).state.viewerRole, 'trainer');
  assert.equal(player.sent.at(-1).state.viewerRole, null);
  assert.equal(player.sent.at(-1).state.players.length, 1);
});

test('session rejects a second explicit trainer claim', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const secondTrainer = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  assert.equal(manager.joinController(sessionId, { name: 'Alex', requestedTrainer: true }, trainer), true);
  assert.equal(manager.joinController(sessionId, { name: 'Sam', requestedTrainer: true }, secondTrainer), false);
  assert.equal(secondTrainer.sent.at(-1).code, 'trainer_role_taken');
});

test('session rejects joins after four players', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, createFakeSocket());

  for (let i = 0; i < 4; i++) {
    const socket = createFakeSocket();
    assert.equal(manager.joinController(sessionId, `P${i + 1}`, socket), true);
  }

  const overflow = createFakeSocket();
  assert.equal(manager.joinController(sessionId, 'Overflow', overflow), false);
  assert.equal(overflow.sent.at(-1).type, MessageType.JOIN_ERROR);
  assert.equal(overflow.sent.at(-1).message, 'Session is full.');
  assert.equal(overflow.sent.at(-1).code, 'session_full');
});

test('controller registration returns reconnect token', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);

  const trainer = createFakeSocket();
  assert.equal(manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer), true);

  const registered = trainer.sent.find((message) => message.type === MessageType.CLIENT_REGISTERED);
  assert.equal(typeof registered.reconnectToken, 'string');
  assert.ok(registered.reconnectToken.length > 10);
  assert.equal(registered.reconnected, false);
});

test('startGame assigns gameplay roles while trainer remains observer', () => {
  const { display, trainer, controllers } = bootstrapGame(4);

  assert.equal(display.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(display.sent.at(-1).state.status, GameStatus.PLAYING);
  assert.equal(typeof display.sent.at(-1).state.mazeMeta.seed, 'string');
  assert.equal(trainer.sent.at(-1).state.viewerRole, 'trainer');
  assert.equal(typeof trainer.sent.at(-1).state.roleData.mazeMeta.seed, 'string');
  assert.equal((trainer.sent.at(-1).state.roleData.trainerMaze.lifePickups || []).length, 0);

  const mover = findControllerByRole(controllers, MazeRole.MOVER);
  const guide = findControllerByRole(controllers, MazeRole.GUIDE);
  const keySeer = findControllerByRole(controllers, MazeRole.KEY_SEER);
  const navigator = findControllerByRole(controllers, MazeRole.NAVIGATOR);

  assert.ok(mover);
  assert.ok(guide);
  assert.ok(keySeer);
  assert.ok(navigator);

  assert.ok(latestState(mover).roleData.maze);
  assert.equal(latestState(mover).roleData.maze.cells, undefined);
  assert.equal(latestState(mover).summary.livesRemaining, undefined);

  assert.ok(Array.isArray(latestState(guide).roleData.hazards));
  assert.ok(Array.isArray(latestState(guide).roleData.ghosts));
  assert.ok(latestState(guide).roleData.playerPos);

  assert.ok(Array.isArray(latestState(keySeer).roleData.keys));
  assert.ok(latestState(keySeer).roleData.playerPos);

  assert.ok(latestState(navigator).roleData.maze);
  assert.ok(latestState(navigator).roleData.maze.cells);
  assert.ok(latestState(navigator).roleData.playerPos);
});

test('two-player sessions merge roles into mover+key-seer and guide+navigator', () => {
  const { controllers } = bootstrapGame(2);
  const mover = findControllerByRole(controllers, MazeRole.MOVER);
  const guide = findControllerByRole(controllers, MazeRole.GUIDE);

  assert.ok(mover);
  assert.ok(guide);

  const moverState = latestState(mover);
  assert.deepEqual(moverState.roleData.assignedRoles, [MazeRole.MOVER, MazeRole.KEY_SEER]);
  assert.ok(moverState.roleData.maze);
  assert.ok(Array.isArray(moverState.roleData.keys));

  const guideState = latestState(guide);
  assert.deepEqual(guideState.roleData.assignedRoles, [MazeRole.GUIDE, MazeRole.NAVIGATOR]);
  assert.ok(Array.isArray(guideState.roleData.hazards));
  assert.ok(Array.isArray(guideState.roleData.ghosts));
  assert.ok(guideState.roleData.maze);
  assert.ok(guideState.roleData.maze.cells);
});

test('three-player sessions merge guide+navigator only', () => {
  const { controllers } = bootstrapGame(3);
  const mover = findControllerByRole(controllers, MazeRole.MOVER);
  const guide = findControllerByRole(controllers, MazeRole.GUIDE);
  const keySeer = findControllerByRole(controllers, MazeRole.KEY_SEER);

  assert.ok(mover);
  assert.ok(guide);
  assert.ok(keySeer);

  assert.deepEqual(latestState(mover).roleData.assignedRoles, [MazeRole.MOVER]);
  assert.deepEqual(latestState(keySeer).roleData.assignedRoles, [MazeRole.KEY_SEER]);
  assert.deepEqual(latestState(guide).roleData.assignedRoles, [MazeRole.GUIDE, MazeRole.NAVIGATOR]);
});

test('mover pickup updates key progress and logs the pickup', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    keys: [{ id: 'key-1', row: 0, col: 1, collected: false }],
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.summary.keysCollected, 1);
  assert.ok(sync.state.log.some((entry) => entry.event === 'key_pickup'));
});

test('mover pickup updates lives and logs the life pickup', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    lifePickups: [{ id: 'life-1', row: 0, col: 1, collected: false }],
  });
  session.state.summary.livesRemaining = 2;

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.summary.livesRemaining, 3);
  assert.equal(sync.state.summary.livesPickedUp, 1);
  assert.ok(sync.state.log.some((entry) => entry.event === 'life_pickup'));
});

test('hazard hit decrements life and triggers a reset', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    hazards: [{ row: 0, col: 1 }],
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  const liveState = manager.sessions.get(sessionId).state;
  assert.equal(sync.state.summary.livesRemaining, 2);
  assert.equal(sync.state.summary.resets, 1);
  assert.ok(sync.state.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'grid'));
  assert.ok(sync.state.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'grid'));
  assert.deepEqual(liveState.maze.playerPos, { row: 0, col: 0 });
});

test('wall collision counts as a wall hazard and triggers a reset', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze();

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'n' }), true);

  const sync = display.sent.at(-1);
  const liveState = manager.sessions.get(sessionId).state;
  assert.equal(sync.state.summary.livesRemaining, 2);
  assert.equal(sync.state.summary.resets, 1);
  assert.ok(sync.state.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'wall'));
  assert.ok(sync.state.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'wall'));
  assert.deepEqual(liveState.maze.playerPos, { row: 0, col: 0 });
});

test('reset regenerates maze seed and exposes it in synced state and export', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    seed: 'seed-before-reset',
    hazards: [{ row: 0, col: 1 }],
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const syncedState = display.sent.at(-1).state;
  assert.notEqual(syncedState.mazeMeta.seed, 'seed-before-reset');
  assert.equal(syncedState.log.at(-1).event, 'reset');
  assert.equal(syncedState.log.at(-1).mazeSeed, syncedState.mazeMeta.seed);

  const exported = manager.getSessionExport(sessionId);
  assert.equal(exported.maze_seed, syncedState.mazeMeta.seed);
  assert.equal(exported.maze_meta.seed, syncedState.mazeMeta.seed);
});

test('ghost tick moves ghosts for guide and ghost collision triggers a reset', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    ghosts: [{ id: 'ghost-1', row: 0, col: 1 }],
  });

  manager.broadcastState(sessionId);
  const guide = findControllerByRole(controllers, MazeRole.GUIDE);
  assert.equal(latestState(guide).roleData.ghosts.length, 1);
  assert.deepEqual(latestState(guide).roleData.ghosts[0], { id: 'ghost-1', row: 0, col: 1 });

  assert.equal(manager.tickWorld(), 1);

  const sync = display.sent.at(-1).state;
  assert.equal(sync.summary.livesRemaining, 2);
  assert.equal(sync.summary.resets, 1);
  assert.ok(sync.log.some((entry) => entry.event === 'ghost_move'));
  assert.ok(sync.log.some((entry) => entry.event === 'ghost_collision'));
  assert.ok(sync.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'ghost'));
  assert.ok(sync.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'ghost'));
});

test('repeated resets advance maze variant into hard mode with ghosts', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);

  session.state.maze = makeOpenMaze({
    hazards: [{ row: 0, col: 1 }],
  });
  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
  const firstResetState = display.sent.at(-1).state;
  assert.equal(firstResetState.summary.resets, 1);
  assert.equal(firstResetState.mazeMeta.layoutVariant, 'tight-corners');
  assert.equal(firstResetState.mazeMeta.hardMode, false);

  session.state.maze = makeOpenMaze({
    hazards: [{ row: 0, col: 1 }],
    playerPos: { row: 0, col: 0 },
  });
  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
  const secondResetState = display.sent.at(-1).state;
  assert.equal(secondResetState.summary.resets, 2);
  assert.equal(secondResetState.mazeMeta.layoutVariant, 'hard-mode');
  assert.equal(secondResetState.mazeMeta.hardMode, true);
  assert.equal(secondResetState.mazeMeta.ghostCount, 1);
});

test('goal unlocks only after three keys are collected', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    goal: { row: 0, col: 1 },
  });
  session.state.summary.keysCollected = 3;

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.status, GameStatus.ENDED);
  assert.equal(sync.state.summary.outcome, 'success');
  assert.ok(sync.state.log.some((entry) => entry.event === 'session_end'));
});

test('goal remains locked until three keys are collected', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    goal: { row: 0, col: 1 },
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  const liveState = manager.sessions.get(sessionId).state;
  assert.equal(sync.state.status, GameStatus.PLAYING);
  assert.equal(liveState.maze.reached, false);
  assert.ok(sync.state.log.some((entry) => entry.event === 'goal_locked'));
});

test('lives reaching zero ends the session as a failure', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    hazards: [{ row: 0, col: 1 }],
  });
  session.state.summary.livesRemaining = 1;

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.status, GameStatus.ENDED);
  assert.equal(sync.state.summary.outcome, 'fail');
  assert.equal(sync.state.summary.livesRemaining, 0);
  assert.ok(sync.state.log.some((entry) => entry.event === 'session_end'));
});

test('ended sessions can restart into a fresh round', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    goal: { row: 0, col: 1 },
  });
  session.state.summary.keysCollected = 3;

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
  assert.equal(manager.restartGame(sessionId), true);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.status, GameStatus.PLAYING);
  assert.equal(sync.state.summary.outcome, null);
  assert.equal(sync.state.summary.keysCollected, 0);
  assert.equal(sync.state.summary.resets, 0);
  assert.ok(sync.state.log.some((entry) => entry.event === 'game_start'));
});

test('startTimer initializes running timer state', () => {
  const manager = new SessionManager();
  const { sessionId } = manager.createSession('http://localhost:3000');
  const originalNow = Date.now;

  try {
    Date.now = () => 1000;
    assert.equal(manager.startTimer(sessionId, 30000), true);
  } finally {
    Date.now = originalNow;
  }

  const timer = manager.sessions.get(sessionId).state.timer;
  assert.equal(timer.status, 'running');
  assert.equal(timer.durationMs, 30000);
  assert.equal(timer.remainingMs, 30000);
  assert.equal(timer.startedAt, 1000);
  assert.equal(timer.expiresAt, 31000);
  assert.ok(manager.sessions.get(sessionId).state.log.some((entry) => entry.event === 'timer_start'));
});

test('stopTimer preserves remaining time and startTimer resumes it', () => {
  const manager = new SessionManager();
  const { sessionId } = manager.createSession('http://localhost:3000');
  const originalNow = Date.now;

  try {
    Date.now = () => 1000;
    manager.startTimer(sessionId, 30000);

    Date.now = () => 7000;
    assert.equal(manager.stopTimer(sessionId), true);

    let timer = manager.sessions.get(sessionId).state.timer;
    assert.equal(timer.status, 'stopped');
    assert.equal(timer.remainingMs, 24000);
    assert.ok(manager.sessions.get(sessionId).state.log.some((entry) => entry.event === 'timer_stop'));

    Date.now = () => 8000;
    assert.equal(manager.startTimer(sessionId), true);
    timer = manager.sessions.get(sessionId).state.timer;
    assert.equal(timer.status, 'running');
    assert.equal(timer.remainingMs, 24000);
    assert.equal(timer.expiresAt, 32000);
  } finally {
    Date.now = originalNow;
  }
});

test('resetTimer returns timer to idle state with configured duration', () => {
  const manager = new SessionManager();
  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.resetTimer(sessionId, 45000), true);

  const timer = manager.sessions.get(sessionId).state.timer;
  assert.equal(timer.status, 'idle');
  assert.equal(timer.durationMs, 45000);
  assert.equal(timer.remainingMs, 45000);
  assert.equal(timer.expiresAt, null);
  assert.ok(manager.sessions.get(sessionId).state.log.some((entry) => entry.event === 'timer_reset'));
});

test('tickTimers expires running timers when time reaches zero', () => {
  const manager = new SessionManager();
  const { sessionId } = manager.createSession('http://localhost:3000');
  const originalNow = Date.now;

  try {
    Date.now = () => 1000;
    manager.startTimer(sessionId, 10000);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(manager.tickTimers(11000), 1);

  const timer = manager.sessions.get(sessionId).state.timer;
  assert.equal(timer.status, 'expired');
  assert.equal(timer.remainingMs, 0);
  assert.equal(timer.expiresAt, null);
  assert.ok(manager.sessions.get(sessionId).state.log.some((entry) => entry.event === 'timer_expired'));
});

test('trainer can share full session export to display state', () => {
  const { manager, display, trainer, sessionId } = bootstrapGame(2);
  const trainerId = trainer.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;

  assert.equal(
    manager.handleInput(sessionId, trainerId, { action: 'trainer_share_log' }),
    true
  );

  const sync = display.sent.at(-1);
  assert.equal(sync.state.trainerBroadcast.payload.session_id, sessionId);
  assert.ok(Array.isArray(sync.state.trainerBroadcast.payload.events));
  assert.ok(sync.state.trainerBroadcast.payload.events.length > 0);
  assert.ok(sync.state.log.some((entry) => entry.event === 'trainer_broadcast'));
});

test('trainer state includes combined maze and event ids', () => {
  const { trainer } = bootstrapGame(2);
  const sync = trainer.sent.at(-1);
  assert.equal(sync.state.viewerRole, 'trainer');
  assert.ok(sync.state.roleData.trainerMaze);
  assert.ok(Array.isArray(sync.state.roleData.trainerEvents));
  assert.ok(Array.isArray(sync.state.roleData.observerSignals));
  assert.ok(sync.state.roleData.trainerEvents.every((entry) => typeof entry.eventId === 'string'));
  assert.ok(sync.state.roleData.trainerEvents.every((entry) => entry.snapshot && entry.snapshot.mazeMeta));
});

test('trainer can toggle highlights and share highlight set', () => {
  const { manager, display, trainer, sessionId } = bootstrapGame(2);
  const trainerId = trainer.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;

  const firstEventId = display.sent.at(-1).state.log[0].eventId;
  assert.equal(
    manager.handleInput(sessionId, trainerId, { action: 'trainer_toggle_highlight', eventId: firstEventId }),
    true
  );

  const afterToggle = trainer.sent.at(-1);
  assert.ok(afterToggle.state.trainerHighlightEventIds.includes(firstEventId));

  assert.equal(manager.handleInput(sessionId, trainerId, { action: 'trainer_share_highlights' }), true);
  const afterShare = display.sent.at(-1);
  assert.equal(afterShare.state.trainerBroadcast.payload.type, 'highlight_set');
  assert.ok(Array.isArray(afterShare.state.trainerBroadcast.payload.highlights));
  assert.ok(afterShare.state.trainerBroadcast.payload.highlights.some((entry) => entry.eventId === firstEventId));
});

test('trainer can share replay snippet around a selected event', () => {
  const { manager, display, trainer, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);
  const targetEventId = display.sent.at(-1).state.log[0].eventId;

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_share_replay',
      eventId: targetEventId,
    }),
    true
  );

  const payload = display.sent.at(-1).state.trainerBroadcast.payload;
  assert.equal(payload.type, 'replay_snippet');
  assert.equal(payload.eventId, targetEventId);
  assert.ok(Array.isArray(payload.replayEvents));
  assert.ok(payload.replayEvents.length > 0);
});

test('trainer can add clarity events to the timeline', () => {
  const { manager, display, trainer, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_add_clarity_event',
      clarityType: 'role_unclear',
    }),
    true
  );

  const sync = display.sent.at(-1);
  const clarityEntry = sync.state.log.find((entry) => entry.event === 'clarity_event');
  assert.ok(clarityEntry);
  assert.equal(clarityEntry.clarityType, 'role_unclear');
  const trainerEvent = latestState(trainer).roleData.trainerEvents.find((entry) => entry.event === 'clarity_event');
  assert.equal(trainerEvent.clarityType, 'role_unclear');
  const observerSignal = latestState(trainer).roleData.observerSignals.find((entry) => entry.type === 'clarity_event');
  assert.equal(observerSignal.category, 'clarity');
});

test('session export includes normalized observer signals', () => {
  const { manager, trainer, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);

  manager.handleInput(sessionId, trainerId, {
    action: 'trainer_add_clarity_event',
    clarityType: 'silent_confusion',
  });
  manager.startTimer(sessionId, 15000);
  manager.stopTimer(sessionId);

  const exported = manager.getSessionExport(sessionId);
  assert.ok(Array.isArray(exported.observer_signals));
  assert.ok(exported.observer_signals.some((entry) => entry.category === 'clarity' && entry.clarityType === 'silent_confusion'));
  assert.ok(exported.observer_signals.some((entry) => entry.category === 'timer' && entry.type === 'timer_start'));
  assert.ok(exported.observer_signals.some((entry) => entry.category === 'timer' && entry.type === 'timer_stop'));
});

test('trainer can approve ai suggestions', () => {
  const { manager, trainer, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);

  manager.handleInput(sessionId, trainerId, {
    action: 'trainer_add_clarity_event',
    clarityType: 'role_unclear',
  });

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_review_suggestion',
      suggestionId: 'suggestion-role-confusion',
      decision: 'approved',
    }),
    true
  );

  const suggestions = latestState(trainer).roleData.aiSuggestions;
  const reviewed = suggestions.find((entry) => entry.id === 'suggestion-role-confusion');
  assert.equal(reviewed.status, 'approved');
});

test('invalid clarity event type is rejected', () => {
  const { manager, trainer, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_add_clarity_event',
      clarityType: 'not-a-real-type',
    }),
    false
  );

  const state = latestState(trainer);
  assert.ok(state.log.some((entry) => entry.event === 'input_rejected' && entry.reason === 'invalid_clarity_type'));
});

test('controller can reconnect into the same player slot and role', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { manager, controllers, sessionId } = bootstrapGame(2);
  const originalController = findControllerByRole(controllers, MazeRole.MOVER);
  const reconnectingController = createFakeSocket();
  const registered = originalController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);

  manager.beginDisconnectGrace(originalController, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.equal(
    manager.joinController(sessionId, { name: 'Replacement', reconnectToken: registered.reconnectToken }, reconnectingController),
    true
  );

  const reconnectedRegistration = reconnectingController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);
  assert.equal(reconnectedRegistration.playerId, registered.playerId);
  assert.equal(reconnectedRegistration.reconnectToken, registered.reconnectToken);
  assert.equal(reconnectedRegistration.reconnected, true);

  const sync = reconnectingController.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.equal(sync.state.viewerRole, latestState(originalController).viewerRole);
});

test('controller can reconnect while display is disconnected', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const originalController = findControllerByRole(controllers, MazeRole.MOVER);
  const reconnectingController = createFakeSocket();
  const registered = originalController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);

  manager.beginDisconnectGrace(display, 'socket_closed', 1000);
  manager.beginDisconnectGrace(originalController, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.equal(manager.sessions.get(sessionId).display, null);
  assert.equal(
    manager.joinController(sessionId, { name: 'Replacement', reconnectToken: registered.reconnectToken }, reconnectingController),
    true
  );

  const reconnectedRegistration = reconnectingController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);
  assert.equal(reconnectedRegistration.playerId, registered.playerId);
  assert.equal(reconnectedRegistration.reconnectToken, registered.reconnectToken);
  assert.equal(reconnectedRegistration.reconnected, true);
});

test('invalid reconnect token is rejected', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);

  const socket = createFakeSocket();
  assert.equal(
    manager.joinController(sessionId, { name: 'Alex', reconnectToken: 'bad-token' }, socket),
    false
  );
  assert.equal(socket.sent.at(-1).type, MessageType.JOIN_ERROR);
  assert.equal(socket.sent.at(-1).code, 'invalid_reconnect_token');
});

test('controller disconnect waits for grace timeout before removal', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'P1', controller);

  const session = manager.sessions.get(sessionId);
  const controllerId = controller.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
  assert.ok(session.controllers.has(controllerId));

  manager.beginDisconnectGrace(controller, 'socket_closed', 1000);
  t.mock.timers.tick(999);
  assert.ok(session.controllers.has(controllerId));
  assert.equal(session.state.players.length, 1);

  t.mock.timers.tick(1);
  assert.equal(session.controllers.has(controllerId), false);
  assert.equal(session.state.players.length, 0);
});

test('disconnect grace can be cancelled before cleanup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'P1', controller);

  const session = manager.sessions.get(sessionId);
  const controllerId = controller.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;

  manager.beginDisconnectGrace(controller, 'socket_closed', 1000);
  assert.equal(manager.cancelDisconnectGrace(controller), true);
  t.mock.timers.tick(1000);

  assert.ok(session.controllers.has(controllerId));
  assert.equal(session.state.players.length, 1);
});

test('display disconnect waits for grace timeout before preserving session', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const controller = createFakeSocket();
  const controllerTwo = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'P1', controller);
  manager.joinController(sessionId, 'P2', controllerTwo);
  manager.startGame(sessionId);

  manager.beginDisconnectGrace(display, 'socket_closed', 1000);
  t.mock.timers.tick(999);
  assert.ok(manager.sessions.has(sessionId));

  t.mock.timers.tick(1);
  assert.ok(manager.sessions.has(sessionId));
  assert.equal(manager.sessions.get(sessionId).display, null);
  assert.equal(manager.sessions.get(sessionId).state.status, GameStatus.PLAYING);
  assert.equal(controller.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(controller.sent.at(-1).state.displayConnected, false);
  assert.ok(manager.sessions.get(sessionId).state.log.some((entry) => entry.event === 'display_disconnected'));
});

test('session remains persisted even after all sockets disconnect', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'P1', controller);

  manager.beginDisconnectGrace(display, 'socket_closed', 1000);
  manager.beginDisconnectGrace(trainer, 'socket_closed', 1000);
  manager.beginDisconnectGrace(controller, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.ok(manager.sessions.has(sessionId));
  assert.equal(manager.sessions.get(sessionId).display, null);
  assert.equal(manager.sessions.get(sessionId).controllers.size, 0);
});

test('persisted session can reattach a display without losing state', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager();
  const display = createFakeSocket();
  const replacementDisplay = createFakeSocket();
  const trainer = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, { name: 'Trainer', requestedTrainer: true }, trainer);
  manager.joinController(sessionId, 'P1', controller);
  manager.startGame(sessionId);
  manager.sessions.get(sessionId).state.summary.keysCollected = 2;

  manager.beginDisconnectGrace(display, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.equal(manager.registerDisplay(sessionId, replacementDisplay), true);
  assert.equal(replacementDisplay.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(replacementDisplay.sent.at(-1).state.summary.keysCollected, 2);
  assert.equal(replacementDisplay.sent.at(-1).state.displayConnected, true);
});
