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
const DIRS     = ['n', 'e', 's', 'w'];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * BFS shortest path from (startRow, startCol) to (goalRow, goalCol).
 * Returns an array of { row, col } cells, or null if unreachable.
 *
 * @param {object[][]} cells
 * @param {number} height
 * @param {number} width
 * @param {number} startRow
 * @param {number} startCol
 * @param {number} goalRow
 * @param {number} goalCol
 * @returns {Array<{row:number,col:number}>|null}
 */
function findPath(cells, height, width, startRow, startCol, goalRow, goalCol) {
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  const parent  = Array.from({ length: height }, () => new Array(width).fill(null));

  const queue = [[startRow, startCol]];
  visited[startRow][startCol] = true;

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (r === goalRow && c === goalCol) {
      // Reconstruct path.
      const path = [];
      let pr = r, pc = c;
      while (pr !== null) {
        path.unshift({ row: pr, col: pc });
        const p = parent[pr][pc];
        if (p === null) break;
        [pr, pc] = p;
      }
      return path;
    }
    for (const dir of DIRS) {
      if (cells[r][c].walls[dir]) continue;
      const [dr, dc] = DELTA[dir];
      const nr = r + dr;
      const nc = c + dc;
      if (!visited[nr][nc]) {
        visited[nr][nc] = true;
        parent[nr][nc] = [r, c];
        queue.push([nr, nc]);
      }
    }
  }
  return null;
}

/**
 * Braid a perfect maze by removing a fraction of dead-end walls, creating loops
 * and therefore multiple routes between cells.
 *
 * @param {object[][]} cells
 * @param {number} height
 * @param {number} width
 * @param {number} fraction  Probability (0–1) that each dead-end is opened up.
 */
function braidMaze(cells, height, width, fraction) {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const openCount = DIRS.filter(d => !cells[r][c].walls[d]).length;
      if (openCount !== 1) continue; // only dead-ends
      if (Math.random() > fraction) continue;

      // Remove one random closed wall that leads to a valid neighbour.
      const closedDirs = shuffle(DIRS.filter(d => cells[r][c].walls[d]));
      for (const dir of closedDirs) {
        const [dr, dc] = DELTA[dir];
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
          cells[r][c].walls[dir] = false;
          cells[nr][nc].walls[OPPOSITE[dir]] = false;
          break;
        }
      }
    }
  }
}

/**
 * Generate a 14×14 maze (by default) with multiple routes and hazard placement
 * that guarantees at least one hazard-free path from start to goal.
 *
 * Steps:
 *   1. Build a perfect maze via iterative DFS.
 *   2. Braid ~40 % of dead-ends to open extra passages (multiple routes).
 *   3. Find a safe BFS path from start → goal.
 *   4. Place hazards only on cells outside that safe path.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [hazardCount=12]
 * @returns {object} maze state
 */
function generateMaze(width, height, hazardCount = 12) {
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
    const dirs = shuffle(DIRS).filter((dir) => {
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

  // Braid ~40 % of dead-ends to create multiple routes.
  braidMaze(cells, height, width, 0.4);

  // Find the BFS safe path from start to goal; hazards will never be placed on it.
  const safePath = findPath(cells, height, width, 0, 0, height - 1, width - 1) || [];
  const safeSet  = new Set(safePath.map(p => `${p.row},${p.col}`));

  // Place hazards on cells that are not on the safe path.
  const candidates = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!safeSet.has(`${r},${c}`)) {
        candidates.push({ row: r, col: c });
      }
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
    maze.playerPos = { row: 0, col: 0 };
    return { result: 'hazard', from: { row, col }, to: { row: nr, col: nc } };
  }

  if (nr === maze.goal.row && nc === maze.goal.col) {
    maze.reached = true;
    return { result: 'goal', from: { row, col }, to: { row: nr, col: nc } };
  }

  return { result: 'ok', from: { row, col }, to: { row: nr, col: nc } };
}

module.exports = { generateMaze, movePlayer };
