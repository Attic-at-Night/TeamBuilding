const test = require('node:test');
const assert = require('node:assert/strict');
const { getJoinRedirectLocation } = require('../src/url');

test('join redirect preserves query string', () => {
  assert.equal(getJoinRedirectLocation('/join?session=ABC123'), '/join.html?session=ABC123');
});

test('join redirect without query points to join.html', () => {
  assert.equal(getJoinRedirectLocation('/join'), '/join.html');
});
