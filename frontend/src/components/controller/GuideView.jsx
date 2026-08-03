import { GridCanvas } from '../maze/GridCanvas'
import { Eye, AlertTriangle, Ghost } from 'lucide-react'

export function GuideView({ roleData, summary, onSendInput, status }) {
  const hazards = roleData?.hazards || []
  const ghosts = roleData?.ghosts || []
  const playerPos = roleData?.playerPos || roleData?.maze?.playerPos
  const keys = roleData?.keys || []
  const goal = roleData?.goal || null
  const reached = roleData?.maze?.reached || roleData?.reached || []
  const assignedRoles = roleData?.assignedRoles || ['guide']

  const roleTitle = assignedRoles.map((r) => r.toUpperCase()).join(' + ')

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-4 text-slate-100">
      {/* HUD Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-purple-400" />
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-semibold">Your Role</span>
            <span className="text-sm font-bold text-purple-300">{roleTitle}</span>
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

      {/* Guide Map (Static Walls + Ghosts + Hazards + Mover Pos + Breadcrumbs + Keys/Goal if merged) */}
      <div className="flex flex-col items-center">
        <GridCanvas
          width={roleData?.maze?.width || 15}
          height={roleData?.maze?.height || 15}
          cells={roleData?.maze?.cells}
          playerPos={playerPos}
          hazards={hazards}
          ghosts={ghosts}
          keys={keys}
          goal={goal}
          reached={reached}
          fogRadius={null}
          mode="guide"
          accentColor="#3b82f6"
        />
        <p className="text-xs text-slate-400 mt-2 text-center">
          You see the walls, ghosts, and hazards. Speak in real time to guide the Mover safely!
        </p>
      </div>
    </div>
  )
}
