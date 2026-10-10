"use client";

import { AppWindow, Monitor, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktop, type DesktopSelection, type DesktopSource } from "@/lib/desktop";
import { primaryButtonClass, secondaryButtonClass } from "@/lib/styles";

type Props = {
  open: boolean;
  onConfirm: (selection: DesktopSelection) => void;
  onCancel: () => void;
};

type Kind = DesktopSource["kind"];

const TABS: { kind: Kind; label: string; Icon: typeof Monitor }[] = [
  { kind: "window", label: "Janelas", Icon: AppWindow },
  { kind: "screen", label: "Telas", Icon: Monitor },
];

/** Seletor de janela/tela do app de desktop, com a opção de mandar o som só daquele programa. */
export function SourcePicker({ open, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [sources, setSources] = useState<DesktopSource[] | null>(null);
  const [kind, setKind] = useState<Kind>("window");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(true);

  const refresh = useCallback(() => {
    setSources(null);
    getDesktop()
      ?.listSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      refresh();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, refresh]);

  const visible = sources?.filter((source) => source.kind === kind) ?? [];
  const selected = sources?.find((source) => source.id === selectedId) ?? null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="source-picker-title"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[min(52rem,calc(100vw-2rem))] rounded-3xl border border-line bg-panel p-0 text-fg shadow-2xl backdrop:bg-stage/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="source-picker-title" className="font-display text-xl font-semibold">
            O que você quer compartilhar?
          </h2>
          <button
            type="button"
            onClick={refresh}
            aria-label="Atualizar lista"
            title="Atualizar lista"
            className="flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>

        <div role="tablist" className="flex gap-2">
          {TABS.map(({ kind: tabKind, label, Icon }) => (
            <button
              key={tabKind}
              type="button"
              role="tab"
              aria-selected={kind === tabKind}
              onClick={() => setKind(tabKind)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30 ${
                kind === tabKind ? "bg-raised text-fg" : "text-muted hover:text-fg"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-48 overflow-y-auto">
          {!sources ? (
            <p className="py-12 text-center text-muted">Procurando janelas…</p>
          ) : visible.length === 0 ? (
            <p className="py-12 text-center text-muted">
              {kind === "window" ? "Nenhuma janela aberta pra compartilhar." : "Nenhuma tela encontrada."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((source) => {
                const active = source.id === selectedId;
                return (
                  <li key={source.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(source.id)}
                      onDoubleClick={() => onConfirm({ sourceId: source.id, withAudio })}
                      aria-pressed={active}
                      className={`flex w-full flex-col gap-2 rounded-2xl p-2 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30 ${
                        active ? "bg-raised ring-2 ring-signal" : "hover:bg-raised/60"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura em data URL vinda do app */}
                      <img
                        src={source.thumbnail}
                        alt=""
                        className="aspect-video w-full rounded-xl bg-stage object-contain"
                      />
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        {source.appIcon && (
                          // eslint-disable-next-line @next/next/no-img-element -- ícone em data URL vindo do app
                          <img src={source.appIcon} alt="" className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{source.name}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={withAudio}
              onChange={(event) => setWithAudio(event.target.checked)}
              className="size-4 accent-signal"
            />
            {selected?.kind === "screen" || (!selected && kind === "screen")
              ? "Compartilhar o som do computador"
              : "Compartilhar o som só deste programa"}
          </label>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && onConfirm({ sourceId: selected.id, withAudio })}
              className={primaryButtonClass}
            >
              Compartilhar
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
