import { useEffect } from 'react'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'

export function Dpad({ onMove, disabled = false }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (disabled) return
      if (['ArrowUp', 'KeyW'].includes(event.code)) {
        event.preventDefault()
        onMove('n')
      } else if (['ArrowRight', 'KeyD'].includes(event.code)) {
        event.preventDefault()
        onMove('e')
      } else if (['ArrowDown', 'KeyS'].includes(event.code)) {
        event.preventDefault()
        onMove('s')
      } else if (['ArrowLeft', 'KeyA'].includes(event.code)) {
        event.preventDefault()
        onMove('w')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onMove, disabled])

  const btnStyle = "w-16 h-16 rounded-2xl bg-slate-800/90 active:bg-blue-600 border border-slate-700/80 shadow-lg flex items-center justify-center text-slate-100 active:scale-95 transition-all touch-none disabled:opacity-40 select-none"

  return (
    <div className="relative w-52 h-52 mx-auto my-4 flex items-center justify-center select-none">
      {/* Up / North */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMove('n')}
        className={`${btnStyle} absolute top-0 left-1/2 -translate-x-1/2`}
        aria-label="Move North"
      >
        <ArrowUp className="w-8 h-8" />
      </button>

      {/* Right / East */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMove('e')}
        className={`${btnStyle} absolute right-0 top-1/2 -translate-y-1/2`}
        aria-label="Move East"
      >
        <ArrowRight className="w-8 h-8" />
      </button>

      {/* Down / South */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMove('s')}
        className={`${btnStyle} absolute bottom-0 left-1/2 -translate-x-1/2`}
        aria-label="Move South"
      >
        <ArrowDown className="w-8 h-8" />
      </button>

      {/* Left / West */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMove('w')}
        className={`${btnStyle} absolute left-0 top-1/2 -translate-y-1/2`}
        aria-label="Move West"
      >
        <ArrowLeft className="w-8 h-8" />
      </button>

      {/* Center Dpad Hub */}
      <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 shadow-inner flex items-center justify-center text-xs font-bold text-slate-500">
        D-PAD
      </div>
    </div>
  )
}
