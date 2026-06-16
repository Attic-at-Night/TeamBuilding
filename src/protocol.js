/**
 * Shared WebSocket protocol constants for the game platform.
 *
 * MessageType covers every message that flows between server and clients.
 * Import this module on the server; the client JS files inline the string
 * literals so that no bundler is required to serve them.
 *
 * Client → Server messages
 * ────────────────────────
 * display_register  – big-screen client claims the display role for a session
 * controller_join   – phone client joins a session as a controller
 * game_start        – display requests the server to start the game
 * player_input      – controller sends an action to the server
 * resync_request    – any client requests a full state_sync (e.g. on reconnect)
 *
 * Server → Client messages
 * ────────────────────────
 * client_registered – server acknowledges a successful display/controller registration
 * state_sync        – server broadcasts the authoritative game state to all clients
 * join_error        – server rejects a registration or join attempt
 * session_closed    – server notifies controllers that the display disconnected
 */

const MessageType = {
  // Client → Server
  DISPLAY_REGISTER: 'display_register',
  CONTROLLER_JOIN: 'controller_join',
  GAME_START: 'game_start',
  PLAYER_INPUT: 'player_input',
  RESYNC_REQUEST: 'resync_request',

  // Server → Client
  CLIENT_REGISTERED: 'client_registered',
  STATE_SYNC: 'state_sync',
  JOIN_ERROR: 'join_error',
  SESSION_CLOSED: 'session_closed',
};

const GameStatus = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  ENDED: 'ended',
};

const ClientRole = {
  DISPLAY: 'display',
  CONTROLLER: 'controller',
};

module.exports = { MessageType, GameStatus, ClientRole };
