const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const net = require("net");

// Fija el nombre de la aplicación ANTES de que se resuelva el userData.
// Sin esto, al lanzar con `electron .` Electron usa "Electron" como carpeta de datos.
app.setName("POSsystem pro");

// ---------------------------------------------------------------------------
// ALMACENAMIENTO: archivo SQLite .db real en disco.
// Se usa sql.js (SQLite compilado a WASM): corre en el proceso main sin
// necesidad de compilar binarios nativos (mejor-sqlite3 necesitaba rebuild
// por ABI y no había toolchain). El contenido del sistema se guarda en una
// tabla kv (JSON) y todo el archivo .db se persiste en disco.
// ---------------------------------------------------------------------------
let SQL = null;          // constructor sql.js (inicializado de forma perezosa)
const DB_KEY = "db";

function getDbPath() {
  const p = path.join(app.getPath("userData"), "pos_sistema.db");
  return p;
}

// Carga sql.js (WASM) una sola vez.
function sqlReady() {
  if (SQL) return Promise.resolve(SQL);
  return require("sql.js")().then(S => { SQL = S; return S; });
}

async function dbExists() {
  try { await fs.access(getDbPath()); return true; } catch (e) { return false; }
}

// Lee el snapshot (JSON) desde el .db. Devuelve null si no existe.
async function sqliteLoad() {
  try {
    if (!await dbExists()) return null;
    const INFO_SQL = "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)";
    const buf = await fs.readFile(getDbPath());
    const S = await sqlReady();
    const db = new S.Database(new Uint8Array(buf));
    db.exec(INFO_SQL);
    const r = db.exec("SELECT value FROM kv WHERE key = ?", [DB_KEY]);
    db.close();
    if (!r.length || !r[0].values.length) return null;
    return JSON.parse(r[0].values[0][0]);
  } catch (e) {
    console.error("Error leyendo .db:", e);
    return null;
  }
}

// Guarda el snapshot (JSON) en el .db y lo escribe en disco.
async function sqliteSave(data) {
  try {
    if (data === undefined || data === null) return { ok: false, msg: "Datos inválidos" };
    const S = await sqlReady();
    const db = new S.Database();
    db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [DB_KEY, JSON.stringify(data)]);
    const bytes = db.export();
    db.close();
    const dir = path.dirname(getDbPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getDbPath(), Buffer.from(bytes));
    return { ok: true, size: bytes.length };
  } catch (e) {
    console.error("Error escribiendo .db:", e);
    return { ok: false, msg: String(e && e.message || e) };
  }
}

// Copia del archivo .db a la carpeta de respaldos con marca de tiempo.
async function sqliteBackup(label) {
  const src = getDbPath();
  const bkDir = path.join(app.getPath("userData"), "backups");
  try {
    if (!await dbExists()) return { ok: false, msg: "Aún no hay base de datos" };
    await fs.mkdir(bkDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const tag = label ? label.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "-") : "auto";
    const dest = path.join(bkDir, `pos_sistema_${tag}_${ts}.db`);
    await fs.copyFile(src, dest);
    return { ok: true, filePath: dest };
  } catch (e) {
    return { ok: false, msg: String(e && e.message || e) };
  }
}

// Reinicio total: elimina el archivo .db principal y toda la carpeta de respaldos.
async function sqliteClear() {
  try {
    const p = getDbPath();
    if (await dbExists()) await fs.unlink(p);
    // Borrar también los respaldos .db en disco (la carpeta "backups").
    const bkDir = path.join(app.getPath("userData"), "backups");
    try { await fs.rm(bkDir, { recursive: true, force: true }); } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e && e.message || e) };
  }
}

function sqliteStatus() {
  let size = 0;
  const p = getDbPath();
  try { size = fs.statSync(p).size; } catch (e) { size = 0; }
  return {
    ok: true,
    engine: "sql.js (SQLite WASM)",
    path: p,
    exists: size > 0,
    size,
    node: process.versions.node,
    electron: process.versions.electron
  };
}

