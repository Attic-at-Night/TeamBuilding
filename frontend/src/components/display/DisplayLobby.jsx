import { useState, useEffect, useMemo } from 'react'
import { Users, Play, Smartphone, QrCode, Sparkles, ExternalLink } from 'lucide-react'
import QRCode from 'qrcode'

export function DisplayLobby({
  sessionId,
  joinUrl,
  qrCodeDataUrl,
  players = [],
  trainers = [],
  ready = false,
  capacity = 4,
  onStartGame,
  onStartTimer,
}) {
  const [qrCodeImage, setQrCodeImage] = useState(qrCodeDataUrl || '')

  const publicJoinUrl = useMemo(() => {
    if (joinUrl && !joinUrl.includes('localhost') && !joinUrl.includes('127.0.0.1')) {
      return joinUrl
    }
    return `${window.location.origin}/join?session=${sessionId || ''}`
  }, [joinUrl, sessionId])

  useEffect(() => {
    if (publicJoinUrl) {
      QRCode.toDataURL(publicJoinUrl, { margin: 1, width: 320 })
        .then((url) => setQrCodeImage(url))
        .catch(() => {})
    }
  }, [publicJoinUrl])

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto p-8 text-slate-100 min-h-[85vh] justify-center items-center">
      {/* Title & Session Code Banner */}
      <div className="text-center flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-950/80 border border-blue-800/80 text-blue-400 text-xs font-bold uppercase tracking-widest">
          <Sparkles className="w-4 h-4" /> Asymmetrical Team-Building Game
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white">
          Team Building Challenge
        </h1>
        <p className="text-slate-400 text-sm max-w-lg">
          Scan the QR code or click the join link on your phone to connect as a player or trainer.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full items-stretch">
        {/* Left Card: QR Code & Join URL */}
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl flex flex-col items-center justify-center gap-6 backdrop-blur-xl">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <QrCode className="w-4 h-4 text-blue-400" /> Scan to Join
          </span>

          <a
            href={publicJoinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group p-4 bg-white hover:bg-slate-100 rounded-2xl shadow-xl transition-transform active:scale-95 relative cursor-pointer"
            title="Click to open controller link in a new tab"
          >
            {qrCodeImage ? (
              <img src={qrCodeImage} alt="Join QR Code" className="w-52 h-52 block object-contain" />
            ) : (
              <div className="w-52 h-52 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600 font-mono text-xs">
                Generating QR...
              </div>
            )}
            <div className="absolute inset-0 bg-blue-900/10 opacity-0 group-hover:opacity-100 rounded-2xl flex items-center justify-center transition-opacity">
              <span className="bg-slate-900/90 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 border border-slate-700">
                <ExternalLink className="w-3.5 h-3.5 text-blue-400" /> Open Controller
              </span>
            </div>
          </a>

          <div className="flex flex-col items-center gap-2 w-full">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-blue-400" /> Clickable Join Link:
            </span>
            <a
              href={publicJoinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-2 text-xs md:text-sm font-mono font-bold text-blue-300 hover:text-white break-all bg-slate-950 hover:bg-slate-800 px-4 py-3 rounded-2xl border border-slate-800 hover:border-blue-500 transition-all w-full shadow-md"
              title="Click to open controller in a new tab"
            >
              <span className="truncate">{publicJoinUrl}</span>
              <ExternalLink className="w-4 h-4 text-blue-400 shrink-0 group-hover:scale-110 transition-transform" />
            </a>
          </div>

          <div className="text-center bg-blue-950/40 border border-blue-800/50 px-6 py-2 rounded-2xl w-full">
            <span className="text-[10px] text-blue-300 font-semibold block uppercase tracking-wider">Session Code</span>
            <span className="text-2xl font-black font-mono tracking-widest text-white">{sessionId}</span>
          </div>
        </div>

        {/* Right Card: Players & Start Controls */}
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl flex flex-col justify-between gap-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <span className="text-lg font-bold text-white">Players Joined</span>
              </div>
              <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-blue-950 border border-blue-800 text-blue-300">
                {players.length} / {capacity}
              </span>
            </div>

            {/* Players Grid */}
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((idx) => {
                const player = players[idx]
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-2xl border flex flex-col gap-1 transition-all ${
                      player
                        ? 'bg-slate-950 border-blue-500/50 shadow-lg'
                        : 'bg-slate-950/40 border-slate-800/60 border-dashed opacity-60'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Slot {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-white truncate">
                      {player ? player.name : 'Waiting for player...'}
                    </span>
                    {player && player.assignedRoles && (
                      <span className="text-[11px] font-semibold text-blue-400 capitalize">
                        {Array.isArray(player.assignedRoles) ? player.assignedRoles.join(', ') : player.assignedRoles}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Facilitator Status */}
            {trainers.length > 0 && (
              <div className="p-3 rounded-2xl bg-indigo-950/60 border border-indigo-800/50 flex items-center justify-between text-xs text-indigo-200">
                <span className="font-semibold">Trainer Facilitator Connected:</span>
                <span className="font-bold">{trainers.map((t) => t.name).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Waiting for Trainer Status Panel */}
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-800/60 flex flex-col items-center justify-center gap-2 text-center">
            <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span>Waiting for Trainer to Start Session</span>
            </div>
            <p className="text-xs text-slate-400">
              {players.length >= 2
                ? 'Players are ready! The Trainer can start the session from their dashboard.'
                : 'At least 2 players are required to join before starting.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
