import { useState } from 'react'
import { Users, GraduationCap, Play, Smartphone, ArrowRight } from 'lucide-react'

export function ControllerLobby({
  sessionId,
  playerName,
  isTrainer,
  setSessionId,
  setPlayerName,
  setIsTrainer,
  onJoin,
  errorText,
}) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto p-6 text-slate-100 min-h-[80vh] justify-center">
      <div className="text-center flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-3xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 mb-2 shadow-xl">
          <Smartphone className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white">Join Team Session</h1>
        <p className="text-xs text-slate-400">Enter your session details to join the asymmetrical challenge.</p>
      </div>

      <div className="flex flex-col gap-4 p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-xl">
        {/* Session ID Field */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Session Code</label>
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value.toUpperCase())}
            placeholder="E.G. ABC123"
            maxLength={8}
            className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700/80 text-lg font-mono font-extrabold text-blue-400 placeholder-slate-600 text-center uppercase tracking-widest focus:outline-none focus:border-blue-500 transition-all"
          />
        </div>

        {/* Player Name Field */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Your Name</label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Alex"
            maxLength={18}
            className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700/80 text-base font-bold text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-all"
          />
        </div>

        {/* Role Preference Toggle */}
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center gap-2.5">
            <GraduationCap className={`w-5 h-5 ${isTrainer ? 'text-emerald-400' : 'text-slate-500'}`} />
            <div>
              <span className="text-xs font-bold text-slate-200 block">Join as Trainer</span>
              <span className="text-[11px] text-slate-400">Facilitator view with god-mode controls</span>
            </div>
          </div>
          <input
            type="checkbox"
            checked={isTrainer}
            onChange={(e) => setIsTrainer(e.target.checked)}
            className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
          />
        </div>

        {errorText && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs font-semibold text-center">
            {errorText}
          </div>
        )}

        <button
          type="button"
          onClick={onJoin}
          disabled={!sessionId.trim() || (!isTrainer && !playerName.trim())}
          className="w-full py-4 mt-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white font-extrabold text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <span>Join Game</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
