import { useState } from 'react'
import { Wrench, Monitor, Smartphone, Terminal, ChevronDown, ChevronUp } from 'lucide-react'

export function DevTools({
  mode,
  setMode,
  stateSync,
  sessionId,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [showJson, setShowJson] = useState(false)

  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2 text-xs font-sans select-none">
      {isOpen && (
        <div className="p-4 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-2xl text-slate-200 w-80 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-extrabold text-blue-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Wrench className="w-3.5 h-3.5" /> Dev Studio Tools
            </span>
            <span className="font-mono text-[10px] text-slate-500">SESSION: {sessionId || 'NONE'}</span>
          </div>

          {/* Mode Switcher */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Client Mode</span>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setMode('display')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 font-bold transition-all ${
                  mode === 'display' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> Display
              </button>
              <button
                type="button"
                onClick={() => setMode('controller')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 font-bold transition-all ${
                  mode === 'controller' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" /> Controller
              </button>
            </div>
          </div>

          {/* State Sync Inspector */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              className="py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 flex items-center justify-between"
            >
              <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> State Sync Log</span>
              {showJson ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showJson && (
              <pre className="p-2 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-emerald-400 max-h-48 overflow-auto">
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
        className="p-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white shadow-2xl flex items-center gap-2 border border-blue-400 font-bold active:scale-95 transition-all"
      >
        <Wrench className="w-4 h-4" />
        <span className="text-xs">DevTools</span>
      </button>
    </div>
  )
}