// ---------------------------------------------------------------------------
// JARVIS: almacenamiento KV genérico dentro del mismo .db (config / memoria /
// índice de conocimiento). No interfiere con el snapshot principal (clave "db").
// ---------------------------------------------------------------------------
async function jarvisKvGet(key) {
  try {
    const buf = await fs.readFile(getDbPath());
    const S = await sqlReady();
    const db = new S.Database(new Uint8Array(buf));
    db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const r = db.exec("SELECT value FROM kv WHERE key = ?", [key]);
    db.close();
    if (!r.length || !r[0].values.length) return null;
    return JSON.parse(r[0].values[0][0]);
  } catch (e) {
    console.error("jarvis kv get", key, e);
    return null;
  }
}

async function jarvisKvSet(key, data) {
  try {
    let db;
    if (await dbExists()) {
      const buf = await fs.readFile(getDbPath());
      const S = await sqlReady();
      db = new S.Database(new Uint8Array(buf));
    } else {
      const S = await sqlReady();
      db = new S.Database();
    }
    db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, JSON.stringify(data)]);
    const bytes = db.export();
    db.close();
    const dir = path.dirname(getDbPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getDbPath(), Buffer.from(bytes));
    return { ok: true, size: bytes.length };
  } catch (e) {
    console.error("jarvis kv set", key, e);
    return { ok: false, msg: String(e && e.message || e) };
  }
}

async function jarvisKvKeys() {
  try {
    if (!await dbExists()) return [];
    const buf = await fs.readFile(getDbPath());
    const S = await sqlReady();
    const db = new S.Database(new Uint8Array(buf));
    db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const r = db.exec("SELECT key FROM kv");
    db.close();
    return r.length ? r[0].values.map(v => v[0]) : [];
  } catch (e) {
    return [];
  }
}

async function jarvisKvDel(key) {
  try {
    if (!await dbExists()) return { ok: true };
    const buf = await fs.readFile(getDbPath());
    const S = await sqlReady();
    const db = new S.Database(new Uint8Array(buf));
    db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("DELETE FROM kv WHERE key = ?", [key]);
    const bytes = db.export();
    db.close();
    await fs.writeFile(getDbPath(), Buffer.from(bytes));
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e && message && e.message || e) };
  }
}

// ---------------------------------------------------------------------------
// JARVIS: exploración del proyecto para el Discovery Engine.
// Lee los archivos fuente del POS (js/css/html) y genera un índice de
// símbolos (funciones, objetos, ventanas) para el conocimiento persistente.
// ---------------------------------------------------------------------------
function jarvisScanProject() {
  const base = path.join(__dirname, "pos");
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {}
    entries.forEach(en => {
      const p = path.join(dir, en.name);
      if (en.isDirectory()) walk(p);
      else if (/\.(js|css|html)$/i.test(en.name)) files.push(p);
    });
  };
  walk(base);
  const alpha = /^[#_$]|^[A-Za-z]/.test.bind(/^[/]/);
  const index = files.map(fp => {
    let content = "";
    try { content = fs.readFileSync(fp, "utf8"); } catch (e) {}
    const rel = path.relative(base, fp).split(path.sep).join("/");
    const funcs = [];
    const reFunc = /\b(?:async\s+)?function\b\s+([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = reFunc.exec(content)) !== null) funcs.push(m[1]);
    const constFns = [];
    const reConst = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/g;
    while ((m = reConst.exec(content)) !== null) constFns.push(m[1]);
    // ventanas HTML referenciadas por id="*-window"
    const windows = [];
    const reWin = /id="([A-Za-z0-9_-]+-window)"/g;
    while ((m = reWin.exec(content)) !== null) windows.push(m[1]);
    return {
      file: rel,
      lines: content.split("\n").length,
      chars: content.length,
      functions: funcs.concat(constFns),
      windows
    };
  });
  return { ok: true, scannedAt: new Date().toISOString(), base, files: index };
}

