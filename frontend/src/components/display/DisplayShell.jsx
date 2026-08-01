import { DisplayLobby } from './DisplayLobby'
import { DisplayPlaying } from './DisplayPlaying'
import { DisplayDebrief } from './DisplayDebrief'
import { DisplayFollowUp } from './DisplayFollowUp'
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
    return <DisplayPlaying stateSync={stateSync} />
  }

  if (status === GameStatus.FOLLOW_UP) {
    return <DisplayFollowUp stateSync={stateSync} onSend={onSend} />
  }

  return <DisplayDebrief stateSync={stateSync} onRestart={onRestart} />
}
