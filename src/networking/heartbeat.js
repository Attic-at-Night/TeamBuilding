'use strict';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 4000;
const DEFAULT_DISCONNECT_GRACE_MS = 60000;
const DEFAULT_MAX_MISSED_HEARTBEATS = 3;
const MIN_HEARTBEAT_INTERVAL_MS = 1000;
const MIN_DISCONNECT_GRACE_MS = 5000;
const MIN_MAX_MISSED_HEARTBEATS = 1;

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function readMsEnv(name, fallback, min) {
  const parsed = parsePositiveInteger(process.env[name]);
  if (parsed === null) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function readCountEnv(name, fallback, min) {
  const parsed = parsePositiveInteger(process.env[name]);
  if (parsed === null) {
    return fallback;
  }
  return Math.max(min, parsed);
}

const HEARTBEAT_INTERVAL_MS = readMsEnv(
  'WS_HEARTBEAT_INTERVAL_MS',
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS
);

const DISCONNECT_GRACE_MS = Math.max(
  readMsEnv(
    'WS_DISCONNECT_GRACE_MS',
    DEFAULT_DISCONNECT_GRACE_MS,
    MIN_DISCONNECT_GRACE_MS
  ),
  HEARTBEAT_INTERVAL_MS * 2
);

const MAX_MISSED_HEARTBEATS = readCountEnv(
  'WS_MAX_MISSED_HEARTBEATS',
  DEFAULT_MAX_MISSED_HEARTBEATS,
  MIN_MAX_MISSED_HEARTBEATS
);

module.exports = {
  HEARTBEAT_INTERVAL_MS,
  DISCONNECT_GRACE_MS,
  MAX_MISSED_HEARTBEATS,
};
