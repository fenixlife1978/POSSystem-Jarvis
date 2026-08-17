// ============== SERVICIOS: mano de obra y precios tridireccionales ==============
const _sv = id => document.getElementById(id);
const TIPOS_SERVICIO = ["Regular", "Promoción", "Combo", "Oferta"];

function esServicio(p) { return p && (p.categoria === "SERVICIOS" || p.tipoServicio); }

function stockVirtualServicio(p) {
  const comps = (p && p.componentes) || [];
  if (!comps.length) return 9999;
  let min = Infinity;
  comps.forEach(c => {
    const prod = DB.productos.find(x => x.codigo === c.codigo);
    const avail = prod ? Math.floor((prod.existencia || 0) / Math.max(1, c.cantidad || 1)) : 0;
    if (avail < min) min = avail;
  });
  return min === Infinity ? 0 : min;
}

// ===== Listado =====
function renderServicios() {
  const body = _sv("servicios-body");
  if (!body) return;
  const rows = filtrarServiciosData();
  body.innerHTML = rows.map(s =>
    `<tr onclick="selectServicio('${s.codigo}')"><td>${s.codigo}</td><td>${s.descripcion}</td></tr>`
  ).join("") || `<tr><td colspan="2" style="text-align:center;color:#888">Sin resultados</td></tr>`;
  if (rows.length) selectServicio(rows[0].codigo);
}

function filtrarServiciosData() {
  const q = (_sv("servicios-search").value || "").trim().toLowerCase();
  return DB.productos.filter(s =>
    esServicio(s) &&
    (!q || s.codigo.toLowerCase().includes(q) || s.descripcion.toLowerCase().includes(q))
  );
}

function buscarServicio() { renderServicios(); }

function selectServicio(cod) {
  const s = DB.productos.find(x => x.codigo === cod);
  if (!s) return;
  selectServicioForm(s);
  document.querySelectorAll("#servicios-body tr").forEach(tr => tr.classList.remove("selected"));
  document.querySelectorAll("#servicios-body tr").forEach(tr => { if (tr.cells[0].textContent === cod) tr.classList.add("selected"); });
}

function selectServicioForm(s) {
  _sv("sv-cod").value = s.codigo || "";
  _sv("sv-desc").value = s.descripcion || "";
  _sv("sv-tipo").value = s.tipoServicio || "Regular";
  _sv("sv-subcat").value = s.subcategoria || "";
  _sv("sv-duracion").value = (s.duracion != null ? s.duracion : "").toString().replace(".", ",");
  _sv("sv-manoobra").value = ((s.manoObraUSD != null ? s.manoObraUSD : 0) || 0).toFixed(2).replace(".", ",");
  _sv("sv-min").value = (s.minimo || 0).toFixed(2).replace(".", ",");
  _sv("sv-inactivo").checked = !!s.inactivo;
  setVal("sv-margen", s.margenPct || 0);
  setVal("sv-precio-usd", s.precioUSD || 0);
  setVal("sv-precio-bs", s.precio || 0);
  actualizarResultadoServicio();
}

function leerServicioForm() {
  const usd = num(_sv("sv-precio-usd").value);
  const bs = num(_sv("sv-precio-bs").value);
  const margen = num(_sv("sv-margen").value);
  return {
    codigo: _sv("sv-cod").value.trim(),
    descripcion: _sv("sv-desc").value.trim(),
    categoria: "SERVICIOS",
    tipoServicio: _sv("sv-tipo").value,
    subcategoria: _sv("sv-subcat").value.trim(),
    duracion: num(_sv("sv-duracion").value),
    manoObraUSD: num(_sv("sv-manoobra").value),
    minimo: num(_sv("sv-min").value),
    inactivo: _sv("sv-inactivo").checked,
    componentes: [],
    costoUSD: r2(num(_sv("sv-manoobra").value)),
    margenPct: r2(margen),
    precioUSD: r2(usd),
    precio: r2(bs)
  };
}

function nuevoServicio() {
  _sv("sv-cod").value = genNro(DB.productos.filter(esServicio), "codigo", "SV-", 5);
  _sv("sv-desc").value = "";
  _sv("sv-tipo").value = "Regular";
  _sv("sv-subcat").value = "";
  _sv("sv-duracion").value = "1";
  _sv("sv-manoobra").value = "0,00";
  _sv("sv-min").value = "0,00";
  _sv("sv-inactivo").checked = false;
  setVal("sv-margen", 0);
  setVal("sv-precio-usd", 0);
  setVal("sv-precio-bs", 0);
  actualizarResultadoServicio();
  document.querySelectorAll("#servicios-body tr").forEach(tr => tr.classList.remove("selected"));
  _sv("sv-desc").focus();
}

