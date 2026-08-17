// ============== CAJA: apertura, cierre, arqueo, movimientos, cortes X/Z ==============
const _el = id => document.getElementById(id);

function renderMovimientosCaja() {
  const body = _el("mov-caja-body");
  if (!body) return;
  const caja = cajaActual();
  const nombre = caja ? caja.nombre : "";
  const movs = DB.movimientosCaja.filter(m => !nombre || (m.caja || "") === nombre);
  body.innerHTML = movs.slice(0, 100).map(m =>
    `<tr>
      <td>${m.fecha}</td><td>${m.hora}</td><td>${m.tipo}</td><td>${m.ref}</td>
      <td style="text-align:right">${fmt(m.ing)}</td>
      <td style="text-align:right">${fmt(m.egr)}</td>
      <td style="text-align:right">${m.ingUsd ? "$ " + fmt(m.ingUsd) : ""}</td>
      <td style="text-align:right">${m.egrUsd ? "$ " + fmt(m.egrUsd) : ""}</td>
    </tr>`).join("") || `<tr><td colspan="8" style="text-align:center;color:#888">Sin movimientos</td></tr>`;
  renderCajaInfo();
}

function renderCajaInfo() {
  const caja = cajaActual();
  const est = caja && caja.estado === "abierta" ? "ABIERTA" : "CERRADA";
  _el("caja-nombre").textContent = (caja && caja.nombre) || DB.parametros.caja || "CAJA 01";
  _el("caja-fecha").textContent = caja && caja.apertura ? caja.apertura.split(" ")[0] : hoy();
  _el("caja-estatus").textContent = est;
  _el("caja-estatus").className = "open-status " + (est === "ABIERTA" ? "open" : "closed");
  _el("caja-apertura").textContent = (caja && caja.apertura) || "—";
  _el("caja-cierre").textContent = (caja && caja.cierre) || "—";
  _el("caja-cajero").textContent = (caja && caja.cajero) || DB.parametros.cajero;
  _el("status-caja").textContent = est === "ABIERTA" ? "Caja: ABIERTA" : "Caja: CERRADA";

  const hoyDia = hoy();
  const nombre = (caja && caja.nombre) || "";
  const hoyMovs = DB.movimientosCaja.filter(m => m.fecha === hoyDia && (!nombre || (m.caja || "") === nombre));
  const resumen = {};
  hoyMovs.forEach(m => {
    if (m.ing > 0) resumen[m.tipo] = (resumen[m.tipo] || 0) + m.ing;
    else if (m.egr > 0) resumen[m.tipo] = (resumen[m.tipo] || 0) - m.egr;
  });
  _el("caja-resumen-body").innerHTML = Object.entries(resumen).map(([t, v]) =>
    `<tr><td>${t}:</td><td class="num">${fmt(v)}</td></tr>`).join("") +
    `<tr class="total-row"><td><b>Total Ventas (hoy):</b></td><td class="num"><b>${fmt(DB.ventas.filter(v => v.fecha === hoyDia).reduce((s, v) => s + v.total, 0))}</b></td></tr>`;

  const saldoBs = caja && caja.estado === "abierta" ? (caja.fondoBs || 0) : 0;
  const saldoUsd = caja && caja.estado === "abierta" ? (caja.fondoUSD || 0) : 0;
  let ingBs = 0, egrBs = 0, ingUsd = 0, egrUsd = 0;
  hoyMovs.forEach(m => {
    if (m.tipo === "Apertura de Caja") return;
    ingBs += m.ing || 0; egrBs += m.egr || 0;
    ingUsd += m.ingUsd || 0; egrUsd += m.egrUsd || 0;
  });
  _el("caja-balance-bs").textContent = fmt(saldoBs + ingBs - egrBs);
  _el("caja-balance-usd").textContent = "$ " + fmt(saldoUsd + ingUsd - egrUsd);
}

function abrirCajaModal() {
  const caja = cajaActual();
  if (caja && caja.estado === "abierta") { alert("La caja ya está abierta. Realice el cierre antes de una nueva apertura."); return; }
  _el("ap-fondo-bs").value = "0";
  _el("ap-fondo-usd").value = "0";
  _el("ap-tasa").value = getTasa().toFixed(2).replace(".", ",");
  _el("ap-cajero").value = DB.parametros.cajero || "ADMIN";
  openModuleWindow("apertura");
}

