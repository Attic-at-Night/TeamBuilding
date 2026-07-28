import { GridCanvas } from '../maze/GridCanvas'
import { Compass, Map, History } from 'lucide-react'

export function NavigatorView({ roleData, summary }) {
  const maze = roleData?.maze
  const hazardLog = roleData?.hazardLog || []
  const hazards = roleData?.hazards || []
  const ghosts = roleData?.ghosts || []
  const keys = roleData?.keys || []
  const goal = roleData?.goal || null
  const assignedRoles = roleData?.assignedRoles || ['navigator']

  const roleTitle = assignedRoles.map((r) => r.toUpperCase()).join(' + ')

  return (
    <div className="flex flex-col gap-4 w-full max-w-md mx-auto p-4 text-slate-100">
      {/* HUD Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center gap-2">
          <Compass className="w-5 h-5 text-teal-400" />
          <div>
            <span className="text-xs text-slate-400 uppercase tracking-wider block font-semibold">Your Role</span>
            <span className="text-sm font-bold text-teal-300">{roleTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-teal-950/60 border border-teal-800/50 px-2.5 py-1 rounded-lg">
          <Map className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-xs font-bold text-teal-200">Macro View</span>
        </div>
      </div>

      {/* Navigator Map (Static Maze Cells + Mover Pos + Reached Breadcrumb Path + Hazards/Ghosts/Keys if merged) */}
      <div className="flex flex-col items-center">
        <GridCanvas
          width={maze?.width || 15}
          height={maze?.height || 15}
          cells={maze?.cells}
          playerPos={maze?.playerPos || roleData?.playerPos}
          reached={maze?.reached || roleData?.reached}
          hazards={hazards}
          ghosts={ghosts}
          keys={keys}
          goal={goal}
          fogRadius={null}
          mode="navigator"
          accentColor="#14b8a6"
        />
        <p className="text-xs text-slate-400 mt-2 text-center">
          You see the overall maze layout and breadcrumb history. Keep the team oriented!
        </p>
      </div>

      {/* Hazard Log / Path History */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-xl flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <History className="w-4 h-4 text-teal-400" />
          <span>Recent Path Friction & Resets</span>
        </div>
        <div className="max-h-28 overflow-y-auto flex flex-col gap-1.5 text-xs">
          {hazardLog.length === 0 ? (
            <span className="text-slate-500 italic p-1">No wall hits or hazard resets yet.</span>
          ) : (
            hazardLog.slice(-5).map((entry, idx) => (
              <div key={idx} className="p-2 rounded bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                <span className="text-rose-300 font-semibold">{entry.reason || 'Hazard Reset'}</span>
                <span className="text-slate-400 font-mono text-[10px]">{new Date(entry.ts || Date.now()).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
