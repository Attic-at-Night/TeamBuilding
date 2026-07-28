'use strict';

const CLARITY_EVENT_TYPES = [
  'role_unclear',
  'lack_of_sent_communication',
  'lack_of_received_communication',
  'acted_before_communicating',
  'contradicting_instructions',
  'silent_confusion',
];

function isClarityEventType(value) {
  return CLARITY_EVENT_TYPES.includes(value);
}

module.exports = {
  CLARITY_EVENT_TYPES,
  isClarityEventType,
};
