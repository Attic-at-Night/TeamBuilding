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

function getTimerRemainingMs(timer, now = Date.now()) {
  if (!timer) {
    return 0;
  }
  if (timer.status === 'running' && typeof timer.expiresAt === 'number') {
    return Math.max(0, timer.expiresAt - now);
  }
  return Math.max(0, timer.remainingMs || 0);
}

function formatTimerValue(timer, now = Date.now()) {
  return formatDuration(getTimerRemainingMs(timer, now));
}

function formatTimerStatus(timer) {
  if (!timer) {
    return 'Timer unavailable';
  }
  if (timer.status === 'running') {
    return 'Running';
  }
  if (timer.status === 'stopped') {
    return 'Paused';
  }
  if (timer.status === 'expired') {
    return 'Expired';
  }
  return 'Ready';
}

function isFollowUpState(state) {
  if (!state) {
    return false;
  }
  return state.status === 'follow_up' || (state.phaseFlow && state.phaseFlow.phaseType === 'follow_up');
}

function getGameplayPhaseLabel(state) {
  const phaseFlow = state && state.phaseFlow ? state.phaseFlow : null;
  if (!phaseFlow || phaseFlow.phaseType !== 'gameplay' || !phaseFlow.currentPhase) {
    return 'Gameplay';
  }
  return `Gameplay phase ${phaseFlow.currentPhase}/${phaseFlow.totalGameplayPhases || 3}`;
}

function truncateText(value, maxLength = 120) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function humanizeClarityType(value) {
  return String(value || 'clarity_event').replace(/_/g, ' ');
}

