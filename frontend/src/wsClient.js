function normalizeBackendOrigin(origin) {
  if (origin) {
    return origin.replace(/\/+$/, '')
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }
  return window.location.origin === 'null' ? '' : window.location.origin
}

function toWsUrl(httpOrigin) {
  const url = new URL(httpOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/'
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
    return `${protocol}//${window.location.host}`
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
