(function initTeamBuildingScreenDependencies() {
  'use strict';

  function resolveWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}`;
  }

  function createBaseDependencies() {
    return {
      location: window.location,
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      openWebSocket: () => new WebSocket(resolveWebSocketUrl()),
    };
  }

  function createDisplayDependencies() {
    return Object.freeze({
      ...createBaseDependencies(),
      fetchSessionBootstrap: async () => {
        const response = await window.fetch('/api/session', { method: 'POST' });
        return response.json();
      },
    });
  }

  function createControllerDependencies() {
    return Object.freeze({
      ...createBaseDependencies(),
      storage: window.localStorage,
      searchParams: () => new URLSearchParams(window.location.search),
    });
  }

  window.TeamBuildingScreenDependencies = Object.freeze({
    createDisplayDependencies,
    createControllerDependencies,
  });
}());
