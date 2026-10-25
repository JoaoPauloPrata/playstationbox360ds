'use strict';
// Tela do emulador: abre uma ROM importada (IndexedDB) no EmulatorJS e
// transforma os botões dos celulares em botões do console (P1..P4).
(() => {
  const $ = (id) => document.getElementById(id);
  const EJS_DATA = 'https://cdn.emulatorjs.org/4.2.3/data/';
  const MAX_PLAYERS = 4;
  const COLORS = ArcadeScreen.PLAYER_COLORS;
  const { SYSTEMS } = RetroSystems;

  const romId = new URLSearchParams(location.search).get('rom') || '';
  let meta = null;
  let sys = null;
  let phase = 'loading'; // loading | playing | error
  let errorText = '';
  let leaving = false;
  const held = new Map(); // pid -> Set(ids apertados), para soltar tudo se o celular cair

  // ------------------------------ CONEXÃO ------------------------------
  const arcade = ArcadeScreen({
    game: 'retro',
    autoExit: false, // salva o jogo antes de voltar
    onRoom(info, players) {
      $('code').textContent = info.code;
      $('qr').src = info.qr;
      renderPlayers(players);
    },
    onJoin(p, players) {
      renderPlayers(players);
      const bench = sys && p.index >= maxPlayers();
      toast(bench ? `📱 Jogador ${p.index + 1} entrou na reserva (${sys.short}: até ${maxPlayers()})` : `📱 Jogador ${p.index + 1} entrou`);
      showHud('peek', 4000);
      sendState();
    },
    onLeave(p, players) { releaseAll(p.pid, p.index); renderPlayers(players); showHud('peek', 4000); sendState(); },
    onReady(p) { sendState(p.pid); },
    onMessage(m) {
      if (m.t === 'btn') press(m, m.id | 0, Math.max(0, Math.min(1, Number(m.v) || 0)));
      else if (m.t === 'cmd') command(m.c, m);
      else if (m.t === 'exit') exit();
    },
  });

  function sendState(pid) {
    arcade.send({
      t: 'retro',
      phase,
      sys: meta ? meta.system : null,
      name: meta ? meta.name : '',
      msg: errorText,
      paused: !!(emu() && emu().paused),
      max: maxPlayers(),
      used: lastPlayers.map((p) => p.index), // vagas ocupadas (o celular da reserva vê quando abre uma)
      qr: hudOpen,
    }, pid);
  }

  // ------------------------------ ROM ---------------------------------
  async function boot() {
    try {
      meta = romId ? await RomLibrary.get(romId) : null;
    } catch { meta = null; }
    if (!meta) return fail('ROM NÃO ENCONTRADA', 'Esta ROM não está importada neste navegador. Volte à galeria e importe de novo.');
    sys = SYSTEMS[meta.system];
    if (!sys) return fail('CONSOLE NÃO SUPORTADO', `Sistema "${meta.system}" desconhecido.`);
    renderPlayers(); // agora sabemos quantas vagas o console tem

    document.title = `${meta.name} · playstationbox360ds`;
    $('ovIc').textContent = sys.icon;
    $('ovTitle').textContent = meta.name.toUpperCase();
    $('ovSys').textContent = sys.name.toUpperCase();
    $('ovSys').hidden = false;
    $('ovText').innerHTML = 'Carregando o emulador...<br><span class="blink">a primeira vez demora um pouco</span>';
    sendState();

    const file = await RomLibrary.file(romId);
    if (!file) return fail('ROM CORROMPIDA', 'O arquivo da ROM sumiu do navegador. Importe de novo.');
    RomLibrary.update(romId, { playedAt: Date.now() }).catch(() => {});

    Object.assign(window, {
      EJS_player: '#game',
      EJS_core: sys.core,
      EJS_gameUrl: file,
      EJS_gameName: `${meta.name} ${meta.id}`, // nome dos saves (bateria) do jogo
      EJS_pathtodata: EJS_DATA,
      EJS_language: 'pt-BR',
      EJS_startOnLoaded: true,
      EJS_color: sys.color,
      EJS_backgroundColor: '#000000',
      EJS_CacheLimit: 0, // a ROM já está na nossa biblioteca: não duplicar
      EJS_Buttons: { netplay: false, exitEmulation: false, cacheManager: false },
      EJS_onGameStart: onStart,
    });
    const s = document.createElement('script');
    s.src = EJS_DATA + 'loader.js';
    s.onerror = () => fail('SEM INTERNET?', 'Não deu para baixar o emulador (cdn.emulatorjs.org).');
    document.body.appendChild(s);

    // O emulador mostra a própria tela de carregamento por baixo; tiramos a nossa logo
    setTimeout(() => { if (phase === 'loading') $('ov').classList.add('hidden'); }, 1500);
  }

  function onStart() {
    phase = 'playing';
    $('ov').classList.add('hidden');
    sendState();
    showHud('open', 12000); // primeiros segundos: QR à vista para a turma entrar
    checkSound();
  }

  function fail(title, text) {
    phase = 'error';
    errorText = text;
    $('ovTitle').textContent = title;
    $('ovText').textContent = text;
    $('ovBtn').hidden = false;
    $('ov').classList.remove('hidden');
    sendState();
  }
  $('ovBtn').addEventListener('click', () => exit());

  // ------------------------------ CONTROLES ----------------------------
  const emu = () => window.EJS_emulator;
  const gm = () => (emu() && emu().started ? emu().gameManager : null);

  // v: 0 = solto, 1 = apertado (no analógico, 0..1 = força)
  function press(m, id, v) {
    if (m.index >= maxPlayers() || id < 0 || id > 23) return; // reserva: não controla ninguém
    let set = held.get(m.pid);
    if (!set) held.set(m.pid, (set = new Set()));
    if (v) set.add(id); else set.delete(id);
    const g = gm();
    if (!g) return;
    // 16-23 são eixos analógicos: o valor vai até 0x7fff
    g.simulateInput(m.index, id, id >= 16 ? Math.round(v * 0x7fff) : (v ? 1 : 0));
  }

  function releaseAll(pid, index) {
    const set = held.get(pid);
    held.delete(pid);
    const g = gm();
    if (!set || !g || index >= MAX_PLAYERS) return;
    for (const id of set) g.simulateInput(index, id, 0);
  }

  async function command(c, m) {
    const g = gm();
    const e = emu();
    if (c === 'exit') return exit();
    if (c === 'qr') return showHud(hudOpen ? 'close' : 'open', 30000);
    if (!g) return;
    try {
      if (c === 'save') {
        await RomLibrary.setState(romId, g.getState());
        toast(`💾 Jogo salvo (P${m.index + 1})`);
        arcade.send({ t: 'retro-toast', text: '💾 Jogo salvo!' });
      } else if (c === 'load') {
        const st = await RomLibrary.state(romId);
        if (!st) { arcade.send({ t: 'retro-toast', text: 'Nenhum jogo salvo ainda' }, m.pid); return; }
        g.loadState(st.data);
        toast('📂 Jogo carregado');
        arcade.send({ t: 'retro-toast', text: '📂 Jogo carregado!' });
      } else if (c === 'reset') {
        g.restart();
        toast('↻ Reiniciado');
      } else if (c === 'pause') {
        if (e.paused) e.play(); else e.pause();
        toast(e.paused ? '⏸ PAUSADO' : '▶ CONTINUANDO');
        sendState();
      }
    } catch (err) {
      console.warn(err);
      arcade.send({ t: 'retro-toast', text: 'Este console não suporta isso' }, m.pid);
    }
  }

  // ------------------------------ SAIR ---------------------------------
  async function exit() {
    if (leaving) return;
    leaving = true;
    toast('Salvando...');
    const g = gm();
    if (g) {
      try { g.saveSaveFiles(); } catch { /* sem bateria */ }
      try { // a última imagem do jogo vira a capa na galeria
        const png = await Promise.race([g.screenshot(), new Promise((r) => setTimeout(r, 1200))]);
        if (png && png.length) await RomLibrary.setCover(romId, new Blob([png], { type: 'image/png' }));
      } catch { /* sem capa */ }
      await new Promise((r) => setTimeout(r, 400)); // deixa o IndexedDB do emulador gravar
    }
    arcade.exit();
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); exit(); }
    if (e.code === 'KeyQ' && e.ctrlKey) { e.preventDefault(); command('qr', {}); }
  }, true);

  // ------------------------------ SOM ----------------------------------
  // Navegadores só liberam áudio depois de um clique/tecla na própria página.
  function checkSound() {
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    if (ctx.state === 'running') { ctx.close(); return; }
    $('sound').classList.remove('hidden');
    const unlock = () => {
      $('sound').classList.add('hidden');
      ctx.resume().finally(() => ctx.close());
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  // ------------------------------ EXTRAS --------------------------------
  // Vagas do console: P1..Pmax jogam; quem passar disso fica na reserva
  const maxPlayers = () => Math.min(MAX_PLAYERS, sys ? sys.players : MAX_PLAYERS);
  let lastPlayers = [];
  function renderPlayers(players) {
    lastPlayers = players || lastPlayers;
    const max = maxPlayers();
    const by = new Map(lastPlayers.map((p) => [p.index, p]));
    const top = Math.max(max, ...lastPlayers.map((p) => p.index + 1));
    let html = '';
    for (let i = 0; i < top; i++) {
      const p = by.get(i);
      const color = COLORS[i % COLORS.length];
      if (i >= max) { if (p) html += `<span class="chip bench" title="reserva">P${i + 1} RESERVA</span>`; continue; }
      html += p
        ? `<span class="chip ${p.connected ? '' : 'off'}" style="background:${color}">P${i + 1}</span>`
        : `<span class="chip free">P${i + 1} LIVRE</span>`;
    }
    $('chips').innerHTML = html;
  }

  // Canto com QR. mode: 'open' (com QR), 'close' (esconde) ou 'peek' (mostra como está).
  // Durante o jogo ele some sozinho depois de `ms`.
  let hudOpen = true;
  let hudT = 0;
  function showHud(mode, ms) {
    const was = hudOpen;
    if (mode === 'open') hudOpen = true;
    if (mode === 'close') hudOpen = false;
    const hud = $('hud');
    hud.classList.toggle('open', hudOpen);
    hud.classList.toggle('dim', mode === 'close');
    clearTimeout(hudT);
    if (phase === 'playing' && mode !== 'close') {
      hudT = setTimeout(() => {
        hud.classList.add('dim');
        if (hudOpen) { hudOpen = false; sendState(); }
      }, ms);
    }
    if (was !== hudOpen) sendState();
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }

  boot();
})();
