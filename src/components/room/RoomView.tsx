"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { CenteredShell } from "@/components/CenteredShell";
import { MAX_PER_ROOM, useRoom } from "@/hooks/useRoom";
import { useStreamStats } from "@/hooks/useStreamStats";
import { canShareScreen } from "@/lib/media";
import { cardClass, primaryButtonClass } from "@/lib/styles";
import { ControlBar } from "./ControlBar";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { Stage } from "./Stage";
import { TopBar } from "./TopBar";

export function RoomView({ roomId, name }: { roomId: string; name: string }) {
  const room = useRoom(roomId, name);
  const stageRef = useRef<HTMLDivElement>(null);
  const quality = useStreamStats({
    getConnections: room.getConnections,
    presenter: room.presenter,
    presenterStream: room.presenterStream,
    participants: room.participants,
    presenterQuality: room.presenterQuality,
    sendQualityStatus: room.sendQualityStatus,
    preset: room.preset,
    relay: room.relay,
    receivingViaRelay: room.receivingViaRelay,
    relaying: room.relaying,
    relayUnavailable: room.relayUnavailable,
  });

  if (room.status === "cheia") {
    return (
      <CenteredShell>
        <div className={`${cardClass} flex flex-col gap-4`}>
          <h1 className="font-display text-2xl font-semibold">Esta sala está cheia</h1>
          <p className="text-muted">
            A sala {roomId} já tem {MAX_PER_ROOM} pessoas. Crie uma sala nova e mande o link pra quem
            você quer chamar.
          </p>
          <Link href="/" className={primaryButtonClass}>
            Criar outra sala
          </Link>
        </div>
      </CenteredShell>
    );
  }

  if (room.status === "erro") {
    return (
      <CenteredShell>
        <div className={`${cardClass} flex flex-col gap-4`}>
          <h1 className="font-display text-2xl font-semibold">Não foi possível conectar</h1>
          <p className="text-muted">Verifique sua internet e tente de novo.</p>
          <button type="button" onClick={() => window.location.reload()} className={primaryButtonClass}>
            Tentar de novo
          </button>
        </div>
      </CenteredShell>
    );
  }

  const connecting = room.status === "entrando";

  return (
    <div className="flex flex-1 flex-col lg:h-dvh lg:flex-none lg:overflow-hidden">
      <TopBar roomId={roomId} />

      <main className="grid flex-1 content-start gap-4 px-4 pb-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)]">
        <section className="flex flex-col gap-4 lg:min-h-0">
          <Stage
            ref={stageRef}
            connecting={connecting}
            alone={room.participants.length <= 1}
            presenter={room.presenter}
            presenterStream={room.presenterStream}
            quality={quality}
          />
          <ControlBar
            canShare={canShareScreen()}
            isSharing={room.isSharing}
            presenter={room.presenter}
            hasStream={room.presenterStream !== null}
            disabled={connecting}
            preset={room.preset}
            onPresetChange={room.changePreset}
            onStart={(selection) => void room.startShare(selection)}
            onStop={room.stopShare}
            onFullscreen={() => void stageRef.current?.requestFullscreen().catch(() => {})}
          />
        </section>

        <ParticipantsPanel
          participants={room.participants}
          presenterId={room.presenter?.id ?? null}
          relayId={room.relay?.id ?? null}
        />
      </main>

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-16 flex justify-center px-4"
      >
        {room.notice && (
          <p className="flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-sm shadow-lg">
            <Info className="size-4 shrink-0 text-signal" aria-hidden />
            {room.notice}
          </p>
        )}
      </div>
    </div>
  );
}
