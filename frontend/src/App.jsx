import { useState, useEffect, useMemo, useCallback } from 'react'
import { DisplayShell } from './components/display/DisplayShell'
import { ControllerShell } from './components/controller/ControllerShell'
import { DevTools } from './components/devtools/DevTools'
import { ThemeSelector } from './components/ThemeSelector'
import { MessageType, ErrorCode, GameStatus } from './protocol'
import { createGameSocket, getBackendHttpOrigin } from './wsClient'
import { getMockStateForView } from './mockData'

import { DisplayLobby } from './components/display/DisplayLobby'
import { DisplayPlaying } from './components/display/DisplayPlaying'
import { DisplayDebrief } from './components/display/DisplayDebrief'
import { ControllerLobby } from './components/controller/ControllerLobby'
import { MoverView } from './components/controller/MoverView'
import { GuideView } from './components/controller/GuideView'
import { KeySeerView } from './components/controller/KeySeerView'
import { NavigatorView } from './components/controller/NavigatorView'
import { TrainerDashboard } from './components/controller/TrainerDashboard'

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
  const [activeView, setActiveView] = useState('live') // 'live' or specific preview view key
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
              requestedTrainer: isTrainer,
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

  // Auto-initialize Display Mode Session on load when in live mode
  useEffect(() => {
    if (activeView !== 'live') return

    if (mode === 'display' && !sessionId && connectionState === 'disconnected') {
      createNewSession().then((newId) => {
        if (newId) {
          connectSocket({ targetSessionId: newId })
        }
      })
    } else if (mode === 'display' && sessionId && connectionState === 'disconnected') {
      connectSocket({ targetSessionId: sessionId })
    }
  }, [activeView, mode, sessionId, connectionState, createNewSession, connectSocket])

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

  // Render view based on activeView (Live or Inspector Preview)
  const renderMainContent = () => {
    if (activeView === 'live') {
      return mode === 'display' ? (
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
      )
    }

    // Static Inspector Preview Mode
    const mock = getMockStateForView(activeView)

    switch (activeView) {
      case 'display_lobby':
        return (
          <DisplayLobby
            sessionId="TEAM2026"
            joinUrl="https://app.aistudio.build/join?session=TEAM2026"
            qrCodeDataUrl=""
            players={mock.stateSync.players}
            trainers={mock.stateSync.trainers}
            ready={true}
            onStartGame={() => {}}
          />
        )

      case 'display_playing':
        return <DisplayPlaying stateSync={mock.stateSync} />

      case 'display_debrief':
        return <DisplayDebrief stateSync={mock.stateSync} onRestart={() => {}} />

      case 'controller_join':
        return (
          <ControllerLobby
            sessionId="TEAM2026"
            playerName="Alex"
            isTrainer={false}
            setSessionId={() => {}}
            setPlayerName={() => {}}
            setIsTrainer={() => {}}
            onJoin={() => {}}
            errorText=""
          />
        )

      case 'controller_waiting':
        return (
          <ControllerShell
            stateSync={{ ...mock.stateSync, status: 'lobby', viewerRole: 'mover' }}
            isConnected={true}
            errorText=""
            onJoin={() => {}}
            onSend={() => {}}
            onDisconnect={() => {}}
            initialSessionId="TEAM2026"
            initialName="Alex Rivera"
          />
        )

      case 'controller_mover':
        return (
          <MoverView
            roleData={mock.roleData}
            summary={mock.stateSync.summary}
            status="playing"
            onSendInput={() => {}}
          />
        )

      case 'controller_guide':
        return (
          <GuideView
            roleData={mock.roleData}
            summary={mock.stateSync.summary}
            status="playing"
            onSendInput={() => {}}
          />
        )

      case 'controller_key_seer':
        return (
          <KeySeerView
            roleData={mock.roleData}
            summary={mock.stateSync.summary}
            status="playing"
            onSendInput={() => {}}
          />
        )

      case 'controller_navigator':
        return (
          <NavigatorView
            roleData={mock.roleData}
            summary={mock.stateSync.summary}
          />
        )

      case 'controller_trainer':
        return (
          <TrainerDashboard
            stateSync={mock.stateSync}
            onSend={() => {}}
          />
        )

      default:
        return null
    }
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

      {/* Main Content Area */}
      <main className="w-full">
        {renderMainContent()}
      </main>

      {/* Embedded DevTools */}
      <DevTools
        mode={mode}
        setMode={setMode}
        activeView={activeView}
        setActiveView={setActiveView}
        stateSync={stateSync}
        sessionId={sessionId}
      />
    </div>
  )
}
