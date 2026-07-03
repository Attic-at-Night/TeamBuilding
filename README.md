# TeamBuilding

A real-time multiplayer party game platform with a Jackbox-style architecture.
A big-screen **display** hosts the session; players join from their phones as **controllers**.

## Run locally

```bash
npm install
npm start
```

Then open:
- `http://localhost:3000/` on the TV/browser — this is the **display** screen
- Scan the QR code from a phone to open the **controller** screen

## Host online

This app can also run on a public host. When the display is opened through a real domain or public IP, new sessions now generate QR codes and join links that reuse that public URL, so remote devices can connect directly over the internet.

If your hosting setup sits behind a proxy or you want to force a specific public URL, set `PUBLIC_ORIGIN` before starting the server:

```bash
PUBLIC_ORIGIN=https://your-app.example.com npm start
```

When running locally on `localhost`, the server still falls back to your LAN IP so phones on the same network can join.

### Mobile connection reliability tuning

The WebSocket heartbeat/grace window is configurable for mobile-heavy sessions:

- `WS_HEARTBEAT_INTERVAL_MS` – ping cadence (default: `4000`)
- `WS_DISCONNECT_GRACE_MS` – how long to keep a disconnected socket before cleanup (default: `60000`)

Recommended starting point for mobile devices that may sleep/lock:

```bash
WS_HEARTBEAT_INTERVAL_MS=4000
WS_DISCONNECT_GRACE_MS=60000
```

## Deploy with GitHub Actions

This repository includes a CI/CD workflow at `.github/workflows/deploy.yml`.

- On pull requests: it installs dependencies, runs `npm test`, and packages a release artifact.
- On pushes to `main` (or manual `workflow_dispatch`): it runs the same CI steps, then deploys the artifact to a VPS over SSH.

### Required repository secrets

Set these in **Settings → Secrets and variables → Actions**:

- `DEPLOY_HOST` – hostname/IP of your server
- `DEPLOY_USER` – SSH user for deployment
- `DEPLOY_SSH_KEY` – private SSH key for `DEPLOY_USER`
- `DEPLOY_PATH` – deployment directory on the server (example: `/var/www/teambuilding`)
- `PUBLIC_ORIGIN` – public base URL used by the app for join/session links (example: `https://game.example.com`)

Optional:

- `PORT` – runtime port on the server (defaults to `3000`)

### Deployment assumptions

- The target server has Node.js and `npm` installed.
- The workflow writes `.env` with `PUBLIC_ORIGIN` (and `PORT`) inside each release.
- If `pm2` is installed on the server, the workflow restarts the app automatically as process `teambuilding`.
- If `pm2` is not installed, the workflow still uploads/releases the app and prints the manual start command.

## Architecture overview

```
Browser (Display)          Server                  Browser (Controller)
─────────────────    ←────────────────────→    ──────────────────────────
display_register  ─→ registers display socket
                     creates game session
                  ←─ client_registered
                  ←─ state_sync (lobby)

                                               controller_join ─→
                                               registers controller
                                               assigns playerId
                                          ←─── client_registered
                  ←─ state_sync (lobby, players updated)
                                          ←─── state_sync

game_start ───────→ status → playing
                  ←─ state_sync (playing)
                                          ←─── state_sync (playing)

                                               player_input ──→
                  ←─ player_input (forwarded)
```

### WebSocket message types

| Direction | Type | Description |
|-----------|------|-------------|
| Client → Server | `display_register` | Big screen claims display role for a session |
| Client → Server | `controller_join` | Phone joins session as a controller |
| Client → Server | `game_start` | Display requests game start |
| Client → Server | `game_restart` | Display restarts an ended session |
| Client → Server | `timer_start` | Display starts or resumes the session timer |
| Client → Server | `timer_stop` | Display pauses the session timer |
| Client → Server | `timer_reset` | Display resets the session timer |
| Client → Server | `player_input` | Controller sends an action (e.g. `{ action: "buzz" }`) |
| Client → Server | `resync_request` | Any client requests a full state re-send (reconnect) |
| Server → Client | `client_registered` | Acknowledges display/controller registration |
| Server → Client | `state_sync` | Authoritative game state broadcast to all clients |
| Server → Client | `join_error` | Registration or join failure |
| Server → Client | `session_closed` | (Legacy) Session ended and was removed; currently not emitted by the server |

All server-sent WebSocket messages now include protocol version `v`.
Clients may send either the legacy flat payload format or an envelope format:

```json
{
  "v": 1,
  "type": "controller_join",
  "payload": {
    "sessionId": "ABC123",
    "name": "Alex"
  }
}
```

