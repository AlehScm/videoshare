"use client";

import { ScreenShare } from "lucide-react";
import type { Ref } from "react";
import type { Participant } from "@/hooks/useRoom";
import type { QualityReport } from "@/hooks/useStreamStats";
import { QualityIndicator } from "./QualityIndicator";
import { StageVideo } from "./StageVideo";

type Props = {
  ref?: Ref<HTMLDivElement>;
  connecting: boolean;
  alone: boolean;
  presenter: Participant | null;
  presenterStream: MediaStream | null;
  quality: QualityReport | null;
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-line bg-raised text-muted">
        <ScreenShare className="size-6" aria-hidden />
      </span>
      <p className="font-display text-xl font-semibold">{title}</p>
      <p className="text-sm text-muted">{body}</p>
    </div>
  );
}

export function Stage({ ref, connecting, alone, presenter, presenterStream, quality }: Props) {
  const live = presenter !== null;

  return (
    <div
      ref={ref}
      className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[20px] border transition-[box-shadow,border-color] duration-500 lg:aspect-auto lg:min-h-0 lg:flex-1 ${
        live
          ? "border-tally bg-black shadow-[0_0_0_6px_rgb(255_91_74/0.12),0_0_80px_rgb(255_91_74/0.16)]"
          : "border-line bg-panel"
      }`}
    >
      {presenter && presenterStream ? (
        <StageVideo key={presenterStream.id} stream={presenterStream} isLocal={presenter.isSelf} />
      ) : connecting ? (
        <EmptyState title="Entrando na sala…" body="Procurando quem já está aqui." />
      ) : presenter ? (
        <EmptyState
          title={`Conectando à tela de ${presenter.name}…`}
          body="A imagem aparece em alguns segundos."
        />
      ) : alone ? (
        <EmptyState
          title="Você é o primeiro aqui"
          body="Copie o link da sala e mande pra quem vai assistir. Dá pra começar a compartilhar antes."
        />
      ) : (
        <EmptyState
          title="Ninguém está compartilhando"
          body="Quando alguém compartilhar a tela, ela aparece aqui pra todo mundo."
        />
      )}

      {presenter && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-stage/85 px-3 py-1.5 text-sm font-medium backdrop-blur">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-tally opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-tally" />
          </span>
          {presenter.isSelf ? "Você está apresentando" : `${presenter.name} está apresentando`}
        </div>
      )}

      {presenter && presenterStream && (
        <div className="absolute right-3 top-3">
          <QualityIndicator report={quality} />
        </div>
      )}
    </div>
  );
}
