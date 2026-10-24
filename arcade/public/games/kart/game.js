'use strict';
// =====================================================================
//  KART PARTY — jogo de kart pseudo-3D (estilo "Mode 7") no canvas
//  Controle: celular (via SDK do Fliperama) ou teclado
// =====================================================================
(() => {

// ------------------------------- CONFIG -------------------------------
const W = 640, H = 360;          // resolução interna (escalada no CSS)
const HORIZON = 112;            // linha do horizonte na tela
const FOCAL = 300;              // distância focal da câmera
const CAM_H = 26;               // altura da câmera
const CAM_DIST = 52;            // distância da câmera atrás do kart
const TEX = 2048;               // tamanho do mapa (pixels = unidades do mundo)
const MIP = 4;                  // fator da textura reduzida (para distância)
const TEXM = TEX / MIP;
const ROAD_HW = 60;             // meia largura do asfalto
const CURB_W = 9;               // largura da zebra
const STEP = 6;                 // espaçamento das amostras da pista
const LAPS = 3;

const MAX_SPEED = 235, ACCEL = 150, BRAKE = 320, REVERSE_MAX = 70, FRICTION = 70;
const OFFROAD_MAX = 105, BOOST_SPEED = 335;
const KART_R = 9;

const FIXED_DT = 1 / 60;

const canvas = document.getElementById('game');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ------------------------------- UTIL ---------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
const rand = Math.random;

const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f;
  let c = shadeCache.get(key);
  if (c) return c;
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  c = `rgb(${r},${g},${b})`;
  shadeCache.set(key, c);
  return c;
}

// ------------------------------- PISTA --------------------------------
// Pontos de controle (spline Catmull-Rom fechada). O sentido da corrida segue a ordem.
const CTRL = [
  [300, 1450], [300, 1100], [370, 720], [300, 420], [480, 230], [780, 270], [900, 520],
  [1090, 690], [1290, 560], [1350, 320], [1600, 210], [1820, 360], [1810, 780], [1580, 970],
  [1600, 1210], [1830, 1390], [1780, 1760], [1420, 1850], [1110, 1660], [850, 1830],
  [560, 1870], [330, 1760],
];

const track = (() => {
  const dense = [];
  const n = CTRL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let s = 0; s < 40; s++) {
      const t = s / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  // Reamostra com espaçamento constante
  const xs = [], ys = [];
  let need = 0;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i], b = dense[(i + 1) % dense.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let pos = need;
    while (pos <= L) {
      const t = pos / L;
      xs.push(a[0] + (b[0] - a[0]) * t);
      ys.push(a[1] + (b[1] - a[1]) * t);
      pos += STEP;
    }
    need = pos - L;
  }
  const N = xs.length;
  const tx = new Float32Array(N), ty = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dx = xs[(i + 1) % N] - xs[(i - 1 + N) % N];
    const dy = ys[(i + 1) % N] - ys[(i - 1 + N) % N];
    const l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  return { xs, ys, tx, ty, N };
})();
const N = track.N;

// Normal "à direita" do sentido da pista
const nx = (i) => -track.ty[i];
const ny = (i) => track.tx[i];

// Itens e boosts posicionados ao longo da pista
const BOX_ROWS = [0.13, 0.42, 0.72].map((f) => Math.floor(N * f));
const BOOST_PADS = [
  { i: Math.floor(N * 0.27), off: -22 },
  { i: Math.floor(N * 0.58), off: 20 },
  { i: Math.floor(N * 0.88), off: 0 },
];

// Árvores (sprites) espalhadas fora da pista
const trees = (() => {
  const r = rng(1234);
  const list = [];
  let tries = 0;
  while (list.length < 110 && tries++ < 5000) {
    const x = 60 + r() * (TEX - 120), y = 60 + r() * (TEX - 120);
    let minD = Infinity;
    for (let i = 0; i < N; i += 3) {
      const d = Math.hypot(track.xs[i] - x, track.ys[i] - y);
      if (d < minD) minD = d;
    }
    if (minD < ROAD_HW + 55) continue;
    if (list.some((t) => Math.hypot(t.x - x, t.y - y) < 40)) continue;
    list.push({ x, y, s: 0.8 + r() * 0.6, kind: r() < 0.75 ? 'tree' : 'bush' });
  }
  return list;
})();

// ----------------------- TEXTURA DO CHÃO (Mode 7) ---------------------
const GRASS_COLOR = 0xff3c9a4a; // ABGR (little-endian)
let tex32, texM32;
const minimap = document.createElement('canvas');

function buildTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');

  // Grama quadriculada
  for (let y = 0; y < TEX; y += 64) {
    for (let x = 0; x < TEX; x += 64) {
      g.fillStyle = ((x + y) / 64) % 2 ? '#4fae4a' : '#58b752';
      g.fillRect(x, y, 64, 64);
    }
  }
  // Manchas de flores
  const r = rng(99);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? '#3f9a3c' : (r() < 0.5 ? '#f2e35a' : '#ffffff');
    const s = r() < 0.85 ? 3 : 4;
    g.fillRect((r() * TEX) | 0, (r() * TEX) | 0, s, s);
  }

  const path = new Path2D();
  path.moveTo(track.xs[0], track.ys[0]);
  for (let i = 1; i < N; i++) path.lineTo(track.xs[i], track.ys[i]);
  path.closePath();
  g.lineJoin = 'round'; g.lineCap = 'round';

  // Terra / borda
  g.strokeStyle = '#c9a463';
  g.lineWidth = (ROAD_HW + CURB_W) * 2 + 26;
  g.stroke(path);
  // Zebra vermelha e branca
  g.lineWidth = (ROAD_HW + CURB_W) * 2;
  g.strokeStyle = '#e8352e';
  g.stroke(path);
  g.setLineDash([14, 14]);
  g.strokeStyle = '#f4f4f4';
  g.stroke(path);
  g.setLineDash([]);
  // Asfalto
  g.lineWidth = ROAD_HW * 2;
  g.strokeStyle = '#6d6d78';
  g.stroke(path);
  // Faixas laterais
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const j = i % N;
      const x = track.xs[j] + nx(j) * side * (ROAD_HW - 5), y = track.ys[j] + ny(j) * side * (ROAD_HW - 5);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    g.stroke();
  }

  // Linha de chegada quadriculada
  {
    const i = 0, ang = Math.atan2(track.ty[i], track.tx[i]);
    g.save();
    g.translate(track.xs[i], track.ys[i]);
    g.rotate(ang);
    const sq = 8;
    for (let a = 0; a < 3; a++) {
      for (let b = -ROAD_HW; b < ROAD_HW; b += sq) {
        g.fillStyle = ((a + b / sq) & 1) ? '#111' : '#fff';
        g.fillRect(-12 + a * sq, b, sq, sq);
      }
    }
    g.restore();
  }

  // Boost pads (setas amarelas)
  for (const p of BOOST_PADS) {
    const ang = Math.atan2(track.ty[p.i], track.tx[p.i]);
    g.save();
    g.translate(track.xs[p.i] + nx(p.i) * p.off, track.ys[p.i] + ny(p.i) * p.off);
    g.rotate(ang);
    g.fillStyle = '#ff9d00';
    g.fillRect(-20, -14, 40, 28);
    g.fillStyle = '#ffe14a';
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(-6 + k * 12, -10); g.lineTo(4 + k * 12, 0); g.lineTo(-6 + k * 12, 10);
      g.lineTo(-10 + k * 12, 10); g.lineTo(0 + k * 12, 0); g.lineTo(-10 + k * 12, -10);
      g.fill();
    }
    g.restore();
  }

  // Ruído sutil para dar textura
  const img = g.getImageData(0, 0, TEX, TEX);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = ((Math.random() * 14) | 0) - 7;
    d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  g.putImageData(img, 0, 0);
  tex32 = new Uint32Array(img.data.buffer);

  // Versão reduzida (evita "cintilação" ao longe)
  const cm = document.createElement('canvas');
  cm.width = cm.height = TEXM;
  const gm = cm.getContext('2d');
  gm.imageSmoothingEnabled = true;
  gm.imageSmoothingQuality = 'high';
  gm.drawImage(c, 0, 0, TEXM, TEXM);
  texM32 = new Uint32Array(gm.getImageData(0, 0, TEXM, TEXM).data.buffer);

  // Minimapa
  const MM = 104;
  minimap.width = minimap.height = MM;
  const mg = minimap.getContext('2d');
  const s = MM / TEX;
  mg.lineJoin = 'round';
  mg.beginPath();
  for (let i = 0; i <= N; i++) { const j = i % N; i ? mg.lineTo(track.xs[j] * s, track.ys[j] * s) : mg.moveTo(track.xs[j] * s, track.ys[j] * s); }
  mg.strokeStyle = '#000'; mg.lineWidth = 7; mg.stroke();
  mg.strokeStyle = '#fff'; mg.lineWidth = 4; mg.stroke();
  mg.fillStyle = '#ffd400';
  mg.fillRect(track.xs[0] * s - 3, track.ys[0] * s - 1, 6, 3);
}

