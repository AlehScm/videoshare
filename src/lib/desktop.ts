"use client";

import { useSyncExternalStore } from "react";

export type DesktopSource = {
  id: string;
  name: string;
  kind: "window" | "screen";
  thumbnail: string;
  appIcon: string | null;
};

/** Ponte exposta pelo app de desktop (desktop/src/preload.ts). Não existe no navegador. */
export type DesktopBridge = {
  listSources: () => Promise<DesktopSource[]>;
  selectSource: (id: string) => Promise<void>;
  startAudio: (id: string) => Promise<boolean>;
  stopAudio: () => Promise<void>;
};

export type DesktopSelection = { sourceId: string; withAudio: boolean };

export const DESKTOP_DOWNLOAD_URL = "https://github.com/AlehScm/videoshare/releases/latest";

export function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { videoshareDesktop?: DesktopBridge }).videoshareDesktop ?? null;
}

const noSubscribe = () => () => {};

export function useIsDesktop(): boolean {
  return useSyncExternalStore(noSubscribe, () => getDesktop() !== null, () => false);
}

/** O app manda o MessagePort do áudio por postMessage logo depois do startAudio. */
export function waitForAudioPort(timeoutMs = 3000): Promise<MessagePort | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data !== "videoshare:audio-port" || !event.ports[0]) return;
      finish(event.ports[0]);
    }
    function finish(port: MessagePort | null) {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(port);
    }
    window.addEventListener("message", onMessage);
  });
}

// Toca o PCM do app (s16le, estéreo, 48 kHz). Junta ~40 ms antes de começar e descarta o mais
// antigo acima de ~150 ms, pra o som não ir atrasando em relação à imagem.
const PCM_WORKLET = `
const START_FRAMES = 1920;
const MAX_FRAMES = 7200;
class VideosharePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.index = 0;
    this.frames = 0;
    this.playing = false;
    this.port.onmessage = (event) => {
      const pcm = new Int16Array(event.data);
      this.chunks.push(pcm);
      this.frames += pcm.length / 2;
      while (this.frames > MAX_FRAMES && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        this.frames -= (dropped.length - this.index) / 2;
        this.index = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.playing && this.frames >= START_FRAMES) this.playing = true;
    for (let i = 0; i < left.length; i++) {
      const chunk = this.chunks[0];
      if (!this.playing || !chunk) {
        left[i] = 0;
        if (right) right[i] = 0;
        continue;
      }
      left[i] = chunk[this.index] / 32768;
      if (right) right[i] = chunk[this.index + 1] / 32768;
      this.index += 2;
      this.frames -= 1;
      if (this.index >= chunk.length) {
        this.chunks.shift();
        this.index = 0;
      }
    }
    if (this.frames <= 0) this.playing = false;
    return true;
  }
}
registerProcessor("videoshare-pcm", VideosharePcm);
`;

export async function createPcmAudioTrack(port: MessagePort): Promise<{ track: MediaStreamTrack; close: () => void }> {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, "videoshare-pcm", {
    numberOfInputs: 0,
    outputChannelCount: [2],
  });
  const destination = context.createMediaStreamDestination();
  node.connect(destination);
  port.onmessage = (event: MessageEvent<Uint8Array>) => {
    const copy = event.data.slice().buffer;
    node.port.postMessage(copy, [copy]);
  };
  port.start();
  await context.resume().catch(() => {});
  return {
    track: destination.stream.getAudioTracks()[0],
    close: () => {
      port.close();
      node.disconnect();
      void context.close();
    },
  };
}
