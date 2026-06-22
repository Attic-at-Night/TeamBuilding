'use strict';
// Maze generation and movement logic for the team-building maze game.
//
// Roles (see MazeRole in protocol.js):
//   mover – navigates; sees maze structure and own position, but not hazard locations
//   guide – sees the full map including hazards; cannot move
//
// The full state (including hazard positions) is broadcast to every client.
// Each client filters its own view based on role.  This is intentional for a
// trust-based team-building session – the game relies on communication, not
// information hiding enforced by the server.

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
const DELTA    = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a perfect maze using iterative recursive backtracking.
 * Returns the maze sub-state object stored in the session.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [hazardCount=4]
 * @returns {object} maze state
 */
function generateMaze(width, height, hazardCount = 4) {
  // Initialise all cells with every wall present.
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ walls: { n: true, e: true, s: true, w: true } }))
  );

  const visited = Array.from({ length: height }, () => new Array(width).fill(false));

  // Iterative DFS to avoid hitting the call-stack limit on large mazes.
  const stack = [[0, 0]];
  visited[0][0] = true;
  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    const dirs = shuffle(['n', 'e', 's', 'w']).filter((dir) => {
      const [dr, dc] = DELTA[dir];
      const nr = r + dr;
      const nc = c + dc;
      return nr >= 0 && nr < height && nc >= 0 && nc < width && !visited[nr][nc];
    });

    if (dirs.length === 0) {
      stack.pop();
      continue;
    }

    const dir = dirs[0];
    const [dr, dc] = DELTA[dir];
    const nr = r + dr;
    const nc = c + dc;
    cells[r][c].walls[dir] = false;
    cells[nr][nc].walls[OPPOSITE[dir]] = false;
    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  // Place hazards on random non-start, non-goal cells.
  const candidates = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (r === 0 && c === 0) continue;
      if (r === height - 1 && c === width - 1) continue;
      candidates.push({ row: r, col: c });
    }
  }
  shuffle(candidates);
  const hazards = candidates.slice(0, hazardCount);

  return {
    width,
    height,
    cells,
    hazards,
    goal: { row: height - 1, col: width - 1 },
    playerPos: { row: 0, col: 0 },
    reached: false,
    hitHazards: 0,
  };
}

/**
 * Attempt to move the player one step in the given direction.
 * Mutates maze.playerPos (and counters) in-place.
 * Returns a result object that is appended to the session event log.
 *
 * @param {object} maze   The maze sub-state from the session.
 * @param {string} dir    One of 'n' | 'e' | 's' | 'w'.
 * @returns {{ result: string, from?: object, to?: object }}
 */
function movePlayer(maze, dir) {
  if (!DELTA[dir]) {
    return { result: 'invalid' };
  }

  const { row, col } = maze.playerPos;
  if (maze.cells[row][col].walls[dir]) {
    return { result: 'wall', from: { row, col } };
  }

  const [dr, dc] = DELTA[dir];
  const nr = row + dr;
  const nc = col + dc;
  maze.playerPos = { row: nr, col: nc };

  if (maze.hazards.some(h => h.row === nr && h.col === nc)) {
    maze.hitHazards += 1;
    return { result: 'hazard', from: { row, col }, to: { row: nr, col: nc } };
  }

  if (nr === maze.goal.row && nc === maze.goal.col) {
    maze.reached = true;
    return { result: 'goal', from: { row, col }, to: { row: nr, col: nc } };
  }

  return { result: 'ok', from: { row, col }, to: { row: nr, col: nc } };
}

module.exports = { generateMaze, movePlayer };
