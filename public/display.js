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

    // Load QR code from the base64 data URL returned by the server
    if (this.textures.exists('qr_code')) this.textures.remove('qr_code');
    this.textures.once('addtexture', (key) => {
      if (key === 'qr_code') {
        this.add.image(width / 2, 276, 'qr_code').setDisplaySize(240, 240);
      }
    });
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
      this.scene.start('GameScene', { players: state.players });
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

// ── GameScene ─────────────────────────────────────────────────────────────────
// Template game scene: a bouncing ball as a placeholder visual.
// Player inputs are logged in the top-right corner.
// Replace the ball logic with real game mechanics when building a minigame.

class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  init(data) { this.players = data.players || []; }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 36, 'Game in Progress', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    // ── Template: bouncing ball ──────────────────────────────────────────────
    this.ball = this.add.circle(width / 2, height / 2, 32, 0xff4444);
    this.vx = Phaser.Math.Between(200, 350) * (Math.random() < 0.5 ? 1 : -1);
    this.vy = Phaser.Math.Between(200, 350) * (Math.random() < 0.5 ? 1 : -1);
    // ── End template ─────────────────────────────────────────────────────────

    this.add.text(width - 20, 76, 'Inputs', {
      fontSize: '18px', color: '#ffff88',
    }).setOrigin(1, 0);

    this.logText = this.add.text(width - 20, 104, '', {
      fontSize: '14px', color: '#aaaaaa', align: 'right',
      wordWrap: { width: 380 },
    }).setOrigin(1, 0);
    this.logLines = [];

    this.game.events.on('ws_message', this.onMessage, this);
  }

  update(_time, delta) {
    const { width, height } = this.scale;
    const r = 32;
    const dt = delta / 1000;
    this.ball.x += this.vx * dt;
    this.ball.y += this.vy * dt;
    if (this.ball.x - r < 0 || this.ball.x + r > width) this.vx *= -1;
    if (this.ball.y - r < 80 || this.ball.y + r > height) this.vy *= -1;
  }

  onMessage(message) {
    if (message.type !== 'player_input') return;
    const player = this.players.find(p => p.id === message.playerId);
    const name = player ? player.name : `${message.playerId.slice(0, 6)}\u2026`;
    const time = new Date().toLocaleTimeString();
    this.logLines.unshift(`[${time}] ${name} \u2192 ${JSON.stringify(message.input)}`);
    if (this.logLines.length > 8) this.logLines.pop();
    this.logText.setText(this.logLines.join('\n'));
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