// ---------------------------------------------------------------------------
// JARVIS: llamadas a APIs de proveedores de IA (server-side para evitar CORS).
// Soporta openrouter, gemini, groq, cerebras y openai con sus modelos gratuitos.
// ---------------------------------------------------------------------------
function jarvisProviderRequest(cfg, model, messages, extra) {
  return new Promise((resolve) => {
    const https = require("https");
    const http = require("http");
    const payload = {
      model,
      messages,
      temperature: (extra && extra.temperature) ?? 0.4,
      max_tokens: (extra && extra.max_tokens) ?? 1200,
      stream: false
    };
    if (extra && extra.tools && extra.tools.length) {
      payload.tools = extra.tools;
      payload.tool_choice = "auto";
    }
    const body = JSON.stringify(payload);

    let url = cfg.base || "";
    let headers = { "Content-Type": "application/json" };
    if (cfg.headerKey && cfg.apiKey) headers[cfg.headerKey] = cfg.apiKey;
    if (cfg.headerValue) headers[cfg.headerValue] = cfg.apiKey;
    if (cfg.provider === "gemini") {
      // Gemini usa ?key= con generativelanguage.googleapis.com
      const glue = url.includes("?") ? "&" : "?";
      url = url + glue + "key=" + (cfg.apiKey || "");
      delete headers[cfg.headerKey];
    }
    let lib = https;
    if (url.startsWith("http://")) lib = http;

    const req = lib.request(url, {
      method: "POST",
      headers: Object.assign(headers, { "Content-Length": Buffer.byteLength(body) })
    }, (res) => {
      let data = "";
      res.on("data", c => { if (data.length < 8 * 1024 * 1024) data += c; });
      res.on("end", () => {
        try { resolve({ ok: true, status: res.statusCode, json: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 2000) }); }
      });
    });
    req.on("error", e => resolve({ ok: false, msg: String(e && e.message || e) }));
    req.setTimeout(90000, () => { req.destroy(); resolve({ ok: false, msg: "Tiempo de espera agotado" }); });
    req.write(body);
    req.end();
  });
}

// Extrae el texto final de una respuesta según el formato de cada proveedor.
function jarvisExtractText(json) {
  try {
    if (json.choices && json.choices[0]) {
      const c = json.choices[0];
      if (c.message && c.message.content) return c.message.content;
      return "";
    }
    if (json.candidates && json.candidates[0]) {
      return (json.candidates[0].content && json.candidates[0].content.parts || [])
        .map(p => p.text || "").join("");
    }
    return "";
  } catch (e) { return ""; }
}

// Convierte la lista de mensajes a la estructura requerida por cada API.
function jarvisAdaptMessages(provider, messages) {
  if (provider === "gemini") {
    // -> [{role:"user"|"model", parts:[{text}]}]
    const out = [];
    messages.forEach(m => {
      const role = m.role === "assistant" ? "model" : (m.role === "system" ? "user" : "user");
      if (m.role === "system") {
        // Antepone el system como primera parte de user si no existe.
        if (out.length && out[out.length - 1].role === "user") {
          out[out.length - 1].parts.unshift({ text: "[SISTEMA: " + (m.content || "") + "]" });
        } else {
          out.push({ role, parts: [{ text: "[SISTEMA: " + (m.content || "") + "]" }] });
        }
      } else {
        if (out.length && out[out.length - 1].role === role) {
          out[out.length - 1].parts.push({ text: m.content || "" });
        } else {
          out.push({ role, parts: [{ text: m.content || "" }] });
        }
      }
    });
    return out;
  }
  return messages;
}

