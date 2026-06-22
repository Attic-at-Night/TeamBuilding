const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getJoinRedirectLocation,
  getPublicSessionOrigin,
  getSessionOrigin,
  isLoopbackHostname,
} = require('../src/url');

test('join redirect preserves query string', () => {
  assert.equal(getJoinRedirectLocation('/join?session=ABC123'), '/join.html?session=ABC123');
});

test('join redirect without query points to join.html', () => {
  assert.equal(getJoinRedirectLocation('/join'), '/join.html');
});

test('detects loopback hostnames', () => {
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('example.com'), false);
});

test('prefers hosted request origin for public deployments', () => {
  assert.equal(getPublicSessionOrigin({
    requestProtocol: 'https',
    requestHost: 'play.example.com',
    requestHostname: 'play.example.com',
  }), 'https://play.example.com');
});

test('supports PUBLIC_ORIGIN override', () => {
  assert.equal(getPublicSessionOrigin({
    publicOrigin: 'https://party.example.com/',
    requestProtocol: 'http',
    requestHost: 'localhost:3000',
    requestHostname: 'localhost',
  }), 'https://party.example.com');
});

test('falls back to local IP for localhost sessions', () => {
  assert.equal(getSessionOrigin({
    requestProtocol: 'http',
    requestHost: 'localhost:3000',
    requestHostname: 'localhost',
    port: 3000,
    localIpAddress: '192.168.1.25',
  }), 'http://192.168.1.25:3000');
});
