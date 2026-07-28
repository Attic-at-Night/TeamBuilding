import { GridCanvas } from '../maze/GridCanvas'
import { Eye, AlertTriangle, Ghost } from 'lucide-react'

export function GuideView({ roleData, summary, onSendInput, status }) {
  const hazards = roleData?.hazards || []
  const ghosts = roleData?.ghosts || []
  const playerPos = roleData?.playerPos || roleData?.maze?.playerPos

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-4 text-slate-100">
      {/* HUD Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-purple-400" />
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-semibold">Your Role</span>
            <span className="text-sm font-bold text-purple-300">GUIDE</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-1 bg-purple-950/60 border border-purple-800/50 px-2 py-1 rounded-lg">
            <Ghost className="w-3.5 h-3.5 text-purple-400" />
            <span>{ghosts.length} Ghosts</span>
          </div>
          <div className="flex items-center gap-1 bg-rose-950/60 border border-rose-800/50 px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>{hazards.length} Hazards</span>
          </div>
        </div>
      </div>

      {/* Guide Map (Static Walls + Ghosts + Hazards + Mover Pos) */}
      <div className="flex flex-col items-center">
        <GridCanvas
          width={roleData?.maze?.width || 15}
          height={roleData?.maze?.height || 15}
          cells={roleData?.maze?.cells}
          playerPos={playerPos}
          hazards={hazards}
          ghosts={ghosts}
          fogRadius={null}
          mode="guide"
          accentColor="#a855f7"
        />
        <p className="text-xs text-slate-400 mt-2 text-center">
          You see the walls, ghosts, and hazards. Warn the Mover where to go safely!
        </p>
      </div>

      {/* Quick Guide Signal Buttons */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-xl flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Quick Communication Callouts</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={status !== 'playing'}
            onClick={() => onSendInput({ action: 'signal', type: 'ghost_warning' })}
            className="p-3 rounded-xl bg-purple-900/40 hover:bg-purple-800/60 border border-purple-700/50 text-purple-200 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <Ghost className="w-4 h-4 text-purple-400" />
            <span>Ghost Approaching!</span>
          </button>

          <button
            type="button"
            disabled={status !== 'playing'}
            onClick={() => onSendInput({ action: 'signal', type: 'hazard_warning' })}
            className="p-3 rounded-xl bg-rose-900/40 hover:bg-rose-800/60 border border-rose-700/50 text-rose-200 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Watch Out Hazard!</span>
          </button>
        </div>
      </div>
    </div>
  )
}
