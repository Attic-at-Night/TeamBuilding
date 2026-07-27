'use strict';

class SessionModel {
  constructor(options = {}) {
    this.sessionManager = options.sessionManager || null;
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
