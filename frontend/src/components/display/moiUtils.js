const MOI_COLORS = {
  mode_set: '#38bdf8',
  level_progression: '#64748b',
  level_start: '#64748b',
  first_movement: '#14b8a6',
  movement_pause: '#f59e0b',
  hazard_wall: '#ef4444',
  hazard_cross: '#ef4444',
  key: '#eab308',
  goal: '#22c55e',
  timer_expired: '#111827',
  out_of_lives: '#111827',
}

const MOI_LEGEND = [
  { color: MOI_COLORS.mode_set, label: 'Mode Set' },
  { color: MOI_COLORS.level_progression, label: 'Level Progression' },
  { color: MOI_COLORS.level_start, label: 'Level Start' },
  { color: MOI_COLORS.first_movement, label: 'First Movement' },
  { color: MOI_COLORS.movement_pause, label: 'Movement Pause/Break' },
  { color: MOI_COLORS.hazard_wall, label: 'Hit Wall' },
  { color: MOI_COLORS.hazard_cross, label: 'Hit Cross' },
  { color: MOI_COLORS.key, label: 'Got Key' },
  { color: MOI_COLORS.goal, label: 'Reached Goal' },
  { color: MOI_COLORS.timer_expired, label: 'Out of time' },
  { color: MOI_COLORS.out_of_lives, label: 'Out of lives' }
]

function normalizeMode(mode) {
  if (typeof mode !== 'string') return 'communication & clarity'
  const trimmed = mode.trim().toLowerCase()
  if (trimmed === 'collaboration & teamwork' || trimmed === 'collaboration') {
    return 'collaboration & teamwork'
  }
  return 'communication & clarity'
}

function getModeDisplayName(mode) {
  return normalizeMode(mode) === 'collaboration & teamwork'
    ? 'Collaboration & Teamwork'
    : 'Communication & Clarity'
}

function getModeFocusText(mode) {
  return normalizeMode(mode) === 'collaboration & teamwork'
    ? 'Focus on coordination, shared progress, and role shifts.'
    : 'Focus on clarity, listening, and stable roles.'
}

function classifyMoiEvent(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.event === 'mode_set') return 'mode_set'
  if (entry.event === 'level_progression') return 'level_progression'
  if (entry.event === 'level_start') return 'level_start'
  if (entry.event === 'first_movement') return 'first_movement'
  if (entry.event === 'movement_pause') return 'movement_pause'
  if (entry.event === 'hazard_hit') return entry.hazardType === 'wall' ? 'hazard_wall' : 'hazard_cross'
  if (entry.event === 'key_pickup') return 'key'
  if (entry.event === 'session_end' && entry.reason === 'goal_reached') return 'goal'
  if (entry.event === 'timer_expired') return 'timer_expired'
  if (entry.event === 'session_end' && entry.outcome === 'fail') return 'out_of_lives'
  return null
}

function getMoiLabel(entry, mode = null) {
  if (!entry || typeof entry !== 'object') return 'Event'
  switch (entry.event) {
    case 'mode_set':
      return `Mode Set • ${getModeDisplayName(entry.mode || mode)}`
    case 'level_progression':
      return `Level ${entry.level ?? entry.phase ?? 1}`
    case 'level_start':
      return 'Level Start'
    case 'first_movement':
      return 'First Movement'
    case 'movement_pause':
      return 'Movement Pause/Break'
    case 'hazard_hit':
      return entry.hazardType === 'wall' ? 'Hit Wall' : 'Hit Cross'
    case 'key_pickup': {
      const n = entry.keyIndex != null ? ` ${entry.keyIndex + 1}` : ''
      return `Got Key${n}`
    }
    case 'session_end':
      if (entry.reason === 'goal_reached') return 'Reached Goal'
      return 'Out of lives'
    case 'timer_expired':
      return 'Out of time'
    default:
      return entry.event
  }
}