// ----------------------- CÉU E MONTANHAS (parallax) -------------------
const PANO = Math.round((W * Math.PI * 2) / (2 * Math.atan(W / 2 / FOCAL))); // px por volta completa
const HILLS_W = Math.round(PANO / 2);
const hills = document.createElement('canvas');
const clouds = document.createElement('canvas');
function buildSky() {
  hills.width = HILLS_W; hills.height = 70;
  const g = hills.getContext('2d');
  const r = rng(7);
  const layer = (color, base, amp, count) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 70);
    for (let x = 0; x <= HILLS_W; x += 4) {
      let y = base;
      for (let k = 1; k <= count; k++) y -= Math.sin((x / HILLS_W) * Math.PI * 2 * k * 2 + k * 1.7) * amp / k;
      g.lineTo(x, y);
    }
    g.lineTo(HILLS_W, 70); g.closePath(); g.fill();
  };
  layer('#7aa0d8', 30, 18, 4);   // montanhas distantes
  layer('#3f8f53', 50, 10, 6);   // morros
  layer('#2f7a43', 60, 5, 9);
  // casinhas/arbustos no horizonte
  for (let i = 0; i < 30; i++) {
    g.fillStyle = '#27693a';
    const x = r() * HILLS_W, rr = 4 + r() * 6;
    g.beginPath(); g.arc(x, 66, rr, 0, Math.PI * 2); g.fill();
  }

  clouds.width = HILLS_W; clouds.height = 60;
  const c = clouds.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = r() * HILLS_W, y = 10 + r() * 30, s = 0.6 + r() * 0.8;
    c.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) {
      c.beginPath();
      c.arc(x + k * 12 * s, y + (k % 2) * 3, (9 + (k % 2) * 4) * s, 0, Math.PI * 2);
      c.fill();
    }
  }
}

// --------------------------------- SOM --------------------------------
const Snd = {
  ac: null, master: null, eng: null, engGain: null,
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
      const o = this.ac.createOscillator();
      o.type = 'sawtooth';
      const f = this.ac.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ac.createGain();
      g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start();
      this.eng = o; this.engGain = g;
      document.getElementById('soundHint').classList.add('hidden');
    } catch (e) { /* sem áudio */ }
  },
  tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  engine(speed, on) {
    if (!this.eng) return;
    const t = this.ac.currentTime;
    this.eng.frequency.setTargetAtTime(48 + Math.abs(speed) * 0.5, t, 0.05);
    this.engGain.gain.setTargetAtTime(on ? 0.07 : 0, t, 0.15);
  },
};
document.getElementById('soundHint').addEventListener('click', () => Snd.unlock());
addEventListener('pointerdown', () => Snd.unlock());

// -------------------------------- KARTS -------------------------------
const ROSTER = [
  { name: 'JOGADOR', color: '#e53935', shirt: '#1e3a8a' },
  { name: 'TURBO', color: '#1e88e5', shirt: '#f5f5f5' },
  { name: 'FAGULHA', color: '#43a047', shirt: '#ffeb3b' },
  { name: 'PIMENTA', color: '#fdd835', shirt: '#d84315' },
  { name: 'TROVÃO', color: '#8e24aa', shirt: '#212121' },
  { name: 'BOLOTA', color: '#fb8c00', shirt: '#5d4037' },
  { name: 'COMETA', color: '#ec407a', shirt: '#ffffff' },
  { name: 'ZIGGY', color: '#00acc1', shirt: '#263238' },
];

const karts = ROSTER.map((r, i) => ({
  ...r, isPlayer: i === 0, id: i,
  x: 0, y: 0, a: 0, vx: 0, vy: 0, speed: 0, z: 0, vz: 0,
  idx: 0, lap: 0, checkpoint: true, finished: false, finishTime: 0, rank: i,
  item: null, roulette: 0, boost: 0, star: 0, spin: 0, spinVis: 0, invuln: 0,
  drift: 0, driftTime: 0, offroad: false, curb: false, lateral: 0,
  ai: { offset: 0, offsetTarget: 0, skill: 0.9, itemDelay: 0, retarget: 0 },
}));
const player = karts[0];

function placeOnGrid() {
  const order = [1, 2, 3, 4, 5, 6, 0, 7]; // jogador larga em 7º
  order.forEach((kid, slot) => {
    const k = karts[kid];
    const row = Math.floor(slot / 2), col = slot % 2;
    const i = (N - 4 - row * 6 + N) % N;
    const off = (col ? 1 : -1) * 22 + (row % 2 ? 6 : -6);
    k.x = track.xs[i] + nx(i) * off;
    k.y = track.ys[i] + ny(i) * off;
    k.a = Math.atan2(track.ty[i], track.tx[i]);
    k.vx = k.vy = k.speed = k.z = k.vz = 0;
    k.idx = i; k.lap = 0; k.checkpoint = true; k.finished = false; k.finishTime = 0;
    k.item = null; k.roulette = 0; k.boost = 0; k.star = 0; k.spin = 0; k.spinVis = 0; k.invuln = 0;
    k.drift = 0; k.driftTime = 0;
    k.ai.offset = off; k.ai.offsetTarget = off;
    k.ai.skill = k.isPlayer ? 0.95 : 0.86 + (slot / 8) * 0.1 + rand() * 0.03;
    k.ai.itemDelay = 0;
  });
}

