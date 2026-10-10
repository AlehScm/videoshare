"use client";

import { ChevronDown, Maximize, ScreenShare, ScreenShareOff, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Participant } from "@/hooks/useRoom";
import { useIsDesktop, type DesktopSelection } from "@/lib/desktop";
import {
  DEFAULT_PRESET,
  FRAME_RATES,
  parsePreset,
  presetKey,
  presetLabel,
  RESOLUTIONS,
  type QualityPreset,
} from "@/lib/quality";
import { dangerButtonClass, primaryButtonClass } from "@/lib/styles";
import { ReplaceShareDialog } from "./ReplaceShareDialog";
import { SourcePicker } from "./SourcePicker";

const PRESETS: QualityPreset[] = RESOLUTIONS.flatMap((height) => FRAME_RATES.map((fps) => ({ height, fps })));

type Props = {
  canShare: boolean;
  isSharing: boolean;
  presenter: Participant | null;
  hasStream: boolean;
  disabled: boolean;
  preset: QualityPreset;
  onPresetChange: (preset: QualityPreset) => void;
  onStart: (selection?: DesktopSelection) => void;
  onStop: () => void;
  onFullscreen: () => void;
};

function QualitySelect({ preset, onChange }: { preset: QualityPreset; onChange: (p: QualityPreset) => void }) {
  return (
    <label
      title="Qualidade que você envia quando compartilha a tela"
      className="relative inline-flex h-12 items-center gap-2 rounded-full border border-line pl-4 pr-9 text-sm font-medium transition focus-within:ring-4 focus-within:ring-signal/25 hover:bg-raised"
    >
      <SlidersHorizontal className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="sr-only">Qualidade da sua tela</span>
      <select
        value={presetKey(preset)}
        onChange={(event) => {
          const next = parsePreset(event.target.value);
          if (next) onChange(next);
        }}
        className="cursor-pointer appearance-none bg-transparent tabular-nums outline-none"
      >
        {PRESETS.map((option) => (
          <option key={presetKey(option)} value={presetKey(option)} className="bg-panel text-fg">
            {presetLabel(option)}
            {presetKey(option) === presetKey(DEFAULT_PRESET) ? " (padrão)" : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted" aria-hidden />
    </label>
  );
}

export function ControlBar({
  canShare,
  isSharing,
  presenter,
  hasStream,
  disabled,
  preset,
  onPresetChange,
  onStart,
  onStop,
  onFullscreen,
}: Props) {
  const [confirm, setConfirm] = useState({ open: false, presenterName: "" });
  const [picking, setPicking] = useState(false);
  const isDesktop = useIsDesktop();

  // No app de desktop a fonte vem do seletor do videoshare; no navegador, do seletor do navegador.
  function beginShare() {
    if (isDesktop) setPicking(true);
    else onStart();
  }

  function handleShare() {
    if (presenter && !presenter.isSelf) setConfirm({ open: true, presenterName: presenter.name });
    else beginShare();
  }

  function closeConfirm() {
    setConfirm((prev) => ({ ...prev, open: false }));
  }

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
          onClick={handleShare}
          disabled={disabled}
          className={`${primaryButtonClass} rounded-full`}
        >
          <ScreenShare className="size-5" aria-hidden />
          Compartilhar tela
        </button>
      )}

      {canShare && <QualitySelect preset={preset} onChange={onPresetChange} />}

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

      <ReplaceShareDialog
        open={confirm.open}
        presenterName={confirm.presenterName}
        onCancel={closeConfirm}
        onConfirm={() => {
          closeConfirm();
          beginShare();
        }}
      />

      {isDesktop && (
        <SourcePicker
          open={picking}
          onCancel={() => setPicking(false)}
          onConfirm={(selection) => {
            setPicking(false);
            onStart(selection);
          }}
        />
      )}
    </div>
  );
}
