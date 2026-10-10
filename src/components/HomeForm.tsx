"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cleanName, MAX_NAME_LENGTH, saveName, useSavedName } from "@/lib/name-storage";
import { createRoomId, parseRoomInput, roomHref } from "@/lib/room-id";
import { cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/lib/styles";

export function HomeForm() {
  const router = useRouter();
  const savedName = useSavedName();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState("");

  const nameValue = draftName ?? savedName ?? "";
  const name = cleanName(nameValue);
  const roomToJoin = parseRoomInput(roomInput);

  function goTo(roomId: string) {
    saveName(name);
    router.push(roomHref(roomId));
  }

  return (
    <div className={`${cardClass} flex flex-col gap-6`}>
      <div className="flex flex-col gap-2">
        <label htmlFor="nome" className="text-sm font-medium">
          Seu nome
        </label>
        <input
          id="nome"
          autoComplete="nickname"
          maxLength={MAX_NAME_LENGTH}
          placeholder="Como quer aparecer na sala?"
          value={nameValue}
          onChange={(event) => setDraftName(event.target.value)}
          className={inputClass}
        />
      </div>

      <button
        type="button"
        disabled={!name}
        onClick={() => goTo(createRoomId())}
        className={primaryButtonClass}
      >
        Criar sala nova
      </button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-zinc-500">
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        ou entre numa sala
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      </div>

      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (name && roomToJoin) goTo(roomToJoin);
        }}
      >
        <label htmlFor="sala" className="sr-only">
          Código ou link da sala
        </label>
        <input
          id="sala"
          placeholder="Código ou link da sala"
          value={roomInput}
          onChange={(event) => setRoomInput(event.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={!name || !roomToJoin}
          className={`${secondaryButtonClass} shrink-0`}
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
