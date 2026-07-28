(function initTeamBuildingViewSettings() {
  'use strict';

  window.TeamBuildingViewSettings = Object.freeze({
    display: Object.freeze({
      width: 1280,
      height: 720,
      backgroundColor: '#1a1a2e',
    }),
    controller: Object.freeze({
      width: 390,
      height: 844,
      backgroundColor: '#1a1a2e',
      connectionProbeIntervalMs: 12000,
      connectionProbeTimeoutMs: 3500,
      connectionWarningLatencyMs: 1200,
      connectionWarningLatencyStreak: 2,
    }),
  });
}());
