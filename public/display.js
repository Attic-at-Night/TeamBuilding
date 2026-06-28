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

function truncateText(value, maxLength = 120) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function eventTone(entry) {
  if (!entry) {
    return 'info';
  }

  if (entry.event === 'session_end' && entry.outcome === 'success') {
    return 'success';
  }
  if (entry.event === 'key_pickup' || entry.event === 'life_pickup') {
    return 'success';
  }
  if (entry.event === 'reset' || entry.event === 'goal_locked' || entry.event === 'life_change') {
    return 'warning';
  }
  if (entry.event === 'hazard_hit' || entry.event === 'input_rejected') {
    return 'danger';
  }
  if (entry.event === 'session_end' && entry.outcome !== 'success') {
    return 'danger';
  }
  return 'info';
}

function toneStyle(tone) {
  if (tone === 'success') {
    return { border: 0x22aa55, text: '#d6ffe3', detail: '#95e8b5' };
  }
  if (tone === 'warning') {
    return { border: 0xffbb33, text: '#fff0cc', detail: '#f3cb72' };
  }
  if (tone === 'danger') {
    return { border: 0xff6666, text: '#ffdede', detail: '#f1a5a5' };
  }
  return { border: 0x708090, text: '#dde6f2', detail: '#a8b7cc' };
}