// Configuración predefinida de proveedores gratuitos (base de cada uno).
const JARVIS_PROVIDERS = {
  openrouter: { base: "https://openrouter.ai/api/v1/chat/completions", headerKey: "Authorization", headerValue: null, prefix: "Bearer " },
  openai: { base: "https://api.openai.com/v1/chat/completions", headerKey: "Authorization", headerValue: null, prefix: "Bearer " },
  groq: { base: "https://api.groq.com/openai/v1/chat/completions", headerKey: "Authorization", headerValue: null, prefix: "Bearer " },
  cerebras: { base: "https://api.cerebras.ai/v1/chat/completions", headerKey: "Authorization", headerValue: null, prefix: "Bearer " },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/models/GEMINI_MODEL:generateContent", headerKey: "x-goog-api-key", headerValue: null, prefix: "" }
};

function jarvisNormalizeCfg(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const cp = JARVIS_PROVIDERS[c.provider || "openrouter"] || JARVIS_PROVIDERS.openrouter;
  let base = c.base || cp.base || "";
  if (c.provider === "gemini") base = base.replace("GEMINI_MODEL", c.model || "gemini-2.0-flash");
  let apiKey = c.apiKey || "";
  const headerValue = cp.headerValue
    ? cp.headerValue + " " + apiKey
    : (cp.prefix ? cp.prefix + apiKey : apiKey);
  return {
    provider: c.provider || "openrouter",
    base,
    apiKey,
    model: c.model || "",
    headerKey: cp.headerKey,
    headerValue,
    prefix: cp.prefix
  };
}

async function jarvisAIChat(rawCfg, model, messages, extra) {
  const cfg = jarvisNormalizeCfg(rawCfg);
  if (!cfg.apiKey) return { ok: false, msg: "Sin API key configurada." };
  const finalModel = model || cfg.model;
  if (!finalModel) return { ok: false, msg: "Sin modelo configurado." };
  const payloadCfg = Object.assign({}, cfg, { base: cfg.base });
  const adapted = jarvisAdaptMessages(cfg.provider, messages);
  if (cfg.provider === "gemini") {
    const p = { contents: adapted, generationConfig: { temperature: (extra && extra.temperature) ?? 0.4, maxOutputTokens: (extra && extra.max_tokens) ?? 1200 } };
    let url = cfg.base;
    const glue = url.includes("?") ? "&" : "?";
    url = url + glue + "key=" + encodeURIComponent(cfg.apiKey);
    const https = require("https");
    const body = JSON.stringify(p);
    return new Promise(resolve => {
      const req = https.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, res => {
        let data = "";
        res.on("data", c => { if (data.length < 8 * 1024 * 1024) data += c; });
        res.on("end", () => { try { resolve({ ok: true, status: res.statusCode, json: JSON.parse(data) }); } catch (e) { resolve({ ok: false, status: res.statusCode, raw: data.slice(0, 2000) }); } });
      });
      req.on("error", e => resolve({ ok: false, msg: String(e && e.message || e) }));
      req.setTimeout(90000, () => { req.destroy(); resolve({ ok: false, msg: "Tiempo de espera agotado" }); });
      req.write(body); req.end();
    });
  }
  return jarvisProviderRequest(payloadCfg, finalModel, adapted, extra);
}

// ---------------------------------------------------------------------------
// SERVIDOR HTTP (multi-terminal). Configurable, APAGADO por defecto.
// ---------------------------------------------------------------------------
let httpServer = null;
const DEFAULT_HTTP_PORT = 8753;

