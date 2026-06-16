const startButton = document.getElementById('start-session');
const startGameButton = document.getElementById('start-game');
const sessionIdElement = document.getElementById('session-id');
const qrCodeElement = document.getElementById('qr-code');
const joinUrlElement = document.getElementById('join-url');
const connectionInfoElement = document.getElementById('connection-info');
const gameStatusElement = document.getElementById('game-status');
const playersElement = document.getElementById('players');
const gameAreaElement = document.getElementById('game-area');
const inputLogElement = document.getElementById('input-log');

let socket;

function renderPlayers(players) {
  playersElement.innerHTML = '';

  if (!players.length) {
    const li = document.createElement('li');
    li.textContent = 'No players connected yet.';
    playersElement.appendChild(li);
    return;
  }

  for (const player of players) {
    const li = document.createElement('li');
    li.textContent = player.name;
    li.dataset.id = player.id;
    playersElement.appendChild(li);
  }
}

function renderState(state) {
  gameStatusElement.textContent = `Status: ${state.status}`;
  renderPlayers(state.players || []);

  const isLobby = state.status === 'lobby';
  const isPlaying = state.status === 'playing';
  startGameButton.style.display = isLobby && (state.players || []).length > 0 ? 'inline-block' : 'none';
  gameAreaElement.style.display = isPlaying ? 'block' : 'none';
}

function renderConnectionInfo(connection) {
  if (!connection) {
    connectionInfoElement.textContent = '';
    return;
  }

  const parts = [];
  if (connection.ipAddress) parts.push(`IP: ${connection.ipAddress}`);
  if (connection.interfaceName) parts.push(`Adapter: ${connection.interfaceName}`);
  if (connection.networkName) parts.push(`Network: ${connection.networkName}`);

  connectionInfoElement.textContent = parts.length ? `Connection: ${parts.join(' • ')}` : '';
}

function logInput(playerId, input) {
  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  item.textContent = `[${time}] Player ${playerId.slice(0, 6)}… → ${JSON.stringify(input)}`;
  inputLogElement.prepend(item);
}

function connectDisplaySocket(sessionId) {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'display_register', sessionId }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'state_sync') {
      renderState(message.state);
      return;
    }

    if (message.type === 'player_input') {
      logInput(message.playerId, message.input);
    }
  });

  socket.addEventListener('close', () => {
    gameStatusElement.textContent = 'Disconnected. Refresh to reconnect.';
  });
}

startButton.addEventListener('click', async () => {
  const response = await fetch('/api/session', { method: 'POST' });
  const { sessionId, joinUrl, qrCodeDataUrl, connection } = await response.json();

  sessionIdElement.textContent = sessionId;
  qrCodeElement.src = qrCodeDataUrl;
  qrCodeElement.style.display = 'block';

  joinUrlElement.textContent = joinUrl;
  joinUrlElement.href = joinUrl;

  renderConnectionInfo(connection);
  startGameButton.style.display = 'none';
  connectDisplaySocket(sessionId);
});

startGameButton.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'game_start' }));
  }
});
