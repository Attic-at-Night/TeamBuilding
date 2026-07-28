import { useState, useEffect, useRef } from 'react'
import {
  Skull,
  HeartCrack,
  Trophy,
  Sparkles,
  Radio,
  Clock,
  Megaphone,
  X,
  AlertTriangle,
  Flame,
  CheckCircle2,
} from 'lucide-react'

export function NotificationOverlay({ stateSync, customNotification, onDismiss }) {
  const [notification, setNotification] = useState(null)
  const prevSyncRef = useRef(null)
  const timerRef = useRef(null)

  // Trigger notification with auto-dismiss unless persistent
  function triggerNotification(noti) {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    setNotification(noti)

    if (!noti.persistent) {
      const duration = noti.duration || 5000
      timerRef.current = setTimeout(() => {
        setNotification(null)
        if (onDismiss) onDismiss()
      }, duration)
    }
  }

  // Monitor stateSync for state transitions
  useEffect(() => {
    if (!stateSync) return

    const prev = prevSyncRef.current
    const curr = stateSync

    if (!prev) {
      prevSyncRef.current = curr
      return
    }

    const prevReset = prev?.pendingReset
    const currReset = curr?.pendingReset

    const prevLives = prev?.summary?.livesRemaining ?? prev?.summary?.lives ?? prevReset?.livesRemaining ?? 3
    const currLives = curr?.summary?.livesRemaining ?? curr?.summary?.lives ?? currReset?.livesRemaining ?? 3

    const prevStatus = prev?.status || 'lobby'
    const currStatus = curr?.status || 'lobby'

    const prevOutcome = prev?.summary?.outcome
    const currOutcome = curr?.summary?.outcome

    const prevPhase = prev?.phaseFlow?.currentPhase
    const currPhase = curr?.phaseFlow?.currentPhase

    const prevPhaseType = prev?.phaseFlow?.phaseType
    const currPhaseType = curr?.phaseFlow?.phaseType

    const prevBroadcast = prev?.trainerBroadcast?.message
    const currBroadcast = curr?.trainerBroadcast?.message

    // 1. Death / Life Lost Detection (including pendingReset on controller)
    if (currLives < prevLives || (!prevReset && currReset)) {
      const lostCount = prevLives > currLives ? prevLives - currLives : 1
      const effectiveLives = currLives

      if (effectiveLives > 0) {
        const hazardLabel = currReset?.reason === 'ghost_collision' 
          ? 'GHOST CAUGHT PLAYER!' 
          : currReset?.reason === 'wall_hazard' 
          ? 'WALL HAZARD COLLISION!' 
          : 'HAZARD HIT - LIFE LOST!'

        triggerNotification({
          id: `death-${Date.now()}`,
          type: 'death',
          variant: 'danger',
          title: lostCount > 1 ? `${lostCount} LIVES LOST!` : hazardLabel,
          subtitle: `${effectiveLives} ${effectiveLives === 1 ? 'life' : 'lives'} remaining. Returning to start position!`,
          icon: Skull,
          duration: 4500,
        })
      } else {
        triggerNotification({
          id: `defeat-${Date.now()}`,
          type: 'defeat',
          variant: 'danger',
          title: 'TEAM DEFEATED!',
          subtitle: 'All team lives lost. Review session debrief with trainer.',
          icon: HeartCrack,
          persistent: true,
        })
      }
    }
    // 2. Round Win / Victory Detection
    else if (
      (currOutcome === 'success' && prevOutcome !== 'success') ||
      (currStatus === 'ended' && prevStatus !== 'ended' && currOutcome === 'success')
    ) {
      triggerNotification({
        id: `victory-${Date.now()}`,
        type: 'win',
        variant: 'success',
        title: 'MAZE ESCAPED! VICTORY!',
        subtitle: 'All keys collected and exit reached safely. Outstanding teamwork!',
        icon: Trophy,
        persistent: true,
      })
    }
    // 3. Follow-Up Phase Detection
    else if (
      (currStatus === 'follow_up' && prevStatus !== 'follow_up') ||
      (currPhaseType === 'follow_up' && prevPhaseType !== 'follow_up')
    ) {
      triggerNotification({
        id: `followup-${Date.now()}`,
        type: 'follow_up',
        variant: 'info',
        title: 'FOLLOW-UP PHASE STARTED',
        subtitle: 'Gameplay paused. Proceeding into trainer guided debrief & reflection.',
        icon: Clock,
        duration: 6000,
      })
    }
    // 4. Gameplay Phase Advance
    else if (
      currPhaseType === 'gameplay' &&
      typeof currPhase === 'number' &&
      typeof prevPhase === 'number' &&
      currPhase > prevPhase
    ) {
      triggerNotification({
        id: `phase-${currPhase}-${Date.now()}`,
        type: 'phase_change',
        variant: 'primary',
        title: `PHASE ${currPhase} STARTED`,
        subtitle: `Navigating phase ${currPhase} of the session protocol!`,
        icon: Radio,
        duration: 4000,
      })
    }
    // 5. Trainer Broadcast Message
    else if (currBroadcast && currBroadcast !== prevBroadcast) {
      triggerNotification({
        id: `broadcast-${Date.now()}`,
        type: 'broadcast',
        variant: 'warning',
        title: 'FACILITATOR ANNOUNCEMENT',
        subtitle: currBroadcast,
        icon: Megaphone,
        duration: 7000,
      })
    }

    prevSyncRef.current = curr
  }, [stateSync])

  // Custom manual notification handler
  useEffect(() => {
    if (customNotification) {
      triggerNotification(customNotification)
    }
  }, [customNotification])

  if (!notification) return null

  const variantStyles = {
    danger: {
      bg: 'bg-gradient-to-br from-rose-950/95 via-slate-900/95 to-rose-950/90',
      border: 'border-rose-500/80 shadow-[0_0_30px_rgba(244,63,94,0.35)]',
      badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
      iconBg: 'bg-rose-600/30 text-rose-400 border-rose-500/50',
      title: 'text-rose-200',
      glow: 'from-rose-500/20 to-transparent',
      barBg: 'bg-rose-500',
    },
    success: {
      bg: 'bg-gradient-to-br from-emerald-950/95 via-slate-900/95 to-emerald-950/90',
      border: 'border-emerald-500/80 shadow-[0_0_30px_rgba(16,185,129,0.35)]',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      iconBg: 'bg-emerald-600/30 text-emerald-400 border-emerald-500/50',
      title: 'text-emerald-200',
      glow: 'from-emerald-500/20 to-transparent',
      barBg: 'bg-emerald-500',
    },
    info: {
      bg: 'bg-gradient-to-br from-indigo-950/95 via-slate-900/95 to-purple-950/90',
      border: 'border-indigo-500/80 shadow-[0_0_30px_rgba(99,102,241,0.35)]',
      badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
      iconBg: 'bg-indigo-600/30 text-indigo-400 border-indigo-500/50',
      title: 'text-indigo-200',
      glow: 'from-indigo-500/20 to-transparent',
      barBg: 'bg-indigo-500',
    },
    primary: {
      bg: 'bg-gradient-to-br from-blue-950/95 via-slate-900/95 to-sky-950/90',
      border: 'border-blue-500/80 shadow-[0_0_30px_rgba(59,130,246,0.35)]',
      badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      iconBg: 'bg-blue-600/30 text-blue-400 border-blue-500/50',
      title: 'text-blue-200',
      glow: 'from-blue-500/20 to-transparent',
      barBg: 'bg-blue-500',
    },
    warning: {
      bg: 'bg-gradient-to-br from-amber-950/95 via-slate-900/95 to-amber-950/90',
      border: 'border-amber-500/80 shadow-[0_0_30px_rgba(245,158,11,0.35)]',
      badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      iconBg: 'bg-amber-600/30 text-amber-400 border-amber-500/50',
      title: 'text-amber-200',
      glow: 'from-amber-500/20 to-transparent',
      barBg: 'bg-amber-500',
    },
  }

  const currentStyle = variantStyles[notification.variant] || variantStyles.info
  const IconComponent = notification.icon || AlertTriangle

  function handleClose() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setNotification(null)
    if (onDismiss) onDismiss()
  }

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4 pointer-events-auto transition-all duration-300 animate-in fade-in slide-in-from-top-6">
      <div
        className={`relative overflow-hidden rounded-3xl border p-5 backdrop-blur-2xl ${currentStyle.bg} ${currentStyle.border}`}
      >
        {/* Subtle Ambient Radial Glow */}
        <div
          className={`absolute -top-12 -left-12 w-32 h-32 rounded-full bg-gradient-to-br ${currentStyle.glow} blur-2xl pointer-events-none`}
        />

        <div className="relative flex items-start gap-4">
          {/* Icon Badge */}
          <div
            className={`p-3 rounded-2xl border flex items-center justify-center shrink-0 ${currentStyle.iconBg}`}
          >
            <IconComponent className="w-7 h-7 animate-bounce" />
          </div>

          {/* Text Content */}
          <div className="flex-1 min-w-0 pr-6">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${currentStyle.badgeBg}`}
              >
                {notification.type ? notification.type.replace('_', ' ') : 'ALERT'}
              </span>
            </div>
            <h3 className={`text-base font-black tracking-tight ${currentStyle.title}`}>
              {notification.title}
            </h3>
            <p className="text-xs font-semibold text-slate-300 mt-0.5 leading-relaxed">
              {notification.subtitle}
            </p>
          </div>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timed Progress Bar Indicator */}
        {!notification.persistent && notification.duration && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800/60 overflow-hidden">
            <div
              className={`h-full ${currentStyle.barBg} animate-shrink-width`}
              style={{
                animation: `shrinkWidth ${notification.duration}ms linear forwards`,
              }}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}