function startHttpServer(port) {
  if (httpServer) return { ok: true, port };
  const http = require("http");
  const server = http.createServer((req, res) => {
    const send = (code, payload) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      return res.end();
    }
    try {
      if (req.method === "GET" && req.url === "/api/status") {
        return send(200, { ok: true, service: "pos-network", time: new Date().toISOString(), status: sqliteStatus() });
      }
      if (req.method === "GET" && req.url === "/api/health") {
        return send(200, { ok: true });
      }
      // Baja el snapshot (JSON) para los clientes.
      if (req.method === "GET" && req.url === "/api/db") {
        return sqliteLoad().then(data =>
          send(200, { ok: true, db: data })
        ).catch(() => send(500, { ok: false, msg: "Error leyendo .db" }));
      }
      // Sube el snapshot (JSON) escrito por un cliente.
      if (req.method === "POST" && req.url === "/api/db") {
        let body = "";
        req.on("data", c => { if (body.length < 200 * 1024 * 1024) body += c; });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            return sqliteSave(parsed).then(r => send(r.ok ? 200 : 500, r));
          } catch (e) {
            return send(400, { ok: false, msg: "JSON inválido" });
          }
        });
        return;
      }
      return send(404, { ok: false, msg: "Ruta no encontrada" });
    } catch (e) {
      return send(500, { ok: false, msg: String(e && e.message || e) });
    }
  });
  return new Promise(resolve => {
    server.on("error", e => resolve({ ok: false, msg: String(e && e.message || e) }));
    server.listen(port, "0.0.0.0", () => {
      httpServer = server;
      console.log("Servidor red POS activo en puerto", port);
      resolve({ ok: true, port });
    });
  });
}

function ensureHttp(port) {
  if (httpServer) return Promise.resolve({ ok: true, port });
  return startHttpServer(port || DEFAULT_HTTP_PORT);
}

// ---------------------------------------------------------------------------
// VENTANA
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "pos", "index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle("pdf-export", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const titulo = (payload && payload.titulo) || "Documento";
  const html = payload && payload.html;
  if (typeof html !== "string" || !html.trim()) {
    return { ok: false, msg: "Sin contenido para exportar." };
  }
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pdfWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const pdf = await pdfWin.webContents.printToPDF({ printBackground: true });
    const safe = (String(titulo).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80)) || "documento";
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: safe + ".pdf",
      filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
    });
    if (canceled || !filePath) return { ok: false, msg: "Operación cancelada." };
    await fs.writeFile(filePath, pdf);
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, msg: "Error al generar el PDF: " + String(e && e.message || e) };
  } finally {
    pdfWin.destroy();
  }
});

ipcMain.handle("sqlite-load", () => sqliteLoad());
ipcMain.handle("sqlite-save", (_e, data) => sqliteSave(data));
ipcMain.handle("sqlite-backup", (_e, label) => sqliteBackup(label || "manual"));
ipcMain.handle("sqlite-clear", () => sqliteClear());
ipcMain.handle("sqlite-status", () => sqliteStatus());
ipcMain.handle("net-start", (_e, port) => {
  // Agarra el puerto libre si uno está en uso.
  return ensureHttp(port || DEFAULT_HTTP_PORT);
});
ipcMain.handle("net-stop", () => {
  if (httpServer) {
    try { httpServer.close(); } catch (e) {}
    httpServer = null;
  }
  return { running: false, port: 0 };
});
ipcMain.handle("net-status", () => {
  let ip = [];
  const os = require("os");
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(iface => {
      if (iface.family === "IPv4" && !iface.internal) ip.push(iface.address);
    });
  });
  return { running: !!httpServer, port: httpServer ? httpServer.address().port : 0, ip };
});

// JARVIS
ipcMain.handle("jarvis-kv-get", (_e, key) => jarvisKvGet(key));
ipcMain.handle("jarvis-kv-set", (_e, key, data) => jarvisKvSet(key, data));
ipcMain.handle("jarvis-kv-keys", () => jarvisKvKeys());
ipcMain.handle("jarvis-kv-del", (_e, key) => jarvisKvDel(key));
ipcMain.handle("jarvis-scan", () => jarvisScanProject());
ipcMain.handle("jarvis-ai", (_e, cfg, model, messages, extra) => jarvisAIChat(cfg, model, messages, extra));

// ---------------------------------------------------------------------------
// CICLO DE VIDA
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Al cerrar la app se cierra el servidor de red si estuviera activo.
app.on("before-quit", () => {
  if (httpServer) { try { httpServer.close(); } catch (e) {} }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});