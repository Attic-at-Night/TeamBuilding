import { Trophy, RotateCcw, AlertTriangle, Key, Clock, XCircle, Flame, Layers } from 'lucide-react'
import { GameStatus } from '../../protocol'
import {
  MOI_COLORS,
  MOI_LEGEND,
  classifyMoiEvent,
  extractRoundsData,
  formatSeconds,
  getMoiDisplayTime,
  getMoiLabel,
  getModeDisplayName,
  getModeFocusText,
} from './moiUtils'

export function DisplayDebrief({ stateSync, onRestart }) {
  const summary = stateSync?.summary || {}
  const log = stateSync?.log || []
  const isSessionOverview = stateSync?.status === GameStatus.SESSION_OVERVIEW
  const outcome = summary?.outcome || (summary?.livesRemaining > 0 ? 'success' : 'failure')
  const activeMode = getModeDisplayName(stateSync?.nextGameMode || stateSync?.gameMode)
  const modeFocusText = getModeFocusText(stateSync?.nextGameMode || stateSync?.gameMode)

  // Extract per-round data for all 3 rounds from log
  const roundsData = extractRoundsData(log, summary)

  // Compute aggregate stats across all rounds
  const totalDurationSeconds = Math.round(roundsData.reduce((acc, r) => acc + (r.durationSeconds || 0), 0))
  const totalKeysCollected = roundsData.reduce((acc, r) => acc + (r.keysCollected || 0), 0)
  const totalPossibleKeys = roundsData.reduce((acc, r) => acc + (r.possibleKeys || 3), 0)
  const totalHazardsHit = roundsData.reduce((acc, r) => acc + (r.hazardsHit || 0), 0)
  const totalResets = roundsData.reduce((acc, r) => acc + (r.resetsCount || 0), 0)

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto p-4 sm:p-8 text-slate-100 min-h-screen justify-center items-center">
      {/* Debrief Header */}
      <div className="text-center flex flex-col items-center gap-3">
        <div
          className={`p-4 rounded-3xl border shadow-2xl flex items-center justify-center ${
            isSessionOverview
              ? 'bg-blue-950/80 border-blue-500 text-blue-400'
              : outcome === 'success'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400'
              : 'bg-rose-950/80 border-rose-500 text-rose-400'
          }`}
        >
          {isSessionOverview ? <Layers className="w-12 h-12" /> : outcome === 'success' ? <Trophy className="w-12 h-12" /> : <XCircle className="w-12 h-12" />}
        </div>

        <h1 className="text-4xl font-black text-white">
          {isSessionOverview ? 'Full 3-Round Session Debrief' : outcome === 'success' ? 'Mission Complete!' : 'Challenge Ended'}
        </h1>
        <p className="text-indigo-300 text-sm font-semibold uppercase tracking-wider">{activeMode}</p>
        <p className="text-slate-400 text-sm max-w-lg">
          {isSessionOverview
            ? 'Performance data and timeline metrics from all 3 rounds are recorded below. Review the retrospective timelines before launching a new session.'
            : outcome === 'success'
            ? `Great team coordination! All 3 keys were retrieved and the Mover reached the exit safely. ${modeFocusText}`
            : `The team encountered obstacles or ran out of lives. Review the retrospective debrief below. ${modeFocusText}`}
        </p>
      </div>

      {/* Aggregate Session Statistics (All Rounds) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <Clock className="w-5 h-5 text-blue-400 mb-1" />
          <span className="text-2xl font-black text-white">{formatSeconds(totalDurationSeconds)}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Total Play Time</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <Key className="w-5 h-5 text-amber-400 mb-1" />
          <span className="text-2xl font-black text-white">{totalKeysCollected} / {totalPossibleKeys}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Keys Retrieved</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <AlertTriangle className="w-5 h-5 text-rose-400 mb-1" />
          <span className="text-2xl font-black text-white">{totalHazardsHit}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Hazards Hit</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center gap-1 shadow-xl">
          <RotateCcw className="w-5 h-5 text-purple-400 mb-1" />
          <span className="text-2xl font-black text-white">{totalResets}</span>
          <span className="text-xs text-slate-400 font-semibold uppercase">Total Resets</span>
        </div>
      </div>

      {/* Per-Round Summary Cards Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
        {roundsData.map((rd) => (
          <div
            key={rd.round}
            className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col gap-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-sm font-black text-indigo-300 uppercase tracking-wide">
                Round {rd.round}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                  rd.outcome === 'success'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                    : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                }`}
              >
                {rd.outcome === 'success' ? 'Completed' : 'Failed'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="flex flex-col bg-slate-950/60 p-2 rounded-xl border border-slate-800/50">
                <span className="text-slate-400 text-[10px] uppercase font-bold">Time</span>
                <span className="font-extrabold text-white mt-0.5">{Math.round(rd.durationSeconds)}s</span>
              </div>
              <div className="flex flex-col bg-slate-950/60 p-2 rounded-xl border border-slate-800/50">
                <span className="text-slate-400 text-[10px] uppercase font-bold">Keys</span>
                <span className="font-extrabold text-amber-400 mt-0.5">{rd.keysCollected}/{rd.possibleKeys ?? 3}</span>
              </div>
              <div className="flex flex-col bg-slate-950/60 p-2 rounded-xl border border-slate-800/50">
                <span className="text-slate-400 text-[10px] uppercase font-bold">Hazards</span>
                <span className="font-extrabold text-rose-400 mt-0.5">{rd.hazardsHit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 3-Round Timelines View (Replaces Raw Event Log) */}
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-indigo-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              Round Timelines Overview
            </span>
          </div>
          <span className="text-xs text-slate-400">{roundsData.length} Round(s) Played</span>
        </div>

        <div className="flex flex-col gap-8">
          {roundsData.map((rd) => {
            const timelineSecs = Math.max(1, rd.durationSeconds)
            const events = rd.moiEvents || []

            return (
              <div key={rd.round} className="flex flex-col gap-2 p-4 rounded-2xl bg-slate-950/80 border border-slate-800/80">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span className="text-indigo-400">Round {rd.round} Timeline</span>
                  <span className="font-mono text-slate-400">{formatSeconds(timelineSecs)}</span>
                </div>

                {/* Timeline Bar */}
                <div className="flex items-center gap-2 my-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0" />
                  <div className="relative flex-1 h-2 bg-slate-800 rounded-full overflow-visible">
                    {events.map((entry, idx) => {
                      const moiType = classifyMoiEvent(entry)
                      const color = MOI_COLORS[moiType] || '#64748b'
                      const tOffset = entry.t ?? 0
                      const pct = Math.min(100, Math.max(0, (tOffset / timelineSecs) * 100))

                      return (
                        <div
                          key={entry.eventId || idx}
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
                          style={{ left: `${pct}%` }}
                        >
                          <div
                            className="w-3.5 h-3.5 rounded-full border border-slate-900 transition-transform group-hover:scale-150"
                            style={{ backgroundColor: color }}
                          />
                          {/* Tooltip on hover */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-[11px] font-bold text-white whitespace-nowrap shadow-xl">
                              {getMoiLabel(entry, stateSync?.gameMode)} ({formatSeconds(tOffset)})
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0" />
                </div>

                {/* Micro moment legend tags for key events in this round */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {events.length === 0 ? (
                    <span className="text-[11px] text-slate-500 italic">No key events logged for this round.</span>
                  ) : (
                    events.map((e, idx) => {
                      const moiType = classifyMoiEvent(e)
                      const color = MOI_COLORS[moiType] || '#64748b'
                      return (
                        <span
                          key={e.eventId || idx}
                          className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-slate-200 bg-slate-900 border border-slate-800 flex items-center gap-1.5"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          {getMoiLabel(e)} ({formatSeconds(e.t ?? 0)})
                        </span>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Timeline Legend */}
        <div className="flex items-center justify-center gap-4 flex-wrap pt-2 border-t border-slate-800/80">
          {MOI_LEGEND.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      {isSessionOverview ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="rounded-full border border-blue-400/40 bg-blue-950/60 px-5 py-2 text-sm font-semibold text-blue-200">
            Waiting for the trainer to launch the next session.
          </div>
          <p className="text-sm text-slate-400">The facilitator can choose a mode and restart from the trainer dashboard.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRestart}
          className="px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-base shadow-2xl flex items-center gap-3 active:scale-95 transition-all"
        >
          <RotateCcw className="w-5 h-5" />
          <span>Start Next Game Session</span>
        </button>
      )}
    </div>
  )
}

