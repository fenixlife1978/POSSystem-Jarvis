// ============== UTILIDADES: contraseña, configuración, usuarios, respaldos, auditoría, parámetros ==============
const _g = id => document.getElementById(id);

// ===== Parámetros del sistema =====
function cargarParametros() {
  _g("par-tasa").value = fmt(getTasa());
  _g("par-iva").value = (getIva() || 0).toFixed(0);
  _g("par-serie").value = DB.parametros.serie || "FACT";
  _g("par-pin").value = DB.parametros.pinSupervisor || "";
  _g("par-dias-aceite").value = DB.parametros.diasCambioAceite || 90;
}

function guardarParametros() {
  const nuevaTasa = num(_g("par-tasa").value);
  DB.parametros.tasaBCV = nuevaTasa;
  DB.parametros.iva = num(_g("par-iva").value);
  DB.parametros.serie = _g("par-serie").value.trim() || "FACT";
  DB.parametros.pinSupervisor = String(_g("par-pin").value || "").trim() || "1234";
  DB.parametros.diasCambioAceite = Math.max(1, num(_g("par-dias-aceite").value) || 90);
  auditar("Parámetros actualizados", `Tasa BCV ${fmt(getTasa())} — IVA ${getIva()}%`);
  if (typeof recalcularPreciosPorTasa === "function") recalcularPreciosPorTasa(nuevaTasa);
  saveDB();
  recalcTotales();
  if (typeof actualizarBadgeTasaBCV === "function") actualizarBadgeTasaBCV();
  renderInventario();
  actualizarResultadoPrecio();
  _g("pos-caja-label").textContent = DB.parametros.caja;
  alert("Parámetros guardados correctamente.");
  closeWindow("parametros-window");
}

// ===== Configuración =====
function cargarConfig() {
  _g("cfg-empresa").value = DB.parametros.nombreEmpresa || "";
  _g("cfg-rif").value = DB.parametros.rif || "";
  _g("cfg-dir").value = DB.parametros.direccion || "";
  _g("cfg-tel").value = DB.parametros.telefono || "";
  _g("cfg-cajero").value = DB.parametros.cajero || "";
  _g("cfg-turno").value = DB.parametros.turno || 1;
  cargarCajas();
  cargarPanelDatos();
}

// ===== Datos y Almacenamiento: motor, poda, respaldo y servidor de red =====
function cargarPanelDatos() {
  if (_g("cfg-motor")) {
    Storage.status().then(st => {
      _g("cfg-motor").textContent = st.engine === "sqlite" ? `SQLite (${st.path || "local"})` : `IndexedDB (${st.engine})`;
    }).catch(() => { _g("cfg-motor").textContent = "—"; });
  }
  const cfg = DB.parametros.poda || {};
  if (_g("cfg-poda-inv")) _g("cfg-poda-inv").value = cfg.movimientosInv || 0;
  if (_g("cfg-poda-caja")) _g("cfg-poda-caja").value = cfg.movimientosCaja || 0;
  if (_g("cfg-poda-ventas")) _g("cfg-poda-ventas").value = cfg.ventas || 0;
  if (_g("cfg-poda-auditoria")) _g("cfg-poda-auditoria").value = cfg.auditoria || 2000;
  if (_g("cfg-red-servidor")) _g("cfg-red-servidor").value = DB.parametros.servidorRed || "";
  if (_g("cfg-red-hibrido")) {
    const h = (typeof Storage.hybridEnabled === "function") ? Storage.hybridEnabled() : !!DB.parametros.modoHibrido;
    _g("cfg-red-hibrido").checked = h;
  }
  actualizarEstadoRed();
}

