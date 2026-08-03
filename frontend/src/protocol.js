export const PROTOCOL_VERSION = 1

export const MessageType = {
  DISPLAY_REGISTER: 'display_register',
  CONTROLLER_JOIN: 'controller_join',
  GAME_START: 'game_start',
  GAME_RESTART: 'game_restart',
  SET_GAME_MODE: 'set_game_mode',
  TIMER_START: 'timer_start',
  TIMER_STOP: 'timer_stop',
  TIMER_RESET: 'timer_reset',
  FOLLOWUP_END: 'followup_end',
  FOLLOWUP_NAVIGATE: 'followup_navigate',
  PLAYER_INPUT: 'player_input',
  RESYNC_REQUEST: 'resync_request',
  CLIENT_REGISTERED: 'client_registered',
  STATE_SYNC: 'state_sync',
  JOIN_ERROR: 'join_error',
  SESSION_CLOSED: 'session_closed',
}

export const GameStatus = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  FOLLOW_UP: 'follow_up',
  ENDED: 'ended',
}

export const GameMode = {
  COMMUNICATION_CLARITY: 'communication & clarity',
  COLLABORATION_TEAMWORK: 'collaboration & teamwork',
}

export const ClientRole = {
  DISPLAY: 'display',
  CONTROLLER: 'controller',
}

export const MazeRole = {
  MOVER: 'mover',
  GUIDE: 'guide',
  KEY_SEER: 'key-seer',
  NAVIGATOR: 'navigator',
  TRAINER: 'trainer',
}

export const ErrorCode = {
  INVALID_MESSAGE_FORMAT: 'invalid_message_format',
  UNKNOWN_MESSAGE_TYPE: 'unknown_message_type',
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_UNAVAILABLE: 'session_unavailable',
  GAME_ALREADY_STARTED: 'game_already_started',
  SESSION_FULL: 'session_full',
  TRAINER_ROLE_TAKEN: 'trainer_role_taken',
  INVALID_RECONNECT_TOKEN: 'invalid_reconnect_token',
  RECONNECT_SLOT_UNAVAILABLE: 'reconnect_slot_unavailable',
  RECONNECT_REPLACED: 'reconnect_replaced',
}

export const CLARITY_TYPES = [
  'role_unclear',
  'silent_confusion',
  'great_callout',
  'stalled_motion',
  'info_gap',
  'breakthrough',
]

