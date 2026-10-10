"use client";

import { Download } from "lucide-react";
import { DESKTOP_DOWNLOAD_URL, useIsDesktop } from "@/lib/desktop";

/** Some dentro do próprio app. */
export function DesktopDownloadLink() {
  const isDesktop = useIsDesktop();
  if (isDesktop) return null;
  return (
    <a
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 self-start text-sm text-muted underline-offset-4 transition hover:text-fg hover:underline"
    >
      <Download className="size-4" aria-hidden />
      Baixar o app pra Windows (som só do jogo, seletor de janelas)
    </a>
  );
}
