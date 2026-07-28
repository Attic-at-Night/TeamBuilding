import { useState, useEffect, useMemo, useCallback } from 'react'
import { DisplayShell } from './components/display/DisplayShell'
import { ControllerShell } from './components/controller/ControllerShell'
import { DevTools } from './components/devtools/DevTools'
import { ThemeSelector } from './components/ThemeSelector'
import { MessageType, ErrorCode } from './protocol'
import { createGameSocket, getBackendHttpOrigin } from './wsClient'


function inferRoleFromPath(pathname) {
  if (pathname.startsWith('/join')) {
    return 'controller'
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

export default function App() {
  const [mode, setMode] = useState(() => inferRoleFromPath(window.location.pathname))
  const [sessionId, setSessionId] = useState(() => parseSessionFromQuery())
  const [playerName, setPlayerName] = useState(() => parsePlayerNameFromQuery())
  const [joinUrl, setJoinUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [connectionState, setConnectionState] = useState('disconnected')
  const [socketHandle, setSocketHandle] = useState(null)
  const [stateSync, setStateSync] = useState(null)
  const [errorText, setErrorText] = useState('')

  const backendOrigin = useMemo(() => getBackendHttpOrigin(), [])

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (socketHandle) {
      socketHandle.close()
      setSocketHandle(null)
    }
    setConnectionState('disconnected')
  }, [socketHandle])

  // Create a new session via backend REST API
  const createNewSession = useCallback(async () => {
    setErrorText('')
    try {
      const response = await fetch(`${backendOrigin}/api/session`, { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Session creation failed (${response.status})`)
      }
      const data = await response.json()
      const newId = String(data.sessionId || '').toUpperCase()
      setSessionId(newId)
      setJoinUrl(data.joinUrl || `${window.location.origin}/join?session=${newId}`)
      setQrCodeDataUrl(data.qrCodeDataUrl || '')
      return newId
    } catch (err) {
      setErrorText(err.message || 'Failed to create session')
      return null
    }
  }, [backendOrigin])

  // Connect WebSocket
  const connectSocket = useCallback(
    ({ targetSessionId, name = '', isTrainer = false }) => {
      const activeSession = targetSessionId || sessionId
      if (!activeSession) {
        setErrorText('Session ID is required.')
        return
      }

      disconnect()
      setErrorText('')
      setConnectionState('connecting')

      const handle = createGameSocket({
        onOpen(send) {
          setConnectionState('connected')
          if (mode === 'display') {
            send({ type: MessageType.DISPLAY_REGISTER, sessionId: activeSession })
          } else {
            send({
              type: MessageType.CONTROLLER_JOIN,
              sessionId: activeSession,
              name: name.trim() || 'Player',
              isTrainer,
            })
          }
        },
        onMessage(message) {
          if (message.type === MessageType.STATE_SYNC) {
            setStateSync(message.state || null)
          } else if (message.type === MessageType.JOIN_ERROR) {
            const code = message.code || ErrorCode.UNKNOWN_MESSAGE_TYPE
            setErrorText(`${message.message || 'Error joining session.'} (${code})`)
            setConnectionState('disconnected')
          }
        },
        onClose() {
          setConnectionState('disconnected')
        },
        onError() {
          setConnectionState('disconnected')
          setErrorText('WebSocket connection error.')
        },
      })

      setSocketHandle(handle)
    },
    [sessionId, mode, disconnect]
  )

  // Send raw message over socket
  const send = useCallback(
    (payload) => {
      if (socketHandle) {
        socketHandle.send(payload)
      } else {
        setErrorText('Socket not connected.')
      }
    },
    [socketHandle]
  )

  // Auto-initialize Display Mode Session on load
  useEffect(() => {
    if (mode === 'display' && !sessionId && connectionState === 'disconnected') {
      createNewSession().then((newId) => {
        if (newId) {
          connectSocket({ targetSessionId: newId })
        }
      })
    } else if (mode === 'display' && sessionId && connectionState === 'disconnected') {
      connectSocket({ targetSessionId: sessionId })
    }
  }, [mode, sessionId, connectionState, createNewSession, connectSocket])

  // Controller Join Handler
  function handleControllerJoin({ sessionId: joinSession, name, requestedTrainer }) {
    setSessionId(joinSession)
    setPlayerName(name)
    connectSocket({
      targetSessionId: joinSession,
      name,
      isTrainer: requestedTrainer,
    })
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-main)] font-sans selection:bg-blue-600 selection:text-white transition-colors duration-300">
      {/* Global Header Bar */}
      <header className="sticky top-0 z-30 px-4 py-2 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-black tracking-wider uppercase text-slate-300">
            Asymmetrical Escape Game
          </span>
        </div>
        <ThemeSelector />
      </header>

      {mode === 'display' ? (

        <DisplayShell
          stateSync={stateSync}
          sessionId={sessionId}
          joinUrl={joinUrl}
          qrCodeDataUrl={qrCodeDataUrl}
          onStartGame={() => send({ type: MessageType.GAME_START })}
          onRestart={() => send({ type: MessageType.GAME_RESTART })}
          onSend={send}
        />
      ) : (
        <ControllerShell
          stateSync={stateSync}
          isConnected={connectionState === 'connected'}
          errorText={errorText}
          onJoin={handleControllerJoin}
          onSend={send}
          onDisconnect={disconnect}
          initialSessionId={sessionId}
          initialName={playerName}
        />
      )}

      {/* Embedded DevTools */}
      <DevTools
        mode={mode}
        setMode={setMode}
        stateSync={stateSync}
        sessionId={sessionId}
      />
    </div>
  )
}
