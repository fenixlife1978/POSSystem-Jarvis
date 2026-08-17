// ============== TALLER / ÓRDENES DE SERVICIO ==============
const _t$ = id => document.getElementById(id);

let ordenTemp = [];
let ordenEditNro = null;
let ordenSelNro = null;

// ===== SEGUIMIENTO DE CAMBIO DE ACEITE (servicio programado) =====
// Cada cambio de aceite registrado por cliente y vehículo tiene un contador
// regresivo (DB.parametros.diasCambioAceite, por defecto 90 días). Al vencer
// corresponde un nuevo servicio; el sistema recuerda 2 días antes de la fecha
// límite.

function esCambioAceite(o) {
  const texto = ((o.trabajo || "") + " " + (o.notas || "") + " " + (o.lineas || []).map(l => (l.descripcion || "") + " " + (l.codigo || "")).join(" ")).toUpperCase();
  return /CAMBIO\s+DE\s+ACEITE|CAMBIO\s+ACEITE/.test(texto);
}

function fechaFechaKey(f) {
  const p = String(f || "").split("/");
  return p.length === 3 ? (p[2] + p[1] + p[0]) : "";
}

function diasEntre(f1, f2) {
  const p1 = String(f1 || "").split("/");
  const p2 = String(f2 || "").split("/");
  if (p1.length !== 3 || p2.length !== 3) return 0;
  const d1 = new Date(Number(p1[2]), Number(p1[1]) - 1, Number(p1[0]));
  const d2 = new Date(Number(p2[2]), Number(p2[1]) - 1, Number(p2[0]));
  return Math.round((d2 - d1) / 86400000);
}

function claveCambioAceite(cliente, placa) {
  return String(cliente || "").trim().toUpperCase() + "||" + String(placa || "").trim().toUpperCase().replace(/\s+/g, "");
}

function registrarCambioAceite(o) {
  if (!esCambioAceite(o)) return;
  DB.cambioAceite = DB.cambioAceite || [];
  const dias = Math.max(1, num(DB.parametros.diasCambioAceite) || 90);
  const clave = claveCambioAceite(o.cliente, o.placa);
  const fec = o.fecha || hoy();
  const rec = DB.cambioAceite.find(r => r.clave === clave);
  if (rec) {
    // Conservar la fecha del último cambio (el más reciente) para el contador.
    if (fechaFechaKey(fec) > fechaFechaKey(rec.fecha)) {
      rec.fecha = fec; rec.nro = o.nro; rec.placa = o.placa || rec.placa;
      rec.marca = o.marca || rec.marca; rec.modelo = o.modelo || rec.modelo;
      rec.proxima = sumarDias(fec, dias);
    }
  } else {
    DB.cambioAceite.push({
      clave, cliente: o.cliente || "", placa: o.placa || "",
      marca: o.marca || "", modelo: o.modelo || "", nro: o.nro, fecha: fec,
      proxima: sumarDias(fec, dias)
    });
  }
}

function contadorCambioAceite(cliente, placa) {
  const rec = (DB.cambioAceite || []).find(r => r.clave === claveCambioAceite(cliente, placa));
  if (!rec) return null;
  const dias = Math.max(1, num(DB.parametros.diasCambioAceite) || 90);
  const restantes = dias - diasEntre(rec.fecha, hoy());
  return { fecha: rec.fecha, proxima: rec.proxima || sumarDias(rec.fecha, dias), restantes };
}

// Vehículos de clientes cuyo cambio de aceite ya venció o vence en los próximos
// 2 días (aviso anticipado). Devuelve la lista de registros pendientes.
function vehiculosCambioAceitePendientes() {
  const regs = (DB.cambioAceite || []).slice();
  const pend = [];
  regs.forEach(r => {
    const dias = Math.max(1, num(DB.parametros.diasCambioAceite) || 90);
    const proxima = r.proxima || sumarDias(r.fecha, dias);
    const restantes = diasEntre(hoy(), proxima);
    if (restantes <= 2) pend.push({ ...r, proxima, restantes });
  });
  return pend;
}

// ----- Recordatorio en pantalla -----
function mostrarRecordatorioServicios() {
  const pend = vehiculosCambioAceitePendientes();
  if (!pend.length) return;
  const cia = _t$("taller-rec-body");
  if (cia) {
    cia.innerHTML = pend.map(p =>
      `<tr>
        <td>${_escHtml(p.cliente)}</td>
        <td>${_escHtml([p.placa, p.marca, p.modelo].filter(Boolean).join(" ")) || "—"}</td>
        <td>${_escHtml(p.fecha)}</td>
        <td style="text-align:right">${_escHtml(p.proxima)}</td>
        <td style="text-align:right">${p.restantes <= 0 ? `<b style="color:#b00000">VENCIDO</b>` : `<b style="color:#92400e">${p.restantes} día${p.restantes === 1 ? "" : "s"}</b>`}</td>
      </tr>`).join("");
  }
  abrirModalVentana("taller-rec-window");
}

function cerrarRecordatorioServicios() { closeWindow("taller-rec-window"); }

function tallerEstadoBadge(estado) {
  const map = { "Recibido": "tal-rec", "En Proceso": "tal-proc", "Listo": "tal-list", "Entregado": "tal-entre", "Anulada": "tal-anu" };
  return `<span class="tal-badge ${map[estado] || "tal-rec"}">${_escHtml(estado)}</span>`;
}

function ordenTotalBs(o) {
  return (o.lineas || []).reduce((s, l) => s + num(l.total), 0);
}

function ordenTotalUsd(o) {
  const t = getTasa() || 1;
  return (o.lineas || []).reduce((s, l) => s + num(l.totalUSD || (l.precioUSD || l.precio / t) * l.cantidad), 0);
}

function ordenTallerSel() {
  return DB.ordenesTaller.find(x => x.nro === ordenSelNro) || null;
}

// ===== LISTADO =====
function renderOrdenesTaller() {
  const body = _t$("ordenes-taller-body");
  if (!body) return;
  const rows = filtrarOrdenesTallerData();
  body.innerHTML = rows.map(o =>
    `<tr data-nro="${o.nro}" class="${(o.nro === ordenSelNro ? "selected " : "") + "cursor"}" onclick="selectOrdenTaller('${o.nro}', this)">
      <td>${o.nro}</td><td>${o.fecha}</td><td>${o.hora}</td><td>${_escHtml(o.cliente)}</td>
      <td>${o.placa ? `<b class="taller-placa">${_escHtml(o.placa)}</b> — ${_escHtml(o.marca || "")} ${_escHtml(o.modelo || "")}` : "—"}</td>
      <td>${_escHtml(o.trabajo || "")}</td>
      <td style="text-align:right">${fmt(ordenTotalBs(o))}</td>
      <td>${tallerEstadoBadge(o.estado)}</td>
    </tr>`
  ).join("");
  const list = _t$("ordenes-taller-body");
  if (!rows.length) { renderOrdenTallerDetalle(null); return; }
  if (!rows.find(r => r.nro === ordenSelNro)) selectOrdenTaller(rows[0].nro, list.querySelector("tr"));
}

