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
  "players": [{ "id": "uuid", "name": "Alice" }]
}
```

### Adding a minigame

1. Add minigame state fields to the session's `state` object in `SessionManager`.
2. Handle `player_input` in `handleInput()` to update state server-side.
3. Call `broadcastState()` after each update — all clients receive `state_sync`.
4. Add display-side rendering in `public/display.js` and controller UI in `public/join.js`.

The shared message type constants live in `src/protocol.js`.

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
