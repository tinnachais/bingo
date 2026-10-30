import { GameSocket, toast, store, letterFor, confetti } from '/js/common.js';

const $ = (s) => document.querySelector(s);
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

let roomCode = null;
let hostToken = null;
let status = 'lobby';
let autoTimer = null;
let lastShown = null;

// Reuse an existing room if the host refreshes.
const saved = store.get('cb_host');

const sock = new GameSocket({
  onMessage: handle,
  onStatus: (s) => {
    const el = $('#conn');
    el.classList.toggle('down', s === 'down');
    $('#connText').textContent = s === 'open' ? 'ออนไลน์' : s === 'down' ? 'หลุด — กำลังต่อใหม่' : 'กำลังเชื่อม…';
  },
});

sock.onReady = () => {
  if (saved && saved.roomCode && saved.hostToken) {
    sock.send({ type: 'host_reconnect', roomCode: saved.roomCode, hostToken: saved.hostToken });
  } else {
    sock.send({ type: 'host_create' });
  }
};

function handle(msg) {
  switch (msg.type) {
    case 'room_created':
      roomCode = msg.roomCode;
      hostToken = msg.hostToken;
      store.set('cb_host', { roomCode, hostToken });
      $('#roomCode').textContent = roomCode;
      $('#joinUrl').textContent = location.host;
      break;
    case 'state':
      applyState(msg);
      break;
    case 'winner':
      confetti(2200);
      break;
    case 'error':
      toast(msg.message || 'ผิดพลาด');
      if (/Room not found/.test(msg.message || '')) { store.del('cb_host'); sock.send({ type: 'host_create' }); }
      break;
  }
}

function applyState(s) {
  status = s.status;
  roomCode = s.roomCode;
  $('#roomCode').textContent = s.roomCode;
  $('#joinUrl').textContent = location.host;
  $('#calledCount').textContent = s.called.length;
  $('#remaining').textContent = s.remaining;
  $('#patternLabel').textContent = s.patternLabel || s.pattern;
  $('#pattern').value = s.pattern;

  const inGame = s.status !== 'lobby';
  $('#lobbyCard').classList.toggle('hidden', inGame);
  $('#callerCard').classList.toggle('hidden', !inGame);
  $('#boardCard').classList.toggle('hidden', !inGame);
  $('#drawBtn').disabled = s.status !== 'playing' || s.remaining === 0;

  // Last called ball (animate only on a new number)
  if (s.lastCalled && s.lastCalled !== lastShown) {
    lastShown = s.lastCalled;
    const ball = $('#ball');
    ball.className = 'ball animate';
    ball.innerHTML = `<span class="letter">${s.lastLetter}</span><span class="num">${s.lastCalled}</span>`;
  } else if (!s.lastCalled) {
    lastShown = null;
    $('#ball').className = 'ball empty';
    $('#ball').innerHTML = '<span class="num">—</span>';
  }

  renderBoard(new Set(s.called), s.lastCalled);
  renderPlayers(s.players);

  const wb = $('#winBanner');
  if (s.status === 'won' && s.winners.length) {
    const w = s.winners[s.winners.length - 1];
    wb.className = 'banner';
    wb.innerHTML = `🏆 <b>${escapeHtml(w.name)}</b> บิงโก! (${w.patternLabel}) — กด “รอบใหม่” เพื่อเล่นต่อ`;
    stopAuto();
  } else {
    wb.className = ''; wb.innerHTML = '';
  }
}

let boardBuilt = false;
function renderBoard(calledSet, latest) {
  const board = $('#board');
  if (!boardBuilt) {
    board.innerHTML = '';
    for (let row = 0; row < 5; row++) {
      const h = document.createElement('div'); h.className = 'hdr'; h.textContent = LETTERS[row]; board.appendChild(h);
      for (let n = row * 15 + 1; n <= row * 15 + 15; n++) {
        const cell = document.createElement('div'); cell.className = 'cell'; cell.dataset.n = n; cell.textContent = n; board.appendChild(cell);
      }
    }
    boardBuilt = true;
  }
  board.querySelectorAll('.cell').forEach((cell) => {
    const n = +cell.dataset.n;
    cell.classList.toggle('called', calledSet.has(n));
    cell.classList.toggle('latest', n === latest);
  });
}

function renderPlayers(players) {
  $('#playerCount').textContent = players.length;
  const host = $('#players');
  if (!players.length) { host.innerHTML = '<span class="note">ยังไม่มีผู้เล่นเข้าห้อง</span>'; return; }
  host.innerHTML = '';
  for (const p of players) {
    const el = document.createElement('span');
    el.className = 'p';
    el.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span>${escapeHtml(p.name)} <b style="color:var(--muted)">×${p.cardCount}</b>`;
    host.appendChild(el);
  }
}

// ---- Controls ----
$('#startBtn').onclick = () => {
  sock.send({ type: 'host_start', roomCode, hostToken, pattern: $('#pattern').value });
};
$('#pattern').onchange = () => {
  if (status === 'lobby') sock.send({ type: 'host_set_pattern', roomCode, hostToken, pattern: $('#pattern').value });
};
$('#maxCards').onchange = () => {
  sock.send({ type: 'host_set_maxcards', roomCode, hostToken, maxCards: +$('#maxCards').value });
};
$('#drawBtn').onclick = () => sock.send({ type: 'host_draw', roomCode, hostToken });
$('#resetBtn').onclick = () => {
  stopAuto();
  sock.send({ type: 'host_reset', roomCode, hostToken });
};

function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; $('#autoBtn').textContent = '⏱️ เรียกอัตโนมัติ: ปิด'; $('#autoBtn').classList.remove('secondary'); }
}
$('#autoBtn').onclick = () => {
  if (autoTimer) { stopAuto(); return; }
  autoTimer = setInterval(() => {
    if (status === 'playing') sock.send({ type: 'host_draw', roomCode, hostToken });
  }, 4000);
  $('#autoBtn').textContent = '⏱️ เรียกอัตโนมัติ: เปิด (ทุก 4 วิ)';
  $('#autoBtn').classList.add('secondary');
};

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
