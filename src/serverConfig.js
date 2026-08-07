function parsePort(value, fallbackPort = 3000) {
  if (typeof value !== 'string') {
    return fallbackPort;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return fallbackPort;
  }

  const numericValue = Number.parseInt(trimmedValue, 10);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 65535) {
    return fallbackPort;
  }

  return numericValue;
}

function getServerPort(env = process.env, fallbackPort = 3000) {
  return parsePort(env && env.PORT, fallbackPort);
}

module.exports = {
  parsePort,
  getServerPort,
};
