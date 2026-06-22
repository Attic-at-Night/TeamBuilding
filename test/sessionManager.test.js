const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('../src/sessionManager');
const { MessageType, GameStatus, ClientRole } = require('../src/protocol');

function createFakeSocket() {
  return {
    sent: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
  };
}

test('display registers and receives client_registered + state_sync', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.registerDisplay(sessionId, display), true);

  const registered = display.sent.find(m => m.type === MessageType.CLIENT_REGISTERED);
  assert.ok(registered, 'client_registered message sent');
  assert.equal(registered.role, ClientRole.DISPLAY);
  assert.equal(registered.sessionId, sessionId);

  const sync = display.sent.find(m => m.type === MessageType.STATE_SYNC);
  assert.ok(sync, 'state_sync message sent');
  assert.equal(sync.state.status, GameStatus.LOBBY);
  assert.deepEqual(sync.state.players, []);
});

test('display gets error for unknown session', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();

  assert.equal(manager.registerDisplay('NOPE', display), false);
  assert.equal(display.sent.at(-1).type, MessageType.JOIN_ERROR);
});

test('controller joins active session and all clients receive state_sync', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const controller = createFakeSocket();

  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', controller);

  const registered = controller.sent.find(m => m.type === MessageType.CLIENT_REGISTERED);
  assert.ok(registered, 'controller receives client_registered');
  assert.equal(registered.role, ClientRole.CONTROLLER);
  assert.ok(registered.playerId, 'playerId is present');

  const sync = display.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.equal(sync.state.players.length, 1);
  assert.equal(sync.state.players[0].name, 'Alex');
});

test('controller gets error when display not connected', () => {
  const manager = new SessionManager();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.joinController(sessionId, 'Alex', controller), false);
  assert.equal(controller.sent.at(-1).type, MessageType.JOIN_ERROR);
});

test('game_start transitions status to playing for all clients', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', controller);
  manager.startGame(sessionId);

  assert.equal(display.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(display.sent.at(-1).state.status, GameStatus.PLAYING);

  assert.equal(controller.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(controller.sent.at(-1).state.status, GameStatus.PLAYING);
});

test('mover move input logs event and broadcasts state_sync', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const controller = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', controller);
  manager.startGame(sessionId);

  const { playerId } = controller.sent.find(m => m.type === MessageType.CLIENT_REGISTERED);

  // 'e' may be open or wall – either way it is a valid maze event that is logged.
  const result = manager.handleInput(sessionId, playerId, { action: 'move', dir: 'e' });
  assert.equal(result, true);

  const sync = display.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.ok(sync.state.log.some(e => e.event === 'move' && e.dir === 'e'), 'move logged');
});

test('closing display closes session and notifies controllers', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const controller = createFakeSocket();

  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', controller);

  manager.removeConnection(display);

  assert.equal(controller.sent.at(-1).type, MessageType.SESSION_CLOSED);
  assert.equal(manager.sessions.has(sessionId), false);
});

test('controller disconnect updates player list via state_sync', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const controller = createFakeSocket();

  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Alex', controller);
  manager.removeConnection(controller);

  const sync = display.sent.at(-1);
  assert.equal(sync.type, MessageType.STATE_SYNC);
  assert.equal(sync.state.players.length, 0);
});

test('resync sends current state to requesting socket', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerDisplay(sessionId, display);

  const reconnected = createFakeSocket();
  manager.resync(sessionId, reconnected);

  assert.equal(reconnected.sent.at(-1).type, MessageType.STATE_SYNC);
  assert.equal(reconnected.sent.at(-1).state.status, GameStatus.LOBBY);
});

test('startGame assigns roles and generates a 14x14 maze', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const c1 = createFakeSocket();
  const c2 = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Mover', c1);
  manager.joinController(sessionId, 'Guide', c2);
  manager.startGame(sessionId);

  const sync = display.sent.at(-1);
  assert.equal(sync.state.status, GameStatus.PLAYING);
  assert.ok(sync.state.maze, 'maze sub-state created');
  assert.equal(sync.state.maze.width, 14);
  assert.equal(sync.state.maze.height, 14);
  assert.equal(sync.state.maze.playerPos.row, 0);
  assert.equal(sync.state.maze.playerPos.col, 0);
  assert.equal(sync.state.maze.hazards.length, 12);

  const roles = sync.state.roles;
  const movers = Object.values(roles).filter(v => v === 'mover');
  const guides = Object.values(roles).filter(v => v === 'guide');
  assert.equal(movers.length, 1, 'exactly one mover');
  assert.equal(guides.length, 1, 'exactly one guide');

  const id1 = c1.sent.find(m => m.type === MessageType.CLIENT_REGISTERED).playerId;
  assert.equal(roles[id1], 'mover', 'first joiner is mover');
});

test('guide input is rejected without state change', () => {
  const manager = new SessionManager();
  const display = createFakeSocket();
  const c1 = createFakeSocket();
  const c2 = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  manager.registerDisplay(sessionId, display);
  manager.joinController(sessionId, 'Mover', c1);
  manager.joinController(sessionId, 'Guide', c2);
  manager.startGame(sessionId);

  const { playerId: guideId } = c2.sent.find(m => m.type === MessageType.CLIENT_REGISTERED);
  const beforeCount = display.sent.length;

  const result = manager.handleInput(sessionId, guideId, { action: 'move', dir: 'e' });
  assert.equal(result, false, 'guide input rejected');
  assert.equal(display.sent.length, beforeCount, 'no extra broadcast on rejected input');
});
