import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("videoshareDesktop", {
  listSources: () => ipcRenderer.invoke("videoshare:list-sources"),
  selectSource: (id: string) => ipcRenderer.invoke("videoshare:select-source", id),
  startAudio: (id: string) => ipcRenderer.invoke("videoshare:start-audio", id),
  stopAudio: () => ipcRenderer.invoke("videoshare:stop-audio"),
});

// MessagePort não atravessa o contextBridge; vai pra página por postMessage.
ipcRenderer.on("videoshare:audio-port", (event) => {
  window.postMessage("videoshare:audio-port", window.location.origin, event.ports);
});
