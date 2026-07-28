const test = require('node:test');
const assert = require('node:assert/strict');
const { PROTOCOL_VERSION } = require('../src/protocol');
const { encodeServerMessage, normalizeIncomingMessage } = require('../src/networking/messageEnvelope');

test('encodeServerMessage adds protocol version to outbound typed payloads', () => {
  const encoded = encodeServerMessage({ type: 'state_sync', state: { status: 'lobby' } });
  assert.equal(encoded.v, PROTOCOL_VERSION);
  assert.equal(encoded.type, 'state_sync');
});

test('normalizeIncomingMessage supports legacy flat message payloads', () => {
  const normalized = normalizeIncomingMessage({ type: 'controller_join', sessionId: 'ABCD', name: 'Alex' });
  assert.equal(normalized.type, 'controller_join');
  assert.equal(normalized.sessionId, 'ABCD');
  assert.equal(normalized.name, 'Alex');
  assert.equal(normalized.v, PROTOCOL_VERSION);
});

test('normalizeIncomingMessage supports envelope payload format', () => {
  const normalized = normalizeIncomingMessage({
    v: 1,
    type: 'controller_join',
    payload: { sessionId: 'ABCD', name: 'Alex' },
  });
  assert.equal(normalized.type, 'controller_join');
  assert.equal(normalized.sessionId, 'ABCD');
  assert.equal(normalized.name, 'Alex');
  assert.equal(normalized.v, 1);
});

test('normalizeIncomingMessage rejects non-object or typeless payloads', () => {
  assert.equal(normalizeIncomingMessage(null), null);
  assert.equal(normalizeIncomingMessage({ payload: { sessionId: 'ABCD' } }), null);
});