function filtrarOrdenesTallerData() {
  const q = (_t$("tal-search").value || "").trim().toLowerCase();
  const est = (_t$("tal-estado") || {}).value;
  return DB.ordenesTaller.slice().reverse().filter(o =>
    (!q || o.nro.toLowerCase().includes(q) || (o.cliente || "").toLowerCase().includes(q) ||
      (o.placa || "").toLowerCase().replace(/\s+/g, "").includes(q.replace(/\s+/g, "")) || (o.trabajo || "").toLowerCase().includes(q)) &&
    (est === "Todos" || o.estado === est)
  );
}

function filtrarOrdenesTaller() { renderOrdenesTaller(); }

function selectOrdenTaller(nro, row) {
  ordenSelNro = nro;
  document.querySelectorAll("#ordenes-taller-body tr").forEach(tr => tr.classList.remove("selected"));
  if (row) row.classList.add("selected");
  const o = DB.ordenesTaller.find(x => x.nro === nro);
  renderOrdenTallerDetalle(o);
}

function renderOrdenTallerDetalle(o) {
  const t = getTasa() || 1;
  const lineasEl = _t$("taller-lineas-body");
  const fichaEl = _t$("taller-ficha");
  const timeEl = _t$("taller-timeline");
  const actEl = _t$("taller-acciones");
  if (!o) {
    if (lineasEl) lineasEl.innerHTML = "";
    if (fichaEl) fichaEl.innerHTML = '<div style="color:#888;padding:8px">Seleccione una orden de servicio.</div>';
    if (timeEl) timeEl.innerHTML = "";
    if (actEl) actEl.innerHTML = "";
    if (_t$("taller-totales")) _t$("taller-totales").textContent = "";
    if (_t$("taller-historial")) _t$("taller-historial").innerHTML = "";
    return;
  }
  if (lineasEl) {
    lineasEl.innerHTML = (o.lineas || []).map(l =>
      `<tr><td>${_escHtml(l.codigo)}</td><td>${_escHtml(l.descripcion)}</td>` +
      `<td style="text-align:right">${fmt(l.cantidad)}</td><td style="text-align:right">${fmt(l.precio)}</td>` +
      `<td style="text-align:right">${fmt(num(l.totalUSD || (l.precioUSD || l.precio / t) * l.cantidad))}</td>` +
      `<td style="text-align:right">${fmt(l.total)}</td></tr>`
    ).join("") || '<tr><td colspan="6" style="text-align:center;color:#888">Sin líneas</td></tr>';
  }
  const sub = ordenTotalBs(o);
  const iva = sub * (getIva() / 100);
  if (_t$("taller-totales")) _t$("taller-totales").innerHTML =
    `Sub-Total: <b>${fmt(sub)}</b> · I.V.A. (${getIva()}%): <b>${fmt(iva)}</b> · <span class="taller-total">TOTAL: <b>${fmt(sub + iva)} Bs.</b></span>`;
  const vehiculo = [o.placa, o.marca, o.modelo, o.anio, o.color].filter(Boolean).join(" ");
  const cAceite = contadorCambioAceite(o.cliente, o.placa);
  let aceiteHtml = "";
  if (cAceite) {
    const texto = cAceite.restantes > 0
      ? `Próximo servicio en <b>${cAceite.restantes}</b> días (${cAceite.proxima})`
      : `⚠ VENCE EL SERVICIO — corresponde un nuevo cambio de aceite`;
    aceiteHtml = `<div class="taller-aceite ${cAceite.restantes > 0 ? "" : "vencido"}">🛢️ Cambio de Aceite (${cAceite.fecha}) → <span>${texto}</span></div>`;
  }
  if (fichaEl) fichaEl.innerHTML =
    `<div class="taller-veh-box">
       <div><b>Cliente:</b> ${_escHtml(o.cliente)} ${o.clienteCodigo ? `(${_escHtml(o.clienteCodigo)})` : ""}</div>
       <div><b>Vehículo:</b> ${vehiculo ? `<span class="taller-placa">${_escHtml(vehiculo)}</span>` : "—"}</div>
       <div><b>Trabajo / Diagnóstico:</b> ${_escHtml(o.trabajo || "—")}</div>
       ${o.notas ? `<div><b>Notas:</b> ${_escHtml(o.notas)}</div>` : ""}
       ${o.ventaRef ? `<div><b>Factura:</b> ${_escHtml(o.ventaRef)}</div>` : ""}
       ${aceiteHtml}
     </div>`;
  if (timeEl) {
    const fila = (n, v) => v ? `<div><b>${n}:</b> ${v}</div>` : "";
    timeEl.innerHTML =
      `<div class="taller-timeline">` + fila("Ingreso", o.fechaIngreso + (o.horaIngreso ? " " + o.horaIngreso : "")) +
      fila("Inicio de trabajo", o.fechaInicio + (o.horaInicio ? " " + o.horaInicio : "")) +
      fila("Culminación", o.fechaCulminacion + (o.horaCulminacion ? " " + o.horaCulminacion : "")) +
      fila("Entrega", o.fechaEntrega + (o.horaEntrega ? " " + o.horaEntrega : "")) +
      (o.motivoAnulacion ? `</div><div style="margin-top:4px"><span class="tal-badge tal-anu">Anulada: ${_escHtml(o.motivoAnulacion)}</span></div>` : "</div>");
  }
  if (actEl) actEl.innerHTML = accionesOrdenTaller(o);
  renderHistorialTaller(o);
}

