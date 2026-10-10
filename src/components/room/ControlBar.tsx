"use client";

import { Maximize, ScreenShare, ScreenShareOff } from "lucide-react";
import type { Participant } from "@/hooks/useRoom";
import { dangerButtonClass, primaryButtonClass } from "@/lib/styles";

type Props = {
  canShare: boolean;
  isSharing: boolean;
  presenter: Participant | null;
  hasStream: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onFullscreen: () => void;
};

export function ControlBar({
  canShare,
  isSharing,
  presenter,
  hasStream,
  disabled,
  onStart,
  onStop,
  onFullscreen,
}: Props) {
  const blockedBy = presenter && !presenter.isSelf ? presenter.name : null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {!canShare ? (
        <p className="text-center text-sm text-muted">
          Pelo celular dá pra assistir. Pra compartilhar a tela, use um computador.
        </p>
      ) : isSharing ? (
        <button type="button" onClick={onStop} className={`${dangerButtonClass} rounded-full`}>
          <ScreenShareOff className="size-5" aria-hidden />
          Parar de compartilhar
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={disabled || blockedBy !== null}
          title={blockedBy ? `${blockedBy} está apresentando. Espere terminar pra compartilhar.` : undefined}
          className={`${primaryButtonClass} rounded-full`}
        >
          <ScreenShare className="size-5" aria-hidden />
          Compartilhar tela
        </button>
      )}

      <button
        type="button"
        onClick={onFullscreen}
        disabled={!hasStream}
        aria-label="Ver em tela cheia"
        title="Tela cheia"
        className="inline-flex size-12 items-center justify-center rounded-full border border-line text-fg transition hover:bg-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/25 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Maximize className="size-5" aria-hidden />
      </button>
    </div>
  );
}
