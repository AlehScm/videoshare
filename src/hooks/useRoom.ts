"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageAction, Room } from "trystero";
import type { DesktopSelection } from "@/lib/desktop";
import {
  applyPresetToTrack,
  canShareScreen,
  captureScreen,
  stopTracks,
  tuneVideoSender,
  type CapturedScreen,
} from "@/lib/media";
import { exportKey, generateKey, importKey } from "@/lib/moq/crypto";
import { MoqPublisher } from "@/lib/moq/publisher";
import { MoqSubscriber } from "@/lib/moq/subscriber";
import { canPublishMoq, canWatchMoq, moqRelayUrl } from "@/lib/moq/support";
import { MAX_NAME_LENGTH } from "@/lib/name-storage";
import {
  DEFAULT_PRESET,
  loadPreset,
  parsePreset,
  presetKey,
  savePreset,
  type QualityPreset,
} from "@/lib/quality";
import {
  chooseRelay,
  measureMbps,
  PROBE_BYTES,
  RELAY_AFTER_MS,
  RELAY_MIN_VIEWERS,
  type Device,
} from "@/lib/relay";

export const MAX_PER_ROOM = 6;
const APP_ID = "videoshare-acm-presenca";
const NOTICE_MS = 5000;
const PROBE_FIRST_DELAY_MS = 1500;
const PROBE_STAGGER_MS = 1200;
const PROBE_ON_JOIN_DELAY_MS = 3000;

/**
 * `relay` e `moq` só são preenchidos por quem apresenta: quem está repassando a tela dele (P2P)
 * e o nome da transmissão no servidor MoQ. `moqWatch`: este navegador consegue assistir pelo servidor.
 */
type Hello = {
  name: string;
  joinedAt: number;
  sharingSince: number | null;
  device?: Device;
  relay: string | null;
  moq: string | null;
  moqWatch?: boolean;
};

/** Chave da transmissão no servidor; só circula dentro da sala, pelo P2P. */
type MoqKeyMessage = { id: number; key: string };

const MOQ_NAME = /^vs-[0-9a-f]{32}$/;
const MAX_KEYS_PER_PRESENTER = 3;

