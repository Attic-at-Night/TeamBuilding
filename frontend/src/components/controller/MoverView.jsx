import { GridCanvas } from '../maze/GridCanvas'
import { Dpad } from './Dpad'
import { Shield, Key, Heart } from 'lucide-react'

export function MoverView({ roleData, summary, timer, onSendInput, status }) {
  const lives = summary?.livesRemaining ?? summary?.lives ?? 3
  const keysCollected = summary?.keysCollected ?? 0
  const assignedRoles = roleData?.assignedRoles || ['mover']

  const roleTitle = assignedRoles.map((r) => r.toUpperCase()).join(' + ')

  return (
    <div className="flex flex-col w-full max-w-md mx-auto p-2 sm:p-4 text-slate-100 h-[100dvh] sm:h-auto overflow-hidden">
      {/* HUD Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-semibold">Your Role</span>
            <span className="text-sm font-bold text-blue-300">{roleTitle}</span>
          </div>
        </div>

        {/* Lives & Keys */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-rose-950/60 border border-rose-800/50 px-2.5 py-1 rounded-lg">
            <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
            <span className="text-sm font-bold text-rose-200">{lives}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-amber-950/60 border border-amber-800/50 px-2.5 py-1 rounded-lg">
            <Key className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-amber-200">{keysCollected} / 3</span>
          </div>
        </div>
      </div>

      {/* Mover Maze View */}
      <div className="flex flex-col items-center flex-1 min-h-0 justify-center my-2 sm:my-4">
        <GridCanvas keysCollected={summary?.keysCollected}
          width={roleData?.maze?.width || 15}
          height={roleData?.maze?.height || 15}
          cells={roleData?.maze?.cells}
          playerPos={roleData?.maze?.playerPos || roleData?.playerPos}
          keys={roleData?.keys}
          goal={roleData?.goal}
          hazards={roleData?.hazards}
          ghosts={roleData?.ghosts}
          lifePickups={roleData?.maze?.lifePickups}
          reached={roleData?.maze?.reached}
          fogRadius={null}
          mode="mover"
          accentColor="#3b82f6"
        />
      </div>

      {/* D-Pad Navigation Controls */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-2 sm:p-4 shadow-xl flex flex-col items-center shrink-0">
        <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Navigation Controls</span>
        <Dpad
          disabled={status !== 'playing'}
          onMove={(dir) => onSendInput({ action: 'move', dir })}
        />
      </div>
    </div>
  )
}
