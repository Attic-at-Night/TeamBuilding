
// MOI dot color by event type and sub-type
const MOI_COLORS = {
  hazard_wall: '#ef4444',   // red
  hazard_cross: '#ef4444',  // red
  key: '#eab308',           // yellow
  goal: '#22c55e',          // green
  timer_expired: '#475569', // slate-600
  out_of_lives: '#1e293b',  // slate-900 / dark
}

function classifyMoiEvent(entry) {
  if (entry.event === 'hazard_hit') {
    return entry.hazardType === 'wall' ? 'hazard_wall' : 'hazard_cross'
  }
  if (entry.event === 'input') {
    if (entry.result === 'key') return 'key'
    if (entry.result === 'goal') return 'goal'
  }
  if (entry.event === 'timer_expired') return 'timer_expired'
  if (entry.event === 'session_end' && entry.outcome === 'fail') return 'out_of_lives'
  return null
}

function getMoiLabel(entry) {
  if (entry.event === 'hazard_hit') {
    return entry.hazardType === 'wall' ? 'Hit a wall' : 'Hit cross'
  }
  if (entry.event === 'input') {
    if (entry.result === 'key') {
      const keyNum = entry.keyIndex != null ? ` ${entry.keyIndex + 1}` : ''
      return `Got Key${keyNum}`
    }
    if (entry.result === 'goal') return 'Reached Goal'
  }
  if (entry.event === 'timer_expired') return 'Out of time'
  if (entry.event === 'session_end') return 'Out of lives'
  return entry.event
}

function formatSeconds(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${String(rem).padStart(2, '0')}s`
}

function getMoiEventsForPhase(log, followingPhase) {
  if (!Array.isArray(log)) return []

  // Find the start log index for the gameplay phase
  let phaseStartIdx = -1
  let phaseEndIdx = log.length

  for (let i = 0; i < log.length; i++) {
    const e = log[i]
    if (e.event === 'phase_start' && e.phaseType === 'gameplay' && e.phase === followingPhase) {
      phaseStartIdx = i
    }
    if (phaseStartIdx >= 0 && i > phaseStartIdx && e.event === 'phase_start') {
      phaseEndIdx = i
      break
    }
  }

  if (phaseStartIdx < 0) return []

  return log.slice(phaseStartIdx + 1, phaseEndIdx).filter((e) => classifyMoiEvent(e) !== null)
}

function getPhaseStartEntry(log, followingPhase) {
  if (!Array.isArray(log)) return null
  return log.find((e) => e.event === 'phase_start' && e.phaseType === 'gameplay' && e.phase === followingPhase) || null
}

export function DisplayFollowUp({ stateSync, mode = 'Communication & Clarity' }) {
  const log = stateSync?.log || []
  const phaseFlow = stateSync?.phaseFlow || {}
  const followingPhase = phaseFlow.followingPhase || 1
  const totalPhases = phaseFlow.totalGameplayPhases || 3
  const focusedEventId = stateSync?.followUpFocusedEventId || null

  const phaseStartEntry = getPhaseStartEntry(log, followingPhase)
  const phaseDurationSecs = phaseStartEntry?.durationMs ? phaseStartEntry.durationMs / 1000 : null
  const phaseStartT = phaseStartEntry?.t ?? 0

  const moiEvents = getMoiEventsForPhase(log, followingPhase)

  const focusedEvent = moiEvents.find((e) => e.eventId === focusedEventId) || moiEvents[0] || null

  const isLastPhase = followingPhase >= totalPhases

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto p-10 text-slate-100 min-h-screen justify-center">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-5xl font-black text-white tracking-tight">
          Level {followingPhase} Follow-up
        </h1>
        <p className="text-xl font-semibold text-slate-400 mt-2">{mode}</p>
      </div>

      {/* Timeline */}
      <div className="relative w-full bg-slate-900/80 border border-slate-800 rounded-3xl p-10 shadow-2xl">
        {/* Track */}
        <div className="relative flex items-center w-full">
          {/* Left cap */}
          <div className="w-3 h-3 rounded-full bg-slate-500 shrink-0" />

          {/* Bar + dots */}
          <div className="relative flex-1 h-2 bg-slate-700 rounded-full mx-2">
            {moiEvents.map((entry) => {
              const moiType = classifyMoiEvent(entry)
              const color = MOI_COLORS[moiType] || '#64748b'
              const tOffset = (entry.t ?? 0) - phaseStartT
              const pct = phaseDurationSecs && phaseDurationSecs > 0
                ? Math.min(100, Math.max(0, (tOffset / phaseDurationSecs) * 100))
                : 0
              const isFocused = entry.eventId === focusedEventId

              return (
                <div
                  key={entry.eventId}
                  className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2"
                  style={{ left: `${pct}%` }}
                >
                  <div
                    className="rounded-full transition-all"
                    style={{
                      width: isFocused ? 22 : 14,
                      height: isFocused ? 22 : 14,
                      backgroundColor: color,
                      boxShadow: isFocused ? `0 0 0 4px rgba(255,255,255,0.25), 0 0 14px ${color}` : 'none',
                    }}
                  />
                </div>
              )
            })}
          </div>

          {/* Right cap */}
          <div className="w-3 h-3 rounded-full bg-slate-500 shrink-0" />
        </div>

        {/* Callout for focused item */}
        {focusedEvent && (() => {
          const tOffset = (focusedEvent.t ?? 0) - phaseStartT
          const pct = phaseDurationSecs && phaseDurationSecs > 0
            ? Math.min(100, Math.max(0, (tOffset / phaseDurationSecs) * 100))
            : 0

          return (
            <div
              className="absolute mt-4"
              style={{
                left: `calc(${pct}% + 2.5rem)`,
                top: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              {/* Connector line */}
              <div className="flex flex-col items-center">
                <div className="w-px h-6 bg-slate-500" />
                <div
                  className="px-5 py-3 rounded-2xl shadow-2xl border border-rose-300/30 min-w-[140px]"
                  style={{ backgroundColor: 'rgba(253, 230, 230, 0.95)', color: '#1e293b' }}
                >
                  <p className="font-black text-base leading-tight">
                    {getMoiLabel(focusedEvent)}
                  </p>
                  <p className="text-sm font-semibold text-slate-600 mt-0.5">
                    {formatSeconds(tOffset)}
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Timeline labels */}
        <div className="flex justify-between mt-16 text-xs font-mono text-slate-500">
          <span>0:00</span>
          {phaseDurationSecs && (
            <span>{formatSeconds(phaseDurationSecs)}</span>
          )}
        </div>

        {/* Empty state */}
        {moiEvents.length === 0 && (
          <p className="text-center text-slate-500 text-sm mt-6 italic">
            No moments of interest recorded for this level.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 flex-wrap text-xs font-semibold text-slate-400">
        {[
          { color: MOI_COLORS.hazard_wall, label: 'Hit Wall / Cross' },
          { color: MOI_COLORS.key, label: 'Got Key' },
          { color: MOI_COLORS.goal, label: 'Reached Goal' },
          { color: MOI_COLORS.timer_expired, label: 'Out of Time' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Bottom hint */}
      <p className="text-center text-slate-500 text-sm">
        {isLastPhase
          ? 'All levels complete — trainer will wrap up the session.'
          : `Level ${followingPhase + 1} starts when the trainer is ready.`}
      </p>
    </div>
  )
}
