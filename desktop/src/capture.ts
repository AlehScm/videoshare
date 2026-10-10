import { desktopCapturer, MessageChannelMain, type MessagePortMain, type WebContents } from "electron";
import koffi from "koffi";
import loopback from "loopback-capture";

export type SourceInfo = {
  id: string;
  name: string;
  kind: "window" | "screen";
  thumbnail: string;
  appIcon: string | null;
};

const user32 = koffi.load("user32.dll");
const GetWindowThreadProcessId = user32.func(
  "uint32 __stdcall GetWindowThreadProcessId(intptr hWnd, _Out_ uint32 *lpdwProcessId)",
);

/** Janelas e telas pro seletor, sem a própria janela do videoshare. */
export async function listSources(ownSourceId?: string): Promise<SourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((source) => source.id !== ownSourceId && !source.thumbnail.isEmpty())
    .map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }));
}

export async function findSource(id: string) {
  const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } });
  return sources.find((source) => source.id === id) ?? null;
}

/** O id de janela do Electron é `window:<HWND>:<n>`; o Windows diz de qual processo ela é. */
function processIdOfWindow(sourceId: string): number | null {
  const hwnd = Number(/^window:(\d+):/.exec(sourceId)?.[1]);
  if (!hwnd) return null;
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0] || null;
}

let capture: InstanceType<typeof loopback.LoopbackCapture> | null = null;
let port: MessagePortMain | null = null;

/**
 * Captura o som e manda o PCM (s16le, estéreo, 48 kHz) pra página por um MessagePort.
 * Janela: só o programa dela (e filhos). Tela: o computador todo menos o próprio videoshare.
 */
export function startAudio(webContents: WebContents, sourceId: string): boolean {
  stopAudio();
  const instance = new loopback.LoopbackCapture();
  const channel = new MessageChannelMain();
  const onChunk = (chunk: Buffer) => channel.port1.postMessage(new Uint8Array(chunk));

  if (sourceId.startsWith("window:")) {
    const pid = processIdOfWindow(sourceId);
    if (!pid) return false;
    instance.start(pid, true, onChunk);
  } else {
    instance.start(process.pid, false, onChunk);
  }

  channel.port1.start();
  webContents.postMessage("videoshare:audio-port", null, [channel.port2]);
  capture = instance;
  port = channel.port1;
  return true;
}

export function stopAudio(): void {
  capture?.stop();
  capture = null;
  port?.close();
  port = null;
}
