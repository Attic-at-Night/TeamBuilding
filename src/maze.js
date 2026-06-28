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

const crypto = require('crypto');

const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
const DELTA = { n: [-1, 0], s: [1, 0], e: [0, 1], w: [0, -1] };
const DIRS = ['n', 'e', 's', 'w'];

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
 * Add extra passages by randomly removing a fraction of the remaining interior walls.
 * Unlike dead-end-only braiding this creates loops throughout the entire maze,
 * reliably producing multiple distinct routes between any two cells (including
 * start → goal).
 *
 * @param {object[][]} cells
 * @param {number} height
 * @param {number} width
 * @param {number} fraction  Fraction (0–1) of remaining interior walls to remove.
 */
function addLoops(cells, height, width, fraction) {
  // Collect every remaining interior wall edge once (south-wall of row r, or
  // east-wall of column c) to avoid double-counting the same wall.
  const walls = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (r < height - 1 && cells[r][c].walls.s) walls.push([r, c, 's']);
      if (c < width  - 1 && cells[r][c].walls.e) walls.push([r, c, 'e']);
    }
  }
  shuffle(walls);
  const removeCount = Math.round(walls.length * fraction);
  for (let i = 0; i < removeCount; i++) {
    const [r, c, dir] = walls[i];
    const nr = r + (dir === 's' ? 1 : 0);
    const nc = c + (dir === 'e' ? 1 : 0);
    cells[r][c].walls[dir] = false;
    cells[nr][nc].walls[OPPOSITE[dir]] = false;
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
function randomId() {
  return crypto.randomBytes(3).toString('hex');
}

function pickDistinctCells(candidates, count) {
  shuffle(candidates);
  return candidates.slice(0, count);
}

function generateMaze(width, height, hazardCount = 12, keyCount = 3, lifePickupCount = 2) {
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

  // Add loops by removing ~35 % of remaining interior walls, creating many
  // independent cycles and guaranteeing multiple routes from start to goal.
  addLoops(cells, height, width, 0.35);

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
  const hazards = pickDistinctCells([...candidates], hazardCount);
  const keyCandidates = candidates.filter((cell) => !hazards.some((hazard) => hazard.row === cell.row && hazard.col === cell.col));
  const keys = pickDistinctCells(keyCandidates, keyCount).map((cell, index) => ({
    id: `key-${index + 1}-${randomId()}`,
    key: index + 1,
    row: cell.row,
    col: cell.col,
    collected: false,
  }));
  const pickupCandidates = keyCandidates.filter((cell) => !keys.some((key) => key.row === cell.row && key.col === cell.col));
  const lifePickups = pickDistinctCells(pickupCandidates, lifePickupCount).map((cell, index) => ({
    id: `life-${index + 1}-${randomId()}`,
    row: cell.row,
    col: cell.col,
    collected: false,
  }));

  return {
    seed: randomId(),
    width,
    height,
    cells,
    hazards,
    keys,
    lifePickups,
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

  if (nr === maze.goal.row && nc === maze.goal.col) {
   maze.reached = true;
   return { result: 'goal', from: { row, col }, to: { row: nr, col: nc } };
  }

  return { result: 'ok', from: { row, col }, to: { row: nr, col: nc } };
}

function findKeyAt(maze, row, col) {
  return maze.keys.find((key) => !key.collected && key.row === row && key.col === col) || null;
}

function findLifeAt(maze, row, col) {
  return maze.lifePickups.find((life) => !life.collected && life.row === row && life.col === col) || null;
}

module.exports = { generateMaze, movePlayer, findKeyAt, findLifeAt };
