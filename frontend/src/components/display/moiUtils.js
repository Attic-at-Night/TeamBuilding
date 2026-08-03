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

  const phaseEvents = log.slice(phaseStartIdx + 1, phaseEndIdx).filter((e) => classifyMoiEvent(e) !== null)
  const prePhaseEvents = followingPhase === 1
    ? log.slice(0, phaseStartIdx).filter((e) => e.event === 'mode_set' && classifyMoiEvent(e) !== null)
    : []

  return [...prePhaseEvents, ...phaseEvents].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
}

export { MOI_COLORS, MOI_LEGEND, classifyMoiEvent, getMoiLabel, formatSeconds, getMoiDisplayTime, getMoiEventsForPhase, getModeDisplayName, getModeFocusText }
