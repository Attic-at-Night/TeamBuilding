let socket = null;
let myPlayerId = null;

function connectControllerSocket(sessionId, name, game) {
  if (socket) {
    socket.close();
  }

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

function formatEvent(entry) {
  if (!entry) {
    return '';
  }

  if (entry.event === 'game_start') {
    return 'Session started';
  }
  if (entry.event === 'move') {
    return `Move ${entry.dir.toUpperCase()} (${entry.result})`;
  }
  if (entry.event === 'key_pickup') {
    return `Key picked up at ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  if (entry.event === 'life_pickup') {
    return `Life picked up at ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  if (entry.event === 'hazard_hit') {
    return `Hazard hit at ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  if (entry.event === 'reset') {
    return 'Maze reset';
  }
  if (entry.event === 'game_end') {
    return `Game ${entry.outcome}`;
  }

  return entry.event.replace(/_/g, ' ');
}

class JoinScene extends Phaser.Scene {
  constructor() {
    super({ key: 'JoinScene' });
  }

  init() {
    const params = new URLSearchParams(window.location.search);
    this.sessionId = (params.get('session') || '').toUpperCase();
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 80, 'Join Session', {
      fontSize: '36px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(width / 2, 140, `Code: ${this.sessionId || 'Missing'}`, {
      fontSize: '22px',
      color: '#ffff88',
    }).setOrigin(0.5);

    this.nameEl = this.add.dom(width / 2, height / 2 - 30).createFromHTML(
      '<input id="name-input" type="text" maxlength="30" placeholder="Your name"' +
      ' style="font-size:20px;padding:12px;width:260px;border-radius:8px;border:none;' +
      'text-align:center;outline:none;" />'
    );

    const joinBg = this.add.rectangle(width / 2, height / 2 + 70, 220, 62, 0x3355ff)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height / 2 + 70, 'Join', {
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.statusText = this.add.text(width / 2, height / 2 + 150, '', {
      fontSize: '18px',
      color: '#ff5555',
      wordWrap: { width: width - 40 },
    }).setOrigin(0.5);

    joinBg.on('pointerover', () => joinBg.setFillStyle(0x5577ff));
    joinBg.on('pointerout', () => joinBg.setFillStyle(0x3355ff));
    joinBg.on('pointerup', () => this.doJoin(joinBg));
  }

  doJoin(btn) {
    if (!this.sessionId) {
      this.statusText.setText('Invalid join link – missing session code.');
      return;
    }

    const name = (this.nameEl.getChildByID('name-input').value || '').trim() || 'Player';
    btn.disableInteractive();
    this.statusText.setText('Connecting…');
    connectControllerSocket(this.sessionId, name, this.game);

    this.game.events.on('ws_message', this.onMessage, this);
    this.joinBtn = btn;
  }

  onMessage(message) {
    if (message.type === 'client_registered') {
      myPlayerId = message.playerId || null;
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('WaitScene');
      return;
    }

    if (message.type === 'join_error') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.statusText.setText(message.message || 'Unable to join session.');
      if (this.joinBtn) {
        this.joinBtn.setInteractive({ useHandCursor: true });
      }
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

class WaitScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WaitScene' });
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2 - 60, 'Joined!', {
      fontSize: '40px',
      color: '#22ee66',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 + 10, 'Waiting for the match to start…', {
      fontSize: '20px',
      color: '#888888',
    }).setOrigin(0.5);

    this.dots = 0;
    this.dotText = this.add.text(width / 2, height / 2 + 52, '', {
      fontSize: '28px',
      color: '#444444',
    }).setOrigin(0.5);

    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        this.dots = (this.dots + 1) % 4;
        this.dotText.setText('•'.repeat(this.dots));
      },
    });

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);

    sendWs({ type: 'resync_request' });
  }

  onMessage(message) {
    if (message.type === 'state_sync' && message.state.status === 'playing') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.game.events.off('ws_close', this.onClose, this);
      this.scene.start('ControllerScene', { initialState: message.state });
      return;
    }

    if (message.type === 'session_closed') {
      this.onClose();
    }
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

class ControllerScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ControllerScene' });
  }

  init(data) {
    this.currentState = data.initialState || null;
    this.viewerRole = this.currentState ? (this.currentState.viewerRole || null) : null;
    this._shownEnd = false;
    this.roleUi = [];
  }

  create() {
    const { width, height } = this.scale;
    this.add.text(width / 2, 28, 'Game', {
      fontSize: '28px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.mazeGraphics = this.add.graphics();
    this.detailText = this.add.text(18, 70, '', {
      fontSize: '15px',
      color: '#dddddd',
      wordWrap: { width: width - 36 },
      lineSpacing: 2,
    });
    this.eventsText = this.add.text(18, height - 170, '', {
      fontSize: '13px',
      color: '#aaaaaa',
      wordWrap: { width: width - 36 },
      lineSpacing: 2,
    });

    this._buildRoleUi(this.viewerRole);
    if (this.currentState) {
      this._renderState(this.currentState);
    }

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);

    sendWs({ type: 'resync_request' });
  }

  _clearRoleUi() {
    for (const item of this.roleUi) {
      item.destroy();
    }
    this.roleUi = [];
    if (this.mazeGraphics) {
      this.mazeGraphics.clear();
    }
  }

  _setupBoard(role) {
    const width = this.scale.width;
    const height = this.scale.height;
    const topY = 120;
    const bottomReserve = role === 'mover' ? 236 : 156;
    const availableWidth = width - 24;
    const availableHeight = Math.max(180, height - topY - bottomReserve);
    this.mazeCS = Math.max(15, Math.floor(Math.min(availableWidth / 14, availableHeight / 14)));
    const boardSize = this.mazeCS * 14;
    this.mazeOX = Math.floor((width - boardSize) / 2);
    this.mazeOY = topY;
  }

  _syncTextLayout(role) {
    const width = this.scale.width;
    const height = this.scale.height;

    this.detailText.setPosition(18, 56);
    this.detailText.setWordWrapWidth(width - 36);

    if (role === 'mover') {
      this.eventsText.setPosition(18, this.mazeOY + this.mazeCS * 14 + 12);
    } else {
      this.eventsText.setPosition(18, height - 112);
    }
    this.eventsText.setWordWrapWidth(width - 36);
  }

  _drawBlankBoard() {
    const OX = this.mazeOX;
    const OY = this.mazeOY;
    const CS = this.mazeCS;
    const size = CS * 14;

    this.mazeGraphics.clear();
    this.mazeGraphics.lineStyle(2, 0x555588, 0.5);
    this.mazeGraphics.strokeRect(OX, OY, size, size);
  }

  _drawMarkerSquare(row, col, color, alpha = 1) {
    const CS = this.mazeCS;
    this.mazeGraphics.fillStyle(color, alpha);
    this.mazeGraphics.fillRect(
      this.mazeOX + col * CS + 8,
      this.mazeOY + row * CS + 8,
      CS - 16,
      CS - 16
    );
  }

  _drawMarkerCircle(row, col, color, radiusScale = 0.28) {
    const CS = this.mazeCS;
    this.mazeGraphics.fillStyle(color);
    this.mazeGraphics.fillCircle(
      this.mazeOX + col * CS + CS / 2,
      this.mazeOY + row * CS + CS / 2,
      Math.max(7, Math.floor(CS * radiusScale))
    );
  }

  _buildRoleUi(role) {
    this._clearRoleUi();

    const { width, height } = this.scale;
    const baseY = height - 110;
    const buttons = [];

    if (role === 'mover') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      buttons.push(
        { label: '↑', dir: 'n', x: width / 2, y: baseY - 78 },
        { label: '↓', dir: 's', x: width / 2, y: baseY + 18 },
        { label: '←', dir: 'w', x: width / 2 - 100, y: baseY - 30 },
        { label: '→', dir: 'e', x: width / 2 + 100, y: baseY - 30 }
      );
      this.detailText.setText('Navigate the maze. Pick up keys, avoid hazards, and reach the exit once it unlocks.');
    } else if (role === 'guide') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText('Hazards, the ball, and the exit.');
    } else if (role === 'key-seer') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText('Keys and the ball.');
    } else if (role === 'life-keeper') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText('Lives and the ball.');
    } else {
      this._syncTextLayout(role);
      this.detailText.setText('Waiting for your view to load.');
    }

    for (const item of buttons) {
      const bg = this.add.rectangle(item.x, item.y, 96, 64, 0x3355ff)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(item.x, item.y, item.label, {
        fontSize: '34px',
        color: '#ffffff',
      }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        bg.setFillStyle(0x5577ff);
        sendWs({ type: 'player_input', input: { action: 'move', dir: item.dir } });
      });
      bg.on('pointerup', () => bg.setFillStyle(0x3355ff));
      bg.on('pointerout', () => bg.setFillStyle(0x3355ff));

      this.roleUi.push(bg, label);
    }
  }

  _drawMoverMaze(maze) {
    const OX = this.mazeOX;
    const OY = this.mazeOY;
    const CS = this.mazeCS;

    this.mazeGraphics.clear();
    this.mazeGraphics.lineStyle(2, 0x8888cc);

    for (let r = 0; r < maze.height; r++) {
      for (let c = 0; c < maze.width; c++) {
        const x = OX + c * CS;
        const y = OY + r * CS;
        const walls = maze.cells[r][c].walls;
        if (walls.n) this.mazeGraphics.lineBetween(x, y, x + CS, y);
        if (walls.s) this.mazeGraphics.lineBetween(x, y + CS, x + CS, y + CS);
        if (walls.w) this.mazeGraphics.lineBetween(x, y, x, y + CS);
        if (walls.e) this.mazeGraphics.lineBetween(x + CS, y, x + CS, y + CS);
      }
    }

    this.mazeGraphics.fillStyle(0x22aa55);
    this.mazeGraphics.fillRect(
      OX + maze.goal.col * CS + 14,
      OY + maze.goal.row * CS + 14,
      CS - 28,
      CS - 28
    );

    this.mazeGraphics.fillStyle(0x4488ff);
    this.mazeGraphics.fillCircle(
      OX + maze.playerPos.col * CS + CS / 2,
      OY + maze.playerPos.row * CS + CS / 2,
      Math.max(7, Math.floor(CS * 0.28))
    );

    for (const pickup of maze.lifePickups || []) {
      if (pickup.collected) {
        continue;
      }
      this.mazeGraphics.fillStyle(0xff6699);
      this.mazeGraphics.fillCircle(
        OX + pickup.col * CS + CS / 2,
        OY + pickup.row * CS + CS / 2,
        Math.max(6, Math.floor(CS * 0.22))
      );
    }
  }

  _drawGuideBoard(roleData) {
    this._drawBlankBoard();

    const hazards = roleData.hazards || [];
    for (const hazard of hazards) {
      const cx = this.mazeOX + hazard.col * this.mazeCS + this.mazeCS / 2;
      const cy = this.mazeOY + hazard.row * this.mazeCS + this.mazeCS / 2;
      const r = Math.max(8, Math.floor(this.mazeCS * 0.28));
      this.mazeGraphics.lineStyle(3, 0xff3333);
      this.mazeGraphics.lineBetween(cx - r, cy - r, cx + r, cy + r);
      this.mazeGraphics.lineBetween(cx + r, cy - r, cx - r, cy + r);
    }

    if (roleData.goal) {
      this._drawMarkerSquare(roleData.goal.row, roleData.goal.col, 0x22aa55);
    }

    if (roleData.playerPos) {
      this._drawMarkerCircle(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }
  }

  _drawKeyBoard(roleData) {
    this._drawBlankBoard();

    const keys = roleData.keys || [];
    this.mazeGraphics.lineStyle(2, 0xffcc33);
    for (const key of keys) {
      if (key.collected) {
        continue;
      }
      const cx = this.mazeOX + key.col * this.mazeCS + this.mazeCS / 2;
      const cy = this.mazeOY + key.row * this.mazeCS + this.mazeCS / 2;
      this.mazeGraphics.fillStyle(0xffcc33);
      this.mazeGraphics.fillCircle(cx, cy, Math.max(6, Math.floor(this.mazeCS * 0.2)));
    }

    if (roleData.playerPos) {
      this._drawMarkerCircle(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }
  }

  _drawLifeBoard(roleData) {
    this._drawBlankBoard();
    if (roleData.playerPos) {
      this._drawMarkerCircle(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }
  }

  _renderState(state) {
    const roleData = state.roleData || {};
    const summary = state.summary || {};

    if (this.viewerRole === 'mover' && roleData.maze) {
      this._drawMoverMaze(roleData.maze);
    } else if (this.viewerRole === 'guide') {
      this._drawGuideBoard(roleData);
    } else if (this.viewerRole === 'key-seer') {
      this._drawKeyBoard(roleData);
    } else if (this.viewerRole === 'life-keeper') {
      this._drawLifeBoard(roleData);
    } else if (this.mazeGraphics) {
      this.mazeGraphics.clear();
    }

    if (this.viewerRole === 'mover') {
      this.detailText.setText(`Keys: ${summary.keysCollected || 0}/3`);
    } else if (this.viewerRole === 'guide') {
      const hazards = roleData.hazards || [];
      this.detailText.setText(`Hazards tracked: ${hazards.length}`);
    } else if (this.viewerRole === 'key-seer') {
      const keys = roleData.keys || [];
      const visibleKeys = keys.filter((key) => !key.collected);
      this.detailText.setText(`Objective markers: ${visibleKeys.length}`);
    } else if (this.viewerRole === 'life-keeper') {
      const hazardLog = roleData.hazardLog || [];
      this.detailText.setText(`Lives remaining: ${roleData.livesRemaining ?? 0}   Hazard hits: ${hazardLog.length}`);
    }

    const recentEvents = (roleData.recentEvents || []).slice(-4).reverse();
    this.eventsText.setText(recentEvents.length
      ? recentEvents.map(formatEvent).join('\n')
      : 'No recent updates.');

    if (state.status === 'ended' && !this._shownEnd) {
      this._shownEnd = true;
      this._showEnd(state);
    }
  }

  _showEnd(state) {
    const { width, height } = this.scale;
    const summary = state.summary || {};
    this.add.rectangle(width / 2, height / 2, width - 40, 210, 0x000000, 0.9).setDepth(10);
    this.add.text(width / 2, height / 2 - 56, summary.outcome === 'success' ? 'Complete' : 'Failed', {
      fontSize: '34px',
      color: summary.outcome === 'success' ? '#22ee66' : '#ff6666',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(width / 2, height / 2 - 6, `Keys collected: ${summary.keysCollected || 0}`, {
      fontSize: '20px',
      color: '#ffff88',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(width / 2, height / 2 + 28, `Lives lost: ${summary.livesLost || 0}   Resets: ${summary.resets || 0}`, {
      fontSize: '18px',
      color: '#dddddd',
    }).setOrigin(0.5).setDepth(11);
    this.add.text(width / 2, height / 2 + 62, 'Hold for the debrief.', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5).setDepth(11);
  }

  onMessage(message) {
    if (message.type === 'state_sync') {
      if (!this.viewerRole && message.state.viewerRole) {
        this.scene.restart({ initialState: message.state });
        return;
      }

      if (message.state.viewerRole && message.state.viewerRole !== this.viewerRole) {
        this.scene.restart({ initialState: message.state });
        return;
      }

      this.currentState = message.state;
      this._renderState(message.state);
    }

    if (message.type === 'session_closed') {
      this.onClose();
    }
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
