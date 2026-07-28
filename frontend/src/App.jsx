import { DisplayShell } from './components/display/DisplayShell'
import { ControllerShell } from './components/controller/ControllerShell'
import { DevTools } from './components/devtools/DevTools'
import { ThemeSelector } from './components/ThemeSelector'
import { MessageType } from './protocol'
import { useSessionAppController } from './controllers/useSessionAppController'

import { DisplayLobby } from './components/display/DisplayLobby'
import { DisplayPlaying } from './components/display/DisplayPlaying'
import { DisplayDebrief } from './components/display/DisplayDebrief'
import { ControllerLobby } from './components/controller/ControllerLobby'
import { MoverView } from './components/controller/MoverView'
import { GuideView } from './components/controller/GuideView'
import { KeySeerView } from './components/controller/KeySeerView'
import { NavigatorView } from './components/controller/NavigatorView'
import { TrainerDashboard } from './components/controller/TrainerDashboard'

export default function App() {
  const {
    mode,
    setMode,
    activeView,
    setActiveView,
    sessionId,
    playerName,
    joinUrl,
    qrCodeDataUrl,
    connectionState,
    stateSync,
    errorText,
    send,
    disconnect,
    handleControllerJoin,
    mockViewState,
  } = useSessionAppController()

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

    const mock = mockViewState

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
      <header className="sticky top-0 z-30 px-4 py-2 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-black tracking-wider uppercase text-slate-300">
            Asymmetrical Escape Game
          </span>
        </div>
        <ThemeSelector />
      </header>

      <main className="w-full">
        {renderMainContent()}
      </main>

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
