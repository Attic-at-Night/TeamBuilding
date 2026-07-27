'use strict';

class SessionModel {
  constructor(options = {}) {
    if (!options.sessionManager) throw new TypeError('SessionModel requires a sessionManager.');
    this.sessionManager = options.sessionManager;
  }

  createSession(origin) {
    return this.sessionManager.createSession(origin);
  }

  getSessionExport(sessionId) {
    return this.sessionManager.getSessionExport(sessionId);
  }
}

module.exports = {
  SessionModel,
};
