'use strict';

function registerSessionRoutes(app, sessionController) {
  app.post('/api/session', sessionController.createSession);
  app.get('/api/session/:sessionId/log', sessionController.getSessionLog);
}

module.exports = {
  registerSessionRoutes,
};
