'use strict';

const { MazeRole, GameMode } = require('../protocol');
const { getRoleOrder } = require('../roles/roleAssignments');

function normalizeRoleArray(value) {
  if (Array.isArray(value)) {
    return value.filter((role) => typeof role === 'string' && role.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

function roleGroupKey(roles) {
  return normalizeRoleArray(roles).join('|');
}

function shouldCycleRolesForMode(gameMode) {
  return gameMode === GameMode.COLLABORATION_TEAMWORK;
}

function buildCycledRoles(activePlayers, previousRoles = {}, _gameMode = GameMode.COMMUNICATION_CLARITY) {
  const roleGroups = getRoleOrder(activePlayers.length).map((group) => group.slice());
  const groupKeys = roleGroups.map((group) => roleGroupKey(group));
  if (!roleGroups.length) {
    return null;
  }

  const nextRoles = {};
  const seenGroups = new Set();
  for (const player of activePlayers) {
    const previousGroupKey = roleGroupKey(previousRoles[player.id]);
    const currentIndex = groupKeys.indexOf(previousGroupKey);
    if (currentIndex < 0 || seenGroups.has(previousGroupKey)) {
      return null;
    }
    const nextIndex = (currentIndex + 1) % roleGroups.length;
    nextRoles[player.id] = roleGroups[nextIndex].slice();
    seenGroups.add(previousGroupKey);
  }

  return nextRoles;
}

function rebalanceRoles(activePlayers, previousRoles = {}, gameMode = GameMode.COMMUNICATION_CLARITY) {
  if (!shouldCycleRolesForMode(gameMode)) {
   const roleGroups = getRoleOrder(activePlayers.length).map((group) => group.slice());
   const nextRoles = {};
   const assignedGroupIndexes = new Set();

   const existingPlayers = [];
   const newPlayers = [];
   for (const player of activePlayers) {
     const previous = normalizeRoleArray(previousRoles[player.id]);
     if (previous.length) {
       existingPlayers.push(player);
     } else {
       newPlayers.push(player);
     }
   }

   for (const player of existingPlayers) {
     const previous = normalizeRoleArray(previousRoles[player.id]);
     const preferredIndex = roleGroups.findIndex((group) => roleGroupKey(group) === roleGroupKey(previous));
     const availableIndex = preferredIndex >= 0 && !assignedGroupIndexes.has(preferredIndex)
       ? preferredIndex
       : roleGroups.findIndex((_group, index) => !assignedGroupIndexes.has(index));
     if (availableIndex >= 0) {
       nextRoles[player.id] = roleGroups[availableIndex].slice();
       assignedGroupIndexes.add(availableIndex);
     }
   }

   for (const player of newPlayers) {
     const availableIndex = roleGroups.findIndex((_group, index) => !assignedGroupIndexes.has(index));
     if (availableIndex >= 0) {
       nextRoles[player.id] = roleGroups[availableIndex].slice();
       assignedGroupIndexes.add(availableIndex);
     }
   }

   return Object.keys(nextRoles).length ? nextRoles : {};
  }

  const roleGroups = getRoleOrder(activePlayers.length).map((group) => group.slice());
  const playerMap = new Map(activePlayers.map((player) => [player.id, player]));
  const remainingPlayerIds = activePlayers.map((player) => player.id);
  const remainingGroupIndexes = roleGroups.map((_group, index) => index);
  const nextRoles = {};

  const assign = (playerId, groupIndex) => {
    const playerIndex = remainingPlayerIds.indexOf(playerId);
    const groupPosition = remainingGroupIndexes.indexOf(groupIndex);
    if (playerIndex < 0 || groupPosition < 0) {
      return false;
    }
    nextRoles[playerId] = roleGroups[groupIndex].slice();
    remainingPlayerIds.splice(playerIndex, 1);
    remainingGroupIndexes.splice(groupPosition, 1);
    return true;
  };

  const existingMoverId = activePlayers.find((player) => {
    const assigned = normalizeRoleArray(previousRoles[player.id]);
    return assigned.includes(MazeRole.MOVER);
  })?.id || null;
  const moverGroupIndex = remainingGroupIndexes.find((groupIndex) => roleGroups[groupIndex].includes(MazeRole.MOVER));
  if (existingMoverId && playerMap.has(existingMoverId) && moverGroupIndex != null) {
    assign(existingMoverId, moverGroupIndex);
  }

  while (remainingPlayerIds.length && remainingGroupIndexes.length) {
    let best = null;
    for (const playerId of remainingPlayerIds) {
      const previous = normalizeRoleArray(previousRoles[playerId]);
      for (const groupIndex of remainingGroupIndexes) {
        const group = roleGroups[groupIndex];
        const overlap = group.filter((role) => previous.includes(role)).length;
        const score = overlap;
        if (!best || score > best.score) {
          best = { playerId, groupIndex, score };
        }
      }
    }

    if (!best) {
      break;
    }
    assign(best.playerId, best.groupIndex);
  }

  return nextRoles;
}

module.exports = {
  normalizeRoleArray,
  buildCycledRoles,
  rebalanceRoles,
  shouldCycleRolesForMode,
};
