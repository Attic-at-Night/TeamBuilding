'use strict';

function registerSessionRoutes(app, sessionController) {
  if (!app) {
    throw new TypeError('registerSessionRoutes requires an express app instance.');
  }
  if (!sessionController || typeof sessionController.createSession !== 'function' || typeof sessionController.getSessionLog !== 'function') {
    throw new TypeError('registerSessionRoutes requires a sessionController with createSession and getSessionLog handlers.');
  }

  app.post('/api/session', sessionController.createSession);
  app.get('/api/session/:sessionId/log', sessionController.getSessionLog);
}

module.exports = {
  registerSessionRoutes,
};
