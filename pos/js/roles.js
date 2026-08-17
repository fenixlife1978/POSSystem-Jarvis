// ============== ROLES Y PERMISOS + DASHBOARD DE ADMINISTRACIÓN ==============
const _ro = id => document.getElementById(id);

// Conjuntos de permisos por rol.
// null en modulos = acceso total (Administrador: sin restricciones).
const PERMISOS = {
  "Administrador": {
    modulos: null,
    excluidos: null
  },
  "Cajero": {
    modulos: new Set([
      "pos", "buscar", "pago",
      "jarvis-config",
      "clientes",
      "cli-deuda",
      "proveedores",
      "prov-deuda",
      "taller", "taller-nueva", "taller-hist", "taller-aceite", "taller-consulta",
      "devoluciones",
      "ultima-factura",
      "caja", "apertura", "cierre", "arqueo", "movcaja", "cierre-resumen"
    ]),
    excluidos: new Set([
      "clientes-eliminar", "clientes-imprimir", "clientes-exportar",
      "proveedores-eliminar", "proveedores-imprimir", "proveedores-exportar"
    ])
  },
  "Consulta": {
    modulos: new Set([
      "pos", "buscar", "ultima-factura",
      "jarvis-config",
      "clientes", "productos", "servicios", "taller", "taller-hist", "taller-aceite", "taller-consulta", "cotizaciones",
      "devoluciones", "inventario", "reportes", "proveedores",
      "caja", "arqueo", "contabilidad"
    ]),
    excluidos: null
  }
};

const ROL_DEFAULT = "Cajero";

function rolActual() {
  return (DB.parametros && DB.parametros.rolActual) || ROL_DEFAULT;
}

function permisosDe(rol) {
  return PERMISOS[rol] || PERMISOS[ROL_DEFAULT];
}

function rolPuedeModulo(name) {
  const p = permisosDe(rolActual());
  if (p.excluidos && p.excluidos.has(name)) return false;
  if (p.modulos === null) return true;
  return p.modulos.has(name);
}

// ===== Aplicar permisos en la interfaz =====
function aplicarPermisosRol() {
  const rol = rolActual();
  const p = permisosDe(rol);
  document.body.classList.toggle("role-admin", rol === "Administrador");
  document.body.classList.toggle("role-cajero", rol !== "Administrador");
  document.querySelectorAll("[data-perm]").forEach(el => {
    const excl = !!(p.excluidos && p.excluidos.has(el.dataset.perm));
    const ok = !excl && (p.modulos === null || p.modulos.has(el.dataset.perm));
    el.style.display = ok ? "" : "none";
  });
  document.querySelectorAll(".menu-item").forEach(mi => {
    const anyVisible = Array.from(mi.querySelectorAll(".menu-command")).some(b => b.style.display !== "none");
    mi.style.display = anyVisible ? "" : "none";
  });
  if (p.modulos !== null && !p.modulos.has("dashboard")) {
    closeWindow("dashboard-window");
  }
}

