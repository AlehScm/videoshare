"use client";

import Link from "next/link";
import { useState } from "react";
import { MAX_PER_ROOM, useRoomPresence, type Participant } from "@/hooks/useRoomPresence";
import { saveName } from "@/lib/name-storage";
import { roomHref } from "@/lib/room-id";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/styles";

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function ParticipantRow({ participant }: { participant: Participant }) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full font-semibold text-white ${avatarColor(participant.id)}`}
        aria-hidden
      >
        {participant.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {participant.name}
        {participant.isSelf && <span className="ml-2 text-sm font-normal text-zinc-500">(você)</span>}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="size-2 rounded-full bg-emerald-500" />
        online
      </span>
    </li>
  );
}

function ShareLink({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${roomHref(roomId)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        readOnly
        value={link}
        aria-label="Link da sala"
        onFocus={(event) => event.target.select()}
        className={`${inputClass} font-mono text-sm`}
      />
      <button type="button" onClick={copy} className={`${primaryButtonClass} shrink-0`}>
        {copied ? "Link copiado!" : "Copiar link"}
      </button>
    </div>
  );
}

export function RoomView({ roomId, name }: { roomId: string; name: string }) {
  const { status, participants } = useRoomPresence(roomId, name);

  if (status === "cheia") {
    return (
      <div className={`${cardClass} flex flex-col gap-4`}>
        <h1 className="text-xl font-semibold">Esta sala está cheia</h1>
        <p className="text-zinc-500">
          A sala <span className="font-mono">{roomId}</span> já tem {MAX_PER_ROOM} pessoas.
        </p>
        <Link href="/" className={primaryButtonClass}>
          Criar outra sala
        </Link>
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className={`${cardClass} flex flex-col gap-4`}>
        <h1 className="text-xl font-semibold">Não foi possível conectar</h1>
        <p className="text-zinc-500">Verifique sua internet e tente de novo.</p>
        <button type="button" onClick={() => window.location.reload()} className={primaryButtonClass}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const alone = participants.length <= 1;

  return (
    <div className={`${cardClass} flex flex-col gap-6`}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-zinc-500">Sala</p>
          <h1 className="font-mono text-2xl font-semibold">{roomId}</h1>
        </div>
        <Link href="/" className={`${secondaryButtonClass} px-4 py-2 text-sm`}>
          Sair
        </Link>
      </header>

      <ShareLink roomId={roomId} />

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center justify-between text-sm font-medium text-zinc-500">
          <span>Na sala</span>
          <span className="tabular-nums">
            {participants.length}/{MAX_PER_ROOM}
          </span>
        </h2>

        {status === "entrando" ? (
          <p className="rounded-xl bg-black/[0.03] px-4 py-6 text-center text-zinc-500 dark:bg-white/[0.04]">
            Conectando à sala…
          </p>
        ) : (
          <ul className="-mx-3 flex flex-col">
            {participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} />
            ))}
          </ul>
        )}

        {status === "na-sala" && alone && (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="size-2 animate-pulse rounded-full bg-amber-400" />
            Aguardando alguém entrar… mande o link acima.
          </p>
        )}
      </section>

      <button
        type="button"
        onClick={() => saveName("")}
        className="self-start text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        Trocar meu nome
      </button>
    </div>
  );
}
