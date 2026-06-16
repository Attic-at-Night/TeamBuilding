const dgram = require('dgram');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function isIPv4Family(family) {
  return family === 'IPv4' || family === 4;
}

function isWirelessInterfaceName(name) {
  return /wi-?fi|wlan|wireless|airport|wl/i.test(name);
}

function interfaceScore(interfaceName, candidate, preferredAddress) {
  if (!candidate || candidate.internal || !isIPv4Family(candidate.family) || !candidate.address) {
    return -1;
  }

  let score = 0;
  if (candidate.address === preferredAddress) {
    score += 1000;
  }

  if (isWirelessInterfaceName(interfaceName)) {
    score += 100;
  }

  if (/eth|en/i.test(interfaceName)) {
    score += 10;
  }

  return score;
}

function pickBestInterface(networkInterfaces, preferredAddress) {
  let best = null;

  for (const [interfaceName, candidates] of Object.entries(networkInterfaces || {})) {
    for (const candidate of candidates || []) {
      const score = interfaceScore(interfaceName, candidate, preferredAddress);
      if (score < 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = {
          score,
          interfaceName,
          address: candidate.address,
        };
      }
    }
  }

  return best ? { interfaceName: best.interfaceName, address: best.address } : null;
}

async function determineRoutedLocalAddress(targetHost = '8.8.8.8', targetPort = 53, timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const done = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
      resolve(value);
    };

    const timeout = setTimeout(() => done(null), timeoutMs);

    socket.on('error', () => {
      clearTimeout(timeout);
      done(null);
    });

    socket.connect(targetPort, targetHost, () => {
      clearTimeout(timeout);
      const address = socket.address();
      done(address && typeof address === 'object' ? address.address : null);
    });
  });
}

function parseNetworkName(rawOutput) {
  const lines = String(rawOutput || '').split(/\r?\n/);

  for (const line of lines) {
    const [active, ssid] = line.split(':');
    if (active === 'yes' && ssid && ssid.trim()) {
      return ssid.trim();
    }
  }

  return null;
}

async function getNetworkName(platform) {
  try {
    if (platform === 'linux') {
      const { stdout } = await execFileAsync('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']);
      return parseNetworkName(stdout);
    }

    if (platform === 'win32') {
      const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces']);
      const match = String(stdout).match(/^\s*SSID\s*:\s*(.+)$/m);
      return match ? match[1].trim() : null;
    }

    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', ['-I']);
      const match = String(stdout).match(/^\s*SSID:\s*(.+)$/m);
      return match ? match[1].trim() : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function detectNetworkConnection({
  networkInterfaces = os.networkInterfaces,
  determineAddress = determineRoutedLocalAddress,
  platform = process.platform,
} = {}) {
  const preferredAddress = await determineAddress();
  const selected = pickBestInterface(networkInterfaces(), preferredAddress);

  if (!selected) {
    return null;
  }

  const networkName = await getNetworkName(platform);

  return {
    ipAddress: selected.address,
    interfaceName: selected.interfaceName,
    networkName,
  };
}

module.exports = {
  detectNetworkConnection,
  determineRoutedLocalAddress,
  isWirelessInterfaceName,
  parseNetworkName,
  pickBestInterface,
};
