const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('../src/sessionManager');
const { MessageType, GameStatus, ClientRole, MazeRole } = require('../src/protocol');

function createFakeSocket() {
  return {
    sent: [],
    closed: false,
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    close() {
      this.closed = true;
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

function makeLinearMaze(width, overrides = {}) {
  const cells = [
    Array.from({ length: width }, (_value, col) => ({
      walls: {
        n: true,
        e: col === width - 1,
        s: true,
        w: col === 0,
      },
    })),
  ];

  return {
    seed: overrides.seed || 'linear-seed',
    layoutVariant: overrides.layoutVariant || 'linear-layout',
    hardMode: overrides.hardMode || false,
    width,
    height: 1,
    cells,
    hazards: overrides.hazards || [],
    ghosts: overrides.ghosts || [],
    keys: overrides.keys || [],
    lifePickups: overrides.lifePickups || [],
    goal: overrides.goal || { row: 0, col: width - 1 },
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

test('session allows multiple explicit trainer joins', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const secondTrainer = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  assert.equal(manager.joinController(sessionId, { name: 'Alex', requestedTrainer: true }, trainer), true);
  assert.equal(manager.joinController(sessionId, { name: 'Sam', requestedTrainer: true }, secondTrainer), true);
  assert.equal(latestState(trainer).viewerRole, 'trainer');
  assert.equal(latestState(secondTrainer).viewerRole, 'trainer');
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
  assert.equal(display.sent.at(-1).state.mazeMeta.width, 8);
  assert.equal(display.sent.at(-1).state.mazeMeta.height, 8);
  assert.equal(display.sent.at(-1).state.mazeMeta.hazardCount, 5);
  assert.equal(display.sent.at(-1).state.mazeMeta.ghostCount, 0);
  assert.equal(display.sent.at(-1).state.mazeMeta.keyCount, 3);
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
  assert.equal(latestState(keySeer).roleData.goal, null);

  assert.ok(latestState(navigator).roleData.maze);
  assert.ok(latestState(navigator).roleData.maze.cells);
  assert.ok(latestState(navigator).roleData.playerPos);
  assert.equal(display.sent.at(-1).state.phaseFlow.phaseType, 'gameplay');
  assert.equal(display.sent.at(-1).state.phaseFlow.currentPhase, 1);
  assert.equal(display.sent.at(-1).state.timer.durationMs, 15 * 60 * 1000);
  assert.equal(display.sent.at(-1).state.timer.status, 'running');
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

test('late third join in active two-player game redistributes roles and views', () => {
  const { manager, controllers, sessionId } = bootstrapGame(2);
  const lateJoiner = createFakeSocket();
  const moverBefore = findControllerByRole(controllers, MazeRole.MOVER);
  const moverBeforeId = registerPlayerId(moverBefore);

  assert.equal(manager.joinController(sessionId, { name: 'Late Joiner' }, lateJoiner), true);

  const allControllers = [...controllers, lateJoiner];
  const moverAfter = findControllerByRole(allControllers, MazeRole.MOVER);
  const guideAfter = findControllerByRole(allControllers, MazeRole.GUIDE);
  const keySeerAfter = findControllerByRole(allControllers, MazeRole.KEY_SEER);

  assert.ok(moverAfter);
  assert.ok(guideAfter);
  assert.ok(keySeerAfter);
  assert.equal(registerPlayerId(moverAfter), moverBeforeId, 'mover role should remain stable during rebalance');

  const moverState = latestState(moverAfter);
  assert.deepEqual(moverState.roleData.assignedRoles, [MazeRole.MOVER]);
  assert.ok(moverState.roleData.maze);
  assert.equal(moverState.roleData.maze.cells, undefined);

  const guideState = latestState(guideAfter);
  assert.deepEqual(guideState.roleData.assignedRoles, [MazeRole.GUIDE, MazeRole.NAVIGATOR]);
  assert.ok(Array.isArray(guideState.roleData.hazards));
  assert.ok(guideState.roleData.maze && guideState.roleData.maze.cells);

  const keySeerState = latestState(keySeerAfter);
  assert.deepEqual(keySeerState.roleData.assignedRoles, [MazeRole.KEY_SEER]);
  assert.ok(Array.isArray(keySeerState.roleData.keys));

  const rebalancedLog = manager.sessions.get(sessionId).state.log.find((entry) => entry.event === 'roles_rebalanced');
  assert.ok(rebalancedLog);
  assert.equal(manager.sessions.get(sessionId).state.players.length, 3);
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

test('guide and navigator receive key pickup events in recent timeline', () => {
  const { manager, controllers, sessionId } = bootstrapGame(4);
  const mover = findControllerByRole(controllers, MazeRole.MOVER);
  const guide = findControllerByRole(controllers, MazeRole.GUIDE);
  const navigator = findControllerByRole(controllers, MazeRole.NAVIGATOR);
  const moverId = registerPlayerId(mover);
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    keys: [{ id: 'key-1', key: 1, row: 0, col: 1, collected: false }],
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
  assert.ok(latestState(guide).roleData.recentEvents.some((entry) => entry.event === 'key_pickup'));
  assert.ok(latestState(navigator).roleData.recentEvents.some((entry) => entry.event === 'key_pickup'));
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
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { manager, display, controllers, sessionId } = bootstrapGame(2);
    const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
    const session = manager.sessions.get(sessionId);
    session.state.maze = makeOpenMaze({
      hazards: [{ row: 0, col: 1 }],
    });

    assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

    // Immediately after: lives reduced, pendingReset set, but maze not yet reset
    const feedbackSync = display.sent.at(-1);
    assert.equal(feedbackSync.state.summary.livesRemaining, 2);
    assert.ok(feedbackSync.state.pendingReset != null, 'pendingReset should be set');
    assert.ok(feedbackSync.state.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'grid'));

    // Advance timers to trigger the actual reset
    mock.timers.tick(5000);

    const sync = display.sent.at(-1);
    const liveState = manager.sessions.get(sessionId).state;
    assert.equal(sync.state.summary.livesRemaining, 2);
    assert.equal(sync.state.summary.resets, 1);
    assert.ok(sync.state.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'grid'));
    assert.ok(sync.state.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'grid'));
    assert.deepEqual(liveState.maze.playerPos, { row: 0, col: 0 });
  } finally {
    mock.timers.reset();
  }
});

test('wall collision counts as a wall hazard and triggers a reset', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { manager, display, controllers, sessionId } = bootstrapGame(2);
    const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
    const session = manager.sessions.get(sessionId);
    session.state.maze = makeOpenMaze();

    assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'n' }), true);

    const feedbackSync = display.sent.at(-1);
    assert.equal(feedbackSync.state.summary.livesRemaining, 2);
    assert.ok(feedbackSync.state.pendingReset != null, 'pendingReset should be set');

    mock.timers.tick(5000);

    const sync = display.sent.at(-1);
    const liveState = manager.sessions.get(sessionId).state;
    assert.equal(sync.state.summary.livesRemaining, 2);
    assert.equal(sync.state.summary.resets, 1);
    assert.ok(sync.state.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'wall'));
    assert.ok(sync.state.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'wall'));
    assert.deepEqual(liveState.maze.playerPos, { row: 0, col: 0 });
  } finally {
    mock.timers.reset();
  }
});

