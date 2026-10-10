export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// Opções do Chrome 141+ que o TypeScript ainda não tipa; navegadores sem suporte ignoram.
type ScreenCaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  windowAudio?: "exclude" | "window" | "system";
};

export const MAX_FPS = 30;

/** Abre o seletor de tela do navegador. `null` quando a pessoa cancela. */
export async function captureScreen(): Promise<MediaStream | null> {
  const options: ScreenCaptureOptions = {
    video: {
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: MAX_FPS, max: MAX_FPS },
    },
    audio: true,
    systemAudio: "include",
    // Ao escolher uma janela (ex.: um jogo), oferece só o som daquele programa, não o do sistema todo.
    windowAudio: "window",
  };
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    // "motion": sob pressão o navegador mantém os fps e baixa a resolução (fluidez primeiro).
    for (const track of stream.getVideoTracks()) track.contentHint = "motion";
    return stream;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") return null;
    throw error;
  }
}

export function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

const UPLOAD_BUDGET_BPS = 24_000_000;
const MIN_VIDEO_BPS = 3_000_000;
const MAX_VIDEO_BPS = 8_000_000;

/** Teto de bitrate por pessoa: divide o upload de quem apresenta entre quem assiste. */
export function videoBitrateFor(viewers: number): number {
  const share = UPLOAD_BUDGET_BPS / Math.max(1, viewers);
  return Math.round(Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, share)));
}

/**
 * Coloca H.264 na frente: no Windows o Chrome o codifica na placa de vídeo, o que evita
 * uma codificação VP8 em software por pessoa. Precisa rodar antes da oferta (logo após o addTrack).
 */
export function preferHardwareCodec(pc: RTCPeerConnection, track: MediaStreamTrack): void {
  const transceiver = pc.getTransceivers().find((t) => t.sender.track === track);
  const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
  if (!transceiver || !codecs || typeof transceiver.setCodecPreferences !== "function") return;
  const isH264 = (codec: RTCRtpCodec) => codec.mimeType.toLowerCase() === "video/h264";
  try {
    transceiver.setCodecPreferences([...codecs.filter(isH264), ...codecs.filter((c) => !isH264(c))]);
  } catch {}
}

type SendParameters = RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };

/** Aplica teto de bitrate/fps no envio de vídeo; espera a negociação criar os encodings. */
export async function tuneVideoSender(
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
  maxBitrate: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (pc.connectionState === "closed" || track.readyState === "ended") return;
    const sender = pc.getSenders().find((s) => s.track === track);
    if (!sender) return;
    const params: SendParameters = sender.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = MAX_FPS;
      params.degradationPreference = "maintain-framerate";
      try {
        await sender.setParameters(params);
      } catch {
        delete params.degradationPreference;
        await sender.setParameters(params).catch(() => {});
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
