'use strict';
// Galeria de jogos (tela). Navegável pelo celular, teclado ou mouse.
(() => {
  const $ = (id) => document.getElementById(id);
  const COLS = 3;
  const COLORS = ArcadeScreen.PLAYER_COLORS;

  let games = [];   // jogos da pasta public/games + ROMs importadas ({ rom: meta })
  let sel = 0;
  let launching = false;
  const coverUrls = new Map(); // id da ROM -> URL da capa (IndexedDB)
  const { SYSTEMS } = RetroSystems;

  // ------------------------------ CONEXÃO ------------------------------
  const arcade = ArcadeScreen({
    game: null,
    onRoom(info, players) {
      $('qr').innerHTML = `<img src="${info.qr}" alt="QR code para conectar o celular">`;
      $('code').textContent = info.code;
      $('url').textContent = shortUrl(info.url);
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
  async function loadGames(focusKey) {
    let list = [];
    try {
      list = (await (await fetch('/games/index.json', { cache: 'no-store' })).json()).filter((g) => !g.hidden);
    } catch { /* sem jogos */ }
    games = list.map((g) => ({ ...g, key: g.id }));
    games.push(...(await loadRoms()));
    const want = focusKey || sessionStorage.getItem('arcade.lastGame');
    const i = games.findIndex((g) => g.key === want);
    sel = i >= 0 ? i : 0;
    renderGrid();
    select(sel);
  }

  // ROMs importadas viram cards iguais aos dos jogos
  async function loadRoms() {
    let roms = [];
    try { roms = await RomLibrary.list(); } catch { return []; }
    const out = [];
    for (const r of roms) {
      const s = SYSTEMS[r.system] || { name: r.system, short: r.system, icon: '👾', color: '#444', players: 1, pad: {} };
      if (r.hasCover && !coverUrls.has(r.id)) {
        try { const b = await RomLibrary.cover(r.id); if (b) coverUrls.set(r.id, URL.createObjectURL(b)); } catch { /* sem capa */ }
      }
      const btns = [...(s.pad.face || []).flatMap((g) => g.diamond || g.row), ...(s.pad.sh || [])].map((b) => b.l);
      out.push({
        key: 'rom:' + r.id,
        id: 'retro',
        rom: r,
        name: r.name,
        description: `ROM de ${s.name} importada (${fmtSize(r.size)}).`,
        genre: s.short,
        players: s.players > 1 ? `1-${s.players} JOGADORES` : '1 JOGADOR',
        controls: [
          s.stick ? 'Direcional: analógico' : 'Direcional: setas do console',
          `Botões: ${btns.join(' ')}`,
          'MENU: salvar, carregar, pausar, reiniciar',
        ],
        icon: s.icon,
        color: s.color,
        coverUrl: coverUrls.get(r.id) || null,
      });
    }
    return out;
  }

  function renderGrid() {
    const grid = $('grid');
    grid.innerHTML = '';
    games.forEach((g, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.i = i;
      if (g.coverUrl) el.style.backgroundImage = `url("${g.coverUrl}")`;
      else if (g.cover) el.style.backgroundImage = `url("/games/${g.id}/${g.cover}")`;
      else {
        el.style.background = `linear-gradient(135deg, ${g.color || '#444'}, #000)`;
        el.innerHTML = `<div class="icon">${g.icon || '🎮'}</div>`;
      }
      if (g.rom) el.insertAdjacentHTML('beforeend', `<div class="sys">${escapeHtml(g.genre)}</div>`);
      el.insertAdjacentHTML('beforeend', `<div class="name">${escapeHtml(g.name)}</div>`);
      el.addEventListener('mouseenter', () => select(i));
      el.addEventListener('click', () => { select(i); launch(); });
      grid.appendChild(el);
    });
    const add = document.createElement('div');
    add.className = 'card soon add';
    add.innerHTML = '<div class="plus">+</div>IMPORTAR ROM<small>clique ou arraste os arquivos</small>';
    add.addEventListener('click', () => $('romInput').click());
    grid.appendChild(add);
  }

  function select(i) {
    if (!games.length) {
      $('detail').innerHTML = '<h3>Nenhum jogo</h3><p>Importe uma ROM ou adicione uma pasta em public/games com um game.json.</p>';
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
      ${g.rom ? romTools(g.rom) : ''}
      <div class="push blink">▶ TOQUE EM JOGAR</div>`;
    if (g.rom) bindRomTools(g.rom);
    const card = document.querySelector(`.card[data-i="${sel}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    sessionStorage.setItem('arcade.lastGame', g.key);
    beep(523, 0.08); setTimeout(() => beep(784, 0.16), 90);
    arcade.send({ t: 'hub-launching', name: g.name });
    $('launch').textContent = `CARREGANDO ${g.name.toUpperCase()}...`;
    $('launch').classList.add('on');
    setTimeout(() => (g.rom ? arcade.launch('retro', { rom: g.rom.id }) : arcade.launch(g.id)), 500);
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

  // ---------------------------- IMPORTAR ROMs ----------------------------
  // As ROMs ficam guardadas neste navegador (IndexedDB), nada vai para a internet.
  async function importFiles(files) {
    files = [...files];
    if (!files.length) return;
    let ok = 0, lastKey = null;
    const bad = [];
    toast(`Importando ${files.length} arquivo${files.length > 1 ? 's' : ''}...`, 60000);
    for (const f of files) {
      const system = await RetroSystems.detect(f);
      if (!system) { bad.push(f.name); continue; }
      try {
        const meta = await RomLibrary.add(f, system);
        ok++;
        lastKey = 'rom:' + meta.id;
      } catch (e) {
        console.warn(e);
        bad.push(f.name + ' (sem espaço?)');
      }
    }
    if (ok) {
      await loadGames(lastKey);
      beep(660, 0.08); setTimeout(() => beep(990, 0.12), 90);
    }
    const s = ok > 1 ? 's' : '';
    toast(bad.length
      ? `${ok ? `✔ ${ok} importada${s} · ` : ''}✖ não reconhecido: ${bad.slice(0, 2).join(', ')}${bad.length > 2 ? '...' : ''}`
      : `✔ ${ok} ROM${s} importada${s}!`, bad.length ? 4500 : 2200);
  }

  $('romInput').accept = RetroSystems.ACCEPT;
  $('romInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

  let dragDepth = 0;
  const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').classList.add('on'); });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('on'); } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop').classList.remove('on');
    importFiles(e.dataTransfer.files);
  });

  // Painel da ROM selecionada: trocar o console (se a detecção errou) ou remover
  function romTools(r) {
    const opts = Object.entries(SYSTEMS)
      .map(([k, s]) => `<option value="${k}" ${k === r.system ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    return `<div class="romtools">
      <label>CONSOLE <select id="romSys">${opts}</select></label>
      <button id="romDel">🗑 REMOVER</button>
    </div>`;
  }
  function bindRomTools(r) {
    $('romSys').addEventListener('change', async (e) => {
      await RomLibrary.update(r.id, { system: e.target.value });
      await loadGames('rom:' + r.id);
      toast('Console alterado');
    });
    const del = $('romDel');
    del.addEventListener('click', async () => {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'CLIQUE DE NOVO P/ REMOVER';
        setTimeout(() => { del.classList.remove('confirm'); del.textContent = '🗑 REMOVER'; }, 3000);
        return;
      }
      await RomLibrary.remove(r.id);
      if (coverUrls.has(r.id)) { URL.revokeObjectURL(coverUrls.get(r.id)); coverUrls.delete(r.id); }
      await loadGames();
      toast(`${r.name} removida`);
    });
  }

  function fmtSize(n) {
    return n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  // ------------------------------ TECLADO ------------------------------
  addEventListener('keydown', (e) => {
    if (/SELECT|INPUT/.test(e.target.tagName)) return;
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
  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // Endereço curto do app para digitar à mão (ex.: playstationbox360ds.vercel.app/app)
  function shortUrl(u) {
    try { const x = new URL(u); return `${x.host}/app`; } catch { return u; }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Ao voltar com o botão "voltar" do navegador, desfaz a transição
  addEventListener('pageshow', () => { launching = false; $('launch').classList.remove('on'); });

  loadGames();
})();