function guardarPoda() {
  const poda = DB.parametros.poda || (DB.parametros.poda = {});
  poda.movimientosInv = parseInt(_g("cfg-poda-inv").value, 10) || 0;
  poda.movimientosCaja = parseInt(_g("cfg-poda-caja").value, 10) || 0;
  poda.ventas = parseInt(_g("cfg-poda-ventas").value, 10) || 0;
  poda.auditoria = parseInt(_g("cfg-poda-auditoria").value, 10) || 2000;
  saveDB();
  const cortados = podaDatos(true);
  const resumen = Object.keys(cortados).length
    ? "Se recortaron: " + Object.keys(cortados).map(k => `${k}: ${cortados[k]}`).join(", ")
    : "No hubo datos que recortar.";
  auditar("Poda de datos aplicada", resumen);
  alert(resumen);
}

function actualizarEstadoRed() {
  // Si esta caja apunta a un servidor remoto, es una terminal cliente.
  const ip = _g("cfg-red-servidor") ? _g("cfg-red-servidor").value.trim() : DB.parametros.servidorRed || "";
  const hib = _g("cfg-red-hibrido") ? _g("cfg-red-hibrido").checked : (Storage.hybridEnabled ? Storage.hybridEnabled() : !!DB.parametros.modoHibrido);
  if (ip && _g("cfg-red-st")) {
    _g("cfg-red-st").textContent = hib ? "Cliente híbrido → " + ip : "Cliente → " + ip;
    _g("cfg-red-status").textContent = "Verifique con 'Probar Conexión'";
    _g("cfg-red-ip").value = "";
    return;
  }
  if (!_g("cfg-red-st")) return;
  if (window.desktop && window.desktop.net) {
    window.desktop.net.status().then(st => {
      const stText = st.running ? "ACTIVO en :" + st.port : "APAGADO";
      _g("cfg-red-st").textContent = "Servidor " + stText + (st.ip ? " · " + st.ip.join(", ") : "");
      // Mostrar las IPs reales de la LAN cuando el servidor está activo.
      _g("cfg-red-ip").value = st.running && st.ip && st.ip.length ? st.ip.join(", ") : "";
    }).catch(() => {
      _g("cfg-red-st").textContent = "—";
      _g("cfg-red-ip").value = "";
    });
  } else {
    _g("cfg-red-st").textContent = "Servidor solo disponible en escritorio (Electron)";
    _g("cfg-red-ip").value = "";
  }
}

function probarServidor() {
  const target = (_g("cfg-red-servidor") ? _g("cfg-red-servidor").value.trim() : "") || Storage.serverAddress() || "";
  if (!target) { alert("Ingrese la IP LAN del servidor principal en 'Conectar esta caja al servidor'."); return; }
  Storage.setServer(target);
  if ((_g("cfg-red-hibrido") && _g("cfg-red-hibrido").checked) || Storage.hybridEnabled()) Storage.setHybrid(true);
  Storage.status().then(st => {
    const hib = Storage.hybridEnabled();
    const ok = hib ? st.online !== false : (st.reachable !== false && st.ok !== false);
    _g("cfg-red-status").textContent = ok ? "Conectado al servidor ✔" : "Sin conexión ✖";
    alert(ok
      ? "Conexión exitosa con el servidor.\nIP: " + target + "\nMotor: " + (hib ? "híbrido" : st.engine)
      : (hib
        ? "El servidor no responde ahora. Está en modo híbrido: seguirá operando offline y sincronizará al reconectar."
        : "No se pudo contactar el servidor en " + target + ". Revise que esté activo, la IP y el firewall."));
  }).catch(() => {
    _g("cfg-red-status").textContent = "Sin conexión ✖";
    if (Storage.hybridEnabled()) {
      _g("cfg-red-status").textContent = "Sin conexión ✖ (híbrido activo)";
      alert("El servidor no responde. En modo híbrido la caja seguirá operando offline y sincronizará al reconectar.");
    } else {
      alert("No se pudo contactar el servidor en " + target);
    }
  });
}

