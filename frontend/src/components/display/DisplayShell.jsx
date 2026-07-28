import { DisplayLobby } from './DisplayLobby'
import { DisplayPlaying } from './DisplayPlaying'
import { DisplayDebrief } from './DisplayDebrief'
import { NotificationOverlay } from '../NotificationOverlay'
import { GameStatus, MessageType } from '../../protocol'

export function DisplayShell({
  stateSync,
  sessionId,
  joinUrl,
  qrCodeDataUrl,
  onStartGame,
  onRestart,
  onSend,
}) {
  const status = stateSync?.status || GameStatus.LOBBY
  const players = stateSync?.players || []
  const trainers = stateSync?.trainers || []
  const ready = stateSync?.ready || false

  if (status === GameStatus.LOBBY) {
    return (
      <DisplayLobby
        sessionId={sessionId}
        joinUrl={joinUrl}
        qrCodeDataUrl={qrCodeDataUrl}
        players={players}
        trainers={trainers}
        ready={ready}
        onStartGame={onStartGame}
      />
    )
  }

  if (status === GameStatus.PLAYING) {
    return (
      <>
        <NotificationOverlay stateSync={stateSync} />
        <DisplayPlaying stateSync={stateSync} />
      </>
    )
  }

  return (
    <>
      <NotificationOverlay stateSync={stateSync} />
      <DisplayDebrief stateSync={stateSync} onRestart={onRestart} />
    </>
  )
}
