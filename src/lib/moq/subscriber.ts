import * as Moq from "@moq/net";
import { createPcmAudioTrack } from "@/lib/desktop";
import { FLAG_CONFIG, FLAG_KEYFRAME, open, readHeader, TRACK_AUDIO, TRACK_VIDEO } from "./crypto";
import { trackGenerator } from "./support";

const FIRST_FRAME_TIMEOUT_MS = 10_000;
const FREEZE_GAP_MS = 700;

export type SubscriberStats = {
  fps: number;
  kbps: number;
  width: number;
  height: number;
  codec: string | null;
  /** Quadros que chegaram sem a chave certa (ex.: logo depois de uma troca de chave). */
  locked: number;
  /** Pausas de mais de 0,7 s entre quadros no último segundo. */
  freezes: number;
  lastFrameAgoMs: number | null;
};

type Props = {
  relay: URL;
  name: string;
  getKey: (keyId: number) => CryptoKey | undefined;
  /** Primeiro quadro decodificado: a imagem já pode aparecer. */
  onLive: (stream: MediaStream) => void;
  /** Nenhum quadro a tempo: quem assiste pede o P2P. */
  onFailure: () => void;
};

type VideoConfig = { codec: string; codedWidth?: number; codedHeight?: number };
type AudioConfig = { codec: string; sampleRate: number; numberOfChannels: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Assiste uma transmissão do retransmissor MoQ: descriptografa cada quadro com a chave da sala
 * e entrega um MediaStream comum (vídeo por MediaStreamTrackGenerator, som pelo player PCM).
 */
export class MoqSubscriber {
  readonly name: string;
  readonly stream = new MediaStream();
  #props: Props;
  #origin = new Moq.Origin.Producer();
  #connection: Moq.Connection;
  #closed = false;
  #live = false;
  #failTimer: ReturnType<typeof setTimeout>;
  #statsTimer: ReturnType<typeof setInterval>;

  #videoDecoder: VideoDecoder | null = null;
  #videoConfig = "";
  #needKeyframe = true;
  #writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
  #codec: string | null = null;
  #size = { width: 0, height: 0 };
  #lastFrameAt: number | null = null;

  #audioDecoder: AudioDecoder | null = null;
  #audioConfig = "";
  #pcmPort: MessagePort | null = null;
  #closeAudio: (() => void) | null = null;

  #counters = { frames: 0, bytes: 0, locked: 0, freezes: 0 };
  #snapshot: SubscriberStats = {
    fps: 0,
    kbps: 0,
    width: 0,
    height: 0,
    codec: null,
    locked: 0,
    freezes: 0,
    lastFrameAgoMs: null,
  };

  constructor(props: Props) {
    this.#props = props;
    this.name = props.name;
    this.#connection = new Moq.Connection({ url: props.relay, consume: this.#origin });

    const Generator = trackGenerator();
    if (Generator) {
      const generator = new Generator({ kind: "video" });
      this.#writer = generator.writable.getWriter();
      this.stream.addTrack(generator);
    }

    this.#failTimer = setTimeout(() => {
      if (!this.#live && !this.#closed) this.#props.onFailure();
    }, FIRST_FRAME_TIMEOUT_MS);
    this.#statsTimer = setInterval(() => this.#tick(), 1000);
    void this.#run();
  }

  get stats(): SubscriberStats {
    return this.#snapshot;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#failTimer);
    clearInterval(this.#statsTimer);
    if (this.#videoDecoder?.state !== "closed") this.#videoDecoder?.close();
    if (this.#audioDecoder?.state !== "closed") this.#audioDecoder?.close();
    void this.#writer?.close().catch(() => {});
    this.#pcmPort?.close();
    this.#closeAudio?.();
    this.stream.getTracks().forEach((track) => track.stop());
    this.#origin.close();
    this.#connection.close();
  }

  #tick() {
    const c = this.#counters;
    this.#snapshot = {
      fps: c.frames,
      kbps: Math.round((c.bytes * 8) / 1000),
      width: this.#size.width,
      height: this.#size.height,
      codec: this.#codec,
      locked: c.locked,
      freezes: c.freezes,
      lastFrameAgoMs: this.#lastFrameAt === null ? null : Math.round(performance.now() - this.#lastFrameAt),
    };
    this.#counters = { frames: 0, bytes: 0, locked: 0, freezes: 0 };
  }

  /** Espera a transmissão aparecer no servidor e reassina se ela cair e voltar. */
  async #run() {
    const requesting = this.#origin.request(Moq.Path.from(this.#props.name));
    while (!this.#closed) {
      const broadcast = requesting.active.peek();
      if (!broadcast) {
        await Promise.race([requesting.active.changed(), sleep(1000)]);
        continue;
      }
      const video = broadcast.track("v").subscribe({ priority: 1 });
      const audio = broadcast.track("a").subscribe({ priority: 2 });
      await Promise.all([this.#readTrack(video, TRACK_VIDEO), this.#readTrack(audio, TRACK_AUDIO)]);
      video.close();
      audio.close();
      await sleep(500);
    }
  }

  async #readTrack(subscriber: Moq.Track.Subscriber, track: number) {
    while (!this.#closed) {
      const group = await subscriber.recvGroup().catch(() => undefined);
      if (!group) return;
      for (;;) {
        const frame = await group.readFrame().catch(() => undefined);
        if (!frame || this.#closed) break;
        this.#counters.bytes += frame.payload.byteLength;
        await this.#handleFrame(frame.payload, track);
      }
    }
  }

  async #handleFrame(data: Uint8Array, track: number) {
    const header = readHeader(data);
    if (!header) return;
    const key = this.#props.getKey(header.keyId);
    const payload = key ? await open(key, header, track, data) : null;
    if (!payload) {
      this.#counters.locked++;
      return;
    }
    if (track === TRACK_VIDEO) this.#handleVideo(header.flags, header.timestampUs, payload);
    else await this.#handleAudio(header.flags, header.timestampUs, payload);
  }

  // ---- Vídeo ----------------------------------------------------------------------------

  #handleVideo(flags: number, timestampUs: number, payload: Uint8Array) {
    if (flags & FLAG_CONFIG) {
      const raw = new TextDecoder().decode(payload);
      if (raw !== this.#videoConfig) this.#configureVideo(raw);
      return;
    }
    const decoder = this.#videoDecoder;
    if (!decoder || decoder.state !== "configured") return;
    const isKey = (flags & FLAG_KEYFRAME) !== 0;
    if (this.#needKeyframe && !isKey) return;
    this.#needKeyframe = false;
    decoder.decode(new EncodedVideoChunk({ type: isKey ? "key" : "delta", timestamp: timestampUs, data: payload }));
  }

  #configureVideo(raw: string) {
    let config: VideoConfig;
    try {
      config = JSON.parse(raw) as VideoConfig;
    } catch {
      return;
    }
    if (!this.#videoDecoder || this.#videoDecoder.state === "closed") {
      this.#videoDecoder = new VideoDecoder({
        output: (frame) => this.#onVideoFrame(frame),
        error: () => {
          this.#videoConfig = "";
          this.#needKeyframe = true;
        },
      });
    }
    this.#videoDecoder.configure({
      codec: config.codec,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
      hardwareAcceleration: "prefer-hardware",
      optimizeForLatency: true,
    });
    this.#videoConfig = raw;
    this.#codec = config.codec;
    this.#needKeyframe = true;
  }

  #onVideoFrame(frame: VideoFrame) {
    const now = performance.now();
    if (this.#lastFrameAt !== null && now - this.#lastFrameAt > FREEZE_GAP_MS) this.#counters.freezes++;
    this.#lastFrameAt = now;
    this.#counters.frames++;
    this.#size = { width: frame.displayWidth, height: frame.displayHeight };

    const writer = this.#writer;
    if (!writer || (writer.desiredSize !== null && writer.desiredSize <= 0)) {
      frame.close();
    } else {
      void writer.write(frame).catch(() => frame.close());
    }

    if (!this.#live) {
      this.#live = true;
      clearTimeout(this.#failTimer);
      this.#props.onLive(this.stream);
    }
  }

  // ---- Áudio ----------------------------------------------------------------------------

  async #handleAudio(flags: number, timestampUs: number, payload: Uint8Array) {
    if (flags & FLAG_CONFIG) {
      const raw = new TextDecoder().decode(payload);
      if (raw !== this.#audioConfig) await this.#configureAudio(raw);
      return;
    }
    const decoder = this.#audioDecoder;
    if (!decoder || decoder.state !== "configured") return;
    decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: timestampUs, data: payload }));
  }

  async #configureAudio(raw: string) {
    let config: AudioConfig;
    try {
      config = JSON.parse(raw) as AudioConfig;
    } catch {
      return;
    }
    if (!this.#pcmPort) {
      const channel = new MessageChannel();
      const audio = await createPcmAudioTrack(channel.port2);
      if (this.#closed) {
        audio.close();
        return;
      }
      this.#pcmPort = channel.port1;
      this.#closeAudio = audio.close;
      this.stream.addTrack(audio.track);
    }
    if (!this.#audioDecoder || this.#audioDecoder.state === "closed") {
      this.#audioDecoder = new AudioDecoder({
        output: (data) => this.#onAudioData(data),
        error: () => {
          this.#audioConfig = "";
        },
      });
    }
    this.#audioDecoder.configure({
      codec: config.codec,
      sampleRate: config.sampleRate,
      numberOfChannels: config.numberOfChannels,
    });
    this.#audioConfig = raw;
  }

  /** Converte pra PCM s16 estéreo intercalado, o formato do player (src/lib/desktop.ts). */
  #onAudioData(data: AudioData) {
    const port = this.#pcmPort;
    try {
      if (!port) return;
      const frames = data.numberOfFrames;
      const channels = Math.min(2, data.numberOfChannels);
      const planes = Array.from({ length: channels }, (_, plane) => {
        const buffer = new Float32Array(frames);
        data.copyTo(buffer, { planeIndex: plane, format: "f32-planar" });
        return buffer;
      });
      const pcm = new Int16Array(frames * 2);
      for (let i = 0; i < frames; i++) {
        const left = planes[0][i];
        const right = channels > 1 ? planes[1][i] : left;
        pcm[i * 2] = Math.max(-1, Math.min(1, left)) * 0x7fff;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, right)) * 0x7fff;
      }
      port.postMessage(new Uint8Array(pcm.buffer), [pcm.buffer]);
    } finally {
      data.close();
    }
  }
}