function accionesOrdenTaller(o) {
  const btns = [];
  if (o.estado === "Recibido") {
    btns.push(`<button class="mod-btn" onclick="cambiarEstadoOrdenTaller('En Proceso')">▶ Iniciar Trabajo</button>`);
    btns.push(`<button class="mod-btn" onclick="cobrarEntregarOrdenTaller()">💰 Cobrar</button>`);
    btns.push(`<button class="mod-btn" onclick="entregarCreditoOrdenTaller()">🚪 Entregar a Crédito</button>`);
    btns.push(`<button class="mod-btn" onclick="editarOrdenTaller()">✏️ Editar</button>`);
  } else if (o.estado === "En Proceso") {
    btns.push(`<button class="mod-btn" onclick="cambiarEstadoOrdenTaller('Listo')">✔ Marcar Listo</button>`);
    btns.push(`<button class="mod-btn" onclick="cobrarEntregarOrdenTaller()">💰 Cobrar</button>`);
    btns.push(`<button class="mod-btn" onclick="entregarCreditoOrdenTaller()">🚪 Entregar a Crédito</button>`);
    btns.push(`<button class="mod-btn" onclick="editarOrdenTaller()">✏️ Editar</button>`);
  } else if (o.estado === "Listo") {
    btns.push(`<button class="mod-btn" onclick="cobrarEntregarOrdenTaller()">💰 Cobrar y Entregar</button>`);
    btns.push(`<button class="mod-btn" onclick="entregarCreditoOrdenTaller()">🚪 Entregar a Crédito</button>`);
    btns.push(`<button class="mod-btn" onclick="editarOrdenTaller()">✏️ Editar</button>`);
  }
  if (o.estado === "Entregado" && o.cxcId) {
    btns.push(`<span class="tal-badge tal-entre">Crédito — CxC ${_escHtml(o.cxcId)} (vence ${_escHtml(o.vencimiento || "—")})</span>`);
  }
  if (o.estado !== "Entregado" && o.estado !== "Anulada") {
    btns.push(`<button class="mod-btn" onclick="anularOrdenTaller()">❌ Anular</button>`);
  } else if (o.estado === "Entregado" && !o.ventaNro) {
    btns.push(`<button class="mod-btn" onclick="anularOrdenTaller()">❌ Anular</button>`);
  }
  if (o.estado === "Entregado" && o.ventaNro) {
    btns.push(`<span class="tal-badge tal-entre">Cobrado — Factura ${_escHtml(o.ventaRef || o.ventaNro)}</span>`);
  }
  if (!btns.length) return "";
  return `<div class="pago-actions">${btns.join("")}</div>`;
}

function renderHistorialTaller(o) {
  const hist = _t$("taller-historial");
  if (!hist) return;
  if (!o) { hist.innerHTML = ""; return; }
  const previas = DB.ordenesTaller.slice().reverse().filter(x =>
    x.nro !== o.nro && x.cliente === o.cliente
  ).slice(0, 30);
  if (!previas.length) { hist.innerHTML = '<div style="color:#888;padding:4px">Sin órdenes anteriores para este cliente.</div>'; return; }
  hist.innerHTML = previas.map(x => {
    const esPlaca = x.placa && o.placa && x.placa.toUpperCase().replace(/\s+/g, "") === o.placa.toUpperCase().replace(/\s+/g, "");
    return `<div class="taller-hist-item" onclick="selectOrdenTaller('${x.nro}', document.querySelector('#ordenes-taller-body tr[data-nro=&quot;${x.nro}&quot;]'))">
      <span>${x.nro} · ${x.fecha} · ${_escHtml(x.placa || "—")} ${esPlaca ? " <b>(misma placa)</b>" : ""}</span>
      ${tallerEstadoBadge(x.estado)}
    </div>`;
  }).join("");
}

// ===== NUEVA / EDITAR =====
function nuevaOrdenTaller() {
  ordenTemp = [];
  ordenEditNro = null;
  _t$("tal-n-nro").value = genNro(DB.ordenesTaller, "nro", "", 7);
  _t$("tal-n-fecha").value = hoy();
  _t$("tal-n-trabajo").value = "";
  _t$("tal-n-obs").value = "";
  _t$("tal-n-placa").value = ""; _t$("tal-n-marca").value = ""; _t$("tal-n-modelo").value = ""; _t$("tal-n-anio").value = ""; _t$("tal-n-color").value = "";
  fillClienteSelectTaller("tal-n-cliente");
  renderOrdenNueva();
  openModuleWindow("taller-nueva");
}

function editarOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) { alert("Seleccione una orden"); return; }
  if (o.estado === "Entregado" || o.estado === "Anulada") { alert("No puede editar una orden entregada o anulada."); return; }
  ordenEditNro = o.nro;
  _t$("tal-n-nro").value = o.nro;
  _t$("tal-n-fecha").value = o.fecha;
  _t$("tal-n-trabajo").value = o.trabajo || "";
  _t$("tal-n-obs").value = o.notas || "";
  fillClienteSelectTaller("tal-n-cliente", o.cliente);
  const sel = _t$("tal-n-vehiculo");
  const vs = tallerVehiculosCliente();
  const v = vs.find(x => x.id === o.vehiculoId);
  sel.value = v ? v.id : (o.placa ? "__nuevo__" : "");
  if (v) { _t$("tal-n-placa").value = v.placa; _t$("tal-n-marca").value = v.marca || ""; _t$("tal-n-modelo").value = v.modelo || ""; _t$("tal-n-anio").value = v.anio || ""; _t$("tal-n-color").value = v.color || ""; }
  else { _t$("tal-n-placa").value = o.placa || ""; _t$("tal-n-marca").value = o.marca || ""; _t$("tal-n-modelo").value = o.modelo || ""; _t$("tal-n-anio").value = o.anio || ""; _t$("tal-n-color").value = o.color || ""; }
  onCambioVehiculoTaller();
  ordenTemp = (o.lineas || []).map(l => ({ ...l }));
  renderOrdenNueva();
  openModuleWindow("taller-nueva");
}

function fillClienteSelectTaller(selId, seleccionado) {
  const sel = _t$(selId);
  if (!sel) return;
  sel.innerHTML = DB.clientes.map(c => `<option ${c.nombre === seleccionado ? "selected" : ""}>${_escHtml(c.nombre)}</option>`).join("");
  fillVehiculosTaller();
}

function tallerVehiculosCliente() {
  const cli = DB.clientes.find(c => c.nombre === _t$("tal-n-cliente").value);
  return cli && Array.isArray(cli.vehiculos) ? cli.vehiculos : [];
}

function fillVehiculosTaller() {
  const sel = _t$("tal-n-vehiculo");
  if (!sel) return;
  const prev = sel.value;
  const vs = tallerVehiculosCliente();
  sel.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = vs.length ? "Seleccionar vehículo..." : "Sin vehículos — registre uno nuevo...";
  sel.appendChild(opt);
  vs.forEach(v => {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = `${v.placa} — ${v.marca || ""} ${v.modelo || ""}${v.anio ? " " + v.anio : ""}${v.color ? " (" + v.color + ")" : ""}`.replace(/\s+/g, " ").trim();
    sel.appendChild(o);
  });
  const optN = document.createElement("option");
  optN.value = "__nuevo__";
  optN.textContent = "➕ Nuevo vehículo...";
  sel.appendChild(optN);
  if (prev) sel.value = prev;
  onCambioVehiculoTaller();
}