async function confirmarApertura() {
  const fondoBs = num(_el("ap-fondo-bs").value);
  const fondoUsd = num(_el("ap-fondo-usd").value);
  const tasa = num(_el("ap-tasa").value);
  if (tasa <= 0) { alert("Ingrese una tasa BCV válida."); return; }
  const cajero = _el("ap-cajero").value.trim() || DB.parametros.cajero;
  if (!await uiConfirm(`¿Abrir caja con Fondo Inicial de Bs. ${fmt(fondoBs)} y $ ${fmt(fondoUsd)} físicos?`)) return;
  if (Math.abs(tasa - getTasa()) > 0.0001) {
    DB.parametros.tasaBCV = tasa;
    if (typeof recalcularPreciosPorTasa === "function") recalcularPreciosPorTasa(tasa);
    auditar("Tasa BCV actualizada", `Tasa ${fmt(tasa)} al abrir caja`);
  }
  const caja = cajaActual();
  caja.estado = "abierta";
  caja.cajero = cajero;
  caja.apertura = ahoraFechaHora();
  caja.cierre = null;
  caja.fondoBs = fondoBs;
  caja.fondoUSD = fondoUsd;
  caja.tasa = tasa;
  DB.caja = caja;
  sincronizarCajaActiva();
  movimientoCaja("Apertura de Caja", "APERTURA", fondoBs, fondoUsd, true);
  auditar("Apertura de caja", `Caja ${caja.nombre} — Fondo Bs. ${fmt(fondoBs)} / USD $ ${fmt(fondoUsd)} — Tasa ${fmt(tasa)}`);
  saveDB();
  renderMovimientosCaja();
  refreshDashboard();
  refrescarBotonesCaja();
  closeWindow("apertura-window");
  alert("Caja abierta correctamente.");
}

// ===== Botones Abrir / Cerrar Caja en el área del carrito =====
function refrescarBotonesCaja() {
  const abrir = document.getElementById("btn-abrir-caja");
  const cerrar = document.getElementById("btn-cerrar-caja");
  const st = document.getElementById("status-caja");
  const caja = cajaActual();
  const abierta = !!(caja && caja.estado === "abierta");
  if (abrir) abrir.style.display = abierta ? "none" : "";
  if (cerrar) cerrar.style.display = abierta ? "" : "none";
  if (st) st.textContent = "Caja: " + (abierta ? "ABIERTA" : "CERRADA");
}

// ===== ARQUEO DE CAJA / CIERRE CON CONCILIACIÓN =====
const ARQUEO_METODOS = [
  { id: "efectivo_bs",  etiqueta: "Efectivo Bs.",      metodo: "Efectivo Bs.",          moneda: "Bs"  },
  { id: "efectivo_usd", etiqueta: "Efectivo USD",      metodo: "Efectivo USD (físico)", moneda: "USD" },
  { id: "tarjeta",      etiqueta: "Tarjeta",           metodo: "Tarjeta / Punto",       moneda: "Bs"  },
  { id: "biopago",      etiqueta: "Biopago",           metodo: "Biopago",               moneda: "Bs"  },
  { id: "pagomovil",    etiqueta: "Pagomóvil",         metodo: "Pagomóvil",             moneda: "Bs"  },
  { id: "zelle",        etiqueta: "Zelle",             metodo: "Zelle",                 moneda: "USD" },
  { id: "transferencia",etiqueta: "Transferencia",     metodo: "Transferencia",         moneda: "Bs"  }
];

let arqueoFilas = [];

function claseDif(v) { return v > 0 ? "arq-pos" : (v < 0 ? "arq-neg" : "arq-zero"); }

