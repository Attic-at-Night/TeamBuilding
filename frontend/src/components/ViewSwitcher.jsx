import React from 'react'
import {
  Tv,
  Smartphone,
  Play,
  RotateCcw,
  Users,
  Footprints,
  Compass,
  Eye,
  Map,
  GraduationCap,
  Radio,
  Sparkles,
  EyeOff,
} from 'lucide-react'

export const VIEW_OPTIONS = [
  { id: 'live', label: 'Live Socket Session', group: 'mode', icon: Radio, color: 'text-emerald-400 bg-emerald-950/80 border-emerald-500/60' },

  // Big Display Views
  { id: 'display_lobby', label: 'Big Screen: Lobby', group: 'display', icon: Users, color: 'text-blue-400' },
  { id: 'display_playing', label: 'Big Screen: Gameplay', group: 'display', icon: Tv, color: 'text-indigo-400' },
  { id: 'display_debrief', label: 'Big Screen: Debrief', group: 'display', icon: RotateCcw, color: 'text-purple-400' },

  // Controller Views
  { id: 'controller_join', label: 'Controller: Join Form', group: 'controller', icon: Smartphone, color: 'text-slate-300' },
  { id: 'controller_waiting', label: 'Controller: Waiting', group: 'controller', icon: Users, color: 'text-sky-400' },
  { id: 'controller_mover', label: 'Controller: Mover', group: 'controller', icon: Footprints, color: 'text-blue-400' },
  { id: 'controller_guide', label: 'Controller: Guide', group: 'controller', icon: Compass, color: 'text-purple-400' },
  { id: 'controller_key_seer', label: 'Controller: Key-Seer', group: 'controller', icon: Eye, color: 'text-amber-400' },
  { id: 'controller_navigator', label: 'Controller: Navigator', group: 'controller', icon: Map, color: 'text-teal-400' },
  { id: 'controller_trainer', label: 'Controller: Trainer', group: 'controller', icon: GraduationCap, color: 'text-amber-300' },
]

export function ViewSwitcher({ currentView, onViewChange }) {
  const isLive = currentView === 'live'

  return (
    <div className="w-full bg-slate-900/95 border-b border-slate-800 shadow-2xl backdrop-blur-xl px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap z-40 text-xs font-sans">
      {/* Title & Live Status Indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <div className={`p-1.5 rounded-xl border flex items-center gap-1.5 font-black uppercase tracking-wider text-[11px] ${
          isLive ? 'bg-emerald-950 border-emerald-500/60 text-emerald-400' : 'bg-amber-950 border-amber-500/60 text-amber-300'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span>{isLive ? 'Live WebSocket' : 'Preview Inspector'}</span>
        </div>
      </div>

      {/* Quick View Selector Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none flex-1 max-w-full">
        {VIEW_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const isActive = currentView === opt.id

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onViewChange(opt.id)}
              className={`py-1.5 px-3 rounded-xl font-bold flex items-center gap-1.5 shrink-0 transition-all border ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md scale-105'
                  : 'bg-slate-950/70 hover:bg-slate-800 text-slate-300 border-slate-800'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : opt.color}`} />
              <span className="whitespace-nowrap text-[11px]">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
