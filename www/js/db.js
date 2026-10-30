/* IndexedDB wrapper: library items, saved story project, key/value. window.DB */
(function () {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ai-studio', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  const DB = {
    putItem: it => tx('items', 'readwrite', s => s.put(it)),
    delItem: id => tx('items', 'readwrite', s => s.delete(id)),
    getItem: id => tx('items', 'readonly', s => s.get(id)),
    allItems: () => tx('items', 'readonly', s => s.getAll()).then(a => a.sort((x, y) => y.created - x.created)),
    clearItems: () => tx('items', 'readwrite', s => s.clear()),
    kvSet: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
    kvGet: k => tx('kv', 'readonly', s => s.get(k)),
  };

  DB.addItem = async ({ type, blob, prompt = '', meta = {} }) => {
    const it = { id: U.uid(), type, blob, prompt, meta, created: Date.now() };
    await DB.putItem(it);
    return it;
  };

  window.DB = DB;
})();