`join_error` also includes a machine-readable `code` for reconnect/join handling.

Sessions are now kept server-side across transient disconnects. A display disconnect no longer destroys the
session immediately; connected clients receive updated state showing `displayConnected: false` until the host
reattaches or later reconnect handling claims the session.

Controllers now receive a reconnect token in `client_registered`, and the client stores it locally to support
automatic/manual rejoin of the same player slot when the session still exists.

The server also now maintains authoritative timer state with `idle`, `running`, `stopped`, and `expired`
lifecycle states. Timer transitions are included in synchronized state and persisted session exports.
The display exposes start / pause / reset timer controls, and controllers show compact timer status.

### Game state shape

```json
{
  "status": "lobby | playing | ended",
  "players": [{ "id": "uuid", "name": "Alice" }],
  "roles": { "<playerId>": "mover | guide" },
  "maze": {
    "width": 7, "height": 7,
    "cells": [[{ "walls": { "n": true, "e": false, "s": false, "w": true } }]],
    "hazards": [{ "row": 2, "col": 3 }],
    "goal": { "row": 6, "col": 6 },
    "playerPos": { "row": 0, "col": 0 },
    "reached": false,
    "hitHazards": 0
  },
  "log": [
    { "ts": 1700000000000, "event": "game_start" },
    { "ts": 1700000001000, "event": "move", "player": "Alice", "dir": "e", "result": "ok", "from": { "row": 0, "col": 0 }, "to": { "row": 0, "col": 1 } },
    { "ts": 1700000002000, "event": "session_end", "outcome": "success", "keys": 3, "lives": 1 }
  ]
}
```

### Adding a minigame

The maze game is already implemented as the first minigame.  It follows this pattern and can serve as a reference:

1. Add minigame state fields to the session's `state` object in `SessionManager`.
2. Handle `player_input` in `handleInput()` to update state server-side.
3. Call `broadcastState()` after each update — all clients receive `state_sync`.
4. Add display-side rendering in `public/display.js` and controller UI in `public/join.js`.

The shared message type constants live in `src/protocol.js`.

### Maze game

The first minigame uses **asymmetric information** to surface clarity issues in communication and role assignment:

| Role | Can do | Can see |
|------|--------|---------|
| **Trainer** (explicitly selected on join) | Observe, scroll realtime events, log clarity events, toggle highlights, and share either full logs or curated highlights via `trainer_share_log` / `trainer_share_highlights` | Combined mini-maze overview + full trainer event feed |
| **Mover** (randomized gameplay role) | Send `player_input` with `{ action: "move", dir: "n|e|s|w" }` | Grid + own position only |
| **Guide** (randomized gameplay role) | Communicate hazards and ghost pressure | Hazard locations, ghost positions, + player position |
| **Key Seer** (randomized gameplay role) | Communicate key objectives | Key locations + player position |
| **Navigator** (randomized gameplay role) | Communicate wall layout and risky routes | Maze walls + player position |

When fewer than 4 gameplay players are present, roles are merged:
- 3 players: `mover`, `key-seer`, and `guide+navigator`
- 2 players: `mover+key-seer` and `guide+navigator`

The display screen shows everything (walls, hazards, ghosts, player position, event log) for the facilitator.
The session log now renders as a color-coded chronological timeline with scroll support. It auto-follows
new events during play, and facilitators can scroll back to inspect older moments.

When a round ends, the display shows a restart button so the host can start a fresh round without rebuilding the session.

Every move — including wall hits, ghost collisions, and hazard encounters — is appended to `state.log` so the session can be debriefed afterwards. Maze resets now also rotate between layout variants and escalate into a simple hard mode that adds ghost pressure after repeated failures. When `state.status` becomes `"ended"`, the log contains the complete play-through including `hitHazards` count.

### Durable session log export

Session logs are also persisted to `session-logs/<SESSION_ID>.json` on the server host.  
You can fetch the current/persisted export JSON with:

`GET /api/session/:sessionId/log`

## Project structure

```
server.js              Express + WebSocket server; WS message dispatch
src/
  protocol.js          Shared message type / game status / client role constants
  sessionManager.js    Game session lifecycle (display, controllers, state)
  network.js           Local IP / SSID detection for the QR code URL
  url.js               Join URL redirect helper
public/
  index.html           Display screen
  display.js           Display client (registers as display, shows state, inputs)
  join.html            Controller screen
  join.js              Controller client (joins session, sends player_input)
  host.js              Legacy host script (superseded by display.js)
test/
  sessionManager.test.js
  network.test.js
  url.test.js
```
