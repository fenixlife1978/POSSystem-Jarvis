// ============================================================================
// ALMACENAMIENTO: Backend inteligente
//  - En Electron: SQLite local (proceso main vía IPC) -> archivo .db real.
//  - En navegador: IndexedDB (principal) con espejo localStorage de arranque.
// El renderer mantiene DB en memoria; aquí solo se persiste el snapshot.
// ============================================================================
const Storage = (() => {
  const DB_NAME = "pos_sistema_db";
  const DB_VERSION = 1;
  const STORE_DATA = "datos";      // claves: "db" -> objeto DB completo
  const STORE_BK = "respaldos";    // claves: id de respaldo -> snapshot

  let dbPromise = null;
  let _server = "";            // IP LAN del servidor principal (modo cliente)
  let _hybrid = false;         // modo híbrido: operar offline y fusionar al reconectar
  let _online = null;          // último estado de conexión conocido
  let _heartbeat = null;       // temporizador de detección
  const SERVER_PORT = 8753;
  const SERVER_KEY = "_pos_server_ip";
  const HYBRID_KEY = "_pos_hybrid";
  const CACHE_KEY = "_pos_hybrid_cache";   // caché local del híbrido (IndexedDB)

  // Colecciones que se fusionan por campo id al sincronizar (por módulo).
  const MERGE_COLLECTIONS = [
    ["productos", "id"], ["clientes", "id"], ["ventas", "id"], ["devoluciones", "id"],
    ["abonos", "id"], ["cuentasCobrar", "id"], ["cuentasPagar", "id"], ["pagosPagar", "id"],
    ["libroDiario", "id"], ["movimientosInv", "id"], ["movimientosCaja", "id"],
    ["auditoria", "id"], ["respaldos", "id"], ["ordenesTaller", "id"], ["cierresCaja", "id"],
    ["proveedores", "id"], ["maestroProveedores", "id"], ["cajas", "id"]
  ];

  // Indica si corre dentro de Electron con el backend SQLite disponible.
  function sqliteBackend() {
    return !!(window.desktop && window.desktop.sqlite && window.desktop.sqlite.save);
  }

  // -------------------------------------------------------------------------
  // Modo híbrido
  // -------------------------------------------------------------------------
  function serverAddress() {
    if (_server) return _server;
    try { _server = window.localStorage.getItem(SERVER_KEY) || ""; } catch (e) {}
    return _server;
  }
  // Permite fijar/limpiar la IP del servidor (llamado desde Configuración/al cargar DB).
  function setServer(ip) {
    _server = (ip || "").trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/+$/, "");
    try {
      if (_server) window.localStorage.setItem(SERVER_KEY, _server);
      else window.localStorage.removeItem(SERVER_KEY);
    } catch (e) {}
    return _server;
  }
  function serverUrl() {
    const ip = serverAddress();
    return ip ? `http://${ip}:${SERVER_PORT}` : "";
  }
  // Modo cliente puro: usa el servidor remoto (sin caché/fusión).
  function remoteBackend() {
    return !!serverUrl();
  }
  function setHybrid(on) {
    _hybrid = !!on;
    try {
      if (_hybrid) window.localStorage.setItem(HYBRID_KEY, "1");
      else window.localStorage.removeItem(HYBRID_KEY);
    } catch (e) {}
    updateHeartbeat();
    return _hybrid;
  }
  function hybridEnabled() {
    if (!_hybrid) { try { _hybrid = window.localStorage.getItem(HYBRID_KEY) === "1"; } catch (e) {} }
    return _hybrid && remoteBackend();
  }
  function isOnline() { return _online !== false; }

  function updateHeartbeat() {
    if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
    if (!hybridEnabled()) return;
    _heartbeat = setInterval(() => checkConnection(), 8000);
    checkConnection();
  }

  // Comprueba si el servidor responde y, al (re)conectar, dispara la sincronización.
  async function checkConnection() {
    if (!hybridEnabled()) return;
    let reachable = false;
    try { reachable = !!(await remoteStatus()).ok; }
    catch (e) { reachable = false; }
    const wasOnline = _online;
    _online = reachable;
    if (reachable && wasOnline === false) {
      console.log("[híbrido] Conexión recuperada, sincronizando...");
      await syncNow();
    }
  }

  // Lee la caché local (lo último confirmado + cambios offline pendientes).
  async function readCache() {
    try { return await idb(STORE_DATA, "readonly", s => reqToPromise(s.get(CACHE_KEY))); }
    catch (e) { return null; }
  }
  async function writeCache(db) {
    try {
      await idb(STORE_DATA, "readwrite", s => reqToPromise(s.put(db, CACHE_KEY)));
      return true;
    } catch (e) { return false; }
  }

  // Fusión por módulo: une cada colección por su campo id, conservando registros de ambos lados.
  // Regla de conflicto para el mismo id:
  //  - si el registro local tiene marca de modificación offline más reciente, gana el local;
  //  - si el remoto la tiene más reciente, gana el remoto;
  //  - sin marcas, gana el local (preservar el trabajo reciente de esta caja).
  function mergeByModule(local, remote) {
    if (!remote || typeof remote !== "object") return local;
    const out = {};
    Object.keys(local).forEach(k => { out[k] = local[k]; });
    MERGE_COLLECTIONS.forEach(([col, idKey]) => {
      const lArr = Array.isArray(local[col]) ? local[col] : [];
      const rArr = Array.isArray(remote[col]) ? remote[col] : [];
      if (!lArr.length && !rArr.length) return;
      const map = new Map();
      lArr.forEach(rec => map.set(String(rec[idKey] ?? rec._mergeId ?? JSON.stringify(rec)), { rec, src: "local" }));
      rArr.forEach(rec => {
        const key = String(rec[idKey] ?? rec._mergeId ?? JSON.stringify(rec));
        const existing = map.get(key);
        if (!existing) { map.set(key, { rec, src: "remote" }); return; }
        // Conflicto del mismo registro: decidir por marca de modificación.
        const lTs = Number(existing.rec._modTs || 0);
        const rTs = Number(rec._modTs || 0);
        if (rTs > lTs) map.set(key, { rec, src: "remote" });
        // si lTs >= rTs se conserva el local (default).
      });
      out[col] = Array.from(map.values()).map(x => x.rec);
    });
    // Claves no-collección (parametros, caja, carrito...): gana el remoto si la local está vacía/scalar reciente.
    Object.keys(remote).forEach(k => {
      if ((out[k] === undefined || out[k] === null || out[k] === "") && remote[k] !== undefined) out[k] = remote[k];
    });
    return out;
  }

  // Sincroniza: baja la versión del servidor, la fusiona con la local (pendiente) y sube el resultado.
  async function syncNow() {
    if (!hybridEnabled()) return { ok: false, merged: null };
    let remoteDb = null;
    try { remoteDb = await remoteLoad(); } catch (e) { remoteDb = null; }
    const localDb = await readCache();
    if (!localDb && !remoteDb) return { ok: false, merged: null };
    const merged = mergeByModule(localDb || {}, remoteDb || {});
    merged._lastSync = new Date().toISOString();
    await writeCache(merged);
    let pushed = false;
    try { pushed = await remoteSave(merged); } catch (e) { pushed = false; }
    _online = pushed || !!remoteDb;
    return { ok: pushed || !!remoteDb, merged, pushed };
  }

  // Dispara una sincronización manual (botón / arranque).
  function sync() { return syncNow(); }

  function open() {
    if (dbPromise) return dbPromise;
    if (!window.indexedDB) return Promise.reject(new Error("IndexedDB no disponible"));
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DATA)) db.createObjectStore(STORE_DATA);
        if (!db.objectStoreNames.contains(STORE_BK)) db.createObjectStore(STORE_BK);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Error abriendo IndexedDB"));
      req.onblocked = () => console.warn("IndexedDB abierta en otra pestaña; espere...");
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Cliente HTTP hacia el servidor principal (modo multi-terminal) ---
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function remoteLoad() {
    if (!remoteBackend()) return null;
    const data = await fetchJson(serverUrl() + "/api/db", { method: "GET" });
    return data && data.ok ? data.db : null;
  }

  async function remoteSave(value) {
    if (!remoteBackend()) return false;
    const r = await fetchJson(serverUrl() + "/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    return !!(r && r.ok);
  }

  async function remoteStatus() {
    const st = await fetchJson(serverUrl() + "/api/status", { method: "GET" });
    return { engine: "servidor-red", server: serverAddress(), port: SERVER_PORT, ok: !!st.ok, status: st.status || {} };
  }

  function idb(storeName, mode, op) {
    return open().then(db => new Promise((resolve, reject) => {
      let tx = null;
      try { tx = db.transaction(storeName, mode); } catch (e) { reject(e); return; }
      const store = tx.objectStore(storeName);
      let settled = false;
      try {
        Promise.resolve(op(store))
          .then(v => { settled = true; resolve(v); })
          .catch(e => { settled = true; reject(e); });
      } catch (e) { settled = true; reject(e); }
      tx.onerror = () => { if (!settled) reject(tx.error); };
      tx.onabort = () => { if (!settled) reject(tx.error || new Error("Transacción abortada")); };
    }));
  }

  // -------------------------------------------------------------------------
  // Guardar/Loader del snapshot principal ("db").
  // Orden de prioridad: servidor-red (si hay IP) → SQLite local → IndexedDB.
  // -------------------------------------------------------------------------
  function save(key, value, storeName) {
    // Snapshot principal ("db") en modo híbrido → intentar servidor, si falla guardar local (pendiente).
    if (key === "db" && storeName === undefined && hybridEnabled()) {
      _online = null; // forzar re-chequeo
      return remoteSave(value).then(ok => {
        if (ok) { _online = true; writeCache(value); return true; }
        _online = false;
        writeCache(value);
        console.warn("[híbrido] Sin servidor, guardado local (pendiente de sincronizar)");
        return true; // operación "exitosa" localmente aunque offline
      }).catch(async () => {
        _online = false;
        await writeCache(value);
        console.warn("[híbrido] Sin servidor, guardado local (pendiente de sincronizar)");
        return true;
      });
    }
    // Snapshot principal ("db") en modo cliente → servidor remoto.
    if (key === "db" && storeName === undefined && remoteBackend()) {
      return remoteSave(value).then(ok => {
        if (ok) { _online = true; writeCache(value); return true; }
        _online = false;
        writeCache(value);
        console.warn("[cliente] Sin servidor, guardado local (pendiente de sincronizar)");
        return true;
      }).catch(e => {
        console.error("Error guardando en servidor:", e);
        _online = false;
        writeCache(value);
        return true; // no perder el dato: se conserva en caché local
      });
    }
    // Snapshot principal ("db") en Electron → SQLite local.
    if (key === "db" && storeName === undefined && sqliteBackend()) {
      return window.desktop.sqlite.save(value).then(r => !!r && r.ok !== false)
        .catch(e => { console.error("Error guardando en SQLite:", e); return fallbackSave(key, value); });
    }
    return fallbackSave(key, value, storeName);
  }

  function fallbackSave(key, value, storeName) {
    const snap = JSON.parse(JSON.stringify(value));
    return idb(storeName || STORE_DATA, "readwrite", store =>
      reqToPromise(store.put(snap, key)).then(() => true)
    ).catch(e => { console.error("Error guardando en IndexedDB:", e); return false; });
  }

  function load(key, storeName) {
    // Snapshot principal en modo híbrido: leer caché local y, si el servidor responde, fusionar.
    if (key === "db" && storeName === undefined && hybridEnabled()) {
      return loadHybrid();
    }
    // Snapshot principal en modo cliente → servidor remoto.
    if (key === "db" && storeName === undefined && remoteBackend()) {
      return remoteLoad().then(saved => saved || null)
        .catch(e => { console.error("Error leyendo del servidor:", e); return null; });
    }
    // Snapshot principal en Electron → SQLite local.
    if (key === "db" && storeName === undefined && sqliteBackend()) {
      let fromSqlite = false;
      return window.desktop.sqlite.load().then(saved => {
        if (saved) { fromSqlite = true; return saved; }
        return fallbackLoad(key, storeName, fromSqlite);
      });
    }
    return fallbackLoad(key, storeName, false);
  }

  // Carga híbrida: usa la caché local como base (para operar de inmediato aun offline),
  // e intenta traer el servidor para fusionarlo (trayendo lo que las otras cajas hicieron).
  async function loadHybrid() {
    const localDb = await readCache();
    // Si el servidor responde, traer y fusionar; si no, devolver la caché local.
    let remoteDb = null;
    try { remoteDb = await remoteLoad(); } catch (e) { remoteDb = null; }
    if (remoteDb) _online = true; else _online = false;
    const base = mergeByModule(localDb || {}, remoteDb || {});
    if (!localDb && remoteDb) await writeCache(base);
    return base || null;
  }

  function fallbackLoad(key, storeName, useSqliteNext) {
    return idb(storeName || STORE_DATA, "readonly", store =>
      reqToPromise(store.get(key))
    ).catch(e => { console.error("Error leyendo de IndexedDB:", e); return null; });
  }

  function remove(key, storeName) {
    return idb(storeName || STORE_DATA, "readwrite", store =>
      reqToPromise(store.delete(key)).then(() => true)
    ).catch(() => false);
  }

  // Limpieza total del almacenamiento local (SQLite vía main.js, caché híbrida,
  // snapshot, IndexedDB y respaldos). Borra TODO: se usa en el reinicio total.
  function clearLocalPersist() {
    return Promise.all([
      // Snapshot principal + caché híbrida
      idb(STORE_DATA, "readwrite", store =>
        Promise.all([
          reqToPromise(store.delete("db")),
          reqToPromise(store.delete(CACHE_KEY))
        ]).then(() => true)
      ).catch(() => false),
      // Respaldos en IndexedDB (STORE_BK) — se limpian en el reinicio total.
      idb(STORE_BK, "readwrite", store =>
        reqToPromise(store.clear()).then(() => true)
      ).catch(() => false)
    ]);
  }

  // Migra respaldos guardados antes en localStorage hacia IndexedDB (una sola vez).
  function migrateLegacyBackups(prefix) {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) keys.push(k);
    }
    if (!keys.length) return Promise.resolve(0);
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BK, "readwrite");
      const store = tx.objectStore(STORE_BK);
      let count = 0;
      keys.forEach(k => {
        try {
          const snap = JSON.parse(window.localStorage.getItem(k));
          store.put(snap, k.replace(prefix, ""));
          window.localStorage.removeItem(k);
          count++;
        } catch (e) { console.warn("Respaldo heredado no migrado:", k, e); }
      });
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transacción abortada"));
    }));
  }

  // -------------------------------------------------------------------------
  // API de respaldos via SQLite (copia del archivo .db) en Electron.
  // -------------------------------------------------------------------------
  function backup(label) {
    if (sqliteBackend()) {
      return window.desktop.sqlite.backup(label || "manual").then(r => {
        if (r && r.ok) r.path = r.filePath || r.path;
        return r || { ok: false };
      }).catch(() => ({ ok: false }));
    }
    return Promise.resolve({ ok: false, msg: "Solo disponible en Electron con SQLite" });
  }

  function status() {
    if (hybridEnabled()) {
      return Promise.resolve({ engine: "híbrido", server: serverAddress(), port: SERVER_PORT, online: _online !== false });
    }
    if (remoteBackend()) {
      return remoteStatus().catch(() => ({ engine: "servidor-red", server: serverAddress(), reachable: false }));
    }
    if (sqliteBackend()) {
      return window.desktop.sqlite.status().then(r => {
        if (r && r.ok) r.engine = "sqlite";
        return r || {};
      }).catch(() => ({}));
    }
    return Promise.resolve({ engine: "indexeddb" });
  }

  return {
    isSupported: () => !!window.indexedDB || sqliteBackend() || remoteBackend(),
    isSqlite: sqliteBackend,
    setServer,
    serverAddress,
    setHybrid,
    hybridEnabled,
    isOnline,
    sync,
    save,
    load,
    remove,
    clearLocalPersist,
    saveBackup: (id, snap) => save(id, snap, STORE_BK),
    getBackup: id => load(id, STORE_BK),
    removeBackup: id => remove(id, STORE_BK),
    migrateLegacyBackups,
    backup,
    status
  };
})();