function datosArqueo() {
  const caja = cajaActual();
  const ventasHoy = DB.ventas.filter(v => v.fecha === hoy());
  const devHoy = (DB.devoluciones || []).filter(d => d.fecha === hoy());

  const filas = ARQUEO_METODOS.map(r => {
    const fondo = r.id === "efectivo_bs" ? (caja && caja.fondoBs || 0)
      : r.id === "efectivo_usd" ? (caja && caja.fondoUSD || 0) : 0;
    let ventas = 0, dev = 0;
    ventasHoy.forEach(v => (v.pagos || []).forEach(p => { if (p.metodo === r.metodo) ventas += num(p.monto); }));
    devHoy.forEach(d => {
      const dPag = (d.pagos && d.pagos.length) ? d.pagos : [{ metodo: d.metodo || "Efectivo Bs.", monto: d.total || d.monto || 0 }];
      dPag.forEach(p => { if (p.metodo === r.metodo) dev += num(p.monto); });
    });
    const enSistema = r2(fondo + ventas - dev);
    return { ...r, fondo: r2(fondo), ventas: r2(ventas), dev: r2(dev), enSistema };
  });

  const credito = ventasHoy.reduce((s, v) => s + (v.pagos || []).filter(p => p.metodo === "Crédito (CxC)").reduce((a, p) => a + num(p.equivBs || p.monto || 0), 0), 0);
  const totalVentasBs = ventasHoy.reduce((s, v) => s + (v.pagos || []).filter(p => p.moneda === "Bs" && p.metodo !== "Crédito (CxC)").reduce((a, p) => a + num(p.equivBs || p.monto || 0), 0), 0);
  const totalVentasUsd = ventasHoy.reduce((s, v) => s + (v.pagos || []).filter(p => p.moneda === "USD").reduce((a, p) => a + num(p.monto), 0), 0);

  return {
    caja, ventasHoy, devHoy,
    facturas: ventasHoy.length,
    fondoBs: r2(caja && caja.fondoBs || 0),
    fondoUSD: r2(caja && caja.fondoUSD || 0),
    montoDev: r2(devHoy.reduce((s, d) => s + num(d.total || d.monto || 0), 0)),
    credito: r2(credito),
    iva: r2(ventasHoy.reduce((s, v) => s + num(v.iva), 0)),
    totalVentasBs: r2(totalVentasBs),
    totalVentasUsd: r2(totalVentasUsd),
    filas
  };
}

function cierreCajaModal() {
  const caja = cajaActual();
  if (!caja || caja.estado !== "abierta") { alert("La caja no está abierta."); return; }
  renderArqueo();
  openModuleWindow("arqueo");
}

function renderArqueo() {
  const d = datosArqueo();
  arqueoFilas = d.filas;

  _el("arq-caja").textContent = d.caja ? d.caja.nombre : "—";
  _el("arq-cajero").textContent = (d.caja && d.caja.cajero) || DB.parametros.cajero;
  _el("arq-apertura").textContent = (d.caja && d.caja.apertura) || "—";
  _el("arq-tasa").textContent = fmt(getTasa());
  _el("arq-facturas").textContent = d.facturas;
  _el("arq-fondo-bs").textContent = fmt(d.fondoBs);
  _el("arq-fondo-usd").textContent = "$ " + fmt(d.fondoUSD);
  _el("arq-dev").textContent = fmt(d.montoDev);
  _el("arq-credito").textContent = fmt(d.credito);
  _el("arq-iva").textContent = fmt(d.iva);
  _el("arq-vtas-bs").textContent = fmt(d.totalVentasBs);
  _el("arq-vtas-usd").textContent = "$ " + fmt(d.totalVentasUsd);

  const head = `<thead><tr><th>Concepto</th><th class="r">Fondo Inicial</th><th class="r">Ventas</th><th class="r">Devoluciones</th><th class="r">En Sistema</th><th class="r">Real</th><th class="r">Diferencia</th></tr></thead>`;
  const rows = d.filas.map((f, i) => {
    const cur = f.moneda === "USD" ? "$ " : "";
    return `<tr>
      <td>${f.etiqueta} <span class="arq-cur">${f.moneda}</span></td>
      <td class="r">${cur}${fmt(f.fondo)}</td>
      <td class="r">${cur}${fmt(f.ventas)}</td>
      <td class="r">${cur}${fmt(f.dev)}</td>
      <td class="r"><b>${cur}${fmt(f.enSistema)}</b></td>
      <td class="r"><input type="text" inputmode="decimal" class="input-real" id="arq-real-${i}" data-moneda="${f.moneda}" placeholder="0,00" oninput="calcularArqueo()"></td>
      <td class="r"><span class="arq-diff arq-zero" id="arq-diff-${i}">0,00</span></td>
    </tr>`;
  }).join("");

  _el("arqueo-body").innerHTML = head + rows +
    `<tfoot><tr class="total-row">
      <td><b>TOTAL DIFERENCIA</b></td><td></td><td></td><td></td><td></td><td></td>
      <td class="r"><span class="arq-diff arq-zero" id="arq-tot-bs">0,00</span> Bs.<br><span class="arq-diff arq-zero" id="arq-tot-usd">0,00</span> $</td>
    </tr></tfoot>`;

  calcularArqueo();
}

