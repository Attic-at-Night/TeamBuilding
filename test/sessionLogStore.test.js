const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionLogStore } = require('../src/sessionLogStore');

test('SessionLogStore saves and loads session export JSON', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-log-store-'));
  const store = new SessionLogStore({ baseDir: tempDir });
  const payload = {
    session_id: 'ABC123',
    events: [{ t: 0, type: 'game_start' }],
  };

  const filePath = store.save('ABC123', payload);
  assert.equal(fs.existsSync(filePath), true);

  const loaded = store.load('ABC123');
  assert.deepEqual(loaded, payload);
});

test('SessionLogStore returns null for missing logs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-log-store-'));
  const store = new SessionLogStore({ baseDir: tempDir });
  assert.equal(store.load('MISSING'), null);
});
