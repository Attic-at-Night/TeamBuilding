# TeamBuilding React frontend scaffold

This frontend is the handoff workspace for rebuilding the Phaser UI in React.
It targets the existing Express + WebSocket backend without changing server behavior.

## Commands

```bash
npm install
npm run dev
```

The root package also includes shortcuts:

```bash
npm run frontend:dev
npm run frontend:build
npm run frontend:preview
```

## Backend connectivity

By default:

- `npm run dev` assumes backend at `http://localhost:3000`
- production build uses `window.location.origin`

Optional env vars:

- `VITE_BACKEND_ORIGIN` (example: `https://game.example.com`)
- `VITE_WS_URL` for explicit WebSocket endpoint override

Copy `.env.example` to `.env` to set them locally.

## Protocol contract (frontend-facing)

The scaffold keeps protocol constants in `src/protocol.js` for React usage.

### Client -> server messages

- `display_register` `{ sessionId }`
- `controller_join` `{ sessionId, name, reconnectToken?, requestedTrainer? }`
- `game_start` `{}`
- `game_restart` `{}`
- `timer_start` `{ durationMs }`
- `timer_stop` `{}`
- `timer_reset` `{ durationMs }`
- `followup_end` `{}`
- `player_input` `{ input }`
- `resync_request` `{}`

### Server -> client messages

- `client_registered`
- `state_sync`
- `join_error` (includes `code`)
- `session_closed` (legacy event)

Server envelopes include protocol version `v` and message `type`.
