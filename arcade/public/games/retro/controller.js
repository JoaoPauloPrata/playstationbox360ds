'use strict';
// Controle do emulador: direcional + botões do console da ROM aberta na TV.
// Manda { t: 'btn', id, v } com os índices do RetroPad (ver /shared/retro-systems.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const { SYSTEMS } = RetroSystems;
  const COLORS = ArcadeController.PLAYER_COLORS;

  let sysId = null;
  let sys = null;
  let menuOpen = false;
  let me = null;

  const pad = ArcadeController({
    game: 'retro',
    orientation: 'landscape',
    onStatus(text, kind) { $('status').textContent = text; $('dot').className = 'dot ' + kind; },
    onJoined(info) {
      me = info;
      pad.vibrate(50);
      $('badge').hidden = false;
      $('badge').textContent = `P${info.index + 1}`;
      $('badge').style.background = COLORS[info.index % COLORS.length];
    },
    onMessage(m) {
      if (m.t === 'retro') onState(m);
      else if (m.t === 'retro-toast') toast(m.text);
    },
  });

  // ------------------------------ ESTADO -------------------------------
  function onState(m) {
    if (m.sys && m.sys !== sysId) build(m.sys);
    $('gname').textContent = m.name || '';
    $('loadTitle').textContent = m.name ? m.name.toUpperCase() : 'CARREGANDO...';
    $('pauseBtn').textContent = m.paused ? '▶ CONTINUAR' : '⏸ PAUSAR';
    $('qrBtn').textContent = m.qr ? '📱 ESCONDER QR' : '📱 QR NA TV';
    bench(m);
    $('loadScreen').classList.toggle('hidden', m.phase !== 'loading');
    $('errScreen').classList.toggle('hidden', m.phase !== 'error');
    if (m.phase === 'error') $('errText').textContent = m.msg || 'Não deu para abrir a ROM.';
    if (m.phase !== 'playing') releaseAll();
  }

  // Passou do limite de jogadores do console: fica na reserva até abrir uma vaga
  let benched = false;
  function bench(m) {
    benched = !!(me && m.max && me.index >= m.max && m.phase === 'playing');
    $('benchScreen').classList.toggle('hidden', !benched || menuOpen);
    if (!benched) return;
    releaseAll();
    const used = new Set(m.used || []);
    let free = false;
    for (let i = 0; i < m.max; i++) if (!used.has(i)) free = true;
    $('benchText').textContent = free
      ? 'Abriu uma vaga! Toque para entrar no jogo.'
      : `${sys ? sys.name : 'Este console'} aceita até ${m.max} jogador${m.max > 1 ? 'es' : ''}. Você entra quando alguém sair.`;
    $('takeSlot').hidden = !free;
  }
  // Entrar de novo na sala com outra identidade pega a menor vaga livre
  $('takeSlot').addEventListener('click', () => {
    try { localStorage.removeItem(`arcade.pid.${pad.room}`); } catch { /* ok */ }
    location.reload();
  });
  $('benchMenu').addEventListener('click', () => showMenu(true));

  // ------------------------------ LAYOUT -------------------------------
  function makeBtn(b) {
    const el = document.createElement('button');
    el.className = 'btn';
    el.dataset.id = b.id;
    el.textContent = b.l;
    if (b.c) el.style.setProperty('--c', b.c);
    return el;
  }

  function build(id) {
    releaseAll();
    sysId = id;
    sys = SYSTEMS[id] || SYSTEMS.snes;
    const p = sys.pad;
    document.documentElement.style.setProperty('--sys', sys.color);
    $('sysname').textContent = sys.name.toUpperCase();
    $('dpad').classList.toggle('stick', !!sys.stick);

    const face = $('face');
    face.innerHTML = '';
    for (const g of p.face || []) {
      const box = document.createElement('div');
      box.className = (g.diamond ? 'diamond' : 'row') + (g.small ? ' small' : '');
      for (const b of g.diamond || g.row) box.appendChild(makeBtn(b));
      face.appendChild(box);
    }

    const sh = p.sh || [];
    const half = Math.ceil(sh.length / 2);
    $('shL').replaceChildren(...sh.slice(0, half).map(makeBtn));
    $('shR').replaceChildren(...sh.slice(half).map(makeBtn));

    const mid = $('mid');
    mid.querySelectorAll('.btn').forEach((b) => b.remove());
    for (const b of p.mid || []) mid.appendChild(makeBtn(b));
  }

  // ------------------------------ BOTÕES --------------------------------
  const down = new Map();   // id -> valor enviado
  const touches = new Map(); // pointerId -> botão sob o dedo

  function set(id, v) {
    if ((down.get(id) || 0) === v) return;
    if (v) down.set(id, v); else down.delete(id);
    pad.send({ t: 'btn', id, v });
  }

  function hold(el, on) {
    if (!el) return;
    el.classList.toggle('down', on);
    set(+el.dataset.id, on ? 1 : 0);
    if (on) pad.vibrate(12);
  }

  const btnAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.btn[data-id]') : null;
  };

  // Os dedos podem escorregar de um botão para outro (bom para jogos de luta)
  addEventListener('pointerdown', (e) => {
    if (menuOpen || e.target.closest('#dpad, header, .screen')) return;
    const el = btnAt(e.clientX, e.clientY);
    touches.set(e.pointerId, el);
    hold(el, true);
  });
  addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    const el = btnAt(e.clientX, e.clientY);
    const old = touches.get(e.pointerId);
    if (el === old) return;
    if (old && ![...touches.entries()].some(([k, v]) => k !== e.pointerId && v === old)) hold(old, false);
    touches.set(e.pointerId, el);
    hold(el, true);
  });
  const lift = (e) => {
    if (!touches.has(e.pointerId)) return;
    const old = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (old && ![...touches.values()].includes(old)) hold(old, false);
  };
  addEventListener('pointerup', lift);
  addEventListener('pointercancel', lift);

  // ------------------------------ DIRECIONAL ----------------------------
  // 8 direções. No N64 vira analógico (o valor é a força, de 0 a 1).
  const DIRS = { up: [4, 19], down: [5, 18], left: [6, 17], right: [7, 16] };
  let dpadPtr = null;

  function dpadAt(e) {
    const r = $('cross').getBoundingClientRect();
    const rad = r.width / 2;
    let dx = (e.clientX - (r.left + rad)) / rad;
    let dy = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const stick = !!(sys && sys.stick);
    const k = stick ? 1 : 0;
    const vals = { up: 0, down: 0, left: 0, right: 0 };
    if (len > 0.22) {
      if (stick) {
        const q = (v) => Math.round(Math.min(1, v * 1.25) * 8) / 8; // borda = força máxima
        vals.right = q(Math.max(0, dx)); vals.left = q(Math.max(0, -dx));
        vals.down = q(Math.max(0, dy)); vals.up = q(Math.max(0, -dy));
      } else {
        const nx = dx / Math.hypot(dx, dy), ny = dy / Math.hypot(dx, dy);
        vals.right = +(nx > 0.38); vals.left = +(nx < -0.38);
        vals.down = +(ny > 0.38); vals.up = +(ny < -0.38);
      }
    }
    for (const d of Object.keys(DIRS)) {
      const id = DIRS[d][k];
      if (!!vals[d] !== !!down.get(id)) pad.vibrate(8);
      set(id, vals[d]);
      document.querySelector(`.cross .${{ up: 'u', down: 'd', left: 'lf', right: 'rt' }[d]}`).classList.toggle('on', !!vals[d]);
    }
    $('knob').style.transform = len > 0.22 ? `translate(${dx * 110}%, ${dy * 110}%)` : '';
  }
  function dpadRelease() {
    dpadPtr = null;
    for (const d of Object.keys(DIRS)) for (const id of DIRS[d]) set(id, 0);
    document.querySelectorAll('.cross b').forEach((b) => b.classList.remove('on'));
    $('knob').style.transform = '';
  }

  const dp = $('dpad');
  dp.addEventListener('pointerdown', (e) => {
    if (menuOpen || dpadPtr !== null) return;
    dpadPtr = e.pointerId;
    try { dp.setPointerCapture(e.pointerId); } catch { /* ok */ }
    dpadAt(e);
  });
  dp.addEventListener('pointermove', (e) => { if (e.pointerId === dpadPtr) dpadAt(e); });
  const dpEnd = (e) => { if (e.pointerId === dpadPtr) dpadRelease(); };
  dp.addEventListener('pointerup', dpEnd);
  dp.addEventListener('pointercancel', dpEnd);
  dp.addEventListener('lostpointercapture', dpEnd);

  function releaseAll() {
    for (const id of [...down.keys()]) set(id, 0);
    touches.clear();
    dpadPtr = null;
    document.querySelectorAll('.btn.down').forEach((b) => b.classList.remove('down'));
    document.querySelectorAll('.cross b').forEach((b) => b.classList.remove('on'));
    $('knob').style.transform = '';
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  addEventListener('blur', releaseAll);

  // ------------------------------ MENU ---------------------------------
  function showMenu(on) {
    menuOpen = on;
    if (on) releaseAll();
    $('menuScreen').classList.toggle('hidden', !on);
    $('benchScreen').classList.toggle('hidden', !benched || on);
  }
  $('menu').addEventListener('click', () => showMenu(!menuOpen));
  $('closeMenu').addEventListener('click', () => showMenu(false));
  document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
    pad.send({ t: 'cmd', c: b.dataset.cmd });
    pad.vibrate(30);
    showMenu(false);
  }));

  let toastT = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }

  build('snes'); // layout provisório até a TV dizer qual é o console
})();
