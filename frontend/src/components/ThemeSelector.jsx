import { useState, useEffect } from 'react'
import { Palette, Check } from 'lucide-react'

export const THEMES = [
  { id: 'dark', name: 'Slate Midnight', color: '#3b82f6', bg: '#020617' },
  { id: 'cyberpunk', name: 'Cyberpunk Synth', color: '#d946ef', bg: '#090014' },
  { id: 'retro', name: 'Retro CRT Matrix', color: '#22c55e', bg: '#050b05' },
  { id: 'light', name: 'Clean Studio Light', color: '#2563eb', bg: '#f8fafc' },
  { id: 'gold', name: 'Gold & Obsidian', color: '#eab308', bg: '#0c0a09' },
]

export function ThemeSelector() {
  const [activeTheme, setActiveTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'dark'
  })
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme)
    localStorage.setItem('app-theme', activeTheme)
  }, [activeTheme])

  return (
    <div className="relative z-40">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-2 shadow-lg active:scale-95 transition-all"
        title="Choose Theme Style"
      >
        <Palette className="w-4 h-4 text-blue-400" />
        <span className="hidden sm:inline">Theme Style:</span>
        <span className="text-blue-300 capitalize">{THEMES.find((t) => t.id === activeTheme)?.name}</span>
      </button>

      {isOpen && (
        <div className="absolute top-12 right-0 w-56 p-2 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl backdrop-blur-2xl flex flex-col gap-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
            Pick Visual Style
          </span>

          {THEMES.map((theme) => {
            const isSelected = activeTheme === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => {
                  setActiveTheme(theme.id)
                  setIsOpen(false)
                }}
                className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-between transition-all ${
                  isSelected
                    ? 'bg-slate-800 border-blue-500 text-white shadow-md'
                    : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white/20 inline-block shadow-sm"
                    style={{ backgroundColor: theme.color }}
                  />
                  <span>{theme.name}</span>
                </div>
                {isSelected && <Check className="w-4 h-4 text-blue-400" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
