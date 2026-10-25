'use strict';
// =====================================================================
//  Biblioteca de ROMs importadas — fica no navegador da TELA (IndexedDB).
//  Nada é enviado para o servidor: cada PC/TV tem a sua coleção.
//
//  RomLibrary.list()                  -> [{ id, name, fileName, size, system, addedAt, playedAt, hasCover }]
//  RomLibrary.add(file, system)       -> meta (mesmo arquivo de novo = atualiza)
//  RomLibrary.get(id)                 -> meta
//  RomLibrary.file(id)                -> File (com o nome original, o emulador usa a extensão)
//  RomLibrary.update(id, patch)       -> meta
//  RomLibrary.remove(id)
//  RomLibrary.cover(id) / setCover(id, blob)
//  RomLibrary.state(id) / setState(id, bytes)   -> estado salvo (save state)
// =====================================================================
(function () {
  const DB = 'psbox-roms';
  const STORES = ['meta', 'files', 'covers', 'states'];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transação cancelada'));
    });
  }
  const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  // id estável: o mesmo arquivo importado de novo substitui o antigo
  function makeId(file) {
    let h = 2166136261;
    for (const ch of `${file.name}|${file.size}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'r' + (h >>> 0).toString(36);
  }

  const api = {
    async list() {
      const all = await tx('meta', 'readonly', (s) => req2p(s.getAll()));
      return (all || []).sort((a, b) => a.name.localeCompare(b.name));
    },
    get: (id) => tx('meta', 'readonly', (s) => req2p(s.get(id))),
    async add(file, system) {
      const id = makeId(file);
      const old = await api.get(id);
      const meta = {
        id,
        name: old ? old.name : RetroSystems.cleanName(file.name),
        fileName: file.name,
        size: file.size,
        system,
        addedAt: old ? old.addedAt : Date.now(),
        playedAt: old ? old.playedAt : 0,
        hasCover: old ? old.hasCover : false,
      };
      // Blob puro (um File de <input> nem sempre sobrevive ao IndexedDB no Safari)
      const blob = new Blob([file], { type: 'application/octet-stream' });
      await tx(['meta', 'files'], 'readwrite', (m, f) => { m.put(meta, id); f.put(blob, id); });
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ok */ }
      return meta;
    },
    async update(id, patch) {
      const meta = { ...(await api.get(id)), ...patch, id };
      await tx('meta', 'readwrite', (s) => { s.put(meta, id); });
      return meta;
    },
    async file(id) {
      const meta = await api.get(id);
      if (!meta) return null;
      const blob = await tx('files', 'readonly', (s) => req2p(s.get(id)));
      return blob ? new File([blob], meta.fileName, { type: 'application/octet-stream' }) : null;
    },
    remove: (id) => tx(STORES, 'readwrite', (...stores) => { for (const s of stores) s.delete(id); }),
    cover: (id) => tx('covers', 'readonly', (s) => req2p(s.get(id))),
    async setCover(id, blob) {
      await tx('covers', 'readwrite', (s) => { s.put(blob, id); });
      await api.update(id, { hasCover: true });
    },
    state: (id) => tx('states', 'readonly', (s) => req2p(s.get(id))),
    setState: (id, bytes) => tx('states', 'readwrite', (s) => { s.put({ data: bytes, at: Date.now() }, id); }),
    async usage() {
      try { return await navigator.storage.estimate(); } catch { return null; }
    },
  };

  window.RomLibrary = api;
})();
