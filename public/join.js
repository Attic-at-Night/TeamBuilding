// WebSocket connection shared across all controller scenes via the game event bus.
let socket = null;

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
      this.scene.start('ControllerScene');
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
// Template controller: one large BUZZ button.
// Replace or extend with directional pads, sliders, etc. for real minigames.

class ControllerScene extends Phaser.Scene {
  constructor() { super({ key: 'ControllerScene' }); }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 70, 'Game in Progress', {
      fontSize: '28px', color: '#ffffff',
    }).setOrigin(0.5);

    // ── Template: buzz button ────────────────────────────────────────────────
    const buzzBg = this.add.rectangle(width / 2, height / 2, width * 0.8, height * 0.35, 0xcc2222)
      .setInteractive({ useHandCursor: true });
    const buzzLabel = this.add.text(width / 2, height / 2, '\uD83D\uDD14 BUZZ!', {
      fontSize: '42px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);

    buzzBg.on('pointerover', () => buzzBg.setFillStyle(0xee3333));
    buzzBg.on('pointerout', () => buzzBg.setFillStyle(0xcc2222));
    buzzBg.on('pointerdown', () => {
      buzzBg.setFillStyle(0xff8800);
      buzzLabel.setScale(0.9);
      sendWs({ type: 'player_input', input: { action: 'buzz' } });
    });
    buzzBg.on('pointerup', () => {
      buzzBg.setFillStyle(0xcc2222);
      buzzLabel.setScale(1);
    });
    // ── End template ─────────────────────────────────────────────────────────

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);
  }

  onMessage(message) {
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