function toggleServidorRed() {
  if (!window.desktop || !window.desktop.net) { alert("Servidor de red solo disponible en la versión de escritorio."); return; }
  window.desktop.net.status().then(st => {
    const cmd = st.running ? "stop" : "start";
    const target = !st.running;
    return window.desktop.net[cmd]().then(r => {
      // Confirmar el estado real volviendo a consultar, ya que el resultado
      // del comando puede demorar o no traer el campo `running` de inmediato.
      let ip = r && r.ip, port = r && r.port;
      const confirma = (st2) => {
        const ok = st2 && st2.running === target;
        if (ok) actualizarEstadoRed();
        auditar("Servidor de red " + (target ? "activado" : "apagado"), "");
        alert(ok
          ? (target ? "Servidor activo. Los equipos de la red pueden abrir:\nhttp://" + (ip ? ip[0] : "ip-del-pc") + ":" + (port || 8753) : "Servidor apagado.")
          : "No se pudo cambiar el estado del servidor.");
      };
      if (r && r.running === target) { confirma(r); return; }
      window.desktop.net.status().then(confirma).catch(() => confirma(null));
    }).catch(() => alert("No se pudo cambiar el estado del servidor."));
  }).catch(() => alert("No se pudo consultar el servidor de red."));
}

// Marcar/desmarcar el modo híbrido. Solo se puede activar si hay una IP de
// servidor configurada; si no, se informa al usuario y se revierte el checkbox.
function toggleModoHibrido() {
  const cb = _g("cfg-red-hibrido");
  if (!cb) return;
  const ip = (_g("cfg-red-servidor") ? _g("cfg-red-servidor").value.trim() : "") || DB.parametros.servidorRed || "";
  if (cb.checked && !ip) {
    cb.checked = false;
    if (typeof uiAlert === "function") {
      uiAlert("El modo híbrido solo puede activarse cuando esta caja está conectada a un servidor.\n\nConfigure la IP del servidor en el campo 'Conectar esta caja al servidor' y luego tilde el modo híbrido.");
    } else {
      alert("El modo híbrido solo puede activarse cuando esta caja está conectada a un servidor.\n\nConfigure la IP del servidor en el campo 'Conectar esta caja al servidor' y luego tilde el modo híbrido.");
    }
    return;
  }
  DB.parametros.modoHibrido = cb.checked;
  if (typeof Storage.setHybrid === "function") Storage.setHybrid(cb.checked);
  saveDB();
  actualizarEstadoRed();
}

function guardarConfig() {
  DB.parametros.nombreEmpresa = _g("cfg-empresa").value.trim();
  DB.parametros.rif = _g("cfg-rif").value.trim();
  DB.parametros.direccion = _g("cfg-dir").value.trim();
  DB.parametros.telefono = _g("cfg-tel").value.trim();
  DB.parametros.cajero = _g("cfg-cajero").value.trim() || "ADMIN";
  DB.parametros.turno = num(_g("cfg-turno").value) || 1;
  DB.parametros.servidorRed = (_g("cfg-red-servidor") ? _g("cfg-red-servidor").value.trim() : "") || "";
  if (typeof Storage.setServer === "function") Storage.setServer(DB.parametros.servidorRed);
  DB.parametros.modoHibrido = !!(_g("cfg-red-hibrido") && _g("cfg-red-hibrido").checked);
  if (typeof Storage.setHybrid === "function") Storage.setHybrid(DB.parametros.modoHibrido);
  // Guardar también los valores de retención (poda) y máximo de auditoría.
  const poda = DB.parametros.poda || (DB.parametros.poda = {});
  poda.movimientosInv = parseInt(_g("cfg-poda-inv").value, 10) || 0;
  poda.movimientosCaja = parseInt(_g("cfg-poda-caja").value, 10) || 0;
  poda.ventas = parseInt(_g("cfg-poda-ventas").value, 10) || 0;
  poda.auditoria = parseInt(_g("cfg-poda-auditoria").value, 10) || 2000;
  auditar("Configuración actualizada", DB.parametros.nombreEmpresa);
  saveDB();
  sincronizarCajaActiva();
  _g("status-usuario").textContent = DB.parametros.cajero;
  _g("status-turno").textContent = DB.parametros.turno;
  _g("pos-caja-label").textContent = DB.parametros.caja;
  // Mostrar el aviso ANTES de cerrar (uiAlert es asíncrono y no bloquea).
  const aviso = () => {
    try { closeWindow("config-window"); } catch (e) {}
  };
  if (typeof uiAlert === "function") { uiAlert("Configuración guardada."); setTimeout(aviso, 350); }
  else { alert("Configuración guardada."); aviso(); }
}

