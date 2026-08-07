const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePort, getServerPort } = require('../src/serverConfig');

test('parsePort returns numeric ports', () => {
  assert.equal(parsePort('4000', 3000), 4000);
  assert.equal(parsePort('080', 3000), 80);
});

test('parsePort falls back when the value is invalid', () => {
  assert.equal(parsePort('not-a-port', 3000), 3000);
  assert.equal(parsePort('70000', 3000), 3000);
  assert.equal(parsePort('0', 3000), 3000);
});

test('getServerPort reads the PORT environment variable', () => {
  assert.equal(getServerPort({ PORT: '5000' }, 3000), 5000);
  assert.equal(getServerPort({}, 3000), 3000);
});
