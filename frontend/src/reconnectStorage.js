/**
 * Reconnect state persistence helpers.
 *
 * These functions are the only place that reads/writes reconnect tokens to
 * localStorage. Keeping them isolated here means frontend UI work can never
 * accidentally break the server-level reconnect handshake.
 *
 * Storage shape: { playerId: string, reconnectToken: string, name: string }
 * Storage key:   "teambuilding.reconnect.<SESSIONID>"
 */

export function storageKey(sessionId) {
  return `teambuilding.reconnect.${sessionId}`
}

export function loadReconnectState(sessionId) {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveReconnectState(sessionId, payload) {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(payload))
  } catch {
    // Ignore storage failures (private browsing, quota exceeded, etc.)
  }
}

export function clearReconnectState(sessionId) {
  try {
    localStorage.removeItem(storageKey(sessionId))
  } catch {
    // Ignore storage failures.
  }
}
