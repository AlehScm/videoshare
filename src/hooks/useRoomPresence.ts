"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "trystero";
import { MAX_NAME_LENGTH } from "@/lib/name-storage";

export const MAX_PER_ROOM = 6;
const APP_ID = "videoshare-acm-presenca";

type Hello = { name: string; joinedAt: number };

export type Participant = {
  id: string;
  name: string;
  joinedAt: number;
  isSelf: boolean;
};

export type PresenceStatus = "entrando" | "na-sala" | "cheia" | "erro";

function parseHello(data: unknown): Hello | null {
  if (typeof data !== "object" || data === null) return null;
  const { name, joinedAt } = data as Record<string, unknown>;
  if (typeof name !== "string" || typeof joinedAt !== "number") return null;
  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  return clean ? { name: clean, joinedAt } : null;
}

function byArrival(a: Participant, b: Participant): number {
  return a.joinedAt - b.joinedAt || a.id.localeCompare(b.id);
}

/**
 * Presença P2P via Trystero (descoberta por relays Nostr públicos, dados via WebRTC).
 * Ordem de chegada (joinedAt + id) decide quem fica quando a sala passa de MAX_PER_ROOM:
 * quem está além do limite sai sozinho e os demais nem chegam a exibi-lo.
 */
export function useRoomPresence(roomId: string, name: string) {
  const roomRef = useRef<Room | null>(null);
  const [self, setSelf] = useState<Participant | null>(null);
  const [peers, setPeers] = useState<Record<string, Hello>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const me: Hello = { name, joinedAt: Date.now() };

    import("trystero")
      .then(({ joinRoom, selfId }) => {
        if (cancelled) return;
        const room = joinRoom({ appId: APP_ID }, roomId, {
          onJoinError: () => setFailed(true),
        });
        const hello = room.makeAction<Hello>("hello");

        hello.onMessage = (data, { peerId }) => {
          const parsed = parseHello(data);
          if (parsed) setPeers((prev) => ({ ...prev, [peerId]: parsed }));
        };
        room.onPeerJoin = (peerId) => {
          void hello.send(me, { target: peerId });
        };
        room.onPeerLeave = (peerId) => {
          setPeers((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
        };

        roomRef.current = room;
        setPeers({});
        setFailed(false);
        setSelf({ id: selfId, ...me, isSelf: true });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      void roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [roomId, name]);

  const ranked = useMemo(() => {
    const others = Object.entries(peers).map(
      ([id, hello]): Participant => ({ id, ...hello, isSelf: false }),
    );
    return (self ? [...others, self] : others).sort(byArrival);
  }, [peers, self]);

  const isFull = self !== null && ranked.indexOf(self) >= MAX_PER_ROOM;

  useEffect(() => {
    const room = roomRef.current;
    if (!isFull || !room) return;
    room.onPeerJoin = null;
    room.onPeerLeave = null;
    void room.leave();
    roomRef.current = null;
  }, [isFull]);

  const status: PresenceStatus = failed
    ? "erro"
    : isFull
      ? "cheia"
      : self
        ? "na-sala"
        : "entrando";

  return {
    status,
    participants: ranked.slice(0, MAX_PER_ROOM),
  };
}