function calcularArqueo() {
  let totBs = 0, totUsd = 0, pendiente = false;
  arqueoFilas.forEach((f, i) => {
    const inp = document.getElementById("arq-real-" + i);
    const raw = inp ? inp.value.trim() : "";
    const el = document.getElementById("arq-diff-" + i);
    if (raw === "") {
      pendiente = true;
      if (el) { el.textContent = "—"; el.className = "arq-diff arq-zero"; }
      return;
    }
    const real = num(raw);
    const dif = r2(real - f.enSistema);
    if (el) {
      el.textContent = (f.moneda === "USD" ? "$ " : "") + fmt(dif);
      el.className = "arq-diff " + claseDif(dif);
    }
    if (f.moneda === "Bs") totBs += dif; else totUsd += dif;
  });
  totBs = r2(totBs); totUsd = r2(totUsd);

  const eBs = document.getElementById("arq-tot-bs");
  const eUsd = document.getElementById("arq-tot-usd");
  eBs.textContent = fmt(totBs); eBs.className = "arq-diff " + claseDif(totBs);
  eUsd.textContent = fmt(totUsd); eUsd.className = "arq-diff " + claseDif(totUsd);

  const badge = document.getElementById("arq-conciliacion");
  if (pendiente) {
    badge.textContent = "CONTEO PENDIENTE — escriba el Real de cada método (0 si no recibió)";
    badge.className = "cr-badge pendiente";
  } else if (totBs === 0 && totUsd === 0) {
    badge.textContent = "CONCILIADA EXACTA (Cero)";
    badge.className = "cr-badge exacta";
  } else {
    const partes = [];
    if (totBs < 0) partes.push("FALTANTE Bs. " + fmt(Math.abs(totBs)));
    if (totUsd < 0) partes.push("FALTANTE USD $ " + fmt(Math.abs(totUsd)));
    if (totBs > 0) partes.push("SOBRANTE Bs. " + fmt(totBs));
    if (totUsd > 0) partes.push("SOBRANTE USD $ " + fmt(totUsd));
    badge.textContent = partes.join(" · ") || "—";
    badge.className = "cr-badge " + (totBs < 0 || totUsd < 0 ? "faltante" : "sobrante");
  }
}

async function confirmarCierre() {
  const caja = cajaActual();
  if (!caja || caja.estado !== "abierta") { alert("La caja no está abierta."); return; }
  for (let i = 0; i < arqueoFilas.length; i++) {
    const inp = document.getElementById("arq-real-" + i);
    if (!inp || inp.value.trim() === "") {
      alert("Complete el conteo REAL de cada método de pago antes de cerrar (escriba 0 si no recibió ese método).");
      if (inp) inp.focus();
      return;
    }
  }
  const filas = arqueoFilas.map((f, i) => {
    const real = num(document.getElementById("arq-real-" + i).value);
    return { ...f, real: r2(real), diff: r2(real - f.enSistema) };
  });
  let conteoBs = 0, conteoUsd = 0, esperadoBs = 0, esperadoUsd = 0;
  filas.forEach(f => {
    if (f.moneda === "Bs") { conteoBs += f.real; esperadoBs += f.enSistema; }
    else { conteoUsd += f.real; esperadoUsd += f.enSistema; }
  });
  const diffBs = r2(conteoBs - esperadoBs);
  const diffUsd = r2(conteoUsd - esperadoUsd);
  if (!await uiConfirm(`Confirmar cierre de caja ${caja.nombre}.\nConteo Bs.: ${fmt(conteoBs)}  ·  Conteo USD: $ ${fmt(conteoUsd)}\nDiferencia Bs.: ${fmt(diffBs)}  ·  Diferencia USD: $ ${fmt(diffUsd)}\n¿Continuar?`)) return;

  const nombre = caja.nombre;
  const movs = DB.movimientosCaja.filter(m => m.fecha === hoy() && m.tipo !== "Apertura de Caja" && (!nombre || (m.caja || "") === nombre));
  let ingBs = 0, egrBs = 0, ingUsd = 0, egrUsd = 0;
  movs.forEach(m => { ingBs += m.ing || 0; egrBs += m.egr || 0; ingUsd += m.ingUsd || 0; egrUsd += m.egrUsd || 0; });

  caja.estado = "cerrada";
  caja.cierre = ahoraFechaHora();
  DB.caja = caja;
  sincronizarCajaActiva();
  movimientoCaja("Cierre de Caja", "CIERRE", 0, 0, false);

  const partes = [];
  if (diffBs > 0) partes.push("SOBRANTE Bs. " + fmt(diffBs));
  else if (diffBs < 0) partes.push("FALTANTE Bs. " + fmt(Math.abs(diffBs)));
  if (diffUsd > 0) partes.push("SOBRANTE USD $ " + fmt(diffUsd));
  else if (diffUsd < 0) partes.push("FALTANTE USD $ " + fmt(Math.abs(diffUsd)));
  const conciliado = (diffBs === 0 && diffUsd === 0) ? "CONCILIADA EXACTA" : (partes.join(" · ") || "—");

  const cierre = {
    id: String(DB.cierresCaja.length + 1).padStart(5, "0"),
    caja: nombre,
    cajero: caja.cajero || DB.parametros.cajero,
    fecha: hoy(),
    horaApertura: caja.apertura || "",
    horaCierre: caja.cierre,
    fondoBs: caja.fondoBs || 0, fondoUSD: caja.fondoUSD || 0,
    ingBs, egrBs, ingUsd, egrUsd,
    esperadoBs, esperadoUsd, conteoBs, conteoUsd,
    diffBs, diffUsd, conciliado,
    detalle: filas.map(f => ({ metodo: f.etiqueta, moneda: f.moneda, fondo: f.fondo, ventas: f.ventas, dev: f.dev, enSistema: f.enSistema, real: f.real, diff: f.diff }))
  };
  DB.cierresCaja.unshift(cierre);

  auditar("Cierre de caja", `Caja ${nombre} — Conteo Bs. ${fmt(conteoBs)} / USD $ ${fmt(conteoUsd)} — ${conciliado}`);
  saveDB();
  renderMovimientosCaja();
  refreshDashboard();
  refrescarBotonesCaja();
  closeWindow("arqueo-window");
  abrirResumenCierre(cierre);
}