test('reset regenerates maze seed and exposes it in synced state and export', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { manager, display, controllers, sessionId } = bootstrapGame(2);
    const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
    const session = manager.sessions.get(sessionId);
    session.state.maze = makeOpenMaze({
      seed: 'seed-before-reset',
      hazards: [{ row: 0, col: 1 }],
    });

    assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

    // Advance past feedback window to trigger the reset
    mock.timers.tick(5000);

    const syncedState = display.sent.at(-1).state;
    assert.notEqual(syncedState.mazeMeta.seed, 'seed-before-reset');
    assert.equal(syncedState.log.at(-1).event, 'reset');
    assert.equal(syncedState.log.at(-1).mazeSeed, syncedState.mazeMeta.seed);

    const exported = manager.getSessionExport(sessionId);
    assert.equal(exported.maze_seed, syncedState.mazeMeta.seed);
    assert.equal(exported.maze_meta.seed, syncedState.mazeMeta.seed);
  } finally {
    mock.timers.reset();
  }
});

test('ghost roams when player is out of chase range', () => {
  const { manager, sessionId } = bootstrapGame(2);
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeLinearMaze(9, {
    ghosts: [{ id: 'ghost-1', row: 0, col: 8 }],
    playerPos: { row: 0, col: 0 },
  });

  manager.broadcastState(sessionId);
  assert.equal(manager.tickWorld(), 1);

  const stateAfterTick = session.state;
  const ghost = stateAfterTick.maze.ghosts.find((entry) => entry.id === 'ghost-1');
  assert.ok(ghost);
  assert.equal(ghost.col, 7);
  assert.ok(stateAfterTick.log.some((entry) => entry.event === 'ghost_move'));
});

