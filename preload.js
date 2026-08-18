const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  version: process.versions.electron,
  exportarPDF: (titulo, html) => ipcRenderer.invoke("pdf-export", { titulo, html }),
  // Almacenamiento SQLite local (principal en Electron)
  sqlite: {
    load: () => ipcRenderer.invoke("sqlite-load"),
    save: (data) => ipcRenderer.invoke("sqlite-save", data),
    backup: (label) => ipcRenderer.invoke("sqlite-backup", label),
    clear: () => ipcRenderer.invoke("sqlite-clear"),
    status: () => ipcRenderer.invoke("sqlite-status")
  },
  // Red multi-terminal (LAN)
  net: {
    start: (port) => ipcRenderer.invoke("net-start", port),
    stop: () => ipcRenderer.invoke("net-stop"),
    status: () => ipcRenderer.invoke("net-status")
  },
  // Jarvis: agente inteligente del POS
  jarvis: {
    config: {
      get: (key) => ipcRenderer.invoke("jarvis-kv-get", key),
      set: (key, data) => ipcRenderer.invoke("jarvis-kv-set", key, data),
      keys: () => ipcRenderer.invoke("jarvis-kv-keys"),
      del: (key) => ipcRenderer.invoke("jarvis-kv-del", key)
    },
    scan: () => ipcRenderer.invoke("jarvis-scan"),
    ai: (cfg, model, messages, extra) => ipcRenderer.invoke("jarvis-ai", cfg, model, messages, extra),
    aiOffline: (config, model, messages) => ipcRenderer.invoke("jarvis-ai-offline", config, model, messages),
    checkNetwork: () => ipcRenderer.invoke("jarvis-net-check"),
    webSearch: (query, opts) => ipcRenderer.invoke("jarvis-web-search", query, opts),
    catImage: (meta) => ipcRenderer.invoke("jarvis-cat-image", meta)
  }
});