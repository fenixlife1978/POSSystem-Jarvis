// ============== SISTEMA DE VENTANAS (flotantes, arrastrables) ==============
(function() {
  let zTop = 100;
  let cascade = 0;
  const reg = {};

  function isVisible(el) { return !el.classList.contains("hidden"); }
  function nameOf(el) { return el.id.replace("-window", ""); }

  function front(name) {
    const w = reg[name];
    if (!w || !isVisible(w.el)) return;
    w.el.style.zIndex = ++zTop;
    document.querySelectorAll("#taskbar .task-btn").forEach(b => b.classList.toggle("active", b.dataset.win === name));
  }

  function openModuleWindow(name) {
    const w = reg[name];
    if (!w) return;
    w.el.classList.remove("hidden");
    if (w.el.classList.contains("maximized")) w.el.classList.remove("maximized");
    if (!w.placed) {
      const i = cascade % 7;
      w.el.style.left = (24 + i * 34) + "px";
      w.el.style.top = (24 + i * 28) + "px";
      w.placed = true;
      cascade++;
    }
    front(name);
    if (name === "buscar") {
      if (typeof renderProductSearch === "function") renderProductSearch("");
      setTimeout(() => { const inp = document.getElementById("buscar-input"); if (inp) inp.focus(); }, 40);
    }
  }

  function closeWindow(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("hidden");
      el.classList.remove("maximized");
    }
    document.querySelectorAll("#taskbar .task-btn").forEach(b => b.classList.remove("active"));
  }

  function toggleMinimize(name) {
    const w = reg[name];
    if (!w) return;
    if (isVisible(w.el)) {
      w.el.classList.add("hidden");
      w.el.classList.remove("maximized");
      const btn = document.querySelector(`#taskbar .task-btn[data-win="${name}"]`);
      if (btn) btn.classList.remove("active");
    } else {
      openModuleWindow(name);
    }
  }

  function toggleMaximize(name) {
    const w = reg[name];
    if (!w || !isVisible(w.el)) return;
    w.el.classList.toggle("maximized");
    front(name);
  }

  function makeDraggable(el) {
    const bar = el.querySelector(".title-bar");
    if (!bar) return;
    bar.addEventListener("mousedown", function(e) {
      if (e.button !== 0) return;
      if (e.target.closest(".win-btn")) return;
      if (el.classList.contains("maximized")) return;
      front(nameOf(el));
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = ev => {
        let left = ev.clientX - dx;
        let top = ev.clientY - dy;
        left = Math.max(-rect.width + 100, Math.min(left, window.innerWidth - 60));
        top = Math.max(0, Math.min(top, window.innerHeight - 44));
        el.style.left = left + "px";
        el.style.top = top + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
        bar.classList.remove("dragging");
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.userSelect = "none";
      bar.classList.add("dragging");
      e.preventDefault();
    });
    el.addEventListener("mousedown", function() {
      if (isVisible(el)) front(nameOf(el));
    }, true);
  }

  function buildTaskbar() {
    const wrap = document.getElementById("taskbar-buttons");
    if (!wrap) return;
    Object.keys(reg).forEach(name => {
      const w = reg[name];
      const btn = document.createElement("button");
      btn.className = "task-btn";
      btn.dataset.win = name;
      btn.title = w.title;
      btn.innerHTML = `<span>🗔</span> ${w.title}`;
      btn.onclick = () => toggleMinimize(name);
      wrap.appendChild(btn);
    });
  }

  function tickClock() {
    const el = document.getElementById("taskbar-clock");
    if (!el) return;
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "p.m." : "a.m.";
    h = h % 12 || 12;
    el.textContent = `${dd}/${mm}/${d.getFullYear()}  ${h}:${m} ${ampm}`;
  }

  function init() {
    document.querySelectorAll(".window[id$=\"-window\"]").forEach(el => {
      if (el.id === "pos-window") return;
      el.classList.add("floating");
      const name = nameOf(el);
      const titleEl = el.querySelector(".title-text");
      const title = (titleEl ? titleEl.textContent : name).trim();
      const btns = {};
      el.querySelectorAll(".title-right .win-btn").forEach(b => {
        const t = b.textContent.trim();
        if (t === "─") btns.min = b;
        else if (t === "▢") btns.max = b;
        else if (t === "✕") btns.close = b;
      });
      if (btns.min) btns.min.onclick = e => { e.preventDefault(); e.stopPropagation(); toggleMinimize(name); };
      if (btns.max) btns.max.onclick = e => { e.preventDefault(); e.stopPropagation(); toggleMaximize(name); };
      if (btns.close) btns.close.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (el.id === "dashboard-window" && typeof logout === "function") { logout(); return; }
        closeWindow(el.id);
      };
      reg[name] = { el, title, ...btns };
      makeDraggable(el);
    });
    buildTaskbar();
    tickClock();
    setInterval(tickClock, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.openModuleWindow = openModuleWindow;
  window.closeWindow = closeWindow;
  window.toggleMinimize = toggleMinimize;
  window.toggleMaximize = toggleMaximize;
})();
