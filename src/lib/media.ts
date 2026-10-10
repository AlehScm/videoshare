export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// Opções do Chrome 141+ que o TypeScript ainda não tipa; navegadores sem suporte ignoram.
type ScreenCaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  windowAudio?: "exclude" | "window" | "system";
};

/** Abre o seletor de tela do navegador. `null` quando a pessoa cancela. */
export async function captureScreen(): Promise<MediaStream | null> {
  const options: ScreenCaptureOptions = {
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: true,
    systemAudio: "include",
    // Ao escolher uma janela (ex.: um jogo), oferece só o som daquele programa, não o do sistema todo.
    windowAudio: "window",
  };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    for (const track of stream.getVideoTracks()) track.contentHint = "detail";
    return stream;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") return null;
    throw error;
  }
}

export function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
