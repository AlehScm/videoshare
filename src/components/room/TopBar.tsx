"use client";

import { Check, Link as LinkIcon, LogOut } from "lucide-react";
import Link from "next/link";
import { useCopy } from "@/hooks/useCopy";
import { roomShareUrl } from "@/lib/room-id";

const pillButton =
  "inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-sm font-medium transition hover:bg-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/25";

export function TopBar({ roomId }: { roomId: string }) {
  const { copied, copy } = useCopy();

  return (
    <header className="flex items-center gap-3 px-4 py-3">
      <Link href="/" className="font-display text-lg font-semibold tracking-tight">
        videoshare
      </Link>

      <div className="ml-auto flex items-center gap-2 sm:ml-4">
        <span className="hidden text-sm text-muted sm:inline">Sala</span>
        <span className="font-display text-base font-semibold tracking-wide">{roomId}</span>
        <button type="button" onClick={() => copy(roomShareUrl(roomId))} className={pillButton}>
          {copied ? (
            <Check className="size-4 text-online" aria-hidden />
          ) : (
            <LinkIcon className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">{copied ? "Link copiado" : "Copiar link"}</span>
          <span className="sr-only sm:hidden">{copied ? "Link copiado" : "Copiar link"}</span>
        </button>
      </div>

      <Link href="/" className={`${pillButton} sm:ml-auto`}>
        <LogOut className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sair</span>
        <span className="sr-only sm:hidden">Sair da sala</span>
      </Link>
    </header>
  );
}
