import { useState } from 'react'
import { ControllerLobby } from './ControllerLobby'
import { MoverView } from './MoverView'
import { GuideView } from './GuideView'
import { KeySeerView } from './KeySeerView'
import { NavigatorView } from './NavigatorView'
import { TrainerDashboard } from './TrainerDashboard'
import { MazeRole, MessageType } from '../../protocol'
import { Shield, Users, Radio } from 'lucide-react'

export function ControllerShell({
  stateSync,
  isConnected,
  errorText,
  onJoin,
  onSend,
  onDisconnect,
  initialSessionId = '',
  initialName = '',
}) {
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [playerName, setPlayerName] = useState(initialName)
  const [isTrainer, setIsTrainer] = useState(false)
  const [activeTab, setActiveTab] = useState(null)

  const viewerRole = stateSync?.viewerRole || null
  const status = stateSync?.status || 'lobby'
  const roleData = stateSync?.roleData || {}
  const summary = stateSync?.summary || {}
  const trainerBroadcast = stateSync?.trainerBroadcast || null
  const players = stateSync?.players || []

  const assignedRoles = roleData?.assignedRoles || (viewerRole ? [viewerRole] : [])
  const currentRole = (activeTab && assignedRoles.includes(activeTab)) ? activeTab : (viewerRole || assignedRoles[0] || MazeRole.MOVER)

  function handleJoinSubmit() {
    onJoin({
      sessionId,
      name: playerName,
      requestedTrainer: isTrainer,
    })
  }

  function handleSendInput(input) {
    onSend({
      type: MessageType.PLAYER_INPUT,
      input,
    })
  }

  if (!isConnected || !stateSync) {
    return (
      <ControllerLobby
        sessionId={sessionId}
        playerName={playerName}
        isTrainer={isTrainer}
        setSessionId={setSessionId}
        setPlayerName={setPlayerName}
        setIsTrainer={setIsTrainer}
        onJoin={handleJoinSubmit}
        errorText={errorText}
      />
    )
  }

  // Trainer View
  if (viewerRole === MazeRole.TRAINER || isTrainer) {
    return <TrainerDashboard stateSync={stateSync} onSend={onSend} />
  }

  // Waiting in Lobby
  if (status === 'lobby' || !viewerRole) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-6 text-slate-100 min-h-[80vh] justify-center items-center">
        <div className="w-16 h-16 rounded-3xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shadow-xl animate-pulse">
          <Users className="w-8 h-8" />
        </div>

        <div className="text-center flex flex-col items-center gap-1">
          <h2 className="text-2xl font-black text-white">Connected to Lobby</h2>
          <span className="text-xs font-mono font-bold text-blue-400 bg-blue-950/60 border border-blue-800/60 px-3 py-1 rounded-full uppercase">
            Session: {sessionId}
          </span>
        </div>

        {/* Players Joined Slot List */}
        <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
            <span>Joined Teammates</span>
            <span>{players.length} / 4</span>
          </div>

          <div className="flex flex-col gap-2">
            {players.length === 0 ? (
              <span className="text-xs text-slate-500 italic text-center p-2">Waiting for teammates...</span>
            ) : (
              players.map((p, idx) => (
                <div key={p.id || idx} className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-600/30 text-blue-400 text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-white">{p.name}</span>
                  </div>
                  {p.assignedRoles && (
                    <span className="text-xs font-mono font-semibold text-blue-300 capitalize">
                      {Array.isArray(p.assignedRoles) ? p.assignedRoles.join(', ') : p.assignedRoles}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="text-xs text-slate-400 text-center mt-3">
            Waiting for Host on Big Display to start the game...
          </p>
        </div>

        <button
          type="button"
          onClick={onDisconnect}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
        >
          Leave Session
        </button>
      </div>
    )
  }

  // Active Role Views
  return (
    <div className="w-full flex flex-col items-center gap-2 pb-8">
      {/* Multi-Role Tab Selector (for 1-3 player games where players hold multiple roles) */}
      {assignedRoles.length > 1 && (
        <div className="w-full max-w-md px-4 mt-2">
          <div className="p-1 bg-slate-900/90 border border-slate-700/80 rounded-2xl flex items-center justify-around shadow-xl">
            {assignedRoles.map((role) => {
              const isActive = currentRole === role
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setActiveTab(role)}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md border border-blue-400'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  {role === MazeRole.MOVER && '🏃 Mover'}
                  {role === MazeRole.GUIDE && '⚡ Guide'}
                  {role === MazeRole.KEY_SEER && '🔑 Key-Seer'}
                  {role === MazeRole.NAVIGATOR && '🗺️ Navigator'}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Facilitator Broadcast Banner */}
      {trainerBroadcast && (
        <div className="w-full max-w-md my-2 p-3 rounded-2xl bg-gradient-to-r from-amber-950 to-indigo-950 border border-amber-500/50 text-amber-200 text-xs font-bold flex items-center gap-2 shadow-lg animate-bounce">
          <Radio className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{trainerBroadcast.message}</span>
        </div>
      )}

      {/* Render Role View based on currentRole */}
      {currentRole === MazeRole.MOVER && (
        <MoverView roleData={roleData} summary={summary} status={status} onSendInput={handleSendInput} />
      )}

      {currentRole === MazeRole.GUIDE && (
        <GuideView roleData={roleData} summary={summary} status={status} onSendInput={handleSendInput} />
      )}

      {currentRole === MazeRole.KEY_SEER && (
        <KeySeerView roleData={roleData} summary={summary} status={status} onSendInput={handleSendInput} />
      )}

      {currentRole === MazeRole.NAVIGATOR && (
        <NavigatorView roleData={roleData} summary={summary} status={status} onSendInput={handleSendInput} />
      )}
    </div>
  )
}
