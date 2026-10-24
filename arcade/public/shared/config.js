'use strict';
// =====================================================================
//  Onde fica o servidor de salas (WebSocket)?
//  - Rodando local (npm start): o mesmo endereço da página.
//  - Publicado na Vercel: o servidor no Fly.io.
// =====================================================================
(function () {
  const PROD_SERVER = 'https://fliperama-arcade.fly.dev';

  const h = location.hostname;
  const local = h === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local');
  const server = (window.ARCADE_SERVER || (local ? location.origin : PROD_SERVER)).replace(/\/+$/, '');

  window.ARCADE_CONFIG = {
    server,                                        // base HTTP(S) da API
    ws: server.replace(/^http/, 'ws') + '/ws',     // endereço do WebSocket
  };
})();
