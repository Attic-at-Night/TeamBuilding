'use strict';

const { sendCreated, sendLog } = require('./sessionView');

class SessionController {
  constructor(options = {}) {
    this.sessionModel = options.sessionModel;
    this.detectNetworkConnection = options.detectNetworkConnection;
    this.getPublicSessionOrigin = options.getPublicSessionOrigin;
    this.getSessionOrigin = options.getSessionOrigin;
    this.toQrDataUrl = options.toQrDataUrl;
    this.resolveServerPort = options.resolveServerPort;
    this.publicOrigin = options.publicOrigin || null;
    this.qrCodeWidth = options.qrCodeWidth ?? 320;
    this.qrCodeMargin = options.qrCodeMargin ?? 1;

    this.createSession = this.createSession.bind(this);
    this.getSessionLog = this.getSessionLog.bind(this);
  }

  async createSession(req, res) {
    const port = this.resolveServerPort();
    const requestHost = req.get('x-forwarded-host') || req.get('host');
    const requestProtocol = req.get('x-forwarded-proto') || req.protocol;
    const requestHostname = requestHost ? requestHost.split(':')[0] : req.hostname;
    const publicOrigin = this.getPublicSessionOrigin({
      publicOrigin: this.publicOrigin,
      requestProtocol,
      requestHost,
      requestHostname,
    });
    const connection = publicOrigin ? null : await this.detectNetworkConnection();
    const origin = this.getSessionOrigin({
      publicOrigin: this.publicOrigin,
      requestProtocol,
      requestHost,
      requestHostname,
      port,
      localIpAddress: connection && connection.ipAddress ? connection.ipAddress : null,
    });
    const { sessionId, joinUrl } = this.sessionModel.createSession(origin);
    const qrCodeDataUrl = await this.toQrDataUrl(joinUrl, {
      margin: this.qrCodeMargin,
      width: this.qrCodeWidth,
    });

    sendCreated(res, { sessionId, joinUrl, qrCodeDataUrl, connection });
  }

  getSessionLog(req, res) {
    const sessionId = String(req.params.sessionId || '').toUpperCase();
    const sessionLog = this.sessionModel.getSessionExport(sessionId);
    sendLog(res, sessionLog);
  }
}

module.exports = {
  SessionController,
};
