let socket = null;
let socketSequence = 0;
let myPlayerId = null;
let pendingReconnectToken = null;
let pendingPlayerName = null;
const viewSettings = window.TeamBuildingViewSettings || {};
const controllerViewSettings = viewSettings.controller || {};
const screenDependencies = window.TeamBuildingScreenDependencies
  && typeof window.TeamBuildingScreenDependencies.createControllerDependencies === 'function'
  ? window.TeamBuildingScreenDependencies.createControllerDependencies()
  : {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    storage: window.localStorage,
    searchParams: () => new URLSearchParams(window.location.search),
    openWebSocket: () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return new WebSocket(`${protocol}://${window.location.host}`);
    },
  };
const roleDependencies = window.TeamBuildingControllerRoleDependencies || {};
const trainerDependencies = roleDependencies
  && typeof roleDependencies.createTrainerDependencies === 'function'
  ? roleDependencies.createTrainerDependencies()
  : {
    defaultTab: 'maze',
    defaultClarityType: 'role_unclear',
    clarityTypes: [
      'role_unclear',
      'lack_of_sent_communication',
      'lack_of_received_communication',
      'acted_before_communicating',
      'contradicting_instructions',
      'silent_confusion',
    ],
    feedVisibleCount: 8,
  };
const playerDependencies = roleDependencies
  && typeof roleDependencies.createPlayerDependencies === 'function'
  ? roleDependencies.createPlayerDependencies()
  : {
    defaultTab: null,
    defaultClarityType: null,
    clarityTypes: [],
    feedVisibleCount: 8,
  };
const CONNECTION_PROBE_INTERVAL_MS = controllerViewSettings.connectionProbeIntervalMs || 12000;
const CONNECTION_PROBE_TIMEOUT_MS = controllerViewSettings.connectionProbeTimeoutMs || 3500;
const CONNECTION_WARNING_LATENCY_MS = controllerViewSettings.connectionWarningLatencyMs || 1200;
const CONNECTION_WARNING_LATENCY_STREAK = controllerViewSettings.connectionWarningLatencyStreak || 2;

function storageKey(sessionId) {
  return `teambuilding.reconnect.${sessionId}`;
}

