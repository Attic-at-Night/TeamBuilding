function normalizeOrigin(origin) {
  return String(origin || '').replace(/\/+$/, '');
}

function normalizeProtocol(protocol) {
  return String(protocol).toLowerCase() === 'https' ? 'https' : 'http';
}

function isLoopbackHostname(hostname) {
  return /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i.test(String(hostname || ''));
}

function getPublicSessionOrigin({
  publicOrigin,
  requestProtocol,
  requestHost,
  requestHostname,
} = {}) {
  if (publicOrigin) {
    return normalizeOrigin(publicOrigin);
  }

  if (!requestHost || isLoopbackHostname(requestHostname)) {
    return null;
  }

  return `${normalizeProtocol(requestProtocol)}://${requestHost}`;
}

function getSessionOrigin({
  publicOrigin,
  requestProtocol,
  requestHost,
  requestHostname,
  port,
  localIpAddress,
} = {}) {
  const publicSessionOrigin = getPublicSessionOrigin({
    publicOrigin,
    requestProtocol,
    requestHost,
    requestHostname,
  });

  if (publicSessionOrigin) {
    return publicSessionOrigin;
  }

  const protocol = normalizeProtocol(requestProtocol);
  if (localIpAddress) {
    const normalizedPort = String(port || '');
    const portSuffix = normalizedPort && normalizedPort !== '80' && normalizedPort !== '443'
      ? `:${normalizedPort}`
      : '';
    return `${protocol}://${localIpAddress}${portSuffix}`;
  }

  if (requestHost) {
    return `${protocol}://${requestHost}`;
  }

  return `${protocol}://${requestHostname || 'localhost'}`;
}

module.exports = {
  getPublicSessionOrigin,
  getSessionOrigin,
  isLoopbackHostname,
};
