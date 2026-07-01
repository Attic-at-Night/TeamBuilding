'use strict';

const { PROTOCOL_VERSION } = require('../protocol');

function encodeServerMessage(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload.type !== 'string') {
    return payload;
  }
  if (typeof payload.v === 'number') {
    return payload;
  }
  return { v: PROTOCOL_VERSION, ...payload };
}

function normalizeIncomingMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  if (typeof message.type !== 'string') {
    return null;
  }

  const normalizedVersion = typeof message.v === 'number'
    ? message.v
    : PROTOCOL_VERSION;

  if (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
    return {
      v: normalizedVersion,
      type: message.type,
      ...message.payload,
    };
  }

  return {
    v: normalizedVersion,
    ...message,
  };
}

module.exports = {
  encodeServerMessage,
  normalizeIncomingMessage,
};
