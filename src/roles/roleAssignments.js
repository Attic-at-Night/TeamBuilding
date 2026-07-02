'use strict';

const { MazeRole } = require('../protocol');

function getRoleOrder(playerCount) {
  if (playerCount <= 0) {
    return [];
  }
  if (playerCount === 1) {
    return [[MazeRole.MOVER, MazeRole.KEY_SEER, MazeRole.GUIDE, MazeRole.NAVIGATOR]];
  }
  if (playerCount === 2) {
    return [
      [MazeRole.MOVER, MazeRole.KEY_SEER],
      [MazeRole.GUIDE, MazeRole.NAVIGATOR],
    ];
  }
  if (playerCount === 3) {
    return [
      [MazeRole.MOVER],
      [MazeRole.GUIDE, MazeRole.NAVIGATOR],
      [MazeRole.KEY_SEER],
    ];
  }
  return [
    [MazeRole.MOVER],
    [MazeRole.GUIDE],
    [MazeRole.KEY_SEER],
    [MazeRole.NAVIGATOR],
  ];
}

function shufflePlayers(players) {
  const shuffled = players.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = {
  getRoleOrder,
  shufflePlayers,
};
