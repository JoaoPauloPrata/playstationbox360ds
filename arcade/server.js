// Servidor do Fliperama
// - Serve a galeria de jogos e cada jogo (public/games/<id>/)
// - Gerencia "salas": uma tela (TV/PC) + vários controles (celulares)
// - As salas sobrevivem à troca de página: a tela pode ir da galeria para um jogo
//   e voltar, e os celulares são redirecionados automaticamente para o controle certo.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const CERT_DIR = path.join(__dirname, 'certs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAMES_DIR = path.join(PUBLIC_DIR, 'games');

const SCREEN_GRACE_MS = 20000; // tempo que a sala espera a tela voltar (troca de página)
const PLAYER_GRACE_MS = 4000;  // tempo que um jogador pode sumir antes de "sair" da sala

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// ----------------------------- REDE LOCAL -----------------------------
function lanAddress() {
  const ignore = /(vethernet|virtualbox|vmware|wsl|docker|hyper-v|loopback|tailscale|zerotier)/i;
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      let score = 0;
      if (!ignore.test(name)) score += 10;
      if (addr.address.startsWith('192.168.')) score += 5;
      else if (addr.address.startsWith('10.')) score += 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr.address)) score += 1;
      if (/wi-?fi|wlan|ethernet|eth|en\d/i.test(name)) score += 2;
      candidates.push({ address: addr.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].address : 'localhost';
}
// HTTPS é opcional: basta colocar certs/cert.pem e certs/key.pem.
// (O app PWA do controle e a câmera do celular só funcionam em HTTPS.)
const TLS = (() => {
  try {
    return { cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')), key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')) };
  } catch { return null; }
})();

// Endereço que vai no QR code (o que o celular acessa).
//   PUBLIC_URL=https://meu-dominio.com npm start   -> ex.: túnel ou servidor na nuvem
//   PUBLIC_HOST=192.168.0.10:3000 npm start         -> força o IP da rede local
const PUBLIC_URL = (process.env.PUBLIC_URL
  || (process.env.PUBLIC_HOST ? `http://${process.env.PUBLIC_HOST}`
  : TLS ? `https://${lanAddress()}:${HTTPS_PORT}` : `http://${lanAddress()}:${PORT}`)).replace(/\/+$/, '');

// --------------------------- CATÁLOGO DE JOGOS -------------------------
// Cada pasta em public/games com um game.json vira um jogo na galeria.
function listGames() {
  let dirs = [];
  try { dirs = fs.readdirSync(GAMES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const games = [];
  for (const d of dirs) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, d.name, 'game.json'), 'utf8'));
      games.push({ ...meta, id: d.name });
    } catch { /* pasta sem game.json válido: ignora */ }
  }
  return games.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
}
// No Fly.io o servidor roda sem as páginas (elas ficam na Vercel): aí aceita qualquer id válido.
const HAS_PUBLIC = fs.existsSync(GAMES_DIR);
const gameExists = (id) => !!id && /^[a-z0-9-]+$/.test(id) && (!HAS_PUBLIC || fs.existsSync(path.join(GAMES_DIR, id, 'game.json')));

// ------------------------------- HTTP ----------------------------------
function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  // A API pode ser chamada por páginas de outro domínio (Vercel -> Fly)
  if (pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`ok ${rooms.size} salas`);
  }

  // Lista de jogos da galeria (na Vercel é um arquivo gerado no build)
  if (pathname === '/api/games' || pathname === '/games/index.json') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(listGames()));
  }

  // O app do controle usa isto para validar o código antes de entrar
  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4})$/);
  if (roomMatch) {
    const room = rooms.get(roomMatch[1].toUpperCase());
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ exists: !!room, game: room ? room.game : null, players: room ? room.players.size : 0 }));
  }

  if (!HAS_PUBLIC) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Servidor de salas do Fliperama. As páginas ficam no front-end.');
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Proibido');
  }
  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) { // /games/kart -> /games/kart/
      res.writeHead(301, { Location: url.pathname + '/' + url.search });
      return res.end();
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Não encontrado');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

const server = http.createServer(handleRequest);
const secureServer = TLS ? https.createServer(TLS, handleRequest) : null;


// ------------------------------ SALAS ----------------------------------
/**
 * room = {
 *   code, game (id do jogo aberto na tela ou null = galeria),
 *   screen: WebSocket|null, screenTimer,
 *   players: Map<pid, { pid, index, ws, leaveTimer, announced }>
 * }
 */
const rooms = new Map();

function newRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  while (rooms.has(code));
  return code;
}

