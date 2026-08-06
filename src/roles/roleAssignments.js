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
  return players.slice();
}

module.exports = {
  getRoleOrder,
  shufflePlayers,
};
