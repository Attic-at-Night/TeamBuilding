'use strict';

const { MazeRole } = require('../protocol');

function getRoleOrder(playerCount) {
  const roles = [MazeRole.MOVER, MazeRole.GUIDE];
  if (playerCount >= 3) {
    roles.push(MazeRole.KEY_SEER);
  }
  if (playerCount >= 4) {
    roles.push(MazeRole.NAVIGATOR);
  }
  return roles;
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
