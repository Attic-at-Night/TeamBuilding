// WebSocket connection shared across all display scenes via the game event bus.
let socket = null;

function connectDisplaySocket(sessionId, game) {
  if (socket) socket.close();
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'display_register', sessionId }));
  });
  socket.addEventListener('message', (event) => {
    game.events.emit('ws_message', JSON.parse(event.data));
  });
  socket.addEventListener('close', () => {
    game.events.emit('ws_close');
  });
}

function sendWs(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

// ── SetupScene ────────────────────────────────────────────────────────────────
// Shows a "Start Session" button. On click, calls /api/session and transitions
// to LobbyScene with the response data.

class SetupScene extends Phaser.Scene {
  constructor() { super({ key: 'SetupScene' }); }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 120, 'TeamBuilding', {
      fontSize: '56px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, 190, 'Display', {
      fontSize: '26px', color: '#888888',
    }).setOrigin(0.5);

    const btn = this.add.rectangle(width / 2, height / 2, 260, 72, 0x3355ff)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(width / 2, height / 2, 'Start Session', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x5577ff));
    btn.on('pointerout', () => btn.setFillStyle(0x3355ff));
    btn.on('pointerup', async () => {
      btn.disableInteractive();
      label.setText('Starting\u2026');
      try {
        const res = await fetch('/api/session', { method: 'POST' });
        const data = await res.json();
        connectDisplaySocket(data.sessionId, this.game);
        this.scene.start('LobbyScene', data);
      } catch {
        label.setText('Error \u2013 try again');
        btn.setInteractive({ useHandCursor: true });
      }
    });
  }
}

// ── LobbyScene ────────────────────────────────────────────────────────────────
// Renders the QR code, session code, and a live player list.
// Shows a "Start Game" button once at least one player has joined.
// Transitions to GameScene when the server broadcasts status === 'playing'.

class LobbyScene extends Phaser.Scene {
  constructor() { super({ key: 'LobbyScene' }); }

  init(data) { this.sessionData = data; }

