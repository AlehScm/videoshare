import { createPcmAudioTrack, getDesktop, waitForAudioPort, type DesktopSelection } from "@/lib/desktop";
import { presetBitrate, presetWidth, type QualityPreset } from "@/lib/quality";

export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// Opções do Chrome 141+ que o TypeScript ainda não tipa; navegadores sem suporte ignoram.
type ScreenCaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  windowAudio?: "exclude" | "window" | "system";
};

function videoConstraints(preset: QualityPreset): MediaTrackConstraints {
  return {
    width: { max: presetWidth(preset) },
    height: { max: preset.height },
    frameRate: { ideal: preset.fps, max: preset.fps },
  };
}

export type CapturedScreen = { stream: MediaStream; release: () => void };

/**
 * Captura a tela. No navegador abre o seletor do próprio navegador; no app de desktop usa a fonte
 * escolhida no seletor do videoshare e o som vem do Windows (só do programa, no caso de janela).
 * `null` quando a pessoa cancela.
 */
export async function captureScreen(
  preset: QualityPreset,
  selection?: DesktopSelection,
): Promise<CapturedScreen | null> {
  const desktop = getDesktop();
  const options: ScreenCaptureOptions =
    desktop && selection
      ? { video: videoConstraints(preset), audio: false }
      : {
          video: videoConstraints(preset),
          audio: true,
          systemAudio: "include",
          // Ao escolher uma janela (ex.: um jogo), oferece só o som daquele programa, não o do sistema todo.
          windowAudio: "window",
        };
  let stream: MediaStream;
  try {
    if (desktop && selection) await desktop.selectSource(selection.sourceId);
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") return null;
    throw error;
  }
  for (const track of stream.getVideoTracks()) track.contentHint = "motion";

  let release = () => {};
  if (desktop && selection?.withAudio) {
    const portArrived = waitForAudioPort();
    const started = await desktop.startAudio(selection.sourceId).catch(() => false);
    const port = started ? await portArrived : null;
    if (port) {
      const audio = await createPcmAudioTrack(port);
      stream.addTrack(audio.track);
      release = () => {
        audio.close();
        void desktop.stopAudio();
      };
    }
  }
  return { stream, release };
}

/** Troca a qualidade da captura no meio da transmissão. */
export async function applyPresetToTrack(track: MediaStreamTrack, preset: QualityPreset): Promise<void> {
  await track.applyConstraints(videoConstraints(preset)).catch(() => {});
}

export function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Quanto o encoder precisa reduzir se a captura vier maior que a qualidade escolhida. */
function scaleDownFor(track: MediaStreamTrack, preset: QualityPreset): number {
  const { width = 0, height = 0 } = track.getSettings();
  return Math.max(1, width / presetWidth(preset), height / preset.height);
}

type SendParameters = RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };

/**
 * Fixa a qualidade escolhida por quem apresenta no envio de vídeo: resolução travada
 * (`maintain-resolution`, sem descer em escada), fps e bitrate do preset.
 * Espera a negociação criar os encodings.
 */
export async function tuneVideoSender(
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
  preset: QualityPreset,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (pc.connectionState === "closed" || track.readyState === "ended") return;
    const sender = pc.getSenders().find((s) => s.track === track);
    if (!sender) return;
    const params: SendParameters = sender.getParameters();
    if (params.encodings?.length) {
      params.encodings[0].maxBitrate = presetBitrate(preset);
      params.encodings[0].maxFramerate = preset.fps;
      params.encodings[0].scaleResolutionDownBy = scaleDownFor(track, preset);
      params.degradationPreference = "maintain-resolution";
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
