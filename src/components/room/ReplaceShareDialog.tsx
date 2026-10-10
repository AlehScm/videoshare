"use client";

import { ScreenShare } from "lucide-react";
import { useEffect, useRef } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/lib/styles";

type Props = {
  open: boolean;
  presenterName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ReplaceShareDialog({ open, presenterName, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="replace-share-title"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl border border-line bg-panel p-0 text-fg shadow-2xl backdrop:bg-stage/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-tally/15 text-tally">
          <ScreenShare className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h2 id="replace-share-title" className="font-display text-xl font-semibold">
            Substituir a tela de {presenterName}?
          </h2>
          <p className="text-muted">
            {presenterName} está compartilhando agora. Se você compartilhar, a tela de {presenterName} sai do
            ar e a sua aparece pra todo mundo da sala.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} autoFocus className={primaryButtonClass}>
            Compartilhar minha tela
          </button>
        </div>
      </div>
    </dialog>
  );
}