const isOpen = (ws) => ws && ws.readyState === ws.OPEN;
function send(ws, obj) { if (isOpen(ws)) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
function toControllers(room, obj) { for (const p of room.players.values()) send(p.ws, obj); }
const playerList = (room) => [...room.players.values()].map((p) => ({ pid: p.pid, index: p.index, connected: isOpen(p.ws) }));

function freeIndex(room) {
  const used = new Set([...room.players.values()].map((p) => p.index));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

function closeRoom(room) {
  for (const p of room.players.values()) {
    clearTimeout(p.leaveTimer);
    send(p.ws, { t: 'room-closed' });
    if (p.ws) p.ws.close();
  }
  rooms.delete(room.code);
  console.log(`[sala ${room.code}] encerrada`);
}

// ---------------------------- WEBSOCKET --------------------------------
const wss = new WebSocketServer({ noServer: true });
for (const srv of [server, secureServer]) {
  if (!srv) continue;
  srv.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const role = params.get('role');
  if (role === 'screen') return onScreen(ws, params);
  if (role === 'controller') return onController(ws, params);
  ws.close();
});

async function onScreen(ws, params) {
  const wanted = (params.get('room') || '').toUpperCase();
  const game = gameExists(params.get('game')) ? params.get('game') : null;

  let room = rooms.get(wanted);
  if (!room) {
    room = { code: newRoomCode(), game: null, screen: null, screenTimer: null, players: new Map() };
    rooms.set(room.code, room);
    console.log(`[sala ${room.code}] criada`);
  }
  clearTimeout(room.screenTimer);
  // Na troca de página a tela nova pode conectar antes de a antiga fechar:
  // a mais nova assume a sala e a antiga é desligada (código 4001 = não reconectar).
  const old = room.screen;
  room.screen = ws;
  if (isOpen(old)) old.close(4001, 'substituída');
  room.game = game;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.to) {
      const p = room.players.get(msg.to);
      if (p) send(p.ws, msg);
    } else {
      toControllers(room, msg);
    }
  });

  ws.on('close', () => {
    if (room.screen !== ws) return; // já foi substituída por outra conexão
    room.screen = null;
    toControllers(room, { t: 'screen-away' });
    room.screenTimer = setTimeout(() => closeRoom(room), SCREEN_GRACE_MS);
  });
  const url = `${PUBLIC_URL}/controller.html?room=${room.code}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  send(ws, { t: 'room', code: room.code, url, qr, game, players: playerList(room) });

  // Leva os celulares para o controle do jogo que está na tela agora
  toControllers(room, { t: 'launch', game });
  console.log(`[sala ${room.code}] tela em: ${game || 'galeria'}`);
}

function onController(ws, params) {
  const code = (params.get('room') || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) {
    send(ws, { t: 'error', msg: 'Sala não encontrada. Escaneie o QR code da tela novamente.' });
    return ws.close();
  }

  let pid = params.get('pid') || '';
  let p = room.players.get(pid);
  if (!p) {
    pid = crypto.randomBytes(6).toString('hex');
    p = { pid, index: freeIndex(room), ws: null, leaveTimer: null, announced: false };
    room.players.set(pid, p);
  }
  clearTimeout(p.leaveTimer);
  if (isOpen(p.ws) && p.ws !== ws) p.ws.close(4000, 'substituído');
  p.ws = ws;

  send(ws, { t: 'joined', code: room.code, pid, index: p.index, game: room.game, screen: isOpen(room.screen) });
  if (!p.announced) {
    p.announced = true;
    send(room.screen, { t: 'ctrl-join', pid, index: p.index, count: room.players.size, players: playerList(room) });
    console.log(`[sala ${room.code}] jogador ${p.index + 1} entrou`);
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    msg.pid = pid;
    msg.index = p.index;
    send(room.screen, msg);
  });

  ws.on('close', () => {
    if (p.ws !== ws) return; // reconectou por outra conexão
    p.ws = null;
    p.leaveTimer = setTimeout(() => {
      room.players.delete(pid);
      send(room.screen, { t: 'ctrl-leave', pid, index: p.index, count: room.players.size, players: playerList(room) });
      console.log(`[sala ${room.code}] jogador ${p.index + 1} saiu`);
    }, PLAYER_GRACE_MS);
  });
}

// Derruba conexões mortas (ex.: celular bloqueou a tela)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const games = listGames();
  console.log('');
  console.log('  🕹️  FLIPERAMA rodando!');
  console.log('');
  console.log(`  Abra no PC/TV:      http://localhost:${PORT}`);
  console.log(`  Celular (QR code):  ${PUBLIC_URL}`);
  if (secureServer) console.log(`  HTTPS ativo:        https://localhost:${HTTPS_PORT}`);
  else if (!PUBLIC_URL.startsWith('https:')) console.log('  ⚠  Sem HTTPS: o app do controle não instala e a câmera não lê QR (veja o README).');
  console.log(`  Jogos instalados:   ${games.map((g) => g.name).join(', ') || 'nenhum'}`);
  console.log('');
  if (!process.env.PUBLIC_URL) console.log('  O celular precisa estar na MESMA rede Wi-Fi do PC.');
  console.log('');
});
if (secureServer) secureServer.listen(HTTPS_PORT, '0.0.0.0');
