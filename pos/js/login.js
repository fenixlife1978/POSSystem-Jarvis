// ============== LOGIN: inicio de sesión y cierre de sesión ==============
const _lg = id => document.getElementById(id);

function fillRolSelect() {
  const sel = _lg("login-rol");
  if (!sel || sel.tagName !== "SELECT") return;
  const roles = [...new Set((DB.usuarios || []).map(u => u.rol).filter(Boolean))];
  sel.innerHTML = `<option value="" disabled selected>Rol (e.g., Administrador, Cajero)</option>` + roles.map(r => `<option>${r}</option>`).join("");
  if (!roles.length) sel.innerHTML += `<option>Administrador</option><option>Cajero</option><option>Consulta</option>`;
}

function doLogin() {
  if (doLogin.locked) return;
  doLogin.locked = true;
  setTimeout(() => { doLogin.locked = false; }, 400);
  const user = _lg("login-usuario").value.trim();
  const rol = _lg("login-rol").value.trim();
  const clave = _lg("login-clave").value;
  const err = _lg("login-error");
  if (!user) { err.textContent = "Ingrese su usuario"; return; }
  const u = (DB.usuarios || []).find(x => x.usuario.toLowerCase() === user.toLowerCase());
  if (!u) { err.textContent = "Usuario no registrado"; return; }
  if (u.activo === false) { err.textContent = "Usuario inactivo"; return; }
  if (u.clave !== clave) { err.textContent = "Contraseña incorrecta"; return; }
  if (rol && u.rol && rol.toLowerCase() !== u.rol.toLowerCase()) { err.textContent = "El rol no corresponde al usuario"; return; }

  DB.parametros.cajero = u.nombre || u.usuario;
  DB.parametros.rolActual = u.rol || "Cajero";
  if (typeof sincronizarCajaActiva === "function") sincronizarCajaActiva();
  if (typeof refrescarBotonesCaja === "function") refrescarBotonesCaja();
  document.body.classList.add("logged-in");
  if (typeof aplicarPermisosRol === "function") aplicarPermisosRol();
  if (typeof iniciarRefrescoDashboard === "function") iniciarRefrescoDashboard();
  document.dispatchEvent(new CustomEvent("login", { detail: u }));
  const su = _lg("status-usuario");
  if (su) su.textContent = u.nombre || u.usuario;
  const st = _lg("status-turno");
  if (st) st.textContent = DB.parametros.turno || 1;
  const cl = _lg("pos-caja-label");
  if (cl) cl.textContent = DB.parametros.caja || "CAJA 01";
  const tc = _lg("app-title-center");
  if (tc) tc.textContent = (u.rol === "Administrador") ? "Administración ERP" : "Punto de Venta";
  auditar("Inicio de sesión", `${u.usuario} (${u.rol || "—"})`);
  saveDB();
  _lg("login-clave").value = "";
  err.textContent = "";
  setTimeout(() => {
    if (u.rol === "Administrador" && typeof abrirDashboard === "function") {
      abrirDashboard();
      setTimeout(() => { if (typeof toggleMaximize === "function") toggleMaximize("dashboard"); }, 80);
      setTimeout(() => { if (typeof mostrarRecordatorioServicios === "function") mostrarRecordatorioServicios(); }, 600);
      return;
    }
    const c = _lg("prod-codigo"); if (c) c.focus();
    setTimeout(() => { if (typeof mostrarRecordatorioServicios === "function") mostrarRecordatorioServicios(); }, 600);
  }, 80);
}

async function logout() {
  if (!await uiConfirm("¿Desea cerrar la sesión?")) return;
  if (typeof detenerRefrescoDashboard === "function") detenerRefrescoDashboard();
  document.body.classList.remove("logged-in");
  document.body.classList.remove("role-admin", "role-cajero");
  if (typeof closeWindow === "function") closeWindow("dashboard-window");
  DB.parametros.cajero = "ADMIN";
  saveDB();
  _lg("login-usuario").value = "";
  _lg("login-clave").value = "";
  const tc = _lg("app-title-center");
  if (tc) tc.textContent = "Punto de Venta";
  const err = _lg("login-error");
  if (err) err.textContent = "";
  setTimeout(() => { const u = _lg("login-usuario"); if (u) u.focus(); }, 80);
}

function forgotPassword() {
  alert("Contacte a su administrador para restablecer la contraseña.\n\nUsuario por defecto: ADMIN\nContraseña: admin");
}

function requestAccess() {
  alert("Solicite acceso a su administrador.\n\nPara crear usuarios:\nUtilidades → Usuarios");
}

document.addEventListener("DOMContentLoaded", () => {
  // Cuando la carga asíncrona de IndexedDB completa los datos (datos distintos al espejo)
  window.__onDBLoaded = () => {
    try { fillRolSelect(); } catch (e) {}
    try { if (typeof actualizarBadgeTasaBCV === "function") actualizarBadgeTasaBCV(); } catch (e) {}
  };
  fillRolSelect();
  ["login-usuario", "login-rol", "login-clave"].forEach(id => {
    const el = _lg(id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); doLogin(); }
    });
  });
  setTimeout(() => { const u = _lg("login-usuario"); if (u) u.focus(); }, 100);
});
