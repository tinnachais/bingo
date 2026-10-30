import { GameSocket, toast, store, letterFor, confetti } from '/js/common.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const roomCode = (params.get('code') || '').toUpperCase();
const name = params.get('name') || 'Player';
const wantCards = params.get('cards') || '1';

if (!roomCode) location.href = '/';

let playerId = null;
let cards = [];          // original order; index === server cardIndex
let called = [];
let calledSet = new Set();
let pattern = 'line';
let status = 'lobby';
let winInfo = null;      // { cardIndex, cells } once you win
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

// Remember our player id per room so a refresh / screen-lock rejoins the SAME cards.
const idKey = `cb_pid_${roomCode}`;
const savedId = store.get(idKey);

const sock = new GameSocket({
  onMessage: handle,
  onStatus: (s) => {
    const el = $('#conn');
    el.classList.toggle('down', s === 'down');
    $('#connText').textContent = s === 'open' ? 'ออนไลน์' : s === 'down' ? 'หลุด — กำลังต่อใหม่' : 'กำลังเชื่อม…';
  },
});

sock.onReady = () => {
  if (savedId) sock.send({ type: 'player_reconnect', roomCode, playerId: savedId });
  else join();
};

function join() {
  sock.send({ type: 'player_join', roomCode, name, cards: wantCards });
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      playerId = msg.playerId;
      cards = msg.cards;
      pattern = msg.hostPattern || pattern;
      store.set(idKey, playerId);
      $('#playerName').textContent = msg.name;
      $('#roomCode').textContent = roomCode;
      renderCards();
      break;
    case 'cards': // new game: fresh cards
      cards = msg.cards;
      winInfo = null;
      renderCards();
      break;
    case 'rejoin_failed':
      store.del(idKey);
      join();
      break;
    case 'state':
      applyState(msg);
      break;
    case 'claim_result':
      if (msg.ok) {
        winInfo = { cardIndex: msg.cardIndex, cells: msg.cells };
        confetti();
        renderCards();
      } else {
        toast(msg.message || 'ยังไม่บิงโก');
      }
      break;
    case 'winner':
      // handled via state (status flips to 'won'); show toast if it's not us
      break;
    case 'error':
      toast(msg.message || 'เกิดข้อผิดพลาด');
      if (/ไม่พบห้อง|ห้องปิด/.test(msg.message || '')) setTimeout(() => (location.href = '/'), 1800);
      break;
  }
}

function applyState(s) {
  called = s.called || [];
  calledSet = new Set(called);
  pattern = s.pattern;
  status = s.status;
  $('#roomCode').textContent = s.roomCode;
  $('#calledCount').textContent = called.length;
  $('#lastCall').textContent = s.lastCalled ? `${s.lastLetter}-${s.lastCalled}` : '—';
  $('#patternPill').textContent = 'รูปแบบ: ' + (s.patternLabel || s.pattern);

  const banner = $('#statusBanner');
  if (status === 'won' && s.winners && s.winners.length) {
    const w = s.winners[s.winners.length - 1];
    const mine = winInfo !== null;
    banner.className = mine ? 'banner' : 'banner lose';
    banner.innerHTML = mine
      ? `🎉 คุณชนะ! (${w.patternLabel})`
      : `🏆 <b>${escapeHtml(w.name)}</b> บิงโกแล้ว! (${w.patternLabel}) — รอเจ้ามือเริ่มรอบใหม่`;
  } else if (status === 'playing') {
    banner.className = ''; banner.innerHTML = '';
  } else {
    banner.className = 'banner'; banner.style.background = ''; banner.textContent = '⏳ รอเจ้ามือเริ่มเกม…';
  }
  $('#hint').classList.toggle('hidden', status !== 'playing');
  renderCards();
}

// ---- Bingo win check (client mirror of server, to light up the BINGO button) ----
function marked(grid, r, c) { return grid[r][c] === 0 || calledSet.has(grid[r][c]); }
function hasWin(grid) {
  const m = (r, c) => marked(grid, r, c);
  if (pattern === 'blackout') { for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (!m(r, c)) return false; return true; }
  if (pattern === 'four_corners') return m(0,0)&&m(0,4)&&m(4,0)&&m(4,4);
  if (pattern === 'x') { for (let i=0;i<5;i++) if(!m(i,i)||!m(i,4-i)) return false; return true; }
  for (let r = 0; r < 5; r++) { let f = true; for (let c = 0; c < 5; c++) if (!m(r,c)) f = false; if (f) return true; }
  for (let c = 0; c < 5; c++) { let f = true; for (let r = 0; r < 5; r++) if (!m(r,c)) f = false; if (f) return true; }
  let d = true; for (let i=0;i<5;i++) if(!m(i,i)) d=false; if (d) return true;
  d = true; for (let i=0;i<5;i++) if(!m(i,4-i)) d=false; return d;
}
function hitCount(grid) {
  let n = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (grid[r][c] !== 0 && calledSet.has(grid[r][c])) n++;
  return n;
}

function renderCards() {
  const host = $('#cards');
  host.innerHTML = '';

  // Sort display order: most matched numbers first (the "hot" card floats to top).
  const ordered = cards
    .map((card, idx) => ({ card, idx, hits: hitCount(card), win: hasWin(card) }))
    .sort((a, b) => (b.win - a.win) || (b.hits - a.hits));

  let anyWin = false;
  for (const { card, idx, hits, win } of ordered) {
    if (win) anyWin = true;
    host.appendChild(renderOne(card, idx, hits, win));
  }

  const btn = $('#bingoBtn');
  const canClaim = status === 'playing' && anyWin && winInfo === null;
  btn.disabled = !canClaim;
  btn.textContent = canClaim ? 'กด BINGO! 🎉' : (status === 'won' ? 'จบรอบแล้ว' : 'ยังไม่ครบ…');
}

function renderOne(grid, idx, hits, win) {
  const wrap = document.createElement('div');
  wrap.className = 'card bingo-card';
  const isWinningCard = winInfo && winInfo.cardIndex === idx;
  const winCells = isWinningCard ? new Set(winInfo.cells.map(([r, c]) => r * 5 + c)) : null;

  const title = document.createElement('div');
  title.className = 'title';
  title.innerHTML = `<b>การ์ด #${idx + 1}${win ? ' 🔥' : ''}</b><span>ตรงแล้ว ${hits}/24</span>`;
  wrap.appendChild(title);

  const grid5 = document.createElement('div');
  grid5.className = 'grid5';
  for (const L of LETTERS) { const h = document.createElement('div'); h.className = 'head'; h.textContent = L; grid5.appendChild(h); }
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const v = grid[r][c];
      const sq = document.createElement('div');
      const isHit = v !== 0 && calledSet.has(v);
      sq.className = 'sq' + (v === 0 ? ' free' : '') + (isHit ? ' hit daub' : '');
      if (winCells && winCells.has(r * 5 + c)) sq.classList.add('win');
      sq.textContent = v === 0 ? 'FREE' : v;
      grid5.appendChild(sq);
    }
  }
  wrap.appendChild(grid5);
  return wrap;
}

$('#bingoBtn').onclick = () => {
  if ($('#bingoBtn').disabled) return;
  sock.send({ type: 'player_claim', roomCode, playerId });
};

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
