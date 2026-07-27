(function initTeamBuildingControllerRoleDependencies() {
  'use strict';

  function createTrainerDependencies() {
    return Object.freeze({
      defaultTab: 'maze',
      defaultClarityType: 'role_unclear',
      clarityTypes: Object.freeze([
        'role_unclear',
        'lack_of_sent_communication',
        'lack_of_received_communication',
        'acted_before_communicating',
        'contradicting_instructions',
        'silent_confusion',
      ]),
      feedVisibleCount: 8,
    });
  }

  function createPlayerDependencies() {
    return Object.freeze({
      defaultTab: null,
      defaultClarityType: null,
      clarityTypes: Object.freeze([]),
      feedVisibleCount: 8,
    });
  }

  window.TeamBuildingControllerRoleDependencies = Object.freeze({
    createTrainerDependencies,
    createPlayerDependencies,
  });
}());
