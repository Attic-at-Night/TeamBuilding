let socket = null;
let socketSequence = 0;
let myPlayerId = null;
let pendingReconnectToken = null;
let pendingPlayerName = null;

function storageKey(sessionId) {
  return `teambuilding.reconnect.${sessionId}`;
}

function loadReconnectState(sessionId) {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveReconnectState(sessionId, payload) {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function clearReconnectState(sessionId) {
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    // Ignore storage failures.
  }
}

function getCurrentSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('session') || '').toUpperCase();
}

function trySilentReconnect(game) {
  const sessionId = getCurrentSessionIdFromUrl();
  if (!sessionId) {
    return false;
  }

  const reconnectState = loadReconnectState(sessionId);
  if (!reconnectState || !reconnectState.reconnectToken) {
    return false;
  }

  pendingReconnectToken = reconnectState.reconnectToken;
  pendingPlayerName = reconnectState.name || 'Player';
  connectControllerSocket(sessionId, reconnectState.name || 'Player', game, reconnectState.reconnectToken);
  return true;
}

function connectControllerSocket(sessionId, name, game, reconnectToken = null) {
  if (socket) {
    socket._superseded = true;
    socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const nextSocket = new WebSocket(`${protocol}://${window.location.host}`);
  const sequence = ++socketSequence;
  socket = nextSocket;

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket || sequence !== socketSequence) {
      return;
    }
    nextSocket.send(JSON.stringify({
      type: 'controller_join',
      sessionId,
      name,
      reconnectToken,
      requestedTrainer: Boolean(game.joinAsTrainer && !reconnectToken),
    }));
  });
  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket || sequence !== socketSequence) {
      return;
    }
    try {
      game.events.emit('ws_message', JSON.parse(event.data));
    } catch {
      // Ignore malformed server payloads.
    }
  });
  nextSocket.addEventListener('close', () => {
    if (nextSocket._superseded || sequence !== socketSequence) {
      return;
    }
    if (socket === nextSocket) {
      socket = null;
    }
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

const CLARITY_TYPES = [
  'role_unclear',
  'lack_of_sent_communication',
  'lack_of_received_communication',
  'acted_before_communicating',
  'contradicting_instructions',
  'silent_confusion',
];

function humanizeClarityType(value) {
  return String(value || 'clarity_event').replace(/_/g, ' ');
}

function formatTrainerTimelineTime(entry) {
  if (typeof entry.t === 'number') {
    return `t+${entry.t.toFixed(1)}s`;
  }
  return new Date(entry.ts || Date.now()).toLocaleTimeString();
}

function formatTrainerTimelineEntry(entry) {
  const time = formatTrainerTimelineTime(entry);
  const baseLabel = formatEvent(entry);
  return `${time} • ${baseLabel}`;
}

function summarizeTrainerEvent(entry) {
  if (!entry) {
    return 'No event selected.';
  }
  if (entry.event === 'hazard_hit') {
    return `Hazard type: ${entry.hazardType || 'unknown'}${entry.position ? ` • cell ${entry.position.row + 1},${entry.position.col + 1}` : ''}`;
  }
  if (entry.event === 'ghost_collision') {
    return `Ghost collision${entry.position ? ` • cell ${entry.position.row + 1},${entry.position.col + 1}` : ''}`;
  }
  if (entry.event === 'ghost_move') {
    return `Ghost patrol tick (${(entry.ghostMoves || []).length} moved)`;
  }
  if (entry.event === 'clarity_event') {
    return `Clarity type: ${humanizeClarityType(entry.clarityType)}`;
  }
  if (entry.event === 'timer_start' || entry.event === 'timer_stop' || entry.event === 'timer_reset') {
    return `Timer context: ${formatDuration(entry.remainingMs || entry.durationMs || 0)}`;
  }
  if (entry.event === 'timer_expired') {
    return `Timer duration: ${formatDuration(entry.durationMs || 0)}`;
  }
  if (entry.position) {
    return `Cell ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  return entry.reason ? `Reason: ${entry.reason}` : 'No extra details.';
}

function summarizeTrainerSnapshot(snapshot) {
  if (!snapshot) {
    return 'No snapshot available.';
  }

  const playerPos = snapshot.maze && snapshot.maze.playerPos
    ? `${snapshot.maze.playerPos.row + 1},${snapshot.maze.playerPos.col + 1}`
    : 'unknown';
  const keyCount = snapshot.maze && Array.isArray(snapshot.maze.keys)
    ? snapshot.maze.keys.filter((key) => !key.collected).length
    : 0;
  const hazardCount = snapshot.maze && Array.isArray(snapshot.maze.hazards)
    ? snapshot.maze.hazards.length
    : 0;
  const ghostCount = snapshot.maze && Array.isArray(snapshot.maze.ghosts)
    ? snapshot.maze.ghosts.length
    : 0;

  return [
    `Seed: ${snapshot.mazeMeta && snapshot.mazeMeta.seed ? snapshot.mazeMeta.seed : 'n/a'} • Variant: ${snapshot.mazeMeta && snapshot.mazeMeta.layoutVariant ? snapshot.mazeMeta.layoutVariant : 'default'}`,
    `Pos: ${playerPos} • Hazards: ${hazardCount} • Ghosts: ${ghostCount} • Keys: ${keyCount}`,
  ].join('\n');
}

function summarizeAiSuggestion(suggestion) {
  if (!suggestion) {
    return 'No AI suggestion selected.';
  }
  return `${suggestion.summary}\nStatus: ${suggestion.status}`;
}

function formatTrainerBroadcastSummary(latest) {
  if (!latest) {
    return 'Nothing shared yet';
  }
  if (latest.type === 'highlight_set') {
    return `${latest.highlight_count || 0} highlights shared`;
  }
  if (latest.type === 'replay_snippet') {
    return `Replay shared for ${latest.event || 'event'}`;
  }
  return 'Full session export shared';
}

function buildTrainerDetailText(roleData, summary, timer, selectedClarity, selected, selectedSuggestion, latest) {
  const snapshotSummary = summarizeTrainerSnapshot(selected && selected.snapshot);
  const mazeMeta = roleData.mazeMeta || {};

  return [
    'OVERVIEW',
    `Keys ${summary.keysCollected || 0}/3 • Lives ${summary.livesRemaining || 0} • Resets ${summary.resets || 0}`,
    `Timer ${formatTimerValue(timer)} • ${formatTimerStatus(timer)}`,
    `Maze ${mazeMeta.layoutVariant || 'default'}${mazeMeta.hardMode ? ' • hard mode' : ''}`,
    '',
    'SELECTED EVENT',
    selected ? formatEvent(selected) : 'No event selected',
    summarizeTrainerEvent(selected),
    '',
    'REPLAY',
    formatTrainerBroadcastSummary(latest),
    '',
    'NEW CLARITY EVENT',
    `Type: ${selectedClarity}`,
    snapshotSummary,
  ].join('\n');
}

function getTrainerFeedEvents(roleData) {
  const trainerEvents = roleData.trainerEvents || [];
  return trainerEvents.filter((entry) => entry.event !== 'input');
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
    const hazardType = entry.hazardType ? ` (${entry.hazardType})` : '';
    return `Hazard hit${hazardType} at ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  if (entry.event === 'ghost_collision') {
    return `Ghost collision at ${entry.position.row + 1},${entry.position.col + 1}`;
  }
  if (entry.event === 'ghost_move') {
    return `Ghost patrol (${(entry.ghostMoves || []).length} moved)`;
  }
  if (entry.event === 'reset') {
    return 'Maze reset';
  }
  if (entry.event === 'session_end') {
    return `Session ${entry.outcome}`;
  }
  if (entry.event === 'timer_start') {
    return `Timer started (${formatDuration(entry.remainingMs || entry.durationMs || 0)})`;
  }
  if (entry.event === 'timer_stop') {
    return `Timer paused (${formatDuration(entry.remainingMs || 0)} left)`;
  }
  if (entry.event === 'timer_reset') {
    return `Timer reset (${formatDuration(entry.durationMs || entry.remainingMs || 0)})`;
  }
  if (entry.event === 'timer_expired') {
    return 'Timer expired';
  }
  if (entry.event === 'clarity_event') {
    return `Clarity: ${humanizeClarityType(entry.clarityType)}`;
  }
  if (entry.event === 'trainer_broadcast') {
    return 'Trainer data shared';
  }
  if (entry.event === 'trainer_highlight_toggle') {
    return `${entry.highlighted ? 'Highlighted' : 'Unhighlighted'} ${entry.targetEventId || 'event'}`;
  }
  if (entry.event === 'trainer_highlights_shared') {
    return `Shared ${entry.highlightCount || 0} highlights`;
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
    this.game.joinAsTrainer = false;

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

    this.rejoinBg = this.add.rectangle(width / 2, height / 2 + 146, 220, 52, 0x22aa55)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.rejoinLabel = this.add.text(width / 2, height / 2 + 146, 'Rejoin Session', {
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5).setVisible(false);

    this.statusText = this.add.text(width / 2, height / 2 + 218, '', {
      fontSize: '18px',
      color: '#ff5555',
      wordWrap: { width: width - 40 },
    }).setOrigin(0.5);

    joinBg.on('pointerover', () => joinBg.setFillStyle(0x5577ff));
    joinBg.on('pointerout', () => joinBg.setFillStyle(0x3355ff));
    joinBg.on('pointerup', () => this.doJoin(joinBg));

    this.trainerToggleBg = this.add.rectangle(width / 2, height / 2 + 6, 220, 42, 0x3b4057)
      .setInteractive({ useHandCursor: true });
    this.trainerToggleLabel = this.add.text(width / 2, height / 2 + 6, 'Join as trainer: Off', {
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.trainerToggleBg.on('pointerup', () => {
      this.game.joinAsTrainer = !this.game.joinAsTrainer;
      this.updateTrainerToggle();
    });
    this.rejoinBg.on('pointerover', () => this.rejoinBg.setFillStyle(0x44cc77));
    this.rejoinBg.on('pointerout', () => this.rejoinBg.setFillStyle(0x22aa55));
    this.rejoinBg.on('pointerup', () => {
      const reconnectState = this.sessionId ? loadReconnectState(this.sessionId) : null;
      if (reconnectState && reconnectState.reconnectToken) {
        this.doJoin(joinBg, {
          reconnectToken: reconnectState.reconnectToken,
          name: reconnectState.name || 'Player',
        });
      }
    });

    const reconnectState = this.sessionId ? loadReconnectState(this.sessionId) : null;
    if (reconnectState && reconnectState.reconnectToken) {
      this.rejoinBg.setVisible(true);
      this.rejoinLabel.setVisible(true);
      pendingReconnectToken = reconnectState.reconnectToken;
      pendingPlayerName = reconnectState.name || 'Player';
      this.statusText.setText('Rejoining…');
      this.doJoin(joinBg, {
        reconnectToken: reconnectState.reconnectToken,
        name: reconnectState.name || 'Player',
      });
    }

    this.updateTrainerToggle();
  }

  doJoin(btn, options = {}) {
    if (!this.sessionId) {
      this.statusText.setText('Invalid join link – missing session code.');
      return;
    }

    const name = String(options.name || this.nameEl.getChildByID('name-input').value || '').trim() || 'Player';
    const reconnectToken = options.reconnectToken || null;
    btn.disableInteractive();
    this.statusText.setText(reconnectToken ? 'Rejoining…' : 'Connecting…');
    pendingReconnectToken = reconnectToken;
    pendingPlayerName = name;
    connectControllerSocket(this.sessionId, name, this.game, reconnectToken);

    this.game.events.on('ws_message', this.onMessage, this);
    this.joinBtn = btn;
  }

  onMessage(message) {
    if (message.type === 'client_registered') {
      myPlayerId = message.playerId || null;
      if (message.reconnectToken) {
        saveReconnectState(this.sessionId, {
          playerId: message.playerId || null,
          reconnectToken: message.reconnectToken,
          name: pendingPlayerName || 'Player',
        });
      }
      this.game.events.off('ws_message', this.onMessage, this);
      this.scene.start('WaitScene');
      return;
    }

    if (message.type === 'join_error') {
      this.game.events.off('ws_message', this.onMessage, this);
      if (message.code === 'invalid_reconnect_token' || message.code === 'reconnect_slot_unavailable') {
        clearReconnectState(this.sessionId);
        pendingReconnectToken = null;
        if (this.rejoinBg) {
          this.rejoinBg.setVisible(false);
        }
        if (this.rejoinLabel) {
          this.rejoinLabel.setVisible(false);
        }
      }
      this.statusText.setText(message.message || 'Unable to join session.');
      if (this.joinBtn) {
        this.joinBtn.setInteractive({ useHandCursor: true });
      }
    }
  }

  updateTrainerToggle() {
    const selected = Boolean(this.game.joinAsTrainer);
    this.trainerToggleBg.setFillStyle(selected ? 0x22aa55 : 0x3b4057);
    this.trainerToggleLabel.setText(`Join as trainer: ${selected ? 'On' : 'Off'}`);
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
    if (trySilentReconnect(this.game)) {
      if (this.dotText) {
        this.dotText.setText('Reconnecting…');
      }
      this.time.delayedCall(500, () => {
        sendWs({ type: 'resync_request' });
      });
      return;
    }

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
    this.endUi = [];
    this.roleUi = [];
    this.trainerEventScroll = 0;
    this.trainerSelectedOffset = 0;
    this.trainerSuggestionIndex = 0;
    this.trainerActiveTab = 'maze';
    this.trainerClarityType = CLARITY_TYPES[0];
    this.trainerFeedLineHeight = 22;
    this.trainerFeedHeaderLines = 2;
    this.trainerFeedVisibleCount = 8;
    this.trainerFeedListStartY = 0;
    this.trainerFeedAreaHeight = 0;
    this.trainerFeedVisibleEvents = [];
    this.trainerFeedDragged = false;
    this.trainerFeedLastY = null;
    this.trainerFeedScrollTrack = null;
    this.trainerFeedScrollThumb = null;
    this.lastMoveSentAt = 0;
    this.onWheel = this.onWheel.bind(this);
    this.onVisibilitySync = this.onVisibilitySync.bind(this);
  }

  create() {
    const { width, height } = this.scale;
    this.mazeGraphics = this.add.graphics();
    this.detailText = this.add.text(18, 70, '', {
      fontSize: '13px',
      color: '#dddddd',
      wordWrap: { width: width - 36 },
      lineSpacing: 1,
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
    this.input.on('wheel', this.onWheel, this);
    document.addEventListener('visibilitychange', this.onVisibilitySync);

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.currentState) {
          this._renderState(this.currentState);
        }
      },
    });

    sendWs({ type: 'resync_request' });
  }

  _clearRoleUi() {
    for (const item of this.roleUi) {
      item.destroy();
    }
    this.roleUi = [];
    this.trainerFeedScrollTrack = null;
    this.trainerFeedScrollThumb = null;
    if (this.mazeGraphics) {
      this.mazeGraphics.clear();
    }
  }

  _setupBoard(role) {
    const width = this.scale.width;
    const height = this.scale.height;
    const topY = 120;
    const bottomReserve = role === 'mover' ? 236 : 172;
    const availableWidth = width - 24;
    const availableHeight = Math.max(180, height - topY - bottomReserve);
    this.mazeCS = Math.max(15, Math.floor(Math.min(availableWidth / 14, availableHeight / 14)));
    const boardSize = this.mazeCS * 14;
    this.mazeOX = Math.floor((width - boardSize) / 2);
    this.mazeOY = topY;
  }

  _setupTrainerBoard() {
    const width = this.scale.width;
    const height = this.scale.height;
    const topY = 154;
    const availableWidth = width - 24;
    const bottomReserve = this.trainerActiveTab === 'maze' ? 20 : 336;
    const availableHeight = Math.max(128, height - topY - bottomReserve);
    this.mazeCS = Math.max(10, Math.floor(Math.min(availableWidth / 14, availableHeight / 14)));
    const boardSize = this.mazeCS * 14;
    this.mazeOX = Math.floor((width - boardSize) / 2);
    this.mazeOY = topY;
  }

  _syncTextLayout(role) {
    const width = this.scale.width;
    const height = this.scale.height;

    if (role !== 'trainer' || this.trainerActiveTab === 'maze') {
      this.detailText.setVisible(false);
      this.eventsText.setVisible(false);
      return;
    }

    this.detailText.setVisible(true);
    this.eventsText.setVisible(true);
    this.detailText.setPosition(18, role === 'trainer' ? 160 : 82);
    this.detailText.setWordWrapWidth(width - 36);

    if (role === 'mover') {
      this.eventsText.setPosition(18, this.mazeOY + this.mazeCS * 14 + 12);
    } else if (role === 'trainer') {
      const controlsReserve = 170;
      this.eventsText.setPosition(18, Math.max(344, height - controlsReserve - 250));
    } else {
      this.eventsText.setPosition(18, height - 132);
    }
    this.eventsText.setWordWrapWidth(width - 36);
  }

  _setTrainerTab(tab) {
    if (this.viewerRole !== 'trainer' || this.trainerActiveTab === tab) {
      return;
    }
    this.trainerActiveTab = tab;
    this._buildRoleUi('trainer');
    this._renderState(this.currentState || {});
  }

  _getTrainerSelectedEvent(roleData) {
    const sorted = getTrainerFeedEvents(roleData).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!sorted.length) {
      return null;
    }
    const index = Math.min(sorted.length - 1, this.trainerEventScroll + this.trainerSelectedOffset);
    return sorted[index] || null;
  }

  _scrollTrainerFeed(step) {
    const roleData = (this.currentState && this.currentState.roleData) || {};
    const trainerEvents = getTrainerFeedEvents(roleData);
    const maxStart = Math.max(0, trainerEvents.length - this.trainerFeedVisibleCount);
    this.trainerEventScroll = Math.min(maxStart, Math.max(0, this.trainerEventScroll + step));
    this._renderTrainerFeed(roleData);
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
    const roleData = (this.currentState && this.currentState.roleData) || {};
    const assignedRoles = Array.isArray(roleData.assignedRoles) ? roleData.assignedRoles : [];
    const hasAssignedRole = (value) => assignedRoles.includes(value);

    if (role === 'mover') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      buttons.push(
        { label: '↑', dir: 'n', x: width / 2, y: baseY - 78 },
        { label: '↓', dir: 's', x: width / 2, y: baseY + 18 },
        { label: '←', dir: 'w', x: width / 2 - 100, y: baseY - 30 },
        { label: '→', dir: 'e', x: width / 2 + 100, y: baseY - 30 }
      );
      this.detailText.setText(
        hasAssignedRole('key-seer')
          ? 'You are Mover + Key Seer. Navigate, collect keys, avoid hazards, and reach the exit once it unlocks.'
          : 'Navigate the maze. Pick up keys, avoid hazards, and reach the exit once it unlocks.'
      );
    } else if (role === 'guide') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText(
        hasAssignedRole('navigator')
          ? 'You are Guide + Navigator. Track hazards/ghosts and wall layout while directing movement.'
          : 'Hazards, the ball, and the exit.'
      );
    } else if (role === 'key-seer') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText('Keys and the ball.');
    } else if (role === 'navigator') {
      this._setupBoard(role);
      this._syncTextLayout(role);
      this.detailText.setText('Hazardous walls and the ball.');
    } else if (role === 'trainer') {
      this._setupTrainerBoard();
      this._syncTextLayout(role);
      buttons.push(
        {
          label: 'Maze',
          action: 'trainer_tab_maze',
          width: 120,
          x: (width / 2) - 66,
          y: 116,
          fontSize: '20px',
        },
        {
          label: 'Events',
          action: 'trainer_tab_events',
          width: 120,
          x: (width / 2) + 66,
          y: 116,
          fontSize: '20px',
        }
      );

      if (this.trainerActiveTab === 'events') {
        this.detailText.setText('Trainer controls: scroll or tap timeline entries, replay selected event, add clarity notes.');

        const feedAreaTop = this.eventsText.y - 6;
        const feedAreaHeight = Math.max(120, height - feedAreaTop - 178);
        this.trainerFeedAreaHeight = feedAreaHeight;
        this.trainerFeedListStartY = this.eventsText.y + (this.trainerFeedLineHeight * this.trainerFeedHeaderLines) + 2;

        const feedArea = this.add.rectangle(width / 2, feedAreaTop + feedAreaHeight / 2, width - 30, feedAreaHeight, 0x0b0f25, 0.35)
          .setStrokeStyle(1, 0x334477, 0.8)
          .setInteractive({ useHandCursor: true });

        this.trainerFeedScrollTrack = this.add.rectangle(width - 18, feedAreaTop + feedAreaHeight / 2, 6, feedAreaHeight - 12, 0x1f2c4f, 0.75);
        this.trainerFeedScrollThumb = this.add.rectangle(width - 18, feedAreaTop + 10, 6, Math.max(26, Math.floor(feedAreaHeight * 0.2)), 0x66a3ff, 0.95)
          .setOrigin(0.5, 0);
        this.roleUi.push(this.trainerFeedScrollTrack, this.trainerFeedScrollThumb);

        feedArea.on('pointerdown', (pointer) => {
          this.trainerFeedLastY = pointer.y;
          this.trainerFeedDragged = false;
        });
        feedArea.on('pointermove', (pointer) => {
          if (!pointer.isDown || this.trainerFeedLastY == null) {
            return;
          }
          const delta = pointer.y - this.trainerFeedLastY;
          if (Math.abs(delta) < 24) {
            return;
          }
          this.trainerFeedDragged = true;
          this._scrollTrainerFeed(delta < 0 ? 1 : -1);
          this.trainerFeedLastY = pointer.y;
        });
        feedArea.on('pointerup', (pointer) => {
          if (!this.trainerFeedDragged) {
            const relativeY = pointer.y - this.trainerFeedListStartY;
            const tappedIndex = Math.floor(relativeY / this.trainerFeedLineHeight);
            if (tappedIndex >= 0 && tappedIndex < this.trainerFeedVisibleEvents.length) {
              this.trainerSelectedOffset = tappedIndex;
              this._renderState(this.currentState || {});
            }
          }
          this.trainerFeedLastY = null;
          this.trainerFeedDragged = false;
        });
        feedArea.on('pointerout', () => {
          this.trainerFeedLastY = null;
        });
        this.roleUi.push(feedArea);

        const clarityOptions = CLARITY_TYPES.map((entry) => {
          const selected = entry === this.trainerClarityType ? ' selected' : '';
          return `<option value="${entry}"${selected}>${humanizeClarityType(entry)}</option>`;
        }).join('');
        const claritySelect = this.add.dom(width / 2, height - 122).createFromHTML(
          `<select id="trainer-clarity-select" style="width:260px;height:44px;border-radius:10px;border:1px solid #4a5ea8;background:#171d3a;color:#ffffff;font-size:16px;padding:8px;">
            ${clarityOptions}
          </select>`
        );
        const clarityEl = claritySelect.getChildByID('trainer-clarity-select');
        if (clarityEl) {
          clarityEl.addEventListener('change', (event) => {
            this.trainerClarityType = event.target.value || CLARITY_TYPES[0];
            this._renderState(this.currentState || {});
          });
        }
        this.roleUi.push(claritySelect);

        buttons.push(
          { label: 'Replay', action: 'trainer_share_replay', width: 132, x: (width / 2) - 74, y: height - 58, fontSize: '22px' },
          { label: 'Add Event', action: 'trainer_add_clarity', width: 132, x: (width / 2) + 74, y: height - 58, fontSize: '22px' }
        );
      }
    } else {
      this._syncTextLayout(role);
      this.detailText.setText('Waiting for your view to load.');
    }

    for (const item of buttons) {
      const buttonWidth = item.width || 96;
      const activeTabColor = this.viewerRole === 'trainer'
        && ((item.action === 'trainer_tab_maze' && this.trainerActiveTab === 'maze')
          || (item.action === 'trainer_tab_events' && this.trainerActiveTab === 'events'));
      const baseButtonColor = activeTabColor ? 0x22aa55 : 0x3355ff;
      const bg = this.add.rectangle(item.x, item.y, buttonWidth, 64, baseButtonColor)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(item.x, item.y, item.label, {
        fontSize: item.fontSize || (item.action ? '24px' : '34px'),
        color: '#ffffff',
      }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        bg.setFillStyle(activeTabColor ? 0x33cc66 : 0x5577ff);
        if (item.action === 'trainer_share_log') {
          sendWs({ type: 'player_input', input: { action: 'trainer_share_log' } });
          return;
        }
        if (item.action === 'trainer_tab_maze') {
          this._setTrainerTab('maze');
          return;
        }
        if (item.action === 'trainer_tab_events') {
          this._setTrainerTab('events');
          return;
        }
        if (item.action === 'trainer_share_replay') {
          const roleData = (this.currentState && this.currentState.roleData) || {};
          const selected = this._getTrainerSelectedEvent(roleData);
          if (selected && selected.eventId) {
            sendWs({ type: 'player_input', input: { action: 'trainer_share_replay', eventId: selected.eventId } });
          }
          return;
        }
        if (item.action === 'trainer_add_clarity') {
          sendWs({
            type: 'player_input',
            input: {
              action: 'trainer_add_clarity_event',
              clarityType: this.trainerClarityType,
            },
          });
          return;
        }

        this._sendMove(item.dir);
      });
      bg.on('pointerup', () => bg.setFillStyle(baseButtonColor));
      bg.on('pointerout', () => bg.setFillStyle(baseButtonColor));

      this.roleUi.push(bg, label);
    }
  }

  _drawMoverMaze(roleData) {
    const maze = roleData.maze;
    if (!maze) {
      this._drawBlankBoard();
      return;
    }
    this._drawBlankBoard();
    const CS = this.mazeCS;

    this.mazeGraphics.lineStyle(1, 0x4d6284, 0.7);
    for (let r = 1; r < maze.height; r++) {
      const y = this.mazeOY + r * CS;
      this.mazeGraphics.lineBetween(this.mazeOX, y, this.mazeOX + maze.width * CS, y);
    }
    for (let c = 1; c < maze.width; c++) {
      const x = this.mazeOX + c * CS;
      this.mazeGraphics.lineBetween(x, this.mazeOY, x, this.mazeOY + maze.height * CS);
    }

    for (const key of roleData.keys || []) {
      if (key.collected) {
        continue;
      }
      this._drawMarkerCircle(key.row, key.col, 0xffcc33, 0.2);
    }

    this._drawMarkerCircle(maze.playerPos.row, maze.playerPos.col, 0x4488ff);
  }

  _drawGuideBoard(roleData) {
    this._drawBlankBoard();

    if (roleData.maze && roleData.maze.cells) {
      const maze = roleData.maze;
      this.mazeGraphics.lineStyle(1, 0xff9955, 0.9);
      for (let r = 0; r < maze.height; r++) {
        for (let c = 0; c < maze.width; c++) {
          const x = this.mazeOX + c * this.mazeCS;
          const y = this.mazeOY + r * this.mazeCS;
          const walls = maze.cells[r][c].walls;
          if (walls.n) this.mazeGraphics.lineBetween(x, y, x + this.mazeCS, y);
          if (walls.s) this.mazeGraphics.lineBetween(x, y + this.mazeCS, x + this.mazeCS, y + this.mazeCS);
          if (walls.w) this.mazeGraphics.lineBetween(x, y, x, y + this.mazeCS);
          if (walls.e) this.mazeGraphics.lineBetween(x + this.mazeCS, y, x + this.mazeCS, y + this.mazeCS);
        }
      }
    }

    const hazards = roleData.hazards || [];
    for (const hazard of hazards) {
      const cx = this.mazeOX + hazard.col * this.mazeCS + this.mazeCS / 2;
      const cy = this.mazeOY + hazard.row * this.mazeCS + this.mazeCS / 2;
      const r = Math.max(8, Math.floor(this.mazeCS * 0.28));
      this.mazeGraphics.lineStyle(3, 0xff3333);
      this.mazeGraphics.lineBetween(cx - r, cy - r, cx + r, cy + r);
      this.mazeGraphics.lineBetween(cx + r, cy - r, cx - r, cy + r);
    }

    if (roleData.playerPos) {
      this._drawMarkerCircle(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }

    for (const ghost of roleData.ghosts || []) {
      this._drawMarkerCircle(ghost.row, ghost.col, 0xbb66ff, 0.18);
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

  _drawNavigatorBoard(roleData) {
    const maze = roleData.maze;
    if (!maze || !maze.cells) {
      this._drawBlankBoard();
      return;
    }

    const OX = this.mazeOX;
    const OY = this.mazeOY;
    const CS = this.mazeCS;
    this.mazeGraphics.clear();
    this.mazeGraphics.lineStyle(2, 0xff9955, 0.95);

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

    if (roleData.playerPos) {
      this._drawMarkerCircle(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }
  }

  _drawTrainerBoard(roleData) {
    this._drawBlankBoard();
    const maze = roleData.trainerMaze;
    if (!maze || !maze.cells) {
      return;
    }

    const OX = this.mazeOX;
    const OY = this.mazeOY;
    const CS = this.mazeCS;
    this.mazeGraphics.lineStyle(1, 0x7f8bb3, 0.9);
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

    for (const hazard of maze.hazards || []) {
      const cx = OX + hazard.col * CS + CS / 2;
      const cy = OY + hazard.row * CS + CS / 2;
      const r = Math.max(3, Math.floor(CS * 0.25));
      this.mazeGraphics.lineStyle(2, 0xff5555);
      this.mazeGraphics.lineBetween(cx - r, cy - r, cx + r, cy + r);
      this.mazeGraphics.lineBetween(cx + r, cy - r, cx - r, cy + r);
    }

    for (const key of maze.keys || []) {
      if (key.collected) continue;
      this._drawMarkerCircle(key.row, key.col, 0xffcc33, 0.2);
    }

    for (const life of maze.lifePickups || []) {
      if (life.collected) continue;
      this._drawMarkerCircle(life.row, life.col, 0xff77bb, 0.18);
    }

    for (const ghost of maze.ghosts || []) {
      this._drawMarkerCircle(ghost.row, ghost.col, 0xbb66ff, 0.2);
    }

    if (maze.goal) {
      this._drawMarkerSquare(maze.goal.row, maze.goal.col, 0x22aa55, 0.9);
    }
    if (maze.playerPos) {
      this._drawMarkerCircle(maze.playerPos.row, maze.playerPos.col, 0x4488ff, 0.24);
    }
  }

  _renderTrainerFeed(roleData) {
    const trainerEvents = getTrainerFeedEvents(roleData);
    const maxLabelLength = 52;
    const truncateLabel = (value) => {
      const text = String(value || '');
      if (text.length <= maxLabelLength) {
        return text;
      }
      return `${text.slice(0, maxLabelLength - 1)}…`;
    };

    if (!trainerEvents.length) {
      this.eventsText.setText('No events yet.');
      this.trainerFeedVisibleEvents = [];
      if (this.trainerFeedScrollThumb) {
        this.trainerFeedScrollThumb.setVisible(false);
      }
      return;
    }

    const sorted = [...trainerEvents].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const maxStart = Math.max(0, sorted.length - this.trainerFeedVisibleCount);
    this.trainerEventScroll = Math.min(this.trainerEventScroll, maxStart);
    this.trainerSelectedOffset = Math.min(
      this.trainerSelectedOffset,
      Math.max(0, Math.min(this.trainerFeedVisibleCount - 1, sorted.length - 1))
    );
    const visible = sorted.slice(this.trainerEventScroll, this.trainerEventScroll + this.trainerFeedVisibleCount);
    this.trainerFeedVisibleEvents = visible;
    const lines = visible.map((entry, idx) => {
      const pointer = idx === this.trainerSelectedOffset ? '>' : ' ';
      const star = entry.highlighted ? '*' : ' ';
      const label = truncateLabel(formatTrainerTimelineEntry(entry));
      return `${pointer}${star} ${label}`;
    });
    const highlightedCount = (roleData.trainerHighlightEventIds || []).length;
    const hazardCount = trainerEvents.filter((entry) => entry.event === 'hazard_hit' || entry.event === 'ghost_collision').length;
    const clarityCount = trainerEvents.filter((entry) => entry.event === 'clarity_event').length;
    const selectedIndex = Math.min(visible.length - 1, this.trainerSelectedOffset);
    const selected = selectedIndex >= 0 ? visible[selectedIndex] : null;
    const header = `TIMELINE\nHighlights: ${highlightedCount} • Hazards: ${hazardCount} • Clarity: ${clarityCount}`;
    const footer = `Selected: ${selected ? truncateLabel(formatEvent(selected)) : 'None'}\n${truncateLabel(summarizeTrainerEvent(selected))}`;
    this.eventsText.setWordWrapWidth(0);
    this.eventsText.setText(`${header}\n${lines.join('\n')}\n${footer}`);
    this.trainerFeedHeaderLines = 2;
    this.trainerFeedLineHeight = 22;

    if (this.trainerFeedScrollThumb && this.trainerFeedScrollTrack) {
      const total = sorted.length;
      const visibleCount = Math.min(this.trainerFeedVisibleCount, total);
      const trackHeight = this.trainerFeedScrollTrack.height;
      const thumbHeight = Math.max(24, Math.floor((visibleCount / total) * trackHeight));
      const travel = Math.max(0, trackHeight - thumbHeight);
      const progress = maxStart > 0 ? (this.trainerEventScroll / maxStart) : 0;
      this.trainerFeedScrollThumb
        .setVisible(total > visibleCount)
        .setDisplaySize(this.trainerFeedScrollThumb.width, thumbHeight)
        .setY((this.trainerFeedScrollTrack.y - (trackHeight / 2)) + (travel * progress));
    }
  }

  _renderState(state) {
    const roleData = state.roleData || {};
    const summary = state.summary || {};
    const timer = state.timer || null;

    if (this.viewerRole === 'mover' && roleData.maze) {
      this._drawMoverMaze(roleData);
    } else if (this.viewerRole === 'guide') {
      this._drawGuideBoard(roleData);
    } else if (this.viewerRole === 'key-seer') {
      this._drawKeyBoard(roleData);
    } else if (this.viewerRole === 'navigator') {
      this._drawNavigatorBoard(roleData);
    } else if (this.viewerRole === 'trainer') {
      if (this.trainerActiveTab === 'maze') {
        this._drawTrainerBoard(roleData);
      } else if (this.mazeGraphics) {
        this.mazeGraphics.clear();
      }
    } else if (this.mazeGraphics) {
      this.mazeGraphics.clear();
    }

    if (this.viewerRole === 'trainer') {
      const latest = state.trainerBroadcast && state.trainerBroadcast.payload;
      const selectedClarity = humanizeClarityType(this.trainerClarityType);
      const selected = this._getTrainerSelectedEvent(roleData);
      const aiSuggestions = roleData.aiSuggestions || [];
      const selectedSuggestion = aiSuggestions[this.trainerSuggestionIndex] || null;
      if (this.trainerActiveTab === 'events') {
        this.detailText.setText(buildTrainerDetailText(roleData, summary, timer, selectedClarity, selected, selectedSuggestion, latest));
      }
    } else {
      this.detailText.setText('');
    }

    if (this.viewerRole === 'trainer') {
      if (this.trainerActiveTab === 'events') {
        this._renderTrainerFeed(roleData);
      } else {
        this.eventsText.setText('');
      }
    } else {
      this.eventsText.setText('');
    }

    if (state.status === 'ended' && !this._shownEnd) {
      this._shownEnd = true;
      this._showEnd(state);
    } else if (state.status !== 'ended' && this._shownEnd) {
      this._shownEnd = false;
      this._hideEndUi();
    }
  }

  _showEnd(state) {
    const { width, height } = this.scale;
    const summary = state.summary || {};
    this._clearEndUi();

    const overlay = this.add.rectangle(width / 2, height / 2, width - 40, 190, 0x000000, 0.9).setDepth(10);
    const title = this.add.text(width / 2, height / 2 - 28, summary.outcome === 'success' ? 'Complete' : 'Failed', {
      fontSize: '34px',
      color: summary.outcome === 'success' ? '#22ee66' : '#ff6666',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11);
    const subtitle = this.add.text(width / 2, height / 2 + 22, 'Waiting for the host to restart the round.', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5).setDepth(11);

    this.endUi = [overlay, title, subtitle];
  }

  _hideEndUi() {
    this._clearEndUi();
  }

  _clearEndUi() {
    for (const item of this.endUi) {
      item.destroy();
    }
    this.endUi = [];
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
    if (trySilentReconnect(this.game)) {
      this.time.delayedCall(500, () => {
        sendWs({ type: 'resync_request' });
      });
      return;
    }

    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
    document.removeEventListener('visibilitychange', this.onVisibilitySync);
    this.scene.start('JoinScene');
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
    this.input.off('wheel', this.onWheel, this);
    document.removeEventListener('visibilitychange', this.onVisibilitySync);
  }

  _sendMove(dir) {
    const now = Date.now();
    if (now - this.lastMoveSentAt < 120) {
      return;
    }
    this.lastMoveSentAt = now;
    sendWs({ type: 'player_input', input: { action: 'move', dir } });
  }

  onVisibilitySync() {
    if (document.visibilityState === 'visible') {
      sendWs({ type: 'resync_request' });
    }
  }

  onWheel(pointer, _gameObjects, _deltaX, deltaY) {
    if (this.viewerRole !== 'trainer' || this.trainerActiveTab !== 'events') {
      return;
    }
    if (pointer.y < this.eventsText.y - 10) {
      return;
    }
    this._scrollTrainerFeed(Math.sign(deltaY));
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