function guardarServicio() {
  const s = leerServicioForm();
  if (!s.codigo || !s.descripcion) { alert("Ingrese al menos el código y el nombre del servicio"); return; }
  const idx = DB.productos.findIndex(x => x.codigo === s.codigo);
  const prev = idx >= 0 ? DB.productos[idx] : null;
  if (idx >= 0) DB.productos[idx] = { ...prev, ...s };
  else DB.productos.push(s);
  renderServicios();
  renderInventario();
  auditar(idx >= 0 ? "Servicio actualizado" : "Servicio creado", `${s.codigo} — ${s.descripcion} — PVP Bs. ${fmt(s.precio)}`);
  saveDB();
  selectServicio(s.codigo);
  alert(idx >= 0 ? "Cambios guardados con éxito." : "Servicio guardado con éxito.");
}

async function eliminarServicio() {
  const cod = _sv("sv-cod").value.trim();
  if (!cod) return;
  if (!await uiConfirm(`¿Eliminar el servicio ${cod}?`)) return;
  DB.productos = DB.productos.filter(x => x.codigo !== cod);
  renderServicios();
  renderInventario();
  auditar("Servicio eliminado", cod);
  saveDB();
  if (DB.productos.some(esServicio)) selectServicio(DB.productos.find(esServicio).codigo);
  else nuevoServicio();
}

// ===== Precios tridireccionales =====
function recalcularServicioPrecio(from) {
  const tasa = getTasa();
  const costo = num(_sv("sv-manoobra").value);
  let margen = num(_sv("sv-margen").value);
  let usd = num(_sv("sv-precio-usd").value);
  let bs = num(_sv("sv-precio-bs").value);
  const den = 1 - Math.min(Math.max(margen, 0), 99.99) / 100;
  if (from === "costo" || from === "margen") { usd = den > 0 ? costo / den : 0; bs = usd * tasa; }
  else if (from === "usd") { margen = usd > 0 && costo > 0 ? ((usd - costo) / usd) * 100 : 0; bs = usd * tasa; }
  else if (from === "bs") { usd = bs / tasa; margen = usd > 0 && costo > 0 ? ((usd - costo) / usd) * 100 : 0; }
  if (from !== "margen") setVal("sv-margen", margen);
  if (from !== "usd") setVal("sv-precio-usd", usd);
  if (from !== "bs") setVal("sv-precio-bs", bs);
  actualizarResultadoServicio();
}

function actualizarResultadoServicio() {
  const costo = num(_sv("sv-manoobra").value);
  const usd = num(_sv("sv-precio-usd").value);
  const gan = (usd - costo) * (usd > 0 ? 1 : 0);
  _sv("sv-precio-result").innerHTML =
    `Costo: <b>$ ${fmt(costo)}</b> &nbsp;|&nbsp; PVP: <b>$${fmt(usd)} / ${fmt(num(_sv("sv-precio-bs").value))} Bs.</b> &nbsp;|&nbsp; Ganancia: <b>$${fmt(gan)}</b>`;
}

// ===== Imprimir / Exportar =====
function imprimirServicios() {
  const rows = DB.productos.filter(esServicio).map(s =>
    [s.codigo, s.descripcion, s.tipoServicio || "Regular", "$ " + fmt(s.costoUSD || 0), "$ " + fmt(s.precioUSD || 0), fmt(s.precio || 0)]
  );
  imprimirHTML("Listado de Servicios", ["Código", "Descripción", "Tipo", "Costo $", "PVP $", "PVP Bs."], rows);
}

function exportarServicios() {
  exportarCSV("servicios", ["Codigo", "Descripcion", "Tipo", "CostoUSD", "PVPUSD", "PVPBs"], DB.productos.filter(esServicio).map(s =>
    [s.codigo, s.descripcion, s.tipoServicio || "Regular", s.costoUSD || 0, s.precioUSD || 0, s.precio || 0]
  ));
}

function _datosServicios() {
  return {
    headers: ["Código", "Descripción", "Tipo", "Costo $", "PVP $", "PVP Bs."],
    rows: DB.productos.filter(esServicio).map(s => [s.codigo, s.descripcion, s.tipoServicio || "Regular", "$ " + fmt(s.costoUSD || 0), "$ " + fmt(s.precioUSD || 0), fmt(s.precio || 0)])
  };
}
function exportarPDFServicios() { const d = _datosServicios(); exportarPDF("Listado de Servicios", d.headers, d.rows); }
function compartirServicios() { const d = _datosServicios(); compartirPDF("Listado de Servicios", d.headers, d.rows); }

// ===== Inicialización =====
document.addEventListener("DOMContentLoaded", () => {
  const man = _sv("sv-manoobra");
  if (man) man.addEventListener("input", () => recalcularServicioPrecio("costo"));
  const th = _sv("sv-tasa-hint");
  if (th) th.textContent = fmt(getTasa());
  renderServicios();
});
