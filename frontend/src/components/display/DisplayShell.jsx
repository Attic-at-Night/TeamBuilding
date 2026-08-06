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
  errorText,
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
        errorText={errorText}
      />
    )
  }

  if (status === GameStatus.PLAYING) {
    return <DisplayPlaying stateSync={stateSync} />
  }

  if (status === GameStatus.FOLLOW_UP) {
    return <DisplayFollowUp stateSync={stateSync} onSend={onSend} />
  }
 
  if (status === GameStatus.SESSION_OVERVIEW) {
    return <DisplayDebrief stateSync={stateSync} onRestart={onRestart} />
  }
 
  return <DisplayDebrief stateSync={stateSync} onRestart={onRestart} />
}
