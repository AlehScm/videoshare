"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NameForm } from "@/components/NameForm";
import { RoomView } from "@/components/RoomView";
import { saveName, useSavedName } from "@/lib/name-storage";
import { normalizeRoomId } from "@/lib/room-id";
import { cardClass, secondaryButtonClass } from "@/lib/styles";

export function RoomSkeleton() {
  return (
    <div className={`${cardClass} flex flex-col gap-4`} aria-busy="true">
      <div className="h-6 w-1/2 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-12 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
      <div className="h-12 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
    </div>
  );
}

export function RoomGate() {
  const roomId = normalizeRoomId(useSearchParams().get("id"));
  const savedName = useSavedName();

  if (!roomId) {
    return (
      <div className={`${cardClass} flex flex-col gap-4`}>
        <h1 className="text-xl font-semibold">Link de sala inválido</h1>
        <p className="text-zinc-500">Confira o link que você recebeu ou crie uma sala nova.</p>
        <Link href="/" className={secondaryButtonClass}>
          Voltar ao início
        </Link>
      </div>
    );
  }

  if (savedName === null) return <RoomSkeleton />;

  if (!savedName) {
    return (
      <div className={`${cardClass} flex flex-col gap-6`}>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-zinc-500">Você foi convidado para a sala</p>
          <h1 className="font-mono text-2xl font-semibold">{roomId}</h1>
        </div>
        <NameForm submitLabel="Entrar na sala" onSubmit={saveName} />
      </div>
    );
  }

  return <RoomView key={`${roomId}:${savedName}`} roomId={roomId} name={savedName} />;
}