// ---------------------------- OBJETOS / ITENS -------------------------
let boxes = [];
let hazards = []; // bananas e cascos
let particles = [];

function resetObjects() {
  boxes = [];
  for (const i of BOX_ROWS) {
    for (const off of [-36, -12, 12, 36]) {
      boxes.push({ x: track.xs[i] + nx(i) * off, y: track.ys[i] + ny(i) * off, active: true, respawn: 0, rot: rand() * 6 });
    }
  }
  hazards = [];
  particles = [];
}

const ITEM_ICON = { mushroom: '🍄', banana: '🍌', green: '🟢', red: '🔴', star: '⭐' };
function rollItem(rank) {
  const tables = [
    [['banana', 45], ['green', 40], ['red', 10], ['mushroom', 5]],
    [['banana', 22], ['green', 25], ['red', 25], ['mushroom', 23], ['star', 5]],
    [['banana', 5], ['green', 15], ['red', 25], ['mushroom', 38], ['star', 17]],
  ];
  const t = tables[rank <= 1 ? 0 : rank <= 5 ? 1 : 2];
  let r = rand() * t.reduce((s, e) => s + e[1], 0);
  for (const [name, w] of t) { if ((r -= w) <= 0) return name; }
  return 'banana';
}

function useItem(k) {
  if (!k.item) return;
  const it = k.item;
  k.item = null;
  const fx = Math.cos(k.a), fy = Math.sin(k.a);
  if (it === 'mushroom') {
    k.boost = Math.max(k.boost, 1.3);
    if (k.isPlayer) Snd.tone(300, 0.35, 'sawtooth', 0.12, 600);
  } else if (it === 'star') {
    k.star = 7;
    if (k.isPlayer) { Snd.tone(700, 0.15); setTimeout(() => Snd.tone(900, 0.2), 120); }
  } else if (it === 'banana') {
    hazards.push({ type: 'banana', x: k.x - fx * 16, y: k.y - fy * 16, owner: k, safe: 0.5, life: 9999 });
  } else {
    let target = null;
    if (it === 'red') target = karts.find((o) => o.rank === k.rank - 1) || null;
    hazards.push({
      type: it, x: k.x + fx * 14, y: k.y + fy * 14, a: k.a,
      speed: Math.max(430, k.speed + 200), owner: k, safe: 0.35, life: 5, target,
    });
    if (k.isPlayer) Snd.tone(500, 0.12, 'square', 0.1, -200);
  }
}

function hitKart(k, strength = 1) {
  if (k.star > 0 || k.invuln > 0) return;
  k.spin = 1.1 * strength;
  k.invuln = 1.8;
  k.speed *= 0.25;
  k.drift = 0;
  k.vz = 140; // pulinho
  for (let i = 0; i < 12; i++) spawnParticle(k.x, k.y, 6, '#ffffff', 60, 0.6, 3);
  if (k.isPlayer) {
    Snd.tone(220, 0.4, 'sawtooth', 0.15, -150);
    sendToPhones({ t: 'vibe', ms: [80, 40, 120] });
    shake = 0.35;
  }
}

function spawnParticle(x, y, z, color, spd, life, size) {
  if (particles.length > 400) return;
  const a = rand() * Math.PI * 2;
  particles.push({ x, y, z, vx: Math.cos(a) * spd * rand(), vy: Math.sin(a) * spd * rand(), vz: 20 + rand() * 60, life, max: life, color, size });
}

