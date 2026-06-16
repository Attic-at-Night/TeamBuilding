const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('session') || '').toUpperCase();

const sessionIdElement = document.getElementById('session-id');
const nameElement = document.getElementById('name');
const joinButton = document.getElementById('join');
const statusElement = document.getElementById('status');
const lobbyElement = document.getElementById('lobby');
const gameAreaElement = document.getElementById('game-area');
const buzzerButton = document.getElementById('buzz');

sessionIdElement.textContent = sessionId || 'Missing session';

let socket;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.className = `status${isError ? ' error' : ''}`;
}

function applyState(state) {
  const isPlaying = state.status === 'playing';
  lobbyElement.style.display = isPlaying ? 'none' : 'block';
  gameAreaElement.style.display = isPlaying ? 'block' : 'none';
}

joinButton.addEventListener('click', () => {
  if (!sessionId) {
    setStatus('Invalid join link. Missing session code.', true);
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'controller_join',
      sessionId,
      name: nameElement.value,
    }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'client_registered') {
      setStatus('Connected! Waiting for the game to start\u2026');
      joinButton.disabled = true;
      nameElement.disabled = true;
      return;
    }

    if (message.type === 'state_sync') {
      applyState(message.state);
      return;
    }

    if (message.type === 'join_error') {
      setStatus(message.message || 'Unable to join session.', true);
      socket.close();
      return;
    }

    if (message.type === 'session_closed') {
      setStatus('Session ended.', true);
      joinButton.disabled = false;
      nameElement.disabled = false;
      lobbyElement.style.display = 'block';
      gameAreaElement.style.display = 'none';
    }
  });
});

buzzerButton.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'player_input',
      input: { action: 'buzz' },
    }));
  }
});
