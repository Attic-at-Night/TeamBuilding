const test = require('node:test');
const assert = require('node:assert/strict');

const heartbeatModulePath = require.resolve('../src/networking/heartbeat');

function loadHeartbeatWithEnv(envOverrides) {
  const originalHeartbeat = process.env.WS_HEARTBEAT_INTERVAL_MS;
  const originalGrace = process.env.WS_DISCONNECT_GRACE_MS;

  if (envOverrides.WS_HEARTBEAT_INTERVAL_MS == null) {
    delete process.env.WS_HEARTBEAT_INTERVAL_MS;
  } else {
    process.env.WS_HEARTBEAT_INTERVAL_MS = String(envOverrides.WS_HEARTBEAT_INTERVAL_MS);
  }

  if (envOverrides.WS_DISCONNECT_GRACE_MS == null) {
    delete process.env.WS_DISCONNECT_GRACE_MS;
  } else {
    process.env.WS_DISCONNECT_GRACE_MS = String(envOverrides.WS_DISCONNECT_GRACE_MS);
  }

  delete require.cache[heartbeatModulePath];
  const heartbeat = require('../src/networking/heartbeat');

  if (originalHeartbeat == null) {
    delete process.env.WS_HEARTBEAT_INTERVAL_MS;
  } else {
    process.env.WS_HEARTBEAT_INTERVAL_MS = originalHeartbeat;
  }

  if (originalGrace == null) {
    delete process.env.WS_DISCONNECT_GRACE_MS;
  } else {
    process.env.WS_DISCONNECT_GRACE_MS = originalGrace;
  }

  delete require.cache[heartbeatModulePath];
  return heartbeat;
}

test('heartbeat defaults are mobile-tolerant', () => {
  const heartbeat = loadHeartbeatWithEnv({
    WS_HEARTBEAT_INTERVAL_MS: null,
    WS_DISCONNECT_GRACE_MS: null,
  });

  assert.equal(heartbeat.HEARTBEAT_INTERVAL_MS, 4000);
  assert.equal(heartbeat.DISCONNECT_GRACE_MS, 60000);
});

test('heartbeat honors explicit environment overrides', () => {
  const heartbeat = loadHeartbeatWithEnv({
    WS_HEARTBEAT_INTERVAL_MS: 5000,
    WS_DISCONNECT_GRACE_MS: 45000,
  });

  assert.equal(heartbeat.HEARTBEAT_INTERVAL_MS, 5000);
  assert.equal(heartbeat.DISCONNECT_GRACE_MS, 45000);
});

test('disconnect grace is clamped to at least two heartbeat intervals', () => {
  const heartbeat = loadHeartbeatWithEnv({
    WS_HEARTBEAT_INTERVAL_MS: 5000,
    WS_DISCONNECT_GRACE_MS: 6000,
  });

  assert.equal(heartbeat.HEARTBEAT_INTERVAL_MS, 5000);
  assert.equal(heartbeat.DISCONNECT_GRACE_MS, 10000);
});