function formatSeconds(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${String(rem).padStart(2, '0')}s`
}

function getMoiDisplayTime(entry, phaseStartT) {
  if (!entry || typeof entry !== 'object') return 0
  if (entry.event === 'movement_pause' && typeof entry.durationMs === 'number') {
    return Math.max(0, entry.durationMs / 1000)
  }
  if (typeof entry.t === 'number') {
    return Math.max(0, entry.t - phaseStartT)
  }
  return 0
}

function getMoiEventsForPhase(log, followingPhase) {
  if (!Array.isArray(log)) return []

  let phaseStartIdx = -1
  let phaseEndIdx = log.length
  let phaseStartEntry = null
  for (let i = 0; i < log.length; i++) {
    const e = log[i]
    if (e.event === 'phase_start' && e.phaseType === 'gameplay' && e.phase === followingPhase) {
      phaseStartIdx = i
      phaseStartEntry = e
    }
    if (phaseStartIdx >= 0 && i > phaseStartIdx && e.event === 'phase_start') {
      phaseEndIdx = i
      break
    }
  }

  if (phaseStartIdx < 0) return []

  const phaseStartEntry_ = phaseStartEntry || log[phaseStartIdx]
  // Use session-relative t if available, otherwise derive from ts
  const phaseStartTs = phaseStartEntry_?.ts || 0
  const phaseStartT = typeof phaseStartEntry_?.t === 'number' ? phaseStartEntry_.t : 0

  function toPhaseRelativeT(e) {
    if (typeof e.t === 'number') return Math.max(0, e.t - phaseStartT)
    if (typeof e.ts === 'number' && phaseStartTs) return Math.max(0, (e.ts - phaseStartTs) / 1000)
    return 0
  }

  const phaseEvents = log.slice(phaseStartIdx + 1, phaseEndIdx)
    .filter((e) => classifyMoiEvent(e) !== null)
    .map((e) => ({ ...e, t: toPhaseRelativeT(e) }))

  const prePhaseEvents = followingPhase === 1
    ? log.slice(0, phaseStartIdx)
        .filter((e) => e.event === 'mode_set' && classifyMoiEvent(e) !== null)
        .map((e) => ({ ...e, t: toPhaseRelativeT(e) }))
    : []

  return [...prePhaseEvents, ...phaseEvents].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
}

function extractRoundsData(log, summary = {}) {
  if (!Array.isArray(log) || log.length === 0) {
    return [{
      round: 1,
      outcome: summary?.outcome || (summary?.livesRemaining > 0 ? 'success' : 'fail'),
      durationSeconds: summary?.durationSeconds || 0,
      keysCollected: summary?.keysCollected || 0,
      hazardsHit: summary?.hazardsHit || 0,
      resetsCount: summary?.resetsCount || summary?.resets || 0,
      possibleKeys: 3 * ((summary?.resetsCount || summary?.resets || 0) + 1),
      moiEvents: [],
      phaseStartT: 0,
    }]
  }

  const phaseStarts = []
  for (let i = 0; i < log.length; i++) {
    const e = log[i]
    if (e.event === 'phase_start' && e.phaseType === 'gameplay') {
      phaseStarts.push({ index: i, entry: e, phase: e.phase || (phaseStarts.length + 1) })
    }
  }

  if (phaseStarts.length === 0) {
    const firstTs = log[0]?.ts || 0
    const moiEvents = log.filter((e) => classifyMoiEvent(e) !== null).map((e) => ({
      ...e,
      t: typeof e.t === 'number' ? e.t : (e.ts ? (e.ts - firstTs) / 1000 : 0)
    }))
    const keysCount = log.filter((e) => e.event === 'key_pickup').length
    const hazardsCount = log.filter((e) => e.event === 'hazard_hit').length
    const resetsCount = Math.max(log.filter((e) => e.event === 'reset').length, summary?.resetsCount || summary?.resets || 0)
    const lastResetIdx = log.map((e, idx) => e.event === 'reset' ? idx : -1).filter((idx) => idx >= 0).pop() ?? -1
    const keysAfterLastReset = log.slice(lastResetIdx + 1).filter((e) => e.event === 'key_pickup').length
    const endEvent = [...log].reverse().find((e) => e.event === 'session_end' || e.event === 'timer_expired')
    const lastTs = endEvent?.ts || log[log.length - 1]?.ts || firstTs
    const durationSeconds = Math.max(1, Math.round((lastTs - firstTs) / 1000)) || summary?.durationSeconds || 0
    let outcome = 'success'
    if (endEvent?.event === 'session_end' && endEvent.outcome === 'fail') outcome = 'fail'
    if (endEvent?.event === 'timer_expired') outcome = 'timeout'

    return [{
      round: 1,
      outcome,
      durationSeconds,
      keysCollected: Math.max(keysAfterLastReset, summary?.keysCollected || 0),
      possibleKeys: 3 * (resetsCount + 1),
      hazardsHit: Math.max(hazardsCount, summary?.hazardsHit || 0),
      resetsCount,
      moiEvents,
      phaseStartT: 0,
    }]
  }

  const roundsData = []
  for (let i = 0; i < phaseStarts.length; i++) {
    const ps = phaseStarts[i]
    const roundNum = ps.phase
    const startIdx = ps.index
    const endIdx = (i < phaseStarts.length - 1) ? phaseStarts[i + 1].index : log.length
    const phaseLog = log.slice(startIdx, endIdx)

    const startTs = ps.entry.ts || phaseLog[0]?.ts || 0
    const endEvent = phaseLog.slice().reverse().find((e) => e.event === 'session_end' || e.event === 'timer_expired')
    const lastTs = endEvent?.ts || phaseLog[phaseLog.length - 1]?.ts || startTs
    const durationSeconds = Math.max(1, Math.round((lastTs - startTs) / 1000))

    const hazardsHit = phaseLog.filter((e) => e.event === 'hazard_hit').length
    const resetsCount = phaseLog.filter((e) => e.event === 'reset').length
    // Count keys collected after the last reset (or from the start if no reset)
    const lastResetIdx = phaseLog.map((e, idx) => e.event === 'reset' ? idx : -1).filter((idx) => idx >= 0).pop() ?? -1
    const keysCollected = phaseLog.slice(lastResetIdx + 1).filter((e) => e.event === 'key_pickup').length
    const possibleKeys = 3 * (resetsCount + 1)

    let outcome = 'success'
    if (endEvent) {
      if (endEvent.event === 'session_end') {
        if (endEvent.outcome === 'fail' || (endEvent.reason && endEvent.reason.includes('hazard'))) {
          outcome = 'fail'
        } else if (endEvent.outcome === 'success' || endEvent.reason === 'goal_reached') {
          outcome = 'success'
        }
      } else if (endEvent.event === 'timer_expired') {
        outcome = 'timeout'
      }
    } else {
      if (keysCollected < 3) {
        outcome = 'fail'
      }
    }

    const moiEvents = getMoiEventsForPhase(log, roundNum)
    const timelineDurationSeconds = Math.max(
      durationSeconds,
      moiEvents.reduce((max, entry) => Math.max(max, entry.t ?? 0), 0),
    )

    roundsData.push({
      round: roundNum,
      outcome,
      durationSeconds: timelineDurationSeconds,
      keysCollected,
      possibleKeys,
      hazardsHit,
      resetsCount,
      moiEvents,
      phaseStartT: 0,
    })
  }

  return roundsData
}

export { MOI_COLORS, MOI_LEGEND, classifyMoiEvent, getMoiLabel, formatSeconds, getMoiDisplayTime, getMoiEventsForPhase, extractRoundsData, getModeDisplayName, getModeFocusText }
