let socket = null;

function connectDisplaySocket(sessionId, game) {
  if (socket) {
    socket.close();
  }

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

function formatDuration(ms, startedAt, endedAt, now = Date.now()) {
  const value = typeof ms === 'number'
    ? ms
    : (startedAt ? ((endedAt || now) - startedAt) : 0);
  const seconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatLog(entry) {
  if (!entry) {
    return '';
  }

  const time = new Date(entry.ts).toLocaleTimeString();
  if (entry.event === 'game_start') return `${time} • session started`;
  if (entry.event === 'move') return `${time} • move ${entry.dir.toUpperCase()} (${entry.result})`;
  if (entry.event === 'key_pickup') return `${time} • key collected at ${entry.position.row + 1},${entry.position.col + 1}`;
  if (entry.event === 'hazard_hit') return `${time} • hazard hit at ${entry.position.row + 1},${entry.position.col + 1}`;
  if (entry.event === 'reset') return `${time} • maze reset`;
  if (entry.event === 'session_end') return `${time} • session ${entry.outcome}`;
  if (entry.event === 'trainer_broadcast') return `${time} • trainer shared debrief data`;
  if (entry.event === 'input_rejected') return `${time} • input rejected (${entry.reason})`;
  return `${time} • ${entry.event.replace(/_/g, ' ')}`;
}

class SetupScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SetupScene' });
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 120, 'TeamBuilding', {
      fontSize: '56px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(width / 2, 190, 'Display', {
      fontSize: '26px',
      color: '#888888',
    }).setOrigin(0.5);

    const btn = this.add.rectangle(width / 2, height / 2, 260, 72, 0x3355ff)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(width / 2, height / 2, 'Start Session', {
      fontSize: '24px',
      color: '#ffffff',
    }).setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x5577ff));
    btn.on('pointerout', () => btn.setFillStyle(0x3355ff));
    btn.on('pointerup', async () => {
      btn.disableInteractive();
      label.setText('Starting…');
      try {
        const res = await fetch('/api/session', { method: 'POST' });
        const data = await res.json();
        connectDisplaySocket(data.sessionId, this.game);
        this.scene.start('LobbyScene', data);
      } catch {
        label.setText('Error – try again');
        btn.setInteractive({ useHandCursor: true });
      }
    });
  }
}

