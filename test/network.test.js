const test = require('node:test');
const assert = require('node:assert/strict');
const { pickBestInterface, parseNetworkName } = require('../src/network');

test('pickBestInterface prefers routed address when provided', () => {
  const selected = pickBestInterface({
    eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
    wlan0: [{ address: '192.168.1.25', family: 'IPv4', internal: false }],
  }, '192.168.1.20');

  assert.deepEqual(selected, {
    interfaceName: 'eth0',
    address: '192.168.1.20',
  });
});

test('pickBestInterface prefers wireless adapter when routed address is unknown', () => {
  const selected = pickBestInterface({
    Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
    WiFi: [{ address: '192.168.1.25', family: 'IPv4', internal: false }],
  });

  assert.deepEqual(selected, {
    interfaceName: 'WiFi',
    address: '192.168.1.25',
  });
});

test('parseNetworkName extracts active SSID from nmcli output', () => {
  const parsed = parseNetworkName('no:Guest\nyes:HomeNetwork\n');
  assert.equal(parsed, 'HomeNetwork');
});