test('ghost tick moves ghosts for guide and ghost collision triggers a reset', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
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

    // Immediately: lives reduced, pendingReset set
    const feedbackSync = display.sent.at(-1).state;
    assert.equal(feedbackSync.summary.livesRemaining, 2);
    assert.ok(feedbackSync.pendingReset != null, 'pendingReset should be set after ghost collision');
    assert.ok(feedbackSync.log.some((entry) => entry.event === 'ghost_move'));
    assert.ok(feedbackSync.log.some((entry) => entry.event === 'ghost_collision'));
    assert.ok(feedbackSync.log.some((entry) => entry.event === 'hazard_hit' && entry.hazardType === 'ghost'));

    // Advance past feedback window
    mock.timers.tick(5000);

    const sync = display.sent.at(-1).state;
    assert.equal(sync.summary.livesRemaining, 2);
    assert.equal(sync.summary.resets, 1);
    assert.ok(sync.log.some((entry) => entry.event === 'reset' && entry.hazardType === 'ghost'));
  } finally {
    mock.timers.reset();
  }
});

test('repeated resets advance maze variant into hard mode without ghosts', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { manager, display, controllers, sessionId } = bootstrapGame(2);
    const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
    const session = manager.sessions.get(sessionId);

    session.state.maze = makeOpenMaze({
      hazards: [{ row: 0, col: 1 }],
    });
    assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
    mock.timers.tick(5000);
    const firstResetState = display.sent.at(-1).state;
    assert.equal(firstResetState.summary.resets, 1);
    assert.equal(firstResetState.mazeMeta.layoutVariant, 'tight-corners');
    assert.equal(firstResetState.mazeMeta.hardMode, false);
    assert.equal(firstResetState.mazeMeta.ghostCount, 0);

    session.state.maze = makeOpenMaze({
      hazards: [{ row: 0, col: 1 }],
      playerPos: { row: 0, col: 0 },
    });
    assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
    mock.timers.tick(5000);
    const secondResetState = display.sent.at(-1).state;
    assert.equal(secondResetState.summary.resets, 2);
    assert.equal(secondResetState.mazeMeta.layoutVariant, 'hard-mode');
    assert.equal(secondResetState.mazeMeta.hardMode, true);
    assert.equal(secondResetState.mazeMeta.ghostCount, 0);
  } finally {
    mock.timers.reset();
  }
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

test('hidden exit behaves like a normal cell until three keys are collected', () => {
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
  assert.equal(sync.state.log.some((entry) => entry.event === 'goal_locked'), false);
  assert.equal(sync.state.log.at(-1).event, 'move');
  assert.equal(sync.state.log.at(-1).result, 'ok');
});

test('key-seer only sees exit after collecting all keys', () => {
  const { manager, controllers, sessionId } = bootstrapGame(4);
  const keySeer = findControllerByRole(controllers, MazeRole.KEY_SEER);
  const session = manager.sessions.get(sessionId);

  assert.ok(keySeer);
  assert.equal(latestState(keySeer).roleData.goal, null);

  session.state.summary.keysCollected = 3;
  manager.broadcastState(sessionId);

  assert.deepEqual(latestState(keySeer).roleData.goal, session.state.maze.goal);
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
  const { manager, display, trainer, controllers, sessionId } = bootstrapGame(2);
  const moverId = registerPlayerId(findControllerByRole(controllers, MazeRole.MOVER));
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    goal: { row: 0, col: 1 },
  });
  session.state.summary.keysCollected = 3;

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);
  assert.equal(latestState(trainer).canRestart, true);
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

