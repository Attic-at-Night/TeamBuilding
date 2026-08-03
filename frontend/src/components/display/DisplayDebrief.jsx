import { Trophy, RotateCcw, AlertTriangle, Key, Clock, Share2, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { getModeDisplayName, getModeFocusText } from './moiUtils'

export function DisplayDebrief({ stateSync, onRestart }) {
  const summary = stateSync?.summary || {}
  const log = stateSync?.log || []
  const trainerBroadcast = stateSync?.trainerBroadcast || null
  const outcome = summary?.outcome || (summary?.livesRemaining > 0 ? 'success' : 'failure')
  const activeMode = getModeDisplayName(stateSync?.gameMode)
  const modeFocusText = getModeFocusText(stateSync?.gameMode)

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto p-8 text-slate-100 min-h-screen justify-center items-center">
      {/* Debrief Header */}
      <div className="text-center flex flex-col items-center gap-3">
        <div
          className={`p-4 rounded-3xl border shadow-2xl flex items-center justify-center ${
            outcome === 'success'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400'
              : 'bg-rose-950/80 border-rose-500 text-rose-400'
          }`}
        >
          {outcome === 'success' ? <Trophy className="w-12 h-12" /> : <XCircle className="w-12 h-12" />}
        </div>

        <h1 className="text-4xl font-black text-white">
          {outcome === 'success' ? 'Mission Complete!' : 'Challenge Ended'}
        </h1>
        <p className="text-indigo-300 text-sm font-semibold uppercase tracking-wider">{activeMode}</p>
        <p className="text-slate-400 text-sm max-w-md">
          {outcome === 'success'
            ? `Great team coordination! All 3 keys were retrieved and the Mover reached the exit safely. ${modeFocusText}`
            : `The team encountered obstacles or ran out of lives. Review the retrospective debrief below. ${modeFocusText}`}
        </p>
      </div>

      {/* Summary Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <Clock className="w-5 h-5 text-blue-400 mb-1" />
          <span className="text-2xl font-black text-white">{summary?.durationSeconds || 0}s</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Total Time</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <Key className="w-5 h-5 text-amber-400 mb-1" />
          <span className="text-2xl font-black text-white">{summary?.keysCollected || 0} / 3</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Keys Found</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <AlertTriangle className="w-5 h-5 text-rose-400 mb-1" />
          <span className="text-2xl font-black text-white">{summary?.hazardsHit || 0}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Hazards Hit</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <RotateCcw className="w-5 h-5 text-purple-400 mb-1" />
          <span className="text-2xl font-black text-white">{summary?.resetsCount || 0}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Resets</span>
        </div>
      </div>

      {/* Timeline Event Feed */}
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <span className="text-sm font-bold text-white uppercase tracking-wider">Session Retrospective Log</span>
          <span className="text-xs text-slate-400">{log.length} total events</span>
        </div>

        <div className="max-h-64 overflow-y-auto flex flex-col gap-2">
          {log.length === 0 ? (
            <span className="text-xs text-slate-500 italic p-2">No log events recorded.</span>
          ) : (
            log.slice().reverse().map((entry, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-blue-400 capitalize">{entry.event.replace('_', ' ')}</span>
                  {entry.player && <span className="text-slate-400">({entry.player})</span>}
                  {entry.reason && <span className="text-slate-300">- {entry.reason}</span>}
                </div>
                <span className="font-mono text-slate-500 text-[10px]">{new Date(entry.ts || Date.now()).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <button
        type="button"
        onClick={onRestart}
        className="px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-base shadow-2xl flex items-center gap-3 active:scale-95 transition-all"
      >
        <RotateCcw className="w-5 h-5" />
        <span>Start Next Game Session</span>
      </button>
    </div>
  )
}
