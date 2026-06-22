// WebSocket connection shared across all controller scenes via the game event bus.
let socket = null;

// Player identity – set when client_registered is received; read by all scenes.
let myPlayerId = null;

function connectControllerSocket(sessionId, name, game) {
  if (socket) socket.close();
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'controller_join', sessionId, name }));
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

// ── JoinScene ─────────────────────────────────────────────────────────────────
// Name entry form. On submit, opens a WebSocket and registers as a controller.
// Transitions to WaitScene on a successful client_registered response.

class JoinScene extends Phaser.Scene {
  constructor() { super({ key: 'JoinScene' }); }

  init() {
    const params = new URLSearchParams(window.location.search);
    this.sessionId = (params.get('session') || '').toUpperCase();
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 80, 'Join Session', {
      fontSize: '36px', color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(width / 2, 140, `Code: ${this.sessionId || 'Missing'}`, {
      fontSize: '22px', color: '#ffff88',
    }).setOrigin(0.5);

    // Name input via embedded HTML element
    this.nameEl = this.add.dom(width / 2, height / 2 - 30).createFromHTML(
      '<input id="name-input" type="text" maxlength="30" placeholder="Your name"' +
      ' style="font-size:20px;padding:12px;width:260px;border-radius:8px;border:none;' +
      'text-align:center;outline:none;" />'
    );

    const joinBg = this.add.rectangle(width / 2, height / 2 + 70, 220, 62, 0x3355ff)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height / 2 + 70, 'Join', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5);

    this.statusText = this.add.text(width / 2, height / 2 + 150, '', {
      fontSize: '18px', color: '#ff5555', wordWrap: { width: width - 40 },
    }).setOrigin(0.5);

    joinBg.on('pointerover', () => joinBg.setFillStyle(0x5577ff));
    joinBg.on('pointerout', () => joinBg.setFillStyle(0x3355ff));
    joinBg.on('pointerup', () => this.doJoin(joinBg));
  }

  doJoin(btn) {
    if (!this.sessionId) {
      this.statusText.setText('Invalid join link \u2013 missing session code.');
      return;
    }
    const name = (this.nameEl.getChildByID('name-input').value || '').trim() || 'Player';
    btn.disableInteractive();
    this.statusText.setText('Connecting\u2026');
    connectControllerSocket(this.sessionId, name, this.game);

    this.game.events.on('ws_message', this.onMessage, this);
    this.joinBtn = btn;
  }

  onMessage(message) {
    if (message.type === 'client_registered') {
      myPlayerId = message.playerId || null;
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('WaitScene');
    } else if (message.type === 'join_error') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.statusText.setText(message.message || 'Unable to join session.');
      if (this.joinBtn) this.joinBtn.setInteractive({ useHandCursor: true });
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

// ── WaitScene ─────────────────────────────────────────────────────────────────
// Shown after successfully joining but before the game starts.
// Transitions to ControllerScene when the server broadcasts status === 'playing'.

class WaitScene extends Phaser.Scene {
  constructor() { super({ key: 'WaitScene' }); }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2 - 60, 'Joined!', {
      fontSize: '40px', color: '#22ee66', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 + 10, 'Waiting for game to start\u2026', {
      fontSize: '20px', color: '#888888',
    }).setOrigin(0.5);

    this.dots = 0;
    this.dotText = this.add.text(width / 2, height / 2 + 52, '', {
      fontSize: '28px', color: '#444444',
    }).setOrigin(0.5);

    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        this.dots = (this.dots + 1) % 4;
        this.dotText.setText('\u2022'.repeat(this.dots));
      },
    });

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);

    // Request current state in case state_sync arrived before this scene was ready
    sendWs({ type: 'resync_request' });
  }

  onMessage(message) {
    if (message.type === 'state_sync' && message.state.status === 'playing') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.game.events.off('ws_close', this.onClose, this);
      this.scene.start('ControllerScene', { initialState: message.state });
    }
    if (message.type === 'session_closed') this.onClose();
  }

  onClose() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
    this.scene.start('JoinScene');
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
  }
}

// ── ControllerScene ───────────────────────────────────────────────────────────
// Role-based controller UI for the maze game.
//
// Mover  – directional pad (N/E/S/W) + small maze view (no hazard markers).
//          Communicates with guides to navigate safely.
//
// Guide  – full maze view with hazard (×) and goal markers.
//          Cannot send movement inputs; guides the mover verbally.
//
// The full state (including hazards) is received by all clients.
// Each client intentionally renders only the information its role should see.

class ControllerScene extends Phaser.Scene {
  constructor() { super({ key: 'ControllerScene' }); }

  init(data) {
    this.currentState = data.initialState || null;
    this.myRole = this.currentState ? (this.currentState.roles?.[myPlayerId] || null) : null;
    this._shownEnd = false;
  }

  create() {
    const { width, height } = this.scale;

    // Role banner
    const roleLabel = this.myRole === 'mover' ? 'Mover' : (this.myRole === 'guide' ? 'Guide' : 'Connecting...');
    const roleColor = this.myRole === 'mover' ? '#4488ff' : '#ff8844';
    this.add.text(width / 2, 36, roleLabel, {
      fontSize: '28px', color: roleColor, fontStyle: 'bold',
    }).setOrigin(0.5);

    // Maze graphics layer
    this.mazeGraphics = this.add.graphics();

    if (this.myRole === 'mover') {
      this._buildMoverUI();
    } else if (this.myRole === 'guide') {
      this._buildGuideUI();
    }
    // If role is unknown (edge case: reconnect before state arrives), a resync
    // will trigger onMessage which restarts this scene with the correct state.

    if (this.currentState) {
      this._renderState(this.currentState);
    }

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);

