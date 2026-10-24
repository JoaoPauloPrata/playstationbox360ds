'use strict';
// =====================================================================
//  SDK do CONTROLE (celular) — usado pelo controle da galeria e de cada jogo
//
//  const pad = ArcadeController({
//    game: 'kart',              // id do jogo deste controle (null = galeria)
//    orientation: 'landscape',  // 'landscape' | 'portrait' | 'any' (padrão)
//    onJoined(info) {},         // { code, pid, index }
//    onMessage(msg) {},         // mensagens enviadas pela tela
//    onStatus(text, kind) {},   // kind: 'ok' | 'wait' | 'error'
//  });
//  pad.send(obj)   -> manda para a tela
//  pad.exit()      -> pede para a tela voltar à galeria
//  pad.vibrate(ms)
//
//  Se a tela trocar de jogo, este SDK redireciona o celular para o
//  controle correto sozinho, mantendo a identidade do jogador.
//
//  Também prepara a página como app (PWA): trava zoom/rolagem, registra o
//  service worker, tela cheia, orientação e o botão "instalar".
// =====================================================================
(function () {
  // ----------------------------- PÁGINA / PWA -----------------------------
  const isStandalone = () =>
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let installEvent = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    dispatchEvent(new Event('arcade-installable'));
  });
  addEventListener('appinstalled', () => { installEvent = null; dispatchEvent(new Event('arcade-installable')); });

  function addHead(tag, attrs) {
    const sel = Object.entries(attrs).filter(([k]) => k === 'rel' || k === 'name').map(([k, v]) => `[${k}="${v}"]`).join('');
    if (sel && document.head.querySelector(`${tag}${sel}`)) return;
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
  }

  let pageReady = false;
  function setupPage() {
    if (pageReady) return;
    pageReady = true;

    // Manifesto e ícones (caso a página não tenha declarado)
    addHead('link', { rel: 'manifest', href: '/manifest.webmanifest' });
    addHead('link', { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' });
    addHead('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    addHead('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    addHead('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });

    // Trava zoom, rolagem, "puxar para atualizar", seleção de texto e menu de toque longo
    const style = document.createElement('style');
    style.textContent = `
      html, body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
      body, body * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
      body { touch-action: none; }
      input, textarea { -webkit-user-select: text; user-select: text; touch-action: manipulation; }
      .scroll { touch-action: pan-y; overflow-y: auto; }`;
    document.head.appendChild(style);
    const stop = (e) => e.preventDefault();
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, stop, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault();
    }, { passive: false });
    document.addEventListener('contextmenu', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });

    // Service worker (só existe em HTTPS ou localhost)
    if ('serviceWorker' in navigator && isSecureContext) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* sem cache offline */ });
    }

    // Mantém a tela do celular ligada
    const wake = async () => { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch { /* sem suporte */ } };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    wake();
  }

  function lockOrientation(o) {
    const so = screen.orientation;
    if (!so) return;
    if (!o || o === 'any') { try { so.unlock(); } catch { /* ok */ } return; }
    if (so.lock) so.lock(o).catch(() => { /* só funciona em tela cheia/app instalado */ });
  }

  function goFullscreen(orientation) {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen && !isStandalone()) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => lockOrientation(orientation)).catch(() => {});
    } else lockOrientation(orientation);
  }

  // Aviso padrão quando a conexão não tem mais volta (sala fechou, código errado...)
  function fatalOverlay(text) {
    if (document.getElementById('arcade-fatal')) return;
    const d = document.createElement('div');
    d.id = 'arcade-fatal';
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,8,32,.97);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;font-family:"Press Start 2P",monospace';
    d.innerHTML = `
      <div style="font-size:40px">📡</div>
      <div style="font-size:14px;color:#ffd400;line-height:1.6">DESCONECTADO</div>
      <div style="font:20px VT323,monospace;color:#a9a3d6;max-width:420px" id="arcade-fatal-msg"></div>
      <a href="/app/" style="font-size:13px;padding:16px 22px;background:#2ecc71;color:#000;border:4px solid #000;border-radius:12px;box-shadow:0 5px 0 #000;text-decoration:none">📷 ESCANEAR QR CODE</a>
      <button style="font:inherit;font-size:10px;padding:10px 14px;background:transparent;color:#fff;border:2px solid rgba(255,255,255,.5);border-radius:10px" onclick="location.reload()">TENTAR DE NOVO</button>`;
    document.body.appendChild(d);
    d.querySelector('#arcade-fatal-msg').textContent = text;
  }

  // ------------------------------ CONEXÃO ------------------------------
  // Endereço do WebSocket: vem de /shared/config.js (ou o próprio servidor da página)
  const wsBase = () => (window.ARCADE_CONFIG && window.ARCADE_CONFIG.ws)
    || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function ArcadeController(opts = {}) {
    setupPage();
    const game = opts.game || null;
    const orientation = opts.orientation || 'any';
    const code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
    const pidKey = `arcade.pid.${code}`;
    let ws = null;
    let retry = 0;
    let dead = false;
    let me = null;

    const status = (text, kind) => opts.onStatus && opts.onStatus(text, kind);

    // Orientação: no app instalado trava direto; no navegador, no primeiro toque (exige gesto)
    if (isStandalone()) lockOrientation(orientation);
    else if (orientation !== 'any') {
      addEventListener('pointerdown', function once() {
        removeEventListener('pointerdown', once);
        goFullscreen(orientation);
      });
    }

    function controllerUrl(id) {
      return id ? `/games/${encodeURIComponent(id)}/controller.html?room=${code}` : `/controller.html?room=${code}`;
    }
    function follow(target) {
      if ((target || null) === game) return false;
      dead = true;
      if (ws) ws.close();
      location.replace(controllerUrl(target));
      return true;
    }
    function fail(text) {
      dead = true;
      status(text, 'error');
      if (opts.onError) opts.onError(text);
      fatalOverlay(text);
    }

    function connect() {
      if (!code) { location.replace('/app/'); return; }
      const q = new URLSearchParams({ role: 'controller', room: code, pid: localStorage.getItem(pidKey) || '' });
      ws = new WebSocket(`${wsBase()}?${q}`);
      status('Conectando...', 'wait');

      ws.onopen = () => { retry = 0; };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.t) {
          case 'joined':
            try {
              localStorage.setItem(pidKey, m.pid);
              localStorage.setItem('arcade.lastRoom', m.code);
            } catch { /* modo privado */ }
            me = m;
            if (follow(m.game)) return;
            status(`Jogador ${m.index + 1}`, m.screen ? 'ok' : 'wait');
            api.send({ t: 'hello' }); // pede para a tela reenviar o estado
            opts.onJoined && opts.onJoined(m);
            break;
          case 'launch':
            if (!follow(m.game)) {
              status(me ? `Jogador ${me.index + 1}` : 'Conectado', 'ok');
              api.send({ t: 'hello' }); // a tela recarregou: pede o estado de novo
            }
            break;
          case 'screen-away':
            status('Carregando a tela...', 'wait');
            break;
          case 'error':
          case 'room-closed':
            try { localStorage.removeItem('arcade.lastRoom'); } catch { /* ok */ }
            fail(m.msg || 'A tela foi fechada. Escaneie o novo QR code.');
            break;
          case 'vibe':
            api.vibrate(m.ms);
            opts.onMessage && opts.onMessage(m);
            break;
          default:
            opts.onMessage && opts.onMessage(m);
        }
      };
      ws.onclose = (ev) => {
        if (dead) return;
        if (ev.code === 4000) return fail('Este controle foi aberto em outra aba.');
        status('Reconectando...', 'wait');
        setTimeout(connect, Math.min(4000, 400 * ++retry));
      };
    }

    const api = {
      get me() { return me; },
      get room() { return code; },
      send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
      exit() { api.send({ t: 'exit' }); },
      home() { dead = true; if (ws) ws.close(); location.href = '/app/'; },
      vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* iOS não suporta */ } },
      fullscreen() { goFullscreen(orientation); },
    };

    connect();
    return api;
  }

  ArcadeController.PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];
  ArcadeController.setupPage = setupPage;
  ArcadeController.isStandalone = isStandalone;
  ArcadeController.isIOS = isIOS;
  ArcadeController.canInstall = () => !!installEvent;
  ArcadeController.install = async () => {
    if (!installEvent) return false;
    installEvent.prompt();
    const r = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    return !!r && r.outcome === 'accepted';
  };
  window.ArcadeController = ArcadeController;
})();