function onCambioVehiculoTaller() {
  const sel = _t$("tal-n-vehiculo");
  const row = _t$("tal-n-veh-row");
  if (!sel || !row) return;
  const nuevo = sel.value === "__nuevo__";
  row.classList.toggle("visible", nuevo);
  if (!nuevo) {
    const v = tallerVehiculosCliente().find(x => x.id === sel.value);
    if (v) {
      _t$("tal-n-placa").value = v.placa || "";
      _t$("tal-n-marca").value = v.marca || "";
      _t$("tal-n-modelo").value = v.modelo || "";
      _t$("tal-n-anio").value = v.anio || "";
      _t$("tal-n-color").value = v.color || "";
    } else {
      _t$("tal-n-placa").value = ""; _t$("tal-n-marca").value = ""; _t$("tal-n-modelo").value = ""; _t$("tal-n-anio").value = ""; _t$("tal-n-color").value = "";
    }
  }
}

function tallerDatosVehiculo() {
  const nuevo = _t$("tal-n-vehiculo").value === "__nuevo__";
  const placa = _t$("tal-n-placa").value.trim().toUpperCase().replace(/\s+/g, "");
  const marca = _t$("tal-n-marca").value.trim();
  const modelo = _t$("tal-n-modelo").value.trim();
  const anio = _t$("tal-n-anio").value.trim();
  const color = _t$("tal-n-color").value.trim();
  const cli = DB.clientes.find(c => c.nombre === _t$("tal-n-cliente").value);
  let vehiculoId = _t$("tal-n-vehiculo").value;
  if (nuevo && cli && placa) {
    let v = (cli.vehiculos || []).find(x => (x.placa || "").toUpperCase().replace(/\s+/g, "") === placa);
    if (!v) {
      v = { id: "VH" + Date.now(), placa, marca, modelo, anio, color };
      cli.vehiculos = cli.vehiculos || [];
      cli.vehiculos.push(v);
    } else {
      v.marca = marca; v.modelo = modelo; v.anio = anio; v.color = color;
    }
    vehiculoId = v.id;
  }
  return { vehiculoId, placa, marca, modelo, anio, color };
}

// ===== LÍNEAS (repuestos / servicios) =====
let talSelectedCod = null;

function talProdMatches(p, q) {
  const hay = `${p.codigo} ${p.descripcion || ""}`.toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function buscarProductoOrden() {
  const term = _t$("tal-n-prod").value.trim().toLowerCase();
  const list = _t$("tal-n-prod-results");
  if (!term) { list.innerHTML = ""; list.style.display = "none"; return; }
  const prods = DB.productos.filter(p => talProdMatches(p, term)).slice(0, 10);
  list.innerHTML = prods.map((p, i) =>
    `<div class="prov-result" onmousedown="event.preventDefault();seleccionarProductoOrden(${i})">
       <b>${_escHtml(p.codigo)}</b> — ${_escHtml(p.descripcion)} <span class="usd-sub">Bs. ${fmt(p.precio || 0)} (${fmt((p.precio || 0) / (getTasa() || 1))} $)</span>
     </div>`).join("");
  list.style.display = prods.length ? "block" : "none";
}

function seleccionarProductoOrden(i) {
  const term = _t$("tal-n-prod").value.trim().toLowerCase();
  const prods = DB.productos.filter(p => talProdMatches(p, term)).slice(0, 10);
  const p = prods[i];
  if (!p) return;
  talSelectedCod = p.codigo;
  _t$("tal-n-prod").value = `${p.codigo} — ${p.descripcion}`;
  _t$("tal-n-prod-results").style.display = "none";
  if (!num(_t$("tal-n-precio").value)) _t$("tal-n-precio").value = String((p.precio || 0).toFixed(2)).replace(".", ",");
  mostrarPrecioOrdenUsd();
  _t$("tal-n-cant").focus();
  _t$("tal-n-cant").select();
}

function ocultarProductoOrdenResults() {
  const list = _t$("tal-n-prod-results");
  if (list) list.style.display = "none";
}

function onProductoOrdenKey(ev) {
  if (ev.key === "Enter") {
    ev.preventDefault();
    const list = _t$("tal-n-prod-results");
    if (list && list.children.length) seleccionarProductoOrden(0);
    else agregarLineaOrden();
  } else if (ev.key === "Escape") {
    ocultarProductoOrdenResults();
  }
}

function mostrarPrecioOrdenUsd() {
  const t = getTasa() || 1;
  _t$("tal-n-precio-usd").textContent = `= ${fmt(num(_t$("tal-n-precio").value) / t)} $`;
}

function agregarLineaOrden() {
  const raw = _t$("tal-n-prod").value.trim();
  if (!raw) { alert("Busque y seleccione un producto"); return; }
  let p = talSelectedCod ? DB.productos.find(x => x.codigo === talSelectedCod) : null;
  if (!p || raw !== `${p.codigo} — ${p.descripcion}`) {
    const txt = raw.toLowerCase();
    p = DB.productos.find(x => x.codigo.toLowerCase() === txt) ||
        DB.productos.find(x => (x.descripcion || "").toLowerCase() === txt);
  }
  if (!p) { alert("Producto no encontrado"); return; }
  const cant = num(_t$("tal-n-cant").value) || 1;
  const precio = num(_t$("tal-n-precio").value) || p.precio || 0;
  const t = getTasa() || 1;
  ordenTemp.push({
    codigo: p.codigo, descripcion: p.descripcion, cantidad: cant,
    precio, precioUSD: precio / t,
    total: cant * precio, totalUSD: cant * precio / t
  });
  renderOrdenNueva();
  talSelectedCod = null;
  _t$("tal-n-prod").value = ""; _t$("tal-n-cant").value = "1"; _t$("tal-n-precio").value = "";
  _t$("tal-n-precio-usd").textContent = "= 0,00 $";
  _t$("tal-n-prod").focus();
}

function renderOrdenNueva() {
  const t = getTasa() || 1;
  _t$("tal-n-body").innerHTML = ordenTemp.map((d, i) =>
    `<tr><td>${_escHtml(d.codigo)}</td><td>${_escHtml(d.descripcion)}</td><td style="text-align:right">${fmt(d.cantidad)}</td>` +
    `<td style="text-align:right">${fmt(d.precio)}</td><td style="text-align:right">${fmt(d.precioUSD || d.precio / t)}</td>` +
    `<td style="text-align:right">${fmt(d.total)}</td><td style="text-align:right">${fmt(d.totalUSD || d.total / t)}</td>` +
    `<td><button class="btn-mini" onclick="quitarLineaOrden(${i})">✕</button></td></tr>`
  ).join("");
  const sub = ordenTemp.reduce((s, d) => s + d.total, 0);
  const iva = sub * (getIva() / 100);
  _t$("tal-n-sub").textContent = fmt(sub);
  _t$("tal-n-iva").textContent = fmt(iva);
  _t$("tal-n-total").textContent = fmt(sub + iva);
}

function quitarLineaOrden(i) { ordenTemp.splice(i, 1); renderOrdenNueva(); }

function guardarOrdenTaller() {
  if (!ordenTemp.length) { alert("Agregue al menos un servicio o repuesto"); return; }
  const vh = tallerDatosVehiculo();
  const nro = _t$("tal-n-nro").value.trim();
  const cliente = _t$("tal-n-cliente").value;
  const cli = DB.clientes.find(c => c.nombre === cliente);
  const trabajo = _t$("tal-n-trabajo").value.trim();
  const notas = _t$("tal-n-obs").value.trim();
  const existente = DB.ordenesTaller.find(x => x.nro === nro);
  const base = existente ? { ...existente } : {
    nro, fecha: hoy(), hora: hora12(),
    estado: "Recibido",
    fechaIngreso: hoy(), horaIngreso: hora12(), fechaInicio: null, horaInicio: null,
    fechaCulminacion: null, horaCulminacion: null, fechaEntrega: null, horaEntrega: null,
    ventaNro: null, ventaRef: null
  };
  const orden = {
    ...base,
    fecha: _t$("tal-n-fecha").value || base.fecha,
    cliente, clienteCodigo: cli ? cli.codigo : "",
    vehiculoId: vh.vehiculoId, placa: vh.placa, marca: vh.marca, modelo: vh.modelo, anio: vh.anio, color: vh.color,
    trabajo, notas, lineas: ordenTemp.map(l => ({ ...l }))
  };
  const idx = DB.ordenesTaller.findIndex(x => x.nro === nro);
  if (idx >= 0) DB.ordenesTaller[idx] = orden;
  else DB.ordenesTaller.push(orden);
  const total = ordenTotalBs(orden);
  registrarCambioAceite(orden);
  auditar("Taller", `${ordenEditNro ? "Editada" : "Creada"} orden ${nro} — ${cliente}${vh.placa ? " · " + vh.placa : ""} — ${fmt(total)} Bs.`);
  saveDB();
  ordenSelNro = nro;
  renderOrdenesTaller();
  closeWindow("taller-nueva-window");
  alert(ordenEditNro ? "Cambios guardados con éxito." : "Orden de servicio creada con éxito.");
}

// ===== ESTADOS / ACCIONES =====
function cambiarEstadoOrdenTaller(estado) {
  const o = ordenTallerSel();
  if (!o) return;
  const nowH = hoy();
  const nowT = hora12();
  if (estado === "En Proceso") { o.estado = "En Proceso"; o.fechaInicio = nowH; o.horaInicio = nowT; }
  else if (estado === "Listo") { o.estado = "Listo"; o.fechaCulminacion = nowH; o.horaCulminacion = nowT; }
  else if (estado === "Entregado" && o.estado === "Listo") { o.estado = "Entregado"; o.fechaEntrega = nowH; o.horaEntrega = nowT; }
  else return;
  auditar("Taller", `Orden ${o.nro} → ${estado}`);
  saveDB();
  renderOrdenesTaller();
}

async function anularOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) return;
  if (o.estado === "Anulada") return;
  const motivo = await uiPrompt("Motivo de anulación:", "");
  if (motivo === null) return;
  o.estado = "Anulada";
  o.fechaAnulacion = hoy();
  o.horaAnulacion = hora12();
  o.motivoAnulacion = motivo.trim() || "No especificado";
  auditar("Taller", `Orden ${o.nro} anulada — ${o.motivoAnulacion}`);
  saveDB();
  renderOrdenesTaller();
}

function cobrarEntregarOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) return;
  if (o.estado === "Entregado" || o.estado === "Anulada") { alert("La orden ya fue entregada o anulada."); return; }
  if (!o.lineas || !o.lineas.length) { alert("La orden no tiene líneas para facturar."); return; }
  if (!cajaAbierta()) { alert("PRIMERO DEBE APERTURAR LA CAJA para poder cobrar la orden."); return; }
  if (DB.carrito.length) { alert("Finalice o anule la venta actual antes de cobrar esta orden."); return; }
  const t = getTasa() || 1;
  DB.carrito = o.lineas.map(l => ({
    codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad,
    precio: l.precio, precioUSD: l.precioUSD !== undefined ? l.precioUSD : l.precio / t,
    descuento: 0, total: l.cantidad * l.precio
  }));
  _t$("cliente-nombre").value = o.cliente;
  const cli = DB.clientes.find(c => c.nombre === o.cliente);
  if (cli) _t$("cliente-codigo").value = cli.codigo;
  const obs = _t$("observaciones");
  if (obs) obs.value = `Orden de servicio ${o.nro}` + (o.placa ? ` · Placa ${o.placa}` : "") + (o.trabajo ? ` · ${o.trabajo}` : "");
  window._tallerPendiente = o.nro;
  auditar("Taller", `Cobrando orden ${o.nro} — se trasladó al POS (${fmt(ordenTotalBs(o))} Bs.)`);
  renderCarrito();
  closeWindow("taller-window");
}

// Entrega a crédito: abre el modal de días y crea la cuenta por cobrar automáticamente
function entregarCreditoOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) return;
  if (o.estado === "Entregado" || o.estado === "Anulada") { alert("La orden ya fue entregada o anulada."); return; }
  if (!o.lineas || !o.lineas.length) { alert("La orden no tiene líneas para facturar."); return; }
  const cli = DB.clientes.find(c => c.nombre === o.cliente);
  if (!cli) { alert("El cliente no está registrado. Regístrelo en el módulo Clientes antes de entregar a crédito."); return; }
  const sub = ordenTotalBs(o);
  const total = r2(sub + sub * (getIva() / 100));
  const info = _t$("tal-cred-info");
  if (info) info.innerHTML = `Orden <b>${_escHtml(o.nro)}</b> — ${_escHtml(o.cliente)}<br>TOTAL: <b>${fmt(total)} Bs.</b> <span class="usd-sub">($${fmt(usdDeBs(total))})</span>`;
  const dias = _t$("tal-cred-dias");
  if (dias) dias.value = num(cli.dias) || 30;
  abrirModalVentana("taller-credito-window");
}

function confirmarCreditoOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) return;
  if (o.estado === "Entregado" || o.estado === "Anulada") return;
  const dias = Math.max(0, num(_t$("tal-cred-dias").value));
  const sub = ordenTotalBs(o);
  const total = r2(sub + sub * (getIva() / 100));
  const cuenta = crearCuentaCxC(o.cliente, "OS " + o.nro, total, o.lineas, dias);
  o.estado = "Entregado";
  o.fechaEntrega = hoy();
  o.horaEntrega = hora12();
  o.credito = true;
  o.cobrado = false;
  o.cxcId = cuenta.id;
  o.vencimiento = cuenta.vencimiento;
  if (!o.fechaCulminacion) { o.fechaCulminacion = hoy(); o.horaCulminacion = hora12(); }
  auditar("Taller", `Orden ${o.nro} entregada a crédito — CxC ${cuenta.id} — ${fmt(total)} Bs. (${dias} días)`);
  saveDB();
  closeWindow("taller-credito-window");
  renderOrdenesTaller();
  alert(`Orden ${o.nro} entregada a crédito.\nCuenta por cobrar creada: ${cuenta.id}\nVence: ${cuenta.vencimiento} (${dias} días).`);
}

function cancelarCreditoOrdenTaller() { closeWindow("taller-credito-window"); }

function finalizarCobroTaller(venta) {
  const nro = window._tallerPendiente;
  window._tallerPendiente = null;
  if (!nro) return;
  const o = DB.ordenesTaller.find(x => x.nro === nro);
  if (!o) return;
  if (!o.fechaCulminacion) { o.fechaCulminacion = hoy(); o.horaCulminacion = hora12(); }
  o.estado = "Entregado";
  o.fechaEntrega = hoy();
  o.horaEntrega = hora12();
  o.cobrado = true;
  o.ventaNro = venta.nro;
  o.ventaRef = `${DB.parametros.serie} ${venta.nro}`;
  o.cliente = venta.cliente || o.cliente;
  auditar("Taller", `Orden ${o.nro} cobrada y entregada — Factura ${o.ventaRef}`);
}

// ===== IMPRIMIR =====
function imprimirOrdenTaller() {
  const o = ordenTallerSel();
  if (!o) { alert("Seleccione una orden"); return; }
  const t = getTasa() || 1;
  const sub = ordenTotalBs(o);
  const iva = sub * (getIva() / 100);
  const total = r2(sub + iva);
  const vehiculo = [o.placa, o.marca, o.modelo, o.anio, o.color].filter(Boolean).join(" ");
  const filas = (o.lineas || []).map((l, i) =>
    `<tr><td class="num">${i + 1}</td><td>${_escHtml(l.codigo)}</td><td>${_escHtml(l.descripcion)}</td>` +
    `<td class="num">${fmt(l.cantidad)}</td><td class="num">${fmt(l.precio)}</td><td class="num">${fmt(l.total)}</td></tr>`
  ).join("") || '<tr><td colspan="6" style="text-align:center;color:#888">Sin líneas</td></tr>';

  const ficha =
    `<div class="ficha"><table>` +
    `<tr><td class="etq">Cliente:</td><td><b>${_escHtml(o.cliente)}</b></td><td class="etq">Fecha:</td><td>${_escHtml(o.fecha || "")} ${o.hora || ""}</td></tr>` +
    `<tr><td class="etq">Vehículo:</td><td colspan="3"><b>${_escHtml(vehiculo || "—")}</b></td></tr>` +
    `<tr><td class="etq">Trabajo:</td><td colspan="3">${_escHtml(o.trabajo || "")}</td></tr>`;
  const inicio = o.fechaInicio
    ? `<tr><td class="etq">Inicio:</td><td>${_escHtml(o.fechaInicio + " " + (o.horaInicio || ""))}</td>` +
      (o.fechaCulminacion ? `<td class="etq">Culminación:</td><td>${_escHtml(o.fechaCulminacion + " " + (o.horaCulminacion || ""))}</td>` : "<td></td><td></td>") + "</tr>"
    : "";
  const factura = o.ventaRef ? `<tr><td class="etq">Factura:</td><td colspan="3">${_escHtml(o.ventaRef)}</td></tr>` : "";

  const body =
    _metaPrintHtml(`ORDEN DE SERVICIO ${o.nro}`, `Estado: ${o.estado}`) +
    ficha + inicio + factura + `</table></div>` +
    `<table>` +
      `<thead><tr><th class="num">N°</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio Bs.</th><th class="num">Total Bs.</th></tr></thead>` +
      `<tbody>${filas}</tbody>` +
    `</table>` +
    `<table class="totales">` +
      `<tr><td class="lbl">Sub-Total</td><td class="num">${fmt(sub)}</td></tr>` +
      `<tr><td class="lbl">I.V.A. (${getIva()}%)</td><td class="num">${fmt(iva)}</td></tr>` +
      `<tr><td class="gr">TOTAL</td><td class="num">${fmt(total)} Bs.</td></tr>` +
      `<tr><td class="lbl">Total (USD)</td><td class="num">$ ${fmt(total / t)}</td></tr>` +
    `</table>` +
    (o.notas ? `<div class="obs"><b>Notas:</b><br>${_escHtml(o.notas)}</div>` : "") +
    `<div class="firmas">` +
      `<div>______________________<br>Elaborado por</div>` +
      `<div>______________________<br>Entregado por</div>` +
      `<div>______________________<br>Recibido por el Cliente</div>` +
    `</div>`;

  imprimirDocumentoHTML("Orden de Servicio " + o.nro, body);
}

// ===== HISTORIAL DE SERVICIOS POR CLIENTE (búsqueda inteligente) =====
function abrirHistorialTaller() {
  const s = _t$("tal-his-search");
  if (s) s.value = "";
  const res = _t$("tal-his-results");
  if (res) res.innerHTML = "";
  const det = _t$("tal-his-detalle");
  if (det) det.innerHTML = "";
  if (s) setTimeout(() => s.focus(), 40);
  openModuleWindow("taller-hist");
}

