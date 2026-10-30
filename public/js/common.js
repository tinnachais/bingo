// Shared helpers: reconnecting WebSocket, toast, confetti, storage.
export function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class GameSocket {
  constructor({ onMessage, onStatus } = {}) {
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.queue = [];
    this.ws = null;
    this._connect();
  }
  _connect() {
    this.onStatus('connecting');
    const ws = new WebSocket(wsURL());
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus('open');
      while (this.queue.length) ws.send(JSON.stringify(this.queue.shift()));
      this._onopen && this._onopen();
    };
    ws.onmessage = (e) => {
      let data; try { data = JSON.parse(e.data); } catch { return; }
      this.onMessage(data);
    };
    ws.onclose = () => {
      this.onStatus('down');
      setTimeout(() => this._connect(), 1200);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  set onReady(fn) { this._onopen = fn; if (this.ws && this.ws.readyState === 1) fn(); }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    else this.queue.push(obj);
  }
}

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const LETTERS = ['B', 'I', 'N', 'G', 'O'];
export const letterFor = (n) => LETTERS[Math.floor((n - 1) / 15)];

export function confetti(duration = 1800) {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;z-index:70;pointer-events:none';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const resize = () => { c.width = innerWidth; c.height = innerHeight; };
  resize(); addEventListener('resize', resize);
  const colors = ['#f6c650', '#37c4d6', '#ff6b6b', '#35c27a', '#ffffff'];
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height,
    r: 4 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
    vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4, rot: Math.random() * 6.28, vr: -0.2 + Math.random() * 0.4,
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.fillStyle = b.c;
      ctx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 0.6); ctx.restore();
    }
    if (t - start < duration) requestAnimationFrame(frame);
    else { removeEventListener('resize', resize); c.remove(); }
  })(start);
}