  create() {
    const { width, height } = this.scale;
    const { sessionId, joinUrl, qrCodeDataUrl, connection } = this.sessionData;

    // Left panel – QR code and join info
    this.add.text(width / 2, 36, 'Scan to Join', {
      fontSize: '30px', color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(width / 2, 76, `Session: ${sessionId}`, {
      fontSize: '24px', color: '#ffff88',
    }).setOrigin(0.5);

    // Load QR code from the base64 data URL returned by the server.
    // Use `on` (not `once`) so the listener isn't consumed by an earlier
    // addtexture event (e.g. Phaser internals) before qr_code is ready.
    if (this.textures.exists('qr_code')) this.textures.remove('qr_code');
    const onQrAdd = (key) => {
      if (key === 'qr_code') {
        this.textures.off('addtexture', onQrAdd);
        this.add.image(width / 2, 276, 'qr_code').setDisplaySize(240, 240);
      }
    };
    this.textures.on('addtexture', onQrAdd);
    this.textures.addBase64('qr_code', qrCodeDataUrl);

    this.add.text(width / 2, 416, joinUrl, {
      fontSize: '14px', color: '#6688ff', wordWrap: { width: width * 0.55 },
    }).setOrigin(0.5);

    if (connection?.ipAddress) {
      const info = [connection.ipAddress, connection.networkName].filter(Boolean).join(' \u2022 ');
      this.add.text(width / 2, 450, info, { fontSize: '13px', color: '#555555' }).setOrigin(0.5);
    }

    // Right panel – player list
    const px = width * 0.75;
    this.add.text(px, 36, 'Players', { fontSize: '26px', color: '#ffffff' }).setOrigin(0.5);
    this.playerGroup = this.add.group();

    this.statusText = this.add.text(px, height - 140, 'Waiting for players\u2026', {
      fontSize: '16px', color: '#888888',
    }).setOrigin(0.5);

    this.startBg = this.add.rectangle(px, height - 76, 240, 68, 0x22aa55)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    this.startLabel = this.add.text(px, height - 76, 'Start Game', {
      fontSize: '22px', color: '#ffffff',
    }).setOrigin(0.5).setVisible(false);

    this.startBg.on('pointerover', () => this.startBg.setFillStyle(0x44cc77));
    this.startBg.on('pointerout', () => this.startBg.setFillStyle(0x22aa55));
    this.startBg.on('pointerup', () => sendWs({ type: 'game_start' }));

    this.game.events.on('ws_message', this.onMessage, this);
  }

  onMessage(message) {
    if (message.type !== 'state_sync') return;
    const { width } = this.scale;
    const { state } = message;
    const players = state.players || [];
    const px = width * 0.75;

    this.playerGroup.clear(true, true);
    players.forEach((p, i) => {
      this.playerGroup.add(
        this.add.text(px, 80 + i * 36, `\u2022 ${p.name}`, {
          fontSize: '20px', color: '#dddddd',
        }).setOrigin(0.5)
      );
    });

    const hasPlayers = players.length > 0;
    const isLobby = state.status === 'lobby';
    this.startBg.setVisible(hasPlayers && isLobby);
    this.startLabel.setVisible(hasPlayers && isLobby);
    this.statusText.setText(hasPlayers
      ? `${players.length} player${players.length === 1 ? '' : 's'} ready`
      : 'Waiting for players\u2026');

    if (state.status === 'playing') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('GameScene', { players: state.players, initialState: state });
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

// ── GameScene ─────────────────────────────────────────────────────────────────
// Maze game display: full-information view for the facilitator.
// Left panel: maze grid with player position, hazards (×), and goal (■).
// Right panel: role assignment list + scrolling event log for debrief.
// Driven entirely by state_sync messages – no per-frame update needed.

// Maze drawing constants (7 × 7 cells at 80 px each, 80 px margin).
const MAZE_OX = 80;
const MAZE_OY = 80;
const MAZE_CS = 80;

class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  init(data) {
    this.players = data.players || [];
    this.pendingState = data.initialState || null;
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 32, 'Maze Game', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // Maze graphics layer – redrawn on each state update.
    this.mazeGraphics = this.add.graphics();

    // ── Right panel ──────────────────────────────────────────────────────────
    const RX = 700;

    this.add.text(RX, 70, 'Roles', { fontSize: '20px', color: '#ffff88' });
    this.rolesText = this.add.text(RX, 96, '', {
      fontSize: '16px', color: '#dddddd', lineSpacing: 4,
    });

    this.add.text(RX, 230, 'Event Log', { fontSize: '20px', color: '#ffff88' });
    this.logText = this.add.text(RX, 256, '', {
      fontSize: '13px', color: '#aaaaaa', lineSpacing: 3,
      wordWrap: { width: width - RX - 20 },
    });

    // ── End overlay (hidden until game ends) ─────────────────────────────────
    this.endOverlay = this.add.rectangle(width / 2, height / 2, 640, 220, 0x000000, 0.88)
      .setDepth(10).setVisible(false);
    this.endText = this.add.text(width / 2, height / 2 - 40, '', {
      fontSize: '38px', color: '#22ee66', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.endSubText = this.add.text(width / 2, height / 2 + 24, '', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(11).setVisible(false);

    this.game.events.on('ws_message', this.onMessage, this);

    // Render state passed in from LobbyScene; also request a resync in case
    // the socket reconnected after the initial broadcast.
    if (this.pendingState) {
      this.renderState(this.pendingState);
    }
    sendWs({ type: 'resync_request' });
  }

  onMessage(message) {
    if (message.type === 'state_sync') {
      this.renderState(message.state);
    }
  }

  renderState(state) {
    if (!state.maze) return;

    this.drawMaze(state.maze);
    this.updateRoles(state.players || [], state.roles || {});
    this.updateLog(state.log || []);

    if (state.status === 'ended') {
      const moves = (state.log || []).filter(e => e.event === 'move').length;
      this.endOverlay.setVisible(true);
      this.endText.setText('Goal reached!').setVisible(true);
      this.endSubText
        .setText(`Hazards hit: ${state.maze.hitHazards}   Moves: ${moves}   (see log for debrief)`)
        .setVisible(true);
    }
  }

  drawMaze(maze) {
    const OX = MAZE_OX, OY = MAZE_OY, CS = MAZE_CS;
    const { cells, height, width, hazards, goal, playerPos } = maze;

    this.mazeGraphics.clear();

    // Walls
    this.mazeGraphics.lineStyle(3, 0x8888cc);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const x = OX + c * CS;
        const y = OY + r * CS;
        const w = cells[r][c].walls;
        if (w.n) this.mazeGraphics.lineBetween(x, y, x + CS, y);
        if (w.s) this.mazeGraphics.lineBetween(x, y + CS, x + CS, y + CS);
        if (w.w) this.mazeGraphics.lineBetween(x, y, x, y + CS);
        if (w.e) this.mazeGraphics.lineBetween(x + CS, y, x + CS, y + CS);
      }
    }

    // Goal – filled green square
    this.mazeGraphics.fillStyle(0x22aa55);
    this.mazeGraphics.fillRect(
      OX + goal.col * CS + 14, OY + goal.row * CS + 14, CS - 28, CS - 28
    );

    // Start marker – small dim circle at (0,0)
    this.mazeGraphics.fillStyle(0xffffff, 0.35);
    this.mazeGraphics.fillCircle(OX + CS / 2, OY + CS / 2, 10);

    // Player – filled blue circle
    this.mazeGraphics.fillStyle(0x4488ff);
    this.mazeGraphics.fillCircle(
      OX + playerPos.col * CS + CS / 2,
      OY + playerPos.row * CS + CS / 2,
      24
    );
  }

  updateRoles(players, roles) {
    const lines = players.map(p => {
      const role = roles[p.id] || '?';
      const tag = role === 'mover' ? '[mover]' : '[guide]';
      const color = role === 'mover' ? '' : '';  // text is uniform; colour is via prefix
      return `${tag} ${p.name}`;
    });
    this.rolesText.setText(lines.join('\n'));
  }

  updateLog(log) {
    const RESULT_ICON = { ok: '\u2713', wall: '\u25a0', hazard: '!', goal: '*', invalid: '?' };
    const recent = [...log].reverse().slice(0, 16);
    const lines = recent.map(entry => {
      if (entry.event === 'game_start') return '> Game started';
      if (entry.event === 'game_end')   return `* ${entry.player} reached the goal!`;
      if (entry.event === 'move') {
        const icon = RESULT_ICON[entry.result] || '?';
        return `${icon} ${entry.player} -> ${entry.dir.toUpperCase()} (${entry.result})`;
      }
      return JSON.stringify(entry);
    });
    this.logText.setText(lines.join('\n'));
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

// ── Phaser game ───────────────────────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a2e',
  scene: [SetupScene, LobbyScene, GameScene],
  parent: document.body,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
