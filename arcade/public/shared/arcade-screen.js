'use strict';
// =====================================================================
//  SDK da TELA (PC/TV) — usado pela galeria e por cada jogo
//
//  const arcade = ArcadeScreen({
//    game: 'kart',                 // id do jogo (null/omitido = galeria)
//    onRoom(info) {},              // { code, url, qr, players }
//    onJoin(player, players) {},   // celular entrou  (player = { pid, index })
//    onLeave(player, players) {},  // celular saiu
//    onMessage(msg) {},            // mensagem de um celular (msg.pid, msg.index)
//    onReady(player) {},           // celular (re)conectou: reenvie o estado para ele
//  });
//  arcade.send(obj)            -> para todos os celulares
//  arcade.send(obj, pid)       -> só para um celular
//  arcade.launch('kart')       -> abre um jogo (celulares vão junto)
//  arcade.exit()               -> volta para a galeria
//
//  Quando um celular manda { t: 'exit' }, a tela volta para a galeria
//  automaticamente (desligue com autoExit: false).
// =====================================================================
(function () {
  // Endereço do WebSocket: vem de /shared/config.js (ou o próprio servidor da página)
  const wsBase = () => (window.ARCADE_CONFIG && window.ARCADE_CONFIG.ws)
    || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function ArcadeScreen(opts = {}) {
    const game = opts.game || null;
    const params = new URLSearchParams(location.search);
    let code = (params.get('room') || sessionStorage.getItem('arcade.room') || '').toUpperCase();
    let ws = null;
    let info = null;
    let leaving = false;
    let players = new Map(); // pid -> { pid, index, connected }

    const setPlayers = (list) => { players = new Map((list || []).map((p) => [p.pid, p])); };
    const sorted = () => [...players.values()].sort((a, b) => a.index - b.index);

    function connect() {
      const q = new URLSearchParams({ role: 'screen', room: code, game: game || '' });
      ws = new WebSocket(`${wsBase()}?${q}`);

      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.t) {
          case 'room': {
            code = m.code;
            info = m;
            sessionStorage.setItem('arcade.room', code);
            const u = new URL(location.href);
            u.searchParams.set('room', code);
            history.replaceState(null, '', u);
            setPlayers(m.players);
            opts.onRoom && opts.onRoom(m, sorted());
            break;
          }
          case 'ctrl-join':
            setPlayers(m.players);
            opts.onJoin && opts.onJoin({ pid: m.pid, index: m.index }, sorted());
            break;
          case 'ctrl-leave':
            setPlayers(m.players);
            opts.onLeave && opts.onLeave({ pid: m.pid, index: m.index }, sorted());
            break;
          case 'hello': // um celular (re)conectou e quer o estado atual
            if (opts.onReady) opts.onReady({ pid: m.pid, index: m.index });
            break;
          case 'exit':
            if (game && opts.autoExit !== false) api.exit();
            else opts.onMessage && opts.onMessage(m);
            break;
          default:
            opts.onMessage && opts.onMessage(m);
        }
      };
      ws.onclose = (ev) => {
        if (leaving) return;
        if (ev.code === 4001) { // outra aba/página assumiu esta sala
          opts.onReplaced ? opts.onReplaced() : replacedNotice();
          return;
        }
        opts.onDisconnect && opts.onDisconnect();
        setTimeout(connect, 1200);
      };
    }

    function replacedNotice() {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);color:#fff;display:grid;place-items:center;font:16px monospace;text-align:center;padding:24px';
      d.textContent = 'Esta sala foi aberta em outra aba. Feche esta aba ou recarregue para criar uma sala nova.';
      d.addEventListener('click', () => { sessionStorage.removeItem('arcade.room'); location.href = location.pathname; });
      document.body.appendChild(d);
    }

    const api = {
      get code() { return code; },
      get info() { return info; },
      get players() { return sorted(); },
      send(obj, pid) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pid ? { ...obj, to: pid } : obj));
      },
      launch(id) {
        leaving = true;
        location.href = `/games/${encodeURIComponent(id)}/?room=${code}`;
      },
      exit() {
        leaving = true;
        location.href = `/?room=${code}`;
      },
    };

    connect();
    return api;
  }

  // Cores padrão dos jogadores (índice 0 = jogador 1)
  ArcadeScreen.PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#ec407a', '#00acc1'];
  window.ArcadeScreen = ArcadeScreen;
})();
