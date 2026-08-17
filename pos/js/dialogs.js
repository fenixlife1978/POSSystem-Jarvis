/* ============================================================
   UI DIALOGOS PROPIOS — reemplazo de los diálogos nativos de
   Electron (alert/confirm/prompt). Los nativos roban el foco de
   la ventana y bloquean los inputs; estos modales viven en el DOM
   y no alteran el foco del renderer.
   API (asíncrona, devuelve Promises):
     uiAlert(msg)                  -> Promise<void>
     uiConfirm(msg)                -> Promise<boolean>
     uiPrompt(msg, valorInicial?)  -> Promise<string|null>
   ============================================================ */
(function () {
  let current = null;   // { resolve, withInput }

  function build() {
    const ov = document.createElement("div");
    ov.id = "ui-dialog-overlay";
    ov.className = "ui-dialog-overlay";
    const box = document.createElement("div");
    box.id = "ui-dialog-box";
    box.innerHTML =
      '<div class="ui-dialog-head"><span class="app-icon"></span><span class="ui-dialog-title"></span></div>' +
      '<div class="ui-dialog-body">' +
        '<div class="ui-dialog-msg"></div>' +
        '<div class="ui-dialog-inputwrap"><input type="text" class="ui-dialog-input"></div>' +
      '</div>' +
      '<div class="ui-dialog-foot">' +
        '<button data-act="cancel" class="mod-btn ui-dialog-cancel"></button>' +
        '<button data-act="ok" class="mod-btn ui-dialog-ok"></button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    return ov;
  }

  let ov = null;
  function overlay() {
    if (!ov) ov = build();
    return ov;
  }
  const box = () => overlay().firstElementChild;
  const byAct = act => box().querySelector('[data-act="' + act + '"]');

  function onKey(e) {
    if (!current) return;
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); confirmAction(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelAction(); }
  }
  function onMask(e) { if (e.target === overlay()) cancelAction(); }

  function open(opts) {
    return new Promise(resolve => {
      current = { resolve, withInput: opts.withInput };
      const b = box();
      overlay().style.display = "flex";
      const head = b.querySelector(".ui-dialog-head");
      const icon = head.querySelector(".app-icon");
      const title = b.querySelector(".ui-dialog-title");
      const msg = b.querySelector(".ui-dialog-msg");
      const inputWrap = b.querySelector(".ui-dialog-inputwrap");
      const input = inputWrap.querySelector("input");
      const btnCancel = byAct("cancel");
      const btnOk = byAct("ok");
      icon.textContent = opts.icon || "";
      title.textContent = opts.title || "";
      msg.textContent = opts.message || "";

      // Tres modos: alert (solo OK), confirm (Sí/No), prompt (input + OK/Cancelar).
      if (opts.withInput) {
        inputWrap.style.display = "";
        input.value = opts.value != null ? String(opts.value) : "";
        btnOk.textContent = opts.okLabel || "Aceptar";
        btnCancel.textContent = opts.cancelLabel || "Cancelar";
        btnCancel.style.display = "";
        btnOk.style.display = "";
        btnOk.onclick = () => done(input.value);
        btnCancel.onclick = () => done(null);
        setTimeout(() => input.focus(), 30);
      } else if (opts.buttons === false) {
        inputWrap.style.display = "none";
        btnOk.textContent = opts.okLabel || "Aceptar";
        btnCancel.style.display = "none";
        btnOk.style.display = "";
        btnOk.onclick = () => done(true);
        setTimeout(() => btnOk.focus(), 30);
      } else {
        inputWrap.style.display = "none";
        btnOk.textContent = opts.yesLabel || "Sí";
        btnCancel.textContent = opts.noLabel || "No";
        btnCancel.style.display = "";
        btnOk.style.display = "";
        btnOk.onclick = () => done(true);
        btnCancel.onclick = () => done(false);
        setTimeout(() => btnCancel.focus(), 30);
      }
      document.addEventListener("keydown", onKey, true);
      overlay().addEventListener("mousedown", onMask);
    }).catch(() => {});
  }

  function done(v) {
    if (!current) return;
    const r = current.resolve;
    current = null;
    cleanup();
    r(v);
  }
  function confirmAction() { if (current) byAct("ok").click(); }
  function cancelAction() { if (current) byAct("cancel").click(); }
  function cleanup() {
    overlay().style.display = "none";
    document.removeEventListener("keydown", onKey, true);
    overlay().removeEventListener("mousedown", onMask);
  }

  window.uiAlert = function (message) {
    return open({ icon: "ℹ️", title: "Aviso", message, withInput: false, buttons: false, okLabel: "Aceptar" });
  };
  window.uiConfirm = function (message) {
    return open({ icon: "❓", title: "Confirmar", message, withInput: false, yesLabel: "Sí", noLabel: "No" });
  };
  window.uiPrompt = function (message, value) {
    return open({ icon: "✏️", title: "Información", message, withInput: true, value, okLabel: "Aceptar", cancelLabel: "Cancelar" });
  };

  // Solicita el PIN de autorización del Supervisor para operaciones sensibles
  // (devoluciones, anulación de ventas, etc.). Devuelve true si el PIN es
  // correcto y false si se cancela o es incorrecto. Audita el intento.
  window.solicitarPinSupervisor = async function (motivo) {
    const pin = await uiPrompt(`AUTORIZACIÓN DE SUPERVISOR\n${motivo || ""}\n\nIngrese el PIN de supervisor para continuar:`);
    if (pin === null) return false;
    const correcto = String(pin || "").trim() === String((DB && DB.parametros && DB.parametros.pinSupervisor) || "1234");
    if (typeof auditar === "function") {
      auditar("Autorización de Supervisor",
        correcto ? `PIN correcto — ${motivo || "operación"} — ${(DB.parametros && DB.parametros.cajero) || "ADMIN"}`
                  : `PIN INCORRECTO — intento de ${motivo || "operación"} — ${(DB.parametros && DB.parametros.cajero) || "ADMIN"}`);
    }
    if (!correcto) uiAlert("PIN de supervisor incorrecto. Operación cancelada.");
    return correcto;
  };

  // Sobrescribe alert() nativo para que no robe el foco.
  if (window.electron || window.desktop) {
    window.alert = function (m) { uiAlert(typeof m === "string" ? m : String(m)); };
  }
})();