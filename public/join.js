const params = new URLSearchParams(window.location.search);
const sessionId = (params.get('session') || '').toUpperCase();

const sessionIdElement = document.getElementById('session-id');
const nameElement = document.getElementById('name');
const joinButton = document.getElementById('join');
const statusElement = document.getElementById('status');

sessionIdElement.textContent = sessionId || 'Missing session';

let socket;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.className = `status${isError ? ' error' : ''}`;
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
      type: 'participant_join',
      sessionId,
      name: nameElement.value,
    }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'joined') {
      setStatus('Connected! You are now in the session.');
      joinButton.disabled = true;
      nameElement.disabled = true;
      return;
    }

    if (message.type === 'join_error') {
      setStatus(message.message || 'Unable to join session.', true);
      socket.close();
      return;
    }

    if (message.type === 'session_closed') {
      setStatus('Host ended the session.', true);
      joinButton.disabled = false;
      nameElement.disabled = false;
    }
  });
});
