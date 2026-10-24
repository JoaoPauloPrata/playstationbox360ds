'use strict';
// =====================================================================
//  PANCADARIA — motor do jogo de luta
// =====================================================================
(() => {
const { CHARS, POSES, lerpPose, drawFighter } = window.PANCADARIA;

// ------------------------------- CONFIG -------------------------------
const W = 640, H = 360;   // resolução lógica
const GY = 318;           // chão
const SW = 960;           // largura do cenário
const SCALE = 2;          // resolução real = 2x
const ROUND_TIME = 99;
const WINS_NEEDED = 2;
const BUFFER = 8;         // frames que um botão fica "guardado"

const canvas = document.getElementById('game');
canvas.width = W * SCALE; canvas.height = H * SCALE;
const ctx = canvas.getContext('2d');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = Math.random;
const $ = (id) => document.getElementById(id);
const FONT = '"Press Start 2P", monospace';

// -------------------------------- SOM ---------------------------------
const Sfx = {
  ac: null, noise: null, master: null,
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ac.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 0.6;
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
      $('soundHint').classList.add('hidden');
    } catch { /* sem áudio */ }
  },
  tone(freq, dur, type = 'square', vol = 0.1, slide = 0, delay = 0) {
    if (!this.ac) return;
    const t = this.ac.currentTime + delay;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  burst(dur, freq, vol = 0.3, q = 1) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const s = this.ac.createBufferSource(); s.buffer = this.noise;
    const f = this.ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur);
  },
  hit(heavy) { this.burst(heavy ? 0.22 : 0.12, heavy ? 500 : 900, 0.5); this.tone(heavy ? 90 : 140, 0.12, 'sine', 0.35, -50); },
  block() { this.burst(0.07, 2500, 0.25, 3); this.tone(800, 0.05, 'square', 0.05); },
  swing() { this.burst(0.09, 1800, 0.12, 0.7); },
  fire() { this.tone(200, 0.35, 'sawtooth', 0.08, 300); this.burst(0.3, 700, 0.15); },
  ko() { this.tone(300, 0.9, 'sawtooth', 0.15, -260); this.burst(0.6, 300, 0.4); },
  superSnd() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.09, 0, i * 0.06)); },
  zap() { this.burst(0.08, 3500, 0.12, 2); this.tone(1200 + rand() * 600, 0.05, 'square', 0.04); },
  grab() { this.tone(160, 0.1, 'square', 0.12); },
  slam() { this.burst(0.5, 200, 0.7); this.tone(60, 0.4, 'sine', 0.5, -20); },
  announce(n) { [440, 554, 659].slice(0, n).forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, 0, i * 0.08)); },
  select() { this.tone(660, 0.05, 'square', 0.06); },
  lock() { this.tone(523, 0.08, 'square', 0.08); this.tone(784, 0.14, 'square', 0.08, 0, 0.08); },
};
$('soundHint').addEventListener('click', () => Sfx.unlock());
addEventListener('pointerdown', () => Sfx.unlock());

// ------------------------------- ESTADO -------------------------------
const G = {
  phase: 'select',  // select | vs | intro | fight | ko | results
  phaseT: 0,
  frame: 0,
  round: 1,
  timer: ROUND_TIME,
  timerF: 0,
  wins: [0, 0],
  F: [null, null],
  projs: [],
  fx: [],
  hitstop: 0,
  superFlash: 0, superBy: null,
  shake: 0,
  camX: (SW - W) / 2,
  camTarget: (SW - W) / 2,
  stage: 0,
  announce: null,
  combo: [null, null],
  sel: [{ hover: 0, locked: false, t: 0 }, { hover: 3, locked: false, t: 0 }],
  sides: [{ pid: null, kb: false, dropped: false }, { pid: null, kb: false, dropped: false }],
  winner: null,
  koText: '',
  lastWinner: -1,
};
const isCpu = (i) => i === 0 ? G.sides[0].dropped && !G.sides[0].pid : !G.sides[1].pid && !G.sides[1].kb;

