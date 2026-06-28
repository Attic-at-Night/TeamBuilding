const test = require('node:test');
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
    seed: 'test-seed',
    width: 2,
    height: 2,
    cells,
    hazards: overrides.hazards || [],
    keys: overrides.keys || [],
    lifePickups: overrides.lifePickups || [],
    goal: overrides.goal || { row: 1, col: 1 },
    playerPos: overrides.playerPos || { row: 0, col: 0 },
    reached: overrides.reached || false,
    hitHazards: overrides.hitHazards || 0,
  };
}

function bootstrapGame(gameplayPlayerCount) {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const session = manager.createSession('http://localhost:3000');
  manager.registerDisplay(session.sessionId, display);

  const trainer = createFakeSocket();
  manager.joinController(session.sessionId, 'Trainer', trainer);

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

test('first controller becomes hidden trainer in lobby', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const trainer = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', trainer);

  const sync = trainer.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.equal(sync.state.viewerRole, 'trainer');
  assert.equal(sync.state.players.length, 0);
});

test('session rejects joins after four players', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Trainer', createFakeSocket());

  for (let i = 0; i < 4; i++) {
    const socket = createFakeSocket();
    assert.equal(manager.joinController(sessionId, `P${i + 1}`, socket), true);
  }

  const overflow = createFakeSocket();
  assert.equal(manager.joinController(sessionId, 'Overflow', overflow), false);
  assert.equal(overflow.sent.at(-1).type, MessageType.JOIN_ERROR);
  assert.equal(overflow.sent.at(-1).message, 'Session is full.');
});

test('startGame assigns gameplay roles while trainer remains observer', () => {
  const { display, trainer, controllers } = bootstrapGame(4);

  assert.equal(display.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(display.sent.at(-1).state.status, GameStatus.PLAYING);
  assert.equal(trainer.sent.at(-1).state.viewerRole, 'trainer');

  assert.equal(controllers[0].sent.at(-1).state.viewerRole, MazeRole.MOVER);
  assert.ok(controllers[0].sent.at(-1).state.roleData.maze);
  assert.equal(controllers[0].sent.at(-1).state.roleData.maze.hazards, undefined);
  assert.ok(Array.isArray(controllers[0].sent.at(-1).state.roleData.maze.lifePickups));
  assert.equal(controllers[0].sent.at(-1).state.summary.livesRemaining, undefined);

  assert.equal(controllers[1].sent.at(-1).state.viewerRole, MazeRole.GUIDE);
  assert.ok(Array.isArray(controllers[1].sent.at(-1).state.roleData.hazards));
  assert.ok(controllers[1].sent.at(-1).state.roleData.goal);
  assert.ok(controllers[1].sent.at(-1).state.roleData.playerPos);

  assert.equal(controllers[2].sent.at(-1).state.viewerRole, MazeRole.KEY_SEER);
  assert.ok(Array.isArray(controllers[2].sent.at(-1).state.roleData.keys));
  assert.ok(controllers[2].sent.at(-1).state.roleData.playerPos);

  assert.equal(controllers[3].sent.at(-1).state.viewerRole, MazeRole.LIFE_KEEPER);
  assert.equal(typeof controllers[3].sent.at(-1).state.roleData.livesRemaining, 'number');
  assert.ok(controllers[3].sent.at(-1).state.roleData.playerPos);
});

test('mover pickup updates key progress and logs the pickup', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
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
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
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
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
  const session = manager.sessions.get(sessionId);
  session.state.maze = makeOpenMaze({
    hazards: [{ row: 0, col: 1 }],
  });

  assert.equal(manager.handleInput(sessionId, moverId, { action: 'move', dir: 'e' }), true);

  const sync = display.sent.at(-1);
  const liveState = manager.sessions.get(sessionId).state;
  assert.equal(sync.state.summary.livesRemaining, 2);
  assert.equal(sync.state.summary.resets, 1);
  assert.ok(sync.state.log.some((entry) => entry.event === 'hazard_hit'));
  assert.ok(sync.state.log.some((entry) => entry.event === 'reset'));
  assert.deepEqual(liveState.maze.playerPos, { row: 0, col: 0 });
});

test('goal unlocks only after three keys are collected', () => {
  const { manager, display, controllers, sessionId } = bootstrapGame(2);
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
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
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
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
  const moverId = controllers[0].sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;
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

test('trainer can broadcast JSON payloads to display state', () => {
  const { manager, display, trainer, sessionId } = bootstrapGame(2);
  const trainerId = trainer.sent.find((m) => m.type === MessageType.CLIENT_REGISTERED).playerId;

  assert.equal(
    manager.handleInput(sessionId, trainerId, { action: 'trainer_broadcast', payload: { note: 'Discuss reset timing' } }),
    true
  );

  const sync = display.sent.at(-1);
  assert.equal(sync.state.trainerBroadcast.payload.note, 'Discuss reset timing');
  assert.ok(sync.state.log.some((entry) => entry.event === 'trainer_broadcast'));
});
