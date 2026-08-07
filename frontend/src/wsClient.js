function normalizeBackendOrigin(origin) {
  if (origin) {
    return origin.replace(/\/+$/, '')
  }
  // No explicit override: use the origin the page was actually loaded from.
  // In dev this lets Vite's own proxy (see vite.config.js) forward /api, /join,
  // and /ws to the real backend, which is always reachable from the Vite dev
  // server itself (same machine/container) even when the browser viewing the
  // page cannot reach "localhost" directly (e.g. remote preview environments
  // like Google AI Studio, where "localhost" resolves to the viewer's own
  // machine, not the container running the app).
  return window.location.origin === 'null' ? '' : window.location.origin
}

function toWsUrl(httpOrigin) {
  const url = new URL(httpOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  return url.toString().replace(/\/$/, '')
}

export function getBackendHttpOrigin() {
  return normalizeBackendOrigin(import.meta.env.VITE_BACKEND_ORIGIN)
}

export function getBackendWsUrl() {
  const explicitWsUrl = import.meta.env.VITE_WS_URL
  if (explicitWsUrl) {
    return explicitWsUrl
  }
  const httpOrigin = getBackendHttpOrigin()
  if (!httpOrigin) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return toWsUrl(httpOrigin)
}

export function createGameSocket({ onOpen, onMessage, onClose, onError }) {
  const socket = new WebSocket(getBackendWsUrl())
  socket.addEventListener('open', () => {
    if (onOpen) {
      onOpen((payload) => {
        socket.send(JSON.stringify(payload))
      })
    }
  })
  socket.addEventListener('message', (event) => {
    if (onMessage) {
      onMessage(JSON.parse(String(event.data)))
    }
  })
  socket.addEventListener('close', () => {
    if (onClose) {
      onClose()
    }
  })
  socket.addEventListener('error', () => {
    if (onError) {
      onError()
    }
  })
  return {
    send(payload) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload))
      }
    },
    close() {
      socket.close()
    },
  }
}
