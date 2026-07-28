# TeamBuilding Project Overview

**GitHub Repository**: https://github.com/Attic-at-Night/TeamBuilding

---

## What is TeamBuilding?

A real-time multiplayer game where teams compete to navigate mazes on a shared display. Players join via their phones by scanning a QR code, then control their character using touch controls on their device. The display screen shows the maze, all players, and live game state.

**Live URL**: `http://159.65.197.157:3000`

---

## Tech Stack

### Frontend (Browser)
- **HTML + CSS + JavaScript** (vanilla, no frameworks)
- **Phaser 3** — 2D game framework using WebGL rendering
  - Handles maze rendering, player graphics, animations
  - Responsive scene management (different scenes for display vs. mobile)
  - Loaded via CDN (`phaser@3.88.2`)
- **WebSocket** for real-time game sync with server
- Runs on both display screen (large monitor) and player phones (mobile browsers)

### Backend (Node.js)
- **Node.js 20** with Express.js
- WebSocket server for live multiplayer comms
- QR code generation for join links
- Session management

### Testing
- **Node.js built-in test runner** (`node --test`)
- 20 tests covering networking, game logic, WebSocket flows

---

## Infrastructure & Deployment

### Server Hosting
**DigitalOcean Droplet** — `$4/month`
- OS: Ubuntu 24.04 LTS
- Size: 1GB RAM, 1 vCPU
- IP: `159.65.197.157`
- Status: Power off when not in use to save costs

### Process Management
**pm2** — free, open-source
- Manages Node.js app process
- Auto-restart on crash
- Auto-start on server reboot via systemd

### Deployment Pipeline
**GitHub Actions** — free (included with GitHub)
- Triggers on every push to `main` branch
- Steps:
  1. Install dependencies
  2. Run tests
  3. Package app as tarball
  4. Deploy over SSH to server
  5. Restart app via pm2
- Full deploy takes ~2 minutes

---

## Tools & Services (Paid vs. Free)

| Tool | Cost | Purpose | Why |
|------|------|---------|-----|
| **GitHub** | Free | Code hosting, Actions, repo management | Industry standard, tight integrations |
| **GitHub Copilot** | $10/user/month | AI-assisted code writing during development | Speeds up feature implementation; optional for development |
| **Copilot Agents** | Included with Copilot | Automated coding tasks, PR creation, investigation | Used to set up deployment workflow; optional automation |
| **DigitalOcean Droplet** | $4/month | VPS for running live server | Cheapest reliable option; can stop when not using |
| **Phaser 3** | Free | 2D game framework, WebGL rendering | Open-source; industry-standard for browser games |
| **pm2** | Free | Process manager, auto-restart | Industry standard, no alternative cost |
| **Node.js** | Free | Runtime | Industry standard, no alternative cost |
| **Express.js** | Free | Web framework | Industry standard, no alternative cost |
| **ws (WebSocket)** | Free | Real-time socket communication | Open-source, industry standard |

**Total monthly cost (always on)**: ~$14/month  
**Total monthly cost (droplet off when idle)**: ~$10/month + DigitalOcean usage

---

## How to Deploy

```bash
# 1. Make changes locally
git add .
git commit -m "your message"

# 2. Push to main
git push origin main

# 3. GitHub Actions automatically:
#    - Tests your code
#    - Packages it
#    - Deploys to the server
#    - Restarts the app

# 4. App live in ~2 minutes at http://159.65.197.157:3000
```

See `DEPLOYMENT.md` in the repo for detailed commands and troubleshooting.

---

## Running Locally

```bash
npm install
npm start
```

App runs on `http://localhost:3000`. Phones on the same WiFi network can join via QR code.

---

## Game Flow

1. **Display Setup**: Large monitor/projector shows the maze on startup page
2. **Session Created**: QR code generated and displayed
3. **Players Join**: Teammates scan QR code on their phones
4. **Game Starts**: Display host clicks "Start Game"
5. **Live Gameplay**: Players move their characters; display updates in real-time via WebSocket
6. **End**: Session closes when display disconnects

---

## Key Files

- `server.js` — Express server + WebSocket handler
- `src/sessionManager.js` — Game logic, session management
- `src/protocol.js` — Message types and constants
- `public/display.html` + `public/display.js` — Large screen UI (Phaser scene)
- `public/join.html` + `public/join.js` — Phone join/game UI (Phaser scenes)
- `.github/workflows/deploy.yml` — Automated deployment
- `DEPLOYMENT.md` — Operations cheat sheet

---

## Repository Links

- **Code**: https://github.com/Attic-at-Night/TeamBuilding
- **Server**: http://159.65.197.157:3000
- **Deployment Docs**: See `DEPLOYMENT.md` in repo
- **Tests**: Run `npm test`

---

## Status & Next Steps

- ✅ Game fully functional
- ✅ Phaser rendering (WebGL) smooth and responsive
- ✅ Automated deployment working
- ✅ Auto-restart on server reboot
- 🎮 Ready for multiplayer testing

**Current blockers**: None. Ready to play!

---

## Contacts / Owners

- **Project Lead**: Nils Rietveld
- **Infrastructure**: DigitalOcean droplet at `159.65.197.157`
- **Deployment**: GitHub Actions
