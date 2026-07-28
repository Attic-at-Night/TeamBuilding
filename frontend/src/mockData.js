// Mock data generator for previewing all Big Display and Controller views in AI Studio

export function generateMockMaze(width = 15, height = 15) {
  const cells = []
  for (let r = 0; r < height; r++) {
    const row = []
    for (let c = 0; c < width; c++) {
      row.push({
        walls: {
          n: r === 0 || (r % 3 === 0 && c % 2 === 0),
          s: r === height - 1 || (r % 3 === 2 && c % 2 === 1),
          e: c === width - 1 || (c % 3 === 0 && r % 2 === 1),
          w: c === 0 || (c % 3 === 2 && r % 2 === 0),
        },
      })
    }
    cells.push(row)
  }
  return cells
}

export function getMockDataset() {
  const width = 15
  const height = 15
  const cells = generateMockMaze(width, height)

  const playerPos = { row: 7, col: 7 }
  const goal = { row: 13, col: 13 }
  const keys = [
    { id: 'k1', row: 2, col: 3, collected: true },
    { id: 'k2', row: 12, col: 4, collected: true },
    { id: 'k3', row: 3, col: 11, collected: false },
  ]
  const hazards = [
    { id: 'h1', row: 8, col: 2, type: 'spikes' },
    { id: 'h2', row: 5, col: 12, type: 'laser' },
    { id: 'h3', row: 11, col: 9, type: 'pit' },
  ]
  const ghosts = [
    { id: 'g1', row: 4, col: 5 },
    { id: 'g2', row: 10, col: 11 },
  ]
  const reached = [
    { row: 7, col: 7 },
    { row: 7, col: 6 },
    { row: 7, col: 5 },
    { row: 6, col: 5 },
    { row: 5, col: 5 },
  ]

  const players = [
    { id: 'p1', name: 'Alex Rivera', assignedRoles: ['mover'], connected: true },
    { id: 'p2', name: 'Jordan Chen', assignedRoles: ['guide'], connected: true },
    { id: 'p3', name: 'Sam Taylor', assignedRoles: ['key-seer'], connected: true },
    { id: 'p4', name: 'Morgan Smith', assignedRoles: ['navigator'], connected: true },
  ]

  const trainers = [{ id: 't1', name: 'Coach Sarah', connected: true }]

  const trainerEvents = [
    { eventId: 'e1', event: 'game_start', timestamp: '10:00:00', player: 'Alex Rivera' },
    { eventId: 'e2', event: 'key_collected', timestamp: '10:02:15', player: 'Sam Taylor', reason: 'Collected Key 1 at (2,3)' },
    { eventId: 'e3', event: 'ghost_warning', timestamp: '10:03:40', player: 'Jordan Chen', clarityType: 'great_callout', highlighted: true },
    { eventId: 'e4', event: 'key_collected', timestamp: '10:05:10', player: 'Sam Taylor', reason: 'Collected Key 2 at (12,4)' },
    { eventId: 'e5', event: 'hazard_reset', timestamp: '10:06:22', player: 'Alex Rivera', reason: 'Hit laser hazard at (5,12)', clarityType: 'role_unclear' },
  ]

  const aiSuggestions = [
    { id: 'ai1', type: 'stalled_motion', summary: 'Mover has not changed cells for 45s. Navigator might be facing confusion.', status: 'pending' },
    { id: 'ai2', type: 'great_callout', summary: 'Guide accurately warned Mover 2s before ghost collision range.', status: 'approved' },
  ]

  const trainerMaze = {
    width,
    height,
    cells,
    playerPos,
    goal,
    keys,
    hazards,
    ghosts,
    reached,
  }

  const baseSummary = {
    livesRemaining: 2,
    lives: 2,
    keysCollected: 2,
    totalKeys: 3,
    outcome: 'SUCCESS',
    totalTimeMs: 185000,
    movesCount: 42,
    clarityEventsCount: 5,
  }

  const baseTimer = {
    remainingMs: 142000,
    durationMs: 900000,
    running: true,
  }

  const trainerBroadcast = {
    message: 'Teamwork Note: Guide and Navigator, coordinate Sector B routing carefully!',
  }

  return {
    width,
    height,
    cells,
    playerPos,
    goal,
    keys,
    hazards,
    ghosts,
    reached,
    players,
    trainers,
    trainerEvents,
    aiSuggestions,
    trainerMaze,
    baseSummary,
    baseTimer,
    trainerBroadcast,
  }
}

