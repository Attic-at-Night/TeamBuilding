const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('../src/sessionManager');

function createFakeSocket() {
  return {
    sent: [],
    send(message) {
      this.sent.push(JSON.parse(message));
    },
  };
}

test('participant joins active hosted session', () => {
  const manager = new SessionManager();
  const host = createFakeSocket();
  const participant = createFakeSocket();

  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.registerHost(sessionId, host), true);
  assert.equal(manager.joinParticipant(sessionId, 'Alex', participant), true);

  assert.equal(participant.sent.at(-1).type, 'joined');
  assert.equal(host.sent.at(-1).type, 'participants_update');
  assert.equal(host.sent.at(-1).participants.length, 1);
  assert.equal(host.sent.at(-1).participants[0].name, 'Alex');
});

test('participant gets error when host not connected', () => {
  const manager = new SessionManager();
  const participant = createFakeSocket();
  const { sessionId } = manager.createSession('http://localhost:3000');

  assert.equal(manager.joinParticipant(sessionId, 'Alex', participant), false);
  assert.equal(participant.sent.at(-1).type, 'join_error');
});

test('closing host closes session for participants', () => {
  const manager = new SessionManager();
  const host = createFakeSocket();
  const participant = createFakeSocket();

  const { sessionId } = manager.createSession('http://localhost:3000');
  manager.registerHost(sessionId, host);
  manager.joinParticipant(sessionId, 'Alex', participant);

  manager.removeConnection(host);

  assert.equal(participant.sent.at(-1).type, 'session_closed');
  assert.equal(manager.sessions.has(sessionId), false);
});
