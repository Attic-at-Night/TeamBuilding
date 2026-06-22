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
| Client → Server | `player_input` | Controller sends an action (e.g. `{ action: "buzz" }`) |
| Client → Server | `resync_request` | Any client requests a full state re-send (reconnect) |
| Server → Client | `client_registered` | Acknowledges display/controller registration |
| Server → Client | `state_sync` | Authoritative game state broadcast to all clients |
| Server → Client | `join_error` | Registration or join failure |
| Server → Client | `session_closed` | Display disconnected; session is gone |

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
    { "ts": 1700000001000, "event": "move", "player": "Alice", "dir": "e", "result": "ok", "from": { "row": 0, "col": 0 }, "to": { "row": 0, "col": 1 } }
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
| **Mover** (first player) | Send `player_input` with `{ action: "move", dir: "n|e|s|w" }` | Maze walls + own position — **no hazard markers** |
| **Guide** (all others) | Communicate verbally | Full map including hazard (×) positions — **cannot move** |

The display screen shows everything (walls, hazards, player position, event log) for the facilitator.

Every move — including wall hits and hazard encounters — is appended to `state.log` so the session can be debriefed afterwards.  When `state.status` becomes `"ended"`, the log contains the complete play-through including `hitHazards` count.

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