// ===== RESUMEN DE CIERRE (conciliación sobró / faltó / exacta) =====
function abrirResumenCierre(r) {
  window._ultimoCierre = r;
  renderResumenCierre(r);
  openModuleWindow("cierre-resumen");
}

function renderResumenCierre(r) {
  if (!r) return;
  _el("cr-caja").textContent = r.caja;
  _el("cr-cajero").textContent = r.cajero;
  _el("cr-apertura").textContent = r.horaApertura || "—";
  _el("cr-cierre").textContent = r.horaCierre || "—";
  _el("cr-fondo").textContent = `Bs. ${fmt(r.fondoBs)}  ·  $ ${fmt(r.fondoUSD)}`;
  _el("cr-ingresos").textContent = `Bs. ${fmt(r.ingBs)}  ·  $ ${fmt(r.ingUsd)}`;
  _el("cr-egresos").textContent = `Bs. ${fmt(r.egrBs)}  ·  $ ${fmt(r.egrUsd)}`;
  _el("cr-esperado").textContent = `Bs. ${fmt(r.esperadoBs)}  ·  $ ${fmt(r.esperadoUsd)}`;
  _el("cr-conteo").textContent = `Bs. ${fmt(r.conteoBs)}  ·  $ ${fmt(r.conteoUsd)}`;
  _el("cr-diferencia").textContent = `Bs. ${fmt(r.diffBs)}  ·  $ ${fmt(r.diffUsd)}`;
  const exacta = (r.diffBs || 0) === 0 && (r.diffUsd || 0) === 0;
  const faltante = (r.diffBs || 0) < 0 || (r.diffUsd || 0) < 0;
  const badge = _el("cr-conciliacion");
  badge.textContent = r.conciliado || (exacta ? "CONCILIADA EXACTA" : "NO CONCILIADA");
  badge.className = "cr-badge " + (exacta ? "exacta" : (faltante ? "faltante" : "sobrante"));
}

