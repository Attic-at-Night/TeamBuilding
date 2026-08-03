import { useState } from 'react'
import { GridCanvas } from '../maze/GridCanvas'
import {
  GraduationCap,
  Map,
  List,
  Eye,
  Sparkles,
  Send,
  Play,
  Pause,
  RotateCcw,
  Check,
  X,
  Radio,
  Bookmark,
  Share2,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  LogOut,
} from 'lucide-react'
import { MessageType, CLARITY_TYPES } from '../../protocol'

function classifyMoiEvent(entry) {
  if (entry.event === 'hazard_hit') return entry.hazardType === 'wall' ? 'hazard_wall' : 'hazard_cross'
  if (entry.event === 'key_pickup') return 'key'
  if (entry.event === 'session_end' && entry.reason === 'goal_reached') return 'goal'
  if (entry.event === 'timer_expired') return 'timer_expired'
  if (entry.event === 'session_end' && entry.outcome === 'fail') return 'out_of_lives'
  return null
}

function getMoiLabel(entry) {
  if (entry.event === 'hazard_hit') return entry.hazardType === 'wall' ? 'Hit a wall' : 'Hit cross'
  if (entry.event === 'key_pickup') {
    const n = entry.keyIndex != null ? ` ${entry.keyIndex + 1}` : ''
    return `Got Key${n}`
  }
  if (entry.event === 'session_end' && entry.reason === 'goal_reached') return 'Reached Goal'
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

export function TrainerDashboard({ stateSync, onSend }) {
  const [activeTab, setActiveTab] = useState('maze') // 'maze', 'events', 'perspectives', 'ai', 'broadcast'
  const [selectedPerspective, setSelectedPerspective] = useState('mover')
  const [broadcastText, setBroadcastText] = useState('')
  const [timerInput, setTimerInput] = useState(15)

  const status = stateSync?.status || 'lobby'
  const timer = stateSync?.timer || {}
  const phaseFlow = stateSync?.phaseFlow || {}
  const players = stateSync?.players || []
  const trainerMaze = stateSync?.trainerMaze || stateSync?.roleData?.trainerMaze
  const trainerEvents = stateSync?.trainerEvents || stateSync?.roleData?.trainerEvents || []
  const trainerRoleViews = stateSync?.trainerRoleViews || stateSync?.roleData?.trainerRoleViews || []
  const aiSuggestions = stateSync?.aiSuggestions || stateSync?.roleData?.aiSuggestions || []
  const highlightedIds = stateSync?.trainerHighlightEventIds || stateSync?.roleData?.trainerHighlightEventIds || []
  const followUpFocusedEventId = stateSync?.followUpFocusedEventId || null
  const log = stateSync?.log || []
  const followingPhase = phaseFlow?.followingPhase || null
  const totalGameplayPhases = phaseFlow?.totalGameplayPhases || 3

  // Timer calculation
  const remainingMs = timer?.remainingMs ?? phaseFlow?.phaseRemainingMs ?? 0
  const timerMinutes = Math.floor(remainingMs / 60000)
  const timerSeconds = Math.floor((remainingMs % 60000) / 1000)
  const timerFormatted = `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`

  function sendTimerStart() {
    onSend({ type: MessageType.TIMER_START, durationMs: timerInput * 60 * 1000 })
  }

  function sendTimerStop() {
    onSend({ type: MessageType.TIMER_STOP })
  }

  function sendTimerReset() {
    onSend({ type: MessageType.TIMER_RESET, durationMs: timerInput * 60 * 1000 })
  }

  function sendRestart() {
    onSend({ type: MessageType.GAME_RESTART })
  }

  function sendEndFollowup() {
    onSend({ type: MessageType.FOLLOWUP_END })
  }

  function sendFollowupNavigate(direction) {
    onSend({ type: MessageType.FOLLOWUP_NAVIGATE, direction })
  }

  function toggleHighlight(eventId) {
    onSend({
      type: MessageType.PLAYER_INPUT,
      input: { action: 'trainer_toggle_highlight', eventId },
    })
  }

  function addClarityEvent(clarityType) {
    onSend({
      type: MessageType.PLAYER_INPUT,
      input: { action: 'trainer_add_clarity_event', clarityType },
    })
  }

  function shareReplay(eventId) {
    onSend({
      type: MessageType.PLAYER_INPUT,
      input: { action: 'trainer_share_replay', eventId },
    })
  }

  function handleBroadcast(e) {
    e.preventDefault()
    if (!broadcastText.trim()) return
    onSend({
      type: MessageType.PLAYER_INPUT,
      input: { action: 'trainer_broadcast', message: broadcastText.trim() },
    })
    setBroadcastText('')
  }

  function respondAiSuggestion(suggestionId, approved) {
    onSend({
      type: MessageType.PLAYER_INPUT,
      input: { action: 'trainer_decide_ai_suggestion', suggestionId, approved },
    })
  }

  // Synthetic perspective role data fallback strictly adhering to role visibility rules
  function getSyntheticRoleData(role, maze, summaryData) {
    if (!maze) return {}
    if (role === 'mover') {
      return {
        assignedRoles: ['mover'],
        playerPos: maze.playerPos,
        maze: {
          width: maze.width,
          height: maze.height,
          playerPos: maze.playerPos,
          reached: maze.reached,
        },
      }
    }
    if (role === 'guide') {
      return {
        assignedRoles: ['guide'],
        playerPos: maze.playerPos,
        hazards: maze.hazards || [],
        ghosts: maze.ghosts || [],
        maze: {
          width: maze.width,
          height: maze.height,
        },
      }
    }
    if (role === 'key-seer') {
      return {
        assignedRoles: ['key-seer'],
        playerPos: maze.playerPos,
        keys: maze.keys || [],
        goal: ((summaryData?.keysCollected ?? 0) >= 3 ? maze.goal : null),
        maze: {
          width: maze.width,
          height: maze.height,
        },
      }
    }
    if (role === 'navigator') {
      return {
        assignedRoles: ['navigator'],
        playerPos: maze.playerPos,
        maze: {
          width: maze.width,
          height: maze.height,
          cells: maze.cells,
          playerPos: maze.playerPos,
          reached: maze.reached,
        },
      }
    }
    return {}
  }

  // Active Perspective Data
  const perspectiveView = trainerRoleViews.find(
    (v) => (v.assignedRoles && v.assignedRoles.includes(selectedPerspective)) || v.viewerRole === selectedPerspective
  )
  const pRoleData = perspectiveView?.roleData || getSyntheticRoleData(selectedPerspective, trainerMaze, stateSync?.summary)

  // --- Dedicated follow-up view (replaces full dashboard during follow_up phase) ---
  if (status === 'follow_up') {
    const moiEvents = getMoiEventsForPhase(log, followingPhase)
    const focusedEvent = moiEvents.find((e) => e.eventId === followUpFocusedEventId) || moiEvents[0] || null
    const focusedIndex = moiEvents.findIndex((e) => e.eventId === focusedEvent?.eventId)
    const isLastPhase = !Number.isInteger(followingPhase) || followingPhase >= totalGameplayPhases
    const phaseStartEntry = log.find(
      (e) => e.event === 'phase_start' && e.phaseType === 'gameplay' && e.phase === followingPhase
    )
    const phaseStartT = phaseStartEntry?.t ?? 0

    return (
      <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-4 text-slate-100">

        {/* Header strip */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-800/40 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-600/30 border border-indigo-500/40">
                <GraduationCap className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 block">Facilitator View</span>
                <span className="text-lg font-extrabold text-white">Level {followingPhase} Follow-up</span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-900/60 border border-indigo-700/50 text-indigo-200">
              Follow-up
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-400 mt-1 ml-11">Communication &amp; Clarity</p>
        </div>

        {/* Event counter */}
        {moiEvents.length > 0 && (
          <p className="text-xs text-slate-500 text-center font-mono">
            {focusedIndex >= 0 ? focusedIndex + 1 : '–'} of {moiEvents.length} moment{moiEvents.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Focused MOI event card */}
        {focusedEvent ? (
          <div className="p-5 rounded-2xl bg-rose-950/20 border border-rose-200/30 shadow-xl flex flex-col gap-1">
            <p className="text-base font-black text-rose-200 leading-tight">{getMoiLabel(focusedEvent)}</p>
            {typeof focusedEvent.t === 'number' && (
              <p className="text-sm font-semibold text-rose-300/70">{formatSeconds(focusedEvent.t - phaseStartT)}</p>
            )}
          </div>
        ) : (
          <div className="p-5 rounded-2xl bg-slate-800/60 border border-slate-700 text-center">
            <p className="text-sm text-slate-500 italic">No moments of interest recorded for this level.</p>
          </div>
        )}

        {/* Prev / Next navigation */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => sendFollowupNavigate('prev')}
            disabled={moiEvents.length === 0 || focusedIndex <= 0}
            className="flex flex-col items-center gap-1.5 py-4 px-6 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold active:scale-95 transition-all cursor-pointer shadow-lg"
          >
            <ChevronLeft className="w-6 h-6" />
            <span className="text-xs">Prev Item</span>
          </button>
          <button
            type="button"
            onClick={() => sendFollowupNavigate('next')}
            disabled={moiEvents.length === 0 || focusedIndex >= moiEvents.length - 1}
            className="flex flex-col items-center gap-1.5 py-4 px-6 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold active:scale-95 transition-all cursor-pointer shadow-lg"
          >
            <ChevronRight className="w-6 h-6" />
            <span className="text-xs">Next Item</span>
          </button>
        </div>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={sendEndFollowup}
          className={`w-full py-4 rounded-2xl text-white font-black text-base flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer shadow-lg ${
            !isLastPhase ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-700 hover:bg-rose-600'
          }`}
        >
          {!isLastPhase ? (
            <><ArrowRight className="w-5 h-5" /> Start Level {followingPhase + 1}</>
          ) : (
            <><LogOut className="w-5 h-5" /> End Session</>
          )}
        </button>

      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto p-4 text-slate-100">
      {/* Facilitator Header & Timer Controls */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-800/40 shadow-xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-600/30 border border-indigo-500/40">
              <GraduationCap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 block">Facilitator View</span>
              <span className="text-lg font-extrabold text-white">Trainer Dashboard</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-900/60 border border-indigo-700/50 text-indigo-200">
              {status}
            </span>
          </div>
        </div>

        {/* Start Game Session Banner for Trainer in Lobby */}
        {status === 'lobby' && (
          <div className="p-3.5 rounded-xl bg-indigo-950/80 border border-indigo-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Session Lobby Active ({players.length}/4 Connected)
              </span>
              <span className="text-[11px] text-indigo-300/80">
                Requires at least 2 players to start the 3-round session (15m, 10m, 5m).
              </span>
            </div>
            <button
              type="button"
              disabled={players.length < 2}
              onClick={() => onSend({ type: MessageType.GAME_START })}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black shadow-lg flex items-center gap-2 shrink-0 active:scale-95 transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Game Session</span>
            </button>
          </div>
        )}

        {/* Timer Control Bar & Clock Display */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 gap-3 flex-wrap">
          {/* Live Timer Readout */}
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xl font-extrabold text-white shadow-inner">
              {timerFormatted}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {phaseFlow?.phaseType === 'gameplay'
                  ? `Round ${phaseFlow?.currentPhase || 1} of 3`
                  : (status === 'follow_up' ? 'Follow-up' : 'Timer')}
              </span>
              <span className="text-[11px] font-semibold text-indigo-300">
                {timer?.status ? timer.status.toUpperCase() : 'IDLE'}
              </span>
            </div>
          </div>

          {/* Duration Input & Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="60"
                value={timerInput}
                onChange={(e) => setTimerInput(Number(e.target.value))}
                className="w-12 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-bold text-center text-white"
              />
              <span className="text-xs text-slate-400 font-medium">m</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={sendTimerStart}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                title="Start or Resume Timer"
              >
                <Play className="w-3.5 h-3.5 fill-white" /> Start
              </button>
              <button
                type="button"
                onClick={sendTimerStop}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                title="Pause Timer"
              >
                <Pause className="w-3.5 h-3.5 fill-white" /> Pause
              </button>
              <button
                type="button"
                onClick={sendTimerReset}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                title="Reset Timer to input duration"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>

            {status === 'ended' && (
              <button
                type="button"
                onClick={sendRestart}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer"
              >
                Restart Session
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs + Tab Content */}
      <>
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-xl text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('maze')}
          className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'maze' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Map className="w-4 h-4" /> Maze
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('events')}
          className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'events' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <List className="w-4 h-4" /> Events ({trainerEvents.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('perspectives')}
          className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'perspectives' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Eye className="w-4 h-4" /> Views
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ai')}
          className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all relative ${
            activeTab === 'ai' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-300" /> AI
          {aiSuggestions.filter((s) => s.status === 'pending').length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse absolute top-1 right-2" />
          )}
        </button>
      </div>
      {activeTab === 'maze' && (
        <div className="flex flex-col items-center bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="w-full flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">God-Mode Master View</span>
            <span className="text-xs text-indigo-300 font-mono">Full Asymmetrical Overlay</span>
          </div>
          <GridCanvas
            width={trainerMaze?.width || 15}
            height={trainerMaze?.height || 15}
            cells={trainerMaze?.cells}
            playerPos={trainerMaze?.playerPos}
            keys={trainerMaze?.keys}
            goal={trainerMaze?.goal}
            hazards={trainerMaze?.hazards}
            ghosts={trainerMaze?.ghosts}
            lifePickups={trainerMaze?.lifePickups}
            reached={trainerMaze?.reached}
            fogRadius={null}
            mode="trainer"
            accentColor="#3b82f6"
          />
        </div>
      )}

      {/* Tab 2: Timeline Events & Clarity Tagging */}
      {activeTab === 'events' && (
        <div className="flex flex-col gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Clarity Event Tagging</span>
          </div>

          {/* Quick Tagging Buttons */}
          <div className="grid grid-cols-3 gap-2">
            {CLARITY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addClarityEvent(type)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-indigo-900/50 border border-slate-700/80 text-[11px] font-bold text-slate-200 capitalize active:scale-95 transition-all text-center"
              >
                + {type.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Event Feed List */}
          <div className="max-h-80 overflow-y-auto flex flex-col gap-2 mt-2">
            {trainerEvents.length === 0 ? (
              <span className="text-slate-500 italic text-xs p-2">No timeline events logged yet.</span>
            ) : (
              trainerEvents.slice().reverse().map((entry) => {
                const isHighlighted = highlightedIds.includes(entry.eventId) || entry.highlighted
                return (
                  <div
                    key={entry.eventId}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-2 text-xs transition-all ${
                      isHighlighted
                        ? 'bg-amber-950/40 border-amber-500/80 text-amber-100 shadow-md'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-200'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-300 capitalize">{entry.event.replace('_', ' ')}</span>
                        {entry.player && <span className="text-[10px] text-slate-400">({entry.player})</span>}
                      </div>
                      {entry.reason && <span className="text-[11px] text-slate-300">{entry.reason}</span>}
                      {entry.clarityType && <span className="text-[11px] text-amber-300 font-semibold">Clarity: {entry.clarityType}</span>}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleHighlight(entry.eventId)}
                        className={`p-1.5 rounded-lg border text-xs ${
                          isHighlighted
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                            : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-300'
                        }`}
                        title="Bookmark / Highlight Event"
                      >
                        <Bookmark className="w-3.5 h-3.5" />
                      </button>

                      {entry.clarityType && (
                        <button
                          type="button"
                          onClick={() => shareReplay(entry.eventId)}
                          className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400 text-xs"
                          title="Share Replay Snippet to Big Display"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Perspectives Live Previewer */}
      {activeTab === 'perspectives' && (
        <div className="flex flex-col gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-around border-b border-slate-800 pb-2 text-xs font-bold">
            {['mover', 'guide', 'key-seer', 'navigator'].map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedPerspective(role)}
                className={`px-3 py-1.5 rounded-lg uppercase transition-all ${
                  selectedPerspective === role
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {role}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center">
            <span className="text-xs font-semibold text-slate-400 uppercase mb-2">
              Previewing {selectedPerspective.toUpperCase()} View
            </span>
            <GridCanvas
              width={pRoleData?.maze?.width || 15}
              height={pRoleData?.maze?.height || 15}
              cells={pRoleData?.maze?.cells}
              playerPos={pRoleData?.playerPos || pRoleData?.maze?.playerPos}
              keys={pRoleData?.keys}
              goal={pRoleData?.goal}
              hazards={pRoleData?.hazards}
              ghosts={pRoleData?.ghosts}
              lifePickups={pRoleData?.lifePickups}
              reached={pRoleData?.maze?.reached}
              fogRadius={null}
              mode={selectedPerspective}
              accentColor="#3b82f6"
            />
          </div>
        </div>
      )}

      {/* Tab 4: AI Friction Suggestions */}
      {activeTab === 'ai' && (
        <div className="flex flex-col gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Automated AI Coordination Friction Detection</span>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {aiSuggestions.length === 0 ? (
              <span className="text-slate-500 italic text-xs p-2">No friction suggestions detected yet.</span>
            ) : (
              aiSuggestions.map((s) => (
                <div key={s.id} className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-200 capitalize">{s.type.replace('_', ' ')}</span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{s.summary}</p>

                  {s.status === 'pending' && (
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => respondAiSuggestion(s.id, true)}
                        className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => respondAiSuggestion(s.id, false)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-all"
                      >
                        <X className="w-3.5 h-3.5" /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Facilitator Broadcast Form */}
      <form onSubmit={handleBroadcast} className="flex gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 shadow-lg">
        <input
          type="text"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Broadcast a facilitator note to Big Display & Players..."
          className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!broadcastText.trim()}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-all"
        >
          <Radio className="w-4 h-4" /> Broadcast
        </button>
      </form>
      </>
    </div>
  )
}