test('phase timers auto-advance through gameplay phases and enter follow-up', () => {
  const { manager, display, sessionId } = bootstrapGame(2);

  let state = display.sent.at(-1).state;
  assert.equal(state.phaseFlow.phaseType, 'gameplay');
  assert.equal(state.phaseFlow.currentPhase, 1);
  const phase1End = state.timer.expiresAt;

  assert.equal(manager.tickTimers(phase1End), 1);
  state = display.sent.at(-1).state;
  assert.equal(state.status, GameStatus.PLAYING);
  assert.equal(state.phaseFlow.currentPhase, 2);
  assert.equal(state.timer.durationMs, 10 * 60 * 1000);
  const phase2End = state.timer.expiresAt;

  assert.equal(manager.tickTimers(phase2End), 1);
  state = display.sent.at(-1).state;
  assert.equal(state.status, GameStatus.PLAYING);
  assert.equal(state.phaseFlow.currentPhase, 3);
  assert.equal(state.timer.durationMs, 5 * 60 * 1000);
  const phase3End = state.timer.expiresAt;

  assert.equal(manager.tickTimers(phase3End), 1);
  state = display.sent.at(-1).state;
  assert.equal(state.status, GameStatus.FOLLOW_UP);
  assert.equal(state.phaseFlow.phaseType, 'follow_up');
  assert.equal(state.timer.status, 'idle');
});

test('follow-up can be manually ended by the host/trainer path', () => {
  const { manager, display, sessionId } = bootstrapGame(2);

  const phase1End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase1End);
  const phase2End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase2End);
  const phase3End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase3End);

  assert.equal(display.sent.at(-1).state.status, GameStatus.FOLLOW_UP);
  assert.equal(manager.endFollowUp(sessionId), true);

  const finalState = display.sent.at(-1).state;
  assert.equal(finalState.status, GameStatus.ENDED);
  assert.equal(finalState.summary.outcome, 'success');
  assert.ok(finalState.log.some((entry) => entry.event === 'follow_up_end'));
  assert.ok(finalState.log.some((entry) => entry.event === 'session_end' && entry.reason === 'follow_up_completed'));
});

test('manual timer controls are blocked during scripted flow phases', () => {
  const { manager, display, sessionId } = bootstrapGame(2);

  assert.equal(manager.startTimer(sessionId, 30000), false);
  assert.equal(manager.stopTimer(sessionId), false);
  assert.equal(manager.resetTimer(sessionId, 30000), false);

  const phase1End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase1End);
  const phase2End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase2End);
  const phase3End = display.sent.at(-1).state.timer.expiresAt;
  manager.tickTimers(phase3End);

  assert.equal(display.sent.at(-1).state.status, GameStatus.FOLLOW_UP);
  assert.equal(manager.startTimer(sessionId, 30000), false);
  assert.equal(manager.resetTimer(sessionId, 30000), false);
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
  assert.ok(Array.isArray(sync.state.trainerRoleViews));
  assert.equal(sync.state.trainerRoleViews.length, 2);
  assert.ok(sync.state.roleData.trainerMaze);
  assert.ok(Array.isArray(sync.state.roleData.trainerEvents));
  assert.ok(Array.isArray(sync.state.roleData.trainerRoleViews));
  assert.ok(Array.isArray(sync.state.roleData.observerSignals));
  assert.ok(sync.state.roleData.trainerEvents.every((entry) => typeof entry.eventId === 'string'));
  assert.ok(sync.state.roleData.trainerEvents.every((entry) => entry.snapshot && entry.snapshot.mazeMeta));
  const moverView = sync.state.trainerRoleViews.find((view) => view.viewerRole === MazeRole.MOVER);
  const guideView = sync.state.trainerRoleViews.find((view) => view.viewerRole === MazeRole.GUIDE);
  assert.deepEqual(moverView.assignedRoles, [MazeRole.MOVER, MazeRole.KEY_SEER]);
  assert.deepEqual(guideView.assignedRoles, [MazeRole.GUIDE, MazeRole.NAVIGATOR]);
  assert.ok(moverView.roleData.maze);
  assert.ok(Array.isArray(moverView.roleData.keys));
  assert.ok(Array.isArray(guideView.roleData.hazards));
  assert.ok(guideView.roleData.maze && guideView.roleData.maze.cells);
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

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_add_clarity_event',
      clarityType: 'role_unclear',
    }),
    true
  );

  const targetEventId = display.sent.at(-1).state.log.find((entry) => entry.event === 'clarity_event').eventId;

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
  assert.equal(payload.replayEvents.length, 1);
  assert.equal(payload.replayEvents[0].event, 'clarity_event');
});

