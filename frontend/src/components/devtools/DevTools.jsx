import { useState } from 'react'
import {
  Wrench,
  Monitor,
  Smartphone,
  Terminal,
  ChevronDown,
  ChevronUp,
  Radio,
  Tv,
  Users,
  RotateCcw,
  Footprints,
  Compass,
  Eye,
  Map,
  GraduationCap,
  Bell,
  Skull,
  HeartCrack,
  Trophy,
  Clock,
  Megaphone,
} from 'lucide-react'

export const BIG_SCREEN_VIEWS = [
  { id: 'display_lobby', label: 'Lobby View', icon: Users, color: 'text-blue-400' },
  { id: 'display_playing', label: 'Gameplay View', icon: Tv, color: 'text-indigo-400' },
  { id: 'display_followup', label: 'Follow-up Dashboard', icon: Clock, color: 'text-teal-400' },
  { id: 'display_debrief', label: 'Debrief Summary', icon: RotateCcw, color: 'text-purple-400' },
]

export const CONTROLLER_VIEWS = [
  { id: 'controller_join', label: 'Join Form', icon: Smartphone, color: 'text-slate-300' },
  { id: 'controller_waiting', label: 'Lobby Waiting', icon: Users, color: 'text-sky-400' },
  { id: 'controller_mover', label: 'Mover Role', icon: Footprints, color: 'text-blue-400' },
  { id: 'controller_guide', label: 'Guide Role', icon: Compass, color: 'text-purple-400' },
  { id: 'controller_key_seer', label: 'Key-Seer Role', icon: Eye, color: 'text-amber-400' },
  { id: 'controller_navigator', label: 'Navigator Role', icon: Map, color: 'text-teal-400' },
  { id: 'controller_trainer', label: 'Trainer Dashboard', icon: GraduationCap, color: 'text-amber-300' },
]

export function DevTools({
  mode,
  setMode,
  activeView,
  setActiveView,
  stateSync,
  sessionId,
  onTriggerMockNotification,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [showJson, setShowJson] = useState(false)

  const isLive = activeView === 'live'

  const handleSelectView = (viewId, targetMode) => {
    setActiveView(viewId)
    if (targetMode) {
      setMode(targetMode)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 text-xs font-sans select-none">
      {isOpen && (
        <div className="p-4 rounded-3xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-2xl text-slate-200 w-96 flex flex-col gap-4 transition-all">
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <Wrench className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-slate-100 tracking-wider uppercase text-[11px]">
                DevStudio Inspector
              </span>
            </div>
            <span className="font-mono text-[10px] bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-slate-400">
              {sessionId || 'NO SESSION'}
            </span>
          </div>

          {/* Mode Switcher: Live vs Inspector Preview */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-black text-slate-400 tracking-wider flex items-center justify-between">
              <span>Mode Target</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isLive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                {isLive ? 'LIVE SOCKET' : 'MOCK INSPECTOR'}
              </span>
            </span>

            <button
              type="button"
              onClick={() => handleSelectView('live')}
              className={`w-full p-2.5 rounded-2xl border font-bold flex items-center justify-between transition-all cursor-pointer ${
                isLive
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-950/50'
                  : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${isLive ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                <span className="text-xs">Live Socket Session</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">{mode === 'display' ? 'Big Screen' : 'Controller'}</span>
            </button>
          </div>

          {/* Big Screen Views */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-black text-blue-400 tracking-wider flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5" /> Big Screen Views
            </span>
            <div className="grid grid-cols-1 gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
              {BIG_SCREEN_VIEWS.map((v) => {
                const Icon = v.icon
                const isActive = activeView === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleSelectView(v.id, 'display')}
                    className={`p-2 rounded-xl font-bold flex items-center gap-2 text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : v.color}`} />
                    <span>{v.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Controller Views */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-black text-amber-400 tracking-wider flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5" /> Controller Views
            </span>
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
              {CONTROLLER_VIEWS.map((v) => {
                const Icon = v.icon
                const isActive = activeView === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleSelectView(v.id, 'controller')}
                    className={`p-2 rounded-xl font-bold flex items-center gap-2 text-xs transition-all cursor-pointer ${
                      isActive
                        ? 'bg-amber-600 text-white shadow-md'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : v.color}`} />
                    <span className="truncate">{v.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Test Overlay Notifications Panel */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <span className="text-[10px] uppercase font-black text-rose-400 tracking-wider flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" /> Test Overlay Notifications
            </span>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-2 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-death-${Date.now()}`,
                    type: 'death',
                    variant: 'danger',
                    title: 'HAZARD HIT - LIFE LOST!',
                    subtitle: '2 lives remaining. Returning to start position!',
                    icon: Skull,
                    duration: 4500,
                  })
                }
                className="p-1.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/80 text-rose-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Skull className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="truncate">Life Lost</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-defeat-${Date.now()}`,
                    type: 'defeat',
                    variant: 'danger',
                    title: 'TEAM DEFEATED!',
                    subtitle: 'All team lives lost. Review session debrief with trainer.',
                    icon: HeartCrack,
                    persistent: true,
                  })
                }
                className="p-1.5 rounded-xl bg-rose-950/90 hover:bg-rose-900 border border-rose-600 text-rose-100 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <HeartCrack className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                <span className="truncate">Team Defeat</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-victory-${Date.now()}`,
                    type: 'win',
                    variant: 'success',
                    title: 'MAZE ESCAPED! VICTORY!',
                    subtitle: 'All keys collected and exit reached safely. Outstanding teamwork!',
                    icon: Trophy,
                    persistent: true,
                  })
                }
                className="p-1.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-700/80 text-emerald-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Victory</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-followup-${Date.now()}`,
                    type: 'follow_up',
                    variant: 'info',
                    title: 'FOLLOW-UP PHASE STARTED',
                    subtitle: 'Gameplay paused. Proceeding into trainer guided debrief.',
                    icon: Clock,
                    duration: 6000,
                  })
                }
                className="p-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900/80 border border-indigo-700/80 text-indigo-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="truncate">Follow-Up</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-phase-${Date.now()}`,
                    type: 'phase_change',
                    variant: 'primary',
                    title: 'PHASE 2 STARTED',
                    subtitle: 'Navigating phase 2 of the session protocol!',
                    icon: Radio,
                    duration: 4000,
                  })
                }
                className="p-1.5 rounded-xl bg-blue-950/80 hover:bg-blue-900/80 border border-blue-700/80 text-blue-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="truncate">Phase Update</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onTriggerMockNotification?.({
                    id: `test-broadcast-${Date.now()}`,
                    type: 'broadcast',
                    variant: 'warning',
                    title: 'FACILITATOR ANNOUNCEMENT',
                    subtitle: 'Trainer: Focus on communicating wall positions clearly!',
                    icon: Megaphone,
                    duration: 7000,
                  })
                }
                className="p-1.5 rounded-xl bg-amber-950/80 hover:bg-amber-900/80 border border-amber-700/80 text-amber-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Megaphone className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Broadcast</span>
              </button>
            </div>
          </div>

          {/* State Sync JSON Debugger */}
          <div className="flex flex-col gap-1 pt-1 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              className="py-1.5 px-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" /> State Sync Log
              </span>
              {showJson ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showJson && (
              <pre className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono text-emerald-400 max-h-40 overflow-auto scrollbar-thin">
                {JSON.stringify(stateSync, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-2xl flex items-center gap-2 border border-blue-400/50 font-bold active:scale-95 transition-all cursor-pointer"
      >
        <Wrench className="w-4 h-4" />
        <span className="text-xs">DevTools Inspector</span>
      </button>
    </div>
  )
}
