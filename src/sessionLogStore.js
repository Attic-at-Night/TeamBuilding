const fs = require('fs');
const path = require('path');

class SessionLogStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.join(process.cwd(), 'session-logs');
  }

  save(sessionId, payload) {
    const filePath = this._getFilePath(sessionId);
    fs.mkdirSync(this.baseDir, { recursive: true });

    const tempPath = `${filePath}.tmp`;
    const json = JSON.stringify(payload, null, 2);
    fs.writeFileSync(tempPath, json, 'utf8');
    fs.renameSync(tempPath, filePath);
    return filePath;
  }

  load(sessionId) {
    const filePath = this._getFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  _getFilePath(sessionId) {
    const safeId = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
    return path.join(this.baseDir, `${safeId}.json`);
  }
}

module.exports = { SessionLogStore };