// ------------------------- PROGRESSO NA PISTA -------------------------
function nearestSample(x, y, hint) {
  let best = hint, bd = Infinity;
  for (let o = -30; o <= 30; o++) {
    const i = (hint + o + N) % N;
    const dx = track.xs[i] - x, dy = track.ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 260 * 260) { // perdeu a referência: busca global
    for (let i = 0; i < N; i++) {
      const dx = track.xs[i] - x, dy = track.ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

const progressOf = (k) => k.lap * N + k.idx;

function updateProgress(k) {
  const prev = k.idx;
  k.idx = nearestSample(k.x, k.y, k.idx);
  const i = k.idx;
  k.lateral = (k.x - track.xs[i]) * nx(i) + (k.y - track.ys[i]) * ny(i);

  if (i > N * 0.4 && i < N * 0.6) k.checkpoint = true;
  if (prev > N * 0.8 && i < N * 0.2) {
    if (k.checkpoint) {
      k.lap++;
      k.checkpoint = false;
      onLap(k);
    }
  } else if (prev < N * 0.2 && i > N * 0.8 && k.lap > 0) {
    k.lap--; // cruzou a linha de ré
    k.checkpoint = true;
  }
}

function onLap(k) {
  if (state.phase !== 'race') return;
  if (k.lap > LAPS && !k.finished) {
    k.finished = true;
    k.finishTime = state.raceTime;
    if (k.isPlayer) {
      Snd.tone(523, 0.15); setTimeout(() => Snd.tone(659, 0.15), 150); setTimeout(() => Snd.tone(784, 0.4), 300);
      banner('CHEGADA!', 3);
      state.finishWait = 3.5;
      sendToPhones({ t: 'vibe', ms: [100, 60, 100, 60, 250] });
    }
  } else if (k.isPlayer) {
    if (k.lap === LAPS) { banner('VOLTA FINAL!', 2); Snd.tone(880, 0.12); setTimeout(() => Snd.tone(880, 0.25), 150); }
    else if (k.lap > 1) banner(`VOLTA ${k.lap}`, 1.5);
  }
}

// -------------------------------- IA ----------------------------------
function aiInput(k, dt) {
  const ai = k.ai;
  ai.retarget -= dt;
  if (ai.retarget <= 0) {
    ai.retarget = 1.5 + rand() * 2.5;
    ai.offsetTarget = (rand() * 2 - 1) * (ROAD_HW - 22);
  }
  ai.offset = lerp(ai.offset, ai.offsetTarget, 1 - Math.exp(-0.8 * dt));

  const look = 9 + Math.floor(Math.abs(k.speed) / 22);
  const ti = (k.idx + look) % N;
  const tx = track.xs[ti] + nx(ti) * ai.offset;
  const ty = track.ys[ti] + ny(ti) * ai.offset;
  const want = Math.atan2(ty - k.y, tx - k.x);
  const diff = wrapAngle(want - k.a);

  // curva à frente: reduz um pouco
  const ahead = (k.idx + look * 2) % N;
  const bend = Math.abs(wrapAngle(Math.atan2(track.ty[ahead], track.tx[ahead]) - Math.atan2(track.ty[k.idx], track.tx[k.idx])));

  // "rubber band": IA se ajusta em relação ao jogador
  let mul = ai.skill;
  if (!k.isPlayer && state.phase === 'race') {
    const gap = progressOf(k) - progressOf(player);
    if (gap > 120) mul -= 0.07;
    else if (gap < -150) mul += 0.08;
  }
  ai.speedMul = mul;

  // Itens
  if (k.item && state.phase === 'race') {
    ai.itemDelay -= dt;
    if (ai.itemDelay <= 0) useItem(k);
  }

  return {
    steer: clamp(diff * 2.6, -1, 1),
    gas: !(bend > 1.1 && k.speed > MAX_SPEED * 0.8),
    brake: false,
    drift: false,
    item: false,
  };
}

// ------------------------------ FÍSICA --------------------------------
function updateKart(k, inp, dt) {
  const near = Math.abs(k.lateral);
  k.offroad = near > ROAD_HW + CURB_W;
  k.curb = !k.offroad && near > ROAD_HW;

  let maxS = MAX_SPEED * (k.isPlayer && !state.attract ? 1 : (k.ai.speedMul || k.ai.skill));
  if (k.star > 0) maxS *= 1.12;
  if (k.offroad && k.boost <= 0 && k.star <= 0) maxS = OFFROAD_MAX;
  if (k.boost > 0) maxS = Math.max(maxS, BOOST_SPEED);

  let steer = inp.steer;
  if (k.spin > 0) {
    steer = 0;
    k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), 300 * dt);
  } else if (k.boost > 0) {
    k.speed += 500 * dt;
  } else if (inp.gas && !inp.brake) {
    k.speed += ACCEL * dt * (k.speed < 0 ? 2.5 : 1);
  } else if (inp.brake) {
    k.speed -= (k.speed > 0 ? BRAKE : ACCEL * 0.7) * dt;
  } else {
    k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), FRICTION * dt);
  }
  if (k.speed > maxS) k.speed = Math.max(maxS, k.speed - 280 * dt);
  if (k.speed < -REVERSE_MAX) k.speed = -REVERSE_MAX;

  // ---- Drift + mini-turbo ----
  if (inp.drift && !k.drift && Math.abs(steer) > 0.3 && k.speed > 110 && k.z === 0 && k.spin <= 0) {
    k.drift = Math.sign(steer);
    k.driftTime = 0;
    k.vz = 70;
    if (k.isPlayer) Snd.tone(180, 0.08, 'square', 0.08);
  }
  if (k.drift && (!inp.drift || k.speed < 80 || k.spin > 0)) {
    if (k.spin <= 0 && !inp.drift) {
      if (k.driftTime > 2.0) { k.boost = Math.max(k.boost, 1.0); if (k.isPlayer) Snd.tone(400, 0.3, 'sawtooth', 0.1, 500); }
      else if (k.driftTime > 0.9) { k.boost = Math.max(k.boost, 0.55); if (k.isPlayer) Snd.tone(350, 0.2, 'sawtooth', 0.1, 300); }
    }
    k.drift = 0;
  }

  let turn;
  if (k.drift) {
    k.driftTime += dt;
    turn = k.drift * (1.3 + 0.95 * steer * k.drift);
    // faíscas
    const lvl = k.driftTime > 2.0 ? '#ff9d1a' : k.driftTime > 0.9 ? '#4fc3ff' : '#ffffff';
    if (rand() < 0.6) {
      const bx = k.x - Math.cos(k.a) * 9, by = k.y - Math.sin(k.a) * 9;
      const side = rand() < 0.5 ? -1 : 1;
      spawnParticle(bx - Math.sin(k.a) * 6 * side, by + Math.cos(k.a) * 6 * side, 1, lvl, 25, 0.25, 2);
    }
  } else {
    turn = steer * 2.3;
  }
  const sf = Math.min(1, Math.abs(k.speed) / 90) * Math.sign(k.speed);
  k.a = wrapAngle(k.a + turn * sf * dt);

  const grip = k.drift ? 2.8 : k.offroad ? 6 : 9;
  const g = 1 - Math.exp(-grip * dt);
  k.vx += (Math.cos(k.a) * k.speed - k.vx) * g;
  k.vy += (Math.sin(k.a) * k.speed - k.vy) * g;
  k.x += k.vx * dt;
  k.y += k.vy * dt;

  // pulo
  if (k.z > 0 || k.vz > 0) {
    k.vz -= 520 * dt;
    k.z += k.vz * dt;
    if (k.z <= 0) { k.z = 0; k.vz = 0; }
  }

  // timers
  k.boost = Math.max(0, k.boost - dt);
  k.star = Math.max(0, k.star - dt);
  k.invuln = Math.max(0, k.invuln - dt);
  if (k.spin > 0) { k.spin -= dt; k.spinVis += dt * 15; } else k.spinVis = 0;

  // poeira na grama / chamas do turbo
  if (k.offroad && Math.abs(k.speed) > 40 && rand() < 0.5) spawnParticle(k.x - Math.cos(k.a) * 8, k.y - Math.sin(k.a) * 8, 1, '#8a6a3a', 20, 0.4, 3);
  if (k.boost > 0 && rand() < 0.8) {
    const p = { x: k.x - Math.cos(k.a) * 12, y: k.y - Math.sin(k.a) * 12, z: 4, vx: -k.vx * 0.1, vy: -k.vy * 0.1, vz: 10, life: 0.2, max: 0.2, color: rand() < 0.5 ? '#ffde3a' : '#ff6a00', size: 3 };
    particles.push(p);
  }

  // roleta de itens
  if (k.roulette > 0) {
    k.roulette -= dt;
    if (k.roulette <= 0) {
      k.item = rollItem(k.rank);
      k.ai.itemDelay = 1 + rand() * 4;
      if (k.isPlayer) Snd.tone(1000, 0.1, 'square', 0.1);
    }
  }
  if (inp.item && k.item && k.roulette <= 0 && state.phase === 'race') useItem(k);

  // limites do mapa
  k.x = clamp(k.x, 30, TEX - 30);
  k.y = clamp(k.y, 30, TEX - 30);

  // árvores
  for (const t of trees) {
    const dx = k.x - t.x, dy = k.y - t.y;
    const r = 10 * t.s + KART_R;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 1;
      k.x = t.x + (dx / d) * r;
      k.y = t.y + (dy / d) * r;
      if (Math.abs(k.speed) > 60 && k.isPlayer) { Snd.tone(90, 0.15, 'square', 0.12); sendToPhones({ t: 'vibe', ms: 40 }); }
      k.speed *= -0.3;
      k.vx *= -0.3; k.vy *= -0.3;
    }
  }

  updateProgress(k);

  // boost pads
  for (const p of BOOST_PADS) {
    let di = Math.abs(k.idx - p.i);
    di = Math.min(di, N - di);
    if (di <= 3 && Math.abs(k.lateral - p.off) < 22 && k.z < 5) {
      if (k.boost < 0.5 && k.isPlayer) Snd.tone(500, 0.25, 'sawtooth', 0.08, 400);
      k.boost = Math.max(k.boost, 0.9);
    }
  }

  // caixas de item
  for (const b of boxes) {
    if (!b.active) continue;
    const dx = k.x - b.x, dy = k.y - b.y;
    if (dx * dx + dy * dy < 15 * 15) {
      b.active = false; b.respawn = 3;
      for (let i = 0; i < 8; i++) spawnParticle(b.x, b.y, 8, `hsl(${rand() * 360},90%,65%)`, 60, 0.5, 3);
      if (!k.item && k.roulette <= 0) {
        k.roulette = 1.2;
        if (k.isPlayer) { Snd.tone(600, 0.06); sendToPhones({ t: 'vibe', ms: 25 }); }
      }
    }
  }
}

