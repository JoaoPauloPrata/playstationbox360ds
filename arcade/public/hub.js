'use strict';
// Galeria de jogos (tela). Navegável pelo celular, teclado ou mouse.
(() => {
  const $ = (id) => document.getElementById(id);
  const COLS = 3;
  const COLORS = ArcadeScreen.PLAYER_COLORS;

  let games = [];
  let sel = 0;
  let launching = false;

  // ------------------------------ CONEXÃO ------------------------------
  const arcade = ArcadeScreen({
    game: null,
    onRoom(info, players) {
      $('qr').innerHTML = `<img src="${info.qr}" alt="QR code para conectar o celular">`;
      $('code').textContent = info.code;
      $('url').textContent = info.url;
      renderPlayers(players);
      broadcastSel();
    },
    onJoin(p, players) {
      renderPlayers(players);
      toast(`📱 Jogador ${p.index + 1} conectou!`);
      beep(660, 0.08); setTimeout(() => beep(990, 0.12), 90);
      broadcastSel();
    },
    onLeave(p, players) {
      renderPlayers(players);
      toast(`Jogador ${p.index + 1} saiu`);
    },
    onReady() { broadcastSel(); },
    onMessage(m) {
      if (m.t === 'nav') move(m.dir);
      else if (m.t === 'select') launch();
      else if (m.t === 'pick' && typeof m.i === 'number') { select(m.i); launch(); }
    },
  });

  // ------------------------------ GALERIA ------------------------------
  async function loadGames() {
    try {
      games = await (await fetch('/games/index.json', { cache: 'no-store' })).json();
    } catch {
      games = [];
    }
    const last = sessionStorage.getItem('arcade.lastGame');
    const i = games.findIndex((g) => g.id === last);
    sel = i >= 0 ? i : 0;
    renderGrid();
    select(sel);
  }

  function renderGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    games.forEach((g, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.i = i;
      if (g.cover) el.style.backgroundImage = `url("/games/${g.id}/${g.cover}")`;
      else {
        el.style.background = `linear-gradient(135deg, ${g.color || '#444'}, #000)`;
        el.innerHTML = `<div class="icon">${g.icon || '🎮'}</div>`;
      }
      el.insertAdjacentHTML('beforeend', `<div class="name">${escapeHtml(g.name)}</div>`);
      el.addEventListener('mouseenter', () => select(i));
      el.addEventListener('click', () => { select(i); launch(); });
      grid.appendChild(el);
    });
    const soon = document.createElement('div');
    soon.className = 'card soon';
    soon.innerHTML = '+<br>MAIS JOGOS<br>EM BREVE';
    grid.appendChild(soon);
  }

  function select(i) {
    if (!games.length) {
      $('detail').innerHTML = '<h3>Nenhum jogo</h3><p>Adicione uma pasta em public/games com um game.json.</p>';
      return;
    }
    sel = (i + games.length) % games.length;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', +c.dataset.i === sel));
    const g = games[sel];
    $('detail').innerHTML = `
      <h2>DETALHES</h2>
      <h3>${g.icon ? g.icon + ' ' : ''}${escapeHtml(g.name)}</h3>
      <div class="tags">
        ${g.genre ? `<span class="tag">${escapeHtml(g.genre)}</span>` : ''}
        ${g.players ? `<span class="tag p">${escapeHtml(g.players)}</span>` : ''}
      </div>
      <p>${escapeHtml(g.description || g.tagline || '')}</p>
      ${g.controls ? `<ul>${g.controls.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
      <div class="push blink">▶ TOQUE EM JOGAR</div>`;
    broadcastSel();
  }

  function move(dir) {
    if (!games.length || launching) return;
    const d = { left: -1, right: 1, up: -COLS, down: COLS }[dir];
    if (!d) return;
    let n = sel + d;
    if (dir === 'up' || dir === 'down') { if (n < 0 || n >= games.length) return; }
    select(n);
    beep(440, 0.04);
  }

  function launch() {
    const g = games[sel];
    if (!g || launching) return;
    launching = true;
    sessionStorage.setItem('arcade.lastGame', g.id);
    beep(523, 0.08); setTimeout(() => beep(784, 0.16), 90);
    arcade.send({ t: 'hub-launching', name: g.name });
    $('launch').textContent = `CARREGANDO ${g.name.toUpperCase()}...`;
    $('launch').classList.add('on');
    setTimeout(() => arcade.launch(g.id), 500);
  }

  function broadcastSel() {
    const g = games[sel];
    arcade.send({
      t: 'hub',
      sel,
      total: games.length,
      games: games.map((x) => ({ name: x.name, icon: x.icon || '🎮', color: x.color || '#444' })),
      game: g ? { name: g.name, icon: g.icon || '🎮', color: g.color || '#444', players: g.players || '' } : null,
    });
  }

  function renderPlayers(players) {
    const el = $('players');
    if (!players.length) {
      el.innerHTML = '<span class="blink">Aguardando jogadores... escaneie o QR code ↗</span>';
      return;
    }
    el.innerHTML = players.map((p) =>
      `<span class="chip ${p.connected ? '' : 'off'}" style="background:${COLORS[p.index % COLORS.length]}">P${p.index + 1}</span>`).join('') +
      `<span>${players.length} conectado${players.length > 1 ? 's' : ''}</span>`;
  }

  // ------------------------------ TECLADO ------------------------------
  addEventListener('keydown', (e) => {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (map[e.code]) { e.preventDefault(); move(map[e.code]); }
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); launch(); }
  });

  // ------------------------------- EXTRAS ------------------------------
  let ac = null;
  function beep(f, d) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.06, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + d + 0.02);
    } catch { /* sem áudio */ }
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Ao voltar com o botão "voltar" do navegador, desfaz a transição
  addEventListener('pageshow', () => { launching = false; $('launch').classList.remove('on'); });

  loadGames();
})();
