'use strict';
// =====================================================================
//  Consoles suportados pelas ROMs importadas (emulador: EmulatorJS).
//  Usado pela galeria (detectar o sistema), pela tela do emulador e pelo
//  controle do celular (desenhar os botões certos de cada console).
//
//  Os números dos botões são os índices do "RetroPad" do EmulatorJS:
//   0 B · 1 Y · 2 SELECT · 3 START · 4-7 ↑↓←→ · 8 A · 9 X · 10 L · 11 R
//   12 L2 · 13 R2 · 16-19 analógico esq. (→ ← ↓ ↑) · 20-23 analógico dir.
//
//  pad = {
//    face:  grupos de botões da direita, de cima para baixo
//           { diamond: [cima, esquerda, direita, baixo] } ou { row: [...] }
//    sh:    botões de ombro (cantos de cima)
//    mid:   botões do meio (SELECT/START...)
//    stick: true = o direcional controla o analógico (N64)
//  }
// =====================================================================
(function () {
  const B = (id, l, c) => ({ id, l, c });
  const SELECT = B(2, 'SELECT'), START = B(3, 'START');

  const SYSTEMS = {
    nes: {
      name: 'Nintendo (NES)', short: 'NES', core: 'nes', icon: '🍄', color: '#c62828', players: 2,
      ext: ['nes', 'fds', 'unf', 'unif'],
      pad: { face: [{ row: [B(0, 'B', '#e53935'), B(8, 'A', '#e53935')] }], mid: [SELECT, START] },
    },
    snes: {
      name: 'Super Nintendo', short: 'SNES', core: 'snes', icon: '🎮', color: '#6a4bc4', players: 2,
      ext: ['sfc', 'smc', 'fig', 'swc', 'bs'],
      pad: {
        face: [{ diamond: [B(9, 'X', '#1e88e5'), B(1, 'Y', '#43a047'), B(8, 'A', '#e53935'), B(0, 'B', '#fdd835')] }],
        sh: [B(10, 'L'), B(11, 'R')], mid: [SELECT, START],
      },
    },
    gb: {
      name: 'Game Boy', short: 'GB', core: 'gb', icon: '🟩', color: '#7a8b2c', players: 1,
      ext: ['gb'],
      pad: { face: [{ row: [B(0, 'B', '#9c2a5a'), B(8, 'A', '#9c2a5a')] }], mid: [SELECT, START] },
    },
    gbc: {
      name: 'Game Boy Color', short: 'GBC', core: 'gb', icon: '🟪', color: '#7b1fa2', players: 1,
      ext: ['gbc'],
      pad: { face: [{ row: [B(0, 'B', '#9c2a5a'), B(8, 'A', '#9c2a5a')] }], mid: [SELECT, START] },
    },
    gba: {
      name: 'Game Boy Advance', short: 'GBA', core: 'gba', icon: '👾', color: '#3949ab', players: 1,
      ext: ['gba'],
      pad: { face: [{ row: [B(0, 'B', '#5c6bc0'), B(8, 'A', '#5c6bc0')] }], sh: [B(10, 'L'), B(11, 'R')], mid: [SELECT, START] },
    },
    n64: {
      name: 'Nintendo 64', short: 'N64', core: 'n64', icon: '⭐', color: '#2e7d32', players: 4, stick: true,
      ext: ['n64', 'z64', 'v64'],
      pad: {
        face: [
          { diamond: [B(23, 'C▲', '#fdd835'), B(21, 'C◀', '#fdd835'), B(20, 'C▶', '#fdd835'), B(22, 'C▼', '#fdd835')], small: true },
          { row: [B(1, 'B', '#43a047'), B(0, 'A', '#1e88e5')] },
        ],
        sh: [B(10, 'L'), B(12, 'Z'), B(11, 'R')], mid: [START],
      },
    },
    nds: {
      name: 'Nintendo DS', short: 'NDS', core: 'nds', icon: '📖', color: '#546e7a', players: 1,
      ext: ['nds'],
      pad: {
        face: [{ diamond: [B(9, 'X'), B(1, 'Y'), B(8, 'A'), B(0, 'B')] }],
        sh: [B(10, 'L'), B(11, 'R')], mid: [SELECT, START],
      },
    },
    segaMD: {
      name: 'Mega Drive', short: 'MEGA DRIVE', core: 'segaMD', icon: '🦔', color: '#1565c0', players: 2,
      ext: ['md', 'gen', 'smd', '68k', 'sgd'],
      pad: {
        face: [
          { row: [B(10, 'X', '#546e7a'), B(9, 'Y', '#546e7a'), B(11, 'Z', '#546e7a')], small: true },
          { row: [B(1, 'A', '#263238'), B(0, 'B', '#263238'), B(8, 'C', '#263238')] },
        ],
        mid: [B(2, 'MODE'), START],
      },
    },
    segaMS: {
      name: 'Master System', short: 'MASTER', core: 'segaMS', icon: '🔴', color: '#b71c1c', players: 2,
      ext: ['sms'],
      pad: { face: [{ row: [B(0, '1', '#424242'), B(8, '2', '#424242')] }], mid: [B(3, 'PAUSE')] },
    },
    segaGG: {
      name: 'Game Gear', short: 'GAME GEAR', core: 'segaGG', icon: '🔋', color: '#37474f', players: 1,
      ext: ['gg'],
      pad: { face: [{ row: [B(0, '1', '#1e88e5'), B(8, '2', '#1e88e5')] }], mid: [START] },
    },
    pce: {
      name: 'PC Engine', short: 'PC ENGINE', core: 'pce', icon: '💿', color: '#ef6c00', players: 1,
      ext: ['pce', 'sgx'],
      pad: { face: [{ row: [B(0, 'II', '#424242'), B(8, 'I', '#424242')] }], mid: [SELECT, B(3, 'RUN')] },
    },
    psx: {
      name: 'PlayStation', short: 'PS1', core: 'psx', icon: '💽', color: '#455a64', players: 2,
      ext: ['cue', 'chd', 'pbp', 'm3u', 'ccd', 'img', 'mdf', 'ecm'],
      pad: {
        face: [{ diamond: [B(9, '△', '#26a69a'), B(1, '□', '#ec407a'), B(8, '○', '#ef5350'), B(0, '✕', '#5c6bc0')] }],
        sh: [B(12, 'L2'), B(10, 'L1'), B(11, 'R1'), B(13, 'R2')], mid: [SELECT, START],
      },
    },
    arcade: {
      name: 'Fliperama (FBNeo)', short: 'ARCADE', core: 'arcade', icon: '🕹️', color: '#ad1457', players: 2,
      ext: ['zip', '7z'],
      pad: {
        face: [
          { row: [B(1, 'Y', '#1e88e5'), B(9, 'X', '#1e88e5'), B(10, 'L', '#1e88e5')] },
          { row: [B(0, 'B', '#e53935'), B(8, 'A', '#e53935'), B(11, 'R', '#e53935')] },
        ],
        mid: [B(2, 'FICHA'), START],
      },
    },
    atari2600: {
      name: 'Atari 2600', short: 'ATARI', core: 'atari2600', icon: '🕹️', color: '#6d4c41', players: 2,
      ext: ['a26'],
      pad: { face: [{ row: [B(0, 'FOGO', '#c62828')] }], mid: [SELECT, B(3, 'RESET')] },
    },
    atari7800: {
      name: 'Atari 7800', short: 'ATARI 7800', core: 'atari7800', icon: '🕹️', color: '#4e342e', players: 2,
      ext: ['a78'],
      pad: { face: [{ row: [B(0, '1', '#c62828'), B(8, '2', '#c62828')] }], mid: [SELECT, START] },
    },
  };

  // .bin e .iso servem para vários consoles: arquivos grandes são CD (PS1)
  const CD_MIN = 12 * 1024 * 1024;

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function byExt(ext) {
    return Object.keys(SYSTEMS).find((k) => SYSTEMS[k].ext.includes(ext)) || null;
  }

  // Lê os nomes dos arquivos dentro de um .zip (diretório central, sem descompactar)
  async function zipEntries(file) {
    try {
      const tailSize = Math.min(file.size, 65536 + 22);
      const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
      let eocd = -1;
      for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      if (eocd < 0) return [];
      const count = tail.getUint16(eocd + 10, true);
      const cdSize = tail.getUint32(eocd + 12, true);
      const cdOff = tail.getUint32(eocd + 16, true);
      const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
      const names = [];
      const dec = new TextDecoder();
      for (let p = 0, n = 0; n < count && p + 46 <= cd.byteLength; n++) {
        if (cd.getUint32(p, true) !== 0x02014b50) break;
        const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
        names.push(dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl)));
        p += 46 + nl + xl + cl;
      }
      return names;
    } catch { return []; }
  }

  // Descobre o console de um arquivo. Retorna o id do sistema ou null.
  async function detect(file) {
    const ext = extOf(file.name);
    if (ext === 'bin' || ext === 'iso') return file.size >= CD_MIN ? 'psx' : (ext === 'bin' ? 'segaMD' : 'psx');
    if (ext === 'zip') {
      // .zip com uma ROM de console dentro (ex.: mario.nes) -> aquele console.
      // ROMs de fliperama são zips com vários chips (muitos também em .bin).
      const files = (await zipEntries(file)).filter((n) => !n.endsWith('/'));
      const exts = files.map(extOf);
      if (exts.includes('cue') || exts.includes('chd')) return 'psx';
      for (const e of exts) {
        const s = byExt(e);
        if (s && s !== 'arcade') return s;
      }
      if (files.length === 1 && (exts[0] === 'bin' || exts[0] === 'iso')) return file.size >= CD_MIN / 2 ? 'psx' : 'segaMD';
      return 'arcade';
    }
    return byExt(ext);
  }

  // "Super Mario World (USA) [!].sfc" -> "Super Mario World"
  function cleanName(fileName) {
    let n = String(fileName).replace(/\.[a-z0-9]+$/i, '');
    n = n.replace(/[_]+/g, ' ').replace(/\s*[[(][^\])]*[\])]/g, '').replace(/\s{2,}/g, ' ').trim();
    return n || String(fileName);
  }

  const ACCEPT = [...new Set(Object.values(SYSTEMS).flatMap((s) => s.ext).concat(['bin', 'iso']))].map((e) => '.' + e).join(',');

  window.RetroSystems = { SYSTEMS, detect, cleanName, extOf, ACCEPT };
})();
