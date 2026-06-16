const startButton = document.getElementById('start-session');
const sessionIdElement = document.getElementById('session-id');
const qrCodeElement = document.getElementById('qr-code');
const joinUrlElement = document.getElementById('join-url');
const participantsElement = document.getElementById('participants');

let socket;

function renderParticipants(participants) {
  participantsElement.innerHTML = '';

  if (!participants.length) {
    const li = document.createElement('li');
    li.textContent = 'No players connected yet.';
    participantsElement.appendChild(li);
    return;
  }

  for (const participant of participants) {
    const li = document.createElement('li');
    li.textContent = participant.name;
    participantsElement.appendChild(li);
  }
}

function connectHostSocket(sessionId) {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'host_register', sessionId }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'participants_update') {
      renderParticipants(message.participants || []);
    }
  });
}

startButton.addEventListener('click', async () => {
  const response = await fetch('/api/session', { method: 'POST' });
  const { sessionId, joinUrl, qrCodeDataUrl } = await response.json();

  sessionIdElement.textContent = sessionId;
  qrCodeElement.src = qrCodeDataUrl;
  qrCodeElement.style.display = 'block';

  joinUrlElement.textContent = joinUrl;
  joinUrlElement.href = joinUrl;

  renderParticipants([]);
  connectHostSocket(sessionId);
});