function kartCollisions() {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy, r = KART_R * 2;
      if (d2 < r * r && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (r - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        const rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
        if (rel < 0) {
          a.vx += ux * rel * 0.6; a.vy += uy * rel * 0.6;
          b.vx -= ux * rel * 0.6; b.vy -= uy * rel * 0.6;
        }
        if (a.star > 0 && b.star <= 0) hitKart(b);
        if (b.star > 0 && a.star <= 0) hitKart(a);
        if ((a.isPlayer || b.isPlayer) && rel < -40) { Snd.tone(120, 0.08, 'square', 0.1); sendToPhones({ t: 'vibe', ms: 30 }); }
      }
    }
  }
}

function updateHazards(dt) {
  for (const h of hazards) {
    h.safe -= dt;
    if (h.type !== 'banana') {
      h.life -= dt;
      if (h.type === 'red' && h.target && !h.target.finished) {
        const want = Math.atan2(h.target.y - h.y, h.target.x - h.x);
        h.a = wrapAngle(h.a + clamp(wrapAngle(want - h.a), -4 * dt, 4 * dt));
      }
      h.x += Math.cos(h.a) * h.speed * dt;
      h.y += Math.sin(h.a) * h.speed * dt;
      if (h.x < 20 || h.x > TEX - 20) { h.a = Math.PI - h.a; h.x = clamp(h.x, 20, TEX - 20); }
      if (h.y < 20 || h.y > TEX - 20) { h.a = -h.a; h.y = clamp(h.y, 20, TEX - 20); }
      for (const t of trees) {
        if (Math.hypot(h.x - t.x, h.y - t.y) < 10 * t.s + 4) { h.life = 0; break; }
      }
    }
    for (const k of karts) {
      if (h.life <= 0) break;
      if (k === h.owner && h.safe > 0) continue;
      if (Math.hypot(k.x - h.x, k.y - h.y) < KART_R + 5 && k.z < 10) {
        hitKart(k);
        h.life = 0;
      }
    }
  }
  // casco contra banana / casco
  for (let i = 0; i < hazards.length; i++) {
    for (let j = i + 1; j < hazards.length; j++) {
      const a = hazards[i], b = hazards[j];
      if (a.life <= 0 || b.life <= 0) continue;
      if (a.type === 'banana' && b.type === 'banana') continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 10) { a.life = 0; b.life = 0; }
    }
  }
  for (const h of hazards) if (h.life <= 0) for (let i = 0; i < 6; i++) spawnParticle(h.x, h.y, 4, h.type === 'banana' ? '#ffe14a' : h.type === 'red' ? '#e53935' : '#43a047', 50, 0.4, 3);
  hazards = hazards.filter((h) => h.life > 0);

  for (const b of boxes) {
    b.rot += dt * 2;
    if (!b.active && (b.respawn -= dt) <= 0) b.active = true;
  }

  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vz -= 200 * dt; p.z = Math.max(0, p.z + p.vz * dt);
  }
  particles = particles.filter((p) => p.life > 0);
}

function computeRanks() {
  const sorted = [...karts].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return progressOf(b) - progressOf(a);
  });
  sorted.forEach((k, i) => { k.rank = i; });
  return sorted;
}

// ------------------------------ ENTRADA -------------------------------
const keys = {};
let itemEdge = false;
const phone = { steer: 0, gas: false, brake: false, drift: false, connected: 0, last: 0 };
let kbSteer = 0;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat && ['KeyX', 'ShiftLeft', 'ShiftRight', 'KeyE'].includes(e.code)) itemEdge = true;
  if (!e.repeat && e.code === 'Enter') startAction(true);
  if (!e.repeat && e.code === 'Escape') exitToGallery();
  Snd.unlock();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function playerInput(dt) {
  const target = (keys.ArrowLeft || keys.KeyA ? -1 : 0) + (keys.ArrowRight || keys.KeyD ? 1 : 0);
  kbSteer = lerp(kbSteer, target, 1 - Math.exp(-12 * dt));
  const usePhone = phone.connected > 0 && Math.abs(phone.steer) > 0.01;
  const inp = {
    steer: usePhone ? phone.steer : kbSteer,
    gas: phone.gas || !!(keys.ArrowUp || keys.KeyW),
    brake: phone.brake || !!(keys.ArrowDown || keys.KeyS),
    drift: phone.drift || !!keys.Space,
    item: itemEdge,
  };
  itemEdge = false;
  return inp;
}

// ------------------------------ REDE ----------------------------------
// Conexão via SDK do Fliperama (public/shared/arcade-screen.js).
// O kart é para 1 jogador: quem dirige é o celular de menor número (P1);
// os outros celulares ficam como espectadores.
let arcade = null;
let driverPid = null;
const $ = (id) => document.getElementById(id);

function onPlayers(players) {
  phone.connected = players.length;
  const prev = driverPid;
  driverPid = players.length ? players[0].pid : null;
  if (driverPid !== prev) { phone.steer = 0; phone.gas = phone.brake = phone.drift = false; }
  updateStatus();
  pushPhoneState(true);
}

function connect() {
  arcade = ArcadeScreen({
    game: 'kart',
    onRoom(m, players) {
      $('qrBox').innerHTML = `<img src="${m.qr}" alt="QR code do controle">`;
      $('pauseQr').src = m.qr;
      $('roomCode').textContent = m.code;
      $('roomUrl').textContent = m.url;
      onPlayers(players);
    },
    onJoin(p, players) {
      toast(`📱 Jogador ${p.index + 1} conectado!`);
      Snd.tone(660, 0.1); setTimeout(() => Snd.tone(990, 0.15), 100);
      onPlayers(players);
      if (state.paused) setPaused(false);
    },
    onLeave(p, players) {
      toast(`📱 Jogador ${p.index + 1} desconectou`);
      onPlayers(players);
      if (!players.length && (state.phase === 'race' || state.phase === 'countdown')) setPaused(true);
    },
    onReady() { pushPhoneState(true); },
    onDisconnect() {
      $('statusText').textContent = 'Sem conexão com o servidor... tentando de novo';
    },
    onMessage(m) {
      if (m.pid !== driverPid) return; // espectadores não dirigem
      switch (m.t) {
        case 'in': // estado do controle
          phone.steer = clamp(+m.s || 0, -1, 1);
          phone.gas = !!m.g; phone.brake = !!m.b; phone.drift = !!m.d;
          phone.last = performance.now();
          break;
        case 'item':
          itemEdge = true;
          break;
        case 'start':
          startAction(false);
          break;
      }
    },
  });
}

function sendToPhones(obj) {
  if (arcade) arcade.send(obj, obj.t === 'vibe' ? driverPid : undefined);
}

function exitToGallery() {
  if (arcade) arcade.exit();
}

let lastPhoneState = '';
function pushPhoneState(force) {
  const s = {
    t: 'state',
    phase: state.paused ? 'paused' : state.phase,
    pos: player.rank + 1,
    lap: clamp(player.lap, 1, LAPS),
    laps: LAPS,
    item: player.roulette > 0 ? 'roulette' : player.item,
    driver: driverPid,
  };
  const str = JSON.stringify(s);
  if (force || str !== lastPhoneState) { lastPhoneState = str; sendToPhones(s); }
}