function buscarClienteTallerHistorial() {
  const q = (_t$("tal-his-search").value || "").trim();
  const res = _t$("tal-his-results");
  if (!res) return;
  if (!q) { res.innerHTML = ""; res.style.display = "none"; return; }
  const ql = q.toLowerCase();
  const qPlaca = ql.replace(/[^a-z0-9]/g, "");
  const matches = DB.clientes.filter(c => {
    const nombre = (c.nombre || "").toLowerCase();
    const rif = (c.rif || "").toLowerCase();
    const codigo = (c.codigo || "").toLowerCase();
    if (nombre.includes(ql) || rif.includes(ql) || codigo.includes(ql)) return true;
    return (c.vehiculos || []).some(v => (v.placa || "").toLowerCase().replace(/[^a-z0-9]/g, "") === qPlaca);
  }).slice(0, 8);
  if (!matches.length) {
    res.innerHTML = '<div class="prov-result" style="color:#888">Sin clientes encontrados.</div>';
    res.style.display = "block";
    return;
  }
  res.innerHTML = matches.map(c => {
    const vehs = (c.vehiculos || []).length
      ? `<span style="color:#666"> · ${c.vehiculos.length} vehículo(s): ${c.vehiculos.map(v => v.placa).filter(Boolean).join(", ")}</span>` : "";
    return `<div class="prov-result" onclick="selectorClienteTaller('${_escHtml(c.codigo)}')">${_escHtml(c.nombre)} (${_escHtml(c.rif || "")})${vehs}</div>`;
  }).join("");
  res.style.display = "block";
}

function onClienteHistorialKey(e) {
  if (e.key === "Enter") {
    const first = _t$("tal-his-results").querySelector(".prov-result");
    if (first) { e.preventDefault(); first.click(); }
  }
  if (e.key === "Escape") { _t$("tal-his-results").style.display = "none"; }
}

function selectorClienteTaller(codigo) {
  const c = DB.clientes.find(x => x.codigo === codigo);
  if (!c) return;
  _t$("tal-his-results").style.display = "none";
  _t$("tal-his-search").value = c.nombre;
  renderHistorialClienteTaller(c);
}

function renderHistorialClienteTaller(c) {
  const det = _t$("tal-his-detalle");
  if (!det) return;
  const vehs = (c.vehiculos || []).slice();
  const vehList = vehs.length
    ? vehs.map(v => {
        const ordenes = DB.ordenesTaller.filter(o => o.cliente === c.nombre &&
          (v.placa && o.placa && o.placa.toUpperCase().replace(/\s+/g, "") === v.placa.toUpperCase().replace(/\s+/g, "") ||
           (!v.placa && !o.placa)));
        const ext = contadorCambioAceite(c.nombre, v.placa);
        const aceite = ext
          ? (ext.restantes > 0
              ? `<span style="color:#0a7a0a">Próx. ${ext.proxima} (${ext.restantes} días)</span>`
              : `<b style="color:#b00000">REQUIERE SERVICIO (${ext.fecha})</b>`)
          : null;
        return `<div class="taller-veh-box">
          <div><b>Vehículo:</b> <span class="taller-placa">${_escHtml(v.placa || "—")}</span> ${_escHtml([v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(" "))} ${aceite ? ` · ${aceite}` : ""}</div>
          ${renderServiciosVehiculo(c, v.placa, ordenes)}
        </div>`;
      }).join("")
    : '<div style="color:#888;padding:8px">Este cliente no tiene vehículos registrados.</div>';

  det.innerHTML =
    `<div class="taller-veh-box" style="background:#eef3fb">
       <div><b>Cliente:</b> ${_escHtml(c.nombre)} (${_escHtml(c.rif || "")})</div>
       <div><b>Órdenes de servicio totales:</b> ${DB.ordenesTaller.filter(o => o.cliente === c.nombre).length}</div>
     </div>` + vehList;
}

function renderServiciosVehiculo(c, placa, ordenes) {
  const norm = p => String(p || "").toUpperCase().replace(/\s+/g, "");
  const rows = ordenes.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  if (!rows.length) return '<div style="color:#888;padding:4px">Sin servicios registrados para este vehículo.</div>';
  return `<table class="grid"><thead><tr><th>N° Orden</th><th>Fecha</th><th>Trabajo / Diagnóstico</th><th>Total Bs.</th><th>Estado</th></tr></thead><tbody>
    ${rows.map(o => `<tr><td>${o.nro}</td><td>${o.fecha}</td><td>${_escHtml(o.trabajo || "")}</td><td style="text-align:right">${fmt(ordenTotalBs(o))}</td><td>${tallerEstadoBadge(o.estado)}</td></tr>`).join("")}
  </tbody></table>`;
}

// ===== PRÓXIMOS CAMBIOS DE ACEITE (consulta por rangos) =====
function abrirProximosAceite() {
  openModuleWindow("taller-aceite");
  renderProximosAceite();
}

function renderProximosAceite() {
  const rango = _t$("tal-aceite-rango").value;
  const body = _t$("tal-aceite-body");
  const info = _t$("tal-aceite-info");
  if (!body) return;
  const diasTot = Math.max(1, num(DB.parametros.diasCambioAceite) || 90);
  const hoyD = hoy();
  const list = (DB.cambioAceite || []).slice().map(r => {
    const proxima = r.proxima || sumarDias(r.fecha, diasTot);
    const restantes = diasEntre(hoyD, proxima);
    const diasDesde = diasTot - restantes;
    return { ...r, proxima, restantes, diasDesde };
  });

  const filas = list.filter(r => {
    if (rango === "15") return r.restantes >= 1 && r.restantes <= 15;
    if (rango === "30") return r.restantes >= 1 && r.restantes <= 30;
    return diasDesde >= diasTot; // vencido
  }).sort((a, b) => a.restantes - b.restantes);

  const txt = {
    "15": `Vehículos cuyo cambio de aceite vence en los próximos <b>1 a 15 días</b> (período total de ${diasTot} días).`,
    "30": `Vehículos cuyo cambio de aceite vence en los próximos <b>1 a 30 días</b> (período total de ${diasTot} días).`,
    "venc": `Vehículos con <b>cambio de aceite VENCIDO</b> (superado el plazo de ${diasTot} días).`
  }[rango] || "";
  if (info) { info.innerHTML = txt + (filas.length ? ` Encontrados: <b>${filas.length}</b>.` : " Sin resultados."); }

  body.innerHTML = filas.length ? filas.map(r =>
    `<tr>
      <td>${_escHtml(r.cliente) || "—"}</td>
      <td>${_escHtml([r.placa, r.marca, r.modelo].filter(Boolean).join(" ")) || "—"}</td>
      <td>${_escHtml(r.fecha)}</td>
      <td>${_escHtml(r.proxima)}</td>
      <td style="text-align:right">${r.restantes <= 0 ? `<b style="color:#b00000">VENCIDO</b>` : `<b style="color:#92400e">${r.restantes} día${r.restantes === 1 ? "" : "s"}</b>`}</td>
    </tr>`).join("")
    : '<tr><td colspan="5" style="text-align:center;color:#888">Sin vehículos en este rango.</td></tr>';
}

// ===== CONSULTA DE ÓRDENES DE SERVICIO (búsqueda personalizada) =====
let consultaOrdenNro = null;

