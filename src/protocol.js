/**
 * Shared WebSocket protocol constants for the game platform.
 *
 * MessageType covers every message that flows between server and clients.
 * Import this module on the server; the client JS files inline the string
 * literals so that no bundler is required to serve them.
 *
 * Client â†’ Server messages
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * display_register  â€“ big-screen client claims the display role for a session
 * controller_join   â€“ phone client joins a session as a controller
 * game_start        â€“ display requests the server to start the game
 * timer_start       â€“ display starts or resumes the session timer
 * timer_stop        â€“ display pauses the session timer
 * timer_reset       â€“ display resets the session timer
 * followup_end      â€“ display/trainer ends the follow-up phase; the last follow-up transitions into session overview before a manual restart
 * followup_navigate â trainer steps forward/backward through follow-up events
 * return_to_lobby   â trainer resets the session back to lobby (mode selection)
 * player_input      â€“ controller sends an action to the server
 * resync_request    â€“ any client requests a full state_sync (e.g. on reconnect)
 *
 * Server â†’ Client messages
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * client_registered â€“ server acknowledges a successful display/controller registration
 * state_sync        â€“ server broadcasts the authoritative game state to all clients
 * join_error        â€“ server rejects a registration or join attempt
 * session_closed    â€“ server notifies controllers that the display disconnected
 */

const MessageType = {
  // Client â†’ Server
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
  RETURN_TO_LOBBY: 'return_to_lobby',
  PLAYER_INPUT: 'player_input',
  RESYNC_REQUEST: 'resync_request',

  // Server â†’ Client
  CLIENT_REGISTERED: 'client_registered',
  STATE_SYNC: 'state_sync',
  JOIN_ERROR: 'join_error',
  SESSION_CLOSED: 'session_closed',
};

const PROTOCOL_VERSION = 1;

const GameStatus = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  FOLLOW_UP: 'follow_up',
  SESSION_OVERVIEW: 'session_overview',
  ENDED: 'ended',
};

const GameMode = {
  COMMUNICATION_CLARITY: 'communication & clarity',
  COLLABORATION_TEAMWORK: 'collaboration & teamwork',
};

const ClientRole = {
  DISPLAY: 'display',
  CONTROLLER: 'controller',
};

// Roles within the maze game.
// The first player to join becomes the mover; all others are guides.
const MazeRole = {
  MOVER: 'mover',
  GUIDE: 'guide',
  KEY_SEER: 'key-seer',
  NAVIGATOR: 'navigator',
};

const ErrorCode = {
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
};

module.exports = { MessageType, GameStatus, GameMode, ClientRole, MazeRole, ErrorCode, PROTOCOL_VERSION };
