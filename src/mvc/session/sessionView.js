'use strict';

function sendCreated(res, payload) {
  res.json({
    sessionId: payload.sessionId,
    joinUrl: payload.joinUrl,
    qrCodeDataUrl: payload.qrCodeDataUrl,
    connection: payload.connection,
  });
}

function sendLog(res, sessionLog) {
  if (!sessionLog) {
    res.status(404).json({ error: 'Session log not found.' });
    return;
  }
  res.json(sessionLog);
}

module.exports = {
  sendCreated,
  sendLog,
};
