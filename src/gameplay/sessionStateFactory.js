'use strict';

const { GameStatus } = require('../protocol');
const { generateMaze } = require('../maze');
const { createSummaryState, createTimerState } = require('./stateSchema');
const { gameplaySettings } = require('../config/gameplaySettings');

function createPhaseFlowState(overrides = {}) {
  return {
    phaseType: 'lobby',
    currentPhase: null,
    totalGameplayPhases: gameplaySettings.timer.gameplayPhaseDurationsMs.length,
    phaseDurationMs: null,
    phaseRemainingMs: null,
    phaseStartedAt: null,
    phaseEndsAt: null,
    followingPhase: null,
    ...overrides,
  };
}

function makeInitialState() {
  return {
    status: GameStatus.LOBBY,
    players: [],
    roles: {},
    maze: null,
    log: [],
    nextEventId: 1,
    trainer: null,
    trainerBroadcast: null,
    trainerHighlightEventIds: [],
    aiSuggestionDecisions: {},
    summary: createSummaryState(gameplaySettings.lives.start),
    timer: createTimerState(),
    phaseFlow: createPhaseFlowState(),
    pendingReset: null,
    followUpFocusedEventId: null,
  };
}

function createRoundMaze(overrides = {}, generationOptions = undefined) {
  const mazeSettings = gameplaySettings.maze;
  const width = Number.isFinite(overrides.width) ? overrides.width : mazeSettings.width;
  const height = Number.isFinite(overrides.height) ? overrides.height : mazeSettings.height;
  const hazardCount = Number.isFinite(overrides.hazardCount) ? overrides.hazardCount : mazeSettings.hazardCount;
  const keyCount = Number.isFinite(overrides.keyCount) ? overrides.keyCount : mazeSettings.keyCount;
  const lifePickupCount = Number.isFinite(overrides.lifePickupCount)
    ? overrides.lifePickupCount
    : mazeSettings.lifePickupCount;
  return generateMaze(width, height, hazardCount, keyCount, lifePickupCount, generationOptions);
}

module.exports = {
  createPhaseFlowState,
  makeInitialState,
  createRoundMaze,
};
