import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import { findSource, listSources, startAudio, stopAudio } from "./capture";

const SITE_URL = process.env.VIDEOSHARE_URL ?? "https://alehscm.github.io/videoshare/";
const site = new URL(SITE_URL);
const ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "clipboard-sanitized-write", "fullscreen"]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayHintShown = false;
let selectedSourceId: string | null = null;

/** Só o próprio videoshare (mesma origem e caminho) fala com o app. */
function isSiteUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === site.origin && parsed.pathname.startsWith(site.pathname);
  } catch {
    return false;
  }
}

function assertSite(event: IpcMainInvokeEvent): void {
  if (!isSiteUrl(event.senderFrame?.url)) throw new Error("origem não autorizada");
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "videoshare",
    icon: ICON_PATH,
    backgroundColor: "#0f131b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A transmissão e as medições continuam com a janela minimizada ou na bandeja.
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.removeMenu();
  void win.loadURL(SITE_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isSiteUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: "O videoshare continua aberto",
        body: "Ele fica perto do relógio. Pra sair, clique com o botão direito no ícone e em Sair.",
        icon: ICON_PATH,
      }).show();
    }
  });
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 }));
  tray.setToolTip("videoshare");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir videoshare", click: showWindow },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

function setupSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isSiteUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && requestingOrigin === site.origin;
  });
  // A página escolhe a fonte no seletor próprio (selectSource) e depois chama getDisplayMedia.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const id = selectedSourceId;
    selectedSourceId = null;
    const source = id && isSiteUrl(request.frame?.url) ? await findSource(id) : null;
    callback(source ? { video: source } : {});
  });
}

function setupIpc(): void {
  ipcMain.handle("videoshare:list-sources", (event) => {
    assertSite(event);
    return listSources(win?.getMediaSourceId());
  });
  ipcMain.handle("videoshare:select-source", (event, id: unknown) => {
    assertSite(event);
    selectedSourceId = typeof id === "string" ? id : null;
  });
  ipcMain.handle("videoshare:start-audio", (event, id: unknown) => {
    assertSite(event);
    return typeof id === "string" ? startAudio(event.sender, id) : false;
  });
  ipcMain.handle("videoshare:stop-audio", (event) => {
    assertSite(event);
    stopAudio();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("io.github.alehscm.videoshare");
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
    stopAudio();
  });
  void app.whenReady().then(() => {
    setupSession();
    setupIpc();
    createWindow();
    createTray();
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  });
}