function abrirConsultaOrdenes() {
  consultaOrdenNro = null;
  openModuleWindow("taller-consulta");
  renderConsultaOrdenes();
}

function filtrarConsultaOrdenes() {
  renderConsultaOrdenes();
}

function consultaOrdenesData() {
  const q = (_t$("tal-csl-search").value || "").trim().toLowerCase();
  const est = (_t$("tal-csl-estado") || {}).value || "Todos";
  const desde = (_t$("tal-csl-desde").value || "").trim();
  const hasta = (_t$("tal-csl-hasta").value || "").trim();
  const qPlaca = q.replace(/[^a-zA-Z0-9]/g, "");
  return DB.ordenesTaller.slice().reverse().filter(o => {
    if (est !== "Todos" && o.estado !== est) return false;
    if (q) {
      const texto = [
        o.nro, o.cliente, o.placa, o.marca, o.modelo, o.trabajo, o.anio, o.color, o.notas
      ].filter(Boolean).join(" ").toLowerCase();
      const placaNorm = (o.placa || "").toLowerCase().replace(/[^a-zA-Z0-9]/g, "");
      if (!(texto.includes(q) || (qPlaca && placaNorm.includes(qPlaca)))) return false;
    }
    const fec = o.fechaIngreso || o.fecha || "";
    if (desde && fechaFechaKey(fec) < fechaFechaKey(desde)) return false;
    if (hasta && fechaFechaKey(fec) > fechaFechaKey(hasta)) return false;
    return true;
  });
}

function renderConsultaOrdenes() {
  const body = _t$("tal-csl-body");
  const det = _t$("tal-csl-detalle");
  if (!body) return;
  const rows = consultaOrdenesData();
  body.innerHTML = rows.map(o =>
    `<tr data-nro="${o.nro}" class="${(o.nro === consultaOrdenNro ? "selected " : "") + "cursor"}" onclick="selectConsultaOrden('${o.nro}', this)">
      <td>${o.nro}</td>
      <td>${_escHtml(o.cliente)}</td>
      <td>${o.placa ? `<b class="taller-placa">${_escHtml(o.placa)}</b> ${_escHtml([o.marca, o.modelo].filter(Boolean).join(" "))}` : "—"}</td>
      <td>${_escHtml(o.trabajo || "")}</td>
      <td>${_escHtml(o.fechaIngreso || o.fecha || "")}</td>
      <td>${_escHtml(o.horaIngreso || o.hora || "")}</td>
      <td>${_escHtml(o.fechaEntrega || "—")}</td>
      <td>${_escHtml(o.horaEntrega || "—")}</td>
      <td style="text-align:right">${fmt(ordenTotalBs(o))}</td>
      <td>${tallerEstadoBadge(o.estado)}</td>
    </tr>`
  ).join("") || '<tr><td colspan="10" style="text-align:center;color:#888">Sin órdenes que coincidan con la búsqueda.</td></tr>';
  const detEl = _t$("tal-csl-detalle");
  if (detEl) detEl.innerHTML = "";
  if (rows.length && !rows.find(r => r.nro === consultaOrdenNro)) {
    selectConsultaOrden(rows[0].nro, body.querySelector("tr"));
  }
}

function selectConsultaOrden(nro, row) {
  consultaOrdenNro = nro;
  document.querySelectorAll("#tal-csl-body tr").forEach(tr => tr.classList.remove("selected"));
  if (row) row.classList.add("selected");
  const o = DB.ordenesTaller.find(x => x.nro === nro);
  if (!o) return;
  const t = getTasa() || 1;
  const veh = [o.placa, o.marca, o.modelo, o.anio, o.color].filter(Boolean).join(" ");
  const recepcion = (o.fechaIngreso || o.fecha || "") + (o.horaIngreso || o.hora ? " " + (o.horaIngreso || o.hora) : "");
  const entrega = o.fechaEntrega ? (o.fechaEntrega + (o.horaEntrega ? " " + o.horaEntrega : "")) : "—";
  const lineas = (o.lineas || []).length && (o.lineas || []).map(l =>
    `<tr><td>${_escHtml(l.codigo)}</td><td>${_escHtml(l.descripcion)}</td>` +
    `<td style="text-align:right">${fmt(l.cantidad)}</td><td style="text-align:right">${fmt(l.precio)}</td>` +
    `<td style="text-align:right">${fmt(num(l.totalUSD || (l.precioUSD || l.precio / t) * l.cantidad))}</td>` +
    `<td style="text-align:right">${fmt(l.total)}</td></tr>`).join("");
  const sub = ordenTotalBs(o);
  const iva = sub * (getIva() / 100);
  _t$("tal-csl-detalle").innerHTML =
    `<div class="taller-veh-box" style="background:#eef3fb;margin-top:10px">
       <div><b>Orden:</b> ${o.nro} · <b>Cliente:</b> ${_escHtml(o.cliente)} · <b>Vehículo:</b> <span class="taller-placa">${_escHtml(veh || "—")}</span></div>
       <div><b>Trabajo / Diagnóstico:</b> ${_escHtml(o.trabajo || "—")}</div>
       <div><b>Recepción:</b> ${_escHtml(recepcion)} · <b>Entrega:</b> ${_escHtml(entrega)}</div>
       ${o.ventaRef ? `<div><b>Factura:</b> ${_escHtml(o.ventaRef)}</div>` : ""}
       ${o.notas ? `<div><b>Notas:</b> ${_escHtml(o.notas)}</div>` : ""}
     </div>
     <fieldset class="panel"><legend>Servicios / Repuestos de la Orden ${o.nro}</legend>
       <table class="grid"><thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Precio Bs.</th><th>USD</th><th>Total Bs.</th></tr></thead>
       <tbody>${lineas || '<tr><td colspan="6" style="text-align:center;color:#888">Sin líneas</td></tr>'}</tbody></table>
       <div class="cotiz-totals">Sub-Total: <b>${fmt(sub)}</b> · I.V.A. (${getIva()}%): <b>${fmt(iva)}</b> · TOTAL: <b>${fmt(sub + iva)} Bs.</b></div>
     </fieldset>`;
}

document.addEventListener("DOMContentLoaded", () => {
  renderOrdenesTaller();
  const prod = _t$("tal-n-prod");
  if (prod) prod.addEventListener("blur", () => {
    if (!talSelectedCod && prod.value.trim()) {
      const p = DB.productos.find(x => x.codigo === prod.value.trim());
      if (p && !num(_t$("tal-n-precio").value)) _t$("tal-n-precio").value = p.precio.toFixed(2).replace(".", ",");
    }
    ocultarProductoOrdenResults();
  });
});