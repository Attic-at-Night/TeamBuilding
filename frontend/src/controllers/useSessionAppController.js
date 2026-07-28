import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MessageType, ErrorCode } from '../protocol'
import { createGameSocket, getBackendHttpOrigin } from '../wsClient'
import { getMockStateForView } from '../mockData'

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

export function useSessionAppController() {
  const [mode, setMode] = useState(() => inferRoleFromPath(window.location.pathname))
  const [activeView, setActiveView] = useState('live')
  const [sessionId, setSessionId] = useState(() => parseSessionFromQuery())
  const [playerName, setPlayerName] = useState(() => parsePlayerNameFromQuery())
  const [joinUrl, setJoinUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [connectionState, setConnectionState] = useState('disconnected')
  const [socketHandle, setSocketHandle] = useState(null)
  const [stateSync, setStateSync] = useState(null)
  const [errorText, setErrorText] = useState('')
  const connectionIdRef = useRef(0)

  const backendOrigin = useMemo(() => getBackendHttpOrigin(), [])

  const disconnect = useCallback(() => {
    if (socketHandle) {
      socketHandle.close()
      setSocketHandle(null)
    }
    setConnectionState('disconnected')
  }, [socketHandle])

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

  const connectSocket = useCallback(
    ({ targetSessionId, name = '', isTrainer = false }) => {
      const activeSession = targetSessionId || sessionId
      if (!activeSession) {
        setErrorText('Session ID is required.')
        return
      }

      const connectionId = connectionIdRef.current + 1
      connectionIdRef.current = connectionId
      disconnect()
      setErrorText('')
      setConnectionState('connecting')

      const handle = createGameSocket({
        onOpen(send) {
          if (connectionIdRef.current !== connectionId) {
            return
          }
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
          if (connectionIdRef.current !== connectionId) {
            return
          }
          if (message.type === MessageType.STATE_SYNC) {
            setStateSync(message.state || null)
          } else if (message.type === MessageType.JOIN_ERROR) {
            const code = message.code || ErrorCode.UNKNOWN_MESSAGE_TYPE
            setErrorText(`${message.message || 'Error joining session.'} (${code})`)
            setConnectionState('disconnected')
          }
        },
        onClose() {
          if (connectionIdRef.current !== connectionId) {
            return
          }
          setConnectionState('disconnected')
        },
        onError() {
          if (connectionIdRef.current !== connectionId) {
            return
          }
          setConnectionState('disconnected')
          setErrorText('WebSocket connection error.')
        },
      })

      setSocketHandle(handle)
    },
    [sessionId, mode, disconnect]
  )

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

  const handleControllerJoin = useCallback(({ sessionId: joinSession, name, requestedTrainer }) => {
    setSessionId(joinSession)
    setPlayerName(name)
    connectSocket({
      targetSessionId: joinSession,
      name,
      isTrainer: requestedTrainer,
    })
  }, [connectSocket])

  const mockViewState = useMemo(() => {
    if (activeView === 'live') {
      return null
    }
    return getMockStateForView(activeView)
  }, [activeView])

  return {
    mode,
    setMode,
    activeView,
    setActiveView,
    sessionId,
    setSessionId,
    playerName,
    setPlayerName,
    joinUrl,
    setJoinUrl,
    qrCodeDataUrl,
    setQrCodeDataUrl,
    connectionState,
    setConnectionState,
    stateSync,
    setStateSync,
    errorText,
    setErrorText,
    backendOrigin,
    createNewSession,
    connectSocket,
    disconnect,
    send,
    handleControllerJoin,
    mockViewState,
  }
}
