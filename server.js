// Cruise Bingo — real-time multiplayer 75-ball bingo server.
// Serves the static mobile web app and runs the game over WebSockets.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
// Bind to 127.0.0.1 when running behind a reverse proxy (nginx); default to
// all interfaces for local/LAN play. Override with HOST=127.0.0.1 in prod.
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------------------------
// Bingo primitives
// ---------------------------------------------------------------------------
const COLUMN_RANGES = [
  [1, 15],   // B
  [16, 30],  // I
  [31, 45],  // N
  [46, 60],  // G
  [61, 75],  // O
];
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

// Win patterns we support. Each is a list of winning cell-sets (row/col indices).
const WIN_PATTERNS = {
  line: 'Any line (row, column or diagonal)',
  blackout: 'Full card (blackout)',
  four_corners: 'Four corners',
  x: 'Letter X (both diagonals)',
};

function letterFor(num) {
  return LETTERS[Math.floor((num - 1) / 15)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate a 5x5 card as grid[row][col]; center (2,2) is 0 == FREE space.
function generateCard() {
  const grid = Array.from({ length: 5 }, () => new Array(5).fill(0));
  for (let col = 0; col < 5; col++) {
    const [lo, hi] = COLUMN_RANGES[col];
    const pool = [];
    for (let n = lo; n <= hi; n++) pool.push(n);
    shuffle(pool);
    for (let row = 0; row < 5; row++) {
      grid[row][col] = col === 2 && row === 2 ? 0 : pool[row];
    }
  }
  return grid;
}

function isMarked(grid, row, col, calledSet) {
  const v = grid[row][col];
  return v === 0 || calledSet.has(v);
}

// Returns the winning cells (array of [row,col]) for a pattern, or null if no win.
function checkWin(grid, calledSet, pattern) {
  const marked = (r, c) => isMarked(grid, r, c, calledSet);

  if (pattern === 'blackout') {
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        if (!marked(r, c)) return null;
    const cells = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push([r, c]);
    return cells;
  }

  if (pattern === 'four_corners') {
    const corners = [[0, 0], [0, 4], [4, 0], [4, 4]];
    return corners.every(([r, c]) => marked(r, c)) ? corners : null;
  }

  if (pattern === 'x') {
    const cells = [];
    let ok = true;
    for (let i = 0; i < 5; i++) {
      if (!marked(i, i)) ok = false;
      if (!marked(i, 4 - i)) ok = false;
      cells.push([i, i], [i, 4 - i]);
    }
    return ok ? cells : null;
  }

  // default: 'line' — any full row, column or diagonal
  for (let r = 0; r < 5; r++) {
    let full = true;
    for (let c = 0; c < 5; c++) if (!marked(r, c)) { full = false; break; }
    if (full) return [0, 1, 2, 3, 4].map((c) => [r, c]);
  }
  for (let c = 0; c < 5; c++) {
    let full = true;
    for (let r = 0; r < 5; r++) if (!marked(r, c)) { full = false; break; }
    if (full) return [0, 1, 2, 3, 4].map((r) => [r, c]);
  }
  let diag = true;
  for (let i = 0; i < 5; i++) if (!marked(i, i)) { diag = false; break; }
  if (diag) return [0, 1, 2, 3, 4].map((i) => [i, i]);
  diag = true;
  for (let i = 0; i < 5; i++) if (!marked(i, 4 - i)) { diag = false; break; }
  if (diag) return [0, 1, 2, 3, 4].map((i) => [i, 4 - i]);

  return null;
}

// ---------------------------------------------------------------------------
// Rooms & state
// ---------------------------------------------------------------------------
/** @type {Map<string, Room>} */
const rooms = new Map();

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code,
    hostToken: randomUUID(),
    status: 'lobby', // lobby | playing | won
    pattern: 'line',
    called: [],              // numbers in call order
    pool: shuffle(Array.from({ length: 75 }, (_, i) => i + 1)),
    players: new Map(),      // playerId -> { id, name, cards:[grid], connected }
    winners: [],             // { name, pattern, cellsByCard }
    maxCards: 4,
    conns: new Set(),        // all ws connections in this room
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function publicState(room) {
  return {
    type: 'state',
    roomCode: room.code,
    status: room.status,
    pattern: room.pattern,
    patternLabel: WIN_PATTERNS[room.pattern],
    called: room.called,
    lastCalled: room.called.length ? room.called[room.called.length - 1] : null,
    lastLetter: room.called.length ? letterFor(room.called[room.called.length - 1]) : null,
    remaining: 75 - room.called.length,
    maxCards: room.maxCards,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.cards.length,
      connected: p.connected,
    })),
    winners: room.winners,
  };
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastState(room) {
  room.lastActivity = Date.now();
  const state = publicState(room);
  for (const ws of room.conns) send(ws, state);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------
function requireHost(room, token) {
  return room && room.hostToken === token;
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: 'Bad message' }); }
  const room = msg.roomCode ? rooms.get(String(msg.roomCode).toUpperCase()) : null;

  switch (msg.type) {
    // ---- Host ----
    case 'host_create': {
      const r = createRoom();
      ws.meta = { role: 'host', roomCode: r.code };
      r.conns.add(ws);
      send(ws, { type: 'room_created', roomCode: r.code, hostToken: r.hostToken });
      broadcastState(r);
      break;
    }
    case 'host_reconnect': {
      if (!requireHost(room, msg.hostToken)) return send(ws, { type: 'error', message: 'Room not found' });
      ws.meta = { role: 'host', roomCode: room.code };
      room.conns.add(ws);
      send(ws, { type: 'room_created', roomCode: room.code, hostToken: room.hostToken });
      broadcastState(room);
      break;
    }
    case 'host_set_pattern': {
      if (!requireHost(room, msg.hostToken)) return;
      if (WIN_PATTERNS[msg.pattern] && room.status !== 'playing') room.pattern = msg.pattern;
      broadcastState(room);
      break;
    }
    case 'host_set_maxcards': {
      if (!requireHost(room, msg.hostToken)) return;
      const n = parseInt(msg.maxCards, 10);
      if (n >= 1 && n <= 12) room.maxCards = n;
      broadcastState(room);
      break;
    }
    case 'host_start': {
      if (!requireHost(room, msg.hostToken)) return;
      if (WIN_PATTERNS[msg.pattern]) room.pattern = msg.pattern;
      room.status = 'playing';
      room.called = [];
      room.pool = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
      room.winners = [];
      broadcastState(room);
      break;
    }
    case 'host_draw': {
      if (!requireHost(room, msg.hostToken)) return;
      if (room.status !== 'playing' || room.pool.length === 0) return;
      const n = room.pool.pop();
      room.called.push(n);
      broadcastState(room);
      break;
    }
    case 'host_reset': {
      if (!requireHost(room, msg.hostToken)) return;
      room.status = 'lobby';
      room.called = [];
      room.pool = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
      room.winners = [];
      // keep players but regenerate fresh cards for a new game
      for (const p of room.players.values()) {
        p.cards = p.cards.map(() => generateCard());
        for (const c of room.conns) {
          if (c.meta?.role === 'player' && c.meta.playerId === p.id) {
            send(c, { type: 'cards', cards: p.cards });
          }
        }
      }
      broadcastState(room);
      break;
    }

    // ---- Player ----
    case 'player_join': {
      if (!room) return send(ws, { type: 'error', message: 'ไม่พบห้องนี้ — ตรวจรหัสอีกครั้ง' });
      const name = String(msg.name || '').trim().slice(0, 20) || 'Player';
      const count = Math.max(1, Math.min(room.maxCards, parseInt(msg.cards, 10) || 1));
      const id = randomUUID();
      const player = { id, name, cards: Array.from({ length: count }, generateCard), connected: true };
      room.players.set(id, player);
      ws.meta = { role: 'player', roomCode: room.code, playerId: id };
      room.conns.add(ws);
      send(ws, { type: 'joined', playerId: id, name, cards: player.cards, hostPattern: room.pattern });
      broadcastState(room);
      break;
    }
    case 'player_reconnect': {
      if (!room) return send(ws, { type: 'error', message: 'ห้องปิดไปแล้ว' });
      const player = room.players.get(msg.playerId);
      if (!player) return send(ws, { type: 'rejoin_failed' });
      player.connected = true;
      ws.meta = { role: 'player', roomCode: room.code, playerId: player.id };
      room.conns.add(ws);
      send(ws, { type: 'joined', playerId: player.id, name: player.name, cards: player.cards, hostPattern: room.pattern });
      broadcastState(room);
      break;
    }
    case 'player_claim': {
      if (!room || room.status !== 'playing') return;
      const player = room.players.get(msg.playerId);
      if (!player) return;
      const calledSet = new Set(room.called);
      let winningCard = null;
      let cells = null;
      player.cards.forEach((card, idx) => {
        if (winningCard !== null) return;
        const w = checkWin(card, calledSet, room.pattern);
        if (w) { winningCard = idx; cells = w; }
      });
      if (winningCard === null) {
        return send(ws, { type: 'claim_result', ok: false, message: 'ยังไม่บิงโกนะ ลองเช็กอีกที!' });
      }
      room.status = 'won';
      room.winners.push({ name: player.name, pattern: room.pattern, patternLabel: WIN_PATTERNS[room.pattern] });
      send(ws, { type: 'claim_result', ok: true, cardIndex: winningCard, cells });
      for (const c of room.conns) {
        send(c, { type: 'winner', name: player.name, patternLabel: WIN_PATTERNS[room.pattern] });
      }
      broadcastState(room);
      break;
    }

    default:
      send(ws, { type: 'error', message: 'Unknown action' });
  }
}

function handleClose(ws) {
  const meta = ws.meta;
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (!room) return;
  room.conns.delete(ws);
  if (meta.role === 'player') {
    const player = room.players.get(meta.playerId);
    // Only mark offline if no other connection for this player remains.
    const stillHere = [...room.conns].some((c) => c.meta?.role === 'player' && c.meta.playerId === meta.playerId);
    if (player && !stillHere) player.connected = false;
  }
  broadcastState(room);
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end('Server error');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => handleClose(ws));
  ws.on('error', () => {});
});

// Heartbeat: drop dead sockets so player "connected" dots stay accurate.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

// Sweep: delete rooms with no connections after 30 minutes idle.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.conns.size === 0 && now - room.lastActivity > 30 * 60 * 1000) rooms.delete(code);
  }
}, 60000);

server.listen(PORT, HOST, () => {
  console.log(`Cruise Bingo running on http://${HOST}:${PORT}`);
});
