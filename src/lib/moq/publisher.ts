import * as Moq from "@moq/net";
import { presetBitrate, presetWidth, type QualityPreset } from "@/lib/quality";
import { FLAG_CONFIG, FLAG_KEYFRAME, seal, TRACK_AUDIO, TRACK_VIDEO } from "./crypto";
import { pickVideoConfig, trackProcessor, type TrackProcessor } from "./support";

const CONNECT_TIMEOUT_MS = 6000;
const DISCONNECTED_FAIL_MS = 8000;
const KEYFRAME_INTERVAL_MS = 2000;
const AUDIO_GROUP_MS = 1000;
const MAX_ENCODE_QUEUE = 2;
const AUDIO_BITRATE = 128_000;

export type PublisherStats = {
  sourceFps: number;
  sentFps: number;
  droppedFps: number;
  kbps: number;
  width: number;
  height: number;
  codec: string | null;
  connected: boolean;
};

type Props = {
  relay: URL;
  name: string;
  stream: MediaStream;
  preset: QualityPreset;
  key: CryptoKey;
  keyId: number;
  /** Conexão com o servidor perdida por tempo demais ou encoder quebrado: voltar pro P2P. */
  onFailure: (reason: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);

/**
 * Publica a tela no retransmissor MoQ: uma codificação só (WebCodecs), cada quadro criptografado.
 * Vídeo em grupos que começam num quadro-chave (a cada 2 s) com a config do decoder na frente,
 * pra quem entra no meio começar limpo; áudio Opus em grupos de ~1 s.
 */
export class MoqPublisher {
  readonly name: string;
  #props: Props;
  #connection: Moq.Connection;
  #origin = new Moq.Origin.Producer();
  #broadcast: ReturnType<Moq.Origin.Producer["createBroadcast"]>;
  #videoTrack: Moq.Track.Producer;
  #audioTrack: Moq.Track.Producer;
  #key: CryptoKey;
  #keyId: number;
  #preset: QualityPreset;
  #closed = false;

  #encoder: VideoEncoder | null = null;
  #encoderConfig: VideoEncoderConfig | null = null;
  #videoGroup: Moq.Group.Producer | null = null;
  #lastKeyframeAt = 0;
  #forceKeyframe = true;
  #lastFrameUs = -Infinity;
  #videoSeq = 0;
  /** Cópia do último quadro: tela parada não gera quadros, então ele é reenviado (ver #tick). */
  #lastFrame: VideoFrame | null = null;
  #lastEncodeAt = 0;

  #audioEncoder: AudioEncoder | null = null;
  #audioConfig: AudioEncoderConfig | null = null;
  #audioGroup: Moq.Group.Producer | null = null;
  #audioGroupAt = 0;
  #audioSeq = 0;

  #queue: Promise<void> = Promise.resolve();
  #readers: ReadableStreamDefaultReader<VideoFrame | AudioData>[] = [];
  #monitor: ReturnType<typeof setInterval> | undefined;
  #disconnectedSince: number | null = null;

  #counters = { source: 0, sent: 0, dropped: 0, bytes: 0 };
  #snapshot: PublisherStats = {
    sourceFps: 0,
    sentFps: 0,
    droppedFps: 0,
    kbps: 0,
    width: 0,
    height: 0,
    codec: null,
    connected: false,
  };

  constructor(props: Props) {
    this.#props = props;
    this.name = props.name;
    this.#key = props.key;
    this.#keyId = props.keyId;
    this.#preset = props.preset;
    this.#connection = new Moq.Connection({ url: props.relay, publish: this.#origin.consume() });
    this.#broadcast = this.#origin.createBroadcast(Moq.Path.from(props.name));
    this.#videoTrack = this.#broadcast.createTrack("v", { timescale: Moq.Time.Timescale.MICRO });
    this.#audioTrack = this.#broadcast.createTrack("a", { timescale: Moq.Time.Timescale.MICRO });
  }

  /** Conecta e começa a enviar. Devolve `false` se o servidor não respondeu a tempo. */
  async start(): Promise<boolean> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    while (this.#connection.status.peek() !== "connected") {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || this.#closed) return false;
      await Promise.race([this.#connection.status.changed(), sleep(remaining)]);
    }
    this.#broadcast.announce();

    const Processor = trackProcessor();
    const [video] = this.#props.stream.getVideoTracks();
    const [audio] = this.#props.stream.getAudioTracks();
    if (!Processor || !video) return false;
    void this.#pumpVideo(new Processor({ track: video, maxBufferSize: 2 }) as TrackProcessor<VideoFrame>);
    if (audio) void this.#pumpAudio(new Processor({ track: audio, maxBufferSize: 10 }) as TrackProcessor<AudioData>);

    this.#monitor = setInterval(() => this.#tick(), 1000);
    return true;
  }

  get stats(): PublisherStats {
    return this.#snapshot;
  }

  setPreset(preset: QualityPreset): void {
    this.#preset = preset;
    this.#encoderConfig = null;
    this.#forceKeyframe = true;
  }

  /** Troca a chave (ex.: alguém saiu da sala). O próximo quadro já sai com a nova. */
  rotateKey(key: CryptoKey, keyId: number): void {
    this.#key = key;
    this.#keyId = keyId;
    this.#forceKeyframe = true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#monitor);
    this.#readers.forEach((reader) => void reader.cancel().catch(() => {}));
    this.#lastFrame?.close();
    this.#lastFrame = null;
    if (this.#encoder?.state !== "closed") this.#encoder?.close();
    if (this.#audioEncoder?.state !== "closed") this.#audioEncoder?.close();
    this.#videoGroup?.close();
    this.#audioGroup?.close();
    this.#broadcast.close();
    this.#origin.close();
    this.#connection.close();
  }

  #tick() {
    this.#repeatIfStill();
    const connected = this.#connection.status.peek() === "connected";
    const c = this.#counters;
    this.#snapshot = {
      sourceFps: c.source,
      sentFps: c.sent,
      droppedFps: c.dropped,
      kbps: Math.round((c.bytes * 8) / 1000),
      width: this.#encoderConfig?.width ?? 0,
      height: this.#encoderConfig?.height ?? 0,
      codec: this.#encoderConfig?.codec ?? null,
      connected,
    };
    this.#counters = { source: 0, sent: 0, dropped: 0, bytes: 0 };

    if (connected) this.#disconnectedSince = null;
    else this.#disconnectedSince ??= Date.now();
    if (this.#disconnectedSince !== null && Date.now() - this.#disconnectedSince > DISCONNECTED_FAIL_MS) {
      this.#props.onFailure("conexão com o servidor perdida");
    }
  }

  /** Grava em ordem: a criptografia é assíncrona e os quadros não podem trocar de lugar. */
  #enqueue(task: () => Promise<void>) {
    this.#queue = this.#queue.then(task).catch(() => {});
  }

  // ---- Vídeo ----------------------------------------------------------------------------

  /**
   * A captura só gera quadros quando a tela muda. Parada há mais de 1 s, reenvia o último
   * (com quadro-chave a cada 2 s), senão quem entra depois ficaria sem imagem.
   */
  #repeatIfStill() {
    const last = this.#lastFrame;
    const idleMs = performance.now() - this.#lastEncodeAt;
    if (!last || this.#closed || idleMs < 900) return;
    const repeat = new VideoFrame(last, { timestamp: Math.round(this.#lastFrameUs + idleMs * 1000) });
    void this.#encodeVideo(repeat).finally(() => repeat.close());
  }

  async #pumpVideo(processor: TrackProcessor<VideoFrame>) {
    const reader = processor.readable.getReader();
    this.#readers.push(reader as ReadableStreamDefaultReader<VideoFrame | AudioData>);
    while (!this.#closed) {
      const { value: frame, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done || !frame) break;
      this.#counters.source++;
      try {
        await this.#encodeVideo(frame);
      } finally {
        frame.close();
      }
    }
  }

  async #encodeVideo(frame: VideoFrame) {
    // Respeita o fps escolhido mesmo se a captura vier mais rápida.
    const minGapUs = (1_000_000 / this.#preset.fps) * 0.8;
    if (frame.timestamp - this.#lastFrameUs < minGapUs) return;

    const config = await this.#ensureEncoder(frame);
    if (!config || !this.#encoder) return;
    if (this.#encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      this.#counters.dropped++;
      return;
    }
    this.#lastFrameUs = frame.timestamp;
    const now = performance.now();
    const keyFrame = this.#forceKeyframe || now - this.#lastKeyframeAt >= KEYFRAME_INTERVAL_MS;
    if (keyFrame) {
      this.#forceKeyframe = false;
      this.#lastKeyframeAt = now;
    }
    this.#encoder.encode(frame, { keyFrame });
    this.#lastEncodeAt = now;
    if (this.#lastFrame !== frame) {
      this.#lastFrame?.close();
      this.#lastFrame = frame.clone();
    }
  }

  async #ensureEncoder(frame: VideoFrame): Promise<VideoEncoderConfig | null> {
    const scale = Math.max(
      1,
      frame.displayWidth / presetWidth(this.#preset),
      frame.displayHeight / this.#preset.height,
    );
    const width = even(frame.displayWidth / scale);
    const height = even(frame.displayHeight / scale);
    const current = this.#encoderConfig;
    if (
      current &&
      current.width === width &&
      current.height === height &&
      current.bitrate === presetBitrate(this.#preset) &&
      current.framerate === this.#preset.fps
    ) {
      return current;
    }

    const config = await pickVideoConfig(width, height, presetBitrate(this.#preset), this.#preset.fps);
    if (!config) {
      this.#props.onFailure("navegador sem codificador de vídeo compatível");
      return null;
    }
    if (!this.#encoder || this.#encoder.state === "closed") {
      this.#encoder = new VideoEncoder({
        output: (chunk, metadata) => this.#onVideoChunk(chunk, metadata),
        error: () => this.#props.onFailure("codificador de vídeo falhou"),
      });
    }
    this.#encoder.configure(config);
    this.#encoderConfig = config;
    this.#forceKeyframe = true;
    return config;
  }

  #onVideoChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const isKey = chunk.type === "key";
    const decoder = metadata?.decoderConfig;
    const configBytes = isKey
      ? new TextEncoder().encode(
          JSON.stringify({
            codec: decoder?.codec ?? this.#encoderConfig?.codec,
            codedWidth: decoder?.codedWidth ?? this.#encoderConfig?.width,
            codedHeight: decoder?.codedHeight ?? this.#encoderConfig?.height,
          }),
        )
      : null;
    const timestamp = chunk.timestamp;

    this.#enqueue(async () => {
      if (this.#closed) return;
      if (isKey) {
        this.#videoGroup?.close();
        this.#videoGroup = this.#videoTrack.appendGroup();
        await this.#write(this.#videoGroup, TRACK_VIDEO, FLAG_CONFIG, configBytes!, timestamp, "video");
      }
      if (!this.#videoGroup) return;
      await this.#write(this.#videoGroup, TRACK_VIDEO, isKey ? FLAG_KEYFRAME : 0, data, timestamp, "video");
      this.#counters.sent++;
    });
  }

  // ---- Áudio ----------------------------------------------------------------------------

  async #pumpAudio(processor: TrackProcessor<AudioData>) {
    const reader = processor.readable.getReader();
    this.#readers.push(reader as ReadableStreamDefaultReader<VideoFrame | AudioData>);
    while (!this.#closed) {
      const { value: data, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done || !data) break;
      try {
        await this.#encodeAudio(data);
      } finally {
        data.close();
      }
    }
  }

  async #encodeAudio(data: AudioData) {
    if (!this.#audioEncoder) {
      const config: AudioEncoderConfig = {
        codec: "opus",
        sampleRate: data.sampleRate,
        numberOfChannels: Math.min(2, data.numberOfChannels),
        bitrate: AUDIO_BITRATE,
      };
      const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
      if (!support?.supported) return;
      this.#audioConfig = config;
      this.#audioEncoder = new AudioEncoder({
        output: (chunk) => this.#onAudioChunk(chunk),
        error: () => {},
      });
      this.#audioEncoder.configure(config);
    }
    if (this.#audioEncoder.state === "configured") this.#audioEncoder.encode(data);
  }

  #onAudioChunk(chunk: EncodedAudioChunk) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const timestamp = chunk.timestamp;
    this.#enqueue(async () => {
      if (this.#closed || !this.#audioConfig) return;
      const now = performance.now();
      if (!this.#audioGroup || now - this.#audioGroupAt >= AUDIO_GROUP_MS) {
        this.#audioGroup?.close();
        this.#audioGroup = this.#audioTrack.appendGroup();
        this.#audioGroupAt = now;
        const config = new TextEncoder().encode(JSON.stringify(this.#audioConfig));
        await this.#write(this.#audioGroup, TRACK_AUDIO, FLAG_CONFIG, config, timestamp, "audio");
      }
      await this.#write(this.#audioGroup, TRACK_AUDIO, 0, data, timestamp, "audio");
    });
  }

  // ---- Envio ----------------------------------------------------------------------------

  async #write(
    group: Moq.Group.Producer,
    track: number,
    flags: number,
    payload: Uint8Array<ArrayBuffer>,
    timestampUs: number,
    kind: "video" | "audio",
  ) {
    const seq = kind === "video" ? this.#videoSeq++ : this.#audioSeq++;
    const sealed = await seal(this.#key, { keyId: this.#keyId, flags, timestampUs: Date.now() * 1000, seq }, track, payload);
    group.writeFrame({ payload: sealed, timestamp: Moq.Time.Timestamp.fromMicros(Math.max(0, timestampUs)) });
    this.#counters.bytes += sealed.byteLength;
  }
}