    sendWs({ type: 'resync_request' });
  }

  // ── Mover UI: small maze (no hazards) + d-pad ─────────────────────────────

  _buildMoverUI() {
    const { width } = this.scale;

    // Small maze: 7 × 7 cells at 40 px each
    this.mazeOX = Math.floor((width - 7 * 40) / 2);
    this.mazeOY = 80;
    this.mazeCS = 40;

    // Position readout
    this.posText = this.add.text(width / 2, 80 + 7 * 40 + 14, '', {
      fontSize: '14px', color: '#666666',
    }).setOrigin(0.5);

    // D-pad: four buttons in a cross
    const cx = width / 2;
    const cy = 650;
    const bw = 110, bh = 80;
    const gap = 8;

    const dpad = [
      { label: '\u2191', dir: 'n', x: cx,       y: cy - bh - gap },
      { label: '\u2193', dir: 's', x: cx,       y: cy + bh + gap },
      { label: '\u2190', dir: 'w', x: cx - bw - gap, y: cy },
      { label: '\u2192', dir: 'e', x: cx + bw + gap, y: cy },
    ];

    for (const { label, dir, x, y } of dpad) {
      const btn = this.add.rectangle(x, y, bw, bh, 0x3355ff)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, y, label, { fontSize: '38px', color: '#ffffff' }).setOrigin(0.5);

      btn.on('pointerdown', () => {
        btn.setFillStyle(0x5577ff);
        sendWs({ type: 'player_input', input: { action: 'move', dir } });
      });
      btn.on('pointerup',  () => btn.setFillStyle(0x3355ff));
      btn.on('pointerout', () => btn.setFillStyle(0x3355ff));
    }
  }

  // ── Guide UI: full maze with hazards ──────────────────────────────────────

  _buildGuideUI() {
    const { width } = this.scale;

    // Larger maze: 7 × 7 cells at 48 px each
    this.mazeOX = Math.floor((width - 7 * 48) / 2);
    this.mazeOY = 88;
    this.mazeCS = 48;

    this.add.text(width / 2, 88 + 7 * 48 + 18, 'Guide the mover \u2013 you see the hazards', {
      fontSize: '14px', color: '#888888', wordWrap: { width: width - 40 },
    }).setOrigin(0.5);
  }

  // ── Shared maze renderer ──────────────────────────────────────────────────

  _drawMaze(maze, showHazards) {
    const OX = this.mazeOX, OY = this.mazeOY, CS = this.mazeCS;
    const { cells, height, width, hazards, goal, playerPos } = maze;

    this.mazeGraphics.clear();

    // Walls
    this.mazeGraphics.lineStyle(2, 0x8888cc);
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

    // Hazards – red cross (guides only)
    if (showHazards) {
      this.mazeGraphics.lineStyle(3, 0xff3333);
      for (const h of hazards) {
        const cx = OX + h.col * CS + CS / 2;
        const cy = OY + h.row * CS + CS / 2;
        const r = Math.max(8, Math.floor(CS * 0.28));
        this.mazeGraphics.lineBetween(cx - r, cy - r, cx + r, cy + r);
        this.mazeGraphics.lineBetween(cx + r, cy - r, cx - r, cy + r);
      }
    }

    // Goal – green square
    const gpad = Math.max(4, Math.floor(CS * 0.18));
    this.mazeGraphics.fillStyle(0x22aa55);
    this.mazeGraphics.fillRect(
      OX + goal.col * CS + gpad, OY + goal.row * CS + gpad,
      CS - gpad * 2, CS - gpad * 2
    );

    // Player – blue circle
    this.mazeGraphics.fillStyle(0x4488ff);
    this.mazeGraphics.fillCircle(
      OX + playerPos.col * CS + CS / 2,
      OY + playerPos.row * CS + CS / 2,
      Math.max(6, Math.floor(CS * 0.28))
    );
  }

  _renderState(state) {
    if (!state.maze || this.mazeOX === undefined) return;

    const isGuide = this.myRole === 'guide';
    this._drawMaze(state.maze, isGuide);

    if (this.posText) {
      const { row, col } = state.maze.playerPos;
      this.posText.setText(`Position: row ${row + 1}, col ${col + 1}`);
    }

    if (state.status === 'ended' && !this._shownEnd) {
      this._shownEnd = true;
      this._showEnd(state.maze);
    }
  }

  _showEnd(maze) {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width - 40, 210, 0x000000, 0.92).setDepth(10);
    this.add.text(width / 2, height / 2 - 44, 'Goal reached!', {
      fontSize: '34px', color: '#22ee66', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(width / 2, height / 2 + 14, `Hazards hit: ${maze.hitHazards}`, {
      fontSize: '22px', color: '#ffff88',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(width / 2, height / 2 + 54, 'Wait for the debrief', {
      fontSize: '16px', color: '#888888',
    }).setOrigin(0.5).setDepth(11);
  }

  onMessage(message) {
    if (message.type === 'state_sync') {
      // If role was not yet known (reconnect edge case), restart to build correct UI.
      if (!this.myRole && myPlayerId && message.state.roles?.[myPlayerId]) {
        this.scene.restart({ initialState: message.state });
        return;
      }
      this.currentState = message.state;
      this._renderState(message.state);
    }
    if (message.type === 'session_closed') this.onClose();
  }

  onClose() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
    this.scene.start('JoinScene');
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
  }
}

// ── Phaser game ───────────────────────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  width: 390,
  height: 844,
  backgroundColor: '#1a1a2e',
  scene: [JoinScene, WaitScene, ControllerScene],
  parent: document.body,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  dom: {
    createContainer: true,
  },
});
