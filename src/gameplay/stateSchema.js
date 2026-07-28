'use strict';

function createSummaryState(startLives, overrides = {}) {
  return {
    startedAt: null,
    endedAt: null,
    durationMs: null,
    resets: 0,
    livesRemaining: startLives,
    livesLost: 0,
    livesPickedUp: 0,
    keysCollected: 0,
    outcome: null,
    ...overrides,
  };
}

function createTimerState(overrides = {}) {
  return {
    status: 'idle',
    durationMs: null,
    remainingMs: null,
    startedAt: null,
    expiresAt: null,
    stoppedAt: null,
    ...overrides,
  };
}

module.exports = {
  createSummaryState,
  createTimerState,
};