class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data) {
    this.sessionData = data;
  }

  create() {
    const { width, height } = this.scale;
    const { sessionId, joinUrl, qrCodeDataUrl, connection } = this.sessionData;

    this.add.text(width / 2, 36, 'Scan to Join', {
      fontSize: '30px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(width / 2, 76, `Session: ${sessionId}`, {
      fontSize: '24px',
      color: '#ffff88',
    }).setOrigin(0.5);

    if (this.textures.exists('qr_code')) {
      this.textures.remove('qr_code');
    }

    const onQrAdd = (key) => {
      if (key === 'qr_code') {
        this.textures.off('addtexture', onQrAdd);
        this.add.image(width / 2, 276, 'qr_code').setDisplaySize(240, 240);
      }
    };
    this.textures.on('addtexture', onQrAdd);
    this.textures.addBase64('qr_code', qrCodeDataUrl);

    const urlText = this.add.text(width / 2, 416, joinUrl, {
      fontSize: '14px',
      color: '#6688ff',
      wordWrap: { width: width * 0.55 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    urlText.on('pointerover', () => urlText.setColor('#88aaff'));
    urlText.on('pointerout', () => urlText.setColor('#6688ff'));
    urlText.on('pointerup', () => {
      window.open(joinUrl, '_blank');
    });

    if (connection?.ipAddress) {
      const info = [connection.ipAddress, connection.networkName].filter(Boolean).join(' • ');
      this.add.text(width / 2, 450, info, { fontSize: '13px', color: '#555555' }).setOrigin(0.5);
    }

    const px = width * 0.75;
    this.add.text(px, 36, 'Players', { fontSize: '26px', color: '#ffffff' }).setOrigin(0.5);
    this.playerGroup = this.add.group();
    this.statusText = this.add.text(px, height - 160, 'Waiting for players…', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5);

    this.startBg = this.add.rectangle(px, height - 90, 240, 68, 0x22aa55)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    this.startLabel = this.add.text(px, height - 90, 'Start Game', {
      fontSize: '22px',
      color: '#ffffff',
    }).setOrigin(0.5).setVisible(false);

    this.startBg.on('pointerover', () => this.startBg.setFillStyle(0x44cc77));
    this.startBg.on('pointerout', () => this.startBg.setFillStyle(0x22aa55));
    this.startBg.on('pointerup', () => sendWs({ type: 'game_start' }));

    this.game.events.on('ws_message', this.onMessage, this);
  }

  onMessage(message) {
    if (message.type !== 'state_sync') {
      return;
    }

    const { width } = this.scale;
    const { state } = message;
    const players = state.players || [];
    const summary = state.summary || {};
    const px = width * 0.75;

    this.playerGroup.clear(true, true);
    players.forEach((p, i) => {
      this.playerGroup.add(
        this.add.text(px, 80 + i * 36, `• ${p.name}`, {
          fontSize: '20px',
          color: '#dddddd',
        }).setOrigin(0.5)
      );
    });

    const canStart = state.ready && state.status === 'lobby';
    this.startBg.setVisible(canStart);
    this.startLabel.setVisible(canStart);
    this.statusText.setText(canStart ? 'Ready to start' : 'Waiting for 2–4 players…');

    if (state.status !== 'lobby') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('GameScene', { initialState: state });
    }

    if (summary.outcome) {
      this.statusText.setText(summary.outcome === 'success' ? 'Session complete' : 'Session failed');
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.pendingState = data.initialState || null;
    this.currentState = this.pendingState;
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 28, 'Session Overview', {
      fontSize: '30px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.summaryText = this.add.text(22, 74, '', {
      fontSize: '18px',
      color: '#ffff88',
      lineSpacing: 6,
      wordWrap: { width: width - 44 },
    });

    this.logText = this.add.text(22, 260, '', {
      fontSize: '14px',
      color: '#aaaaaa',
      lineSpacing: 3,
      wordWrap: { width: width - 44 },
    });
    this.trainerText = this.add.text(22, 520, '', {
      fontSize: '14px',
      color: '#88ddff',
      lineSpacing: 3,
      wordWrap: { width: width - 44 },
    });

    this.endOverlay = this.add.rectangle(width / 2, height / 2, width - 60, 190, 0x000000, 0.88)
      .setDepth(10)
      .setVisible(false);
    this.endText = this.add.text(width / 2, height / 2 - 42, '', {
      fontSize: '34px',
      color: '#22ee66',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.endSubText = this.add.text(width / 2, height / 2 + 20, '', {
      fontSize: '18px',
      color: '#dddddd',
    }).setOrigin(0.5).setDepth(11).setVisible(false);

    this.game.events.on('ws_message', this.onMessage, this);

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.currentState && this.currentState.status === 'playing') {
          this.renderState(this.currentState);
        }
      },
    });

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
    this.currentState = state;
    const summary = state.summary || {};
    const lines = [
      `Status: ${state.status}`,
      `Keys collected: ${summary.keysCollected || 0}/3`,
      `Lives remaining: ${summary.livesRemaining || 0}`,
      `Lives lost: ${summary.livesLost || 0}`,
      `Lives picked up: ${summary.livesPickedUp || 0}`,
      `Resets: ${summary.resets || 0}`,
      `Time: ${formatDuration(summary.durationMs, summary.startedAt, summary.endedAt)}`,
      `Outcome: ${summary.outcome || 'in progress'}`,
    ];
    this.summaryText.setText(lines.join('\n'));

    const logLines = (state.log || []).slice(-12).reverse().map(formatLog);
    this.logText.setText(logLines.length ? logLines.join('\n') : 'No logs yet.');
    const trainerPayload = state.trainerBroadcast?.payload;
    if (trainerPayload) {
      this.trainerText.setText(`Trainer data:\n${JSON.stringify(trainerPayload)}`);
    } else {
      this.trainerText.setText('Trainer data: none');
    }

    if (state.status === 'ended') {
      this.endOverlay.setVisible(true);
      this.endText.setText(summary.outcome === 'success' ? 'Complete' : 'Failed').setVisible(true);
      this.endText.setColor(summary.outcome === 'success' ? '#22ee66' : '#ff6666');
      this.endSubText
        .setText(`Keys: ${summary.keysCollected || 0}   Lives lost: ${summary.livesLost || 0}   Lives picked up: ${summary.livesPickedUp || 0}   Resets: ${summary.resets || 0}`)
        .setVisible(true);
    }
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
  }
}

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