export function getMockStateForView(viewKey) {
  const d = getMockDataset()

  const fullStateSync = {
    sessionId: 'TEAM2026',
    status: viewKey === 'display_debrief' ? 'ended' : 'playing',
    ready: true,
    players: d.players,
    trainers: d.trainers,
    summary: d.baseSummary,
    timer: d.baseTimer,
    trainerBroadcast: d.trainerBroadcast,
    trainerMaze: d.trainerMaze,
    trainerEvents: d.trainerEvents,
    aiSuggestions: d.aiSuggestions,
    trainerHighlightEventIds: ['e3'],
    viewerRole: 'mover',
  }

  if (viewKey === 'display_lobby') {
    return {
      stateSync: {
        ...fullStateSync,
        status: 'lobby',
      },
      roleData: {},
    }
  }

  if (viewKey === 'display_playing') {
    return {
      stateSync: {
        ...fullStateSync,
        status: 'playing',
      },
      roleData: {},
    }
  }

  if (viewKey === 'display_debrief') {
    return {
      stateSync: {
        ...fullStateSync,
        status: 'ended',
        summary: {
          ...d.baseSummary,
          outcome: 'SUCCESS',
          totalTimeMs: 215000,
          movesCount: 68,
        },
      },
      roleData: {},
    }
  }

  if (viewKey === 'controller_join') {
    return {
      stateSync: null,
      isConnected: false,
      roleData: {},
    }
  }

  if (viewKey === 'controller_waiting') {
    return {
      stateSync: {
        ...fullStateSync,
        status: 'lobby',
        viewerRole: 'mover',
      },
      roleData: {},
    }
  }

  if (viewKey === 'controller_mover') {
    return {
      stateSync: {
        ...fullStateSync,
        viewerRole: 'mover',
        roleData: {
          assignedRoles: ['mover'],
          playerPos: d.playerPos,
          maze: {
            width: d.width,
            height: d.height,
            cells: d.cells,
            playerPos: d.playerPos,
            reached: d.reached,
          },
        },
      },
      roleData: {
        assignedRoles: ['mover'],
        playerPos: d.playerPos,
        maze: {
          width: d.width,
          height: d.height,
          cells: d.cells,
          playerPos: d.playerPos,
          reached: d.reached,
        },
      },
    }
  }

  if (viewKey === 'controller_guide') {
    return {
      stateSync: {
        ...fullStateSync,
        viewerRole: 'guide',
        roleData: {
          assignedRoles: ['guide'],
          playerPos: d.playerPos,
          hazards: d.hazards,
          ghosts: d.ghosts,
          maze: { width: d.width, height: d.height },
        },
      },
      roleData: {
        assignedRoles: ['guide'],
        playerPos: d.playerPos,
        hazards: d.hazards,
        ghosts: d.ghosts,
        maze: { width: d.width, height: d.height },
      },
    }
  }

  if (viewKey === 'controller_key_seer') {
    return {
      stateSync: {
        ...fullStateSync,
        viewerRole: 'key-seer',
        roleData: {
          assignedRoles: ['key-seer'],
          playerPos: d.playerPos,
          keys: d.keys,
          goal: d.goal,
          maze: { width: d.width, height: d.height },
        },
      },
      roleData: {
        assignedRoles: ['key-seer'],
        playerPos: d.playerPos,
        keys: d.keys,
        goal: d.goal,
        maze: { width: d.width, height: d.height },
      },
    }
  }

  if (viewKey === 'controller_navigator') {
    return {
      stateSync: {
        ...fullStateSync,
        viewerRole: 'navigator',
        roleData: {
          assignedRoles: ['navigator'],
          playerPos: d.playerPos,
          hazardLog: [
            { reason: 'Ghost warning issued by Jordan', ts: Date.now() - 60000 },
            { reason: 'Laser hazard touched at (5,12)', ts: Date.now() - 30000 },
          ],
          maze: {
            width: d.width,
            height: d.height,
            cells: d.cells,
            playerPos: d.playerPos,
            reached: d.reached,
          },
        },
      },
      roleData: {
        assignedRoles: ['navigator'],
        playerPos: d.playerPos,
        hazardLog: [
          { reason: 'Ghost warning issued by Jordan', ts: Date.now() - 60000 },
          { reason: 'Laser hazard touched at (5,12)', ts: Date.now() - 30000 },
        ],
        maze: {
          width: d.width,
          height: d.height,
          cells: d.cells,
          playerPos: d.playerPos,
          reached: d.reached,
        },
      },
    }
  }

  if (viewKey === 'controller_trainer') {
    return {
      stateSync: {
        ...fullStateSync,
        viewerRole: 'trainer',
      },
      roleData: {},
    }
  }

  return {
    stateSync: fullStateSync,
    roleData: {},
  }
}
