'use strict';

const crypto = require('crypto');

function makeSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function makeReconnectToken() {
  return crypto.randomUUID();
}

module.exports = {
  makeSessionId,
  makeReconnectToken,
};