function formatTimelineCard(entry) {
  if (!entry) {
    return null;
  }

  const time = new Date(entry.ts || Date.now()).toLocaleTimeString();
  if (entry.event === 'game_start') {
    return { time, summary: 'Session started', detail: null, tone: eventTone(entry) };
  }
  if (entry.event === 'move') {
    const direction = String(entry.dir || '?').toUpperCase();
    return {
      time,
      summary: `Move ${direction} (${entry.result || 'unknown'})`,
      detail: null,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'key_pickup') {
    const pos = entry.position ? `${entry.position.row + 1},${entry.position.col + 1}` : 'unknown';
    return {
      time,
      summary: `Key ${entry.key || '?'} collected`,
      detail: `at cell ${pos}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'life_pickup') {
    const pos = entry.position ? `${entry.position.row + 1},${entry.position.col + 1}` : 'unknown';
    return {
      time,
      summary: 'Life pickup collected',
      detail: `at cell ${pos}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'hazard_hit') {
    const pos = entry.position ? `${entry.position.row + 1},${entry.position.col + 1}` : 'unknown';
    return {
      time,
      summary: `Hazard hit at ${pos}`,
      detail: `Lives remaining: ${entry.livesRemaining ?? '?'}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'reset') {
    return {
      time,
      summary: 'Maze reset',
      detail: entry.reason ? `reason: ${entry.reason}` : null,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'session_end') {
    return {
      time,
      summary: `Session ${entry.outcome || 'ended'}`,
      detail: `keys: ${entry.keys ?? '?'} • lives: ${entry.lives ?? '?'}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'trainer_broadcast') {
    return {
      time,
      summary: 'Trainer shared debrief data',
      detail: entry.sharedEventCount ? `${entry.sharedEventCount} event(s) included` : null,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'input_rejected') {
    return {
      time,
      summary: 'Input rejected',
      detail: entry.reason ? `reason: ${entry.reason}` : null,
      tone: eventTone(entry),
    };
  }

  return {
    time,
    summary: truncateText(entry.event.replace(/_/g, ' '), 80),
    detail: null,
    tone: eventTone(entry),
  };
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
    this.timelineItems = [];
    this.timelineScroll = 0;
    this.timelineContentHeight = 0;
    this.timelineAutoFollow = true;
    this.onWheel = this.onWheel.bind(this);
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

    this.timelineViewport = {
      x: 22,
      y: 246,
      width: width - 44,
      height: height - 286,
    };

    this.add.text(this.timelineViewport.x, this.timelineViewport.y - 28, 'Timeline (scroll for older events)', {
      fontSize: '16px',
      color: '#99bbff',
    });

    this.add.rectangle(
      this.timelineViewport.x + this.timelineViewport.width / 2,
      this.timelineViewport.y + this.timelineViewport.height / 2,
      this.timelineViewport.width,
      this.timelineViewport.height,
      0x101827,
      0.85
    );

    this.timelineContainer = this.add.container(this.timelineViewport.x + 4, this.timelineViewport.y + 4);
    this.timelineMaskShape = this.add.graphics();
    this.timelineMaskShape.fillStyle(0xffffff, 1);
    this.timelineMaskShape.fillRect(
      this.timelineViewport.x,
      this.timelineViewport.y,
      this.timelineViewport.width,
      this.timelineViewport.height
    );
    this.timelineContainer.setMask(this.timelineMaskShape.createGeometryMask());
    this.timelineMaskShape.setVisible(false);

    this.timelineStatusText = this.add.text(this.timelineViewport.x, this.timelineViewport.y + this.timelineViewport.height + 8, '', {
      fontSize: '13px',
      color: '#88ddff',
      wordWrap: { width: this.timelineViewport.width },
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
    this.input.on('wheel', this.onWheel, this);

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

    this.renderTimeline(state.log || []);
    this.updateTimelineStatus(state);

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
    this.input.off('wheel', this.onWheel, this);
  }

  renderTimeline(entries) {
    for (const item of this.timelineItems) {
      item.destroy();
    }
    this.timelineItems = [];

    let y = 0;
    const innerWidth = this.timelineViewport.width - 12;
    for (const entry of entries) {
      const card = formatTimelineCard(entry);
      if (!card) {
        continue;
      }

      const style = toneStyle(card.tone);
      const detailLine = card.detail ? truncateText(card.detail, 110) : null;
      const height = detailLine ? 54 : 36;
      const bg = this.add.rectangle(0, y, innerWidth, height, 0x1a2130, 0.96).setOrigin(0, 0);
      bg.setStrokeStyle(2, style.border, 0.95);
      const summary = this.add.text(10, y + 6, `${card.time}  ${truncateText(card.summary, 90)}`, {
        fontSize: '14px',
        color: style.text,
        wordWrap: { width: innerWidth - 20 },
      });
      this.timelineContainer.add([bg, summary]);
      this.timelineItems.push(bg, summary);

      if (detailLine) {
        const detail = this.add.text(10, y + 28, detailLine, {
          fontSize: '12px',
          color: style.detail,
          wordWrap: { width: innerWidth - 20 },
        });
        this.timelineContainer.add(detail);
        this.timelineItems.push(detail);
      }

      y += height + 8;
    }

    if (!entries.length) {
      const placeholder = this.add.text(8, 8, 'No events yet.', {
        fontSize: '14px',
        color: '#9aa7b8',
      });
      this.timelineContainer.add(placeholder);
      this.timelineItems.push(placeholder);
      y = 28;
    }

    this.timelineContentHeight = y + 8;
    if (this.timelineAutoFollow) {
      this.timelineScroll = this.getTimelineMaxScroll();
    } else {
      this.timelineScroll = Phaser.Math.Clamp(this.timelineScroll, 0, this.getTimelineMaxScroll());
    }
    this.applyTimelineScroll();
  }

  getTimelineMaxScroll() {
    return Math.max(0, this.timelineContentHeight - (this.timelineViewport.height - 8));
  }

  applyTimelineScroll() {
    this.timelineContainer.y = this.timelineViewport.y + 4 - this.timelineScroll;
  }

  onWheel(pointer, _gameObjects, _deltaX, deltaY) {
    const vx = this.timelineViewport.x;
    const vy = this.timelineViewport.y;
    const vw = this.timelineViewport.width;
    const vh = this.timelineViewport.height;
    if (pointer.x < vx || pointer.x > vx + vw || pointer.y < vy || pointer.y > vy + vh) {
      return;
    }

    const step = Math.sign(deltaY) * 28;
    const maxScroll = this.getTimelineMaxScroll();
    this.timelineScroll = Phaser.Math.Clamp(this.timelineScroll + step, 0, maxScroll);
    this.timelineAutoFollow = this.timelineScroll >= Math.max(0, maxScroll - 2);
    this.applyTimelineScroll();
  }

  updateTimelineStatus(state) {
    const maxScroll = this.getTimelineMaxScroll();
    const autoText = this.timelineAutoFollow ? 'ON' : 'OFF (manual scroll)';
    const trainerPayload = state.trainerBroadcast?.payload;
    let trainerLine = 'Trainer data: none';
    if (trainerPayload) {
      if (Array.isArray(trainerPayload.events)) {
        trainerLine = `Trainer data: session export (${trainerPayload.events.length} events)`;
      } else {
        trainerLine = `Trainer data: ${truncateText(JSON.stringify(trainerPayload), 110)}`;
      }
    }
    this.timelineStatusText.setText(
      `Auto-follow: ${autoText} • Scroll ${Math.round(this.timelineScroll)}/${Math.round(maxScroll)}\n${trainerLine}`
    );
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
