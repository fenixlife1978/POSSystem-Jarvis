// ============== DATA STORE (memoria + localStorage) ==============
const DB = {
  parametros: {
    nombreEmpresa: "",
    rif: "",
    direccion: "",
    telefono: "",
    tasaBCV: 36.50,
    iva: 16,
    serie: "FACT",
    caja: "CAJA 01",
    cajero: "ADMIN",
    turno: 1,
    monedaCxC: "USD",
    pinSupervisor: "1234",
    diasCambioAceite: 90,
    categorias: ["REPUESTOS", "LUBRICANTES", "BATERIAS", "FRENOS", "LLANTAS", "SERVICIOS", "GENERAL"],
    subcategorias: ["FILTROS", "ACEITES", "BATERIAS", "FRENOS", "LLANTAS", "BUJIAS", "CORREAS", "SENSORES", "GENERAL"],
    marcas: ["GENERICO", "FRAM", "WEGA", "MOBIL", "SHELL", "MAC", "NGK", "BREMBO", "FIRESTONE", "MICHELIN", "ACDELCO", "BOSCH", "NAKATA", "FERODO"],
    presentaciones: ["UNIDAD", "CAJA", "LITRO", "KILO", "PIEZA", "PAQUETE", "GALON"],
    unidades: ["UND", "KG", "LT", "GR", "ML", "CAJ"]
  },
  usuarios: [
    { usuario: "ADMIN", nombre: "Administrador", clave: "admin", rol: "Administrador", activo: true },
    { usuario: "CAJERO", nombre: "Cajero", clave: "cajero", rol: "Cajero", activo: true }
  ],
  caja: {
    estado: "cerrada",
    cajero: "ADMIN",
    apertura: null,
    cierre: null,
    fondoBs: 0,
    fondoUSD: 0
  },
  cajas: [
    { id: "CAJA01", nombre: "CAJA 01", cajero: "ADMIN", estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 },
    { id: "CAJA02", nombre: "CAJA 02", cajero: "CAJERO", estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 }
  ],
  clientes: [
    { codigo: "000001", nombre: "CONSUMIDOR FINAL", rif: "V-00000000-0", direccion: "", telefono: "", email: "", tipo: "Contado", limite: 0, dias: 0, vendedor: "--- NINGUNO ---", saldo: 0, tipoPersona: "natural", representante: "" }
  ],
  productos: [],
  cotizaciones: [],
  ordenesTaller: [],
  compras: [],
  devoluciones: [],
  proveedores: [],
  maestroProveedores: [],
  categoriasReporte: ["Ventas", "Compras", "Inventario", "Clientes", "Proveedores", "Caja y Bancos", "Productos", "Servicios"],
  reportes: ["Ventas del Día", "Ventas por Fecha", "Ventas por Cliente", "Ventas por Vendedor", "Ventas por Forma de Pago", "Ventas por Producto", "Ventas por Categoría", "Resumen de Ventas"],
  movimientosCaja: [],
  movimientosInv: [],
  auditoria: [],
  respaldos: [],
  carrito: [],
  ventas: [],
  libroDiario: [],
  abonos: [],
  cuentasCobrar: [],
  cuentasPagar: [],
  pagosPagar: [],
  cambioAceite: []
};

// ============== HELPERS ==============
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === "") return 0;
  let s = String(v).trim().replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    const lc = s.lastIndexOf(",");
    const ld = s.lastIndexOf(".");
    if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const r2 = n => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const getTasa = () => num(DB.parametros.tasaBCV) || 1;
const getIva = () => num(DB.parametros.iva) || 0;

// Conversiones Bs <-> USD usando la tasa del sistema (moneda principal = USD)
const usdDeBs = b => r2(num(b) / getTasa());
const bsDeUsd = u => r2(num(u) * getTasa());
function fmtUS(u) { return "$ " + fmtVE(num(u), 2); }
function fmtBsEq(u) { return "Bs. " + fmtVE(bsDeUsd(u), 2); }
function saldoDual(u) { return fmtUS(u) + "  (" + fmtBsEq(u) + ")"; }

// Formatea montos/precios como XXX.XXX,XX (punto = miles, coma = decimales), independiente del locale del navegador.
function fmtVE(n, dec) {
  const d = dec === undefined || dec === null ? 2 : Math.max(0, Number(dec) || 0);
  let v = Number(n) || 0;
  const neg = v < 0;
  const s = Math.abs(v).toFixed(d);
  const idx = s.indexOf(".");
  const int = idx >= 0 ? s.slice(0, idx) : s;
  const decPart = idx >= 0 ? s.slice(idx + 1) : "";
  const miles = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + miles + (d > 0 ? "," + decPart : "");
}

// Formatea la cédula V-/E- con puntos: 13313521 -> 13.313.521 (XX.XXX.XXX)
function formatearCedulaVe(numDoc) {
  const s = String(numDoc == null ? "" : numDoc).trim();
  const m = s.match(/^([0-9]+?)(?:-([0-9]+))?$/);
  if (!m) return s;
  const cuerpo = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return m[2] !== undefined ? cuerpo + "-" + m[2] : cuerpo;
}

// Formatea el documento completo en el POS: solo personas naturales (V-/E-) llevan puntos
function formatoDocVzla(doc) {
  const m = String(doc || "").match(/^([VEJG])\s*-?\s*([0-9]+)(?:\s*-?\s*([0-9]))?$/i);
  if (!m) return doc;
  const tipo = m[1].toUpperCase();
  if (tipo !== "V" && tipo !== "E") return doc;
  return tipo + "-" + formatearCedulaVe(m[2] + (m[3] !== undefined ? "-" + m[3] : ""));
}