function imprimirResumenCierre() {
  const r = window._ultimoCierre;
  if (!r) return alert("No hay un resumen de cierre.");
  imprimirHTML(`Cierre de Caja ${r.caja} — ${r.fecha}`, ["Concepto", "Valor"], [
    ["Caja", r.caja],
    ["Cajero", r.cajero],
    ["Apertura", r.horaApertura || "—"],
    ["Cierre", r.horaCierre || "—"],
    ["Fondo inicial", `Bs. ${fmt(r.fondoBs)} · $ ${fmt(r.fondoUSD)}`],
    ["Ingresos", `Bs. ${fmt(r.ingBs)} · $ ${fmt(r.ingUsd)}`],
    ["Egresos", `Bs. ${fmt(r.egrBs)} · $ ${fmt(r.egrUsd)}`],
    ["Esperado en caja", `Bs. ${fmt(r.esperadoBs)} · $ ${fmt(r.esperadoUsd)}`],
    ["Conteo físico", `Bs. ${fmt(r.conteoBs)} · $ ${fmt(r.conteoUsd)}`],
    ["Diferencia", `Bs. ${fmt(r.diffBs)} · $ ${fmt(r.diffUsd)}`],
    ["Conciliación", r.conciliado]
  ]);
  if (r.detalle && r.detalle.length) {
    imprimirHTML(`Arqueo de Caja ${r.caja} — ${r.fecha} (desglose)`,
      ["Concepto", "Fondo", "Ventas", "Dev.", "En Sistema", "Real", "Dif."],
      r.detalle.map(d => [`${d.metodo} (${d.moneda})`, fmt(d.fondo), fmt(d.ventas), fmt(d.dev), fmt(d.enSistema), fmt(d.real), fmt(d.diff)]));
  }
}

function nuevoMovCaja() {
  _el("mov-monto").value = "";
  _el("mov-ref").value = "";
  _el("mov-tipo").value = "Ingreso";
  openModuleWindow("movcaja");
}

function guardarMovCaja() {
  const tipo = _el("mov-tipo").value;
  const concepto = _el("mov-concepto").value;
  const moneda = _el("mov-moneda").value;
  const monto = num(_el("mov-monto").value);
  let ref = _el("mov-ref").value.trim();
  if (monto <= 0) { alert("Ingrese un monto válido"); return; }
  const esIngreso = tipo === "Ingreso";
  if (!ref) ref = (esIngreso ? "ING-" : "EGR-") + String(DB.movimientosCaja.length + 1).padStart(6, "0");
  movimientoCaja(concepto, ref, moneda === "USD" ? 0 : monto, moneda === "USD" ? monto : 0, esIngreso);
  auditar("Movimiento de caja", `${tipo} — ${concepto} (${moneda}) ${fmt(monto)}`);
  saveDB();
  renderMovimientosCaja();
  closeWindow("movcaja-window");
}

function abrirArqueo() {
  const caja = cajaActual();
  if (!caja || caja.estado !== "abierta") { alert("La caja no está abierta. No hay arqueo que mostrar."); return; }
  renderArqueo();
  openModuleWindow("arqueo");
}

function imprimirArqueo() {
  const d = datosArqueo();
  const rows = d.filas.map((f, i) => {
    const inp = document.getElementById("arq-real-" + i);
    const v = inp ? inp.value.trim() : "";
    const real = v !== "" ? num(v) : null;
    const dif = real !== null ? r2(real - f.enSistema) : null;
    return [`${f.etiqueta} (${f.moneda})`, fmt(f.fondo), fmt(f.ventas), fmt(f.dev), fmt(f.enSistema),
      real !== null ? fmt(real) : "—", dif !== null ? fmt(dif) : "—"];
  });
  imprimirHTML(`Arqueo de Caja — ${d.caja ? d.caja.nombre : ""} (${hoy()})`,
    ["Concepto", "Fondo Inicial", "Ventas", "Devoluciones", "En Sistema", "Real", "Diferencia"],
    rows.concat([["TOTAL VENTAS Bs.", "", "", "", "", fmt(d.totalVentasBs), ""],
                 ["TOTAL VENTAS USD", "", "", "", "", "$ " + fmt(d.totalVentasUsd), ""],
                 ["Facturas emitidas", "", "", "", "", String(d.facturas), ""],
                 ["Total devoluciones", "", "", "", "", fmt(d.montoDev), ""],
                 ["Total venta a crédito", "", "", "", "", fmt(d.credito), ""],
                 ["Total I.V.A.", "", "", "", "", fmt(d.iva), ""]]));
}

function imprimirCaja() {
  const caja = cajaActual();
  imprimirHTML("Movimientos de Caja", ["Fecha", "Hora", "Tipo", "Ref", "Ing. Bs", "Egr. Bs", "Ing. $", "Egr. $"], DB.movimientosCaja.filter(m => !caja || (m.caja || "") === caja.nombre).map(m => [m.fecha, m.hora, m.tipo, m.ref, fmt(m.ing), fmt(m.egr), m.ingUsd ? "$ " + fmt(m.ingUsd) : "", m.egrUsd ? "$ " + fmt(m.egrUsd) : ""]));
}

