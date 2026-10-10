"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MessageAction, Room } from "trystero";
import type { DesktopSelection } from "@/lib/desktop";
import {
  applyPresetToTrack,
  captureScreen,
  stopTracks,
  tuneVideoSender,
  type CapturedScreen,
} from "@/lib/media";
import { MAX_NAME_LENGTH } from "@/lib/name-storage";
import { loadPreset, parsePreset, presetKey, savePreset, type QualityPreset } from "@/lib/quality";

export const MAX_PER_ROOM = 6;
const APP_ID = "videoshare-acm-presenca";
const NOTICE_MS = 5000;

type Hello = { name: string; joinedAt: number; sharingSince: number | null };

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
  const { name, joinedAt, sharingSince } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof joinedAt !== "number") return null;
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) return null;
  return { name: clean, joinedAt, sharingSince: typeof sharingSince === "number" ? sharingSince : null };
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

/**
 * Sala P2P via Trystero (descoberta por relays Nostr públicos, dados e mídia via WebRTC).
 * - Presença: cada peer manda `Hello` ao conectar e de novo quando começa/para de compartilhar.
 * - Limite: ordem de chegada decide quem fica; quem passa de MAX_PER_ROOM sai sozinho.
 * - Tela: uma por vez; quem começa a compartilhar substitui quem estava apresentando.
 */
export function useRoom(roomId: string, name: string) {
  const roomRef = useRef<Room | null>(null);
  const helloRef = useRef<MessageAction<Hello> | null>(null);
  const qstatRef = useRef<MessageAction<QualityStatus> | null>(null);
  const meRef = useRef<Hello>({ name, joinedAt: 0, sharingSince: null });
  const selfIdRef = useRef("");
  const peersRef = useRef<Record<string, Hello>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const releaseRef = useRef<() => void>(() => {});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preset, setPreset] = useState<QualityPreset>(loadPreset);
  const presetRef = useRef(preset);

  const [selfId, setSelfId] = useState<string | null>(null);
  const [me, setMe] = useState<Hello | null>(null);
  const [peers, setPeers] = useState<Record<string, Hello>>({});
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [presenterQuality, setPresenterQuality] = useState<PresenterQuality | null>(null);

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

  /** Para a captura local (e o áudio do app de desktop, se houver). */
  const endCapture = useCallback(() => {
    stopTracks(localStreamRef.current);
    localStreamRef.current = null;
    releaseRef.current();
    releaseRef.current = () => {};
  }, []);

  const stopShare = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    roomRef.current?.removeStream(stream);
    endCapture();
    setLocalStream(null);
    updateMe({ sharingSince: null });
  }, [endCapture, updateMe]);

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

  /** Quem apresenta escolhe a qualidade; durante a transmissão a troca vale na hora. */
  const changePreset = useCallback(
    (next: QualityPreset) => {
      presetRef.current = next;
      setPreset(next);
      savePreset(next);
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (track) void applyPresetToTrack(track, next).then(retuneSenders);
    },
    [retuneSenders],
  );

  const getConnections = useCallback(() => roomRef.current?.getPeers() ?? {}, []);

  const sendQualityStatus = useCallback((status: Omit<QualityStatus, "preset">) => {
    void qstatRef.current?.send({ ...status, preset: presetKey(presetRef.current) }).catch(() => {});
  }, []);

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
      setLocalStream(stream);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare, { once: true });
      updateMe({ sharingSince: nextSharingSince() });
      Object.keys(room.getPeers()).forEach((peerId) => sendScreen(room, stream, peerId));
      if (stream.getAudioTracks().length === 0 && !selection) {
        showNotice("Compartilhando sem som. Pra mandar o áudio, marque a opção de áudio no seletor do navegador.");
      }
    },
    [nextSharingSince, sendScreen, showNotice, stopShare, updateMe],
  );

  useEffect(() => {
    let cancelled = false;
    meRef.current = { name, joinedAt: Date.now(), sharingSince: null };
    peersRef.current = {};

    import("trystero")
      .then(({ joinRoom, selfId }) => {
        if (cancelled) return;
        const room = joinRoom({ appId: APP_ID }, roomId, {
          onJoinError: () => setFailed(true),
        });
        const hello = room.makeAction<Hello>("hello");
        const qstat = room.makeAction<QualityStatus>("qstat");

        qstat.onMessage = (data, { peerId }) => {
          const parsed = parseQualityStatus(data);
          if (parsed) setPresenterQuality({ ...parsed, peerId, at: Date.now() });
        };
        hello.onMessage = (data, { peerId }) => {
          const parsed = parseHello(data);
          if (!parsed) return;
          peersRef.current = { ...peersRef.current, [peerId]: parsed };
          setPeers(peersRef.current);
          if (parsed.sharingSince === null) {
            setStreams((prev) => without(prev, peerId));
            return;
          }
          const mine = meRef.current.sharingSince;
          if (
            mine !== null &&
            sharedLater({ id: peerId, since: parsed.sharingSince }, { id: selfIdRef.current, since: mine })
          ) {
            stopShare();
            showNotice(`${parsed.name} começou a compartilhar e substituiu a sua tela.`);
          }
        };
        room.onPeerJoin = (peerId) => {
          void hello.send(meRef.current, { target: peerId });
          const stream = localStreamRef.current;
          if (stream) sendScreen(room, stream, peerId);
        };
        room.onPeerLeave = (peerId) => {
          peersRef.current = without(peersRef.current, peerId);
          setPeers(peersRef.current);
          setStreams((prev) => without(prev, peerId));
          retuneSenders();
        };
        room.onPeerStream = (stream, peerId) => {
          setStreams((prev) => ({ ...prev, [peerId]: stream }));
        };

        roomRef.current = room;
        helloRef.current = hello;
        qstatRef.current = qstat;
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
      void roomRef.current?.leave();
      roomRef.current = null;
      helloRef.current = null;
      qstatRef.current = null;
    };
  }, [roomId, name, endCapture, retuneSenders, sendScreen, showNotice, stopShare]);

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
    void room.leave();
    roomRef.current = null;
  }, [endCapture, isFull]);

  const participants = ranked.slice(0, MAX_PER_ROOM);

  const presenter =
    participants
      .filter((p) => p.sharingSince !== null)
      .sort((a, b) =>
        sharedLater({ id: a.id, since: a.sharingSince! }, { id: b.id, since: b.sharingSince! }) ? -1 : 1,
      )[0] ?? null;

  const presenterStream = presenter
    ? presenter.isSelf
      ? localStream
      : (streams[presenter.id] ?? null)
    : null;

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
    isSharing: localStream !== null,
    notice,
    presenterQuality,
    startShare,
    stopShare,
    getConnections,
    sendQualityStatus,
    preset,
    changePreset,
  };
}
