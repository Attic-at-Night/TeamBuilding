const test = require('node:test');
const assert = require('node:assert/strict');
const { generateMaze } = require('../src/maze');

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