test('trainer replay share rejects non-clarity events', () => {
  const { manager, trainer, display, sessionId } = bootstrapGame(2);
  const trainerId = registerPlayerId(trainer);
  const nonClarityEventId = display.sent.at(-1).state.log.find((entry) => entry.event === 'game_start').eventId;

  assert.equal(
    manager.handleInput(sessionId, trainerId, {
      action: 'trainer_share_replay',
      eventId: nonClarityEventId,
    }),
    false
  );

  const state = latestState(trainer);
  assert.ok(state.log.some((entry) => entry.event === 'input_rejected' && entry.reason === 'invalid_replay_event'));
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
  const exported = manager.getSessionExport(sessionId);
  assert.ok(Array.isArray(exported.observer_signals));
  assert.ok(exported.observer_signals.some((entry) => entry.category === 'clarity' && entry.clarityType === 'silent_confusion'));
  assert.ok(exported.observer_signals.some((entry) => entry.category === 'flow' && entry.type === 'phase_start'));
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

test('controller reconnect token can take over before old socket cleanup', () => {
  const { manager, controllers, sessionId } = bootstrapGame(2);
  const originalController = findControllerByRole(controllers, MazeRole.MOVER);
  const reconnectingController = createFakeSocket();
  const registered = originalController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);

  assert.equal(
    manager.joinController(sessionId, { name: 'Replacement', reconnectToken: registered.reconnectToken }, reconnectingController),
    true
  );

  const reconnectedRegistration = reconnectingController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);
  assert.equal(reconnectedRegistration.playerId, registered.playerId);
  assert.equal(reconnectedRegistration.reconnected, true);
  assert.equal(originalController.sent.at(-1).type, MessageType.JOIN_ERROR);
  assert.equal(originalController.sent.at(-1).code, 'reconnect_replaced');
  assert.equal(originalController.closed, true);
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

test('controller can replace a disconnected gameplay slot after game start', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { manager, controllers, sessionId } = bootstrapGame(2);
  const originalController = findControllerByRole(controllers, MazeRole.MOVER);
  const replacementController = createFakeSocket();
  const registered = originalController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);

  manager.beginDisconnectGrace(originalController, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.equal(manager.joinController(sessionId, { name: 'Replacement' }, replacementController), true);

  const replacementRegistration = replacementController.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED);
  assert.equal(replacementRegistration.playerId, registered.playerId);
  assert.equal(replacementRegistration.reconnected, false);
  assert.ok(typeof replacementRegistration.reconnectToken === 'string');
  assert.notEqual(replacementRegistration.reconnectToken, registered.reconnectToken);

  const sync = replacementController.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.equal(sync.state.viewerRole, latestState(originalController).viewerRole);
});

test('trainer can join while game is already in progress', () => {
  const { manager, sessionId } = bootstrapGame(2);
  const secondTrainer = createFakeSocket();

  assert.equal(manager.joinController(sessionId, { name: 'Observer 2', requestedTrainer: true }, secondTrainer), true);
  assert.equal(latestState(secondTrainer).viewerRole, 'trainer');
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

test('unused session expires after the abandoned timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager({ abandonedSessionTimeoutMs: 2000 });
  const { sessionId } = manager.createSession('http://localhost:3000');

  t.mock.timers.tick(1999);
  assert.ok(manager.sessions.has(sessionId));

  t.mock.timers.tick(1);
  assert.equal(manager.sessions.has(sessionId), false);
});

test('session is deleted after the abandoned timeout once everyone disconnects', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager({ abandonedSessionTimeoutMs: 2000 });
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
  t.mock.timers.tick(1999);

  assert.ok(manager.sessions.has(sessionId));

  t.mock.timers.tick(1);
  assert.equal(manager.sessions.has(sessionId), false);
});

test('display reattach cancels abandoned session cleanup', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const manager = new SessionManager({ abandonedSessionTimeoutMs: 2000 });
  const display = createFakeSocket();
  const replacementDisplay = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.beginDisconnectGrace(display, 'socket_closed', 1000);
  t.mock.timers.tick(1000);

  assert.equal(manager.sessions.get(sessionId).display, null);
  assert.equal(manager.registerDisplay(sessionId, replacementDisplay), true);

  t.mock.timers.tick(2000);
  assert.ok(manager.sessions.has(sessionId));
  assert.equal(manager.sessions.get(sessionId).display, replacementDisplay);
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
