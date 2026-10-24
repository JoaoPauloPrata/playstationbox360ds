'use strict';
// Controle do Kart Party: joystick + botões, enviados pelo SDK do Fliperama
(() => {
  const $ = (id) => document.getElementById(id);

  const input = { s: 0, g: false, b: false, d: false };
  let autoGas = localStorage.getItem('kart.autoGas') !== '0';
  let lastState = null;

  // ------------------------------ REDE ------------------------------
  const pad = ArcadeController({
    game: 'kart',
    orientation: 'landscape',
    onStatus(text, kind) {
      $('conn').textContent = text;
      $('dot').className = 'dot ' + ({ ok: 'on', wait: '', error: 'off' }[kind] ?? '');
    },
    onJoined() {
      pad.vibrate(60);
      if (lastState) onState(lastState);
    },
    onError(text) { showMsg('OPS!', text); },
    onMessage(m) {
      if (m.t === 'state') onState(m);
    },
  });

  const send = (obj) => pad.send(obj);

  const ICON = { mushroom: '🍄', banana: '🍌', green: '🟢', red: '🔴', star: '⭐', roulette: '🎲' };
  function onState(m) {
    lastState = m;
    const me = pad.me;
    const spectator = me && m.driver && m.driver !== me.pid;
    $('pos').textContent = m.phase === 'lobby' ? '-' : `${m.pos}º`;
    $('lap').textContent = m.phase === 'lobby' ? '' : `${m.lap}/${m.laps}`;
    $('item').textContent = m.item ? ICON[m.item] || '' : '';

    if (spectator) {
      showMsg('ESPECTADOR', 'Kart Party é para 1 jogador: quem dirige é o P1. Toque em MENU para voltar à galeria.');
      return;
    }
    hideMsg();

    const start = $('startScreen');
    if (m.phase === 'lobby') {
      $('startTitle').textContent = 'KART PARTY';
      $('startText').textContent = 'Tudo pronto. Quando quiser, comece a corrida.';
      $('startBtn').textContent = '▶ INICIAR CORRIDA';
      start.classList.remove('hidden');
    } else if (m.phase === 'results') {
      $('startTitle').textContent = `CHEGADA: ${m.pos}º LUGAR!`;
      $('startText').textContent = 'Bora mais uma?';
      $('startBtn').textContent = '↻ CORRER DE NOVO';
      start.classList.remove('hidden');
    } else {
      start.classList.add('hidden');
    }
  }

  function showMsg(title, text) {
    $('msgTitle').textContent = title;
    $('msgText').textContent = text;
    $('msgScreen').classList.remove('hidden');
    $('startScreen').classList.add('hidden');
  }
  function hideMsg() { $('msgScreen').classList.add('hidden'); }

  $('startBtn').addEventListener('click', () => {
    send({ t: 'start' });
    pad.vibrate(40);
    pad.fullscreen();
  });

  for (const id of ['menu', 'menu2', 'menu3']) {
    const b = $(id);
    if (b) b.addEventListener('click', () => { pad.vibrate(30); pad.exit(); });
  }

  // --------------------------- JOYSTICK -----------------------------
  // Joystick "flutuante": aparece onde o dedo toca no lado esquerdo
  const zone = $('stickZone'), base = $('base'), knob = $('knob');
  const RADIUS = 60, DEAD = 0.1;
  let stickId = null, ox = 0, oy = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* ok */ }
    const r = zone.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.style.display = 'block';
    knob.style.transform = 'translate(0,0)';
    pad.vibrate(8);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let s = dx / RADIUS;
    s = Math.abs(s) < DEAD ? 0 : Math.sign(s) * ((Math.abs(s) - DEAD) / (1 - DEAD));
    input.s = Math.round(s * 100) / 100;
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    input.s = 0;
    base.style.display = 'none';
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  // ---------------------------- BOTÕES ------------------------------
  for (const btn of document.querySelectorAll('.btn')) {
    const key = btn.dataset.key;
    const ids = new Set();
    const press = (e) => {
      e.preventDefault();
      ids.add(e.pointerId);
      try { btn.setPointerCapture(e.pointerId); } catch { /* ok */ }
      btn.classList.add('down');
      pad.vibrate(12);
      if (key === 'item') send({ t: 'item' });
      else if (key === 'gas') input.g = true;
      else if (key === 'brake') input.b = true;
      else if (key === 'drift') input.d = true;
      flush();
    };
    const release = (e) => {
      if (!ids.delete(e.pointerId) || ids.size) return;
      btn.classList.remove('down');
      if (key === 'gas') input.g = false;
      else if (key === 'brake') input.b = false;
      else if (key === 'drift') input.d = false;
      flush();
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------------------------- AUTO-ACELERAR --------------------------
  function renderAuto() {
    $('autoGas').classList.toggle('on', autoGas);
    $('autoGas').textContent = autoGas ? 'AUTO: ON' : 'AUTO: OFF';
    $('bGas').classList.toggle('auto', autoGas);
  }
  $('autoGas').addEventListener('click', () => {
    autoGas = !autoGas;
    try { localStorage.setItem('kart.autoGas', autoGas ? '1' : '0'); } catch { /* ignora */ }
    renderAuto();
    flush();
  });
  renderAuto();

  $('fs').addEventListener('click', () => pad.fullscreen());

  // ------------------------ ENVIO DOS COMANDOS -----------------------
  // Envia sempre que algo muda + um "batimento" a cada 100 ms
  let lastSent = '', lastTime = 0;
  function flush() {
    const msg = {
      t: 'in',
      s: input.s,
      g: (autoGas ? !input.b : input.g) ? 1 : 0,
      b: input.b ? 1 : 0,
      d: input.d ? 1 : 0,
    };
    const str = JSON.stringify(msg);
    const now = performance.now();
    if (str !== lastSent || now - lastTime > 100) {
      lastSent = str; lastTime = now;
      send(msg);
    }
  }
  setInterval(flush, 33);
})();