// ------------------------------ ENTRADAS ------------------------------
const phoneIn = [{ x: 0, y: 0, last: 0 }, { x: 0, y: 0, last: 0 }];
const keys = {};
const KB = [
  { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', p: 'KeyJ', k: 'KeyK', s: 'KeyL', su: 'KeyI' },
  { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', p: 'KeyN', k: 'KeyM', s: 'Comma', su: 'Period' },
];

addEventListener('keydown', (e) => {
  if (keys[e.code]) return;
  keys[e.code] = true;
  Sfx.unlock();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.code === 'Escape') return arcade.exit();
  for (let i = 0; i < 2; i++) {
    const k = KB[i];
    const isMine = Object.values(k).includes(e.code);
    if (!isMine) continue;
    if (i === 1 && !G.sides[1].pid && !G.sides[1].kb && (G.phase === 'select' || G.phase === 'results')) {
      G.sides[1].kb = true;
      toast('⌨️ P2 entrou pelo teclado');
    }
    if (i === 1 && !G.sides[1].kb) continue;
    const dir = e.code === k.left ? 'left' : e.code === k.right ? 'right' : e.code === k.up ? 'up' : e.code === k.down ? 'down' : null;
    if (G.phase === 'select') {
      if (dir) selNav(i, dir);
      if (e.code === k.p || (i === 0 && e.code === 'Enter')) selLock(i);
      if (e.code === k.k) selUnlock(i);
    } else if (G.phase === 'results') {
      if (e.code === k.p || e.code === 'Enter') rematch();
      if (e.code === k.k) reselect();
    } else {
      const b = e.code === k.p ? 'p' : e.code === k.k ? 'k' : e.code === k.s ? 's' : e.code === k.su ? 'su' : null;
      if (b) pressBtn(i, b);
    }
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function pressBtn(side, b) {
  const F = G.F[side];
  if (F) F.press[b] = BUFFER;
}

function readInput(side) {
  const k = KB[side];
  let x = 0, y = 0;
  if (side === 0 || G.sides[1].kb) {
    x = (keys[k.right] ? 1 : 0) - (keys[k.left] ? 1 : 0);
    y = (keys[k.up] ? 1 : 0) - (keys[k.down] ? 1 : 0);
  }
  const ph = phoneIn[side];
  if (G.sides[side].pid && performance.now() - ph.last < 1500) {
    if (ph.x) x = ph.x;
    if (ph.y) y = ph.y;
  }
  return { x, y };
}

// ------------------------------ LUTADOR -------------------------------
function makeFighter(side, charIdx) {
  const c = CHARS[charIdx];
  return {
    side, c, x: side === 0 ? SW / 2 - 90 : SW / 2 + 90, y: GY, vx: 0, vy: 0, f: side === 0 ? 1 : -1, df: 1,
    hp: c.hp, hpShown: c.hp, hpDelay: 0, meter: 0, superReady: false,
    st: 'idle', stun: 0, move: null, mf: 0, hitCount: 0, lastHitF: -999, armorUsed: false,
    air: false, airUsed: false, crouching: false, holdBack: false, invuln: 0,
    combo: 0, koed: false, flash: 0, shock: 0, grab: null, thrownKind: null, proj: null,
    press: { p: 0, k: 0, s: 0, su: 0 }, dirs: [], in: { x: 0, y: 0 }, lastDir: 5,
    walkPh: 0, jumpDir: 0, alpha: 1, spinT: 0, aiMove: null,
    ai: { timer: 20, plan: 'idle', started: false, block: null, skill: 0.55 },
  };
}

function resetForRound(F) {
  Object.assign(F, {
    x: F.side === 0 ? SW / 2 - 90 : SW / 2 + 90, y: GY, vx: 0, vy: 0, f: F.side === 0 ? 1 : -1,
    hp: F.c.hp, hpShown: F.c.hp, st: 'idle', stun: 0, move: null, mf: 0, air: false, invuln: 0,
    combo: 0, koed: false, flash: 0, shock: 0, grab: null, proj: null, alpha: 1, aiMove: null,
    press: { p: 0, k: 0, s: 0, su: 0 }, dirs: [],
  });
}

const numpad = (x, y, f) => (y < 0 ? 1 : y > 0 ? 7 : 4) + (x * f + 1);

function hasSeq(list, pat) {
  let i = 0;
  for (const d of list) { if (d === pat[i]) i++; if (i === pat.length) return true; }
  return false;
}
function motion(F) {
  const recent = F.dirs.filter((d) => G.frame - d.fr <= 18).map((d) => d.d);
  if (hasSeq(recent, [6, 2, 3])) return 'dp';
  if (hasSeq(recent, [2, 3, 6])) return 'qcf';
  if (hasSeq(recent, [2, 1, 4])) return 'qcb';
  return null;
}

const NEUTRAL = ['idle', 'walk', 'crouch'];
const inActive = (F) => F.st === 'move' && F.mf >= F.move.startup && F.mf < F.move.startup + F.move.active;
const opp = (F) => G.F[1 - F.side];

function faceOpp(F) {
  const O = opp(F);
  if (O.x > F.x + 1) F.f = 1; else if (O.x < F.x - 1) F.f = -1;
}

function canThrow(O) {
  return !O.air && ['idle', 'walk', 'crouch', 'move', 'land', 'prejump'].includes(O.st) && O.invuln <= 0;
}

function tryAction(F) {
  const c = F.c, M = c.moves, pr = F.press, O = opp(F);
  const fwd = F.in.x * F.f;
  let m = null, isSuper = false;

  if (F.aiMove) {
    const w = F.aiMove; F.aiMove = null;
    if (w === 'super') { if (F.meter >= 100) { m = M.super; isSuper = true; } }
    else m = M[w];
  } else if (pr.su > 0) {
    pr.su = 0;
    if (F.meter >= 100) { m = M.super; isSuper = true; }
  } else if (pr.s > 0) {
    pr.s = 0;
    m = F.in.y > 0 ? M.sp2 : (F.in.y < 0 || fwd < 0) ? M.sp3 : M.sp1;
  } else if (pr.p > 0 || pr.k > 0) {
    const isP = pr.p > 0;
    pr.p = pr.k = 0;
    const mo = motion(F);
    if (mo === 'dp') m = M.sp2;
    else if (mo === 'qcf') m = isP ? M.sp1 : M.sp3;
    else if (mo === 'qcb') m = M.sp3;
    else if (isP && F.in.x !== 0 && Math.abs(O.x - F.x) < M.throw.grab.range && canThrow(O)) m = M.throw;
    else if (F.in.y < 0) m = isP ? M.cP : M.cK;
    else m = isP ? M.sP : M.sK;
  }
  if (!m) return false;
  if (m.projSlot && F.proj) return false; // só uma bola de energia por vez
  if (isSuper) {
    F.meter = 0;
    F.superReady = false;
    G.superFlash = 40;
    G.superBy = F;
    Sfx.superSnd();
    sendTo(F.side, { t: 'vibe', ms: [30, 30, 60] });
  }
  startMove(F, m);
  return true;
}

function startMove(F, m) {
  F.st = 'move'; F.move = m; F.mf = 0; F.hitCount = 0; F.lastHitF = -999; F.armorUsed = false;
  if (!m.air) F.vx = 0;
  F.dirs = [];
  if (!m.proj && !m.grab && !m.teleport) Sfx.swing();
}

function startJump(F) {
  F.st = 'prejump'; F.stun = 4; F.jumpDir = F.in.x; F.vx = 0;
}

// ------------------------------ FÍSICA ---------------------------------
function physics(F) {
  if (F.st === 'thrown' || F.st === 'grab') return;
  if (F.air) {
    F.vy += F.c.grav;
    F.x += F.vx; F.y += F.vy;
    if (F.y >= GY) { F.y = GY; land(F); }
  } else {
    F.x += F.vx;
    const keep = F.st === 'walk' || (F.st === 'move' && F.move.keepVx && inActive(F));
    if (!keep) { F.vx *= 0.82; if (Math.abs(F.vx) < 0.05) F.vx = 0; }
  }
}

function land(F) {
  F.air = false; F.vy = 0;
  switch (F.st) {
    case 'jump': F.st = 'land'; F.stun = 4; F.vx = 0; dust(F.x, 6); break;
    case 'move':
      if (F.move.untilLand || F.move.air) { F.st = 'land'; F.stun = F.move.landLag || 5; F.move = null; F.vx = 0; dust(F.x, 6); }
      break;
    case 'recoverAir': F.st = 'land'; F.stun = 10; F.vx = 0; break;
    case 'hitair':
      F.st = 'knock'; F.stun = F.koed ? 9999 : 40; F.vx *= 0.3;
      dust(F.x, 14); G.shake = Math.max(G.shake, 5); Sfx.burst(0.15, 250, 0.3);
      break;
    default: F.vx = 0;
  }
}

// --------------------------- CAIXAS DE COLISÃO --------------------------
const CROUCH_POSES = new Set(['cpunch', 'sweep', 'electric', 'ball', 'crouch', 'getup']);
function hurtbox(F) {
  if (['knock', 'getup', 'ko'].includes(F.st)) return null;
  if (F.st === 'move' && F.move.teleport && F.mf < F.move.startup + 8) return null;
  const c = F.c, hw = c.width / 2;
  let h = c.height, bottom = F.y;
  const crouchy = (F.st === 'crouch' || F.st === 'land' || ((F.st === 'blockstun' || F.st === 'hitstun') && F.crouching))
    || (F.st === 'move' && CROUCH_POSES.has(F.move.pose));
  if (crouchy) h = c.height * 0.62;
  if (F.air) { bottom = F.y - 6; h = c.height * 0.85; }
  if (F.st === 'move' && POSES[F.move.pose].lift) bottom = F.y - POSES[F.move.pose].lift * 0.5;
  return { x1: F.x - hw, x2: F.x + hw, y1: bottom - h, y2: bottom };
}
function hitRect(F, hb) {
  const a = F.x + F.f * hb.x, b = F.x + F.f * (hb.x + hb.w);
  return { x1: Math.min(a, b), x2: Math.max(a, b), y1: F.y - hb.y - hb.h, y2: F.y - hb.y };
}
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// -------------------------------- GOLPES --------------------------------
function invulnTo(def, isProj) {
  if (def.invuln > 0) return true;
  if (['knock', 'getup', 'ko', 'thrown'].includes(def.st)) return true;
  if (def.st === 'move') {
    const m = def.move;
    if (m.invuln && def.mf >= m.invuln[0] && def.mf <= m.invuln[1]) return true;
    if (isProj && m.projInvuln && def.mf >= m.projInvuln[0] && def.mf <= m.projInvuln[1]) return true;
  }
  if (def.st === 'grab') return true;
  return false;
}

/** Aplica um acerto. Retorna 'hit' | 'block' | 'armor' | null */
function applyHit(att, def, a, o) {
  if (invulnTo(def, o.proj)) return null;
  const dir = o.dir;
  const canBlock = !def.air && ['idle', 'walk', 'crouch', 'blockstun', 'land'].includes(def.st) && def.holdBack;
  let blocked = false;
  if (canBlock) {
    if (a.level === 'low' && !def.crouching) blocked = false;
    else if (a.level === 'high' && def.crouching) blocked = false;
    else blocked = true;
  }
  const cx = (o.px != null) ? o.px : (att.x + def.x) / 2 + dir * 6;
  const cy = (o.py != null) ? o.py : def.y - def.c.height * (def.crouching ? 0.45 : 0.62);

  if (blocked) {
    def.st = 'blockstun'; def.stun = a.bs; def.vx = dir * (a.push || 4) * 0.9;
    const chip = a.chip || 0;
    if (chip) { def.hp = Math.max(0, def.hp - chip); def.hpDelay = 30; if (def.hp <= 0) koFighter(def, dir); }
    G.hitstop = 5;
    att.meter = Math.min(100, att.meter + 3);
    spark(cx, cy, 'block');
    Sfx.block();
    pushAttacker(att, def, dir, a, o);
    return 'block';
  }

  if (def.st === 'move' && def.move.armor && !def.armorUsed && def.mf < def.move.startup + def.move.active) {
    def.armorUsed = true;
    def.hp = Math.max(1, def.hp - a.dmg * 0.5);
    def.flash = 6; def.hpDelay = 30;
    G.hitstop = 8;
    spark(cx, cy, 'hit');
    Sfx.hit(true);
    return 'armor';
  }

  const scale = Math.max(0.35, 1 - 0.12 * def.combo);
  const dmg = Math.round(a.dmg * scale);
  def.hp = Math.max(0, def.hp - dmg);
  def.hpDelay = 30;
  def.combo++;
  def.move = null;
  def.flash = 4;
  if (a.shock) def.shock = 16;
  if (def.proj && def.st === 'move') { /* projétil já lançado continua */ }

  if (def.combo >= 2) G.combo[att.side] = { n: def.combo, t: 90 };

  const knock = a.kd || def.air || (a.kdLast && o.last);
  if (def.hp <= 0) koFighter(def, dir);
  else if (knock) {
    def.st = 'hitair'; def.air = true;
    def.vx = dir * (a.launch ? a.launch.vx : 3);
    def.vy = a.launch ? a.launch.vy : -6;
    if (def.y >= GY) def.y = GY - 1;
  } else {
    def.st = 'hitstun'; def.stun = a.hs; def.vx = dir * (a.push || 4);
  }

  G.hitstop = a.heavy || o.last && a.hits > 1 ? 10 : 7;
  G.shake = Math.max(G.shake, a.heavy ? 6 : 3);
  if (!att.isSuperMove) att.meter = Math.min(100, att.meter + dmg * 0.12);
  def.meter = Math.min(100, def.meter + dmg * 0.06);
  spark(cx, cy, a.dmg >= 90 ? 'big' : 'hit');
  Sfx.hit(a.dmg >= 80);
  if (a.shock) Sfx.zap();
  sendTo(def.side, { t: 'vibe', ms: a.dmg >= 90 ? 90 : 45 });
  pushAttacker(att, def, dir, a, o);
  return 'hit';
}

function pushAttacker(att, def, dir, a, o) {
  if (o.proj) return;
  const b = bounds();
  if (def.x <= b.min + 2 || def.x >= b.max - 2) att.vx = -dir * (a.push || 4) * 0.8;
}

function koFighter(F, dir) {
  F.hp = 0; F.koed = true; F.move = null;
  F.st = 'hitair'; F.air = true; F.vx = dir * 3.5; F.vy = -8;
  if (F.y >= GY) F.y = GY - 1;
}

function meleeCheck(F) {
  if (F.st !== 'move') return;
  const m = F.move;
  if (!m.hb || m.grab || m.teleport) return;
  if (!inActive(F)) return;
  if (F.hitCount >= m.hits) return;
  if (F.hitCount > 0 && F.mf - F.lastHitF < m.rehit) return;
  const O = opp(F);
  const hr = hurtbox(O);
  if (!hr || !overlap(hitRect(F, m.hb), hr)) return;
  F.isSuperMove = m === F.c.moves.super;
  const last = F.hitCount + 1 >= m.hits;
  const res = applyHit(F, O, m, { dir: F.f, last });
  if (!res) return;
  F.hitCount++;
  F.lastHitF = F.mf;
  if (m.bounce) {
    F.move = null; F.st = 'recoverAir'; F.air = true; F.vy = -6; F.vx = -F.f * 3;
  }
}

function spawnProj(F, p) {
  const s = F.c.body.scale;
  const pr = {
    owner: F, x: F.x + F.f * 26 * s, y: F.y - p.y, vx: p.speed * F.f, r: p.r,
    dmg: p.dmg, chip: p.chip || 0, hs: p.hs || 16, bs: p.bs || 12, push: 3, level: 'mid',
    hits: p.hits || 1, maxHits: p.hits || 1, rehit: p.rehit || 0, cd: 0, life: p.life || 400, kind: p.kind,
    kdLast: p.kdLast, launch: { vx: 4, vy: -7 }, heavy: (p.hits || 1) > 1, t: 0,
  };
  G.projs.push(pr);
  F.proj = pr;
  Sfx.fire();
}

function updateProjs() {
  for (const p of G.projs) {
    p.x += p.vx; p.t++; p.life--;
    if (p.cd > 0) p.cd--;
    if (p.x < -40 || p.x > SW + 40) p.life = 0;
    if (p.life <= 0 || p.hits <= 0) continue;
    const T = opp(p.owner);
    const hr = hurtbox(T);
    const box = { x1: p.x - p.r, x2: p.x + p.r, y1: p.y - p.r * 0.8, y2: p.y + p.r * 0.8 };
    if (hr && p.cd <= 0 && overlap(box, hr)) {
      p.owner.isSuperMove = p.maxHits > 1;
      const res = applyHit(p.owner, T, p, { dir: Math.sign(p.vx), proj: true, last: p.hits === 1, px: p.x + Math.sign(p.vx) * p.r * 0.5, py: p.y });
      if (res) { p.hits--; p.cd = p.rehit; }
    }
  }
  // projétil contra projétil
  for (let i = 0; i < G.projs.length; i++) {
    for (let j = i + 1; j < G.projs.length; j++) {
      const a = G.projs[i], b = G.projs[j];
      if (a.owner === b.owner || a.hits <= 0 || b.hits <= 0) continue;
      if (Math.abs(a.x - b.x) < a.r + b.r && Math.abs(a.y - b.y) < a.r + b.r) {
        a.hits--; b.hits--;
        spark((a.x + b.x) / 2, (a.y + b.y) / 2, 'big');
        Sfx.hit(false);
      }
    }
  }
  for (const p of G.projs) {
    if (p.life <= 0 || p.hits <= 0) {
      if (p.owner.proj === p) p.owner.proj = null;
      if (p.hits <= 0) for (let i = 0; i < 6; i++) G.fx.push({ type: 'puff', x: p.x, y: p.y, vx: (rand() - 0.5) * 4, vy: (rand() - 0.5) * 4, t: 0, max: 18, kind: p.kind });
    }
  }
  G.projs = G.projs.filter((p) => p.life > 0 && p.hits > 0);
}

// ------------------------------ AGARRÕES -------------------------------
function tryGrab(F, m) {
  const O = opp(F);
  if (Math.abs(O.x - F.x) > m.grab.range || !canThrow(O) || invulnTo(O, false)) return;
  F.st = 'grab'; F.grab = { ...m.grab, t: 0 }; F.move = null;
  O.st = 'thrown'; O.move = null; O.vx = 0; O.thrownKind = m.grab.kind; O.combo = 0;
  F.f = O.x >= F.x ? 1 : -1;
  Sfx.grab();
  sendTo(O.side, { t: 'vibe', ms: 60 });
}

function runGrab(F) {
  const O = opp(F), g = F.grab;
  g.t++;
  if (g.kind === 'throw') {
    if (g.t < 16) {
      O.x = F.x + F.f * 30; O.y = GY - Math.sin((g.t / 16) * Math.PI) * 26;
    } else if (g.t === 16) {
      O.x = F.x - F.f * 16; O.y = GY - 30; O.air = true; O.f = F.f;
      O.st = 'hitair'; O.vx = -F.f * 4.5; O.vy = -6;
      O.hp = Math.max(0, O.hp - g.dmg); O.hpDelay = 30;
      F.meter = Math.min(100, F.meter + 10);
      if (O.hp <= 0) koFighter(O, -F.f);
      G.hitstop = 6; G.shake = 6;
      Sfx.hit(true);
    } else if (g.t >= 30) { F.st = 'idle'; F.grab = null; }
  } else { // pilão giratório
    const T = g.big ? 56 : 44;
    if (g.t < T) {
      const h = Math.sin((g.t / T) * Math.PI) * (g.big ? 170 : 125);
      F.y = GY - h; F.spinT = g.t;
      O.x = F.x + F.f * 2; O.y = F.y - F.c.height * 0.55;
    } else if (g.t === T) {
      F.y = GY; F.spinT = 0;
      O.x = F.x + F.f * 26; O.y = GY;
      O.hp = Math.max(0, O.hp - g.dmg); O.hpDelay = 30;
      F.meter = Math.min(100, F.meter + (g.big ? 0 : 15));
      if (O.hp <= 0) { O.koed = true; }
      O.st = 'knock'; O.stun = O.koed ? 9999 : 50; O.air = false;
      G.hitstop = 12; G.shake = 14;
      dust(F.x, 30);
      spark(O.x, GY - 10, 'big');
      Sfx.slam();
      sendTo(O.side, { t: 'vibe', ms: [120, 40, 200] });
    } else if (g.t >= T + 18) { F.st = 'idle'; F.grab = null; }
  }
}

function teleport(F) {
  const O = opp(F), b = bounds();
  const side = Math.sign(O.x - F.x) || 1;
  let nx = O.x + side * 70;
  if (nx < b.min + 10 || nx > b.max - 10) nx = O.x - side * 70;
  F.x = clamp(nx, b.min, b.max);
  faceOpp(F);
}

// ------------------------------- PASSO --------------------------------
function stepFighter(F, inp, canControl) {
  const O = opp(F);
  F.in = canControl ? inp : { x: 0, y: 0 };
  const fwd = F.in.x * F.f;
  F.holdBack = fwd < 0;
  F.crouching = F.in.y < 0;
  const d = numpad(F.in.x, F.in.y, F.f);
  if (d !== F.lastDir) { F.dirs.push({ d, fr: G.frame }); if (F.dirs.length > 12) F.dirs.shift(); F.lastDir = d; }
  for (const k in F.press) if (F.press[k] > 0) F.press[k]--;
  if (!canControl) for (const k in F.press) F.press[k] = 0;
  if (F.invuln > 0) F.invuln--;
  if (F.flash > 0) F.flash--;
  if (F.shock > 0) F.shock--;

  switch (F.st) {
    case 'idle': case 'walk': case 'crouch': {
      F.combo = 0;
      faceOpp(F);
      if (canControl && tryAction(F)) break;
      if (F.in.y > 0) startJump(F);
      else if (F.in.y < 0) { F.st = 'crouch'; F.vx = 0; }
      else if (F.in.x) {
        F.st = 'walk';
        F.vx = F.in.x * (F.in.x * F.f > 0 ? F.c.walk : F.c.back);
        F.walkPh += F.vx * F.f * 0.09;
      } else { F.st = 'idle'; F.vx = 0; }
      break;
    }
    case 'prejump':
      if (canControl && (F.press.s > 0 || F.aiMove)) { F.in.y = 1; if (tryAction(F)) break; }
      if (--F.stun <= 0) {
        F.st = 'jump'; F.air = true; F.airUsed = false;
        F.vy = -F.c.jumpV; F.vx = F.jumpDir * F.c.jumpH;
      }
      break;
    case 'jump':
      if (!F.airUsed && (F.press.p > 0 || F.press.k > 0)) {
        const m = F.press.p > 0 ? F.c.moves.jP : F.c.moves.jK;
        F.press.p = F.press.k = 0;
        F.airUsed = true;
        startMove(F, m);
      }
      F.press.s = 0; F.press.su = 0;
      break;
    case 'land':
      if (--F.stun <= 0) F.st = 'idle';
      break;
    case 'move': runMove(F); break;
    case 'hitstun': case 'blockstun':
      if (--F.stun <= 0) F.st = F.crouching ? 'crouch' : 'idle';
      break;
    case 'knock':
      if (--F.stun <= 0) { if (F.koed) F.st = 'ko'; else { F.st = 'getup'; F.stun = 20; } }
      break;
    case 'getup':
      if (--F.stun <= 0) { F.st = 'idle'; F.invuln = 4; }
      break;
    case 'grab': runGrab(F); break;
  }
  physics(F);
}

function runMove(F) {
  const m = F.move;
  F.mf++;
  const fr = F.mf, S = m.startup, A = m.active;
  if (fr === S) {
    if (m.vx != null) F.vx = m.vx * F.f;
    if (m.vy != null) { F.vy = m.vy; F.air = true; }
    if (m.grab) { tryGrab(F, m); if (F.st === 'grab') return; }
    if (m.teleport) teleport(F);
    if (m.proj) spawnProj(F, m.proj);
    if (m.electric) Sfx.zap();
  }
  if (m.electric && fr > S && fr < S + A && fr % 5 === 0) Sfx.zap();
  if (m.steer && fr >= S && fr < S + A) F.vx = F.in.x * m.steer;
  if (m.teleport) F.alpha = fr < S ? 1 - fr / S : Math.min(1, (fr - S) / 10);
  if (m.untilLand) { if (fr > 240) { F.move = null; F.st = 'jump'; } return; }
  if (fr >= S + A + m.recovery) {
    F.move = null;
    F.alpha = 1;
    F.st = F.air ? 'jump' : 'idle';
    if (F.st === 'jump') F.airUsed = true;
  }
}

function separate(A, B) {
  if (['thrown', 'grab'].includes(A.st) || ['thrown', 'grab'].includes(B.st)) return;
  if (Math.abs(A.y - B.y) > 70) return;
  const min = (A.c.width + B.c.width) / 2 * 0.85;
  const dx = B.x - A.x;
  if (Math.abs(dx) < min) {
    const push = (min - Math.abs(dx)) / 2;
    const s = dx === 0 ? (A.f > 0 ? 1 : -1) : Math.sign(dx);
    A.x -= s * push; B.x += s * push;
  }
}

function bounds() {
  return { min: Math.max(20, G.camTarget + 18), max: Math.min(SW - 20, G.camTarget + W - 18) };
}

function updateCamera() {
  const [A, B] = G.F;
  G.camTarget = clamp((A.x + B.x) / 2 - W / 2, 0, SW - W);
  const b = bounds();
  for (const F of G.F) { if (F.st !== 'thrown') F.x = clamp(F.x, b.min, b.max); }
  G.camX = lerp(G.camX, G.camTarget, 0.25);
}

// --------------------------------- IA ---------------------------------
function aiInput(F) {
  const O = opp(F), ai = F.ai, info = F.c.ai;
  const dx = O.x - F.x, dist = Math.abs(dx), fwd = dx >= 0 ? 1 : -1;
  const out = { x: 0, y: 0 };
  const canAct = NEUTRAL.includes(F.st) || F.st === 'blockstun';

  // defesa
  const threat = (O.st === 'move' && O.move && !O.move.grab && O.mf <= O.move.startup + O.move.active && dist < 200)
    || (O.st === 'jump' && dist < 150 && O.vy > 0)
    || G.projs.some((p) => p.owner === O && Math.sign(p.vx) === Math.sign(F.x - p.x) && Math.abs(F.x - p.x) < 170);
  if (threat && canAct) {
    if (ai.block === null) ai.block = rand() < ai.skill;
    if (ai.block) {
      out.x = -fwd;
      out.y = O.move && O.move.level === 'low' ? -1 : 0;
      return out;
    }
  } else ai.block = null;

  // anti-aéreo
  if (NEUTRAL.includes(F.st) && O.air && O.vy > -3 && dist < 130 && dist > 15 && rand() < 0.1 * ai.skill) {
    F.aiMove = info.antiAir;
    return out;
  }

  if (--ai.timer <= 0) {
    ai.timer = 8 + Math.floor(rand() * 18);
    ai.started = false;
    const r = rand();
    const proj = info.proj && !F.proj;
    if (F.meter >= 100 && dist < 170 && r < 0.4) ai.plan = 'super';
    else if (dist > 230) ai.plan = proj && r < 0.45 ? 'sp1' : r < 0.85 ? 'fwd' : 'jumpin';
    else if (dist > 110) {
      ai.plan = r < 0.35 ? 'fwd' : r < 0.52 ? 'sK' : proj && r < 0.68 ? 'sp1' : r < 0.78 ? 'jumpin' : r < 0.88 ? info.approach : 'back';
    } else {
      ai.plan = info.grab && dist < 70 && r < 0.28 ? info.grab
        : info.close && r < 0.18 ? info.close
        : r < 0.24 ? 'sP' : r < 0.4 ? 'cK' : r < 0.5 ? 'throw' : r < 0.62 ? info.approach
        : r < 0.74 ? 'sK' : r < 0.86 ? 'guard' : 'back';
    }
  }

  switch (ai.plan) {
    case 'fwd': out.x = fwd; break;
    case 'back': out.x = -fwd; break;
    case 'guard': out.x = -fwd; out.y = rand() < 0.02 ? -1 : 0; break;
    case 'jumpin':
      if (!ai.started && NEUTRAL.includes(F.st)) { out.y = 1; out.x = fwd; ai.started = true; }
      else if (F.st === 'jump' && dist < 95 && F.vy > -2) F.press.k = 2;
      break;
    case 'throw':
      if (!ai.started && NEUTRAL.includes(F.st)) {
        if (dist < F.c.moves.throw.grab.range) { out.x = fwd; F.press.p = 2; ai.started = true; } else out.x = fwd;
      }
      break;
    case 'idle': break;
    default:
      if (!ai.started && NEUTRAL.includes(F.st)) { F.aiMove = ai.plan; ai.started = true; }
  }
  return out;
}

// --------------------------------- EFEITOS ---------------------------------
function spark(x, y, kind) {
  G.fx.push({ type: 'spark', x, y, t: 0, max: kind === 'big' ? 16 : 11, kind, a: rand() * Math.PI });
}
function dust(x, n) {
  for (let i = 0; i < n; i++) G.fx.push({ type: 'dust', x: x + (rand() - 0.5) * 30, y: GY - 2, vx: (rand() - 0.5) * 3, vy: -rand() * 1.5, t: 0, max: 22 + rand() * 10 });
}
function updateFx() {
  for (const e of G.fx) { e.t++; if (e.vx != null) { e.x += e.vx; e.y += e.vy; } }
  G.fx = G.fx.filter((e) => e.t < e.max);
  for (let i = 0; i < 2; i++) if (G.combo[i] && --G.combo[i].t <= 0) G.combo[i] = null;
  if (G.announce && --G.announce.t <= 0) G.announce = null;
  for (const F of G.F) {
    if (!F) continue;
    if (F.hpDelay > 0) F.hpDelay--; else F.hpShown = lerp(F.hpShown, F.hp, 0.08);
    if (F.meter >= 100 && !F.superReady) { F.superReady = true; sendTo(F.side, { t: 'vibe', ms: [30, 40, 30] }); }
  }
}

function announce(text, t = 70, sub = '') { G.announce = { text, sub, t, max: t }; }

// ------------------------------- FASES --------------------------------
function enterSelect() {
  G.phase = 'select'; G.phaseT = 0;
  G.sel[0].locked = false; G.sel[1].locked = false;
  G.F = [null, null];
  syncSides();
  pushAll(true);
}

function selNav(side, dir) {
  const s = G.sel[side];
  if (s.locked || G.phase !== 'select') return;
  const col = s.hover % 3, row = Math.floor(s.hover / 3);
  if (dir === 'left') s.hover = row * 3 + (col + 2) % 3;
  if (dir === 'right') s.hover = row * 3 + (col + 1) % 3;
  if (dir === 'up' || dir === 'down') s.hover = (s.hover + 3) % 6;
  Sfx.select();
  pushAll();
}
function selHover(side, c) {
  const s = G.sel[side];
  if (s.locked || G.phase !== 'select' || !(c >= 0 && c < CHARS.length)) return;
  s.hover = c | 0;
  Sfx.select();
  pushAll();
}
function selLock(side) {
  if (G.phase !== 'select') return;
  if (side === 1 && isCpu(1)) return;
  G.sel[side].locked = true;
  G.sel[side].t = 0;
  Sfx.lock();
  pushAll();
}
function selUnlock(side) {
  if (G.phase !== 'select' || G.phaseT > 9000) return;
  G.sel[side].locked = false;
  pushAll();
}

function updateSelect() {
  G.phaseT++;
  // CPU escolhe depois do P1
  if (isCpu(1) && G.sel[0].locked && !G.sel[1].locked) {
    G.sel[1].t++;
    if (G.sel[1].t % 6 === 0) { G.sel[1].hover = Math.floor(rand() * CHARS.length); Sfx.select(); }
    if (G.sel[1].t > 40) { G.sel[1].locked = true; Sfx.lock(); pushAll(); }
  }
  if (G.sel[0].locked && G.sel[1].locked) {
    G.sel.t2 = (G.sel.t2 || 0) + 1;
    if (G.sel.t2 > 40) { G.sel.t2 = 0; startMatch(); }
  } else G.sel.t2 = 0;
}

function startMatch() {
  G.F = [makeFighter(0, G.sel[0].hover), makeFighter(1, G.sel[1].hover)];
  G.wins = [0, 0];
  G.round = 1;
  G.stage = (G.stage + 1) % STAGES.length;
  G.sides[0].dropped = false;
  startRound();
  G.phase = 'vs'; G.phaseT = 0;
  Sfx.announce(3);
  pushAll(true);
}

function startRound() {
  for (const F of G.F) resetForRound(F);
  G.timer = ROUND_TIME; G.timerF = 0;
  G.projs = []; G.fx = []; G.combo = [null, null];
  G.camX = G.camTarget = (SW - W) / 2;
  G.hitstop = 0; G.superFlash = 0;
}

function rematch() {
  if (G.phase !== 'results') return;
  startMatch();
}
function reselect() {
  if (G.phase !== 'results') return;
  enterSelect();
}

function updateFight() {
  const fighting = G.phase === 'fight';
  const slow = G.phase === 'ko' && G.phaseT < 60 && G.phaseT % 3 !== 0;
  G.phaseT++;

  if (G.phase === 'vs') { if (G.phaseT > 150) { G.phase = 'intro'; G.phaseT = 0; announce(`ROUND ${G.round}`, 60); Sfx.announce(2); } return; }
  if (G.phase === 'intro' && G.phaseT === 62) { announce('LUTEM!', 50); Sfx.announce(3); }
  if (G.phase === 'intro' && G.phaseT > 110) { G.phase = 'fight'; G.phaseT = 0; pushAll(true); }
  if (G.phase === 'results') { stepAll(false); return; }

  if (G.superFlash > 0) { G.superFlash--; return; }
  if (G.hitstop > 0) { G.hitstop--; return; }
  if (slow) return;

  stepAll(fighting);

  if (fighting) {
    if (++G.timerF >= 60) { G.timerF = 0; G.timer = Math.max(0, G.timer - 1); }
    const ko = G.F.some((F) => F.hp <= 0);
    if (ko || G.timer <= 0) {
      G.phase = 'ko'; G.phaseT = 0;
      const perfect = G.F.some((F) => F.hp === F.c.hp);
      G.koText = ko ? 'K.O.' : 'TEMPO!';
      announce(G.koText, 90, ko && perfect ? 'PERFEITO!' : '');
      if (ko) { Sfx.ko(); for (const F of G.F) if (F.hp <= 0) sendTo(F.side, { t: 'vibe', ms: [200, 80, 300] }); }
      else Sfx.announce(3);
    }
  }

  if (G.phase === 'ko') {
    if (G.phaseT === 120) {
      const [A, B] = G.F;
      let w = -1;
      if (A.hp > B.hp) w = 0; else if (B.hp > A.hp) w = 1;
      G.roundWinner = w;
      if (w >= 0) {
        G.wins[w]++;
        const Wf = G.F[w];
        announce(`${Wf.c.name} VENCE!`, 100);
      } else announce('EMPATE', 100);
    }
    if (G.phaseT > 120) {
      for (const F of G.F) if (F.side === G.roundWinner && NEUTRAL.includes(F.st)) { F.st = 'win'; F.vx = 0; }
    }
    if (G.phaseT === 240) {
      const champ = G.wins.findIndex((n) => n >= WINS_NEEDED);
      if (champ >= 0) {
        G.winner = champ;
        G.phase = 'results'; G.phaseT = 0;
        G.F[champ].st = 'win';
        Sfx.announce(3);
        pushAll(true);
      } else {
        G.round++;
        startRound();
        G.phase = 'intro'; G.phaseT = 0;
        announce(G.wins[0] === 1 && G.wins[1] === 1 ? 'ROUND FINAL' : `ROUND ${G.round}`, 60);
        Sfx.announce(2);
        pushAll(true);
      }
    }
  }
}

function stepAll(canFight) {
  const inputs = [0, 1].map((i) => (isCpu(i) && canFight ? aiInput(G.F[i]) : readInput(i)));
  for (let i = 0; i < 2; i++) {
    const F = G.F[i];
    if (F.st === 'win') { physics(F); continue; }
    if (F.st === 'thrown') continue;
    stepFighter(F, inputs[i], canFight && !F.koed);
  }
  separate(G.F[0], G.F[1]);
  updateCamera();
  if (canFight || G.phase === 'ko') {
    meleeCheck(G.F[0]);
    meleeCheck(G.F[1]);
    updateProjs();
  }
}

// ------------------------------ CENÁRIOS ------------------------------
const STAGES = [
  { name: 'Copacabana', draw: drawCopacabana },
  { name: 'Dojo', draw: drawDojo },
];

function drawCopacabana(cam, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, 240);
  sky.addColorStop(0, '#2b1b5a'); sky.addColorStop(0.45, '#b8417a'); sky.addColorStop(0.75, '#ff8c42'); sky.addColorStop(1, '#ffd56b');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, 240);
  // sol
  const sx = 430 - cam * 0.05;
  const glow = ctx.createRadialGradient(sx, 212, 10, sx, 212, 90);
  glow.addColorStop(0, 'rgba(255,240,170,.9)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = glow; ctx.fillRect(sx - 90, 120, 180, 120);
  ctx.fillStyle = '#ffe9a3'; ctx.beginPath(); ctx.arc(sx, 214, 30, 0, Math.PI * 2); ctx.fill();
  // Pão de Açúcar
  const px = -cam * 0.15;
  ctx.fillStyle = '#3d2552';
  ctx.beginPath();
  ctx.moveTo(px + 20, 240); ctx.bezierCurveTo(px + 40, 150, px + 110, 120, px + 140, 160);
  ctx.bezierCurveTo(px + 160, 190, px + 175, 215, px + 200, 205);
  ctx.bezierCurveTo(px + 215, 150, px + 260, 95, px + 300, 110);
  ctx.bezierCurveTo(px + 340, 125, px + 350, 200, px + 380, 240); ctx.fill();
  ctx.fillStyle = '#4a2e63';
  ctx.beginPath(); ctx.moveTo(px + 520, 240); ctx.bezierCurveTo(px + 560, 190, px + 640, 180, px + 700, 240); ctx.fill();
  // bondinho
  ctx.strokeStyle = 'rgba(30,20,40,.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 140, 158); ctx.lineTo(px + 300, 112); ctx.stroke();
  const k = (t * 0.002) % 1;
  ctx.fillStyle = '#e53935'; ctx.fillRect(px + 140 + 160 * k - 3, 158 - 46 * k, 6, 5);
  // mar
  ctx.fillStyle = '#2c5d8a'; ctx.fillRect(0, 236, W, 28);
  ctx.fillStyle = 'rgba(255,220,150,.55)';
  for (let i = 0; i < 9; i++) {
    const w = 60 - i * 5 + Math.sin(t * 0.05 + i) * 6;
    ctx.fillRect(sx - w / 2, 238 + i * 3, w, 1.5);
  }
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 6; i++) ctx.fillRect(((i * 137 - cam * 0.4 + t * 0.3) % (W + 60)) - 30, 258 + (i % 2) * 3, 40, 2);
  // areia
  ctx.fillStyle = '#e9cf8e'; ctx.fillRect(0, 262, W, 22);
  // coqueiros
  for (const x0 of [40, 300, 560, 820, 1080]) {
    const x = x0 - cam * 0.6;
    if (x < -60 || x > W + 60) continue;
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, 284); ctx.quadraticCurveTo(x + 10, 230, x + 4, 186); ctx.stroke();
    ctx.fillStyle = '#2e7d32';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.sin(t * 0.03 + i) * 0.08;
      ctx.save(); ctx.translate(x + 4, 186); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(18, 0, 22, 5, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  // calçadão de Copacabana
  ctx.fillStyle = '#f2eee3'; ctx.fillRect(0, 282, W, H - 282);
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
  for (let k2 = 0; k2 < 6; k2++) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = 290 + k2 * 13 + Math.sin((x + cam) * 0.055 + k2 * 0.4) * 5;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, 282, W, 4);
}

function drawDojo(cam, t) {
  ctx.fillStyle = '#24140d'; ctx.fillRect(0, 0, W, H);
  const off = -cam * 0.75;
  // painéis shoji iluminados
  for (let i = -1; i < 9; i++) {
    const x = off + i * 130;
    if (x > W || x + 120 < 0) continue;
    ctx.fillStyle = '#f3e2b8'; ctx.fillRect(x + 10, 70, 110, 190);
    ctx.strokeStyle = '#3b2416'; ctx.lineWidth = 3;
    for (let gx = 1; gx < 4; gx++) { ctx.beginPath(); ctx.moveTo(x + 10 + gx * 27.5, 70); ctx.lineTo(x + 10 + gx * 27.5, 260); ctx.stroke(); }
    for (let gy = 1; gy < 6; gy++) { ctx.beginPath(); ctx.moveTo(x + 10, 70 + gy * 31.6); ctx.lineTo(x + 120, 70 + gy * 31.6); ctx.stroke(); }
    ctx.fillStyle = '#4a2c1a'; ctx.fillRect(x, 50, 12, 240);
  }
  ctx.fillStyle = '#4a2c1a'; ctx.fillRect(0, 50, W, 20); ctx.fillRect(0, 258, W, 28);
  // emblema
  const ex = 480 - cam * 0.75;
  ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.arc(ex, 150, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f3e2b8'; ctx.beginPath(); ctx.arc(ex, 150, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.arc(ex, 150, 14, 0, Math.PI * 2); ctx.fill();
  // lanternas
  for (const x0 of [120, 420, 720, 1020]) {
    const x = x0 - cam * 0.85, sw = Math.sin(t * 0.03 + x0) * 4;
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + sw, 34); ctx.stroke();
    const g = ctx.createRadialGradient(x + sw, 48, 4, x + sw, 48, 46);
    g.addColorStop(0, 'rgba(255,170,80,.5)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = g; ctx.fillRect(x + sw - 46, 2, 92, 92);
    ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.ellipse(x + sw, 48, 13, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(x + sw - 8, 30, 16, 4); ctx.fillRect(x + sw - 8, 63, 16, 4);
  }
  // piso de madeira
  const fl = ctx.createLinearGradient(0, 284, 0, H);
  fl.addColorStop(0, '#9c6b3c'); fl.addColorStop(1, '#6b4423');
  ctx.fillStyle = fl; ctx.fillRect(0, 284, W, H - 284);
  ctx.strokeStyle = 'rgba(40,20,10,.45)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 290 + i * 12); ctx.lineTo(W, 290 + i * 12); ctx.stroke(); }
  for (let i = 0; i < 20; i++) {
    const x = ((i * 97 - cam) % (W + 100) + W + 100) % (W + 100) - 50;
    const row = i % 6;
    ctx.beginPath(); ctx.moveTo(x, 290 + row * 12); ctx.lineTo(x, 302 + row * 12); ctx.stroke();
  }
}

// ------------------------------- DESENHO -------------------------------
function poseFor(F) {
  const P = POSES, t = G.frame;
  const O = G.F[1 - F.side];
  switch (F.st) {
    case 'idle': {
      const b = Math.sin(t * 0.09 + F.side) * 4;
      const threat = O && F.holdBack && (O.st === 'move' || G.projs.some((p) => p.owner === O));
      if (threat) return P.block;
      return { ...P.idle, fa: [P.idle.fa[0] + b, P.idle.fa[1] + b], ba: [P.idle.ba[0] + b, P.idle.ba[1]], lean: P.idle.lean + b * 0.3 };
    }
    case 'walk': {
      const ph = F.walkPh;
      return { ...P.idle, fl: [22 + Math.sin(ph) * 20, Math.sin(ph) * 8 - 6], bl: [-22 - Math.sin(ph) * 20, -8 - Math.cos(ph) * 10] };
    }
    case 'crouch': return F.holdBack && O && O.st === 'move' ? P.cblock : P.crouch;
    case 'prejump': case 'land': return P.crouch;
    case 'jump': return P.jump;
    case 'hitstun': return P.hit;
    case 'blockstun': return F.crouching ? P.cblock : P.block;
    case 'hitair': return P.hitair;
    case 'knock': case 'ko': return P.knock;
    case 'getup': return lerpPose(P.knock, P.getup, 1 - F.stun / 20);
    case 'win': return P.win;
    case 'thrown': return F.thrownKind === 'pile' ? { ...P.hit, rot: 180 } : P.hit;
    case 'grab': return F.grab && F.grab.kind === 'throw' && F.grab.t > 12 ? P.toss : P.grab;
    case 'recoverAir': return { ...P.ball, rot: t * 24 };
    case 'move': return movePose(F);
  }
  return P.idle;
}

function movePose(F) {
  const m = F.move, fr = F.mf, S = m.startup, A = m.active;
  const base = m.air ? POSES.jump : POSES[m.pose === 'cpunch' || m.pose === 'sweep' ? 'crouch' : 'idle'];
  let act = { ...POSES[m.pose] };
  if (m.armK) act.armK = m.armK;
  if (m.legK) act.legK = m.legK;
  if (m.pose === 'lightning') { const o = Math.sin(fr * 1.9) * 28; act.fl = [95 + o, 95 + o]; }
  if (m.spinRot) act.rot = fr * m.spinRot;
  if (m.flip) act.rot = -360 * m.flip * clamp((fr - S) / (A + 4), 0, 1);
  if (fr < S) {
    const t = fr / S;
    if (m.startPose) {
      const sp = POSES[m.startPose];
      return t < 0.6 ? lerpPose(base, sp, t / 0.6) : lerpPose(sp, act, (t - 0.6) / 0.4);
    }
    return lerpPose(base, act, Math.sqrt(t));
  }
  if (fr < S + A || m.untilLand) return act;
  return lerpPose(act, base, (fr - S - A) / Math.max(1, m.recovery));
}

function drawFighterEntity(F) {
  const pose = poseFor(F);
  let f = F.f;
  if (F.st === 'move' && F.move.spin && inActive(F)) f = Math.floor(F.mf / F.move.spin) % 2 ? -F.f : F.f;
  if (F.st === 'grab' && F.grab && F.grab.kind === 'pile' && F.spinT) f = Math.floor(F.spinT / 4) % 2 ? -F.f : F.f;
  let x = F.x;
  if (F.st === 'move' && F.move.shake && inActive(F)) x += (rand() - 0.5) * F.move.shake;
  if (F.st === 'hitstun' || F.st === 'blockstun') x += Math.sin(G.frame * 2) * (G.hitstop > 0 ? 2 : 0);

  // sombra
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  const sh = Math.max(0.4, 1 - (GY - F.y) / 200);
  ctx.beginPath(); ctx.ellipse(F.x, GY + 2, F.c.width * 0.75 * sh, 5 * sh, 0, 0, Math.PI * 2); ctx.fill();

  const airDraw = F.air || F.st === 'thrown' || (F.st === 'grab' && F.y < GY);
  drawFighter(ctx, F.c, {
    x, y: F.y, f, pose, air: airDraw, t: G.frame,
    alpha: F.alpha < 1 ? F.alpha : null, flash: F.flash > 0, shock: F.shock > 0,
    tint: F.st === 'ko' || (F.koed && F.st === 'knock') ? 'grayscale(.4)' : null,
  });

  // efeitos do golpe
  if (F.st === 'move' && inActive(F)) {
    const m = F.move;
    if (m.electric) drawElectric(F, m);
    if (m.flame) drawFlame(F, m);
  }
}

function drawElectric(F, m) {
  const r = hitRect(F, m.hb);
  const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2;
  const rad = (r.x2 - r.x1) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (m.big ? 9 : 6); i++) {
    ctx.strokeStyle = i % 2 ? '#7fdcff' : '#ffffff';
    ctx.lineWidth = i % 2 ? 2.5 : 1.2;
    ctx.beginPath();
    let a = rand() * Math.PI * 2;
    let px = cx, py = cy;
    ctx.moveTo(px, py);
    for (let s = 1; s <= 5; s++) {
      a += (rand() - 0.5) * 1.2;
      px = cx + Math.cos(a) * rad * s / 5; py = cy + Math.sin(a) * rad * 0.8 * s / 5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
  g.addColorStop(0, 'rgba(120,220,255,.35)'); g.addColorStop(1, 'rgba(120,220,255,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.restore();
}

function drawFlame(F, m) {
  const r = hitRect(F, m.hb);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = m.big ? 26 : 12;
  for (let i = 0; i < n; i++) {
    const k = (i / n + G.frame * 0.03) % 1;
    const x = F.f > 0 ? lerp(r.x1, r.x2, k) : lerp(r.x2, r.x1, k);
    const y = lerp(r.y1, r.y2, 0.5) + Math.sin(G.frame * 0.4 + i) * (r.y2 - r.y1) * 0.3;
    const rr = (8 + k * 14) * (m.big ? 1.2 : 1);
    const g = ctx.createRadialGradient(x, y, 1, x, y, rr);
    g.addColorStop(0, 'rgba(255,240,150,.9)'); g.addColorStop(0.5, 'rgba(255,120,20,.6)'); g.addColorStop(1, 'rgba(200,30,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawProj(p) {
  const t = p.t;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalCompositeOperation = 'lighter';
  const dir = Math.sign(p.vx);
  if (p.kind === 'sonic') {
    ctx.rotate(t * 0.0);
    ctx.strokeStyle = 'rgba(255,240,120,.95)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 0.5, p.r * 1.2, 0, -Math.PI / 2, Math.PI / 2, dir < 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(-dir * 4, 0, p.r * 0.45, p.r * 1.05, 0, -Math.PI / 2, Math.PI / 2, dir < 0); ctx.stroke();
  } else {
    const colors = {
      ki: ['#ffffff', '#5fb4ff', 'rgba(40,90,255,0)'],
      superki: ['#ffffff', '#4dc3ff', 'rgba(255,60,200,0)'],
      kiko: ['#ffffff', '#ff7ad9', 'rgba(120,80,255,0)'],
      fire: ['#fff3b0', '#ff8f1a', 'rgba(200,20,0,0)'],
    }[p.kind] || ['#fff', '#fff', 'rgba(255,255,255,0)'];
    for (let i = 3; i >= 1; i--) { // rastro
      const g = ctx.createRadialGradient(-dir * i * 9, 0, 1, -dir * i * 9, 0, p.r * (1 - i * 0.2));
      g.addColorStop(0, colors[1]); g.addColorStop(1, colors[2]);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-dir * i * 9, 0, p.r * (1 - i * 0.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const pulse = 1 + Math.sin(t * 0.6) * 0.08;
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, p.r * 1.5 * pulse);
    g.addColorStop(0, colors[0]); g.addColorStop(0.35, colors[1]); g.addColorStop(1, colors[2]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, p.r * 1.5 * pulse, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawFx() {
  for (const e of G.fx) {
    const k = e.t / e.max;
    if (e.type === 'spark') {
      ctx.save(); ctx.translate(e.x, e.y);
      const big = e.kind === 'big', blk = e.kind === 'block';
      const n = big ? 10 : 7, len = (big ? 34 : 22) * (0.4 + k);
      ctx.strokeStyle = blk ? `rgba(140,220,255,${1 - k})` : `rgba(255,${big ? 210 : 255},${big ? 60 : 160},${1 - k})`;
      ctx.lineWidth = big ? 4 : 3; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a = e.a + (i / n) * Math.PI * 2;
        const r0 = len * 0.3;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
      }
      if (k < 0.3) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, (big ? 12 : 8) * (1 - k), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    } else if (e.type === 'dust') {
      ctx.fillStyle = `rgba(220,210,190,${0.6 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, 3 + k * 7, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'puff') {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, 2 + k * 8, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---------------------------------- HUD ----------------------------------
function text(str, x, y, size, color = '#fff', align = 'left', outline = 3) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  if (outline > 0) { ctx.strokeStyle = '#000'; ctx.lineWidth = outline; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function sideLabel(i) { return isCpu(i) ? 'CPU' : `P${i + 1}`; }

function drawHUD() {
  const [A, B] = G.F;
  for (let i = 0; i < 2; i++) {
    const F = G.F[i];
    const x = i === 0 ? 16 : 360, w = 264, y = 14, h = 14;
    ctx.fillStyle = '#000'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#5a0d0d'; ctx.fillRect(x, y, w, h);
    const pct = F.hp / F.c.hp, shown = F.hpShown / F.c.hp;
    const draw = (p, col) => {
      ctx.fillStyle = col;
      if (i === 0) ctx.fillRect(x + w * (1 - p), y, w * p, h);
      else ctx.fillRect(x, y, w * p, h);
    };
    draw(shown, '#ff9b3d');
    draw(pct, pct < 0.25 ? (G.frame % 20 < 10 ? '#ff3b3b' : '#ffd400') : '#ffd400');
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    if (i === 0) ctx.fillRect(x + w * (1 - pct), y, w * pct, 3); else ctx.fillRect(x, y, w * pct, 3);
    text(F.c.name, i === 0 ? x : x + w, y + h + 16, 10, '#fff', i === 0 ? 'left' : 'right');
    text(sideLabel(i), i === 0 ? x + 2 + ctx.measureText(F.c.name).width + 12 : x + w - ctx.measureText(F.c.name).width - 14, y + h + 16, 7, isCpu(i) ? '#aaa' : (i === 0 ? '#ff5a5a' : '#5ab0ff'), i === 0 ? 'left' : 'right');
    // vitórias
    for (let k = 0; k < G.wins[i]; k++) {
      const vx = i === 0 ? x + w - 10 - k * 14 : x + 10 + k * 14;
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(vx, y + h + 12, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(vx, y + h + 12, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    // super
    const mx = i === 0 ? 16 : 474, my = 340, mw = 150;
    ctx.fillStyle = '#000'; ctx.fillRect(mx - 2, my - 2, mw + 4, 10);
    ctx.fillStyle = '#1b2a4a'; ctx.fillRect(mx, my, mw, 6);
    const full = F.meter >= 100;
    ctx.fillStyle = full ? (G.frame % 16 < 8 ? '#4dd2ff' : '#ffffff') : '#2f7bff';
    const mwid = mw * F.meter / 100;
    if (i === 0) ctx.fillRect(mx, my, mwid, 6); else ctx.fillRect(mx + mw - mwid, my, mwid, 6);
    text(full ? 'SUPER!' : 'SUPER', i === 0 ? mx : mx + mw, my - 5, 7, full ? '#4dd2ff' : '#9ab', i === 0 ? 'left' : 'right', 2);
  }
  // tempo
  ctx.fillStyle = '#000'; ctx.fillRect(W / 2 - 22, 8, 44, 30);
  ctx.fillStyle = '#20203a'; ctx.fillRect(W / 2 - 20, 10, 40, 26);
  text(String(G.timer).padStart(2, '0'), W / 2, 31, 16, G.timer <= 10 ? '#ff5a5a' : '#fff', 'center');

  // combo
  for (let i = 0; i < 2; i++) {
    const c = G.combo[i];
    if (!c) continue;
    const x = i === 0 ? 24 : W - 24;
    text(`${c.n} HITS!`, x, 120, 14, '#ffd400', i === 0 ? 'left' : 'right', 4);
  }

  // anúncio
  if (G.announce) {
    const a = G.announce, k = 1 - a.t / a.max;
    const size = a.text.length > 8 ? 26 : 40;
    const sc = k < 0.15 ? 1.6 - k * 4 : 1;
    ctx.save(); ctx.translate(W / 2, 170); ctx.scale(sc, sc);
    text(a.text, 0, 0, size, '#ffd400', 'center', 7);
    if (a.sub) text(a.sub, 0, 34, 14, '#ff5a5a', 'center', 4);
    ctx.restore();
  }
  void A; void B;
}

function drawSuperFlash() {
  if (G.superFlash <= 0 || !G.superBy) return;
  const F = G.superBy;
  ctx.fillStyle = 'rgba(0,0,30,.55)'; ctx.fillRect(0, 0, W, H);
  const x = F.x - G.camX, y = F.y - F.c.height * 0.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(G.frame * 0.05);
  ctx.fillStyle = 'rgba(255,220,80,.35)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(220, -14); ctx.lineTo(220, 14); ctx.fill();
  }
  ctx.restore();
  text(F.c.moves.super.name.toUpperCase(), F.side === 0 ? 24 : W - 24, 90, 13, '#4dd2ff', F.side === 0 ? 'left' : 'right', 4);
}

// ------------------------- TELAS: SELEÇÃO / VS / FIM -------------------------
const TILE = 88, GAP = 8;
const gridX = W / 2 - (TILE * 3 + GAP * 2) / 2, gridY = 96;

function drawSelectScreen() {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a0f3a'); bg.addColorStop(1, '#3a0f2a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  for (let i = -10; i < 30; i++) { ctx.save(); ctx.translate(i * 40 + (G.frame * 0.5) % 40, 0); ctx.rotate(0.35); ctx.fillRect(0, -50, 14, 500); ctx.restore(); }

  text('ESCOLHA SEU LUTADOR', W / 2, 40, 16, '#ffd400', 'center', 5);
  text(G.sides[1].pid || G.sides[1].kb ? 'P1  x  P2' : 'P1  x  CPU', W / 2, 62, 8, '#c9c3ff', 'center', 3);

  CHARS.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gridX + col * (TILE + GAP), y = gridY + row * (TILE + GAP);
    const g = ctx.createLinearGradient(x, y, x, y + TILE);
    g.addColorStop(0, c.color); g.addColorStop(1, '#000');
    ctx.fillStyle = '#000'; ctx.fillRect(x - 3, y - 3, TILE + 6, TILE + 6);
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip();
    ctx.translate(x + TILE / 2, y + TILE + 22);
    ctx.scale(0.95, 0.95);
    drawFighter(ctx, c, { x: 0, y: 0, f: 1, pose: { ...POSES.idle, fa: [35 + Math.sin(G.frame * 0.08 + i) * 4, 125], lean: 6 }, t: G.frame });
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x, y + TILE - 16, TILE, 16);
    text(c.name, x + TILE / 2, y + TILE - 4, 7, '#fff', 'center', 2);
  });

  // cursores
  for (let s = 0; s < 2; s++) {
    const sel = G.sel[s];
    const col = sel.hover % 3, row = Math.floor(sel.hover / 3);
    const x = gridX + col * (TILE + GAP), y = gridY + row * (TILE + GAP);
    const same = G.sel[0].hover === G.sel[1].hover;
    const inset = same && s === 1 ? 4 : 0;
    const color = s === 0 ? '#ff3b3b' : (isCpu(1) ? '#bbbbbb' : '#3b9bff');
    ctx.strokeStyle = color; ctx.lineWidth = 4;
    if (!sel.locked && G.frame % 30 < 8) ctx.globalAlpha = 0.5;
    ctx.strokeRect(x - 2 + inset, y - 2 + inset, TILE + 4 - inset * 2, TILE + 4 - inset * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.fillRect(s === 0 ? x - 2 : x + TILE - 26, y - 14, 28, 12);
    text(sideLabel(s), s === 0 ? x + 12 : x + TILE - 12, y - 4, 7, '#000', 'center', 0);
  }

  // prévias
  for (let s = 0; s < 2; s++) {
    const c = CHARS[G.sel[s].hover];
    const px = s === 0 ? 72 : W - 72;
    ctx.save();
    ctx.translate(px, 250);
    ctx.scale(1.35, 1.35);
    drawFighter(ctx, c, { x: 0, y: 0, f: s === 0 ? 1 : -1, pose: G.sel[s].locked ? POSES.win : POSES.idle, t: G.frame });
    ctx.restore();
    text(c.name, px, 272, 10, c.color === '#556b2f' ? '#9ccc65' : c.color, 'center', 4);
    ctx.font = `6px ${FONT}`;
    text(c.title.toUpperCase(), px, 286, 6, '#ddd', 'center', 2);
    const M = c.moves;
    const lines = [`ESP: ${M.sp1.name}`, `↑ESP: ${M.sp2.name}`, `↓ESP: ${M.sp3.name}`, `SUPER: ${M.super.name}`];
    // do lado da CPU, o painel "P2: escaneie" ocupa esse espaço
    if (!(s === 1 && isCpu(1))) lines.forEach((l, k) => text(l.toUpperCase(), s === 0 ? 8 : W - 8, 304 + k * 12, 6, '#bfe7ff', s === 0 ? 'left' : 'right', 2));
    if (G.sel[s].locked) text('PRONTO!', px, 92, 10, '#3ddc84', 'center', 4);
  }
  if (!G.sel[0].locked) text('ESCOLHA NO CELULAR', W / 2, gridY + TILE * 2 + GAP + 26, 8, G.frame % 60 < 40 ? '#ffffff' : '#888', 'center', 3);
  else if (!G.sel[1].locked && !isCpu(1)) text('AGUARDANDO P2...', W / 2, gridY + TILE * 2 + GAP + 26, 8, '#fff', 'center', 3);
}

function drawVs() {
  const k = Math.min(1, G.phaseT / 20);
  const [A, B] = G.F;
  ctx.fillStyle = A.c.color;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.58 * k, 0); ctx.lineTo(W * 0.42 * k, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = B.c.color;
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - W * 0.42 * k, 0); ctx.lineTo(W - W * 0.58 * k, H); ctx.lineTo(W, H); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
  for (let s = 0; s < 2; s++) {
    const F = G.F[s];
    ctx.save();
    ctx.translate(s === 0 ? 150 - (1 - k) * 200 : W - 150 + (1 - k) * 200, 300);
    ctx.scale(2.1, 2.1);
    drawFighter(ctx, F.c, { x: 0, y: 0, f: s === 0 ? 1 : -1, pose: POSES.idle, t: G.frame });
    ctx.restore();
    text(F.c.name, s === 0 ? 30 : W - 30, 340, 16, '#fff', s === 0 ? 'left' : 'right', 5);
  }
  const sc = G.phaseT < 30 ? 3 - G.phaseT / 15 : 1;
  ctx.save(); ctx.translate(W / 2, 190); ctx.scale(sc, sc);
  text('VS', 0, 0, 48, '#ffd400', 'center', 8);
  ctx.restore();
  text(STAGES[G.stage].name.toUpperCase(), W / 2, 240, 8, '#fff', 'center', 3);
}

function drawResults() {
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
  const F = G.F[G.winner];
  text(`${F.c.name} VENCEU!`, W / 2, 80, 22, '#ffd400', 'center', 6);
  text(`${sideLabel(G.winner)} · ${G.wins[0]} x ${G.wins[1]}`, W / 2, 106, 10, '#fff', 'center', 3);
  const lines = ['CELULAR: REVANCHE · TROCAR LUTADOR · MENU', 'TECLADO: J/ENTER REVANCHE · K TROCAR · ESC MENU'];
  lines.forEach((l, i) => text(l, W / 2, 330 + i * 14, 7, i ? '#aaa' : '#fff', 'center', 2));
}

// ------------------------------- RENDER --------------------------------
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = true;

  if (G.phase === 'select') { drawSelectScreen(); return; }
  if (G.phase === 'vs') { drawVs(); return; }

  const sx = G.shake > 0 ? (rand() - 0.5) * G.shake : 0, sy = G.shake > 0 ? (rand() - 0.5) * G.shake : 0;
  if (G.shake > 0) G.shake = Math.max(0, G.shake - 0.6);
  ctx.save();
  ctx.translate(sx, sy);
  STAGES[G.stage].draw(G.camX, G.frame);
  drawSuperFlash();
  ctx.translate(-G.camX, 0);
  // quem está atacando fica na frente
  const order = [...G.F].sort((a, b) => (a.st === 'move' || a.st === 'grab' ? 1 : 0) - (b.st === 'move' || b.st === 'grab' ? 1 : 0));
  for (const F of order) drawFighterEntity(F);
  for (const p of G.projs) drawProj(p);
  drawFx();
  ctx.restore();
  drawHUD();
  if (G.phase === 'results') drawResults();
}

// ------------------------------ REDE ----------------------------------
let arcade = null;
let players = [];

function syncSides() {
  const pids = players.map((p) => p.pid);
  for (let i = 0; i < 2; i++) {
    const s = G.sides[i];
    if (s.pid && !pids.includes(s.pid)) {
      s.pid = null;
      if (G.F[i] && ['vs', 'intro', 'fight', 'ko'].includes(G.phase)) {
        if (i === 0) { s.dropped = true; toast('P1 desconectou — a CPU assumiu'); }
        else toast('P2 desconectou — a CPU assumiu');
      }
    }
  }
  const canSeat1 = G.phase === 'select' || G.phase === 'results';
  for (const p of players) {
    if (G.sides.some((s) => s.pid === p.pid)) continue;
    if (!G.sides[0].pid) { G.sides[0].pid = p.pid; G.sides[0].dropped = false; continue; }
    if (!G.sides[1].pid && canSeat1) {
      G.sides[1].pid = p.pid; G.sides[1].kb = false;
      if (G.phase === 'select') { G.sel[1].locked = false; G.sel[1].t = 0; }
    }
  }
  updateJoinPanel();
  pushAll(true);
}

function sideOf(pid) { return G.sides.findIndex((s) => s.pid === pid); }

function sendTo(side, obj) {
  const pid = G.sides[side] && G.sides[side].pid;
  if (pid && arcade) arcade.send(obj, pid);
}

const ROSTER = CHARS.map((c) => ({
  name: c.name, title: c.title, color: c.color,
  moves: [c.moves.sp1.name, c.moves.sp2.name, c.moves.sp3.name, c.moves.super.name],
}));
const lastSent = new Map();
function pushAll(force) {
  if (!arcade) return;
  for (const p of players) {
    const side = sideOf(p.pid);
    const F = side >= 0 ? G.F[side] : null;
    const phase = side < 0 ? 'spectator'
      : G.phase === 'select' ? 'select'
      : G.phase === 'results' ? 'results'
      : 'fight';
    const st = {
      t: 'state', phase, side,
      mode: isCpu(1) ? 'cpu' : 'pvp',
      hover: side >= 0 ? G.sel[side].hover : 0,
      locked: side >= 0 ? G.sel[side].locked : false,
      char: F ? { name: F.c.name, color: F.c.color, moves: ROSTER[CHARS.indexOf(F.c)].moves } : null,
      hp: F ? Math.round((F.hp / F.c.hp) * 100) : 100,
      meter: F ? Math.floor(F.meter) : 0,
      won: G.phase === 'results' ? G.winner === side : null,
      roster: phase === 'select' ? ROSTER : undefined,
    };
    const str = JSON.stringify(st);
    if (force || lastSent.get(p.pid) !== str) { lastSent.set(p.pid, str); arcade.send(st, p.pid); }
  }
}

function onPhone(m) {
  const side = sideOf(m.pid);
  if (side < 0) return;
  switch (m.t) {
    case 'dir':
      phoneIn[side].x = clamp(m.x | 0, -1, 1);
      phoneIn[side].y = clamp(m.y | 0, -1, 1);
      phoneIn[side].last = performance.now();
      break;
    case 'btn':
      if (['p', 'k', 's', 'su'].includes(m.b)) pressBtn(side, m.b);
      break;
    case 'hover': selHover(side, m.c); break;
    case 'nav': selNav(side, m.dir); break;
    case 'lock': selLock(side); break;
    case 'unlock': selUnlock(side); break;
    case 'rematch': rematch(); break;
    case 'reselect': reselect(); break;
  }
}

function updateJoinPanel() {
  const show = G.phase === 'select' && !G.sides[1].pid && !G.sides[1].kb;
  $('join').classList.toggle('hidden', !show);
}

let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

arcade = ArcadeScreen({
  game: 'pancadaria',
  onRoom(info, list) {
    $('joinQr').src = info.qr;
    $('joinCode').textContent = info.code;
    players = list;
    syncSides();
  },
  onJoin(p, list) {
    players = list;
    toast(`📱 Jogador ${p.index + 1} conectado!`);
    syncSides();
  },
  onLeave(p, list) {
    players = list;
    syncSides();
  },
  onMessage: onPhone,
  onReady(p) { lastSent.delete(p.pid); pushAll(); },
});

// Depuração: ?debug expõe o estado
if (new URLSearchParams(location.search).has('debug')) window.__luta = { G, CHARS, startMatch, step: () => tick(), selLock, isCpu };

// ------------------------------- LOOP ---------------------------------
function tick() {
  G.frame++;
  if (G.phase === 'select') updateSelect();
  else updateFight();
  updateFx();
}

let acc = 0, last = performance.now(), pushT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= 1 / 60 && n < 5) { tick(); acc -= 1 / 60; n++; }
  if (n === 5) acc = 0;
  render();
  if ((pushT += dt) > 0.1) { pushT = 0; pushAll(false); updateJoinPanel(); }
  requestAnimationFrame(frame);
}

enterSelect();
requestAnimationFrame(frame);
})();
