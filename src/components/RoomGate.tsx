"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CenteredShell } from "@/components/CenteredShell";
import { NameForm } from "@/components/NameForm";
import { RoomView } from "@/components/room/RoomView";
import { saveName, useSavedName } from "@/lib/name-storage";
import { normalizeRoomId } from "@/lib/room-id";
import { cardClass, secondaryButtonClass } from "@/lib/styles";

export function RoomSkeleton() {
  return (
    <CenteredShell>
      <div className={`${cardClass} flex flex-col gap-4`} aria-busy="true">
        <div className="h-6 w-1/2 animate-pulse rounded bg-raised" />
        <div className="h-12 animate-pulse rounded-xl bg-raised/60" />
        <div className="h-12 animate-pulse rounded-xl bg-raised/60" />
      </div>
    </CenteredShell>
  );
}

export function RoomGate() {
  const roomId = normalizeRoomId(useSearchParams().get("id"));
  const savedName = useSavedName();

  if (!roomId) {
    return (
      <CenteredShell>
        <div className={`${cardClass} flex flex-col gap-4`}>
          <h1 className="font-display text-2xl font-semibold">Link de sala inválido</h1>
          <p className="text-muted">Confira o link que você recebeu ou crie uma sala nova.</p>
          <Link href="/" className={secondaryButtonClass}>
            Voltar ao início
          </Link>
        </div>
      </CenteredShell>
    );
  }

  if (savedName === null) return <RoomSkeleton />;

  if (!savedName) {
    return (
      <CenteredShell>
        <div className={`${cardClass} flex flex-col gap-6`}>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted">Você foi convidado para a sala</p>
            <h1 className="font-display text-3xl font-semibold tracking-wide">{roomId}</h1>
          </div>
          <NameForm submitLabel="Entrar na sala" onSubmit={saveName} />
        </div>
      </CenteredShell>
    );
  }

  return <RoomView key={`${roomId}:${savedName}`} roomId={roomId} name={savedName} />;
}
