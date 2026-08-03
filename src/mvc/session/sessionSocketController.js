'use strict';

const { MessageType, ClientRole, ErrorCode } = require('../../protocol');
const { normalizeIncomingMessage, encodeServerMessage } = require('../../networking/messageEnvelope');
const { HEARTBEAT_INTERVAL_MS, DISCONNECT_GRACE_MS, MAX_MISSED_HEARTBEATS } = require('../../networking/heartbeat');

function createSessionSocketController({ sessionManager, logger = console } = {}) {
  if (!sessionManager) {
    throw new TypeError('SessionSocketController requires a sessionManager.');
  }

  const handlers = {
    [MessageType.DISPLAY_REGISTER](message, socket) {
      sessionManager.registerDisplay(message.sessionId, socket);
    },

    [MessageType.CONTROLLER_JOIN](message, socket) {
      sessionManager.joinController(message.sessionId, {
        name: message.name,
        reconnectToken: message.reconnectToken,
        requestedTrainer: message.requestedTrainer ?? message.isTrainer,
      }, socket);
    },

    [MessageType.SET_GAME_MODE](message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.CONTROLLER && meta.isTrainer) {
        sessionManager.setGameMode(meta.sessionId, message.mode, {
          playerId: meta.playerId,
          isTrainer: true,
        });
      }
    },

    [MessageType.GAME_START](_message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.startGame(meta.sessionId);
      }
    },

    [MessageType.GAME_RESTART](_message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.restartGame(meta.sessionId);
      }
    },

    [MessageType.TIMER_START](message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.startTimer(meta.sessionId, message.durationMs);
      }
    },

    [MessageType.TIMER_STOP](_message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.stopTimer(meta.sessionId);
      }
    },

    [MessageType.TIMER_RESET](message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.resetTimer(meta.sessionId, message.durationMs);
      }
    },

    [MessageType.FOLLOWUP_END](_message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.DISPLAY || (meta?.role === ClientRole.CONTROLLER && meta.isTrainer)) {
        sessionManager.endFollowUp(meta.sessionId);
      }
    },

    [MessageType.FOLLOWUP_NAVIGATE](message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.CONTROLLER && meta.isTrainer) {
        sessionManager.navigateFollowUp(meta.sessionId, message.direction);
      }
    },

    [MessageType.PLAYER_INPUT](message, socket) {
      const meta = socket.meta;
      if (meta?.role === ClientRole.CONTROLLER) {
        sessionManager.handleInput(meta.sessionId, meta.playerId, message.input);
      }
    },

    [MessageType.RESYNC_REQUEST](_message, socket) {
      const meta = socket.meta;
      if (meta?.sessionId) {
        sessionManager.resync(meta.sessionId, socket);
      }
    },
  };

  function socketLogMeta(socket) {
    return {
      sessionId: socket.meta?.sessionId || null,
      role: socket.meta?.role || null,
      playerId: socket.meta?.playerId || null,
    };
  }

  function markSocketResponsive(socket) {
    if ((socket._missedHeartbeats || 0) > 0) {
      logger.info('WebSocket heartbeat recovered.', {
        ...socketLogMeta(socket),
        missedHeartbeats: socket._missedHeartbeats,
      });
    }
    socket.isAlive = true;
    socket._missedHeartbeats = 0;
  }

  function createConnectionHandler() {
    return (socket) => {
      socket.isAlive = true;
      socket._missedHeartbeats = 0;

      const sendJoinError = (message, code) => {
        socket.send(JSON.stringify(encodeServerMessage({
          type: MessageType.JOIN_ERROR,
          message,
          code,
        })));
      };

      socket.on('message', (rawMessage) => {
        markSocketResponsive(socket);
        sessionManager.cancelDisconnectGrace(socket);

        let parsedMessage;
        try {
          parsedMessage = JSON.parse(String(rawMessage));
        } catch {
          logger.warn('Received malformed websocket payload.', {
            sessionId: socket.meta?.sessionId || null,
            role: socket.meta?.role || null,
          });
          sendJoinError('Invalid message format.', ErrorCode.INVALID_MESSAGE_FORMAT);
          return;
        }

        const message = normalizeIncomingMessage(parsedMessage);
        if (!message) {
          logger.warn('Rejected websocket payload with invalid envelope.', {
            sessionId: socket.meta?.sessionId || null,
            role: socket.meta?.role || null,
          });
          sendJoinError('Invalid message format.', ErrorCode.INVALID_MESSAGE_FORMAT);
          return;
        }

        const handler = handlers[message.type];
        if (handler) {
          handler(message, socket);
          return;
        }

        logger.warn('Received unknown websocket message type.', {
          sessionId: socket.meta?.sessionId || null,
          role: socket.meta?.role || null,
          type: message.type,
        });
        sendJoinError('Unknown message type.', ErrorCode.UNKNOWN_MESSAGE_TYPE);
      });

      socket.on('pong', () => {
        markSocketResponsive(socket);
        sessionManager.cancelDisconnectGrace(socket);
      });

      socket.on('error', (error) => {
        logger.warn('WebSocket transport error.', {
          sessionId: socket.meta?.sessionId || null,
          role: socket.meta?.role || null,
          playerId: socket.meta?.playerId || null,
          message: error.message,
        });
      });

      socket.on('close', (code, reasonBuffer) => {
        const reason = reasonBuffer ? String(reasonBuffer) : '';
        logger.warn('WebSocket closed.', {
          sessionId: socket.meta?.sessionId || null,
          role: socket.meta?.role || null,
          playerId: socket.meta?.playerId || null,
          code,
          reason: reason || null,
        });
        sessionManager.beginDisconnectGrace(socket, 'socket_closed', DISCONNECT_GRACE_MS);
      });
    };
  }

  function createHeartbeatInterval(wss) {
    return setInterval(() => {
      for (const socket of wss.clients) {
        if (socket.isAlive === false) {
          socket._missedHeartbeats = (socket._missedHeartbeats || 0) + 1;
          logger.warn('Missed websocket heartbeat.', {
            ...socketLogMeta(socket),
            missedHeartbeats: socket._missedHeartbeats,
            maxMissedHeartbeats: MAX_MISSED_HEARTBEATS,
          });
          if (socket._missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
            sessionManager.beginDisconnectGrace(socket, 'heartbeat_timeout', DISCONNECT_GRACE_MS);
            try {
              socket.terminate();
            } catch {
              // Ignore terminate failures on already-closed sockets.
            }
            continue;
          }
        } else {
          socket._missedHeartbeats = 0;
        }

        socket.isAlive = false;
        try {
          socket.ping();
        } catch {
          sessionManager.beginDisconnectGrace(socket, 'ping_failed', DISCONNECT_GRACE_MS);
          try {
            socket.terminate();
          } catch {
            // Ignore terminate failures on already-closed sockets.
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function createTimerInterval() {
    return setInterval(() => {
      sessionManager.tickTimers();
    }, 1000);
  }

  function createWorldInterval() {
    return setInterval(() => {
      sessionManager.tickWorld();
    }, 1000);
  }

  return {
    handlers,
    socketLogMeta,
    markSocketResponsive,
    createConnectionHandler,
    createHeartbeatInterval,
    createTimerInterval,
    createWorldInterval,
  };
}

module.exports = {
  createSessionSocketController,
};
