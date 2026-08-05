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
  reached = [],
  fogRadius = null, // null = no fog, number = distance from player in cells
  mode = 'spectator', // 'mover', 'guide', 'key-seer', 'navigator', 'trainer', 'spectator'
  accentColor = '#3b82f6',
}) {
  const canvasRef = useRef(null)
  const animPlayerPosRef = useRef(null)
  const propsRef = useRef({})
  const prevKeysCollectedRef = useRef(keysCollected)
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
          duration: 1200 // ms
        })
      }
    }
    prevKeysCollectedRef.current = keysCollected

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
        reached = [],
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
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(cx, cy, r + 2 + hazardPulse, 0, Math.PI * 2)
          ctx.stroke()

          ctx.fillStyle = '#ef4444' // Bright Red
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
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
          const ghostGlow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r + 6)
          ghostGlow.addColorStop(0, 'rgba(168, 85, 247, 0.8)')
          ghostGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = ghostGlow
          ctx.beginPath()
          ctx.arc(cx, cy, r + 6, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#a855f7' // Purple Ghost Body
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(10, cellSize * 0.45)}px sans-serif`
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
          const keyGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, cellSize * 0.4)
          keyGlow.addColorStop(0, 'rgba(234, 179, 8, 0.6)')
          keyGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = keyGlow
          ctx.beginPath()
          ctx.arc(cx, cy, cellSize * 0.4, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#eab308' // Amber Gold
          ctx.beginPath()
          ctx.arc(cx, cy, cellSize * 0.3, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#000000'
          ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
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

          ctx.fillStyle = '#22c55e'
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
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

      // 13. Draw Key Pickup Animations (Rendered on top of player)
      for (let i = keyAnimationsRef.current.length - 1; i >= 0; i--) {
        const anim = keyAnimationsRef.current[i]
        const elapsed = time - anim.startTime
        if (elapsed > anim.duration) {
          keyAnimationsRef.current.splice(i, 1)
          continue
        }
        if (isVisible(anim.row, anim.col)) {
          const progress = elapsed / anim.duration
          const scale = 1 + progress * 1.5
          const alpha = 1 - progress
          
          // Add a slight upward float effect
          const floatUp = progress * cellSize * 0.5

          const cx = anim.col * cellSize + cellSize / 2
          const cy = anim.row * cellSize + cellSize / 2 - floatUp

          ctx.save()
          ctx.globalAlpha = alpha
          ctx.translate(cx, cy)
          
          // Glowing aura behind key
          const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, cellSize * 0.5 * scale)
          glowGrad.addColorStop(0, 'rgba(234, 179, 8, 0.8)') // Amber/Gold glow
          glowGrad.addColorStop(1, 'rgba(234, 179, 8, 0)')
          ctx.fillStyle = glowGrad
          ctx.beginPath()
          ctx.arc(0, 0, cellSize * 0.5 * scale, 0, Math.PI * 2)
          ctx.fill()
          
          // Actual key circle
          ctx.fillStyle = '#eab308'
          ctx.beginPath()
          ctx.arc(0, 0, cellSize * 0.3 * scale, 0, Math.PI * 2)
          ctx.fill()
          
          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.max(10, cellSize * 0.4 * scale)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('🔑', 0, 0)
          
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
