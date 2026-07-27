import { useMemo, useState } from 'react'
import './App.css'
import { MessageType, ErrorCode, PROTOCOL_VERSION } from './protocol'
import { createGameSocket, getBackendHttpOrigin } from './wsClient'

const DEFAULT_TIMER_MS = 15 * 60 * 1000

function inferRoleFromPath(pathname) {
  if (pathname.startsWith('/join')) {
    return 'controller'
  }
  if (pathname.startsWith('/display')) {
    return 'display'
  }
  return 'display'
}

function parseSessionFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return (params.get('session') || '').toUpperCase()
}

function parsePlayerNameFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return params.get('name') || ''
}

function App() {
  const [role, setRole] = useState(() => inferRoleFromPath(window.location.pathname))
  const [sessionId, setSessionId] = useState(() => parseSessionFromQuery())
  const [playerName, setPlayerName] = useState(() => parsePlayerNameFromQuery())
  const [timerMs, setTimerMs] = useState(DEFAULT_TIMER_MS)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [socketHandle, setSocketHandle] = useState(null)
  const [lastMessage, setLastMessage] = useState(null)
  const [lastStateSync, setLastStateSync] = useState(null)
  const [errorText, setErrorText] = useState('')

  const backendOrigin = useMemo(() => getBackendHttpOrigin(), [])

  function disconnect() {
    if (socketHandle) {
      socketHandle.close()
      setSocketHandle(null)
    }
    setConnectionState('disconnected')
  }

  async function createSession() {
    setErrorText('')
    const response = await fetch(`${backendOrigin}/api/session`, { method: 'POST' })
    if (!response.ok) {
      throw new Error(`Session creation failed (${response.status})`)
    }
    const payload = await response.json()
    setSessionId(String(payload.sessionId || '').toUpperCase())
  }

  function connect() {
    if (!sessionId) {
      setErrorText('Session ID is required before connecting.')
      return
    }
    if (role === 'controller' && !playerName.trim()) {
      setErrorText('Controller mode requires a player name.')
      return
    }

    disconnect()
    setErrorText('')
    setConnectionState('connecting')

    const nextHandle = createGameSocket({
      onOpen(send) {
        setConnectionState('connected')
        if (role === 'display') {
          send({ type: MessageType.DISPLAY_REGISTER, sessionId })
          return
        }
        send({ type: MessageType.CONTROLLER_JOIN, sessionId, name: playerName.trim() })
      },
      onMessage(message) {
        setLastMessage(message)
        if (message.type === MessageType.STATE_SYNC) {
          setLastStateSync(message.state || null)
        }
        if (message.type === MessageType.JOIN_ERROR) {
          const normalizedCode = message.code || ErrorCode.UNKNOWN_MESSAGE_TYPE
          setErrorText(`${message.message || 'Join error.'} (${normalizedCode})`)
        }
      },
      onClose() {
        setConnectionState('disconnected')
      },
      onError() {
        setConnectionState('disconnected')
        setErrorText('WebSocket transport error.')
      },
    })

    setSocketHandle(nextHandle)
  }

  function send(payload) {
    if (!socketHandle) {
      setErrorText('Connect first.')
      return
    }
    socketHandle.send(payload)
  }

  return (
    <main className="app-shell">
      <header>
        <h1>TeamBuilding frontend scaffold</h1>
        <p>Protocol v{PROTOCOL_VERSION} • Backend {backendOrigin}</p>
      </header>

      <section className="card">
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="display">Display</option>
            <option value="controller">Controller</option>
          </select>
        </label>

        <label>
          Session ID
          <input
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value.toUpperCase())}
            placeholder="ABC123"
          />
        </label>

        {role === 'controller' && (
          <label>
            Player name
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Alex"
            />
          </label>
        )}

        <div className="actions">
          <button type="button" onClick={createSession}>Create session</button>
          <button type="button" onClick={connect}>Connect</button>
          <button type="button" onClick={disconnect}>Disconnect</button>
          <button type="button" onClick={() => send({ type: MessageType.RESYNC_REQUEST })}>Resync</button>
        </div>
      </section>

      <section className="card">
        <h2>Control messages</h2>
        <label>
          Timer duration (ms)
          <input
            type="number"
            min="1000"
            step="1000"
            value={timerMs}
            onChange={(event) => setTimerMs(Number(event.target.value))}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => send({ type: MessageType.GAME_START })}>game_start</button>
          <button type="button" onClick={() => send({ type: MessageType.GAME_RESTART })}>game_restart</button>
          <button type="button" onClick={() => send({ type: MessageType.TIMER_START, durationMs: timerMs })}>timer_start</button>
          <button type="button" onClick={() => send({ type: MessageType.TIMER_STOP })}>timer_stop</button>
          <button type="button" onClick={() => send({ type: MessageType.TIMER_RESET, durationMs: timerMs })}>timer_reset</button>
          <button type="button" onClick={() => send({ type: MessageType.FOLLOWUP_END })}>followup_end</button>
          <button type="button" onClick={() => send({ type: MessageType.PLAYER_INPUT, input: { action: 'move', dir: 'n' } })}>move_n</button>
          <button type="button" onClick={() => send({ type: MessageType.PLAYER_INPUT, input: { action: 'move', dir: 'e' } })}>move_e</button>
          <button type="button" onClick={() => send({ type: MessageType.PLAYER_INPUT, input: { action: 'move', dir: 's' } })}>move_s</button>
          <button type="button" onClick={() => send({ type: MessageType.PLAYER_INPUT, input: { action: 'move', dir: 'w' } })}>move_w</button>
        </div>
      </section>

      <section className="card status">
        <p><strong>Socket:</strong> {connectionState}</p>
        {errorText && <p className="error">{errorText}</p>}
      </section>

      <section className="card grid">
        <article>
          <h2>Last WebSocket message</h2>
          <pre>{JSON.stringify(lastMessage, null, 2) || '(none yet)'}</pre>
        </article>
        <article>
          <h2>Last state_sync payload</h2>
          <pre>{JSON.stringify(lastStateSync, null, 2) || '(none yet)'}</pre>
        </article>
      </section>
    </main>
  )
}

export default App