// ============== CORTES X Y Z (exigencia fiscal venezolana) ==============
function datosCorteDia(caja) {
  const nombre = caja ? caja.nombre : "";
  const movs = DB.movimientosCaja.filter(m => (!nombre || (m.caja || "") === nombre));
  const hoyMovs = movs.filter(m => m.fecha === hoy());
  const ventasHoy = DB.ventas.filter(v => v.fecha === hoy());
  const devolucionesHoy = (DB.devoluciones || []).filter(d => d.fecha === hoy());

  let ingBs = 0, egrBs = 0, ingUsd = 0, egrUsd = 0;
  hoyMovs.forEach(m => { ingBs += m.ing || 0; egrBs += m.egr || 0; ingUsd += m.ingUsd || 0; egrUsd += m.egrUsd || 0; });

  const formas = {};
  ventasHoy.forEach(v => {
    (v.pagos || []).forEach(p => {
      const k = p.metodo + (p.moneda ? " (" + p.moneda + ")" : "");
      formas[k] = (formas[k] || 0) + (p.equivBs || p.monto || 0);
    });
  });
  const detFormas = Object.entries(formas).map(([k, v]) => ({ k, v }));

  const iva = r2(ventasHoy.reduce((s, v) => s + (v.iva || 0), 0));
  const subtotal = r2(ventasHoy.reduce((s, v) => s + (v.subtotal || 0), 0));
  const desc = r2(ventasHoy.reduce((s, v) => s + (v.descuento || 0), 0));
  const totalVentas = r2(ventasHoy.reduce((s, v) => s + v.total, 0));
  const nFacturas = ventasHoy.length;
  const nDev = devolucionesHoy.length;
  const montoDev = r2(devolucionesHoy.reduce((s, d) => s + (d.monto || d.total || 0), 0));

  return {
    caja, nombre, hoyMovs,
    ventasHoy, devolucionesHoy,
    ingBs, egrBs, ingUsd, egrUsd,
    formas: detFormas,
    iva, subtotal, desc, totalVentas, nFacturas,
    nDev, montoDev,
    esperadoBs: r2((caja && caja.estado === "abierta" ? (caja.fondoBs || 0) : 0) + ingBs - egrBs),
    esperadoUsd: r2((caja && caja.estado === "abierta" ? (caja.fondoUSD || 0) : 0) + ingUsd - egrUsd)
  };
}

function encabezadoEmpresa() {
  return `${DB.parametros.nombreEmpresa || "Mi Empresa, C.A."}<br>` +
    `RIF: ${DB.parametros.rif || ""} — Dir: ${DB.parametros.direccion || ""}<br>` +
    `Tel: ${DB.parametros.telefono || ""}`;
}

function cuerpoCorte(d, tipo, nroCorte) {
  const rows = [];
  rows.push([`Empresa`, encabezadoEmpresa()]);
  rows.push([`Caja`, d.nombre]);
  rows.push([`Cajero`, (d.caja && d.caja.cajero) || DB.parametros.cajero]);
  rows.push([`Fecha de emisión`, ahoraFechaHora()]);
  if (nroCorte) rows.push([`Nº de Corte`, nroCorte]);
  rows.push([`Tipo de Reporte`, tipo]);
  if (tipo === "CORTE X") rows.push(["Indicación", "Reporte intermedio de la jornada. No cierra la caja."]);
  else rows.push(["Indicación", "Reporte de cierre de la jornada fiscal. Requiere caja abierta."]);

  rows.push(["---", ""]);
  rows.push(["VENTAS DEL DÍA", ""]);
  rows.push(["Facturas emitidas", String(d.nFacturas)]);
  rows.push(["Subtotal", fmt(d.subtotal) + " Bs."]);
  rows.push(["Descuentos", fmt(d.desc) + " Bs."]);
  rows.push(["I.V.A. (" + getIva() + " %)", fmt(d.iva) + " Bs."]);
  rows.push(["TOTAL VENTAS", fmt(d.totalVentas) + " Bs."]);
  if (d.formas.length) {
    rows.push(["---", ""]);
    rows.push(["DESGLOSE POR FORMA DE PAGO", ""]);
    d.formas.forEach(f => rows.push([f.k, fmt(f.v) + " Bs."]));
  }
  if (d.nDev) {
    rows.push(["---", ""]);
    rows.push(["DEVOLUCIONES", ""]);
    rows.push(["Notas de devolución", String(d.nDev)]);
    rows.push(["Monto devuelto", fmt(d.montoDev) + " Bs."]);
  }
  rows.push(["---", ""]);
  rows.push(["RESUMEN DE CAJA (hoy)", ""]);
  rows.push(["Ingresos Bs.", fmt(d.ingBs) + " Bs."]);
  rows.push(["Egresos Bs.", fmt(d.egrBs) + " Bs."]);
  rows.push(["Ingresos USD", "$ " + fmt(d.ingUsd)]);
  rows.push(["Egresos USD", "$ " + fmt(d.egrUsd)]);
  rows.push(["Esperado en caja Bs.", fmt(d.esperadoBs) + " Bs."]);
  rows.push(["Esperado en caja USD", "$ " + fmt(d.esperadoUsd)]);
  return rows;
}

