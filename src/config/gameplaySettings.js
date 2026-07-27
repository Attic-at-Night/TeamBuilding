'use strict';

const gameplaySettings = Object.freeze({
  players: Object.freeze({
    min: 2,
    max: 4,
  }),
  lives: Object.freeze({
    start: 3,
    max: 5,
  }),
  maze: Object.freeze({
    width: 8,
    height: 8,
    hazardCount: 5,
    keyCount: 3,
    lifePickupCount: 0,
  }),
  events: Object.freeze({
    recentLimit: 10,
    resetFeedbackMs: 5000,
  }),
  timer: Object.freeze({
    defaultDurationMs: 5 * 60 * 1000,
    gameplayPhaseDurationsMs: Object.freeze([
      15 * 60 * 1000,
      10 * 60 * 1000,
      5 * 60 * 1000,
    ]),
  }),
  session: Object.freeze({
    abandonedTimeoutMs: 10 * 60 * 1000,
  }),
});

module.exports = {
  gameplaySettings,
};
