'use strict';
// Controle do Pancadaria: joystick de 8 direções + SOCO/CHUTE/ESPECIAL/SUPER
(() => {
  const $ = (id) => document.getElementById(id);
  const SIDE_COLORS = ['#ff3b3b', '#3b9bff'];

  let st = null;
  let rosterBuilt = false;

  const pad = ArcadeController({
    game: 'pancadaria',
    orientation: 'landscape',
    onStatus(text, kind) { $('status').textContent = text; $('dot').className = 'dot ' + kind; },
    onJoined() { pad.vibrate(50); },
    onError(text) { showScreen('msgScreen'); $('msgTitle').textContent = 'OPS!'; $('msgText').textContent = text; },
    onMessage(m) { if (m.t === 'state') onState(m); },
  });

  // ------------------------------ ESTADO ------------------------------
  function showScreen(id) {
    for (const s of ['selScreen', 'resScreen', 'msgScreen']) $(s).classList.toggle('hidden', s !== id);
  }

  function onState(m) {
    st = m;
    const badge = $('badge');
    if (m.side >= 0) {
      badge.hidden = false;
      badge.textContent = `P${m.side + 1}`;
      badge.style.background = SIDE_COLORS[m.side];
    } else badge.hidden = true;
    $('cname').textContent = m.char ? m.char.name : '';
    $('bars').hidden = !m.char || m.phase !== 'fight';
    $('hp').style.width = `${m.hp}%`;
    $('meter').style.width = `${m.meter}%`;
    $('mbar').classList.toggle('full', m.meter >= 100);
    $('bSu').classList.toggle('ready', m.meter >= 100);

    if (m.phase === 'spectator') {
      showScreen('msgScreen');
      $('msgTitle').textContent = 'ESPECTADOR';
      $('msgText').textContent = 'Já tem 2 lutadores. Você entra na próxima seleção de personagens.';
    } else if (m.phase === 'select') {
      showScreen('selScreen');
      renderSelect(m);
    } else if (m.phase === 'results') {
      showScreen('resScreen');
      $('resTitle').textContent = m.won ? 'VOCÊ VENCEU!' : 'VOCÊ PERDEU!';
    } else {
      showScreen(null);
    }
  }

  function renderSelect(m) {
    const box = $('roster');
    if (!rosterBuilt && m.roster) {
      box.innerHTML = '';
      m.roster.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'char';
        b.style.background = `linear-gradient(160deg, ${c.color}, #111)`;
        b.innerHTML = `${c.name}<small>${c.title}</small>`;
        b.addEventListener('click', () => {
          if (st && st.locked) return;
          pad.send({ t: 'hover', c: i });
          pad.vibrate(10);
        });
        box.appendChild(b);
      });
      rosterBuilt = true;
    }
    [...box.children].forEach((b, i) => b.classList.toggle('sel', i === m.hover));
    const c = m.roster && m.roster[m.hover];
    if (c) $('selMoves').innerHTML = `ESPECIAL: ${c.moves[0]} · ↑+ESP: ${c.moves[1]}<br>↓+ESP: ${c.moves[2]} · SUPER: ${c.moves[3]}`;
    $('lockBtn').hidden = m.locked;
    $('unlockBtn').hidden = !m.locked;
    $('lockBtn').textContent = '✔ CONFIRMAR';
    if (m.locked) $('selMoves').innerHTML += '<br><b style="color:#3ddc84">PRONTO! Aguardando o adversário...</b>';
  }

  $('lockBtn').addEventListener('click', () => { pad.send({ t: 'lock' }); pad.vibrate(40); pad.fullscreen(); });
  $('unlockBtn').addEventListener('click', () => pad.send({ t: 'unlock' }));
  $('rematchBtn').addEventListener('click', () => { pad.send({ t: 'rematch' }); pad.vibrate(30); });
  $('reselectBtn').addEventListener('click', () => { pad.send({ t: 'reselect' }); pad.vibrate(30); });
  for (const id of ['menu', 'menu2', 'menu3']) $(id).addEventListener('click', () => { pad.vibrate(30); pad.exit(); });

  // ----------------------------- JOYSTICK -----------------------------
  // 8 direções: x -1/0/1 (esquerda/direita), y 1/0/-1 (cima/baixo)
  const zone = $('stickZone'), base = $('base'), knob = $('knob');
  const R = 64, TH = 0.42;
  let stickId = null, ox = 0, oy = 0;
  const dir = { x: 0, y: 0 };

  function setDir(x, y) {
    if (x === dir.x && y === dir.y) return;
    dir.x = x; dir.y = y;
    base.querySelector('.l').classList.toggle('on', x < 0);
    base.querySelector('.r').classList.toggle('on', x > 0);
    base.querySelector('.u').classList.toggle('on', y > 0);
    base.querySelector('.d').classList.toggle('on', y < 0);
    sendDir();
    if (y > 0) pad.vibrate(6);
  }

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* ok */ }
    const r = zone.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    base.style.left = `${ox - r.left}px`; base.style.top = `${oy - r.top}px`;
    base.style.display = 'block';
    knob.style.transform = 'translate(0,0)';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / R, ny = dy / R;
    // pular exige empurrar mais para cima (evita pulos sem querer)
    setDir(nx > TH ? 1 : nx < -TH ? -1 : 0, ny < -0.55 ? 1 : ny > TH ? -1 : 0);
  });
  const end = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    base.style.display = 'none';
    setDir(0, 0);
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  // ------------------------------ BOTÕES ------------------------------
  for (const btn of document.querySelectorAll('[data-b]')) {
    const b = btn.dataset.b;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ok */ }
      btn.classList.add('down');
      sendDir(); // garante que a direção chegue antes do botão
      pad.send({ t: 'btn', b });
      pad.vibrate(b === 'su' ? 40 : 12);
    });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------- ENVIO -------------------------------
  let lastDirAt = 0;
  function sendDir() {
    pad.send({ t: 'dir', x: dir.x, y: dir.y });
    lastDirAt = performance.now();
  }
  setInterval(() => { if (performance.now() - lastDirAt > 150) sendDir(); }, 50);

})();