function hoy() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function hora12() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "p.m." : "a.m.";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
function ahoraFechaHora() { return `${hoy()} ${hora12()}`; }

function sumarDias(fechaStr, dias) {
  const p = String(fechaStr || hoy()).split("/");
  const d = new Date(Number(p[2] || 2026), Number(p[1] || 1) - 1, Number(p[0] || 1) + (num(dias) || 0));
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function genNro(arr, campo, prefijo, len) {
  let max = 0;
  arr.forEach(x => {
    const n = parseInt(x[campo], 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefijo + String(max + 1).padStart(len, "0");
}

async function auditar(accion, detalle) {
  // Firma digital por hash encadenado (SHA-256): cada registro firma el hash
  // del anterior, haciendo el log inmutable y detectable ante alteraciones.
  const prev = DB.auditoria[0] ? (DB.auditoria[0].hash || "") : ("S0-" + (DB.parametros && DB.parametros.claveFirma || "POS"));
  const entry = {
    fecha: hoy(), hora: hora12(), usuario: DB.parametros.cajero || "ADMIN",
    accion, detalle,
    prev,
    hash: ""
  };
  const raw = entry.fecha + "|" + entry.hora + "|" + entry.usuario + "|" + accion + "|" + detalle + "|" + prev;
  try {
    if (window.crypto && window.crypto.subtle) {
      const buf = new TextEncoder().encode(raw);
      const dig = await window.crypto.subtle.digest("SHA-256", buf);
      const arr = Array.from(new Uint8Array(dig));
      entry.hash = arr.map(b => b.toString(16).padStart(2, "0")).join("");
    } else {
      entry.hash = "h" + raw.length + "-" + (accion || "").length;
    }
  } catch (e) { entry.hash = "h-fallback"; }
  DB.auditoria.unshift(entry);
  if (DB.auditoria.length > 2000) DB.auditoria.length = 2000;
  saveDB();
}

function movimientoCaja(tipo, ref, montoBs, montoUSD, esIngreso) {
  const m = { fecha: hoy(), hora: hora12(), tipo, ref, ing: 0, egr: 0, ingUsd: 0, egrUsd: 0, caja: cajaActual().nombre };
  if (esIngreso) { m.ing = r2(montoBs); m.ingUsd = r2(montoUSD); }
  else { m.egr = r2(montoBs); m.egrUsd = r2(montoUSD); }
  DB.movimientosCaja.unshift(m);
}

function cajaActual() {
  if (!DB.cajas || !DB.cajas.length) return DB.caja || { estado: "cerrada", cajero: "ADMIN", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0 };
  const cajero = (DB.parametros && DB.parametros.cajero) || "ADMIN";
  const asignada = DB.cajas.find(c => (c.cajero || "") === cajero);
  if (asignada) return asignada;
  const def = DB.cajas.find(c => (c.nombre || "") === (DB.parametros && DB.parametros.caja));
  return def || DB.cajas[0];
}

function cajaDeUsuario(usuario) {
  if (!DB.cajas || !DB.cajas.length) return DB.caja || null;
  return DB.cajas.find(c => (c.cajero || "") === usuario) || null;
}

function sincronizarCajaActiva() {
  const c = cajaActual();
  if (c) {
    DB.parametros.caja = c.nombre;
    DB.caja = c;
  }
}

function movimientoInv(producto, tipo, cant, ref, saldo) {
  DB.movimientosInv.unshift({ fecha: hoy(), hora: hora12(), producto, tipo, cant, ref, saldo });
}

function exportarCSV(nombre, headers, rows, total) {
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const filas = rows.map(r => r.map(esc).join(";"));
  if (total !== null && total !== undefined) filas.push(["TOTAL", ...headers.slice(1).map(() => "").slice(0, -1), fmt(total)].map(esc).join(";"));
  const csv = [headers.map(esc).join(";"), ...filas].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

const _escHtml = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function _colNumero(h) {
  return /(bs|usd|total|cant|precio|saldo|monto|costo|iva|ing|egr|deuda|pvp|margen|dif|esperado|conteo|existencia|minimo|unidades|ventas|abono|devol|%|cantidad)/i.test(h || "");
}

function _basePrintCSS() {
  return `
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:11px;margin:22px;color:#1a1a1a}
    .cabecera{border-bottom:3px solid #0B3D91;padding-bottom:8px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start}
    .empresa{font-size:18px;font-weight:bold;color:#0B3D91;letter-spacing:.4px}
    .empresa-data{font-size:10.5px;color:#333;margin-top:3px}
    .cab-titulo{text-align:right;font-size:14px;font-weight:bold;color:#0B3D91}
    .titulo{font-size:15px;font-weight:bold;color:#0B3D91;text-align:center;margin:4px 0 2px}
    .subtitulo{font-size:11px;color:#555;text-align:center;margin-bottom:4px}
    .meta{font-size:10px;color:#555;text-align:right;margin-bottom:8px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #b9c3d4;padding:4px 6px}
    thead th{background:#0B3D91;color:#fff;font-weight:bold;text-align:left}
    td.num,th.num{text-align:right}
    tbody tr:nth-child(even){background:#f2f5fb}
    tfoot .fila-total td{background:#e9eef9;font-weight:bold;font-size:12px;border-top:2px solid #0B3D91}
    .fila-total td.num{text-align:right}
    .ficha{border:1px solid #b9c3d4;padding:8px;margin:6px 0;font-size:10.5px}
    .ficha table{border:none}
    .ficha td{border:none;padding:2px 4px}
    .ficha .etq{color:#0B3D91;font-weight:bold;width:110px}
    .totales{width:auto;margin-left:auto;margin-top:8px;border-collapse:collapse}
    .totales td{padding:3px 10px;border:1px solid #b9c3d4}
    .totales .lbl{background:#e9eef9;font-weight:bold}
    .totales .gr{background:#0B3D91;color:#fff;font-weight:bold}
    .obs{margin-top:10px;font-size:10.5px}
    .cond{margin-top:12px;font-size:9.5px;color:#444;border-top:1px solid #ccc;padding-top:6px}
    .firmas{display:flex;justify-content:space-between;margin-top:34px;font-size:10.5px;text-align:center}
    .pie{margin-top:16px;font-size:9px;color:#666;border-top:1px solid #ccc;padding-top:6px;text-align:center}
    @media print{body{margin:10mm}}`;
}

function _cabeceraPrintHtml() {
  const p = DB.parametros || {};
  const nombre = _escHtml((p.nombreEmpresa || "MI EMPRESA, C.A.").toUpperCase());
  const rif = p.rif ? "RIF: " + _escHtml(p.rif) : "";
  const dir = p.direccion ? _escHtml(p.direccion) : "";
  const tel = p.telefono ? "Tel.: " + _escHtml(p.telefono) : "";
  const linea = [rif, dir, tel].filter(Boolean).join("  •  ");
  return `<div class="cabecera"><div>
      <div class="empresa">${nombre}</div>
      ${linea ? `<div class="empresa-data">${linea}</div>` : ""}
    </div></div>`;
}

function _metaPrintHtml(titulo, subtitulo) {
  const p = DB.parametros || {};
  const f = `${hoy()}  ${hora12()}`;
  return `<div class="titulo">${_escHtml(titulo)}</div>` +
    (subtitulo ? `<div class="subtitulo">${_escHtml(subtitulo)}</div>` : "") +
    `<div class="meta">Fecha: ${f} &nbsp;|&nbsp; Usuario: ${_escHtml(p.cajero || "ADMIN")}</div>`;
}

function _piePrintHtml() {
  const p = DB.parametros || {};
  return `<div class="pie">Documento generado electrónicamente por el Sistema POS de ${_escHtml(p.nombreEmpresa || "MI EMPRESA")} — La moneda principal del sistema es el Dólar (USD); los montos en Bolívares (Bs.) se muestran como equivalencia al cambio del sistema.</div>`;
}

function _abrirImpresion(titulo, bodyHtml) {
  const w = window.open("", "_blank", "width=900,height=640");
  if (!w) { alert("Permita ventanas emergentes para imprimir."); return; }
  w.document.write(`<html><head><title>${_escHtml(titulo)}</title>
    <style>${_basePrintCSS()}</style></head><body>
    ${_cabeceraPrintHtml()}
    ${bodyHtml}
    ${_piePrintHtml()}
    <script>window.print();<\/script></body></html>`);
  w.document.close();
}

function _tablaReporteHtml(headers, rows, total) {
  const numClass = headers.map(h => _colNumero(h) ? " num" : "");
  const totalRow = (total !== null && total !== undefined)
    ? `<tfoot><tr class="fila-total"><td class="num" colspan="${headers.length}">TOTAL: ${fmt(total)} Bs.</td></tr></tfoot>`
    : "";
  const tbody = rows.map(r =>
    `<tr>${r.map((c, i) => `<td class="${numClass[i].trim()}">${c == null ? "" : _escHtml(c)}</td>`).join("")}</tr>`
  ).join("");
  return `<table><thead><tr>${headers.map((h, i) => `<th class="${numClass[i].trim()}">${_escHtml(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${tbody}</tbody>${totalRow}</table>`;
}

function imprimirHTML(titulo, headers, rows, total, opts) {
  const subtitulo = (opts && opts.subtitulo) || "";
  const body = _metaPrintHtml(titulo, subtitulo) + _tablaReporteHtml(headers, rows, total);
  _abrirImpresion(titulo, body);
}

// Documento profesional personalizado (cotizaciones, facturas, etc.)
function imprimirDocumentoHTML(titulo, bodyHtml) {
  _abrirImpresion(titulo, bodyHtml);
}

// ===== EXPORTAR A PDF / COMPARTIR REPORTES =====
function _bodyReporte(titulo, headers, rows, total, opts) {
  const subtitulo = (opts && opts.subtitulo) || "";
  return _metaPrintHtml(titulo, subtitulo) + _tablaReporteHtml(headers, rows, total);
}

function _documentoPdfHtml(titulo, bodyHtml) {
  return `<html><head><meta charset="utf-8"><title>${_escHtml(titulo)}</title>` +
    `<style>${_basePrintCSS()}</style></head><body>` +
    `${_cabeceraPrintHtml()}${bodyHtml}${_piePrintHtml()}</body></html>`;
}

function _textoReportePlano(titulo, headers, rows, total) {
  const emp = (DB.parametros && DB.parametros.nombreEmpresa) || "MI EMPRESA";
  let t = `${emp} — ${titulo}\nFecha: ${hoy()} ${hora12()}`;
  t += ` | Usuario: ${(DB.parametros && DB.parametros.cajero) || "ADMIN"}\n\n`;
  t += headers.join(" | ") + "\n" + rows.map(r => r.join(" | ")).join("\n");
  if (total !== null && total !== undefined) t += `\n\nTOTAL: ${fmt(total)} Bs.`;
  return t;
}

// Botón Exportar PDF: genera un PDF real (Electron vía printToPDF) o, en navegador, la vista de impresión.
function exportarPDF(titulo, headers, rows, total, opts) {
  const body = _bodyReporte(titulo, headers, rows, total, opts);
  exportarDocumentoPDF(titulo, body);
}

// Exporta un documento con cuerpo HTML propio (cotizaciones, facturas, órdenes de servicio, etc.)
function exportarDocumentoPDF(titulo, bodyHtml) {
  if (window.desktop && typeof window.desktop.exportarPDF === "function") {
    window.desktop.exportarPDF(titulo, _documentoPdfHtml(titulo, bodyHtml)).then(r => {
      if (r && r.ok) alert("PDF exportado: " + r.filePath);
      else if (r && r.msg) alert(r.msg);
    }).catch(() => alert("No se pudo exportar el PDF."));
  } else {
    _abrirImpresion(titulo, bodyHtml);
  }
}

// Botón Compartir: abre la ventana con el texto del reporte para WhatsApp / Correo.
function compartirPDF(titulo, headers, rows, total, opts) {
  const texto = _textoReportePlano(titulo, headers, rows, total);
  window._compartirTexto = texto;
  const t = document.getElementById("compartir-titulo");
  if (t) t.textContent = titulo;
  const a = document.getElementById("compartir-area");
  if (a) a.value = texto;
  abrirModalVentana("compartir-window");
}

function compartirWhatsApp() {
  const texto = window._compartirTexto || "";
  if (!texto) return;
  _abrirExterno("https://wa.me/?text=" + encodeURIComponent(texto));
}

function compartirCorreo() {
  const texto = window._compartirTexto || "";
  if (!texto) return;
  const [linea, ...resto] = texto.split("\n");
  _abrirExterno("mailto:?subject=" + encodeURIComponent(linea) + "&body=" + encodeURIComponent(texto));
}

function compartirCopiar() {
  const a = document.getElementById("compartir-area");
  if (!a) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(a.value).then(() => alert("Texto copiado al portapapeles."));
  } else {
    a.select();
    document.execCommand("copy");
    alert("Texto copiado al portapapeles.");
  }
}

function _abrirExterno(url) {
  const prev = window.open(url, "_blank");
  if (!prev) alert("Permita ventanas emergentes para compartir.");
}

// Muestra una ventana modal centrada sin pasar por el gateo de permisos de módulos.
function abrirModalVentana(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.style.left = Math.max(12, Math.round((window.innerWidth - el.offsetWidth) / 2)) + "px";
  el.style.top = Math.max(12, Math.round((window.innerHeight - el.offsetHeight) / 2)) + "px";
  el.style.zIndex = 9000 + Math.floor(Math.random() * 900);
}

// ============== PERSISTENCIA (IndexedDB + espejo localStorage) ==============
// Guarda en IndexedDB (ilimitado, usa la capa Storage de storage.js) y mantiene
// un espejo en localStorage para arranque instantáneo y como fallback.
const DB_KEY = "pos_sistema_db_v1";
const MIRROR_MAX = 3.5 * 1024 * 1024; // el espejo solo si cabe en cuota (~5 MB navegador)

let _saveTimer = null;
let _saveChain = Promise.resolve();

// Fuerza la escritura pendiente en IndexedDB (no debounced).
function flushSaveDB() {
  clearTimeout(_saveTimer);
  _saveChain = _saveChain.then(() => Storage.save("db", DB)).catch(() => {});
  return _saveChain;
}

function normalizeDB() {
  validarIntegridadDB();
  if (!DB.parametros) DB.parametros = { nombreEmpresa: "Mi Empresa, C.A.", rif: "", tasaBCV: 36.50, iva: 16, serie: "FACT", caja: "CAJA 01", cajero: "ADMIN", turno: 1 };
  if (!DB.parametros.categorias) DB.parametros.categorias = ["REPUESTOS", "LUBRICANTES", "BATERIAS", "FRENOS", "LLANTAS", "SERVICIOS", "GENERAL"];
  if (!DB.parametros.subcategorias) DB.parametros.subcategorias = ["FILTROS", "ACEITES", "BATERIAS", "FRENOS", "LLANTAS", "BUJIAS", "CORREAS", "SENSORES", "GENERAL"];
  if (!DB.parametros.marcas) DB.parametros.marcas = ["GENERICO", "FRAM", "WEGA", "MOBIL", "SHELL", "MAC", "NGK", "BREMBO", "FIRESTONE", "MICHELIN", "ACDELCO", "BOSCH", "NAKATA", "FERODO"];
  if (!DB.parametros.presentaciones) DB.parametros.presentaciones = ["UNIDAD", "CAJA", "LITRO", "KILO", "PIEZA", "PAQUETE", "GALON"];
  if (!DB.parametros.unidades) DB.parametros.unidades = ["UND", "KG", "LT", "GR", "ML", "CAJ"];
  if (!DB.parametros.categoriasGasto || !DB.parametros.categoriasGasto.length) DB.parametros.categoriasGasto = ["NOMINA", "SERVICIOS", "IMPUESTOS", "OTROS_GASTOS"];
  if (!DB.usuarios || !DB.usuarios.length) DB.usuarios = [{ usuario: "ADMIN", nombre: "Administrador", clave: "admin", rol: "Administrador", activo: true }];
  if (!DB.caja) DB.caja = { estado: "cerrada", cajero: "ADMIN", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0 };
  if (!DB.cajas || !DB.cajas.length) {
    DB.cajas = [{ id: "CAJA01", nombre: DB.parametros.caja || "CAJA 01", cajero: DB.caja.cajero || "ADMIN", estado: DB.caja.estado || "cerrada", apertura: DB.caja.apertura, cierre: DB.caja.cierre, fondoBs: DB.caja.fondoBs || 0, fondoUSD: DB.caja.fondoUSD || 0, cortesZ: 0 }];
  }
  if (!DB.movimientosInv) DB.movimientosInv = [];
  if (!DB.auditoria) DB.auditoria = [];
  if (!DB.respaldos) DB.respaldos = [];
  if (!DB.devoluciones) DB.devoluciones = [];
  if (!DB.ventas) DB.ventas = [];
  if (!DB.ordenesTaller) DB.ordenesTaller = [];
  if (!DB.maestroProveedores) DB.maestroProveedores = [];
  if (!DB.libroDiario) DB.libroDiario = [];
  if (!DB.abonos) DB.abonos = [];
  if (!DB.cuentasCobrar) DB.cuentasCobrar = [];
  if (!DB.cuentasPagar) DB.cuentasPagar = [];
  if (!DB.pagosPagar) DB.pagosPagar = [];
  if (!DB.cierresCaja) DB.cierresCaja = [];
  // Colecciones que deben existir siempre (un archivo parcial no debe dejarlas undefined).
  if (!DB.clientes) DB.clientes = [{ codigo: "000001", nombre: "CONSUMIDOR FINAL", rif: "V-00000000-0", direccion: "", telefono: "", email: "", tipo: "Contado", limite: 0, dias: 0, vendedor: "--- NINGUNO ---", saldo: 0, tipoPersona: "natural", representante: "" }];
  if (!DB.productos) DB.productos = [];
  if (!DB.cotizaciones) DB.cotizaciones = [];
  if (!DB.compras) DB.compras = [];
  if (!DB.proveedores) DB.proveedores = [];
  if (!DB.movimientosCaja) DB.movimientosCaja = [];
  if (!DB.servicios) DB.servicios = [];
  if (!DB.categoriasReporte) DB.categoriasReporte = ["Ventas", "Compras", "Inventario", "Clientes", "Proveedores", "Caja y Bancos", "Productos", "Servicios"];
  if (!DB.reportes) DB.reportes = ["Ventas del Día", "Ventas por Fecha", "Ventas por Cliente", "Ventas por Vendedor", "Ventas por Forma de Pago", "Ventas por Producto", "Ventas por Categoría", "Resumen de Ventas"];
  if (!DB.carrito) DB.carrito = [];
  (DB.productos || []).forEach(p => {
    if (p.costoUSD === undefined || p.margenPct === undefined || p.precioUSD === undefined) {
      const tasa = getTasa();
      const pu = p.precioUSD !== undefined ? p.precioUSD : (p.precio || 0) / tasa;
      const margen = p.margenPct !== undefined ? p.margenPct : 25;
      p.precioUSD = r2(pu);
      p.costoUSD = r2(p.costoUSD !== undefined ? p.costoUSD : pu * (1 - margen / 100));
      p.margenPct = r2(((p.precioUSD - p.costoUSD) / p.precioUSD) * 100 || 0);
      p.precio = r2(p.precioUSD * tasa);
    }
    if (p.stockIni === undefined) p.stockIni = p.existencia || 0;
    if (p.subcategoria === undefined) p.subcategoria = "";
    if (p.nroParte === undefined) p.nroParte = "";
    if (p.compatibilidad === undefined) p.compatibilidad = "";
    if (!p.precios || typeof p.precios !== "object") p.precios = {};
    ["mayor", "oferta", "promo"].forEach(k => {
      const defMargen = { mayor: 15, oferta: 20, promo: 25 }[k];
      if (!p.precios[k] || typeof p.precios[k] !== "object") p.precios[k] = { usd: 0, bs: 0, margen: defMargen };
      if (p.precios[k].usd === undefined) p.precios[k].usd = 0;
      if (p.precios[k].bs === undefined) p.precios[k].bs = 0;
      if (p.precios[k].margen === undefined) p.precios[k].margen = defMargen;
    });
  });
  // Sincronizar precios en Bs. con la tasa BCV actual (referencia USD fija).
  // Corrige catálogos congelados a una tasa anterior: precio = precioUSD * tasa.
  if (typeof recalcularPreciosPorTasa === "function") {
    try { recalcularPreciosPorTasa(getTasa()); } catch (e) { console.error("Error sincronizando precios sobre tasa:", e); }
  }
  (DB.clientes || []).forEach(c => { if (c.email === undefined) c.email = ""; if (c.saldo === undefined) c.saldo = 0; if (!c.vehiculos || !Array.isArray(c.vehiculos)) c.vehiculos = []; });
  (DB.movimientosCaja || []).forEach(m => { if (m.ingUsd === undefined) m.ingUsd = 0; if (m.egrUsd === undefined) m.egrUsd = 0; if (!m.caja) m.caja = cajaActual().nombre; });
  migrarCuentasUSD();
  DB.carrito = [];
  sincronizarCajaActiva();
}

// ---------------------------------------------------------------------------
// VERIFICACIÓN DE INTEGRIDAD
// Recorre el objeto DB y repara cualquier corrupción estructural (colecciones
// que no son arreglos, claves faltantes, tipos inválidos). Devoluciones limpia
// el snapshot de claves basura/extrañas, previniendo que un archivo parcial o
// dañado rompa los módulos. Es idempotente y rápida.
// ---------------------------------------------------------------------------
function validarIntegridadDB() {
  const reparados = [];

  // Colecciones que deben ser siempre arreglos.
  const arrays = [
    "usuarios", "cajas", "clientes", "productos", "cotizaciones", "ordenesTaller",
    "compras", "devoluciones", "proveedores", "maestroProveedores", "categoriasReporte",
    "reportes", "movimientosCaja", "movimientosInv", "auditoria", "respaldos",
    "carrito", "ventas", "libroDiario", "abonos", "cuentasCobrar", "cuentasPagar",
    "pagosPagar", "cierresCaja", "servicios"
  ];
  arrays.forEach(k => {
    if (DB[k] === undefined || DB[k] === null || typeof DB[k] !== "object" || !Array.isArray(DB[k])) {
      DB[k] = [];
      reparados.push(k);
    }
  });

  // Objetos que deben existir siempre.
  if (!DB.parametros || typeof DB.parametros !== "object" || Array.isArray(DB.parametros)) {
    DB.parametros = { nombreEmpresa: "Mi Empresa, C.A.", rif: "", tasaBCV: 36.50, iva: 16, serie: "FACT", caja: "CAJA 01", cajero: "ADMIN", turno: 1 };
    reparados.push("parametros");
  }
  if (!DB.caja || typeof DB.caja !== "object" || Array.isArray(DB.caja)) {
    DB.caja = { estado: "cerrada", cajero: "ADMIN", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0 };
    reparados.push("caja");
  }

  // clientes: si quedó vacío tras la reparación, sembrar el cliente genérico.
  if (DB.clientes && DB.clientes.length === 0) {
    DB.clientes.push({ codigo: "000001", nombre: "CONSUMIDOR FINAL", rif: "V-00000000-0", direccion: "", telefono: "", email: "", tipo: "Contado", limite: 0, dias: 0, vendedor: "--- NINGUNO ---", saldo: 0, tipoPersona: "natural", representante: "" });
    reparados.push("clientes:sembrado");
  }

  // Limpieza de claves extrañas que puedan haberse colado (p.ej. "app", "ok" del traspaso de datos).
  const validas = new Set(["parametros", "usuarios", "caja", "cajas", "clientes", "productos",
    "cotizaciones", "ordenesTaller", "compras", "devoluciones", "proveedores", "maestroProveedores",
    "categoriasReporte", "reportes", "movimientosCaja", "movimientosInv", "auditoria", "respaldos",
    "carrito", "ventas", "libroDiario", "abonos", "cuentasCobrar", "cuentasPagar", "pagosPagar",
    "cierresCaja", "servicios", "carrito"]);
  Object.keys(DB).forEach(k => {
    if (!validas.has(k)) { delete DB[k]; reparados.push("clave-extra:" + k); }
  });

  if (reparados.length) {
    console.warn("[integridad] Reparado: " + reparados.join(", "));
    return { reparados };
  }
  return { reparados };
}

// ---------------------------------------------------------------------------
// PODA / LIMPIEZA DE DATOS
// Controla el crecimiento de las colecciones de alta frecuencia. Configurable
// por el usuario vía DB.parametros.poda (días de retención). Se ejecuta al
// cargar la base. Devuelve las cantidades recortadas por colección.
// ---------------------------------------------------------------------------
function podaDatos(force) {
  const cfg = DB.parametros.poda || {};
  const dias = {
    movimientosInv: Math.max(0, parseInt(cfg.movimientosInv, 10) || 0), // 0 = retener todo
    movimientosCaja: Math.max(0, parseInt(cfg.movimientosCaja, 10) || 0),
    ventas: Math.max(0, parseInt(cfg.ventas, 10) || 0),
    abonos: Math.max(0, parseInt(cfg.abonos, 10) || 0),
    pagosPagar: Math.max(0, parseInt(cfg.pagosPagar, 10) || 0),
    libroDiario: Math.max(0, parseInt(cfg.libroDiario, 10) || 0)
  };
  let changed = false;
  const cortados = {};

  function cortar(array, campo, key, reteDias) {
    if (!reteDias) return 0;
    const corte = fechaKeyPoda(sumarDias(hoy(), -reteDias));
    let n = 0;
    for (let i = array.length - 1; i >= 0; i--) {
      const f = fechaKey(array[i][campo]);
      if (f && f < corte) { array.splice(i, 1); n++; changed = true; }
    }
    if (n) cortados[key] = n;
    return n;
  }

  if (dias.movimientosInv) cortar(DB.movimientosInv, "fecha", "movimientosInv", dias.movimientosInv);
  if (dias.movimientosCaja) cortar(DB.movimientosCaja, "fecha", "movimientosCaja", dias.movimientosCaja);
  if (dias.ventas) cortar(DB.ventas, "fecha", "ventas", dias.ventas);
  if (dias.abonos) cortar(DB.abonos, "fecha", "abonos", dias.abonos);
  if (dias.pagosPagar) cortar(DB.pagosPagar, "fecha", "pagosPagar", dias.pagosPagar);
  if (dias.libroDiario) cortar(DB.libroDiario, "fecha", "libroDiario", dias.libroDiario);

  // Auditoría: tope duro (predeterminado 2000), evitando crecimiento infinito.
  if (obtenerRetencionAuditoria() > 0 && DB.auditoria && DB.auditoria.length > obtenerRetencionAuditoria()) {
    DB.auditoria.length = obtenerRetencionAuditoria();
    changed = true;
    cortados.auditoria = DB.auditoria.length;
  }

  if (changed) saveDB();
  return cortados;
}

function obtenerRetencionAuditoria() {
  const cfg = DB.parametros.poda || {};
  return Math.max(0, parseInt(cfg.auditoria, 10) || 2000);
}

// Convierte DD/MM/AAAA a una clave comparable YYYYMMDD.
function fechaKeyPoda(f) {
  const p = String(f || "").split("/");
  return p.length === 3 ? `${p[2] || ""}${p[1] || ""}${p[0] || ""}` : "";
}

// Migración única: convierte CxC/CxP, abonos y saldos de clientes guardados en Bs. a USD
function migrarCuentasUSD() {
  if (!DB.parametros || DB.parametros.monedaCxC === "USD") return;
  const tasa = getTasa();
  (DB.clientes || []).forEach(c => {
    if (c.saldoBs === undefined && c.saldo !== undefined) { c.saldoBs = num(c.saldo); c.saldo = r2(num(c.saldo) / tasa); }
  });
  (DB.cuentasCobrar || []).forEach(c => {
    if (c.totalBs === undefined) {
      c.totalBs = num(c.total); c.total = r2(num(c.total) / tasa);
      c.pagadoBs = num(c.pagado || 0); c.pagado = r2(num(c.pagado || 0) / tasa);
      c.saldoBs = num(c.saldo); c.saldo = r2(num(c.saldo) / tasa);
      c.tasa = tasa;
    }
  });
  (DB.abonos || []).forEach(a => {
    if (a.totalDeudaBs === undefined) {
      a.totalDeudaBs = num(a.totalDeuda); a.totalDeuda = r2(num(a.totalDeuda) / tasa);
      a.montoCobradoBs = num(a.montoCobrado); a.montoCobrado = r2(num(a.montoCobrado) / tasa);
      a.saldoRestanteBs = num(a.saldoRestante); a.saldoRestante = r2(num(a.saldoRestante) / tasa);
      a.tasa = tasa;
    }
  });
  (DB.cuentasPagar || []).forEach(c => {
    if (c.totalBs === undefined) {
      c.totalBs = num(c.total); c.total = r2(num(c.total) / tasa);
      c.pagadoBs = num(c.pagado || 0); c.pagado = r2(num(c.pagado || 0) / tasa);
      c.saldoBs = num(c.saldo); c.saldo = r2(num(c.saldo) / tasa);
      c.tasa = tasa;
    }
  });
  (DB.pagosPagar || []).forEach(p => {
    if (p.montoBs === undefined) { p.montoBs = num(p.monto); p.monto = r2(num(p.monto) / tasa); p.tasa = tasa; }
  });
  // Reconciliación: saldo del cliente = suma de sus cuentas por cobrar en USD
  (DB.clientes || []).forEach(cli => {
    cli.saldo = r2((DB.cuentasCobrar || []).filter(c => c.nombre === cli.nombre).reduce((s, c) => s + (c.saldo || 0), 0));
  });
  DB.parametros.monedaCxC = "USD";
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.keys(DB).forEach(k => {
        if (saved[k] !== undefined) DB[k] = saved[k];
      });
    }
  } catch (e) { console.error("Error cargando espejo local:", e); }
  normalizeDB();
  if (DB.parametros && DB.parametros.servidorRed) Storage.setServer(DB.parametros.servidorRed);
  if (DB.parametros && DB.parametros.modoHibrido) Storage.setHybrid(true);
  const arranque = JSON.stringify(DB);

  // Fuente principal: IndexedDB. Si está vacía (primera vez) se siembra.
  Storage.load("db").then(saved => {
    if (!saved || typeof saved !== "object") {
      podaDatos();
      flushSaveDB();
      return;
    }
    if (document.body.classList.contains("logged-in")) return; // no interrumpir sesión activa
    Object.keys(DB).forEach(k => delete DB[k]);
    Object.assign(DB, saved);
    normalizeDB();
    podaDatos();
    if (JSON.stringify(DB) !== arranque && typeof window.__onDBLoaded === "function") {
      setTimeout(() => window.__onDBLoaded(), 0);
    }
    // En modo híbrido, pedir una sincronización con el servidor al arrancar.
    if (typeof Storage.sync === "function" && Storage.hybridEnabled()) {
      Storage.sync().then(r => {
        if (r && r.merged && !document.body.classList.contains("logged-in")) {
          Object.assign(DB, r.merged);
          normalizeDB();
          saveDB();
          if (typeof window.__onDBLoaded === "function") window.__onDBLoaded();
        }
      });
    }
  }).catch(e => console.error("Error cargando IndexedDB:", e));

  // Migración única: respaldos antiguos guardados en localStorage → IndexedDB.
  if (typeof Storage.migrateLegacyBackups === "function") {
    Storage.migrateLegacyBackups("pos_backup_").catch(e => console.error("Migración de respaldos:", e));
  }

  window.addEventListener("pagehide", () => { flushSaveDB(); });
  window.addEventListener("beforeunload", () => { flushSaveDB(); });
}

function saveDB() {
  try {
    const data = JSON.stringify(DB);
    if (data.length <= MIRROR_MAX) localStorage.setItem(DB_KEY, data);
  } catch (e) { console.error("Espejo localStorage excedido:", e); }
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveChain = _saveChain.then(() => Storage.save("db", DB)).catch(() => {});
  }, 350);
}

function buildEmptyDB() {
  return {
    parametros: {
      nombreEmpresa: "",
      rif: "",
      direccion: "",
      telefono: "",
      tasaBCV: 36.50,
      iva: 16,
      serie: "FACT",
      caja: "CAJA 01",
      cajero: "ADMIN",
      turno: 1,
      monedaCxC: "USD",
      categorias: ["REPUESTOS", "LUBRICANTES", "BATERIAS", "FRENOS", "LLANTAS", "SERVICIOS", "GENERAL"],
      subcategorias: ["FILTROS", "ACEITES", "BATERIAS", "FRENOS", "LLANTAS", "BUJIAS", "CORREAS", "SENSORES", "GENERAL"],
      marcas: ["GENERICO", "FRAM", "WEGA", "MOBIL", "SHELL", "MAC", "NGK", "BREMBO", "FIRESTONE", "MICHELIN", "ACDELCO", "BOSCH", "NAKATA", "FERODO"],
      presentaciones: ["UNIDAD", "CAJA", "LITRO", "KILO", "PIEZA", "PAQUETE", "GALON"],
      unidades: ["UND", "KG", "LT", "GR", "ML", "CAJ"]
    },
    usuarios: [
      { usuario: "ADMIN", nombre: "Administrador", clave: "admin", rol: "Administrador", activo: true },
      { usuario: "CAJERO", nombre: "Cajero", clave: "cajero", rol: "Cajero", activo: true }
    ],
    caja: { estado: "cerrada", cajero: "ADMIN", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0 },
    cajas: [
      { id: "CAJA01", nombre: "CAJA 01", cajero: "ADMIN", estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 },
      { id: "CAJA02", nombre: "CAJA 02", cajero: "CAJERO", estado: "cerrada", apertura: null, cierre: null, fondoBs: 0, fondoUSD: 0, cortesZ: 0 }
    ],
    clientes: [
      { codigo: "000001", nombre: "CONSUMIDOR FINAL", rif: "V-00000000-0", direccion: "", telefono: "", email: "", tipo: "Contado", limite: 0, dias: 0, vendedor: "--- NINGUNO ---", saldo: 0, tipoPersona: "natural", representante: "" }
    ],
    productos: [],
    cotizaciones: [],
    ordenesTaller: [],
    compras: [],
    devoluciones: [],
    proveedores: [],
    maestroProveedores: [],
    categoriasReporte: ["Ventas", "Compras", "Inventario", "Clientes", "Proveedores", "Caja y Bancos", "Productos", "Servicios"],
    reportes: ["Ventas del Día", "Ventas por Fecha", "Ventas por Cliente", "Ventas por Vendedor", "Ventas por Forma de Pago", "Ventas por Producto", "Ventas por Categoría", "Resumen de Ventas"],
    movimientosCaja: [],
    movimientosInv: [],
    auditoria: [],
    respaldos: [],
    carrito: [],
    ventas: [],
    libroDiario: [],
    abonos: [],
    cuentasCobrar: [],
    cuentasPagar: [],
    pagosPagar: []
  };
}

async function resetBaseDeDatos() {
  // Fallback robusto: si el diálogo propio no está disponible, usar confirm nativo.
  let ok = false;
  try { ok = !!(await uiConfirm("¿Borrar TODOS los datos del sistema y comenzar de nuevo?\n\nSe eliminará toda la información (base local, caché, respaldos y auditoría), excepto el usuario y el cliente por defecto.")); }
  catch (e) { ok = confirm("¿Borrar TODOS los datos del sistema y comenzar de nuevo?\n\nSe eliminará toda la información (base local, caché, respaldos y auditoría), excepto el usuario y el cliente por defecto."); }
  if (!ok) return;

  const limpiar = async () => {
    // 1) SQLite local (.db en disco) si corre dentro de Electron.
    if (window.desktop && window.desktop.sqlite && typeof window.desktop.sqlite.clear === "function") {
      try {
        const r = await window.desktop.sqlite.clear();
        if (!r || r.ok === false) console.error("Error limpiando SQLite:", r && r.msg);
      } catch (e) { console.error("Error limpiando SQLite:", e); }
    }
    // 2) Snapshot + caché híbrida en IndexedDB (conserva respaldos).
    try { if (typeof Storage !== "undefined" && typeof Storage.clearLocalPersist === "function") await Storage.clearLocalPersist(); } catch (e) {}
    // 3) Claves de configuración en localStorage (datos de sesión/preferencias).
    try {
      const confKeys = ["pos_sistema_db_v1", "_pos_server_ip", "_pos_hybrid"];
      confKeys.forEach(k => window.localStorage.removeItem(k));
    } catch (e) {}
    // 4) Resetear el DB en memoria a estado limpio (usuarios por defecto + Cliente Final).
    try {
      Object.keys(DB).forEach(k => delete DB[k]);
      Object.assign(DB, buildEmptyDB());
    } catch (e) { console.error("Error reseteando DB en memoria:", e); }
    // 5) Recarga la app: loadDB() arranca desde el estado limpio.
    location.reload();
  };
  limpiar().catch(() => location.reload());
}

loadDB();
