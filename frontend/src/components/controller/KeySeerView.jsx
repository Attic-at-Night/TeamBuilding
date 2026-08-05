import { GridCanvas } from '../maze/GridCanvas'
import { Key } from 'lucide-react'

export function KeySeerView({ roleData, summary, onSendInput, status }) {
  const keys = roleData?.keys || []
  const goal = roleData?.goal || null
  const playerPos = roleData?.playerPos || roleData?.maze?.playerPos
  const keysCollected = summary?.keysCollected ?? 0
  const hazards = roleData?.hazards || []
  const ghosts = roleData?.ghosts || []
  const reached = roleData?.maze?.reached || roleData?.reached || []
  const assignedRoles = roleData?.assignedRoles || ['key-seer']

  const roleTitle = assignedRoles.map((r) => r.toUpperCase()).join(' + ')

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-4 text-slate-100">
      {/* HUD Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-amber-400" />
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-semibold">Your Role</span>
            <span className="text-sm font-bold text-amber-300">{roleTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-amber-950/60 border border-amber-800/50 px-3 py-1 rounded-lg">
          <Key className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-amber-200">{keysCollected} / 3 Keys Found</span>
        </div>
      </div>

      {/* Key-Seer Map (Keys + Exit Goal + Mover Pos + Merged Role Data) */}
      <div className="flex flex-col items-center">
        <GridCanvas keysCollected={summary?.keysCollected}
          width={roleData?.maze?.width || 15}
          height={roleData?.maze?.height || 15}
          cells={roleData?.maze?.cells}
          playerPos={playerPos}
          keys={keys}
          goal={goal}
          hazards={hazards}
          ghosts={ghosts}
          reached={reached}
          fogRadius={null}
          mode="key-seer"
          accentColor="#3b82f6"
        />
        <p className="text-xs text-slate-400 mt-2 text-center">
          {keysCollected < 3
            ? 'Speak in real time to guide the Mover to all 3 golden keys!'
            : 'All keys collected! Direct the Mover out loud to the emerald exit goal!'}
        </p>
      </div>
    </div>
  )
}
