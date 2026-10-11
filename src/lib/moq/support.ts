/** Retransmissor público do moq.dev; o conteúdo vai criptografado (ver crypto.ts). */
export const DEFAULT_MOQ_RELAY = "https://cdn.moq.dev/anon";
/** Pra testes: um endereço troca o retransmissor, "off" desliga o modo servidor. */
const RELAY_OVERRIDE_KEY = "videoshare:moqRelay";

export function moqRelayUrl(): URL | null {
  let custom: string | null = null;
  try {
    custom = localStorage.getItem(RELAY_OVERRIDE_KEY);
  } catch {}
  if (custom === "off") return null;
  try {
    return new URL(custom ?? DEFAULT_MOQ_RELAY);
  } catch {
    return new URL(DEFAULT_MOQ_RELAY);
  }
}

// APIs só do Chromium que o TypeScript ainda não tipa.
export type TrackProcessor<T> = { readable: ReadableStream<T> };
type TrackProcessorCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => TrackProcessor<
  VideoFrame | AudioData
>;
export type TrackGenerator = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type TrackGeneratorCtor = new (init: { kind: "video" }) => TrackGenerator;

type WebCodecsGlobals = {
  MediaStreamTrackProcessor?: TrackProcessorCtor;
  MediaStreamTrackGenerator?: TrackGeneratorCtor;
};

const globals = () => globalThis as unknown as WebCodecsGlobals;

export function trackProcessor(): TrackProcessorCtor | null {
  return globals().MediaStreamTrackProcessor ?? null;
}

export function trackGenerator(): TrackGeneratorCtor | null {
  return globals().MediaStreamTrackGenerator ?? null;
}

const hasTransport = () => typeof WebTransport !== "undefined" || typeof WebSocket !== "undefined";

/** Firefox e Safari não têm MediaStreamTrackProcessor: apresentam pelo P2P. */
export function canPublishMoq(): boolean {
  return (
    typeof window !== "undefined" &&
    moqRelayUrl() !== null &&
    hasTransport() &&
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    trackProcessor() !== null
  );
}

/** Firefox e Safari não têm MediaStreamTrackGenerator: assistem pelo P2P. */
export function canWatchMoq(): boolean {
  return (
    typeof window !== "undefined" &&
    moqRelayUrl() !== null &&
    hasTransport() &&
    typeof VideoDecoder !== "undefined" &&
    typeof AudioDecoder !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    trackGenerator() !== null
  );
}

/**
 * Escolhe o codec: H.264 na placa de vídeo quando der (uma codificação só serve todo mundo),
 * senão H.264/VP8 em software. Annex B dispensa `description` no decoder.
 */
export async function pickVideoConfig(
  width: number,
  height: number,
  bitrate: number,
  framerate: number,
): Promise<VideoEncoderConfig | null> {
  const base = { width, height, bitrate, framerate, latencyMode: "realtime" as const };
  const candidates: VideoEncoderConfig[] = [
    { ...base, codec: "avc1.64002A", avc: { format: "annexb" }, hardwareAcceleration: "prefer-hardware" },
    { ...base, codec: "avc1.42E02A", avc: { format: "annexb" }, hardwareAcceleration: "prefer-hardware" },
    { ...base, codec: "avc1.42E02A", avc: { format: "annexb" } },
    { ...base, codec: "vp8" },
  ];
  for (const config of candidates) {
    const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (support?.supported) return support.config ?? config;
  }
  return null;
}