function eventTone(entry) {
  if (!entry) {
    return 'info';
  }

  if (entry.event === 'session_end' && entry.outcome === 'success') {
    return 'success';
  }
  if (entry.event === 'timer_start') {
    return 'success';
  }
  if (entry.event === 'key_pickup' || entry.event === 'life_pickup') {
    return 'success';
  }
  if (entry.event === 'reset' || entry.event === 'goal_locked' || entry.event === 'life_change' || entry.event === 'timer_stop' || entry.event === 'timer_reset' || entry.event === 'clarity_event') {
    return 'warning';
  }
  if (entry.event === 'hazard_hit' || entry.event === 'ghost_collision' || entry.event === 'input_rejected' || entry.event === 'timer_expired') {
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
      summary: `Hazard hit${entry.hazardType ? ` (${entry.hazardType})` : ''} at ${pos}`,
      detail: `Lives remaining: ${entry.livesRemaining != null ? entry.livesRemaining : '?'}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'ghost_collision') {
    const pos = entry.position ? `${entry.position.row + 1},${entry.position.col + 1}` : 'unknown';
    return {
      time,
      summary: `Ghost collision at ${pos}`,
      detail: `Lives remaining: ${entry.livesRemaining != null ? entry.livesRemaining : '?'}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'ghost_move') {
    return {
      time,
      summary: 'Ghost patrol tick',
      detail: `${(entry.ghostMoves || []).length} ghost(s) moved`,
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
      detail: `keys: ${entry.keys != null ? entry.keys : '?'} • lives: ${entry.lives != null ? entry.lives : '?'}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'timer_start') {
    return {
      time,
      summary: 'Timer started',
      detail: `remaining: ${formatDuration(entry.remainingMs || entry.durationMs || 0)}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'timer_stop') {
    return {
      time,
      summary: 'Timer paused',
      detail: `remaining: ${formatDuration(entry.remainingMs || 0)}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'timer_reset') {
    return {
      time,
      summary: 'Timer reset',
      detail: `duration: ${formatDuration(entry.durationMs || entry.remainingMs || 0)}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'timer_expired') {
    return {
      time,
      summary: 'Timer expired',
      detail: `duration: ${formatDuration(entry.durationMs || 0)}`,
      tone: eventTone(entry),
    };
  }
  if (entry.event === 'clarity_event') {
    return {
      time,
      summary: `Clarity: ${humanizeClarityType(entry.clarityType)}`,
      detail: entry.trainerName ? `trainer: ${entry.trainerName}` : null,
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

function formatTrainerDetailEntry(entry) {
  if (!entry) {
    return null;
  }
  const eventType = entry.event || entry.type || 'event';
  const label = eventType.replace(/_/g, ' ');
  const at = typeof entry.t === 'number'
    ? `t+${entry.t.toFixed(1)}s`
    : new Date(entry.ts || Date.now()).toLocaleTimeString();
  const position = entry.position ? ` @ ${entry.position.row + 1},${entry.position.col + 1}` : '';
  const reason = entry.reason ? ` • ${entry.reason}` : '';
  const result = entry.result ? ` • ${entry.result}` : '';
  return `• ${at}  ${label}${position}${result}${reason}`;
}

function formatTrainerBroadcastDetails(payload) {
  if (!payload) {
    return 'Trainer curation required before event timeline is shown.';
  }

  if (payload.type === 'highlight_set') {
    const highlights = Array.isArray(payload.highlights) ? payload.highlights.slice(0, 8) : [];
    const lines = highlights.map((entry) => formatTrainerDetailEntry(entry)).filter(Boolean);
    return [
      `Trainer highlights (${payload.highlight_count || highlights.length})`,
      lines.length ? lines.join('\n') : 'No highlighted events.',
    ].join('\n');
  }

  if (payload.type === 'replay_snippet') {
    const replayEvents = Array.isArray(payload.replayEvents) ? payload.replayEvents.slice(0, 8) : [];
    const lines = replayEvents.map((entry) => formatTrainerDetailEntry(entry)).filter(Boolean);
    return [
      `Trainer share: ${payload.event || 'event'} (${payload.windowSeconds || 5}s window)`,
      lines.length ? lines.join('\n') : 'No shared events.',
    ].join('\n');
  }

  if (Array.isArray(payload.events)) {
    const events = payload.events.slice(-8).reverse();
    const lines = events.map((entry) => formatTrainerDetailEntry(entry)).filter(Boolean);
    return [
      `Trainer export (${payload.events.length} events)`,
      lines.length ? lines.join('\n') : 'No exported events.',
    ].join('\n');
  }

  return `Trainer payload\n${truncateText(JSON.stringify(payload), 340)}`;
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
      color: '#dde6f2',
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

    const px = width * 0.75;
    this.add.text(px, 36, 'Players', { fontSize: '26px', color: '#ffffff' }).setOrigin(0.5);
    this.playerGroup = this.add.group();
    this.statusText = this.add.text(px, height - 160, 'Waiting for players…', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5);

    const tx = width * 0.25;
    this.add.text(tx, 36, 'Trainers', { fontSize: '26px', color: '#ffffff' }).setOrigin(0.5);
    this.trainerGroup = this.add.group();
    this.trainerStatusText = this.add.text(tx, height - 160, 'No trainer connected.', {
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
    const trainers = state.trainers || [];
    const summary = state.summary || {};
    const px = width * 0.75;
    const tx = width * 0.25;

    this.playerGroup.clear(true, true);
    players.forEach((p, i) => {
      this.playerGroup.add(
        this.add.text(px, 80 + i * 36, `• ${p.name}`, {
          fontSize: '20px',
          color: '#dddddd',
        }).setOrigin(0.5)
      );
    });

    this.trainerGroup.clear(true, true);
    trainers.forEach((t, i) => {
      this.trainerGroup.add(
        this.add.text(tx, 80 + i * 36, `• ${t.name}`, {
          fontSize: '20px',
          color: '#aaddff',
        }).setOrigin(0.5)
      );
    });
    this.trainerStatusText.setText(trainers.length ? '' : 'No trainer connected.');

    const canStart = state.ready && state.status === 'lobby';
    this.startBg.setVisible(canStart);
    this.startLabel.setVisible(canStart);
    this.statusText.setText(canStart ? 'Ready to start' : 'Waiting for 2–4 players…');

    if (state.status !== 'lobby') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('GameScene', { initialState: state, sessionData: this.sessionData });
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
    this.sessionData = data.sessionData || null;
    this.focusItems = [];
    this.joinPanelItems = [];
  }

  create() {
    const { width, height } = this.scale;

    this.renderJoinPanel();

    this.add.text(width / 2, 28, 'Session Overview', {
      fontSize: '30px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.timerValueText = this.add.text(width / 2, Math.floor(height * 0.28), '5:00', {
      fontSize: '148px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.timerStatusText = this.add.text(width / 2, Math.floor(height * 0.4), 'Ready', {
      fontSize: '34px',
      color: '#99bbff',
    }).setOrigin(0.5);
    this.phaseText = this.add.text(width / 2, Math.floor(height * 0.47), '', {
      fontSize: '24px',
      color: '#b6c7ff',
    }).setOrigin(0.5);

    this.focusViewport = {
      x: 90,
      y: Math.floor(height * 0.52),
      width: width - 180,
      height: Math.floor(height * 0.37),
    };
    this.focusContainer = this.add.container(this.focusViewport.x, this.focusViewport.y);

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
    this.restartButtonBg = this.add.rectangle(width / 2, height / 2 + 72, 220, 56, 0x22aa55)
      .setDepth(11)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.restartButtonLabel = this.add.text(width / 2, height / 2 + 72, 'Restart Game', {
      fontSize: '21px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12).setVisible(false);

    this.restartButtonBg.on('pointerover', () => this.restartButtonBg.setFillStyle(0x44cc77));
    this.restartButtonBg.on('pointerout', () => this.restartButtonBg.setFillStyle(0x22aa55));
    this.restartButtonBg.on('pointerup', () => {
      if (this.restartButtonBg.visible) {
        sendWs({ type: 'game_restart' });
      }
    });
    this.restartButtonBg.disableInteractive();

    this.resetFeedbackOverlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72)
      .setDepth(20)
      .setVisible(false);
    this.resetFeedbackIcon = this.add.text(width / 2, height / 2 - 80, '', {
      fontSize: '72px',
    }).setOrigin(0.5).setDepth(21).setVisible(false);
    this.resetFeedbackTitle = this.add.text(width / 2, height / 2 + 20, '', {
      fontSize: '36px',
      color: '#ff6666',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21).setVisible(false);
    this.resetFeedbackCountdown = this.add.text(width / 2, height / 2 + 76, '', {
      fontSize: '22px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(21).setVisible(false);
    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_message', this.onMessage, this);

    this.followUpOverlay = this.add.rectangle(width / 2, height / 2, 560, 220, 0x070b1b, 0.95)
      .setDepth(30)
      .setStrokeStyle(2, 0x88aaff, 0.9)
      .setVisible(false);
    this.followUpTitle = this.add.text(width / 2, height / 2 - 36, 'Follow-up phase', {
      fontSize: '40px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.followUpBody = this.add.text(width / 2, height / 2 + 8, 'Gameplay is paused. Team + trainer debrief.', {
      fontSize: '20px',
      color: '#c6d4f3',
      align: 'center',
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    this.followUpEndButtonBg = this.add.rectangle(width / 2, height / 2 + 70, 260, 54, 0x3355ff)
      .setDepth(31)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.followUpEndButtonLabel = this.add.text(width / 2, height / 2 + 70, 'End follow-up', {
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    this.followUpEndButtonBg.on('pointerover', () => this.followUpEndButtonBg.setFillStyle(0x5577ff));
    this.followUpEndButtonBg.on('pointerout', () => this.followUpEndButtonBg.setFillStyle(0x3355ff));
    this.followUpEndButtonBg.on('pointerup', () => {
      if (this.followUpEndButtonBg.visible) {
        sendWs({ type: 'followup_end' });
      }
    });
    this.followUpEndButtonBg.disableInteractive();

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.currentState) {
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
    const isFollowUp = isFollowUpState(state);
    const summary = state.summary || {};
    const timer = state.timer || null;
    const lines = [
      `Status: ${state.status}`,
      `Keys collected: ${summary.keysCollected || 0}/3`,
      `Lives remaining: ${summary.livesRemaining || 0}`,
      `Time: ${formatDuration(summary.durationMs, summary.startedAt, summary.endedAt)}`,
      `Outcome: ${summary.outcome || 'in progress'}`,
    ];
    this.timerValueText.setText(formatTimerValue(timer));
    this.timerStatusText.setText(formatTimerStatus(timer));
    this.timerStatusText.setColor(timer && timer.status === 'expired' ? '#ff8888' : '#99bbff');
    this.phaseText.setText(getGameplayPhaseLabel(state));

    const trainerPayload = state.trainerBroadcast && state.trainerBroadcast.payload;
    this.renderFocusedShare(trainerPayload, state.trainerBroadcast || null);

    if (state.pendingReset) {
      const pr = state.pendingReset;
      const icon = pr.cause === 'wall' ? '🧱' : pr.cause === 'ghost' ? '👻' : '✖';
      const secsLeft = pr.expiresAt
        ? Math.max(0, Math.ceil((pr.expiresAt - Date.now()) / 1000))
        : 5;
      this.resetFeedbackIcon.setText(icon);
      this.resetFeedbackTitle.setText(pr.message || 'Reset!');
      this.resetFeedbackCountdown.setText(`Resetting in ${secsLeft}…`);
      this.resetFeedbackOverlay.setVisible(true);
      this.resetFeedbackIcon.setVisible(true);
      this.resetFeedbackTitle.setVisible(true);
      this.resetFeedbackCountdown.setVisible(true);
    } else {
      this.resetFeedbackOverlay.setVisible(false);
      this.resetFeedbackIcon.setVisible(false);
      this.resetFeedbackTitle.setVisible(false);
      this.resetFeedbackCountdown.setVisible(false);
    }

    if (state.status === 'ended') {
      this.endOverlay.setVisible(true);
      this.endText.setText(summary.outcome === 'success' ? 'Complete' : 'Failed').setVisible(true);
      this.endText.setColor(summary.outcome === 'success' ? '#22ee66' : '#ff6666');
      this.endSubText
        .setText(state.canRestart ? 'Press restart to play again.' : 'Waiting for enough players to restart.')
        .setVisible(true);
      this.restartButtonBg.setVisible(state.canRestart === true);
      this.restartButtonLabel.setVisible(state.canRestart === true);
      if (state.canRestart) {
        this.restartButtonBg.setInteractive({ useHandCursor: true });
      } else {
        this.restartButtonBg.disableInteractive();
      }

    } else {
      this.endOverlay.setVisible(false);
      this.endText.setVisible(false);
      this.endSubText.setVisible(false);
      this.restartButtonBg.setVisible(false);
      this.restartButtonLabel.setVisible(false);
      this.restartButtonBg.disableInteractive();
    }

    const gameplayVisible = !isFollowUp;
    this.timerValueText.setVisible(gameplayVisible);
    this.timerStatusText.setVisible(gameplayVisible);
    this.phaseText.setVisible(gameplayVisible);
    this.focusContainer.setVisible(gameplayVisible);
    this.resetFeedbackOverlay.setVisible(gameplayVisible && Boolean(state.pendingReset));
    this.resetFeedbackIcon.setVisible(gameplayVisible && Boolean(state.pendingReset));
    this.resetFeedbackTitle.setVisible(gameplayVisible && Boolean(state.pendingReset));
    this.resetFeedbackCountdown.setVisible(gameplayVisible && Boolean(state.pendingReset));
    for (const item of this.joinPanelItems) {
      item.setVisible(gameplayVisible);
    }
    if (!gameplayVisible) {
      this.endOverlay.setVisible(false);
      this.endText.setVisible(false);
      this.endSubText.setVisible(false);
      this.restartButtonBg.setVisible(false);
      this.restartButtonLabel.setVisible(false);
      this.restartButtonBg.disableInteractive();
    }

    this.followUpOverlay.setVisible(isFollowUp);
    this.followUpTitle.setVisible(isFollowUp);
    this.followUpBody.setVisible(isFollowUp);
    this.followUpEndButtonBg.setVisible(isFollowUp);
    this.followUpEndButtonLabel.setVisible(isFollowUp);
    if (isFollowUp) {
      this.followUpEndButtonBg.setInteractive({ useHandCursor: true });
    } else {
      this.followUpEndButtonBg.disableInteractive();
    }
  }

  renderJoinPanel() {
    if (!this.sessionData) {
      return;
    }

    const { sessionId, joinUrl } = this.sessionData;
    this.joinPanelItems.forEach((item) => item.destroy());
    this.joinPanelItems = [];

    const panel = this.add.rectangle(128, 98, 236, 186, 0x101827, 0.88).setOrigin(0.5);
    panel.setStrokeStyle(2, 0x708090, 0.8);
    const joinTitle = this.add.text(18, 16, `Join: ${sessionId || ''}`, {
      fontSize: '18px',
      color: '#dde6f2',
      fontStyle: 'bold',
    }).setOrigin(0, 0);
    const joinUrlText = this.add.text(18, 152, String(joinUrl || ''), {
      fontSize: '11px',
      color: '#88aaff',
      wordWrap: { width: 210 },
    }).setOrigin(0, 0);
    this.joinPanelItems.push(panel, joinTitle, joinUrlText);

    if (this.textures.exists('qr_code')) {
      const qr = this.add.image(128, 90, 'qr_code').setDisplaySize(108, 108);
      this.joinPanelItems.push(qr);
      return;
    }

    if (this.sessionData.qrCodeDataUrl) {
      const onQrAdd = (key) => {
        if (key !== 'qr_code') {
          return;
        }
        this.textures.off('addtexture', onQrAdd);
        const qr = this.add.image(128, 90, 'qr_code').setDisplaySize(108, 108);
        this.joinPanelItems.push(qr);
      };
      this.textures.on('addtexture', onQrAdd);
      this.textures.addBase64('qr_code', this.sessionData.qrCodeDataUrl);
    }
  }

  renderFocusedShare(trainerPayload, trainerBroadcast) {
    for (const item of this.focusItems) {
      item.destroy();
    }
    this.focusItems = [];

    const sharedEntry = trainerPayload
      && trainerPayload.type === 'replay_snippet'
      && trainerPayload.event === 'clarity_event'
      && Array.isArray(trainerPayload.replayEvents)
      ? trainerPayload.replayEvents.find((entry) => entry.event === 'clarity_event') || null
      : null;

    const panelBg = this.add.rectangle(
      this.focusViewport.width / 2,
      this.focusViewport.height / 2,
      this.focusViewport.width,
      this.focusViewport.height,
      0x101827,
      0.9
    ).setOrigin(0.5);
    panelBg.setStrokeStyle(3, sharedEntry ? 0xffbb33 : 0x708090, 0.95);
    this.focusContainer.add(panelBg);
    this.focusItems.push(panelBg);

    if (!sharedEntry) {
      const placeholder = this.add.text(this.focusViewport.width / 2, this.focusViewport.height / 2, 'No shared clarity event selected.', {
        fontSize: '34px',
        color: '#9aa7b8',
        align: 'center',
        wordWrap: { width: this.focusViewport.width - 80 },
      }).setOrigin(0.5);
      this.focusContainer.add(placeholder);
      this.focusItems.push(placeholder);
      return;
    }

    const title = this.add.text(40, 34, `Clarity: ${humanizeClarityType(sharedEntry.clarityType)}`, {
      fontSize: '48px',
      color: '#fff0cc',
      fontStyle: 'bold',
      wordWrap: { width: this.focusViewport.width - 80 },
    }).setOrigin(0, 0);
    const time = this.add.text(40, 102, new Date(sharedEntry.ts || Date.now()).toLocaleTimeString(), {
      fontSize: '26px',
      color: '#f3cb72',
    }).setOrigin(0, 0);
    const trainer = this.add.text(40, 146, `trainer: ${(trainerBroadcast && trainerBroadcast.trainerName) || 'Trainer'}`, {
      fontSize: '26px',
      color: '#f3cb72',
    }).setOrigin(0, 0);

    this.focusContainer.add([title, time, trainer]);
    this.focusItems.push(title, time, trainer);
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