function loadReconnectState(sessionId) {
  try {
    const raw = screenDependencies.storage.getItem(storageKey(sessionId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveReconnectState(sessionId, payload) {
  try {
    screenDependencies.storage.setItem(storageKey(sessionId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function clearReconnectState(sessionId) {
  try {
    screenDependencies.storage.removeItem(storageKey(sessionId));
  } catch {
    // Ignore storage failures.
  }
}

function getCurrentSessionIdFromUrl() {
  const params = screenDependencies.searchParams();
  return (params.get('session') || '').toUpperCase();
}

function getConnectionWarningMessage(reason) {
  if (reason === 'offline') {
    return 'Device appears offline.';
  }
  if (reason === 'backgrounded') {
    return 'Keep this page active to avoid mobile disconnects.';
  }
  if (reason === 'slow_response') {
    return 'Server response is delayed. Reconnect may start soon.';
  }
  if (reason === 'socket_error') {
    return 'Connection looks unstable.';
  }
  return '';
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

  const nextSocket = screenDependencies.openWebSocket();
  const sequence = ++socketSequence;
  socket = nextSocket;

  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket || sequence !== socketSequence) {
      return;
    }
    game.events.emit('ws_open');
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
  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket || sequence !== socketSequence) {
      return;
    }
    game.events.emit('ws_error');
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

function requestResyncWhenReady(delayMs = 0) {
  if (delayMs > 0) {
    screenDependencies.setTimeout(() => requestResyncWhenReady(0), delayMs);
    return;
  }

  if (!socket) {
    return;
  }

  if (socket.readyState === WebSocket.OPEN) {
    sendWs({ type: 'resync_request' });
    return;
  }

  if (socket.readyState !== WebSocket.CONNECTING) {
    return;
  }

  const targetSocket = socket;
  const onOpen = () => {
    if (socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    sendWs({ type: 'resync_request' });
  };
  targetSocket.addEventListener('open', onOpen, { once: true });
}

function ensureConnectedAndResync(game) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    requestResyncWhenReady();
    return true;
  }

  if (trySilentReconnect(game)) {
    requestResyncWhenReady(500);
    return true;
  }

  return false;
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

const CLARITY_TYPES = trainerDependencies.clarityTypes;

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
    return `Shared focus for ${latest.event || 'event'}`;
  }
  return 'Full session export shared';
}

function formatAssignedRoles(roles) {
  const assigned = Array.isArray(roles) ? roles : [];
  if (!assigned.length) {
    return 'Observer';
  }
  return assigned.map((role) => String(role || '').replace(/-/g, ' ')).join(' + ');
}

function getTrainerPerspectiveOptions(state) {
  const roleViews = Array.isArray(state && state.trainerRoleViews)
    ? state.trainerRoleViews
    : Array.isArray(state && state.roleData && state.roleData.trainerRoleViews)
      ? state.roleData.trainerRoleViews
      : [];
  return [
    {
      type: 'overview',
      label: 'All roles',
      viewerRole: 'trainer',
      roleData: state && state.roleData ? state.roleData : {},
    },
    ...roleViews.map((view) => ({
      type: 'player',
      label: `${view.playerName || 'Player'} • ${formatAssignedRoles(view.assignedRoles)}`,
      viewerRole: view.viewerRole,
      roleData: view.roleData || {},
      assignedRoles: view.assignedRoles || [],
      playerId: view.playerId || null,
      playerName: view.playerName || 'Player',
    })),
  ];
}

function getTrainerPerspectiveView(state, index) {
  const options = getTrainerPerspectiveOptions(state);
  if (!options.length) {
    return {
      index: 0,
      total: 0,
      option: null,
    };
  }
  const normalizedIndex = Phaser.Math.Wrap(index || 0, 0, options.length);
  return {
    index: normalizedIndex,
    total: options.length,
    option: options[normalizedIndex],
  };
}

function buildTrainerDetailText(_roleData, summary) {
  return [
    'OVERVIEW',
    `Keys ${summary.keysCollected || 0}/3 • Resets ${summary.resets || 0}`,
    `Outcome: ${summary.outcome || 'in progress'}`,
  ].join('\n');
}

function getTrainerFeedEvents(roleData) {
  const trainerEvents = roleData.trainerEvents || [];
  return trainerEvents.filter((entry) => entry.event === 'clarity_event');
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
  if (entry.event === 'trainer_replay_shared') {
    return 'Shared selected event';
  }

  return entry.event.replace(/_/g, ' ');
}

class JoinScene extends Phaser.Scene {
  constructor() {
    super({ key: 'JoinScene' });
  }

  init() {
    const params = screenDependencies.searchParams();
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
      if (message.code === 'invalid_reconnect_token' || message.code === 'reconnect_replaced') {
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
    if (message.type === 'state_sync' && message.state.status !== 'lobby') {
      this.game.events.off('ws_message', this.onMessage, this);
      this.game.events.off('ws_close', this.onClose, this);
      this.scene.start('ControllerScene', { initialState: message.state });
      return;
    }

    if (message.type === 'join_error' && message.code === 'reconnect_replaced') {
      const sessionId = getCurrentSessionIdFromUrl();
      if (sessionId) {
        clearReconnectState(sessionId);
      }
      pendingReconnectToken = null;
      this.game.events.off('ws_message', this.onMessage, this);
      this.game.events.off('ws_close', this.onClose, this);
      this.scene.start('JoinScene');
      return;
    }

    if (message.type === 'session_closed') {
      this.onClose();
    }
  }

  onClose() {
    if (ensureConnectedAndResync(this.game)) {
      if (this.dotText) {
        this.dotText.setText('Reconnecting…');
      }
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
    this.resetFeedbackUi = null;
    this._resetFeedbackCountdownText = null;
    this._lastPendingResetCause = null;
    this.trainerEventScroll = 0;
    this.trainerSelectedOffset = 0;
    this.trainerSuggestionIndex = 0;
    this.trainerActiveTab = trainerDependencies.defaultTab || 'maze';
    this.trainerPerspectiveIndex = 0;
    this.trainerClarityType = trainerDependencies.defaultClarityType || CLARITY_TYPES[0];
    this.trainerFeedLineHeight = 22;
    this.trainerFeedHeaderLines = 2;
    this.trainerFeedVisibleCount = trainerDependencies.feedVisibleCount || playerDependencies.feedVisibleCount || 8;
    this.trainerFeedListStartY = 0;
    this.trainerFeedAreaHeight = 0;
    this.trainerFeedVisibleEvents = [];
    this.trainerFeedDragged = false;
    this.trainerFeedLastY = null;
    this.trainerLatestEventId = null;
    this.trainerFeedScrollTrack = null;
    this.trainerFeedScrollThumb = null;
    this.trainerTimerButtons = [];
    this.trainerTimerStatusText = null;
    this.followUpUi = [];
    this.followUpEndButtonBg = null;
    this.followUpEndButtonLabel = null;
    this.lastMoveSentAt = 0;
    this.connectionUi = null;
    this.playerMarkerAnim = {
      currentRow: null,
      currentCol: null,
      targetRow: null,
      targetCol: null,
    };
    this.ghostMarkerAnim = new Map();
    this.boardCols = 8;
    this.boardRows = 8;
    this.boardIcons = [];
    this.seenKeyPickupEventIds = new Set();
    this.onWheel = this.onWheel.bind(this);
    this.onVisibilitySync = this.onVisibilitySync.bind(this);
    this.onConnectionWake = this.onConnectionWake.bind(this);
    this.onConnectionRisk = this.onConnectionRisk.bind(this);
    this.onManualReconnect = this.onManualReconnect.bind(this);
    this.onSocketOpen = this.onSocketOpen.bind(this);
    this.onSocketError = this.onSocketError.bind(this);
    this.connectionWarningUi = null;
    this.connectionProbeEvent = null;
    this.pendingProbeId = 0;
    this.pendingProbeSentAt = 0;
    this.pendingProbeReason = null;
    this.latencyWarningStreak = 0;
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
    this._createConnectionUi();
    this._createConnectionWarningUi();
    this._createFollowUpUi();
    if (this.currentState) {
      this._renderState(this.currentState);
    }

    this.game.events.on('ws_message', this.onMessage, this);
    this.game.events.on('ws_close', this.onClose, this);
    this.game.events.on('ws_open', this.onSocketOpen, this);
    this.game.events.on('ws_error', this.onSocketError, this);
    this.input.on('wheel', this.onWheel, this);
    document.addEventListener('visibilitychange', this.onVisibilitySync);
    window.addEventListener('pageshow', this.onConnectionWake);
    window.addEventListener('online', this.onConnectionWake);
    window.addEventListener('offline', this.onConnectionRisk);

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.currentState) {
          this._renderState(this.currentState);
        }
      },
    });
    this.connectionProbeEvent = this.time.addEvent({
      delay: CONNECTION_PROBE_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const probeId = Date.now();
        this.pendingProbeId = probeId;
        this.pendingProbeSentAt = Date.now();
        sendWs({ type: 'resync_request' });
        this.time.delayedCall(CONNECTION_PROBE_TIMEOUT_MS, () => {
          if (this.pendingProbeId !== probeId) {
            return;
          }
          if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
          }
          this._showConnectionWarning('slow_response');
        });
      },
    });

    requestResyncWhenReady();
    this._syncConnectionWarning();
  }

  _createConnectionUi() {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.74)
      .setDepth(40)
      .setVisible(false);
    const title = this.add.text(width / 2, height / 2 - 56, 'Disconnected', {
      fontSize: '28px',
      color: '#ffdddd',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5).setDepth(41).setVisible(false);
    const detail = this.add.text(width / 2, height / 2 - 12, 'Trying to reconnect…', {
      fontSize: '16px',
      color: '#dddddd',
      align: 'center',
      wordWrap: { width: Math.max(220, width - 44) },
    }).setOrigin(0.5).setDepth(41).setVisible(false);
    const resetBg = this.add.rectangle(width / 2, height / 2 + 56, 214, 46, 0x2f7de1, 0.96)
      .setDepth(41)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    const resetLabel = this.add.text(width / 2, height / 2 + 56, 'Reset connection', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(42).setVisible(false);

    resetBg.on('pointerup', this.onManualReconnect);
    resetBg.on('pointerover', () => resetBg.setFillStyle(0x4b94f2, 1));
    resetBg.on('pointerout', () => resetBg.setFillStyle(0x2f7de1, 0.96));

    this.connectionUi = {
      overlay,
      title,
      detail,
      resetBg,
      resetLabel,
    };
  }

  _showConnectionUi(title, detail, showReset = true) {
    if (!this.connectionUi) {
      return;
    }
    this.connectionUi.overlay.setVisible(true);
    this.connectionUi.title.setText(title || 'Disconnected').setVisible(true);
    this.connectionUi.detail.setText(detail || 'Trying to reconnect…').setVisible(true);
    this.connectionUi.resetBg.setVisible(showReset);
    this.connectionUi.resetLabel.setVisible(showReset);
    if (showReset) {
      this.connectionUi.resetBg.setInteractive({ useHandCursor: true });
    } else {
      this.connectionUi.resetBg.disableInteractive();
    }
  }

  _hideConnectionUi() {
    if (!this.connectionUi) {
      return;
    }
    this.connectionUi.overlay.setVisible(false);
    this.connectionUi.title.setVisible(false);
    this.connectionUi.detail.setVisible(false);
    this.connectionUi.resetBg.setVisible(false);
    this.connectionUi.resetBg.disableInteractive();
    this.connectionUi.resetLabel.setVisible(false);
  }

  _createConnectionWarningUi() {
    const { width } = this.scale;
    const bg = this.add.rectangle(width - 90, 34, 146, 34, 0xe58b1f, 0.96)
      .setDepth(39)
      .setStrokeStyle(2, 0xffd59b, 0.95)
      .setVisible(false)
      .setOrigin(0.5);
    const label = this.add.text(width - 90, 34, 'Wi-Fi !', {
      fontSize: '16px',
      color: '#fff6e8',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(40).setVisible(false);
    const detail = this.add.text(width - 18, 56, '', {
      fontSize: '11px',
      color: '#ffdfb3',
      align: 'right',
      wordWrap: { width: 200 },
    }).setOrigin(1, 0).setDepth(40).setVisible(false);
    this.connectionWarningUi = { bg, label, detail };
  }

  _showConnectionWarning(reason, detailOverride = null) {
    this.pendingProbeReason = reason;
    if (!this.connectionWarningUi) {
      return;
    }
    const detail = detailOverride || getConnectionWarningMessage(reason);
    this.connectionWarningUi.bg.setVisible(true);
    this.connectionWarningUi.label.setVisible(true);
    this.connectionWarningUi.detail.setText(detail).setVisible(true);
  }

  _hideConnectionWarning() {
    this.pendingProbeReason = null;
    if (!this.connectionWarningUi) {
      return;
    }
    this.connectionWarningUi.bg.setVisible(false);
    this.connectionWarningUi.label.setVisible(false);
    this.connectionWarningUi.detail.setVisible(false);
  }

  _syncConnectionWarning() {
    if (!navigator.onLine) {
      this._showConnectionWarning('offline');
      return;
    }
    if (document.visibilityState === 'hidden') {
      this._showConnectionWarning('backgrounded');
      return;
    }
    if (this.pendingProbeReason === 'slow_response' || this.pendingProbeReason === 'socket_error') {
      this._showConnectionWarning(this.pendingProbeReason);
      return;
    }
    this._hideConnectionWarning();
  }

  _clearRoleUi() {
    for (const item of this.roleUi) {
      item.destroy();
    }
    this.roleUi = [];
    this._clearBoardIcons();
    this.trainerFeedScrollTrack = null;
    this.trainerFeedScrollThumb = null;
    this.trainerTimerButtons = [];
    this.trainerTimerStatusText = null;
    if (this.mazeGraphics) {
      this.mazeGraphics.clear();
    }
  }

  _createFollowUpUi() {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width - 36, 180, 0x070b1b, 0.94)
      .setDepth(30)
      .setStrokeStyle(2, 0x88aaff, 0.9)
      .setVisible(false);
    const title = this.add.text(width / 2, height / 2 - 28, 'Follow-up phase', {
      fontSize: '32px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    const body = this.add.text(width / 2, height / 2 + 12, 'Gameplay is paused. Debrief with your team.', {
      fontSize: '16px',
      color: '#c6d4f3',
      align: 'center',
      wordWrap: { width: width - 64 },
    }).setOrigin(0.5).setDepth(31).setVisible(false);
    const endBg = this.add.rectangle(width / 2, height / 2 + 66, 210, 46, 0x3355ff)
      .setDepth(31)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    const endLabel = this.add.text(width / 2, height / 2 + 66, 'End follow-up', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(32).setVisible(false);
    endBg.on('pointerover', () => endBg.setFillStyle(0x5577ff));
    endBg.on('pointerout', () => endBg.setFillStyle(0x3355ff));
    endBg.on('pointerup', () => {
      if (endBg.visible) {
        sendWs({ type: 'followup_end' });
      }
    });
    endBg.disableInteractive();

    this.followUpUi = [overlay, title, body, endBg, endLabel];
    this.followUpEndButtonBg = endBg;
    this.followUpEndButtonLabel = endLabel;
  }

  _setFollowUpVisible(visible, canEnd) {
    for (const item of this.followUpUi) {
      item.setVisible(visible);
    }
    if (this.followUpEndButtonBg && this.followUpEndButtonLabel) {
      const showEnd = visible && canEnd;
      this.followUpEndButtonBg.setVisible(showEnd);
      this.followUpEndButtonLabel.setVisible(showEnd);
      if (showEnd) {
        this.followUpEndButtonBg.setInteractive({ useHandCursor: true });
      } else {
        this.followUpEndButtonBg.disableInteractive();
      }
    }
  }

  _setRoleUiVisible(visible) {
    for (const item of this.roleUi) {
      item.setVisible(visible);
    }
    if (!visible) {
      this.mazeGraphics.clear();
      this._clearBoardIcons();
      this.detailText.setText('');
      this.eventsText.setText('');
      this._hideEndUi();
      this._hideResetFeedback();
    }
  }

  _getBoardDimensions(role, roleData, state = this.currentState) {
    if (role === 'trainer' && roleData && roleData.trainerMaze) {
      return {
        cols: Math.max(1, roleData.trainerMaze.width || 0),
        rows: Math.max(1, roleData.trainerMaze.height || 0),
      };
    }

    if (roleData && roleData.maze) {
      return {
        cols: Math.max(1, roleData.maze.width || 0),
        rows: Math.max(1, roleData.maze.height || 0),
      };
    }

    if (state && state.mazeMeta) {
      return {
        cols: Math.max(1, state.mazeMeta.width || 0),
        rows: Math.max(1, state.mazeMeta.height || 0),
      };
    }

    return { cols: 8, rows: 8 };
  }

  _setupBoard(role, roleData = {}, state = this.currentState) {
    const width = this.scale.width;
    const height = this.scale.height;
    const topY = 120;
    const bottomReserve = role === 'mover' ? 236 : 172;
    const availableWidth = width - 24;
    const availableHeight = Math.max(180, height - topY - bottomReserve);
    const board = this._getBoardDimensions(role, roleData, state);
    this.boardCols = board.cols;
    this.boardRows = board.rows;
    this.mazeCS = Math.max(15, Math.floor(Math.min(availableWidth / this.boardCols, availableHeight / this.boardRows)));
    const boardWidth = this.mazeCS * this.boardCols;
    this.mazeOX = Math.floor((width - boardWidth) / 2);
    this.mazeOY = topY;
  }

  _setupTrainerBoard(roleData = {}, state = this.currentState, trainerPerspective = null) {
    const width = this.scale.width;
    const height = this.scale.height;
    const topY = 154;
    const sideGutter = this.trainerActiveTab === 'maze' ? 128 : 24;
    const availableWidth = width - sideGutter;
    const bottomReserve = this.trainerActiveTab === 'maze' ? 220 : 336;
    const availableHeight = Math.max(128, height - topY - bottomReserve);
    const previewRole = trainerPerspective && trainerPerspective.viewerRole !== 'trainer'
      ? trainerPerspective.viewerRole
      : 'trainer';
    const previewRoleData = trainerPerspective && trainerPerspective.roleData
      ? trainerPerspective.roleData
      : roleData;
    const board = this._getBoardDimensions(previewRole, previewRoleData, state);
    this.boardCols = board.cols;
    this.boardRows = board.rows;
    this.mazeCS = Math.max(10, Math.floor(Math.min(availableWidth / this.boardCols, availableHeight / this.boardRows)));
    const boardWidth = this.mazeCS * this.boardCols;
    this.mazeOX = Math.floor((width - boardWidth) / 2);
    this.mazeOY = topY;
  }

  _getTrainerPerspectiveView(state = this.currentState) {
    const perspective = getTrainerPerspectiveView(state, this.trainerPerspectiveIndex);
    this.trainerPerspectiveIndex = perspective.index;
    return perspective;
  }

  _cycleTrainerPerspective(step) {
    if (this.viewerRole !== 'trainer') {
      return;
    }
    const perspective = this._getTrainerPerspectiveView(this.currentState || {});
    if (perspective.total <= 1) {
      return;
    }
    this.trainerPerspectiveIndex = Phaser.Math.Wrap(perspective.index + step, 0, perspective.total);
    this._buildRoleUi('trainer');
    this._renderState(this.currentState || {});
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
      this.eventsText.setPosition(18, this.mazeOY + this.mazeCS * this.boardRows + 12);
    } else if (role === 'trainer') {
      const controlsReserve = 250;
      this.eventsText.setPosition(18, Math.max(320, height - controlsReserve - 250));
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
    const boardWidth = CS * this.boardCols;
    const boardHeight = CS * this.boardRows;

    this.mazeGraphics.clear();
    this.mazeGraphics.lineStyle(2, 0x555588, 0.5);
    this.mazeGraphics.strokeRect(OX, OY, boardWidth, boardHeight);
  }

  _getCellCenter(row, col) {
    return {
      x: this.mazeOX + col * this.mazeCS + this.mazeCS / 2,
      y: this.mazeOY + row * this.mazeCS + this.mazeCS / 2,
    };
  }

  _drawMarkerEmoji(row, col, emoji, options = {}) {
    const { x, y } = this._getCellCenter(row, col);
    const fontScale = typeof options.fontScale === 'number' ? options.fontScale : 0.62;
    const alpha = typeof options.alpha === 'number' ? options.alpha : 1;
    const depth = typeof options.depth === 'number' ? options.depth : 9;
    const yOffset = Math.max(1, Math.floor(this.mazeCS * 0.08));
    const icon = this.add.text(x, y + yOffset, emoji, {
      fontSize: `${Math.max(14, Math.floor(this.mazeCS * fontScale))}px`,
      fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      padding: {
        top: Math.max(2, Math.floor(this.mazeCS * 0.14)),
        bottom: Math.max(1, Math.floor(this.mazeCS * 0.08)),
      },
    }).setOrigin(0.5).setAlpha(alpha).setDepth(depth);
    this.boardIcons.push(icon);
    return icon;
  }

  _clearBoardIcons() {
    for (const icon of this.boardIcons) {
      icon.destroy();
    }
    this.boardIcons = [];
  }

  _showKeyPickupTween(position) {
    if (!position || typeof position.row !== 'number' || typeof position.col !== 'number') {
      return;
    }
    const { x, y } = this._getCellCenter(position.row, position.col);
    const yOffset = Math.max(1, Math.floor(this.mazeCS * 0.08));
    const marker = this.add.text(x, y + yOffset, '🗝️', {
      fontSize: `${Math.max(18, Math.floor(this.mazeCS * 0.8))}px`,
      fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      padding: {
        top: Math.max(2, Math.floor(this.mazeCS * 0.14)),
        bottom: Math.max(1, Math.floor(this.mazeCS * 0.08)),
      },
    }).setOrigin(0.5).setDepth(22).setScale(0.6);

    this.tweens.add({
      targets: marker,
      scale: 1.55,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => marker.destroy(),
    });
  }

  _syncKeyPickupTweens(roleData) {
    const recentEvents = Array.isArray(roleData && roleData.recentEvents) ? roleData.recentEvents : [];
    for (const entry of recentEvents) {
      if (!entry || entry.event !== 'key_pickup' || !entry.position) {
        continue;
      }
      const eventId = entry.eventId || `${entry.ts || 0}:${entry.position.row},${entry.position.col}`;
      if (this.seenKeyPickupEventIds.has(eventId)) {
        continue;
      }
      this.seenKeyPickupEventIds.add(eventId);
      this._showKeyPickupTween(entry.position);
    }
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

  _resetPlayerMarkerAnimation() {
    this.playerMarkerAnim.currentRow = null;
    this.playerMarkerAnim.currentCol = null;
    this.playerMarkerAnim.targetRow = null;
    this.playerMarkerAnim.targetCol = null;
  }

  _resetGhostMarkerAnimation() {
    this.ghostMarkerAnim.clear();
  }

  _setPlayerMarkerTarget(row, col) {
    if (typeof row !== 'number' || typeof col !== 'number') {
      return;
    }
    if (this.playerMarkerAnim.currentRow == null || this.playerMarkerAnim.currentCol == null) {
      this.playerMarkerAnim.currentRow = row;
      this.playerMarkerAnim.currentCol = col;
    }
    this.playerMarkerAnim.targetRow = row;
    this.playerMarkerAnim.targetCol = col;
  }

  _stepPlayerMarkerAnimation(deltaMs) {
    if (this.playerMarkerAnim.currentRow == null || this.playerMarkerAnim.currentCol == null) {
      return false;
    }
    if (this.playerMarkerAnim.targetRow == null || this.playerMarkerAnim.targetCol == null) {
      return false;
    }

    const rowDelta = this.playerMarkerAnim.targetRow - this.playerMarkerAnim.currentRow;
    const colDelta = this.playerMarkerAnim.targetCol - this.playerMarkerAnim.currentCol;
    if (Math.abs(rowDelta) < 0.0006 && Math.abs(colDelta) < 0.0006) {
      this.playerMarkerAnim.currentRow = this.playerMarkerAnim.targetRow;
      this.playerMarkerAnim.currentCol = this.playerMarkerAnim.targetCol;
      return false;
    }

    const factor = 1 - Math.exp(-Math.max(0, deltaMs) * 0.018);
    this.playerMarkerAnim.currentRow = Phaser.Math.Linear(
      this.playerMarkerAnim.currentRow,
      this.playerMarkerAnim.targetRow,
      factor
    );
    this.playerMarkerAnim.currentCol = Phaser.Math.Linear(
      this.playerMarkerAnim.currentCol,
      this.playerMarkerAnim.targetCol,
      factor
    );
    return true;
  }

  _setGhostMarkerTarget(id, row, col) {
    if (!id || typeof row !== 'number' || typeof col !== 'number') {
      return;
    }
    const marker = this.ghostMarkerAnim.get(id) || {
      currentRow: row,
      currentCol: col,
      targetRow: row,
      targetCol: col,
    };
    marker.targetRow = row;
    marker.targetCol = col;
    this.ghostMarkerAnim.set(id, marker);
  }

  _stepGhostMarkerAnimation(deltaMs) {
    if (!this.ghostMarkerAnim.size) {
      return false;
    }

    let changed = false;
    for (const marker of this.ghostMarkerAnim.values()) {
      const rowDelta = marker.targetRow - marker.currentRow;
      const colDelta = marker.targetCol - marker.currentCol;
      if (Math.abs(rowDelta) < 0.0006 && Math.abs(colDelta) < 0.0006) {
        marker.currentRow = marker.targetRow;
        marker.currentCol = marker.targetCol;
        continue;
      }

      const factor = 1 - Math.exp(-Math.max(0, deltaMs) * 0.018);
      marker.currentRow = Phaser.Math.Linear(marker.currentRow, marker.targetRow, factor);
      marker.currentCol = Phaser.Math.Linear(marker.currentCol, marker.targetCol, factor);
      changed = true;
    }

    return changed;
  }

  _drawPlayerMarker(row, col, color = 0x4488ff, radiusScale = 0.28) {
    this._setPlayerMarkerTarget(row, col);
    const drawRow = this.playerMarkerAnim.currentRow == null ? row : this.playerMarkerAnim.currentRow;
    const drawCol = this.playerMarkerAnim.currentCol == null ? col : this.playerMarkerAnim.currentCol;
    this._drawMarkerCircle(drawRow, drawCol, color, radiusScale);
  }

  _drawGhostMarkers(ghosts, color = 0xbb66ff, radiusScale = 0.2) {
    const seenGhostIds = new Set();
    for (const ghost of ghosts || []) {
      if (!ghost || typeof ghost.row !== 'number' || typeof ghost.col !== 'number') {
        continue;
      }
      const ghostId = ghost.id || `ghost-${ghost.row}-${ghost.col}`;
      seenGhostIds.add(ghostId);
      this._setGhostMarkerTarget(ghostId, ghost.row, ghost.col);
      const marker = this.ghostMarkerAnim.get(ghostId);
      const drawRow = marker ? marker.currentRow : ghost.row;
      const drawCol = marker ? marker.currentCol : ghost.col;
      this._drawMarkerCircle(drawRow, drawCol, color, radiusScale);
    }

    for (const ghostId of this.ghostMarkerAnim.keys()) {
      if (!seenGhostIds.has(ghostId)) {
        this.ghostMarkerAnim.delete(ghostId);
      }
    }
  }

  _buildRoleUi(role) {
    this._clearRoleUi();
    this._resetPlayerMarkerAnimation();
    this._resetGhostMarkerAnimation();

    const { width, height } = this.scale;
    const baseY = height - 110;
    const buttons = [];
    const roleData = (this.currentState && this.currentState.roleData) || {};
    const assignedRoles = Array.isArray(roleData.assignedRoles) ? roleData.assignedRoles : [];
    const hasAssignedRole = (value) => assignedRoles.includes(value);

    if (role === 'mover') {
      this._setupBoard(role, roleData, this.currentState);
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
      this._setupBoard(role, roleData, this.currentState);
      this._syncTextLayout(role);
      this.detailText.setText(
        hasAssignedRole('navigator')
          ? 'You are Guide + Navigator. Track hazards/ghosts and wall layout while directing movement.'
          : 'Hazards, the ball, and the exit.'
      );
    } else if (role === 'key-seer') {
      this._setupBoard(role, roleData, this.currentState);
      this._syncTextLayout(role);
      this.detailText.setText('Keys and the ball.');
    } else if (role === 'navigator') {
      this._setupBoard(role, roleData, this.currentState);
      this._syncTextLayout(role);
      this.detailText.setText('Hazardous walls and the ball.');
    } else if (role === 'trainer') {
      const trainerPerspective = this._getTrainerPerspectiveView(this.currentState || {});
      this._setupTrainerBoard(roleData, this.currentState, trainerPerspective.option);
      this._syncTextLayout(role);
      buttons.push(
        {
          label: 'Maze',
          action: 'trainer_tab_maze',
          width: 120,
          x: (width / 2) - 66,
          y: 90,
          fontSize: '20px',
        },
        {
          label: 'Events',
          action: 'trainer_tab_events',
          width: 120,
          x: (width / 2) + 66,
          y: 90,
          fontSize: '20px',
        }
      );

      if (this.trainerActiveTab === 'maze') {
        const boardCenterY = this.mazeOY + (this.mazeCS * this.boardRows) / 2;
        const boardRightX = this.mazeOX + (this.mazeCS * this.boardCols);
        buttons.push(
          {
            label: '←',
            action: 'trainer_prev_view',
            width: 52,
            x: Math.max(28, this.mazeOX - 56),
            y: boardCenterY,
            fontSize: '28px',
          },
          {
            label: '→',
            action: 'trainer_next_view',
            width: 52,
            x: Math.min(width - 28, boardRightX + 56),
            y: boardCenterY,
            fontSize: '28px',
          }
        );

        const perspectiveLabel = this.add.text(width / 2, 146, `View: ${trainerPerspective.option ? trainerPerspective.option.label : 'All roles'}`, {
          fontSize: '16px',
          color: '#dde6f2',
          wordWrap: { width: width - 96 },
          align: 'center',
        }).setOrigin(0.5);
        this.roleUi.push(perspectiveLabel);
      }

      const timer = (this.currentState && this.currentState.timer) || null;
      this.trainerTimerStatusText = this.add.text(width / 2, height - 214, '', {
        fontSize: '16px',
        color: '#99bbff',
      }).setOrigin(0.5);
      this.roleUi.push(this.trainerTimerStatusText);

      buttons.push(
        { label: timer && timer.status === 'stopped' ? 'Resume' : 'Start', action: 'trainer_timer_start', width: 108, x: (width / 2) - 116, y: height - 172, fontSize: '20px' },
        { label: 'Pause', action: 'trainer_timer_stop', width: 108, x: width / 2, y: height - 172, fontSize: '20px' },
        { label: 'Reset', action: 'trainer_timer_reset', width: 108, x: (width / 2) + 116, y: height - 172, fontSize: '20px' }
      );
      const controlsDivider = this.add.rectangle(width / 2, height - 122, width - 28, 2, 0x334477, 0.9);
      this.roleUi.push(controlsDivider);

      if (this.trainerActiveTab === 'events') {
        this.detailText.setText('Trainer controls: scroll or tap timeline entries, share the selected event, and select a clarity issue to flag.');

        const feedAreaTop = this.eventsText.y - 6;
        const feedAreaHeight = Math.max(120, height - feedAreaTop - 236);
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
      }

      const clarityOptions = CLARITY_TYPES.map((entry) => {
        const selected = entry === this.trainerClarityType ? ' selected' : '';
        return `<option value="${entry}"${selected}>${humanizeClarityType(entry)}</option>`;
      }).join('');
      const claritySelect = this.add.dom((width / 2) - 52, height - 90).createFromHTML(
        `<select id="trainer-clarity-select" style="width:208px;height:42px;border-radius:10px;border:1px solid #4a5ea8;background:#171d3a;color:#ffffff;font-size:15px;padding:8px;">
          ${clarityOptions}
        </select>`
      );
      const clarityEl = claritySelect.getChildByID('trainer-clarity-select');
      if (clarityEl) {
        clarityEl.addEventListener('change', (event) => {
          const clarityType = event.target.value || CLARITY_TYPES[0];
          this.trainerClarityType = clarityType;
          sendWs({
            type: 'player_input',
            input: {
              action: 'trainer_add_clarity_event',
              clarityType,
            },
          });
        });
      }
      this.roleUi.push(claritySelect);
      buttons.push(
        { label: 'Share', action: 'trainer_share_replay', width: 108, x: (width / 2) + 132, y: height - 90, fontSize: '20px' }
      );
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
        if (item.action === 'trainer_prev_view') {
          this._cycleTrainerPerspective(-1);
          return;
        }
        if (item.action === 'trainer_next_view') {
          this._cycleTrainerPerspective(1);
          return;
        }
        if (item.action === 'trainer_timer_start') {
          const activeTimer = (this.currentState && this.currentState.timer) || {};
          const durationMs = activeTimer.durationMs || activeTimer.remainingMs || (5 * 60 * 1000);
          sendWs({ type: 'timer_start', durationMs });
          return;
        }
        if (item.action === 'trainer_timer_stop') {
          sendWs({ type: 'timer_stop' });
          return;
        }
        if (item.action === 'trainer_timer_reset') {
          const activeTimer = (this.currentState && this.currentState.timer) || {};
          const durationMs = activeTimer.durationMs || activeTimer.remainingMs || (5 * 60 * 1000);
          sendWs({ type: 'timer_reset', durationMs });
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

      if (item.action === 'trainer_timer_start' || item.action === 'trainer_timer_stop' || item.action === 'trainer_timer_reset') {
        this.trainerTimerButtons.push({ action: item.action, bg, label });
      }

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
      this._drawMarkerEmoji(key.row, key.col, '🗝️', { fontScale: 0.56 });
    }

    if (roleData.goal) {
      this._drawMarkerEmoji(roleData.goal.row, roleData.goal.col, '🏁', { fontScale: 0.58 });
    }

    this._drawPlayerMarker(maze.playerPos.row, maze.playerPos.col, 0x4488ff);
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
      this._drawMarkerEmoji(hazard.row, hazard.col, '❌', { fontScale: 0.52, alpha: 0.95 });
    }

    if (roleData.playerPos) {
      this._drawPlayerMarker(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
    }

    this._drawGhostMarkers(roleData.ghosts || [], 0xbb66ff, 0.18);
  }

  _drawKeyBoard(roleData) {
    this._drawBlankBoard();

    const keys = roleData.keys || [];
    for (const key of keys) {
      if (key.collected) {
        continue;
      }
      this._drawMarkerEmoji(key.row, key.col, '🗝️', { fontScale: 0.6 });
    }

    if (roleData.goal) {
      this._drawMarkerEmoji(roleData.goal.row, roleData.goal.col, '🏁', { fontScale: 0.62 });
    }

    if (roleData.playerPos) {
      this._drawPlayerMarker(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
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
      this._drawPlayerMarker(roleData.playerPos.row, roleData.playerPos.col, 0x4488ff);
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
      this._drawMarkerEmoji(hazard.row, hazard.col, '❌', { fontScale: 0.52, alpha: 0.95 });
    }

    for (const key of maze.keys || []) {
      if (key.collected) continue;
      this._drawMarkerEmoji(key.row, key.col, '🗝️', { fontScale: 0.56 });
    }

    for (const life of maze.lifePickups || []) {
      if (life.collected) continue;
      this._drawMarkerEmoji(life.row, life.col, '❤️', { fontScale: 0.5 });
    }

    this._drawGhostMarkers(maze.ghosts || [], 0xbb66ff, 0.2);

    if (maze.goal) {
      this._drawMarkerEmoji(maze.goal.row, maze.goal.col, '🏁', { fontScale: 0.58 });
    }
    if (maze.playerPos) {
      this._drawPlayerMarker(maze.playerPos.row, maze.playerPos.col, 0x4488ff, 0.24);
    }
  }

  _drawTrainerPerspectiveBoard(trainerPerspective) {
    const preview = trainerPerspective && trainerPerspective.option ? trainerPerspective.option : null;
    if (!preview || preview.viewerRole === 'trainer') {
      this._drawTrainerBoard((this.currentState && this.currentState.roleData) || {});
      return;
    }

    const previewRoleData = preview.roleData || {};
    if (preview.viewerRole === 'mover') {
      this._drawMoverMaze(previewRoleData);
      return;
    }
    if (preview.viewerRole === 'guide') {
      this._drawGuideBoard(previewRoleData);
      return;
    }
    if (preview.viewerRole === 'key-seer') {
      this._drawKeyBoard(previewRoleData);
      return;
    }
    if (preview.viewerRole === 'navigator') {
      this._drawNavigatorBoard(previewRoleData);
      return;
    }

    this._drawTrainerBoard((this.currentState && this.currentState.roleData) || {});
  }

  _renderBoard(roleData) {
    this._clearBoardIcons();
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
        this._drawTrainerPerspectiveBoard(this._getTrainerPerspectiveView(this.currentState || {}));
      } else if (this.mazeGraphics) {
        this.mazeGraphics.clear();
      }
    } else if (this.mazeGraphics) {
      this.mazeGraphics.clear();
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
      this.eventsText.setText('No clarity events yet.');
      this.trainerFeedVisibleEvents = [];
      this.trainerLatestEventId = null;
      if (this.trainerFeedScrollThumb) {
        this.trainerFeedScrollThumb.setVisible(false);
      }
      return;
    }

    const sorted = [...trainerEvents].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const latestEventId = sorted[0] && sorted[0].eventId ? sorted[0].eventId : null;
    if (latestEventId && latestEventId !== this.trainerLatestEventId) {
      this.trainerLatestEventId = latestEventId;
      this.trainerEventScroll = 0;
      this.trainerSelectedOffset = 0;
    }
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
      const label = truncateLabel(formatTrainerTimelineEntry(entry));
      return `${pointer} ${label}`;
    });
    const clarityCount = trainerEvents.length;
    const selectedIndex = Math.min(visible.length - 1, this.trainerSelectedOffset);
    const selected = selectedIndex >= 0 ? visible[selectedIndex] : null;
    const header = `CLARITY EVENTS\nTotal: ${clarityCount}`;
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

  _updateTrainerControls(state) {
    if (this.viewerRole !== 'trainer') {
      return;
    }

    const timer = state.timer || {};
    if (this.trainerTimerStatusText) {
      this.trainerTimerStatusText.setText(`Timer: ${formatTimerValue(timer)} • ${formatTimerStatus(timer)}`);
      this.trainerTimerStatusText.setColor(timer.status === 'expired' ? '#ff8888' : '#99bbff');
    }

    for (const button of this.trainerTimerButtons) {
      let enabled = state.status !== 'ended';
      let nextLabel = button.label.text;

      if (button.action === 'trainer_timer_start') {
        nextLabel = timer.status === 'stopped' ? 'Resume' : 'Start';
        enabled = enabled && timer.status !== 'running' && timer.status !== 'expired';
      } else if (button.action === 'trainer_timer_stop') {
        nextLabel = 'Pause';
        enabled = enabled && timer.status === 'running';
      } else if (button.action === 'trainer_timer_reset') {
        nextLabel = 'Reset';
      }

      button.label.setText(nextLabel);
      button.bg.setFillStyle(enabled ? 0x3355ff : 0x4a4f66);
      if (enabled) {
        button.bg.setInteractive({ useHandCursor: true });
      } else {
        button.bg.disableInteractive();
      }
    }
  }

  _renderState(state) {
    this.currentState = state;
    if (isFollowUpState(state)) {
      this._setRoleUiVisible(false);
      this._setFollowUpVisible(true, this.viewerRole === 'trainer');
      return;
    }

    this._setFollowUpVisible(false, false);
    this._setRoleUiVisible(true);
    const roleData = state.roleData || {};
    const summary = state.summary || {};
    const timer = state.timer || null;
    const trainerPerspective = this.viewerRole === 'trainer'
      ? this._getTrainerPerspectiveView(state)
      : null;

    if (this.viewerRole === 'trainer') {
      this._setupTrainerBoard(roleData, state, trainerPerspective && trainerPerspective.option);
    } else {
      this._setupBoard(this.viewerRole, roleData, state);
    }

    this._renderBoard(roleData);
    if (this.viewerRole !== 'trainer') {
      this._syncKeyPickupTweens(roleData);
    }

    if (this.viewerRole === 'trainer') {
      const latest = state.trainerBroadcast && state.trainerBroadcast.payload;
      if (this.trainerActiveTab === 'events') {
        this.detailText.setText(buildTrainerDetailText(roleData, summary, timer, latest));
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
      this._updateTrainerControls(state);
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

    const pendingReset = state.pendingReset || null;
    if (pendingReset) {
      if (pendingReset.cause !== this._lastPendingResetCause) {
        this._lastPendingResetCause = pendingReset.cause;
        this._showResetFeedback(pendingReset);
      } else if (this._resetFeedbackCountdownText) {
        const secsLeft = pendingReset.expiresAt
          ? Math.max(0, Math.ceil((pendingReset.expiresAt - Date.now()) / 1000))
          : 5;
        this._resetFeedbackCountdownText.setText(`Resetting in ${secsLeft}…`);
      }
    } else {
      if (this._lastPendingResetCause !== null) {
        this._lastPendingResetCause = null;
        this._hideResetFeedback();
      }
    }
  }

  update(_time, delta) {
    if (!this.currentState) {
      return;
    }
    if (this._stepPlayerMarkerAnimation(delta) || this._stepGhostMarkerAnimation(delta)) {
      this._renderBoard(this.currentState.roleData || {});
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
    const canRestart = this.viewerRole === 'trainer' && state.canRestart;
    const subtitle = this.add.text(width / 2, height / 2 + 22, canRestart ? 'Tap restart to play again.' : 'Waiting for the host to restart the round.', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5).setDepth(11);

    this.endUi = [overlay, title, subtitle];
    if (canRestart) {
      const restartBg = this.add.rectangle(width / 2, height / 2 + 74, 196, 52, 0x22aa55)
        .setDepth(11)
        .setInteractive({ useHandCursor: true });
      const restartLabel = this.add.text(width / 2, height / 2 + 74, 'Restart', {
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12);
      restartBg.on('pointerover', () => restartBg.setFillStyle(0x44cc77));
      restartBg.on('pointerout', () => restartBg.setFillStyle(0x22aa55));
      restartBg.on('pointerup', () => sendWs({ type: 'game_restart' }));
      this.endUi.push(restartBg, restartLabel);
    }
  }

  _showResetFeedback(pendingReset) {
    this._clearResetFeedbackUi();
    const { width, height } = this.scale;
    const icon = pendingReset.cause === 'wall' ? '🧱' : pendingReset.cause === 'ghost' ? '👻' : '✖';
    const secsLeft = pendingReset.expiresAt
      ? Math.max(0, Math.ceil((pendingReset.expiresAt - Date.now()) / 1000))
      : 5;

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.78).setDepth(14);
    const iconText = this.add.text(width / 2, height / 2 - 90, icon, {
      fontSize: '72px',
    }).setOrigin(0.5).setDepth(15);
    const titleText = this.add.text(width / 2, height / 2 + 10, pendingReset.message || 'Reset!', {
      fontSize: '28px',
      color: '#ff6666',
      fontStyle: 'bold',
      wordWrap: { width: width - 40 },
    }).setOrigin(0.5).setDepth(15);
    const countdownText = this.add.text(width / 2, height / 2 + 68, `Resetting in ${secsLeft}…`, {
      fontSize: '18px',
      color: '#999999',
    }).setOrigin(0.5).setDepth(15);

    this.resetFeedbackUi = [overlay, iconText, titleText, countdownText];
    this._resetFeedbackCountdownText = countdownText;
  }

  _hideResetFeedback() {
    this._clearResetFeedbackUi();
  }

  _clearResetFeedbackUi() {
    if (!this.resetFeedbackUi) {
      return;
    }
    for (const item of this.resetFeedbackUi) {
      item.destroy();
    }
    this.resetFeedbackUi = null;
    this._resetFeedbackCountdownText = null;
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
      if (this.pendingProbeId) {
        const latencyMs = Math.max(0, Date.now() - (this.pendingProbeSentAt || Date.now()));
        if (latencyMs >= CONNECTION_WARNING_LATENCY_MS) {
          this.latencyWarningStreak += 1;
          if (this.latencyWarningStreak >= CONNECTION_WARNING_LATENCY_STREAK) {
            this._showConnectionWarning('slow_response', `High latency (${latencyMs}ms)`);
          }
        } else {
          this.latencyWarningStreak = 0;
        }
      }
      this.pendingProbeId = 0;
      this.pendingProbeSentAt = 0;
      if (this.pendingProbeReason === 'slow_response' || this.pendingProbeReason === 'socket_error') {
        if (this.latencyWarningStreak === 0) {
          this.pendingProbeReason = null;
        }
      }
      this._renderState(message.state);
      this._hideConnectionUi();
      this._syncConnectionWarning();
      return;
    }

    if (message.type === 'join_error' && message.code === 'reconnect_replaced') {
      const sessionId = getCurrentSessionIdFromUrl();
      if (sessionId) {
        clearReconnectState(sessionId);
      }
      pendingReconnectToken = null;
      this.scene.start('JoinScene');
      return;
    }

    if (message.type === 'session_closed') {
      this.onClose();
    }
  }

  onClose() {
    if (ensureConnectedAndResync(this.game)) {
      this._showConnectionUi('Connection lost', 'Trying to reconnect…', true);
      return;
    }
    this._showConnectionUi('Disconnected', 'Tap reset connection to try again.', true);
  }

  onSocketOpen() {
    this.pendingProbeId = 0;
    this.pendingProbeSentAt = 0;
    if (this.pendingProbeReason === 'slow_response' || this.pendingProbeReason === 'socket_error') {
      this.pendingProbeReason = null;
    }
    this.latencyWarningStreak = 0;
    this._syncConnectionWarning();
  }

  onSocketError() {
    if (socket && socket.readyState === WebSocket.CLOSING) {
      return;
    }
    this._showConnectionWarning('socket_error');
  }

  shutdown() {
    this.game.events.off('ws_message', this.onMessage, this);
    this.game.events.off('ws_close', this.onClose, this);
    this.game.events.off('ws_open', this.onSocketOpen, this);
    this.game.events.off('ws_error', this.onSocketError, this);
    this.input.off('wheel', this.onWheel, this);
    document.removeEventListener('visibilitychange', this.onVisibilitySync);
    window.removeEventListener('pageshow', this.onConnectionWake);
    window.removeEventListener('online', this.onConnectionWake);
    window.removeEventListener('offline', this.onConnectionRisk);
    if (this.connectionProbeEvent) {
      this.connectionProbeEvent.remove(false);
      this.connectionProbeEvent = null;
    }
    this.pendingProbeId = 0;
    this.pendingProbeSentAt = 0;
    this.latencyWarningStreak = 0;
    this._clearBoardIcons();
    this._clearResetFeedbackUi();
    this._hideConnectionUi();
    this._hideConnectionWarning();
  }

  _sendMove(dir) {
    if (isFollowUpState(this.currentState)) {
      return;
    }
    const now = screenDependencies.now();
    if (now - this.lastMoveSentAt < 120) {
      return;
    }
    this.lastMoveSentAt = now;
    sendWs({ type: 'player_input', input: { action: 'move', dir } });
  }

  onVisibilitySync() {
    if (document.visibilityState === 'visible') {
      this.onConnectionWake();
      return;
    }
    this.onConnectionRisk();
  }

  onConnectionWake() {
    if (this.pendingProbeReason === 'backgrounded' || this.pendingProbeReason === 'offline') {
      this.pendingProbeReason = null;
    }
    if (ensureConnectedAndResync(this.game)) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        this._hideConnectionUi();
      } else {
        this._showConnectionUi('Reconnecting', 'Trying to restore the session…', true);
      }
      this._syncConnectionWarning();
      return;
    }
    this._syncConnectionWarning();
    this._showConnectionUi('Disconnected', 'Tap reset connection to try again.', true);
  }

  onConnectionRisk() {
    this._syncConnectionWarning();
  }

  onManualReconnect() {
    this._showConnectionUi('Resetting connection', 'Starting a fresh reconnect…', false);
    if (socket) {
      socket._superseded = true;
      socket.close();
      socket = null;
    }

    if (!ensureConnectedAndResync(this.game)) {
      this.scene.start('JoinScene');
      return;
    }

    this.time.delayedCall(2000, () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        this._showConnectionUi('Still reconnecting', 'Keep this page active, then try reset again.', true);
      }
    });
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
  width: controllerViewSettings.width || 390,
  height: controllerViewSettings.height || 844,
  backgroundColor: controllerViewSettings.backgroundColor || '#1a1a2e',
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