function updateStatus() {
  const dot = $('statusDot');
  if (phone.connected > 0) {
    dot.className = 'dot on';
    $('statusText').textContent = 'Controle conectado!';
    $('startHint').innerHTML = '<span class="blink">Toque em INICIAR no celular</span>';
  } else {
    dot.className = 'dot wait';
    $('statusText').textContent = 'Aguardando controle...';
    $('startHint').textContent = 'Teclado: ENTER para jogar';
  }
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ------------------------------ ESTADO --------------------------------
const state = {
  phase: 'lobby',   // lobby | countdown | race | finished | results
  attract: true,    // no lobby a IA dirige o kart do jogador
  countdown: 0,
  raceTime: 0,
  finishWait: 0,
  paused: false,
  banner: '', bannerT: 0,
};
let shake = 0;
// Depuração: abra com ?debug para expor o estado em window.__kart
const debug = { autopilot: false };
if (new URLSearchParams(location.search).has('debug')) window.__kart = { state, karts, debug, update, get hazards() { return hazards; } };

function banner(text, t) { state.banner = text; state.bannerT = t; }

function startAction(fromKeyboard) {
  Snd.unlock();
  if (state.paused) { if (fromKeyboard) setPaused(false); return; }
  if (state.phase === 'lobby' || state.phase === 'results') startRace();
}

function startRace() {
  placeOnGrid();
  resetObjects();
  state.phase = 'countdown';
  state.attract = false;
  state.countdown = 3.99;
  state.raceTime = 0;
  state.finishWait = 0;
  state.banner = '';
  lastCount = 4;
  $('lobby').classList.add('hidden');
  $('results').classList.add('hidden');
  snapCamera();
  pushPhoneState(true);
}

function setPaused(p) {
  state.paused = p;
  $('paused').classList.toggle('hidden', !p);
  pushPhoneState(true);
}

function showResults() {
  state.phase = 'results';
  const sorted = computeRanks();
  const fmt = (t) => `${Math.floor(t / 60)}'${(t % 60).toFixed(2).padStart(5, '0')}"`;
  $('resultsTable').innerHTML = sorted.map((k, i) => `
    <tr class="${k.isPlayer ? 'me' : ''}">
      <td>${i + 1}º</td>
      <td class="swatch"><span style="background:${k.color}"></span></td>
      <td>${k.name}</td>
      <td>${k.finished ? fmt(k.finishTime) : '--'}</td>
    </tr>`).join('');
  $('results').classList.remove('hidden');
  pushPhoneState(true);
}

function startAttract() {
  placeOnGrid();
  resetObjects();
  karts.forEach((k) => { k.lap = 1; });
  state.attract = true;
  snapCamera();
}

let lastCount = 4;
function update(dt) {
  if (state.paused) return;

  if (state.phase === 'countdown') {
    state.countdown -= dt;
    const c = Math.ceil(state.countdown);
    if (c !== lastCount) {
      lastCount = c;
      if (c > 0) { Snd.tone(440, 0.2, 'square', 0.12); sendToPhones({ t: 'vibe', ms: 30 }); }
    }
    if (state.countdown <= 0) {
      state.phase = 'race';
      banner('VAI!', 1);
      Snd.tone(880, 0.5, 'square', 0.14);
      sendToPhones({ t: 'vibe', ms: 120 });
      pushPhoneState(true);
    }
  }

  const racing = state.phase === 'race' || state.phase === 'finished' || state.phase === 'results' || state.attract;
  if (state.phase === 'race' || state.phase === 'finished') state.raceTime += dt;

  const pin = playerInput(dt);
  if (racing) {
    computeRanks();
    for (const k of karts) {
      const useAI = !k.isPlayer || state.attract || k.finished || debug.autopilot;
      const inp = useAI ? aiInput(k, dt) : pin;
      updateKart(k, inp, dt);
    }
    kartCollisions();
    updateHazards(dt);
  }

  if (state.phase === 'race' && state.finishWait > 0) {
    state.finishWait -= dt;
    if (state.finishWait <= 0) { state.phase = 'finished'; showResults(); }
  }

  if (state.bannerT > 0) state.bannerT -= dt;
  if (shake > 0) shake -= dt;
}

// ------------------------------ CÂMERA --------------------------------
const cam = { x: 0, y: 0, a: 0, fx: 1, fy: 0, rx: 0, ry: 1 };
function camTarget() {
  if (state.attract) return computeRanks()[0];
  return player;
}
function snapCamera() {
  const k = camTarget();
  cam.a = k.a;
  updateCamera(0, true);
}
function updateCamera(dt, snap) {
  const k = camTarget();
  cam.a = snap ? k.a : cam.a + wrapAngle(k.a - cam.a) * (1 - Math.exp(-7 * dt));
  cam.fx = Math.cos(cam.a); cam.fy = Math.sin(cam.a);
  cam.rx = -cam.fy; cam.ry = cam.fx;
  cam.x = k.x - cam.fx * CAM_DIST;
  cam.y = k.y - cam.fy * CAM_DIST;
}

// ------------------------------ RENDER --------------------------------
const groundImg = ctx.createImageData(W, H - HORIZON);
const ground32 = new Uint32Array(groundImg.data.buffer);

function renderSky() {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#3b82e0');
  g.addColorStop(1, '#a9dcff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HORIZON + 1);
  const off = (a, w, speed) => ((-a * (PANO / (Math.PI * 2)) * speed) % w + w) % w;
  const co = off(cam.a, HILLS_W, 0.6) + performance.now() * 0.004;
  for (let x = -(co % HILLS_W); x < W; x += HILLS_W) ctx.drawImage(clouds, Math.round(x), 4);
  const ho = off(cam.a, HILLS_W, 1);
  for (let x = -ho; x < W; x += HILLS_W) ctx.drawImage(hills, Math.round(x), HORIZON - 69);
}

function renderGround() {
  const { x: cx0, y: cy0, fx, fy, rx, ry } = cam;
  const rows = H - HORIZON;
  for (let row = 0; row < rows; row++) {
    const dy = row + 1;
    const dist = (CAM_H * FOCAL) / dy;
    const half = (dist * (W / 2)) / FOCAL;
    const cx = cx0 + fx * dist, cy = cy0 + fy * dist;
    let wx = cx - rx * half, wy = cy - ry * half;
    let sx = (rx * half * 2) / W, sy = (ry * half * 2) / W;
    let o = row * W;
    if ((half * 2) / W > 2.2) {
      // longe: usa textura reduzida
      wx /= MIP; wy /= MIP; sx /= MIP; sy /= MIP;
      for (let x = 0; x < W; x++) {
        const tx = wx | 0, ty = wy | 0;
        ground32[o++] = (tx >= 0 && tx < TEXM && ty >= 0 && ty < TEXM) ? texM32[ty * TEXM + tx] : GRASS_COLOR;
        wx += sx; wy += sy;
      }
    } else {
      for (let x = 0; x < W; x++) {
        const tx = wx | 0, ty = wy | 0;
        ground32[o++] = (tx >= 0 && tx < TEX && ty >= 0 && ty < TEX) ? tex32[ty * TEX + tx] : GRASS_COLOR;
        wx += sx; wy += sy;
      }
    }
  }
  ctx.putImageData(groundImg, 0, HORIZON);
  // neblina no horizonte
  const fog = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 34);
  fog.addColorStop(0, 'rgba(190,226,255,0.85)');
  fog.addColorStop(1, 'rgba(190,226,255,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, HORIZON, W, 34);
}

// projeta ponto do mundo (x, y, altura z) na tela
function proj(x, y, z) {
  const dx = x - cam.x, dy = y - cam.y;
  const f = dx * cam.fx + dy * cam.fy;
  const r = dx * cam.rx + dy * cam.ry;
  return { f, sx: W / 2 + (r * FOCAL) / f, sy: HORIZON + ((CAM_H - z) * FOCAL) / f };
}

// ---- modelo 3D simples do kart (caixas) ----
const FACES = [[4, 5, 6, 7, 1.18], [0, 1, 5, 4, 0.78], [1, 2, 6, 5, 0.9], [2, 3, 7, 6, 0.78], [3, 0, 4, 7, 0.9]];
function boxFaces(out, ox, oy, oz, ca, sa, u0, u1, v0, v1, z0, z1, color) {
  const cs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const P = [];
  for (const z of [z0, z1]) {
    for (const [u, v] of cs) {
      P.push(proj(ox + u * ca - v * sa, oy + u * sa + v * ca, oz + z));
    }
  }
  for (const [a, b, c, d, f] of FACES) {
    const depth = (P[a].f + P[b].f + P[c].f + P[d].f) / 4;
    out.push({ depth, pts: [P[a], P[b], P[c], P[d]], color: shade(color, f) });
  }
}

function drawKart(k) {
  const yaw = k.a + k.spinVis + (k.drift ? k.drift * 0.35 : 0);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const center = proj(k.x, k.y, 0);
  if (center.f < 8) return;

  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.33)';
  ctx.beginPath();
  for (const [u, v] of [[-10, -8], [11, -8], [11, 8], [-10, 8]]) {
    const p = proj(k.x + u * ca - v * sa, k.y + u * sa + v * ca, 0);
    ctx.lineTo(p.sx, p.sy);
  }
  ctx.fill();

  let body = k.color;
  if (k.star > 0) {
    const h = ((performance.now() / 4) % 360) | 0;
    body = hslToHex(h, 90, 60);
  }
  const blink = k.invuln > 0 && k.spin <= 0 && Math.floor(performance.now() / 80) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.5;

  const z = k.z;
  const faces = [];
  // rodas
  for (const [u0, u1, v0, v1] of [[-9, -3, -9, -5.5], [-9, -3, 5.5, 9], [3, 8, -8.5, -5.5], [3, 8, 5.5, 8.5]]) {
    boxFaces(faces, k.x, k.y, z, ca, sa, u0, u1, v0, v1, 0, 5, '#1d1d22');
  }
  boxFaces(faces, k.x, k.y, z, ca, sa, -8, 8, -6, 6, 2, 5.5, body);        // chassi
  boxFaces(faces, k.x, k.y, z, ca, sa, 8, 12, -4.5, 4.5, 2, 4.5, body);    // bico
  boxFaces(faces, k.x, k.y, z, ca, sa, -10, -8, -7, 7, 2.5, 5, shade(body, 0.55)); // para-choque
  boxFaces(faces, k.x, k.y, z, ca, sa, -7, -4, -3.5, 3.5, 5.5, 9, '#2b2b30'); // banco
  boxFaces(faces, k.x, k.y, z, ca, sa, -4, 0, -3, 3, 5.5, 11, k.shirt);   // piloto
  faces.sort((a, b) => b.depth - a.depth);
  for (const f of faces) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(f.pts[0].sx, f.pts[0].sy);
    for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i].sx, f.pts[i].sy);
    ctx.closePath();
    ctx.fill();
  }

  // cabeça (capacete na cor do kart) + olhos quando está de frente
  const hu = -2, hz = z + 14;
  const head = proj(k.x + hu * ca, k.y + hu * sa, hz);
  const r = (4 * FOCAL) / head.f;
  ctx.fillStyle = '#ffd3a3';
  ctx.beginPath(); ctx.arc(head.sx, head.sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(head.sx, head.sy - r * 0.15, r * 1.02, Math.PI, 0); ctx.fill();
  ctx.fillRect(head.sx - r * 1.02, head.sy - r * 0.2, r * 2.04, r * 0.3);
  const front = proj(k.x + (hu + 4) * ca, k.y + (hu + 4) * sa, hz);
  if (front.f < head.f - 1) {
    const ex = front.sx - head.sx;
    ctx.fillStyle = '#111';
    const es = Math.max(1, r * 0.22);
    ctx.fillRect(head.sx + ex * 0.8 - r * 0.38 - es / 2, head.sy + r * 0.25, es, es * 1.6);
    ctx.fillRect(head.sx + ex * 0.8 + r * 0.38 - es / 2, head.sy + r * 0.25, es, es * 1.6);
  }
  ctx.globalAlpha = 1;

  // nome acima dos rivais próximos
  if (!k.isPlayer && head.f < 260) {
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(k.name, head.sx + 1, head.sy - r - 5);
    ctx.fillStyle = '#fff';
    ctx.fillText(k.name, head.sx, head.sy - r - 6);
  }
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function drawBox(b) {
  const bob = Math.sin(b.rot * 1.5) * 1.5;
  const ca = Math.cos(b.rot), sa = Math.sin(b.rot);
  const faces = [];
  const hue = ((performance.now() / 10) % 360) | 0;
  boxFaces(faces, b.x, b.y, 4 + bob, ca, sa, -5.5, 5.5, -5.5, 5.5, 0, 11, hslToHex(hue, 85, 62));
  faces.sort((a, c) => c.depth - a.depth);
  ctx.globalAlpha = 0.85;
  for (const f of faces) {
    ctx.fillStyle = f.color;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.pts[0].sx, f.pts[0].sy);
    for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i].sx, f.pts[i].sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const c = proj(b.x, b.y, 9.5 + bob);
  const size = Math.max(6, (9 * FOCAL) / c.f);
  ctx.font = `${size | 0}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000'; ctx.fillText('?', c.sx + 1, c.sy + 1);
  ctx.fillStyle = '#fff'; ctx.fillText('?', c.sx, c.sy);
  ctx.textBaseline = 'alphabetic';
}

function drawHazard(h) {
  const p = proj(h.x, h.y, h.type === 'banana' ? 3 : 4);
  const s = FOCAL / p.f;
  const g = proj(h.x, h.y, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(g.sx, g.sy, 6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (h.type === 'banana') {
    ctx.strokeStyle = '#6b4a00'; ctx.lineWidth = Math.max(1, 4.5 * s); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(p.sx, p.sy - 4 * s, 5 * s, 0.2 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = Math.max(1, 3 * s);
    ctx.beginPath(); ctx.arc(p.sx, p.sy - 4 * s, 5 * s, 0.2 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.lineCap = 'butt';
  } else {
    const col = h.type === 'red' ? '#e53935' : '#2e9e44';
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(p.sx, p.sy, 5.5 * s + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, 5.5 * s, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.sx - 5.5 * s, p.sy - 0.5 * s, 11 * s, 2 * s);
    ctx.fillStyle = '#fff6d0';
    ctx.beginPath(); ctx.arc(p.sx, p.sy + 1.5 * s, 5.5 * s, 0, Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(p.sx - 2 * s, p.sy - 2.5 * s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTree(t, p) {
  const s = (FOCAL / p.f) * t.s;
  if (t.kind === 'bush') {
    ctx.fillStyle = '#1f6b2c';
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy - 5 * s, 11 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f8f3c';
    ctx.beginPath(); ctx.ellipse(p.sx - 2 * s, p.sy - 7 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(p.sx, p.sy, 12 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(p.sx - 2.5 * s, p.sy - 16 * s, 5 * s, 16 * s);
  const layers = [['#1d6e2d', 0, 24, 13], ['#278c3a', -1, 33, 11], ['#35a848', -2, 41, 8]];
  for (const [c, ox, oy, r] of layers) {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(p.sx + ox * s, p.sy - oy * s, r * s, 0, Math.PI * 2); ctx.fill();
  }
}

function renderSprites() {
  const list = [];
  const add = (x, y, maxDist, draw) => {
    const dx = x - cam.x, dy = y - cam.y;
    const f = dx * cam.fx + dy * cam.fy;
    if (f < 10 || f > maxDist) return;
    const r = dx * cam.rx + dy * cam.ry;
    if (Math.abs(r) > f * 1.3 + 60) return; // fora do campo de visão
    list.push({ f, draw });
  };
  for (const t of trees) add(t.x, t.y, 1500, () => drawTree(t, proj(t.x, t.y, 0)));
  for (const b of boxes) if (b.active) add(b.x, b.y, 900, () => drawBox(b));
  for (const h of hazards) add(h.x, h.y, 800, () => drawHazard(h));
  for (const k of karts) add(k.x, k.y, 1200, () => drawKart(k));
  for (const p of particles) {
    add(p.x, p.y, 500, () => {
      const q = proj(p.x, p.y, p.z);
      const s = Math.max(1, (p.size * FOCAL) / q.f / 4);
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(q.sx - s / 2, q.sy - s / 2, s, s);
      ctx.globalAlpha = 1;
    });
  }
  list.sort((a, b) => b.f - a.f);
  for (const s of list) s.draw();
}

// ------------------------------- HUD ----------------------------------
const FONT = '"Press Start 2P", monospace';
function text(str, x, y, size, color = '#fff', align = 'left', outline = 3) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = '#000';
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) if (ox || oy) ctx.fillText(str, x + ox * outline / 2, y + oy * outline / 2);
  ctx.fillText(str, x + outline / 2, y + outline);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${m}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`;
}