function randomBroadcastName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `vs-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type Limitation = "none" | "cpu" | "bandwidth" | "other";
/** O que quem apresenta conta pros outros sobre o próprio envio (ver useStreamStats). */
export type QualityStatus = { limitation: Limitation; viewers: number; sourceFps: number; preset: string };
export type PresenterQuality = Omit<QualityStatus, "preset"> & {
  preset: QualityPreset;
  peerId: string;
  at: number;
};

const LIMITATIONS: readonly Limitation[] = ["none", "cpu", "bandwidth", "other"];

function parseQualityStatus(data: unknown): Omit<PresenterQuality, "peerId" | "at"> | null {
  if (typeof data !== "object" || data === null) return null;
  const { limitation, viewers, sourceFps, preset } = data as Record<string, unknown>;
  const parsedPreset = parsePreset(preset);
  if (!LIMITATIONS.includes(limitation as Limitation) || typeof viewers !== "number" || !parsedPreset) {
    return null;
  }
  return {
    limitation: limitation as Limitation,
    viewers,
    sourceFps: typeof sourceFps === "number" ? sourceFps : 0,
    preset: parsedPreset,
  };
}

export type Participant = Hello & { id: string; isSelf: boolean };

export type RoomStatus = "entrando" | "na-sala" | "cheia" | "erro";

function parseHello(data: unknown): Hello | null {
  if (typeof data !== "object" || data === null) return null;
  const { name, joinedAt, sharingSince, device, relay, moq, moqWatch } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof joinedAt !== "number") return null;
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) return null;
  return {
    name: clean,
    joinedAt,
    sharingSince: typeof sharingSince === "number" ? sharingSince : null,
    // Versões antigas não mandam `device` e não sabem repassar; ficam fora da escolha do repetidor.
    device: device === "desktop" || device === "mobile" ? device : undefined,
    relay: typeof relay === "string" ? relay : null,
    moq: typeof moq === "string" && MOQ_NAME.test(moq) ? moq : null,
    // Versões antigas não mandam `moqWatch`: recebem pelo P2P.
    moqWatch: moqWatch === true,
  };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function byArrival(a: Participant, b: Participant): number {
  return a.joinedAt - b.joinedAt || a.id.localeCompare(b.id);
}

/** `true` se `a` começou a compartilhar depois de `b` (empate decidido pelo id). */
function sharedLater(a: { id: string; since: number }, b: { id: string; since: number }): boolean {
  return a.since > b.since || (a.since === b.since && a.id > b.id);
}

/** Quem está apresentando entre os outros (sem contar eu). */
function remotePresenter(peers: Record<string, Hello>): { id: string; hello: Hello } | null {
  let best: { id: string; hello: Hello } | null = null;
  for (const [id, hello] of Object.entries(peers)) {
    if (hello.sharingSince === null) continue;
    if (!best || sharedLater({ id, since: hello.sharingSince }, { id: best.id, since: best.hello.sharingSince! })) {
      best = { id, hello };
    }
  }
  return best;
}

type Forwarding = { presenterId: string; stream: MediaStream; targets: Set<string> };

/**
 * Sala P2P via Trystero (descoberta por relays Nostr públicos, dados e mídia via WebRTC).
 * - Presença: cada peer manda `Hello` ao conectar e de novo quando algo muda.
 * - Limite: ordem de chegada decide quem fica; quem passa de MAX_PER_ROOM sai sozinho.
 * - Tela: uma por vez; quem começa a compartilhar substitui quem estava apresentando.
 * - Repetidor: se o envio de quem apresenta não dá conta, o computador com melhor upload
 *   (medido pela action `probeData`) recebe uma cópia e repassa pros outros. Cada pessoa avisa
 *   (`relayAck`) quando a cópia do repetidor chegou, e só então quem apresenta para o envio direto.
 */
export function useRoom(roomId: string, name: string) {
  const roomRef = useRef<Room | null>(null);
  const helloRef = useRef<MessageAction<Hello> | null>(null);
  const qstatRef = useRef<MessageAction<QualityStatus> | null>(null);
  const probeReqRef = useRef<MessageAction<number> | null>(null);
  const probeDataRef = useRef<MessageAction<Uint8Array> | null>(null);
  const relayAckRef = useRef<MessageAction<number> | null>(null);
  const mkeyRef = useRef<MessageAction<MoqKeyMessage> | null>(null);
  const moqFailRef = useRef<MessageAction<string> | null>(null);
  const meRef = useRef<Hello>({ name, joinedAt: 0, sharingSince: null, relay: null, moq: null });
  const selfIdRef = useRef("");
  const peersRef = useRef<Record<string, Hello>>({});
  const streamsRef = useRef<Record<string, MediaStream>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const releaseRef = useRef<() => void>(() => {});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preset, setPreset] = useState<QualityPreset>(loadPreset);
  const presetRef = useRef(preset);

  // Quem apresenta: upload medido de cada computador, desde quando o envio está limitado,
  // repetidor atual e pra quem o envio direto já foi trocado pelo repetidor.
  const uploadMbpsRef = useRef<Record<string, number>>({});
  const probeStartRef = useRef<Record<string, number>>({});
  const probedRef = useRef(new Set<string>());
  const limitedSinceRef = useRef<number | null>(null);
  const relayRef = useRef<string | null>(null);
  const directOffRef = useRef(new Set<string>());
  // Repetidor: o que está repassando e a qualidade escolhida por quem apresenta.
  const forwardingRef = useRef<Forwarding | null>(null);
  const presenterPresetRef = useRef<QualityPreset>(DEFAULT_PRESET);
  // Servidor MoQ, quem apresenta: publicador, chave atual e quem recebe pelo P2P mesmo assim
  // (navegador sem suporte ou que não conseguiu receber pelo servidor).
  const publisherRef = useRef<MoqPublisher | null>(null);
  const keyRef = useRef<{ key: CryptoKey; id: number; encoded: string } | null>(null);
  const p2pPeersRef = useRef(new Set<string>());
  // Servidor MoQ, quem assiste: chaves recebidas por quem apresenta e o assinante atual.
  const keysRef = useRef(new Map<string, Map<number, CryptoKey>>());
  const subscriberRef = useRef<MoqSubscriber | null>(null);
  const moqFailedRef = useRef(new Set<string>());

  const [selfId, setSelfId] = useState<string | null>(null);
  const [me, setMe] = useState<Hello | null>(null);
  const [peers, setPeers] = useState<Record<string, Hello>>({});
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [presenterQuality, setPresenterQuality] = useState<PresenterQuality | null>(null);
  const [relaying, setRelaying] = useState(0);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [moqStream, setMoqStream] = useState<MediaStream | null>(null);

  const showNotice = useCallback((message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const updateMe = useCallback((patch: Partial<Hello>) => {
    meRef.current = { ...meRef.current, ...patch };
    setMe(meRef.current);
    void helloRef.current?.send(meRef.current);
  }, []);

  const setStream = useCallback((peerId: string, stream: MediaStream | null) => {
    streamsRef.current = stream
      ? { ...streamsRef.current, [peerId]: stream }
      : without(streamsRef.current, peerId);
    setStreams(streamsRef.current);
  }, []);

  /** Para a captura local (e o áudio do app de desktop e o envio pro servidor, se houver). */
  const endCapture = useCallback(() => {
    publisherRef.current?.close();
    publisherRef.current = null;
    keyRef.current = null;
    p2pPeersRef.current.clear();
    stopTracks(localStreamRef.current);
    localStreamRef.current = null;
    releaseRef.current();
    releaseRef.current = () => {};
  }, []);

  /** Aplica a qualidade escolhida por quem apresenta em todas as conexões. */
  const retuneSenders = useCallback(() => {
    const room = roomRef.current;
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!room || !track) return;
    Object.values(room.getPeers()).forEach((pc) => void tuneVideoSender(pc, track, presetRef.current));
  }, []);

  const sendScreen = useCallback(
    (room: Room, stream: MediaStream, peerId: string) => {
      const [sent] = room.addStream(stream, { target: peerId });
      void sent?.then(retuneSenders).catch(() => {});
    },
    [retuneSenders],
  );

  // ---- Servidor MoQ: lado de quem apresenta --------------------------------------------

  /** Manda a chave atual (pra uma pessoa ou pra sala toda) pelo P2P. */
  const sendKey = useCallback((target?: string) => {
    const current = keyRef.current;
    if (!current) return;
    void mkeyRef.current
      ?.send({ id: current.id, key: current.encoded }, target ? { target } : undefined)
      .catch(() => {});
  }, []);

  /** Manda direto (P2P) uma vez por pessoa: navegador sem suporte, falha no servidor ou modo P2P. */
  const sendP2P = useCallback(
    (peerId: string) => {
      const room = roomRef.current;
      const stream = localStreamRef.current;
      if (!room || !stream || p2pPeersRef.current.has(peerId)) return;
      p2pPeersRef.current.add(peerId);
      sendScreen(room, stream, peerId);
    },
    [sendScreen],
  );

  /** Servidor caiu ou não respondeu: todo mundo passa a receber direto. */
  const fallbackToP2P = useCallback(
    (reason: string) => {
      const publisher = publisherRef.current;
      if (!publisher) return;
      publisher.close();
      publisherRef.current = null;
      keyRef.current = null;
      setPublishing(false);
      const room = roomRef.current;
      if (!room || !localStreamRef.current) return;
      Object.keys(room.getPeers()).forEach(sendP2P);
      updateMe({ moq: null });
      showNotice(`O servidor de transmissão falhou (${reason}); passando pra conexão direta.`);
    },
    [sendP2P, showNotice, updateMe],
  );

  /** Tenta publicar no servidor. Devolve o nome da transmissão, ou `null` pra ficar no P2P. */
  const startMoq = useCallback(
    async (stream: MediaStream): Promise<string | null> => {
      const relay = moqRelayUrl();
      if (!relay || !canPublishMoq()) return null;
      const key = await generateKey();
      const encoded = await exportKey(key);
      const id = 1;
      const broadcastName = randomBroadcastName();
      const publisher = new MoqPublisher({
        relay,
        name: broadcastName,
        stream,
        preset: presetRef.current,
        key,
        keyId: id,
        onFailure: fallbackToP2P,
      });
      publisherRef.current = publisher;
      keyRef.current = { key, id, encoded };
      const ok = await publisher.start().catch(() => false);
      if (ok && publisherRef.current === publisher && localStreamRef.current === stream) return broadcastName;
      publisher.close();
      if (publisherRef.current === publisher) {
        publisherRef.current = null;
        keyRef.current = null;
      }
      return null;
    },
    [fallbackToP2P],
  );

  /** Alguém saiu: chave nova só pra quem ficou. Manda antes de usar, pra ninguém ficar sem imagem. */
  const rotateKey = useCallback(async () => {
    const publisher = publisherRef.current;
    const current = keyRef.current;
    if (!publisher || !current) return;
    const key = await generateKey();
    const encoded = await exportKey(key);
    const id = (current.id % 255) + 1;
    if (publisherRef.current !== publisher) return;
    keyRef.current = { key, id, encoded };
    sendKey();
    setTimeout(() => {
      if (publisherRef.current === publisher && keyRef.current?.id === id) publisher.rotateKey(key, id);
    }, 500);
  }, [sendKey]);

  // ---- Servidor MoQ: lado de quem assiste ----------------------------------------------

  const closeSubscriber = useCallback(() => {
    subscriberRef.current?.close();
    subscriberRef.current = null;
    setMoqStream(null);
  }, []);

  /** Assina a transmissão de quem apresenta no servidor; se não chegar nada, pede o P2P. */
  const syncSubscriber = useCallback(() => {
    const presenter = remotePresenter(peersRef.current);
    const broadcastName = presenter?.hello.moq ?? null;
    const want =
      presenter && broadcastName && !localStreamRef.current && canWatchMoq() && !moqFailedRef.current.has(broadcastName)
        ? { presenterId: presenter.id, name: broadcastName }
        : null;
    if (subscriberRef.current && subscriberRef.current.name !== want?.name) closeSubscriber();
    if (!want || subscriberRef.current) return;
    const relay = moqRelayUrl();
    if (!relay) return;
    const subscriber: MoqSubscriber = new MoqSubscriber({
      relay,
      name: want.name,
      getKey: (id) => keysRef.current.get(want.presenterId)?.get(id),
      onLive: (stream) => {
        if (subscriberRef.current === subscriber) setMoqStream(stream);
      },
      onFailure: () => {
        if (subscriberRef.current !== subscriber) return;
        moqFailedRef.current.add(want.name);
        closeSubscriber();
        void moqFailRef.current?.send(want.name, { target: want.presenterId }).catch(() => {});
      },
    });
    subscriberRef.current = subscriber;
  }, [closeSubscriber]);

  // ---- Repetidor: lado de quem repassa -------------------------------------------------

  const retuneForwarding = useCallback(() => {
    const room = roomRef.current;
    const fw = forwardingRef.current;
    const track = fw?.stream.getVideoTracks()[0];
    if (!room || !fw || !track) return;
    const connections = room.getPeers();
    fw.targets.forEach((id) => {
      const pc = connections[id];
      if (pc) void tuneVideoSender(pc, track, presenterPresetRef.current);
    });
  }, []);

  const forwardTo = useCallback(
    (peerId: string) => {
      const room = roomRef.current;
      const fw = forwardingRef.current;
      if (!room || !fw || peerId === fw.presenterId || fw.targets.has(peerId)) return;
      fw.targets.add(peerId);
      setRelaying(fw.targets.size);
      const [sent] = room.addStream(fw.stream, { target: peerId });
      void sent?.then(retuneForwarding).catch(() => {});
    },
    [retuneForwarding],
  );

  /** Liga, troca ou desliga o repasse conforme o hello de quem apresenta. */
  const updateForwarding = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const presenter = remotePresenter(peersRef.current);
    const amRelay =
      presenter !== null && presenter.hello.relay === selfIdRef.current && !localStreamRef.current;
    const source = amRelay ? streamsRef.current[presenter.id] : undefined;
    const current = forwardingRef.current;

    if (current && (!source || current.stream !== source)) {
      if (current.targets.size) room.removeStream(current.stream, { target: [...current.targets] });
      forwardingRef.current = null;
      setRelaying(0);
    }
    if (presenter && source && !forwardingRef.current) {
      forwardingRef.current = { presenterId: presenter.id, stream: source, targets: new Set() };
      Object.keys(room.getPeers()).forEach(forwardTo);
    }
  }, [forwardTo]);

  // ---- Repetidor: lado de quem apresenta -----------------------------------------------

  /** Pede o teste de envio uma vez por pessoa (computador) durante a transmissão. */
  const requestProbe = useCallback((peerId: string) => {
    if (!localStreamRef.current || peersRef.current[peerId]?.device !== "desktop") return;
    if (probedRef.current.has(peerId)) return;
    probedRef.current.add(peerId);
    delete probeStartRef.current[peerId];
    void probeReqRef.current?.send(1, { target: peerId }).catch(() => {});
  }, []);

  const activateRelay = useCallback(
    (relayId: string) => {
      relayRef.current = relayId;
      directOffRef.current.clear();
      setRelayUnavailable(false);
      updateMe({ relay: relayId });
      const relayName = peersRef.current[relayId]?.name ?? "Alguém";
      showNotice(`Sua internet de envio não dava conta; ${relayName} está repassando sua tela pros outros.`);
    },
    [showNotice, updateMe],
  );

  /** Repetidor saiu: volta a mandar direto pra quem estava recebendo por ele. */
  const deactivateRelay = useCallback(() => {
    const room = roomRef.current;
    const stream = localStreamRef.current;
    relayRef.current = null;
    limitedSinceRef.current = null;
    if (room && stream) directOffRef.current.forEach((peerId) => sendScreen(room, stream, peerId));
    directOffRef.current.clear();
    if (stream) updateMe({ relay: null });
  }, [sendScreen, updateMe]);

  const stopShare = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    roomRef.current?.removeStream(stream);
    endCapture();
    relayRef.current = null;
    limitedSinceRef.current = null;
    directOffRef.current.clear();
    setLocalStream(null);
    setRelayUnavailable(false);
    setPublishing(false);
    updateMe({ sharingSince: null, relay: null, moq: null });
  }, [endCapture, updateMe]);

  /** Quem apresenta escolhe a qualidade; durante a transmissão a troca vale na hora. */
  const changePreset = useCallback(
    (next: QualityPreset) => {
      presetRef.current = next;
      setPreset(next);
      savePreset(next);
      publisherRef.current?.setPreset(next);
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (track) void applyPresetToTrack(track, next).then(retuneSenders);
    },
    [retuneSenders],
  );

  const getConnections = useCallback(() => roomRef.current?.getPeers() ?? {}, []);

  /**
   * Chamado pelo useStreamStats a cada 2 s enquanto eu apresento. Além de avisar os outros,
   * liga o repetidor quando o envio fica limitado por tempo suficiente.
   */
  const sendQualityStatus = useCallback(
    (status: Omit<QualityStatus, "preset">) => {
      void qstatRef.current?.send({ ...status, preset: presetKey(presetRef.current) }).catch(() => {});
      const room = roomRef.current;
      // Pelo servidor só existe um envio; repetidor só faz sentido no P2P.
      if (!room || !localStreamRef.current || relayRef.current || publisherRef.current) return;

      const limited = status.limitation === "bandwidth" || status.limitation === "cpu";
      if (!limited) {
        limitedSinceRef.current = null;
        setRelayUnavailable(false);
        return;
      }
      limitedSinceRef.current ??= Date.now();
      const connected = Object.keys(room.getPeers());
      if (connected.length < RELAY_MIN_VIEWERS || Date.now() - limitedSinceRef.current < RELAY_AFTER_MS) return;

      const candidates = connected
        .filter((id) => peersRef.current[id]?.device === "desktop" && uploadMbpsRef.current[id] !== undefined)
        .map((id) => ({ id, uploadMbps: uploadMbpsRef.current[id] }));
      const choice = chooseRelay(candidates, connected.length, presetRef.current);
      if (choice) activateRelay(choice);
      else setRelayUnavailable(true);
    },
    [activateRelay],
  );

  // Garante que o novo compartilhamento fique "depois" do atual mesmo com relógios desalinhados.
  const nextSharingSince = useCallback(() => {
    const known = Object.values(peersRef.current).map((hello) => hello.sharingSince ?? 0);
    return Math.max(Date.now(), ...known.map((since) => since + 1));
  }, []);

  /** `selection` vem do seletor do app de desktop; no navegador fica vazio. */
  const startShare = useCallback(
    async (selection?: DesktopSelection) => {
      if (localStreamRef.current || !roomRef.current) return;

      let captured: CapturedScreen | null;
      try {
        captured = await captureScreen(presetRef.current, selection);
      } catch {
        showNotice("Não foi possível compartilhar a tela. Verifique a permissão do navegador.");
        return;
      }
      if (!captured) return;
      const { stream, release } = captured;

      const room = roomRef.current;
      if (!room) {
        stopTracks(stream);
        release();
        return;
      }

      localStreamRef.current = stream;
      releaseRef.current = release;
      probedRef.current.clear();
      p2pPeersRef.current.clear();
      setLocalStream(stream);
      updateForwarding();
      closeSubscriber();
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare, { once: true });
      updateMe({ sharingSince: nextSharingSince(), relay: null, moq: null });
      if (stream.getAudioTracks().length === 0 && !selection) {
        showNotice("Compartilhando sem som. Pra mandar o áudio, marque a opção de áudio no seletor do navegador.");
      }

      // Sempre pelo servidor quando der; quem não consegue assistir por lá recebe direto.
      const broadcastName = await startMoq(stream);
      if (localStreamRef.current !== stream) return;
      const connected = Object.keys(room.getPeers());
      if (broadcastName) {
        setPublishing(true);
        sendKey();
        updateMe({ moq: broadcastName });
        connected.filter((id) => !peersRef.current[id]?.moqWatch).forEach(sendP2P);
        return;
      }
      connected.forEach(sendP2P);
      connected.forEach((peerId, i) =>
        setTimeout(() => requestProbe(peerId), PROBE_FIRST_DELAY_MS + i * PROBE_STAGGER_MS),
      );
    },
    [
      closeSubscriber,
      nextSharingSince,
      requestProbe,
      sendKey,
      sendP2P,
      showNotice,
      startMoq,
      stopShare,
      updateForwarding,
      updateMe,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    meRef.current = {
      name,
      joinedAt: Date.now(),
      sharingSince: null,
      device: canShareScreen() ? "desktop" : "mobile",
      relay: null,
      moq: null,
      moqWatch: canWatchMoq(),
    };
    peersRef.current = {};
    streamsRef.current = {};
    uploadMbpsRef.current = {};
    keysRef.current = new Map();
    moqFailedRef.current = new Set();

    import("trystero")
      .then(({ joinRoom, selfId }) => {
        if (cancelled) return;
        const room = joinRoom({ appId: APP_ID }, roomId, {
          onJoinError: () => setFailed(true),
        });
        const hello = room.makeAction<Hello>("hello");
        const qstat = room.makeAction<QualityStatus>("qstat");
        const probeReq = room.makeAction<number>("probeReq");
        const probeData = room.makeAction<Uint8Array>("probeData");
        const relayAck = room.makeAction<number>("relayAck");
        const mkey = room.makeAction<MoqKeyMessage>("mkey");
        const moqFail = room.makeAction<string>("moqFail");

        // Guarda as últimas chaves de cada pessoa: na troca, quadros com a chave anterior ainda abrem.
        mkey.onMessage = (data, { peerId }) => {
          if (typeof data?.id !== "number" || typeof data?.key !== "string") return;
          void importKey(data.key)
            .then((key) => {
              const keys = keysRef.current.get(peerId) ?? new Map<number, CryptoKey>();
              keys.set(data.id, key);
              while (keys.size > MAX_KEYS_PER_PRESENTER) keys.delete(keys.keys().next().value!);
              keysRef.current.set(peerId, keys);
            })
            .catch(() => {});
        };
        // Quem assiste não conseguiu receber pelo servidor: manda direto pra essa pessoa.
        moqFail.onMessage = (data, { peerId }) => {
          if (publisherRef.current && data === publisherRef.current.name) sendP2P(peerId);
        };

        /** Avisa quem apresenta que a cópia do repetidor chegou aqui. */
        const ackRelayIfReady = () => {
          const presenter = remotePresenter(peersRef.current);
          const relayId = presenter?.hello.relay;
          if (!presenter || !relayId || relayId === selfIdRef.current || !streamsRef.current[relayId]) return;
          void relayAck.send(1, { target: presenter.id }).catch(() => {});
        };

        qstat.onMessage = (data, { peerId }) => {
          const parsed = parseQualityStatus(data);
          if (!parsed) return;
          setPresenterQuality({ ...parsed, peerId, at: Date.now() });
          const changed = presetKey(parsed.preset) !== presetKey(presenterPresetRef.current);
          presenterPresetRef.current = parsed.preset;
          if (changed && forwardingRef.current?.presenterId === peerId) retuneForwarding();
        };

        hello.onMessage = (data, { peerId }) => {
          const parsed = parseHello(data);
          if (!parsed) return;
          const previous = peersRef.current[peerId];
          peersRef.current = { ...peersRef.current, [peerId]: parsed };
          setPeers(peersRef.current);

          // Repetidor trocado ou desligado: a cópia antiga dele não vale mais.
          if (previous?.relay && (previous.relay !== parsed.relay || parsed.sharingSince === null)) {
            if (previous.relay !== selfIdRef.current) setStream(previous.relay, null);
          }
          if (parsed.sharingSince === null) setStream(peerId, null);
          updateForwarding();
          ackRelayIfReady();
          requestProbe(peerId);
          // Apresentando pelo servidor: quem não consegue assistir por lá recebe direto.
          if (publisherRef.current && !parsed.moqWatch) sendP2P(peerId);
          syncSubscriber();
          if (parsed.sharingSince === null) return;

          const mine = meRef.current.sharingSince;
          if (
            mine !== null &&
            sharedLater({ id: peerId, since: parsed.sharingSince }, { id: selfIdRef.current, since: mine })
          ) {
            stopShare();
            showNotice(`${parsed.name} começou a compartilhar e substituiu a sua tela.`);
          }
        };

        probeReq.onMessage = (_data, { peerId }) => {
          if (typeof peersRef.current[peerId]?.sharingSince !== "number" || meRef.current.device !== "desktop") return;
          void probeData.send(new Uint8Array(PROBE_BYTES), { target: peerId }).catch(() => {});
        };
        probeData.onReceiveProgress = (_progress, { peerId }) => {
          probeStartRef.current[peerId] ??= performance.now();
        };
        probeData.onMessage = (data, { peerId }) => {
          const start = probeStartRef.current[peerId];
          delete probeStartRef.current[peerId];
          // O Trystero entrega binário como Uint8Array.
          if (start === undefined || !ArrayBuffer.isView(data)) return;
          uploadMbpsRef.current[peerId] = measureMbps(data.byteLength, performance.now() - start);
        };

        relayAck.onMessage = (_data, { peerId }) => {
          const stream = localStreamRef.current;
          if (!stream || !relayRef.current || peerId === relayRef.current || directOffRef.current.has(peerId)) return;
          directOffRef.current.add(peerId);
          room.removeStream(stream, { target: peerId });
        };

        room.onPeerJoin = (peerId) => {
          void hello.send(meRef.current, { target: peerId });
          const stream = localStreamRef.current;
          if (stream && publisherRef.current) {
            // Pelo servidor: só a chave. Se o navegador da pessoa não assiste por lá, o hello dela decide.
            sendKey(peerId);
          } else if (stream) {
            // Manda direto também; se houver repetidor, a pessoa confirma e o direto é desligado.
            sendP2P(peerId);
            setTimeout(() => requestProbe(peerId), PROBE_ON_JOIN_DELAY_MS);
          }
          if (forwardingRef.current) forwardTo(peerId);
        };
        room.onPeerLeave = (peerId) => {
          peersRef.current = without(peersRef.current, peerId);
          setPeers(peersRef.current);
          setStream(peerId, null);
          delete uploadMbpsRef.current[peerId];
          probedRef.current.delete(peerId);
          directOffRef.current.delete(peerId);
          p2pPeersRef.current.delete(peerId);
          keysRef.current.delete(peerId);
          forwardingRef.current?.targets.delete(peerId);
          if (forwardingRef.current) setRelaying(forwardingRef.current.targets.size);
          if (peerId === relayRef.current) deactivateRelay();
          if (publisherRef.current) void rotateKey();
          updateForwarding();
          syncSubscriber();
          retuneSenders();
        };
        room.onPeerStream = (stream, peerId) => {
          setStream(peerId, stream);
          updateForwarding();
          ackRelayIfReady();
        };

        roomRef.current = room;
        helloRef.current = hello;
        qstatRef.current = qstat;
        probeReqRef.current = probeReq;
        probeDataRef.current = probeData;
        relayAckRef.current = relayAck;
        mkeyRef.current = mkey;
        moqFailRef.current = moqFail;
        selfIdRef.current = selfId;
        setPeers({});
        setStreams({});
        setFailed(false);
        setSelfId(selfId);
        setMe(meRef.current);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(noticeTimer.current);
      endCapture();
      closeSubscriber();
      forwardingRef.current = null;
      relayRef.current = null;
      void roomRef.current?.leave();
      roomRef.current = null;
      helloRef.current = null;
      qstatRef.current = null;
      probeReqRef.current = null;
      probeDataRef.current = null;
      relayAckRef.current = null;
      mkeyRef.current = null;
      moqFailRef.current = null;
    };
  }, [
    roomId,
    name,
    closeSubscriber,
    deactivateRelay,
    endCapture,
    forwardTo,
    requestProbe,
    retuneForwarding,
    retuneSenders,
    rotateKey,
    sendKey,
    sendP2P,
    setStream,
    showNotice,
    stopShare,
    syncSubscriber,
    updateForwarding,
  ]);

  const ranked = useMemo(() => {
    const others = Object.entries(peers).map(
      ([id, hello]): Participant => ({ id, ...hello, isSelf: false }),
    );
    const self = selfId && me ? [{ id: selfId, ...me, isSelf: true }] : [];
    return [...others, ...self].sort(byArrival);
  }, [peers, selfId, me]);

  const isFull = ranked.findIndex((p) => p.isSelf) >= MAX_PER_ROOM;

  useEffect(() => {
    const room = roomRef.current;
    if (!isFull || !room) return;
    room.onPeerJoin = null;
    room.onPeerLeave = null;
    room.onPeerStream = null;
    endCapture();
    closeSubscriber();
    void room.leave();
    roomRef.current = null;
  }, [closeSubscriber, endCapture, isFull]);

  const participants = ranked.slice(0, MAX_PER_ROOM);

  const presenter =
    participants
      .filter((p) => p.sharingSince !== null)
      .sort((a, b) =>
        sharedLater({ id: a.id, since: a.sharingSince! }, { id: b.id, since: b.sharingSince! }) ? -1 : 1,
      )[0] ?? null;

  const relay = presenter?.relay ? (participants.find((p) => p.id === presenter.relay) ?? null) : null;
  // Recebe pelo repetidor quando a cópia dele já chegou; até lá, segue no direto.
  const viaRelay = relay && !relay.isSelf && streams[relay.id] ? relay.id : null;

  // Pelo servidor quando a imagem de lá já chegou; senão, o que vier pelo P2P.
  const viaServer = presenter !== null && !presenter.isSelf && presenter.moq !== null && moqStream !== null;

  const presenterStream = presenter
    ? presenter.isSelf
      ? localStream
      : viaServer
        ? moqStream
        : (streams[viaRelay ?? presenter.id] ?? null)
    : null;

  const transport: "servidor" | "p2p" = presenter?.isSelf ? (publishing ? "servidor" : "p2p") : viaServer ? "servidor" : "p2p";

  const getPublisherStats = useCallback(() => publisherRef.current?.stats ?? null, []);
  const getSubscriberStats = useCallback(() => subscriberRef.current?.stats ?? null, []);

  const status: RoomStatus = failed
    ? "erro"
    : isFull
      ? "cheia"
      : selfId
        ? "na-sala"
        : "entrando";

  return {
    status,
    participants,
    presenter,
    presenterStream,
    relay,
    receivingViaRelay: viaRelay !== null,
    relaying,
    relayUnavailable,
    isSharing: localStream !== null,
    notice,
    presenterQuality,
    startShare,
    stopShare,
    getConnections,
    sendQualityStatus,
    preset,
    changePreset,
    transport,
    getPublisherStats,
    getSubscriberStats,
  };
}