// ===== DASHBOARD DE ADMINISTRACIÓN (tipo ERP) =====
function renderDashboard() {
  const dt = _ro("dash-datetime");
  if (dt) dt.textContent = ahoraFechaHora();
  const hoyDia = hoy();
  const mesKey = hoyDia.slice(3);
  const ventas = DB.ventas || [];
  const hoyVentas = ventas.filter(v => v.fecha === hoyDia);
  const mesVentas = ventas.filter(v => v.fecha.slice(3) === mesKey);
  const hoyTotal = hoyVentas.reduce((s, v) => s + v.total, 0);
  const mesTotal = mesVentas.reduce((s, v) => s + v.total, 0);
  const hoyTicket = hoyVentas.length ? hoyTotal / hoyVentas.length : 0;
  const cobradoHoy = (DB.abonos || []).filter(a => a.fecha === hoyDia).reduce((s, a) => s + (a.montoCobrado || 0), 0);
  const carteraCxC = (DB.cuentasCobrar || []).reduce((s, c) => s + (c.saldo || 0), 0);
  const carteraCxP = (DB.cuentasPagar || []).reduce((s, c) => s + (c.saldo || 0), 0);
  const stockBajo = DB.productos.filter(p => p.existencia <= p.minimo && p.categoria !== "SERVICIOS");
  const mesEgresos = (DB.libroDiario || []).filter(e => e.tipo === "egreso" && (e.fecha || "").slice(3) === mesKey);
  const totalEgMes = mesEgresos.reduce((s, e) => s + (e.montoUSD || 0), 0);

  const deudasClientes = {};
  (DB.cuentasCobrar || []).forEach(c => { if ((c.saldo || 0) > 0) deudasClientes[c.nombre] = (deudasClientes[c.nombre] || 0) + (c.saldo || 0); });

  const vendMap = {};
  mesVentas.forEach(v => {
    const cli = DB.clientes.find(x => x.nombre === v.cliente);
    const vn = (cli && cli.vendedor && cli.vendedor !== "--- NINGUNO ---") ? cli.vendedor : "S/D";
    vendMap[vn] = (vendMap[vn] || 0) + v.total;
  });
  const topVendedor = Object.entries(vendMap).sort((a, b) => b[1] - a[1])[0] || null;

  const prodMap = {};
  mesVentas.forEach(v => (v.lineas || []).forEach(l => { prodMap[l.descripcion] = (prodMap[l.descripcion] || 0) + num(l.cantidad); }));
  const topProducto = Object.entries(prodMap).sort((a, b) => b[1] - a[1])[0] || null;

  const dias7 = [];
  for (let i = 6; i >= 0; i--) dias7.push(sumarDias(hoyDia, -i));
  const v7 = dias7.map(d => ventas.filter(v => v.fecha === d).reduce((s, v) => s + v.total, 0));
  const max7 = Math.max.apply(null, v7.concat(1));

  const pagoColor = { "Efectivo Bs.": "#16a34a", "Efectivo USD (físico)": "#0ea5e9", "Pagomóvil": "#8b5cf6", "Biopago": "#ec4899", "Transferencia": "#f59e0b", "Zelle": "#06b6d4", "Tarjeta / Punto": "#6366f1", "Crédito (CxC)": "#ef4444", "Otros": "#64748b" };
  const pagosMes = {};
  mesVentas.forEach(v => (v.pagos || []).forEach(p => { const k = p.metodo; pagosMes[k] = (pagosMes[k] || 0) + (p.equivBs || p.monto || 0); }));
  const totalPagosMes = Object.values(pagosMes).reduce((s, x) => s + x, 0) || 1;
  let acc = 0;
  const segs = Object.entries(pagosMes).map(([k, v]) => {
    const p = (v / totalPagosMes) * 100;
    const s = `${pagoColor[k] || pagoColor.Otros} ${acc.toFixed(2)}% ${(acc + p).toFixed(2)}%`;
    acc += p;
    return s;
  });
  const donut = segs.length ? `background: conic-gradient(${segs.join(", ")})` : "background:#e5e7eb";
  const cxpVenc = (DB.cuentasPagar || []).filter(c => typeof estadoCuentaCXP === "function" && estadoCuentaCXP(c) === "Vencida");
  const ultVentas = ventas.slice().reverse().slice(0, 5);

  const card = (label, value, sub, cls) =>
    `<div class="dash-card"><div class="dash-label">${label}</div><div class="dash-value ${cls || ""}">${value}</div>${sub ? `<div class="dash-sub">${sub}</div>` : ""}</div>`;

  const html =
    `<div class="dash-kpis">      ${card("Ventas de Hoy", fmt(hoyTotal), `${hoyVentas.length} factura(s) · ticket prom. ${fmt(hoyTicket)}`)}
      ${card("Ventas del Mes", fmt(mesTotal), `${mesVentas.length} factura(s)`)}
      ${card("Cobrado Hoy (CxC)", fmtUS(cobradoHoy), `${(DB.abonos || []).filter(a => a.fecha === hoyDia).length} abono(s) · ${fmtBsEq(cobradoHoy)}`)}
      ${card("Cartera por Cobrar", fmtUS(carteraCxC), `${Object.keys(deudasClientes).length} cliente(s) deudor(es) · ${fmtBsEq(carteraCxC)}`, carteraCxC ? "dash-amber" : "dash-green")}
      ${card("Cartera por Pagar", fmtUS(carteraCxP), `Vencidas: ${fmtUS(cxpVenc.reduce((s, c) => s + (c.saldo || 0), 0))}`, carteraCxP ? "dash-amber" : "dash-green")}
      ${card("Stock Bajo", stockBajo.length, `${DB.productos.length} productos en catálogo`, stockBajo.length ? "dash-red" : "dash-green")}
      ${card("Egresos del Mes", fmtUS(totalEgMes), `${mesEgresos.length} egreso(s) · ${fmtBsEq(totalEgMes)}`)}
      ${card("Clientes", DB.clientes.length, `${DB.clientes.filter(c => c.tipo === "Crédito").length} de crédito`)}
    </div>
    <div class="dash-kpis dash-kpis-2">
      ${card("Vendedor Top del Mes", topVendedor ? topVendedor[0] : "—", topVendedor ? `Bs. ${fmt(topVendedor[1])}` : "Sin ventas del mes")}
      ${card("Producto Top del Mes", topProducto ? topProducto[0] : "—", topProducto ? `${fmt(topProducto[1])} unidades vendidas` : "Sin ventas del mes")}
      ${card("Cotizaciones Pendientes", DB.cotizaciones.filter(c => c.estado === "Pendiente").length, `${DB.cotizaciones.length} cotizaciones`)}
      ${card("Usuarios Activos", DB.usuarios.filter(u => u.activo !== false).length, `${DB.usuarios.length} cuentas registradas`)}
    </div>
    <div class="dash-charts">
      <div class="dash-col">
        <div class="dash-col-title">Ventas — últimos 7 días (Bs.)</div>
        <div class="dash-bars">${dias7.map((d, i) =>
          `<div class="dash-bar-col"><div class="dash-bar-track"><div class="dash-bar" style="height:${Math.max(5, Math.round(v7[i] / max7 * 100))}%"></div></div><div class="dash-bar-label">${d.slice(0, 5)}</div><div class="dash-bar-val">${fmt(v7[i])}</div></div>`).join("")}</div>
      </div>
      <div class="dash-col">
        <div class="dash-col-title">Formas de Pago del Mes</div>
        <div class="dash-donut-wrap">
          <div class="dash-donut" style="${donut}"></div>
          <div class="dash-legend">${Object.entries(pagosMes).map(([k, v]) =>
            `<div class="dash-legend-item"><span class="dash-legend-color" style="background:${pagoColor[k] || pagoColor.Otros}"></span>${k} <b>${Math.round(v / totalPagosMes * 100)}%</b></div>`).join("") || `<div class="dash-legend-item">Sin datos del mes</div>`}</div>
        </div>
      </div>
    </div>
    <div class="dash-cols dash-cols3">
      <div class="dash-col">
        <div class="dash-col-title">Últimas Ventas</div>
        <table class="grid">
          <thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th style="text-align:right">Total Bs.</th></tr></thead>
          <tbody>${ultVentas.length ? ultVentas.map(v => `<tr><td>${v.nro}</td><td>${v.fecha}</td><td>${v.cliente}</td><td style="text-align:right">${fmt(v.total)}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:#888">Sin ventas</td></tr>`}</tbody>
        </table>
      </div>
      <div class="dash-col">
        <div class="dash-col-title">Clientes con Deuda</div>
        <table class="grid">
          <thead><tr><th>Cliente</th><th style="text-align:right">Saldo $</th></tr></thead>
          <tbody>${Object.entries(deudasClientes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, s]) => `<tr><td>${n}</td><td style="text-align:right">${fmtUS(s)}<br><span class="usd-sub">${fmtBsEq(s)}</span></td></tr>`).join("") || `<tr><td colspan="2" style="text-align:center;color:#888">Sin deudas</td></tr>`}</tbody>
        </table>
      </div>
      <div class="dash-col">
        <div class="dash-col-title">Cuentas por Pagar Vencidas</div>
        <table class="grid">
          <thead><tr><th>Proveedor</th><th style="text-align:right">Saldo $</th></tr></thead>
          <tbody>${cxpVenc.slice(0, 6).map(c => `<tr><td>${c.proveedor}</td><td style="text-align:right">${fmtUS(c.saldo)}<br><span class="usd-sub">${fmtBsEq(c.saldo)}</span></td></tr>`).join("") || `<tr><td colspan="2" style="text-align:center;color:#888">Sin vencidas</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  const b1 = _ro("admin-main");
  const b2 = _ro("dashboard-body");
  if (b1) b1.innerHTML = html;
  if (b2) b2.innerHTML = html;
}

function abrirDashboard() {
  renderDashboard();
  const main = _ro("admin-main");
  if (main && document.body.classList.contains("role-admin")) {
    document.body.classList.remove("admin-pos-view");
    const tc = _ro("app-title-center");
    if (tc) tc.textContent = "Administración ERP";
    return;
  }
  openModuleWindow("dashboard");
}

// Alterna la vista principal del administrador entre Dashboard y POS
function cambiarVistaAdmin() {
  const pos = document.body.classList.toggle("admin-pos-view");
  const tc = _ro("app-title-center");
  if (tc) tc.textContent = pos ? "Punto de Venta" : "Administración ERP";
  if (pos) {
    setTimeout(() => { const c = document.getElementById("prod-codigo"); if (c) c.focus(); }, 40);
  }
  return pos;
}

// ===== Gateo de ventanas por permiso =====
document.addEventListener("DOMContentLoaded", () => {
  aplicarPermisosRol();
  const orig = window.openModuleWindow;
  if (typeof orig !== "function") return;
  window.openModuleWindow = function(name) {
    if (!rolPuedeModulo(name)) {
      alert("No tiene permisos para acceder a este módulo.");
      return;
    }
    return orig(name);
  };
});

// ===== Refresco del dashboard en tiempo real (solo cuando es visible) =====
function dashboardVisible() {
  if (document.body.classList.contains("role-admin") && !document.body.classList.contains("admin-pos-view")) return true;
  const w = document.getElementById("dashboard-window");
  return w && !w.classList.contains("hidden");
}

function refreshDashboard() {
  if (dashboardVisible()) renderDashboard();
}

let _dashTimer = null;
function iniciarRefrescoDashboard() {
  if (_dashTimer) return;
  _dashTimer = setInterval(() => {
    if (dashboardVisible()) renderDashboard();
  }, 5000);
}
function detenerRefrescoDashboard() {
  if (_dashTimer) { clearInterval(_dashTimer); _dashTimer = null; }
}