// ===== Gestor de Cajas =====
function cargarCajas() {
  const body = _g("cajas-body");
  if (!body) return;
  body.innerHTML = (DB.cajas || []).map(c =>
    `<tr onclick="selectCaja('${c.id}')" class="${c.id === cajaActual().id ? "selected" : ""}">
      <td>${c.nombre}</td>
      <td>${c.cajero || "—"}</td>
      <td>${c.estado === "abierta" ? "ABIERTA" : "CERRADA"}</td>
      <td>${c.estado === "abierta" ? `Apertura: ${c.apertura}` : ""}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#888">Sin cajas</td></tr>`;
  llenarSelectCajeros();
  if (DB.cajas && DB.cajas.length) selectCaja(DB.cajas[0].id);
}

function llenarSelectCajeros() {
  const sel = _g("cfg-caja-cajero");
  if (!sel) return;
  const cajeros = DB.usuarios.filter(u => u.rol === "Cajero" || u.rol === "Administrador").map(u => u.usuario);
  sel.innerHTML = cajeros.map(u => `<option>${u}</option>`).join("");
}

function selectCaja(id) {
  const c = (DB.cajas || []).find(x => x.id === id);
  if (!c) return;
  _g("cfg-caja-nombre").value = c.nombre;
  _g("cfg-caja-cajero").value = c.cajero || "";
  document.querySelectorAll("#cajas-body tr").forEach(tr => tr.classList.toggle("selected", tr.cells[0].textContent === c.nombre));
}

function nuevaCaja() {
  _g("cfg-caja-nombre").value = "";
  _g("cfg-caja-cajero").value = "";
  document.querySelectorAll("#cajas-body tr").forEach(tr => tr.classList.remove("selected"));
  _g("cfg-caja-nombre").focus();
}

function guardarCaja() {
  const nombre = _g("cfg-caja-nombre").value.trim();
  if (!nombre) { alert("Ingrese el nombre de la caja"); return; }
  const cajero = _g("cfg-caja-cajero").value;
  const existing = (DB.cajas || []).find(x => x.nombre === nombre);
  if (existing) {
    const anterior = existing.cajero;
    existing.cajero = cajero;
    // Si otra caja tenía asignado ese cajero, se la quitamos
    (DB.cajas || []).forEach(c => { if (c !== existing && c.cajero === cajero) c.cajero = ""; });
    auditar("Caja actualizada", `${nombre} → Cajero ${cajero || "—"}`);
  } else {
    const id = "CAJA" + String((DB.cajas || []).length + 1).padStart(2, "0");
    (DB.cajas || []).forEach(c => { if (c.cajero === cajero) c.cajero = ""; });
    DB.cajas.push({ id, nombre, cajero, estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 });
    auditar("Caja creada", `${nombre} → Cajero ${cajero || "—"}`);
  }
  sincronizarCajaActiva();
  saveDB();
  cargarCajas();
  alert("Caja guardada correctamente.");
}

async function eliminarCaja() {
  const nombre = _g("cfg-caja-nombre").value.trim();
  if (!nombre) return;
  if (!await uiConfirm(`¿Eliminar la caja ${nombre}?`)) return;
  DB.cajas = (DB.cajas || []).filter(x => x.nombre !== nombre);
  if (!DB.cajas.length) DB.cajas.push({ id: "CAJA01", nombre: "CAJA 01", cajero: "ADMIN", estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 });
  sincronizarCajaActiva();
  auditar("Caja eliminada", nombre);
  saveDB();
  cargarCajas();
}

// ===== Cambio de contraseña =====
function cargarPassUsuario() {
  const sel = _g("pass-usuario");
  sel.innerHTML = DB.usuarios.filter(u => u.activo !== false).map(u => `<option value="${u.usuario}">${u.usuario}</option>`).join("");
}

function guardarPassword() {
  const usuario = _g("pass-usuario").value;
  const actual = _g("pass-actual").value;
  const nueva = _g("pass-nueva").value;
  const confirm = _g("pass-confirm").value;
  const u = DB.usuarios.find(x => x.usuario === usuario);
  if (!u) { alert("Usuario no encontrado"); return; }
  if (u.clave !== actual) { alert("La contraseña actual es incorrecta"); return; }
  if (!nueva) { alert("Ingrese la nueva contraseña"); return; }
  if (nueva !== confirm) { alert("La confirmación no coincide"); return; }
  u.clave = nueva;
  auditar("Cambio de contraseña", usuario);
  saveDB();
  alert("Contraseña actualizada.");
  closeWindow("password-window");
}

// ===== Usuarios =====
function renderUsuarios() {
  _g("usuarios-body").innerHTML = DB.usuarios.map(u =>
    `<tr onclick="selectUsuario('${u.usuario}')" class="${u.activo === false ? "row-out" : ""}">
      <td>${u.usuario}</td><td>${u.nombre}</td><td>${u.rol}</td><td>${u.activo === false ? "No" : "Sí"}</td>
    </tr>`).join("");
  if (DB.usuarios.length) selectUsuario(DB.usuarios[0].usuario);
}

function selectUsuario(usuario) {
  const u = DB.usuarios.find(x => x.usuario === usuario);
  if (!u) return;
  _g("usu-usuario").value = u.usuario;
  _g("usu-nombre").value = u.nombre || "";
  _g("usu-rol").value = u.rol || "Cajero";
  _g("usu-clave").value = u.clave || "";
  _g("usu-clave").disabled = true;
  _g("usu-clave-note").style.display = "";
  _g("usu-activo").checked = u.activo !== false;
  document.querySelectorAll("#usuarios-body tr").forEach(tr => tr.classList.toggle("selected", tr.cells[0].textContent === usuario));
}

function nuevoUsuario() {
  _g("usu-usuario").value = ""; _g("usu-nombre").value = "";
  _g("usu-rol").value = "Cajero"; _g("usu-clave").value = "";
  _g("usu-clave").disabled = false;
  _g("usu-clave-note").style.display = "none";
  _g("usu-activo").checked = true;
  document.querySelectorAll("#usuarios-body tr").forEach(tr => tr.classList.remove("selected"));
  _g("usu-usuario").focus();
}

function guardarUsuario() {
  const usuario = _g("usu-usuario").value.trim();
  const nombre = _g("usu-nombre").value.trim();
  if (!usuario) { alert("Ingrese el nombre de usuario"); return; }
  const idx = DB.usuarios.findIndex(x => x.usuario === usuario);
  // La clave solo se asigna al CREAR el usuario; al editar un usuario existente
  // se conserva la actual (solo se cambia desde "Cambio de Contraseña").
  if (idx < 0 && !_g("usu-clave").value) { alert("Asigne la contraseña inicial del usuario."); return; }
  const clave = idx >= 0 ? DB.usuarios[idx].clave : _g("usu-clave").value;
  const data = { usuario, nombre: nombre || usuario, rol: _g("usu-rol").value, clave, activo: _g("usu-activo").checked };
  if (idx >= 0) DB.usuarios[idx] = { ...DB.usuarios[idx], ...data };
  else DB.usuarios.push(data);
  auditar(idx >= 0 ? "Usuario actualizado" : "Usuario creado", usuario);
  saveDB();
  renderUsuarios();
}

async function eliminarUsuario() {
  const usuario = _g("usu-usuario").value.trim();
  if (!usuario) return;
  if (usuario === "ADMIN") { alert("No puede eliminar el usuario ADMIN"); return; }
  if (!await uiConfirm(`¿Eliminar el usuario ${usuario}?`)) return;
  DB.usuarios = DB.usuarios.filter(x => x.usuario !== usuario);
  auditar("Usuario eliminado", usuario);
  saveDB();
  renderUsuarios();
}

// ===== Respaldos =====
// ===== Respaldos (almacenados en IndexedDB vía Storage) =====
const BACKUP_PREFIX = "pos_backup_"; // conservado por compatibilidad con respaldos viejos en localStorage

function renderRespaldos() {
  _g("respaldos-body").innerHTML = DB.respaldos.map(r =>
    `<tr>
      <td>${r.fecha}</td><td>${r.hora}</td><td>${r.registros}</td>
      <td>
        <button class="btn-mini" title="Restaurar" onclick="restaurarRespaldo('${r.id}')">↩</button>
        <button class="btn-mini" title="Descargar" onclick="descargarRespaldo('${r.id}')">⬇</button>
        <button class="btn-mini" title="Eliminar" onclick="eliminarRespaldo('${r.id}')">✕</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#888">No hay respaldos</td></tr>`;
}

function crearRespaldo() {
  const id = "B" + Date.now();
  const snapshot = JSON.parse(JSON.stringify(DB));
  Storage.saveBackup(id, snapshot).then(ok => {
    if (!ok) { alert("No se pudo crear el respaldo (almacenamiento lleno o bloqueado)."); return; }
    DB.respaldos.unshift({ id, fecha: hoy(), hora: hora12(), registros: (DB.productos.length + " productos / " + DB.clientes.length + " clientes / " + DB.ventas.length + " ventas") });
    auditar("Respaldo creado", id);
    saveDB();
    renderRespaldos();
    alert("Respaldo creado correctamente.");
  });
}

async function restaurarRespaldo(id) {
  let ok = false;
  try { ok = !!(await uiConfirm(`¿Restaurar el respaldo ${id}? Se reemplazarán los datos actuales.`)); }
  catch (e) { ok = confirm(`¿Restaurar el respaldo ${id}? Se reemplazarán los datos actuales.`); }
  if (!ok) return;
  Storage.getBackup(id).then(saved => {
    if (!saved) { alert("No se encontró el respaldo"); return; }
    Object.keys(DB).forEach(k => delete DB[k]);
    Object.assign(DB, saved);
    DB.carrito = [];
    flushSaveDB().then(() => {
      alert("Respaldo restaurado. La pantalla se actualizará.");
      location.reload();
    });
  }).catch(() => alert("Error al restaurar el respaldo"));
}

async function descargarRespaldo(id) {
  let snap = null;
  if (id) snap = await Storage.getBackup(id);
  else if (DB.respaldos.length) snap = await Storage.getBackup(DB.respaldos[0].id);
  if (!snap) { alert("Seleccione un respaldo para descargar"); return; }
  const raw = JSON.stringify(snap, null, 2);
  const blob = new Blob([raw], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo_${id || DB.respaldos[0].id}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

async function eliminarRespaldo(id) {
  let ok = false;
  try { ok = !!(await uiConfirm(`¿Eliminar el respaldo ${id}?`)); }
  catch (e) { ok = confirm(`¿Eliminar el respaldo ${id}?`); }
  if (!ok) return;
  try {
    await Storage.removeBackup(id);
  } catch (e) { console.error("Error borrando respaldo del storage:", e); }
  DB.respaldos = (DB.respaldos || []).filter(x => x.id !== id);
  try { if (typeof auditar === "function") auditar("Respaldo eliminado", id); } catch (e) {}
  saveDB();
  renderRespaldos();
  alert("Respaldo eliminado correctamente.");
}

// Carga un archivo JSON de respaldo exportado (botón "Cargar Archivo").
// Guarda el respaldo en el almacenamiento y restaura el sistema con esos datos.
async function cargarRespaldoArchivo() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => { alert("No se pudo leer el archivo."); };
    reader.onload = async () => {
      let snap = null;
      try { snap = JSON.parse(reader.result); }
      catch (e) { alert("El archivo no es un JSON válido."); return; }
      if (!snap || typeof snap !== "object" || typeof snap.parametros !== "object" || !Array.isArray(snap.productos)) {
        alert("El archivo no parece un respaldo válido del sistema.");
        return;
      }
      // Confirmar antes de restaurar (se reemplazan los datos actuales).
      let ok = false;
      try { ok = !!(await uiConfirm(`¿Restaurar el respaldo del archivo "${file.name}"?\n\nSe reemplazarán los datos actuales del sistema.`)); }
      catch (e) { ok = confirm(`¿Restaurar el respaldo del archivo "${file.name}"?\n\nSe reemplazarán los datos actuales del sistema.`); }
      if (!ok) return;

      const id = "B" + Date.now();
      // Guardar como respaldo en el almacenamiento local.
      let saved = false;
      try { saved = await Storage.saveBackup(id, snap); } catch (e) { saved = false; }
      // Reemplazar el DB en memoria con el contenido del archivo.
      try {
        Object.keys(DB).forEach(k => delete DB[k]);
        Object.assign(DB, snap);
        if (!Array.isArray(DB.respaldos)) DB.respaldos = [];
      } catch (e) { console.error("Error restaurando desde archivo:", e); }
      // Anotar el respaldo recién cargado en la lista.
      const fechas = hoy();
      DB.respaldos.unshift({ id, fecha: fechas, hora: hora12(), registros: ((DB.productos ? DB.productos.length : 0) + " productos / " + (DB.clientes ? DB.clientes.length : 0) + " clientes / " + (DB.ventas ? DB.ventas.length : 0) + " ventas"), origen: "archivo" });
      auditar("Respaldo restaurado desde archivo", file.name);
      const aviso = () => { try { closeWindow("respaldos-window"); } catch (e) {} };
      if (typeof uiAlert === "function") { uiAlert("Respaldo restaurado. La pantalla se actualizará."); setTimeout(() => { aviso(); flushSaveDB().then(() => location.reload()); }, 350); }
      else { alert("Respaldo restaurado. La pantalla se actualizará."); aviso(); flushSaveDB().then(() => location.reload()); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ===== Auditoría =====
function filtrarAuditoria() {
  const q = (_g("aud-filtro").value || "").toLowerCase().trim();
  const rows = DB.auditoria.filter(a => !q || a.accion.toLowerCase().includes(q) || a.detalle.toLowerCase().includes(q) || a.usuario.toLowerCase().includes(q));
  _g("aud-body").innerHTML = rows.slice(0, 500).map(a =>
    `<tr><td>${a.fecha}</td><td>${a.hora}</td><td>${a.usuario}</td><td>${a.accion}</td><td>${a.detalle}</td></tr>`
  ).join("") || `<tr><td colspan="5" style="text-align:center;color:#888">Sin registros</td></tr>`;
}

// ===== Carga de ventanas de utilidades =====
function cargarVentanaUtilidad(name, orig) {
  if (name === "parametros") cargarParametros();
  if (name === "config") cargarConfig();
  if (name === "password") { cargarPassUsuario(); _g("pass-actual").value = ""; _g("pass-nueva").value = ""; _g("pass-confirm").value = ""; }
  if (name === "usuarios") renderUsuarios();
  if (name === "respaldos") renderRespaldos();
  if (name === "auditoria") { _g("aud-filtro").value = ""; filtrarAuditoria(); }
  if (name === "caja") renderMovimientosCaja();
  if (orig) orig(name);
}

// Interceptar apertura de ventanas de utilidades/caja (después de que windows.js defina openModuleWindow)
document.addEventListener("DOMContentLoaded", () => {
  const orig = window.openModuleWindow;
  if (typeof orig !== "function") return;
  window.openModuleWindow = function(name) {
    if (["parametros", "config", "password", "usuarios", "respaldos", "auditoria", "caja"].includes(name)) {
      cargarVentanaUtilidad(name, orig);
    } else {
      orig(name);
    }
  };
});