function renderHUD() {
  if (state.attract) {
    text('DEMO', 12, 22, 10, '#ffd400');
    return;
  }
  // volta e tempo
  text(`VOLTA ${clamp(player.lap, 1, LAPS)}/${LAPS}`, 12, 22, 12);
  text(fmtTime(player.finished ? player.finishTime : state.raceTime), 12, 42, 10, '#ffd400');

  // item
  const bx = W / 2 - 22, by = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx, by, 44, 44);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, 44, 44);
  let icon = null;
  if (player.roulette > 0) {
    const names = Object.keys(ITEM_ICON);
    icon = ITEM_ICON[names[Math.floor(performance.now() / 70) % names.length]];
  } else if (player.item) icon = ITEM_ICON[player.item];
  if (icon) {
    ctx.font = '26px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, W / 2, by + 24);
    ctx.textBaseline = 'alphabetic';
  }

  // minimapa
  const mx = W - minimap.width - 8, my = 8, s = minimap.width / TEX;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(minimap, mx, my);
  ctx.globalAlpha = 1;
  for (const k of [...karts].reverse()) {
    ctx.fillStyle = '#000';
    ctx.fillRect(mx + k.x * s - (k.isPlayer ? 4 : 3), my + k.y * s - (k.isPlayer ? 4 : 3), k.isPlayer ? 8 : 6, k.isPlayer ? 8 : 6);
    ctx.fillStyle = k.color;
    ctx.fillRect(mx + k.x * s - (k.isPlayer ? 3 : 2), my + k.y * s - (k.isPlayer ? 3 : 2), k.isPlayer ? 6 : 4, k.isPlayer ? 6 : 4);
  }

  // posição
  const pos = player.rank + 1;
  const colors = ['#ffd400', '#d9d9d9', '#e0904a'];
  text(`${pos}º`, W - 14, H - 16, 34, colors[pos - 1] || '#ffffff', 'right', 5);

  // turbo do drift
  if (player.drift) {
    const lvl = player.driftTime > 2 ? 2 : player.driftTime > 0.9 ? 1 : 0;
    const w = 90, fill = clamp(player.driftTime / 2, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(12, H - 26, w + 4, 12);
    ctx.fillStyle = ['#ffffff', '#4fc3ff', '#ff9d1a'][lvl];
    ctx.fillRect(14, H - 24, w * fill, 8);
    text('DRIFT', 12, H - 32, 8, ctx.fillStyle);
  }

  // contagem
  if (state.phase === 'countdown') {
    const c = Math.ceil(state.countdown);
    if (c >= 1 && c <= 3) {
      const t = state.countdown % 1;
      text(String(c), W / 2, H / 2 - 10, Math.round(40 + t * 30), '#ffd400', 'center', 6);
    }
  }
  if (state.bannerT > 0 && state.banner) {
    text(state.banner, W / 2, H / 2 - 30, state.banner.length > 6 ? 22 : 40, '#ffd400', 'center', 5);
  }
  if (phone.connected === 0 && state.phase !== 'results') {
    text('teclado: setas · espaço=drift · X=item', W / 2, H - 8, 7, '#ffffffaa', 'center', 2);
  }
}

// ------------------------------- LOOP ---------------------------------
let acc = 0, lastT = performance.now(), phoneTick = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  acc += dt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 6) { update(FIXED_DT); acc -= FIXED_DT; steps++; }
  if (steps === 6) acc = 0;

  updateCamera(dt, false);
  renderSky();
  renderGround();
  renderSprites();
  renderHUD();

  Snd.engine(player.speed, !state.attract && !state.paused && state.phase !== 'results');
  canvas.style.transform = shake > 0 ? `translate(${(rand() - 0.5) * 8}px, ${(rand() - 0.5) * 8}px)` : '';

  if ((phoneTick -= dt) <= 0) { phoneTick = 0.15; pushPhoneState(false); }

  // se o celular parar de mandar sinais, solta os botões
  if (phone.connected && performance.now() - phone.last > 1500) { phone.gas = phone.brake = phone.drift = false; phone.steer = 0; }

  requestAnimationFrame(frame);
}

buildTexture();
buildSky();
startAttract();
updateStatus();
connect();
requestAnimationFrame(frame);

})();
