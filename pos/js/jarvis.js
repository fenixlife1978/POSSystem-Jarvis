// =====================================================================
// JARVIS — Agente inteligente del POS
// Capa inteligente permanente sobre el ERP:
//  Discovery Engine, Memoria SQLite, Router de modelos gratuitos,
//  Herramientas ERP (con permisos del sistema), voz y texto.
// =====================================================================
(function () {
  const J = {
    cfg: null,            // configuración persistente
    memoria: [],          // historial de conversación
    index: null,          // índice de conocimiento del proyecto
    proveedores: [],      // modelos gratuitos probables en orden
    pipelineStep: -1,
    ocupado: false,
    rec: null,
    hablando: false
  };
  let CACHE = null;                       // caché semántica en memoria
  const SUSP = new Map();                 // circuit breaker: modelo -> hasta (ms)
  let OFFLINE = null;                     // config de modelos locales (Ollama)

  // Configuración por defecto en memoria (se persiste en SQLite)
  const CFP = "jarvis_config";
  const CPM = "jarvis_memoria";
  const CPK = "jarvis_index";

  // Modelos gratuitos por proveedor (orden de preferencia)
  const FREE_MODELS = {
    openrouter: [
      { model: "meta-llama/llama-3.3-70b-instruct:free", free: true },
      { model: "deepseek/deepseek-r1:free", free: true },
      { model: "qwen/qwen2.5-72b-instruct:free", free: true },
      { model: "mistralai/mistral-7b-instruct:free", free: true }
    ],
    groq: [
      { model: "llama-3.3-70b-versatile", free: false },
      { model: "llama-3.1-8b-instant", free: true }
    ],
    cerebras: [
      { model: "llama-3.3-70b", free: false },
      { model: "llama-3.1-8b", free: true }
    ],
    gemini: [
      { model: "gemini-2.0-flash", free: true },
      { model: "gemini-2.5-flash", free: true }
    ],
    openai: [
      { model: "gpt-4o-mini", free: false }
    ]
  };

  // ------------------------------------------------------------------
  // Helpers de UI
  // ------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  function elOrb() { return $("jarvis-orb"); }
  function elPanel() { return $("jarvis-panel"); }
  function elChat() { return $("jarvis-chat"); }

  function setOrb(mode) {
    const o = elOrb();
    if (!o) return;
    if (window.jarvisOrb && window.jarvisOrb.setState) window.jarvisOrb.setState(mode || "idle");
    else {
      o.classList.toggle("jarvis-listening", mode === "listening");
      o.classList.toggle("jarvis-thinking", mode === "thinking");
    }
  }

  function addMsg(txt, who) {
    const c = elChat();
    if (!c) return;
    const d = document.createElement("div");
    d.className = "jarvis-msg " + (who || "jarvis");
    d.textContent = txt;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    return d;
  }

  function waiting(txt) {
    const c = elChat();
    if (!c) return null;
    const d = document.createElement("div");
    d.className = "jarvis-msg wait";
    d.textContent = txt;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    return d;
  }
  function dropWait(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  // ------------------------------------------------------------------
  // Persistencia (SQLite vía desktop.jarvis.config)
  // ------------------------------------------------------------------
  function kvOk() { return !!(window.desktop && window.desktop.jarvis && window.desktop.jarvis.config); }

  // ------------------------------------------------------------------
  // CACHÉ SEMÁNTICO LOCAL — respuestas instantáneas para consultas repetidas
  // Normaliza el texto, busca coincidencia leve y devuelve la respuesta
  // guardada (0 ms, consumo cero de API).
  // ------------------------------------------------------------------
  const CPC = "jarvis_cache";
  async function cargarCache() {
    if (!kvOk()) { CACHE = CACHE || new Map(); return; }
    try {
      const arr = await window.desktop.jarvis.config.get(CPC);
      if (Array.isArray(arr)) { CACHE = new Map(arr.map(e => [e.q, e])); }
    } catch (e) {}
    CACHE = CACHE || new Map();
  }
  function normalizarQ(s) {
    return String(s || "").toLowerCase()
      .replace(/[¿?¡!.,;:]/g, " ").replace(/[áàäâ]/g, "a").replace(/[éèëê]/g, "e")
      .replace(/[íìïî]/g, "i").replace(/[óòöô]/g, "o").replace(/[úùüû]/g, "u")
      .replace(/\b(por|favor|dime|dame|me puedes|puedes|cual es|cuales son|cuanto|cuantos|hoy)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function coherencia(a, b) {
    const pa = normalizarQ(a).split(" ").filter(Boolean);
    const pb = normalizarQ(b).split(" ").filter(Boolean);
    if (!pa.length || !pb.length) return 0;
    const inter = new Set(pa.filter(w => pb.includes(w))).size;
    return inter / Math.max(pa.length, pb.length);
  }
  function cacheGet(q, tipadas = 0.92) {
    if (!CACHE) return null;
    if (CACHE.has(q)) {
      const e = CACHE.get(q);
      if (Date.now() - (e.t || 0) < 6 * 3600 * 1000) return { text: e.r, fromCache: true, hits: e.h + 1 };
    }
    for (const [k, e] of CACHE) {
      if (coherencia(k, q) >= tipadas && Date.now() - (e.t || 0) < 6 * 3600 * 1000) {
        e.h = (e.h || 0) + 1; persistirCache();
        return { text: e.r, fromCache: true, hits: e.h };
      }
    }
    return null;
  }
  function cacheSet(q, resp) {
    if (!CACHE) CACHE = new Map();
    CACHE.set(q, { q, r: resp, t: Date.now(), h: 1 });
    persistirCache();
  }
  function persistirCache() {
    if (!kvOk() || !CACHE) return;
    const arr = Array.from(CACHE.values()).slice(-120);
    window.desktop.jarvis.config.set(CPC, arr);
  }

  async function loadState() {
    if (!kvOk()) return;
    try {
      const [c, m, k, cache] = await Promise.all([
        window.desktop.jarvis.config.get(CFP),
        window.desktop.jarvis.config.get(CPM),
        window.desktop.jarvis.config.get(CPK),
        window.desktop.jarvis.config.get(CPC)
      ]);
      J.cfg = c || { proveedores: [], activo: "openrouter", voz: true, nombre: "Jarvis" };
      J.memoria = Array.isArray(m) ? m : [];
      J.index = k;
      if (Array.isArray(cache)) CACHE = new Map(cache.map(e => [e.q, e])); else CACHE = CACHE || new Map();
      cargarOffline();
      aplicarCfgUI();
    } catch (e) { console.error("jarvis load", e); }
  }

  async function saveCfg() { if (kvOk()) return window.desktop.jarvis.config.set(CFP, J.cfg || {}); }
  async function saveMem() { if (kvOk()) return window.desktop.jarvis.config.set(CPM, J.memoria.slice(-80)); }
  async function saveIndex() { if (kvOk() && J.index) return window.desktop.jarvis.config.set(CPK, J.index); }

  // ------------------------------------------------------------------
  // Proveedores (definición visual/funcional)
  // ------------------------------------------------------------------
  const PROVIDERS = [
    { id: "openrouter", label: "OpenRouter", icon: "🌐", desc: "Acceso a cientos de modelos libres y gratuitos (:free).", needsKey: true, free: true },
    { id: "gemini", label: "Google Gemini", icon: "✨", desc: "Modelos flash gratuitos con límite diario.", needsKey: true, free: true },
    { id: "groq", label: "Groq", icon: "⚡", desc: "Inferencia ultra rápida (Llama 3).", needsKey: true, free: true },
    { id: "cerebras", label: "Cerebras", icon: "🪐", desc: "Veloz, modelos Llama.", needsKey: true, free: true },
    { id: "openai", label: "OpenAI", icon: "🤖", desc: "GPT-4o mini (parcialmente gratuito).", needsKey: true, free: false }
  ];

  // ---------- ventana de configuración ----------
  function abrirJarvisConfig() {
    loadState().then(() => {
      renderConfigTabs();
      aplicarCfgUI();
      if (typeof openModuleWindow === "function") openModuleWindow("jarvis-config");
    });
  }

  function renderConfigTabs() {
    const tabs = $("jarvis-config-tabs");
    if (!tabs) return;
    tabs.innerHTML = PROVIDERS.map(p =>
      `<div class="tab ${(J.cfg && J.cfg.activo === p.id) ? "active" : ""}" data-prov="${p.id}" onclick="JarvisAPI.setProveedor('${p.id}')">${p.icon} ${p.label}</div>`
    ).join("");
    const bodies = $("jarvis-config-bodies");
    if (bodies) bodies.innerHTML = PROVIDERS.map(p => {
      const pc = (J.cfg && J.cfg.proveedores && J.cfg.proveedores[p.id]) || {};
      const act = J.cfg && J.cfg.activo === p.id;
      return `<div class="jarvis-config-body ${act ? "active" : ""}" data-prov="${p.id}">
        <div class="jarvis-provider-card ${act ? "sel" : ""}">
          <div class="jarvis-provider-head"><b>${p.icon} ${p.label}</b> <span class="jarvis-stat">${pc.apiKey ? "✓ key guardada" : "sin key"}</span></div>
          <div class="jarvis-stat" style="margin:4px 0">${p.desc}</div>
          <label>API Key</label>
          <input type="password" class="input-medium" id="jarvis-key-${p.id}" placeholder="sk-..." value="" autocomplete="off">
          <label>Modelo (opcional; dejar vacío = usar gratuitos automáticos)</label>
          <select class="input-medium" id="jarvis-model-${p.id}" onchange="JarvisAPI.onModel('${p.id}')"></select>
          <div class="jarvis-action-row">
            <button class="mod-btn" onclick="JarvisAPI.guardarKey('${p.id}')">💾 Guardar API Key</button>
          </div>
        </div>
      </div>`;
    }).join("");
    PROVIDERS.forEach(p => { const s = $("jarvis-model-" + p.id); if (s) llenarModelos(s, p.id); });
    // Pestaña de modo local / offline (Ollama, LM Studio)
    const off = (J.cfg && J.cfg.offline) || {};
    tabs.innerHTML += `<div class="tab" data-prov="offline" onclick="JarvisAPI.jarvisShowOfflineTab()">🖥 Local / offline</div>`;
    bodies.innerHTML += `<div class="jarvis-config-body" data-prov="offline">
      <div class="jarvis-provider-card">
        <div class="jarvis-provider-head"><b>🖥 Modelo local (Ollama / LM Studio)</b> <span class="jarvis-stat">${off.host ? "✓ configurado" : "sin configurar"}</span></div>
        <div class="jarvis-stat" style="margin:4px 0">Se usa automáticamente cuando no hay conexión o fallan los proveedores en línea. Requiere Ollama instalado.</div>
        <label>Host (dirección del servidor local)</label>
        <input class="input-medium" id="jarvis-off-host" value="${off.host || "http://127.0.0.1:11434"}">
        <label>Modelos (separados por comas: phi3, qwen, llama3)</label>
        <input class="input-medium" id="jarvis-off-models" value="${(off.modelos || []).join(", ")}">
        <div class="jarvis-action-row">
          <button class="mod-btn" onclick="JarvisAPI.guardarOffline()">💾 Guardar modo local</button>
        </div>
      </div>
    </div>`;
  }

  function jarvisShowOfflineTab() {
    const tabs = $("jarvis-config-tabs");
    if (tabs) tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.prov === "offline"));
    penyCfgBodies();
  }

  function guardarOffline() {
    const host = ($("jarvis-off-host") && $("jarvis-off-host").value.trim()) || "http://127.0.0.1:11434";
    const modelos = ($("jarvis-off-models") && $("jarvis-off-models").value.split(",").map(s => s.trim()).filter(Boolean)) || [];
    setOffline({ host, modelos });
    addMsg("Modo local guardado. Jarvis usará " + host + " cuando esté sin conexión.", "sys");
  }

  function aplicarCfgUI() {
    const tabs = $("jarvis-config-tabs");
    if (tabs) tabs.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.prov === (J.cfg && J.cfg.activo)));
    penyCfgBodies();
    if (J.cfg && J.cfg.voz) iniciarVozUI();
  }

  function setProveedor(id) {
    if (!J.cfg) J.cfg = { proveedores: [], activo: "openrouter", voz: true, nombre: "Jarvis" };
    J.cfg.activo = id;
    saveCfg();
    renderConfigTabs();
    addMsg("Jarvis usará " + (PROVIDERS.find(p => p.id === id) || {}).label + " como proveedor activo.", "sys");
  }

  function onModel(prov) {
    const s = $("jarvis-model-" + prov);
    if (!s) return;
    const pc = (J.cfg.proveedores && J.cfg.proveedores[prov]) || {};
    pc.model = s.value;
    J.cfg.proveedores = J.cfg.proveedores || {};
    J.cfg.proveedores[prov] = pc;
    saveCfg();
  }

  function llenarModelos(sel, prov) {
    const models = FREE_MODELS[prov] || [];
    const pc = (J.cfg && J.cfg.proveedores && J.cfg.proveedores[prov]) || {};
    sel.innerHTML = '<option value="">— automático (gratuitos) —</option>' +
      models.map(m => `<option value="${m.model}" ${m.free ? '(gratuito)' : ''}>${m.model}${m.free ? " (gratis)" : ""}</option>`).join("");
    if (pc.model) sel.value = pc.model;
  }

  function guardarKey(prov) {
    const inp = $("jarvis-key-" + prov);
    if (!inp) return;
    const key = inp.value.trim();
    if (!key) { addMsg("Ingrese una API key para " + prov + ".", "err"); return; }
    if (/^[•]+$/.test(key)) { addMsg("Ingrese la nueva API key de " + prov + " (no deje puntos).", "err"); return; }
    J.cfg.proveedores = J.cfg.proveedores || {};
    J.cfg.proveedores[prov] = J.cfg.proveedores[prov] || {};
    J.cfg.proveedores[prov].apiKey = key;
    // Activa este proveedor para que sea el que se use.
    J.cfg.activo = prov;
    saveCfg().then(() => {
      inp.value = "";
      addMsg("API key de " + prov + " guardada y activada.", "sys");
      renderConfigTabs();
    });
  }

  function penyCfgBodies() {
    const bodies = $("jarvis-config-bodies");
    if (!bodies) return;
    bodies.querySelectorAll(".jarvis-config-body").forEach(b =>
      b.classList.toggle("active", b.dataset.prov === (J.cfg && J.cfg.activo)));
  }

  // ---------- estado / pipeline ----------
  function paso(n, label, ok) {
    const steps = document.querySelectorAll("#jarvis-pipeline .step");
    if (!steps.length) return;
    for (let i = 0; i < steps.length; i++) {
      steps[i].classList.remove("cur");
      steps[i].classList.remove("done");
      steps[i].classList.add(i < n ? "done" : "pend");
    }
    if (n >= 0 && steps[n]) { steps[n].classList.add("cur"); steps[n].textContent = (steps[n].dataset.label || "") + (label ? ": " + label : ""); }
  }

  // ==================================================================
  // DISCOVERY ENGINE — EXPLORAR → COMPRENDER → MAPEAR → INDEXAR →
  //                    GUARDAR EN SQLITE → CREAR HERRAMIENTAS →
  //                    VALIDAR PERMISOS → OPERAR
  // ==================================================================
  const PIPELINE = ["EXPLORAR", "COMPRENDER", "MAPEAR", "INDEXAR", "GUARDAR EN SQLITE", "CREAR HERRAMIENTAS", "VALIDAR PERMISOS", "OPERAR"];

  async function iniciarJarvis() {
    if (!kvOk()) { addMsg("Jarvis requiere el entorno de escritorio (Electron).", "err"); return; }
    abrirPanel();
    J.ocupado = true;
    // Limpia pipeline
    const p = $("jarvis-pipeline");
    if (p) p.innerHTML = "";
    addMsg("Iniciando Jarvis... ejecutando pipeline de descubrimiento del proyecto.", "sys");
    for (let i = 0; i < PIPELINE.length; i++) {
      const pasoName = PIPELINE[i];
      J.pipelineStep = i;
      reportarPaso(i, pasoName, "en curso...");
      try {
        if (pasoName === "EXPLORAR") J.index = await window.desktop.jarvis.scan();
        else if (pasoName === "COMPRENDER") construirResumen();
        else if (pasoName === "MAPEAR") mapearModulos();
        else if (pasoName === "INDEXAR") construirIndice();
        else if (pasoName === "GUARDAR EN SQLITE") { await saveIndex(); }
        else if (pasoName === "CREAR HERRAMIENTAS") { /* ya están definidas */ }
        else if (pasoName === "VALIDAR PERMISOS") validarPermisosJarvis();
        else if (pasoName === "OPERAR") {}
        reportarPaso(i, pasoName, "OK");
        await sleep(150);
      } catch (e) {
        reportarPaso(i, pasoName, "ERROR");
        addMsg("Pipeline detenido en " + pasoName + ": " + (e && e.message || e), "err");
        J.ocupado = false;
        return;
      }
    }
    J.ocupado = false;
    const n = resumenDatos();
    addMsg("✓ Jarvis inicializado y operativo. " + n, "sys");
    if (J.cfg && J.cfg.voz) hablar("Jarvis listo. ¿En qué puedo ayudarte?");
  }

  function reportarPaso(i, name, estado) {
    const p = $("jarvis-pipeline");
    if (!p) return;
    const linea = document.createElement("div");
    linea.className = "step " + (estado === "OK" ? "done" : (estado.startsWith("en") ? "cur" : "pend"));
    linea.dataset.label = name;
    linea.textContent = name + (estado.startsWith("en") ? "" : " " + estado);
    const cur = p.querySelector(".step.cur");
    if (cur) cur.classList.remove("cur");
    if (estado === "OK") { const pend = p.querySelector(".step:not(.done)"); if (pend) pend.classList.add("done"); }
    p.appendChild(linea);
  }

  function resumenDatos() {
    let files = 0, funcs = 0, wins = 0;
    (J.index && J.index.files || []).forEach(f => {
      files++; funcs += (f.functions || []).length; wins += (f.windows || []).length;
    });
    return `Descubiertos ${files} archivos, ${funcs} funciones y ${wins} ventanas.`;
  }

  function construirResumen() {
    const db = getDBOrNull();
    const n = db ? {
      clientes: (db.clientes || []).length,
      productos: (db.productos || []).length,
      ventas: (db.ventas || []).length,
      ordenes: (db.ordenesTaller || []).length,
      cuentas: (db.cuentasCobrar || []).length
    } : null;
    J.resumen = n || { clientes: 0, productos: 0, ventas: 0, ordenes: 0, cuentas: 0 };
  }

  function mapearModulos() {
    J.modulos = ["pos", "clientes", "productos", "servicios", "taller", "cotizaciones",
      "devoluciones", "inventario", "reportes", "proveedores", "caja", "compras",
      "contabilidad", "cuentas", "par-param"];
  }

  function construirIndice() {
    if (!J.index || !J.index.files) return;
    const palabras = [];
    J.index.files.forEach(f => {
      const cortos = (f.file || "").split("/");
      const desc = cortos[cortos.length - 1].replace(/\.(js|html|css)$/, "");
      palabras.push(desc);
    });
    J.index.modulos = J.modulos || [];
    J.index.keywords = palabras;
  }

  function validarPermisosJarvis() {
    // Jarvis solo puede operar con los permisos del rol actual del sistema.
    const rol = (typeof rolActual === "function") ? rolActual() : "Consulta";
    J.perfiles = { rol };
    J.modulos = (typeof rolPuedeModulo === "function")
      ? { pos: rolPuedeModulo("pos"), clientes: rolPuedeModulo("clientes"), taller: rolPuedeModulo("taller"), caja: rolPuedeModulo("caja") }
      : {};
  }

  function getDBOrNull() { return (typeof DB === "object" && DB) ? DB : null; }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ------------------------------------------------------------------
  // ROUTER DE MODELOS GRATUITOS (conmutación automática por disponibilidad)
  // + CIRCUIT BREAKER (429/rate-limit): suspende temporalmente el modelo
  //   saturado y salta al siguiente sin latencia de espera.
  // ------------------------------------------------------------------
  function listaModelos() {
    const prov = J.cfg && J.cfg.activo;
    const manual = J.cfg && J.cfg.proveedores && J.cfg.proveedores[prov] && J.cfg.proveedores[prov].model;
    const cand = [];
    cand.push({ provider: prov, model: manual, custom: true });
    const lista = FREE_MODELS[prov] || [];
    lista.forEach(m => cand.push({ provider: prov, model: m.model }));
    return cand.filter(c => c.model);
  }

  // Suspende un proveedor:modelo durante `ms` ms (default 45 s al recibir 429).
  function suspender(key, ms) { SUSP.set(key, Date.now() + (ms || 45000)); }
  function suspenso(key) { const h = SUSP.get(key); return h ? (h - Date.now()) > 0 : false; }
  function claveModelo(provider, model) { return (provider || "?") + "|" + (model || "?"); }

  async function chat(messages, extra) {
    if (!kvOk()) return { ok: false, msg: "Sin entorno de escritorio." };
    const provId = J.cfg && J.cfg.activo;
    const provCfg = J.cfg && J.cfg.proveedores && J.cfg.proveedores[provId];
    if (!provCfg || !provCfg.apiKey) return { ok: false, msg: "Configure una API key para el proveedor activo." };
    const cand = listaModelos();
    if (!cand.length) return { ok: false, msg: "Sin modelos configurados." };
    const errors = [];
    // Filtra los modelos actualmente suspendidos por rate-limit (circuit breaker).
    const activos = cand.filter(c => !suspenso(claveModelo(provId, c.model)));
    for (const c of activos) {
      const key = claveModelo(provId, c.model);
      const r = await window.desktop.jarvis.ai(provCfg, c.model, messages, extra);
      const s = r && r.status;
      // 429 / rate-limit: suspende el modelo y continúa con el siguiente.
      if (s === 429 || (r && /rate|429|too many|quota/i.test((r.msg || r.raw || "") + ""))) {
        suspender(key, 45000);
        errors.push((c.model || "?") + " (rate-limit, suspendido 45s)");
        continue;
      }
      if (r && r.ok && r.json) {
        const text = extraerTexto(r.json);
        if (text) return { ok: true, model: c.model, text };
        errors.push((c.model || "?") + " (vacío)");
      } else {
        errors.push((c.model || "?") + " " + (r && (r.msg || r.raw || r.status)));
      }
    }
    if (!activos.length) return { ok: false, msg: "Todos los modelos están suspendidos por límite de peticiones. Intenta de nuevo en un momento." };
    // Último recurso: modo offline local.
    const local = await chatOffline(messages, extra);
    if (local && local.ok) return local;
    return { ok: false, msg: "Todos los modelos fallaron: " + errors.join("; ") };
  }

  // MODO OFFLINE AUTÓNOMO — Ollama / LM Studio / SLM local.
  // Se usa cuando no hay conexión, no hay API key o todos los modelos fallan.
  async function chatOffline(messages, extra) {
    if (!window.desktop || !window.desktop.jarvis || !window.desktop.jarvis.aiOffline) return { ok: false, msg: "Offline no disponible." };
    if (!OFFLINE) cargarOffline();
    if (!OFFLINE || !OFFLINE.host) return { ok: false, msg: "Sin modelo local configurado." };
    const modelos = (OFFLINE.modelos || []).filter(Boolean);
    if (!modelos.length) return { ok: false, msg: "Sin modelos locales (ej. phi3, qwen, llama3)." };
    for (const m of modelos) {
      const key = claveModelo("ollama", m);
      if (suspenso(key)) continue;
      const r = await window.desktop.jarvis.aiOffline(OFFLINE, m, messages, extra);
      const text = (r && r.ok && r.json) ? extraerTexto(r.json) : "";
      if (text) return { ok: true, model: "local:" + m, text, offline: true };
      if (r && r.status === 429) suspender(key, 45000);
    }
    return { ok: false, msg: "Sin respuesta del modelo local." };
  }

  function cargarOffline() {
    const off = J.cfg && J.cfg.offline;
    OFFLINE = (off && off.host) ? off : null;
  }

  function extraerTexto(json) {
    try {
      if (json.choices && json.choices[0]) return json.choices[0].message.content || "";
      if (json.candidates && json.candidates[0]) return (json.candidates[0].content.parts || []).map(p => p.text || "").join("");
    } catch (e) {}
    return "";
  }

  // ------------------------------------------------------------------
  // HERRAMIENTAS ERP (operativas, respetando permisos)
  // ------------------------------------------------------------------
  function herramientas() {
    const db = getDBOrNull();
    const hoyD = (typeof hoy === "function") ? hoy() : "";
    const ventasHoy = (db && db.ventas || []).filter(v => v.fecha === hoyD);
    const totalHoy = ventasHoy.reduce((s, v) => s + num0(v.total), 0);
    const abonosHoy = (db && db.abonos || []).filter(a => a.fecha === hoyD).reduce((s, a) => s + num0(a.montoCobrado), 0);
    const stockBajo = (db && db.productos || []).filter(p => num0(p.existencia) <= num0(p.minimo)).length;
    const carteraCxC = (db && db.cuentasCobrar || []).reduce((s, c) => s + num0(c.saldo), 0);
    const deudaCli = {};
    (db && db.cuentasCobrar || []).forEach(c => { if (num0(c.saldo) > 0) deudaCli[c.nombre] = num0(deudaCli[c.nombre]) + num0(c.saldo); });
    return {
      modulos: (typeof rolPuedeModulo === "function")
        ? ["pos", "clientes", "productos", "servicios", "taller", "cotizaciones", "devoluciones", "inventario", "reportes", "proveedores", "caja", "compras", "contabilidad", "clientes-deuda", "proveedores-deuda"]
        : [],
      resumen: {
        ventasHoy: ventasHoy.length,
        totalHoy,
        abonosHoy,
        stockBajo,
        carteraCxC,
        saldoCaja: (db && db.caja ? db.caja : {}),
        clientes: (db && db.clientes || []).length,
        productos: (db && db.productos || []).length
      },
      topDeudores: Object.entries(deudaCli).sort((a, b) => b[1] - a[1]).slice(0, 5)
    };
  }

  function num0(v) { const n = parseFloat(String(v).replace(/[^0-9.,]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }

  // Ejecutar una acción operativa que pidió el usuario.
  async function ejecutarAccion(intent) {
    const t = (intent || "").toLowerCase();
    const rol = (typeof rolActual === "function") ? rolActual() : "Consulta";

    // Abrir módulo
    if (/(abre|abrir|muestra|mostrar|irse|\bva al|abreme)\s+(clientes)/.test(t) && puede("clientes")) { openModule("clientes"); return "Abrí el módulo de Clientes."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(productos)/.test(t) && puede("productos")) { openModule("productos"); return "Abrí el módulo de Productos."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(taller)/.test(t) && puede("taller")) { openModule("taller"); return "Abrí el módulo Taller / Órdenes de Servicio."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(caja)/.test(t) && puede("caja")) { openModule("caja"); return "Abrí el módulo de Caja."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(inventario)/.test(t) && puede("inventario")) { openModule("inventario"); return "Abrí el módulo de Inventario."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(reportes|reporte)/.test(t) && puede("reportes")) { openModule("reportes"); return "Abrí el módulo de Reportes."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(contabilidad)/.test(t) && puede("contabilidad")) { openModule("contabilidad"); return "Abrí el módulo de Contabilidad."; }
    if (/(abre|abrir|muestra|mostrar|irse|va al|abreme)\s+(compras|proveedores)/.test(t) && puede("compras")) { openModule("compras"); return "Abrí el módulo de Compras/Proveedores."; }

    // Cta de caja a crédito
    if (/(guardar|cuentas por cobrar|cuenta por cobrar)/.test(t)) {
      if (typeof openModuleWindow === "function" && puede("clientes-deuda")) { openModuleWindow("clientes-deuda"); return "Abrí la consulta de cuentas por cobrar."; }
    }

    const h = herramientas();
    const hl = [
      "Resumen operativo:\n" +
      "- Ventas de hoy: " + h.resumen.ventasHoy + " facturas, " + fmtM(h.resumen.totalHoy) + " Bs.\n" +
      "- Cobrado hoy (abonos): " + fmtM(h.resumen.abonosHoy) + " USD\n" +
      "- Productos con stock bajo: " + h.resumen.stockBajo + "\n" +
      "- Cartera por cobrar: " + fmtM(h.resumen.carteraCxC) + " USD\n" +
      "- Clientes registrados: " + h.resumen.clientes + ", productos: " + h.resumen.productos + "\n" +
      "- Rol actual: " + rol
    ];
    if (/(resumen|resumi|estado|situaci|ventas de hoy|reporte|balance|como vamos)/.test(t)) {
      return hl.join("\n");
    }
    // stock bajo (con payload Bento de tabla)
    if (/(stock|inventario|falta|existencia)/.test(t)) {
      const db = getDBOrNull();
      const bajos = (db && db.productos || []).filter(p => num0(p.existencia) <= num0(p.minimo) && p.categoria !== "SERVICIOS").slice(0, 10);
      if (!bajos.length) return { text: "No hay productos con stock bajo actualmente." };
      return {
        text: "Productos con stock igual o por debajo del mínimo:",
        bento: {
          tipo: "tabla", title: "Stock bajo",
          columnas: ["Código", "Descripción", "Existencia", "Mínimo"],
          filas: bajos.map(p => [p.codigo, p.descripcion, fmtM(p.existencia), fmtM(p.minimo)])
        }
      };
    }
    // deudores (con payload Bento de tabla)
    if (/(deuda|deudor|cuentas por cobrar|adeudan|cliente.*debe)/.test(t)) {
      if (!h.topDeudores.length) return { text: "No hay clientes con saldo pendiente de pago." };
      return {
        text: "Clientes con deuda pendiente:",
        bento: {
          tipo: "tabla", title: "Cuentas por cobrar",
          columnas: ["Cliente", "Saldo (USD)"],
          filas: h.topDeudores.map(([n, s]) => [n, fmtM(s)])
        }
      };
    }
    return null;
  }

  function puede(perm) { return typeof rolPuedeModulo === "function" && rolPuedeModulo(perm); }
  function fmtM(v) { try { return new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(v || 0); } catch (e) { return String(v || 0); } }

  // ------------------------------------------------------------------
  // CONVERSACIÓN (texto + herramientas + IA)
  // ------------------------------------------------------------------
  async function enviar() {
    const inp = $("jarvis-input");
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt || J.ocupado) return;
    inp.value = "";
    addMsg(txt, "user");
    setOrb("thinking");
    const w = waiting("Jarvis está pensando...");

    // Ejecuta acciones locales directas (fiables, sin depender de red)
    const rLocal = await ejecutarAccion(txt);
    if (rLocal) {
      const texto = typeof rLocal === "string" ? rLocal : (rLocal.text || "");
      J.memoria.push({ role: "user", content: txt });
      J.memoria.push({ role: "assistant", content: texto });
      saveMem();
      dropWait(w);
      setOrb("");
      addMsg(texto);
      if (rLocal && rLocal.bento) renderBento(rLocal.bento);
      if (J.cfg && J.cfg.voz) hablar(texto);
      return;
    }

    // CACHÉ SEMÁNTICO: si la consulta ya se respondió hace poco, se usa al
    // instante (0 ms, sin gastar API) y se anota que vino de caché.
    const hitC = cacheGet(txt);
    if (hitC) {
      dropWait(w);
      setOrb("");
      J.memoria.push({ role: "user", content: txt });
      J.memoria.push({ role: "assistant", content: hitC.text });
      guardarMemCache();
      addMsg(hitC.text, "jarvis");
      addMsg("⚡ (respuesta instantánea de la caché local)", "sys");
      if (J.cfg && J.cfg.voz) hablar(hitC.text);
      return;
    }

    // Si no es acción local ni cacheada, consulta al proveedor IA
    const h = herramientas();
    const system = constrSystemPrompt();
    const userMsg = txt;
    const respuesta = await chat(
      [ { role: "system", content: system },
        ...J.memoria.slice(-14),
        { role: "user", content: userMsg } ],
      {}
    );
    dropWait(w);
    setOrb("");
    if (respuesta.ok) {
      J.memoria.push({ role: "user", content: txt });
      J.memoria.push({ role: "assistant", content: respuesta.text });
      guardarMemCache();
      // BENTO UI: si la respuesta trae payload estructurado, se renderiza.
      if (respuesta.bento) renderBento(respuesta.bento);
      addMsg(respuesta.offline ? "🌐 " : "🤖 ", "sys");
      addMsg(respuesta.text);
      cacheSet(txt, respuesta.text);
      if (J.cfg && J.cfg.voz) hablar(respuesta.text);
    } else {
      addMsg("No pude conectarme: " + respuesta.msg, "err");
      if (J.cfg && J.cfg.voz) hablar("No pude conectarme al proveedor. Revisa la configuración.");
    }
  }

  function guardarMemCache() { if (kvOk()) window.desktop.jarvis.config.set(CPM, J.memoria.slice(-80)); }

  // ------------------------------------------------------------------
  // BENTO UI — despliega modales, tablas y gráficos en el frontend a
  // partir de payloads estructurados.
  // ------------------------------------------------------------------
  function renderBento(b) {
    if (!b) return;
    const c = elChat();
    if (!c) return;
    const card = document.createElement("div");
    card.className = "jarvis-bento";
    const titulo = b.title ? "<div class='jarvis-bento-title'>" + b.title + "</div>" : "";
    let inner = titulo;
    if (b.tipo === "tabla") {
      inner += renderBentoTabla(b);
    } else if (b.tipo === "grafico" || b.tipo === "bars") {
      inner += renderBentoBars(b);
    } else if (b.tipo === "modal") {
      inner += renderBentoModal(b);
    }
    card.innerHTML = inner;
    c.appendChild(card);
    c.scrollTop = c.scrollHeight;
  }

  function renderBentoTabla(b) {
    if (!Array.isArray(b.columnas) || !Array.isArray(b.filas)) return "<p>Sin datos de tabla.</p>";
    const th = b.columnas.map(h => "<th>" + h + "</th>").join("");
    const body = b.filas.map(f =>
      "<tr>" + b.columnas.map((_, i) => "<td>" + (f[i] != null ? f[i] : "&nbsp;") + "</td>").join("") + "</tr>"
    ).join("");
    return "<table class='jarvis-bento-table'><thead><tr>" + th + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function renderBentoBars(b) {
    if (!Array.isArray(b.datos)) return "<p>Sin datos.</p>";
    const max = Math.max.apply(null, b.datos.map(d => d[1] || 0)) || 1;
    const bars = b.datos.map(d => {
      const w = Math.round(((d[1] || 0) / max) * 100);
      return "<div class='jb-bar'><span class='jb-bar-label'>" + d[0] + "</span>" +
        "<div class='jb-bar-track'><div class='jb-bar-fill' style='width:" + w + "%'></div></div><span class='jb-bar-val'>" + d[1] + "</span></div>";
    }).join("");
    return "<div class='jarvis-bento-bars'>" + bars + "</div>";
  }

  function renderBentoModal(b) {
    let rows = "";
    if (b.campos && Array.isArray(b.campos)) {
      rows = b.campos.map(f => "<div class='jb-field'><b>" + (f.label || "") + "</b><span>" + (f.valor != null ? f.valor : "&nbsp;") + "</span></div>").join("");
    } else if (b.items && Array.isArray(b.items)) {
      rows = b.items.map(it => "<div class='jb-field'><b>" + it + "</b></div>").join("");
    }
    return "<div class='jarvis-bento-modal'>" + rows + "</div>";
  }

  function constrSystemPrompt() {
    const h = herramientas();
    return [
      "Eres Jarvis, el asistente inteligente del sistema POSsystem pro. ",
      "Hablas en español, respondes de forma breve, clara y útil. ",
      "Eres capaz de ejecutar tareas operativas típicas del POS (vender, inventario, caja, taller, reportes) y de asesorar al operador. ",
      "Rol actual del usuario: " + (h && h.modulos && h.modulos.length ? (J.perfiles && J.perfiles.rol || (typeof rolActual === "function" ? rolActual() : "Consulta")) : "") + ". ",
      "Solo puedes sugerir acciones que el rol permita; si te piden algo sin permiso, indícalo amablemente y sugiere llamar al administrador. ",
      "\nEstado operativo del sistema:\n" + (h.resumen ? JSON.stringify(h.resumen) : "s/d") + ".\n",
      "Si necesitas abrir un módulo o ver un detalle, dile al usuario que escriba el comando (ej. 'abre clientes', 'ver stock')."
    ].join("");
  }

  // ------------------------------------------------------------------
  // VOZ — entrada (SpeechRecognition) y salida (speechSynthesis)
  // ------------------------------------------------------------------
  function iniciarVozUI() {
    const btn = $("jarvis-mic");
    if (!btn) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { btn.disabled = true; btn.title = "Voz no disponible en este navegador"; return; }
    btn.classList.remove("hidden");
  }

  function alternarMic() {
    const btn = $("jarvis-mic");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addMsg("Reconocimiento de voz no disponible.", "err"); return; }
    if (J.rec && J.rec.estado === "running") { J.rec.stop(); return; }
    if (J.rec && J.rec.esmic) { try { J.rec.esmic.stop(); } catch (e) {} }
    const rec = new SR();
    J.rec = rec;
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onstart = () => { setOrb("listening"); if (btn) btn.classList.add("active"); addMsg("🎤 Escuchando...", "sys"); };
    rec.onresult = (ev) => {
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      const inp = $("jarvis-input");
      if (inp) inp.value = (inp.value ? inp.value + " " : "") + txt.trim();
      setOrb("");
      if (btn) btn.classList.remove("active");
    };
    rec.onerror = (ev) => { setOrb(""); if (btn) btn.classList.remove("active"); if (ev.error === "not-allowed") addMsg("Sin permiso de micrófono.", "err"); };
    rec.onend = () => { setOrb(""); if (btn) btn.classList.remove("active"); J.rec = null; if (J.autoEnviar) { J.autoEnviar = false; enviar(); } };
    rec.start();
    J.autoEnviar = true;
  }

  function hablar(texto) {
    const synth = window.speechSynthesis;
    if (!synth || !J.cfg || !J.cfg.voz) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-ES";
      u.rate = 1;
      u.pitch = 1;
      const vol = speechSynthesis.getVoices();
      const v = vol.find(x => /es[-_]/i.test(x.lang) && x.localService);
      if (v) u.voice = v;
      synth.speak(u);
    } catch (e) {}
  }

  // ------------------------------------------------------------------
  // ABRIR / CERRAR PANEL
  // ------------------------------------------------------------------
  function abrirPanel() {
    const p = elPanel();
    if (p) p.classList.remove("hidden");
    const inp = $("jarvis-input");
    if (inp) setTimeout(() => inp.focus(), 40);
  }
  function togglePanel() {
    const p = elPanel();
    if (!p) return;
    if (p.classList.contains("hidden")) abrirPanel();
    else p.classList.add("hidden");
  }
  function cerrarPanel() { const p = elPanel(); if (p) p.classList.add("hidden"); }

  // ------------------------------------------------------------------
  // INICIO
  // ------------------------------------------------------------------
  function init() {
    // El orbe es accesible siempre (incluso en la pantalla de login).
    mostrarSegunRol();
    // Tras autenticarse, asegurar visibilidad y cargar estado.
    document.addEventListener("login", () => {
      window.JarvisStart = true;
      mostrarSegunRol();
    });
    if (document.body.classList.contains("logged-in")) mostrarSegunRol();
  }

  function mostrarSegunRol() {
    const o = elOrb();
    if (!o) return;
    const tieneAcceso = (typeof rolPuedeModulo !== "function") || rolPuedeModulo("pos");
    o.classList.remove("hidden");
    o.style.display = "block";
    if (window.jarvisOrb && window.jarvisOrb.setVisible) window.jarvisOrb.setVisible(true);
    if (window.jarvisOrb && window.jarvisOrb.resize) window.jarvisOrb.resize();
    loadState();
    const p = elPanel();
    if (p) p.setAttribute("data-lista", "1");
    // Detección de red: solo informa (no bloquea) para saber si se usará offline posteriormente.
    if (window.desktop && window.desktop.jarvis && window.desktop.jarvis.checkNetwork) {
      window.desktop.jarvis.checkNetwork().then(r => {
        J.onlineRed = !!(r && r.online);
        const st = $("jarvis-netstatus");
        if (st) st.textContent = J.onlineRed ? "● en línea" : "● sin red — modo local";
      }).catch(() => {});
    }
  }

  // Guarda/lee la configuración del modo offline (Ollama / LM Studio).
  function setOffline(cfg) {
    if (!J.cfg) J.cfg = { proveedores: [], activo: "openrouter", voz: true, nombre: "Jarvis" };
    J.cfg.offline = cfg || {};
    cargarOffline();
    saveCfg();
    return { ok: true };
  }
  function getOffline() {
    cargarOffline();
    return OFFLINE || { host: "http://127.0.0.1:11434", modelos: ["phi3", "qwen2.5:3b", "llama3.2"] };
  }

  // Exponer API pública
  window.JarvisAPI = {
    iniciarJarvis, abrirJarvisConfig, abrirPanel, togglePanel, cerrarPanel,
    enviar, setProveedor, onModel, guardarKey, alternarMic,
    setOffline, getOffline, guardarOffline, jarvisShowOfflineTab,
    config: CFP
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();