function imprimirCorte(tipo, esCierre) {
  const caja = cajaActual();
  if (!caja) { alert("No hay una caja activa."); return; }
  if (esCierre && caja.estado !== "abierta") { alert("La caja debe estar ABIERTA para emitir el Corte Z."); return; }
  const d = datosCorteDia(caja);

  let nroCorte = null;
  if (esCierre) {
    caja.cortesZ = (caja.cortesZ || 0) + 1;
    nroCorte = (caja.cortesZ);
    DB.caja = caja;
    sincronizarCajaActiva();
  } else {
    nroCorte = (caja.cortesZ || 0) + 1; // siguiente número proyectado, sin registrar
  }

  const rows = cuerpoCorte(d, tipo, nroCorte ? String(nroCorte) : null);
  const titulo = `CORTE ${tipo} — Caja ${caja.nombre}`;

  imprimirCorteHTML(titulo, rows, tipo, esCierre, caja, d);

  auditar(esCierre ? "Corte Z emitido" : "Corte X emitido", `Caja ${caja.nombre} — Ventas Bs. ${fmt(d.totalVentas)} — ${d.nFacturas} factura(s)`);
  if (esCierre) saveDB();
  renderMovimientosCaja();
}

function imprimirCorteHTML(titulo, rows, tipo, esCierre, caja, d) {
  const w = window.open("", "_blank", "width=780,height=1000");
  if (!w) { alert("Permita ventanas emergentes para imprimir el corte."); return; }
  const firma = `<tr><td colspan="2" style="padding-top:26px;text-align:center">_________________________</td></tr>
                 <tr><td colspan="2" style="text-align:center">Firma del Cajero</td></tr>
                 <tr><td colspan="2" style="padding-top:18px;text-align:center">_________________________</td></tr>
                 <tr><td colspan="2" style="text-align:center">Firma del Supervisor</td></tr>`;
  w.document.write(`<html><head><title>${titulo}</title>
    <style>
      body{font-family:"Courier New",monospace;font-size:11px;margin:14px}
      h2{font-size:15px;margin:0 0 4px 0}
      .hdr{text-align:center;margin-bottom:10px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #000;padding:3px 5px;text-align:left}
      th{background:#eee}
      .tot{font-weight:bold;background:#efe}
    </style></head><body>
    <div class="hdr">
      <h2>${DB.parametros.nombreEmpresa || "Mi Empresa, C.A."}</h2>
      <div>RIF: ${DB.parametros.rif || ""} &nbsp;|&nbsp; ${DB.parametros.direccion || ""}</div>
      <div>Tel: ${DB.parametros.telefono || ""}</div>
      <h3 style="margin:8px 0 2px 0">${titulo}</h3>
      <div>Emitido: ${ahoraFechaHora()} &nbsp;|&nbsp; Cajero: ${DB.parametros.cajero}</div>
    </div>
    <table>
      ${rows.map(r => `<tr${r[0] && (r[0].startsWith("VENTAS") || r[0].startsWith("RESUMEN") || r[0].startsWith("DESGLOSE") || r[0].startsWith("DEVOLUC")) ? ' class="tot"' : ""}><td style="width:55%">${r[0]}</td><td>${r[1]}</td></tr>`).join("")}
      ${firma}
    </table>
    <script>window.print();<\/script></body></html>`);
  w.document.close();
}

function corteX() { imprimirCorte("X", false); }
function corteZ() { imprimirCorte("Z", true); }

document.addEventListener("DOMContentLoaded", () => {
  renderMovimientosCaja();
  refrescarBotonesCaja();
});
