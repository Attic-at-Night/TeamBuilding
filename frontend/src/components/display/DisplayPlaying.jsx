import { Heart, Key, Timer, Shield, Users, Radio, Compass, Eye, Map, Footprints, AlertCircle, Lock } from 'lucide-react'

export function DisplayPlaying({ stateSync }) {
  const summary = stateSync?.summary || {}
  const timer = stateSync?.timer || {}
  const players = stateSync?.players || []
  const trainerBroadcast = stateSync?.trainerBroadcast || null

  const lives = summary?.livesRemaining ?? summary?.lives ?? 3
  const keysCollected = summary?.keysCollected ?? 0

  // Format Timer remaining time
  const remainingMs = timer?.remainingMs ?? 0
  const minutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const timerFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const roleDescriptions = {
    mover: { title: 'Mover', icon: Footprints, color: 'text-blue-400 border-blue-500/40 bg-blue-950/40', desc: 'Controls physical movement through maze corridors.' },
    guide: { title: 'Guide', icon: Compass, color: 'text-purple-400 border-purple-500/40 bg-purple-950/40', desc: 'Detects hazards and roaming ghosts in real time.' },
    'key-seer': { title: 'Key-Seer', icon: Eye, color: 'text-amber-400 border-amber-500/40 bg-amber-950/40', desc: 'Locates hidden keys and reveals the exit portal.' },
    navigator: { title: 'Navigator', icon: Map, color: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40', desc: 'Holds the architectural map layout for route planning.' },
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-6 text-slate-100 min-h-screen justify-center">
      {/* Top HUD Bar */}
      <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl flex items-center justify-between flex-wrap gap-4 backdrop-blur-xl">
        {/* Lives Counter */}
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-rose-950/80 border border-rose-800/80 text-rose-500 shadow-lg">
            <Heart className="w-7 h-7 fill-rose-500" />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Team Lives</span>
            <span className="text-3xl font-black text-rose-300">{lives} / 3</span>
          </div>
        </div>

        {/* Timer Display */}
        <div className="flex items-center gap-3 bg-slate-950 px-8 py-4 rounded-2xl border border-slate-800 shadow-inner">
          <Timer className="w-7 h-7 text-indigo-400" />
          <span className="text-4xl font-black font-mono tracking-widest text-white">{timerFormatted}</span>
        </div>

        {/* Key Progress Bar */}
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-amber-950/80 border border-amber-800/80 text-amber-400 shadow-lg">
            <Key className="w-7 h-7" />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Keys Unlocked</span>
            <span className="text-3xl font-black text-amber-300">{keysCollected} / 3</span>
          </div>
        </div>
      </div>

      {/* Trainer Broadcast Banner */}
      {trainerBroadcast && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950 via-indigo-950 to-amber-950 border border-amber-500/60 text-amber-200 font-extrabold text-base flex items-center justify-center gap-3 shadow-xl animate-pulse">
          <Radio className="w-6 h-6 text-amber-400 shrink-0" />
          <span>Facilitator Note: {trainerBroadcast.message}</span>
        </div>
      )}

      {/* Main Team Coordination Dashboard */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 my-4">
        {/* Asymmetrical Info Badge */}
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-2xl w-full text-center flex flex-col items-center gap-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-300 text-xs font-bold uppercase tracking-wider">
            <Lock className="w-4 h-4 text-indigo-400" />
            <span>Asymmetrical Information Active</span>
          </div>
          <h2 className="text-2xl font-black text-white">Teamwork & Verbal Communication In Progress</h2>
          <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
            The full maze map is intentionally hidden from this public screen. Each player must rely on their individual controller display and communicate clearly with teammates to navigate safely, collect keys, and reach the exit.
          </p>
        </div>

        {/* Teammates Roster Cards Grid */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {players.map((p, idx) => {
            const roleKey = (Array.isArray(p.assignedRoles) ? p.assignedRoles[0] : p.assignedRoles)?.toLowerCase()
            const roleInfo = roleDescriptions[roleKey] || {
              title: Array.isArray(p.assignedRoles) ? p.assignedRoles.join(', ') : p.assignedRoles,
              icon: Users,
              color: 'text-indigo-400 border-indigo-500/40 bg-indigo-950/40',
              desc: 'Team member participating in asymmetrical coordination.',
            }
            const Icon = roleInfo.icon

            return (
              <div
                key={p.id || idx}
                className={`p-5 rounded-3xl border flex flex-col justify-between gap-4 shadow-xl backdrop-blur-md ${roleInfo.color}`}
              >
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 rounded-2xl bg-slate-900/80 text-white text-sm font-black flex items-center justify-center border border-slate-700">
                    #{idx + 1}
                  </div>
                  <Icon className="w-6 h-6" />
                </div>

                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Player</span>
                  <span className="text-xl font-extrabold text-white block truncate">{p.name}</span>
                </div>

                <div className="pt-3 border-t border-slate-800/80">
                  <span className="text-xs font-bold text-slate-300 block mb-0.5">{roleInfo.title}</span>
                  <span className="text-[11px] text-slate-400 leading-tight block">{roleInfo.desc}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

