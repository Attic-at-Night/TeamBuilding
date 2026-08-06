'use strict';

const { MazeRole, GameMode } = require('../protocol');

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

function shufflePlayers(players, gameMode = GameMode.COMMUNICATION_CLARITY) {
  const shuffled = players.slice();
  if (shuffled.length <= 1) {
    return shuffled;
  }

  if (gameMode === GameMode.COLLABORATION_TEAMWORK) {
    const offset = 1 % shuffled.length;
    return shuffled.slice(offset).concat(shuffled.slice(0, offset));
  }

  return shuffled;
}

module.exports = {
  getRoleOrder,
  shufflePlayers,
};
