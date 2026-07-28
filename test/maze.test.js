const test = require('node:test');
const assert = require('node:assert/strict');
const { generateMaze } = require('../src/maze');

function cellKey(row, col) {
  return `${row},${col}`;
}

function collectReachableCells(maze) {
  const blocked = new Set(maze.hazards.map((hazard) => cellKey(hazard.row, hazard.col)));
  const visited = Array.from({ length: maze.height }, () => new Array(maze.width).fill(false));
  const reachable = new Set([cellKey(0, 0)]);
  const queue = [[0, 0]];
  const deltas = {
    n: [-1, 0],
    e: [0, 1],
    s: [1, 0],
    w: [0, -1],
  };

  visited[0][0] = true;

  while (queue.length > 0) {
    const [row, col] = queue.shift();
    for (const [dir, [dr, dc]] of Object.entries(deltas)) {
      if (maze.cells[row][col].walls[dir]) {
        continue;
      }
      const nextRow = row + dr;
      const nextCol = col + dc;
      const nextKey = cellKey(nextRow, nextCol);
      if (visited[nextRow][nextCol] || blocked.has(nextKey)) {
        continue;
      }
      visited[nextRow][nextCol] = true;
      reachable.add(nextKey);
      queue.push([nextRow, nextCol]);
    }
  }

  return reachable;
}

test('generated maze sets goal at start without overlapping hazards or keys', () => {
  for (let i = 0; i < 50; i++) {
    const maze = generateMaze(14, 14, 12, 3, 0);

    assert.ok(maze.goal);
    assert.notDeepEqual(maze.goal, { row: 0, col: 0 });
    assert.equal(
      maze.hazards.some((hazard) => hazard.row === maze.goal.row && hazard.col === maze.goal.col),
      false
    );
    assert.equal(
      maze.keys.some((key) => key.row === maze.goal.row && key.col === maze.goal.col),
      false
    );
  }
});

test('generated maze keeps every key and the exit reachable without hazards', () => {
  for (let i = 0; i < 75; i++) {
    const maze = generateMaze(14, 14, 18, 3, 0, { loopFraction: 0.2 });
    const reachable = collectReachableCells(maze);

    for (const key of maze.keys) {
      assert.equal(reachable.has(cellKey(key.row, key.col)), true);
    }

    assert.equal(reachable.has(cellKey(maze.goal.row, maze.goal.col)), true);
  }
});
