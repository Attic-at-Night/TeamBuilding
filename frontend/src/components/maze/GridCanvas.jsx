import { useEffect, useRef } from 'react'

/**
 * GridCanvas renders the 15x15 maze grid with smooth 60fps animations
 * for player movement, glowing pulse auras, motion trails, floating ghosts,
 * shimmering keys, and pulsing goals.
 */
export function GridCanvas({
  width = 15,
  height = 15,
  cells,
  playerPos,
  keys = [],
  keysCollected = 0,
  goal = null,
  hazards = [],
  ghosts = [],
  lifePickups = [],
  reached = false,
  pendingReset = null,
  fogRadius = null, // null = no fog, number = distance from player in cells
  mode = 'spectator', // 'mover', 'guide', 'key-seer', 'navigator', 'trainer', 'spectator'
  accentColor = '#3b82f6',
}) {
  const canvasRef = useRef(null)
  const animPlayerPosRef = useRef(null)
  const propsRef = useRef({})
  const prevKeysCollectedRef = useRef(keysCollected)
  const prevReachedRef = useRef(reached)
  const prevPendingResetRef = useRef(pendingReset)
  const keyAnimationsRef = useRef([])

  // Keep latest props available to the requestAnimationFrame loop without triggering frame teardowns
  useEffect(() => {
    // Check for newly collected keys using the summary count to spawn animations for ALL players
    if (keysCollected > prevKeysCollectedRef.current) {
      // Spawn at the current player position since the player just moved onto the key
      const p = playerPos || animPlayerPosRef.current || { row: 0, col: 0 }
      const diff = keysCollected - prevKeysCollectedRef.current
      for (let i = 0; i < diff; i++) {
        keyAnimationsRef.current.push({
          row: p.row,
          col: p.col,
          startTime: performance.now(),
          duration: 1200, // ms
          type: 'key'
        })
      }
    }
    prevKeysCollectedRef.current = keysCollected
    
    if (reached && !prevReachedRef.current) {
      const p = goal || playerPos || animPlayerPosRef.current || { row: 0, col: 0 }
      keyAnimationsRef.current.push({
        row: p.row,
        col: p.col,
        startTime: performance.now(),
        duration: 1200,
        type: 'goal',
        keepShowing: false
      })
    }
    prevReachedRef.current = reached

    if (pendingReset && !prevPendingResetRef.current) {
      if (pendingReset.cause !== 'victory') {
        keyAnimationsRef.current.push({
          row: pendingReset.position.row,
          col: pendingReset.position.col,
          dir: pendingReset.dir,
          startTime: performance.now(),
          duration: 1200,
          type: pendingReset.cause,
          keepShowing: true
        })
      }
    }
    if (!pendingReset && prevPendingResetRef.current) {
      // Clear out any keepShowing animations
      keyAnimationsRef.current = keyAnimationsRef.current.filter(anim => !anim.keepShowing)
    }
    prevPendingResetRef.current = pendingReset

    propsRef.current = {
      width,
      height,
      cells,
      playerPos,
      keys,
      goal,
      hazards,
      ghosts,
      lifePickups,
      reached,
      pendingReset,
      fogRadius,
      mode,
      accentColor,
    }
  })

  // Smooth position animation and continuous 60fps rendering loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId
    const particles = []

    const render = (time) => {
      const props = propsRef.current
      const {
        width = 15,
        height = 15,
        cells,
        playerPos,
        keys = [],
        goal = null,
        hazards = [],
        ghosts = [],
        lifePickups = [],
        reached = false,
        pendingReset = null,
        fogRadius = null,
        accentColor = '#3b82f6',
      } = props

      // 1. Smooth Interpolation of Player Position
      if (playerPos) {
        if (!animPlayerPosRef.current) {
          animPlayerPosRef.current = { row: playerPos.row, col: playerPos.col }
        } else {
          const dRow = playerPos.row - animPlayerPosRef.current.row
          const dCol = playerPos.col - animPlayerPosRef.current.col
          const dist = Math.hypot(dRow, dCol)

          if (dist > 2.5) {
            // Teleport / Snap on maze reset or spawn
            animPlayerPosRef.current = { row: playerPos.row, col: playerPos.col }
          } else if (dist > 0.001) {
            animPlayerPosRef.current.row += dRow * 0.22
            animPlayerPosRef.current.col += dCol * 0.22

            // Emit subtle particle trail while actively moving
            if (Math.random() < 0.4) {
              particles.push({
                row: animPlayerPosRef.current.row,
                col: animPlayerPosRef.current.col,
                alpha: 0.6,
                size: 0.2,
              })
            }
          } else {
            animPlayerPosRef.current.row = playerPos.row
            animPlayerPosRef.current.col = playerPos.col
          }
        }
      }

      // 2. High-DPI Retina Canvas Resizing
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const size = Math.min(rect.width, rect.height) || 400

      if (
        canvas.width !== Math.floor(size * dpr) ||
        canvas.height !== Math.floor(size * dpr)
      ) {
        canvas.width = Math.floor(size * dpr)
        canvas.height = Math.floor(size * dpr)
      }

      ctx.save()
      ctx.scale(dpr, dpr)

      const cols = width || 15
      const rows = height || 15
      const cellSize = size / Math.max(cols, rows)
      const tSec = time * 0.001

      // Clear background
      ctx.fillStyle = '#0f172a' // Dark slate canvas
      ctx.fillRect(0, 0, size, size)

      // Helper: Fog visibility check against target player position
      function isVisible(r, c) {
        if (fogRadius === null || fogRadius === undefined) return true
        if (!playerPos) return false
        const dr = Math.abs(r - playerPos.row)
        const dc = Math.abs(c - playerPos.col)
        return dr <= fogRadius && dc <= fogRadius
      }

      // 3. Draw Visited / Reached Cells
      if (reached && Array.isArray(reached)) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.12)' // Subtle blue trail floor
        for (const pos of reached) {
          if (isVisible(pos.row, pos.col)) {
            ctx.fillRect(pos.col * cellSize, pos.row * cellSize, cellSize, cellSize)
          }
        }
      }

      // 4. Draw Maze Cells & Walls
      if (cells && Array.isArray(cells)) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!isVisible(r, c)) continue

            const cell = cells[r] && cells[r][c]
            const x = c * cellSize
            const y = r * cellSize

            // Draw cell corridor walkway background
            ctx.fillStyle = '#0f172a'
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2)

            if (cell && cell.walls) {
              // High-contrast bright maze wall lines
              ctx.strokeStyle = '#38bdf8' // Bright cyan/sky blue wall glow
              ctx.lineWidth = 3.5
              ctx.beginPath()

              if (cell.walls.n) {
                ctx.moveTo(x, y)
                ctx.lineTo(x + cellSize, y)
              }
              if (cell.walls.e) {
                ctx.moveTo(x + cellSize, y)
                ctx.lineTo(x + cellSize, y + cellSize)
              }
              if (cell.walls.s) {
                ctx.moveTo(x, y + cellSize)
                ctx.lineTo(x + cellSize, y + cellSize)
              }
              if (cell.walls.w) {
                ctx.moveTo(x, y)
                ctx.lineTo(x, y + cellSize)
              }

              ctx.stroke()
            }
          }
        }
      } else {
        // Floor grid when walls are absent
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = 1.5
        for (let r = 0; r <= rows; r++) {
          ctx.beginPath()
          ctx.moveTo(0, r * cellSize)
          ctx.lineTo(size, r * cellSize)
          ctx.stroke()
        }
        for (let c = 0; c <= cols; c++) {
          ctx.beginPath()
          ctx.moveTo(c * cellSize, 0)
          ctx.lineTo(c * cellSize, size)
          ctx.stroke()
        }
      }

      // 5. Draw Fog Overlay
      if (fogRadius !== null && playerPos) {
        ctx.fillStyle = '#020617'
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!isVisible(r, c)) {
              ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize)
            }
          }
        }
      }

      // 6. Draw Hazards with Pulsing Danger Ring
      if (hazards && Array.isArray(hazards)) {
        for (const h of hazards) {
          if (!isVisible(h.row, h.col)) continue
          const cx = h.col * cellSize + cellSize / 2
          const cy = h.row * cellSize + cellSize / 2
          const r = cellSize * 0.35

          // Pulsing warning ring
          const hazardPulse = Math.sin(tSec * 6 + h.row) * 2
          const hazardGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, r + 4 + hazardPulse)
          hazardGlow.addColorStop(0, 'rgba(239, 68, 68, 0.5)')
          hazardGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = hazardGlow
          ctx.beginPath()
          ctx.arc(cx, cy, r + 4 + hazardPulse, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(12, cellSize * 0.6)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('⚡', cx, cy)
        }
      }

      // 7. Draw Ghosts with Floating Motion & Eerie Glow
      if (ghosts && Array.isArray(ghosts)) {
        ghosts.forEach((g, idx) => {
          if (!isVisible(g.row, g.col)) return
          const floatOffset = Math.sin(tSec * 4 + idx * 1.5) * 3
          const cx = g.col * cellSize + cellSize / 2
          const cy = g.row * cellSize + cellSize / 2 + floatOffset
          const r = cellSize * 0.38

          // Eerie purple glow
          const ghostGlow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r + 8)
          ghostGlow.addColorStop(0, 'rgba(168, 85, 247, 0.7)')
          ghostGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = ghostGlow
          ctx.beginPath()
          ctx.arc(cx, cy, r + 8, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(12, cellSize * 0.65)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('👻', cx, cy)
        })
      }

      // 8. Draw Keys with Floating Bobbing & Amber Sparkle
      if (keys && Array.isArray(keys)) {
        keys.forEach((k, idx) => {
          if (k.collected || !isVisible(k.row, k.col)) return
          const keyFloat = Math.sin(tSec * 5 + idx * 2) * 2.5
          const cx = k.col * cellSize + cellSize / 2
          const cy = k.row * cellSize + cellSize / 2 + keyFloat

          // Gold aura
          const keyGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, cellSize * 0.5)
          keyGlow.addColorStop(0, 'rgba(234, 179, 8, 0.7)')
          keyGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = keyGlow
          ctx.beginPath()
          ctx.arc(cx, cy, cellSize * 0.5, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#000000'
          ctx.font = `bold ${Math.max(12, cellSize * 0.6)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('🔑', cx, cy)
        })
      }

      // 9. Draw Life Pickups with Heartbeat Pulse
      if (lifePickups && Array.isArray(lifePickups)) {
        lifePickups.forEach((l, idx) => {
          if (l.collected || !isVisible(l.row, l.col)) return
          const heartbeat = Math.sin(tSec * 7 + idx) * 0.08
          const cx = l.col * cellSize + cellSize / 2
          const cy = l.row * cellSize + cellSize / 2
          const r = cellSize * 0.3 * (1 + heartbeat)

          const lifeGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, r + 6)
          lifeGlow.addColorStop(0, 'rgba(34, 197, 94, 0.6)')
          lifeGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = lifeGlow
          ctx.beginPath()
          ctx.arc(cx, cy, r + 6, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(12, cellSize * 0.6)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('❤️', cx, cy)
        })
      }

      // 10. Draw Exit Goal with Rotating Emerald Sparkle
      if (goal && isVisible(goal.row, goal.col)) {
        const x = goal.col * cellSize
        const y = goal.row * cellSize
        const cx = x + cellSize / 2
        const cy = y + cellSize / 2

        const goalPulse = Math.sin(tSec * 4) * 2
        ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'
        ctx.fillRect(x + 1 - goalPulse, y + 1 - goalPulse, cellSize - 2 + goalPulse * 2, cellSize - 2 + goalPulse * 2)

        ctx.fillStyle = '#10b981' // Emerald
        ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4)

        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.max(12, cellSize * 0.5)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🏁', cx, cy)
      }

      // 11. Render Motion Trail Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.alpha -= 0.035
        if (p.alpha <= 0) {
          particles.splice(i, 1)
          continue
        }
        if (isVisible(Math.round(p.row), Math.round(p.col))) {
          const cx = p.col * cellSize + cellSize / 2
          const cy = p.row * cellSize + cellSize / 2
          ctx.fillStyle = accentColor
          ctx.globalAlpha = Math.max(0, p.alpha)
          ctx.beginPath()
          ctx.arc(cx, cy, cellSize * p.size, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1.0
        }
      }

      // 12. Draw Animated Player Character (Interpolated Position)
      if (
        animPlayerPosRef.current &&
        isVisible(
          Math.round(animPlayerPosRef.current.row),
          Math.round(animPlayerPosRef.current.col)
        )
      ) {
        const cx = animPlayerPosRef.current.col * cellSize + cellSize / 2
        const cy = animPlayerPosRef.current.row * cellSize + cellSize / 2
        const baseR = cellSize * 0.38

        // A. Pulsing Outer Radial Glow Aura
        const pulseGlow = Math.sin(tSec * 5) * 3
        const auraGrad = ctx.createRadialGradient(
          cx,
          cy,
          baseR * 0.2,
          cx,
          cy,
          baseR + 8 + pulseGlow
        )
        auraGrad.addColorStop(0, accentColor)
        auraGrad.addColorStop(0.6, accentColor + '55')
        auraGrad.addColorStop(1, 'transparent')

        ctx.fillStyle = auraGrad
        ctx.beginPath()
        ctx.arc(cx, cy, baseR + 8 + pulseGlow, 0, Math.PI * 2)
        ctx.fill()

        // B. Active Role Pulsing Ring
        ctx.strokeStyle = accentColor
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(cx, cy, baseR + 3 + Math.sin(tSec * 7) * 2, 0, Math.PI * 2)
        ctx.stroke()

        // C. Floating Bobbing Player Core
        const floatY = Math.sin(tSec * 6) * 2
        ctx.fillStyle = accentColor
        ctx.beginPath()
        ctx.arc(cx, cy + floatY, baseR, 0, Math.PI * 2)
        ctx.fill()

        // D. Player Emoji Avatar
        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.max(10, cellSize * 0.42)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🏃', cx, cy + floatY)
      }

      // 13. Draw Key Pickup and Reset Animations (Rendered on top of player)
      for (let i = keyAnimationsRef.current.length - 1; i >= 0; i--) {
        const anim = keyAnimationsRef.current[i]
        const elapsed = time - anim.startTime
        if (elapsed > anim.duration && !anim.keepShowing) {
          keyAnimationsRef.current.splice(i, 1)
          continue
        }
        if (isVisible(anim.row, anim.col)) {
          // Calculate scale, floatUp, and alpha based on animation phase
          let scale = 1.0
          let floatUp = 0
          let alpha = 1.0

          const scaleUpDuration = 250 // ms to scale up from 1.0 to 1.5
          const totalDuration = anim.duration || 1200

          if (elapsed < scaleUpDuration) {
            // Phase 1: Rapid Scale Up + Float Up, fully opaque
            const progress = elapsed / scaleUpDuration
            const easeOut = 1 - Math.pow(1 - progress, 2)
            scale = 1.0 + easeOut * 0.5
            floatUp = easeOut * cellSize * 0.35
            alpha = 1.0
          } else if (anim.keepShowing || elapsed < totalDuration - 400) {
            // Phase 2: Hold & Gentle Pulsing at top, fully opaque
            const holdElapsed = elapsed - scaleUpDuration
            const pulse = Math.sin(holdElapsed / 120) * 0.12
            scale = 1.5 + pulse
            floatUp = cellSize * 0.35
            alpha = 1.0
          } else {
            // Phase 3: Smooth Fade Out at the end
            const fadeElapsed = elapsed - (totalDuration - 400)
            const fadeProgress = Math.min(fadeElapsed / 400, 1)
            const holdElapsed = elapsed - scaleUpDuration
            const pulse = Math.sin(holdElapsed / 120) * 0.12
            scale = 1.5 + pulse
            floatUp = cellSize * 0.35 + fadeProgress * cellSize * 0.2
            alpha = 1.0 - fadeProgress
          }

          let cx = anim.col * cellSize + cellSize / 2
          let cy = anim.row * cellSize + cellSize / 2

          if (anim.type === 'wall' && anim.dir) {
            if (anim.dir === 'n') {
              cy = anim.row * cellSize
            } else if (anim.dir === 's') {
              cy = (anim.row + 1) * cellSize
            } else if (anim.dir === 'e') {
              cx = (anim.col + 1) * cellSize
            } else if (anim.dir === 'w') {
              cx = anim.col * cellSize
            }
          }

          cy -= floatUp

          ctx.save()
          ctx.globalAlpha = alpha
          ctx.translate(cx, cy)
          
          // Aura and text based on type
          if (anim.type === 'key' || anim.type === 'goal') {
            const keyGlow = ctx.createRadialGradient(0, 0, 2 * scale, 0, 0, cellSize * 0.5 * scale)
            keyGlow.addColorStop(0, 'rgba(234, 179, 8, 0.7)')
            keyGlow.addColorStop(1, 'transparent')
            ctx.fillStyle = keyGlow
            ctx.beginPath()
            ctx.arc(0, 0, cellSize * 0.5 * scale, 0, Math.PI * 2)
            ctx.fill()
            
            ctx.fillStyle = '#000000'
            ctx.font = `bold ${Math.max(12 * scale, cellSize * 0.6 * scale)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(anim.type === 'goal' ? '🏁' : '🔑', 0, 0)
          } else if (anim.type === 'wall') {
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${Math.max(12 * scale, cellSize * 0.6 * scale)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('🧱', 0, 0)
          } else if (anim.type === 'ghost') {
            const ghostGlow = ctx.createRadialGradient(0, 0, 2 * scale, 0, 0, cellSize * 0.5 * scale)
            ghostGlow.addColorStop(0, 'rgba(168, 85, 247, 0.7)')
            ghostGlow.addColorStop(1, 'transparent')
            ctx.fillStyle = ghostGlow
            ctx.beginPath()
            ctx.arc(0, 0, cellSize * 0.5 * scale, 0, Math.PI * 2)
            ctx.fill()
            
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${Math.max(12 * scale, cellSize * 0.6 * scale)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('👻', 0, 0)
          } else if (anim.type === 'grid' || anim.type === 'hazard') {
            const hazardGlow = ctx.createRadialGradient(0, 0, 2 * scale, 0, 0, cellSize * 0.5 * scale)
            hazardGlow.addColorStop(0, 'rgba(239, 68, 68, 0.5)')
            hazardGlow.addColorStop(1, 'transparent')
            ctx.fillStyle = hazardGlow
            ctx.beginPath()
            ctx.arc(0, 0, cellSize * 0.5 * scale, 0, Math.PI * 2)
            ctx.fill()
            
            ctx.fillStyle = '#ffffff'
            ctx.font = `bold ${Math.max(12 * scale, cellSize * 0.6 * scale)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('⚡', 0, 0)
          }
          
          ctx.restore()
        }
      }

      ctx.restore()

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [])

  return (
    <div className="relative w-full max-h-full aspect-square sm:max-w-[600px] mx-auto flex items-center justify-center rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />
    </div>
  )
}
