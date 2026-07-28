import { useEffect, useRef } from 'react'

/**
 * GridCanvas renders the 15x15 maze grid with custom styling according to role and fog settings.
 */
export function GridCanvas({
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
  fogRadius = null, // null = no fog, number = distance from player in cells
  mode = 'spectator', // 'mover', 'guide', 'key-seer', 'navigator', 'trainer', 'spectator'
  accentColor = '#3b82f6',
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Auto-resizing for crisp canvas rendering on Retina / high DPI screens
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const size = Math.min(rect.width, rect.height) || 400
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cols = width || 15
    const rows = height || 15
    const cellSize = size / Math.max(cols, rows)

    // Clear background
    ctx.fillStyle = '#0f172a' // Dark slate canvas
    ctx.fillRect(0, 0, size, size)

    // Helper: Is cell inside fog radius?
    function isVisible(r, c) {
      if (fogRadius === null || fogRadius === undefined) return true
      if (!playerPos) return false
      const dr = Math.abs(r - playerPos.row)
      const dc = Math.abs(c - playerPos.col)
      return dr <= fogRadius && dc <= fogRadius
    }

    // 1. Draw visited / reached cells
    if (reached && Array.isArray(reached)) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)' // Subtle blue trail
      for (const pos of reached) {
        if (isVisible(pos.row, pos.col)) {
          ctx.fillRect(pos.col * cellSize, pos.row * cellSize, cellSize, cellSize)
        }
      }
    }

    // 2. Draw Cells & Walls if cells array is provided
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
            ctx.lineWidth = 4
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
      // Guide or Key-Seer mode without full cells array - draw clear floor grid
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

    // 3. Draw Fog Overlay for hidden cells
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

    // 4. Draw Hazards (Red spikes / warning markers)
    if (hazards && Array.isArray(hazards)) {
      for (const h of hazards) {
        if (!isVisible(h.row, h.col)) continue
        const cx = h.col * cellSize + cellSize / 2
        const cy = h.row * cellSize + cellSize / 2
        const r = cellSize * 0.35

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

    // 5. Draw Ghosts (Spooky Purple Floating Orbs)
    if (ghosts && Array.isArray(ghosts)) {
      for (const g of ghosts) {
        if (!isVisible(g.row, g.col)) continue
        const cx = g.col * cellSize + cellSize / 2
        const cy = g.row * cellSize + cellSize / 2
        const r = cellSize * 0.38

        ctx.fillStyle = '#a855f7' // Purple Ghost
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.max(10, cellSize * 0.45)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('👻', cx, cy)
      }
    }

    // 6. Draw Keys (Gold)
    if (keys && Array.isArray(keys)) {
      for (const k of keys) {
        if (k.collected || !isVisible(k.row, k.col)) continue
        const cx = k.col * cellSize + cellSize / 2
        const cy = k.row * cellSize + cellSize / 2

        ctx.fillStyle = '#eab308' // Amber Gold
        ctx.beginPath()
        ctx.arc(cx, cy, cellSize * 0.3, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#000000'
        ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🔑', cx, cy)
      }
    }

    // 7. Draw Life Pickups (Green Heart)
    if (lifePickups && Array.isArray(lifePickups)) {
      for (const l of lifePickups) {
        if (l.collected || !isVisible(l.row, l.col)) continue
        const cx = l.col * cellSize + cellSize / 2
        const cy = l.row * cellSize + cellSize / 2

        ctx.fillStyle = '#22c55e'
        ctx.beginPath()
        ctx.arc(cx, cy, cellSize * 0.3, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('❤️', cx, cy)
      }
    }

    // 8. Draw Exit Goal (Emerald Star / Gate)
    if (goal && isVisible(goal.row, goal.col)) {
      const x = goal.col * cellSize
      const y = goal.row * cellSize

      ctx.fillStyle = '#10b981' // Emerald
      ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4)

      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(12, cellSize * 0.5)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🏁', x + cellSize / 2, y + cellSize / 2)
    }

    // 9. Draw Player Character (Cyan / Active Role Accent)
    if (playerPos && isVisible(playerPos.row, playerPos.col)) {
      const cx = playerPos.col * cellSize + cellSize / 2
      const cy = playerPos.row * cellSize + cellSize / 2
      const r = cellSize * 0.4

      // Pulse ring around player
      ctx.strokeStyle = accentColor
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = accentColor
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🏃', cx, cy)
    }
  }, [width, height, cells, playerPos, keys, goal, hazards, ghosts, lifePickups, reached, fogRadius, mode, accentColor])

  return (
    <div className="relative w-full aspect-square max-w-[600px] mx-auto flex items-center justify-center rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
      <canvas
        ref={canvasRef}
        className="w-full h-full block touch-none"
      />
    </div>
  )
}
