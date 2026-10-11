"use client";

import { Signal, SignalLow, SignalMedium, SignalZero } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { QualityLevel, QualityReport, SendRow, ViewerMetrics } from "@/hooks/useStreamStats";

const LEVELS: Record<QualityLevel, { label: string; color: string; Icon: typeof Signal }> = {
  boa: { label: "Boa", color: "text-online", Icon: Signal },
  instavel: { label: "Instável", color: "text-amber-300", Icon: SignalMedium },
  ruim: { label: "Ruim", color: "text-tally", Icon: SignalLow },
};

const mbps = (kbps: number) => (kbps / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const pct = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-stage/60 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ViewerDetails({ metrics }: { metrics: ViewerMetrics }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      <Metric label="Resolução" value={metrics.height ? `${metrics.width}×${metrics.height}` : "—"} />
      <Metric label="Quadros por segundo" value={`${metrics.fps} fps`} />
      <Metric label="Recebendo" value={`${mbps(metrics.kbps)} Mbps`} />
      <Metric label="Perda de pacotes" value={`${pct(metrics.lossPct)}%`} />
      <Metric label="Ping" value={metrics.rttMs !== null ? `${metrics.rttMs} ms` : "—"} />
      <Metric label="Travadas (1 min)" value={String(metrics.freezes)} />
      <Metric label="Codec" value={metrics.codec ?? "—"} />
    </dl>
  );
}

function SenderDetails({ rows }: { rows: SendRow[] }) {
  if (rows.length === 0) return <p className="text-muted">Ninguém está assistindo ainda.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 rounded-xl bg-stage/60 px-3 py-2">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">
              {row.name}
              {row.note && <span className="font-normal text-muted"> · {row.note}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {row.rttMs !== null ? `${row.rttMs} ms` : ""}
            </span>
          </span>
          <span className="text-xs tabular-nums text-muted">
            {row.height
              ? `${row.height}p · ${row.fps}${row.sourceFps > row.fps + 2 ? ` de ${row.sourceFps}` : ""} fps`
              : "Conectando…"}{" "}
            · {mbps(row.kbps)} de até{" "}
            {mbps(row.capKbps)} Mbps
            {row.lossPct >= 1 ? ` · ${pct(row.lossPct)}% de perda` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function QualityIndicator({ report }: { report: QualityReport | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const level = report ? LEVELS[report.level] : null;
  const Icon = level?.Icon ?? SignalZero;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Qualidade da transmissão: ${level?.label ?? "medindo"}`}
        className="flex items-center gap-2 rounded-full bg-stage/85 px-3 py-1.5 text-sm font-medium backdrop-blur transition hover:bg-stage focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30"
      >
        <Icon className={`size-4 ${level?.color ?? "text-muted"}`} aria-hidden />
        <span className="tabular-nums">{report?.summary ?? "Medindo…"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 flex max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-panel/95 p-4 text-sm shadow-2xl backdrop-blur">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-base font-semibold">Qualidade da transmissão</h3>
            {level && <span className={`font-semibold ${level.color}`}>{level.label}</span>}
          </div>

          {!report ? (
            <p className="text-muted">Medindo a conexão…</p>
          ) : (
            <>
              {report.chosen && (
                <p className="text-muted">
                  Qualidade escolhida {report.role === "apresentando" ? "por você" : "por quem apresenta"}:{" "}
                  <span className="font-medium text-fg">{report.chosen}</span>
                </p>
              )}
              <p className="text-muted">
                Caminho: <span className="font-medium text-fg">{report.path}</span>
              </p>
              {report.issues.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {report.issues.map((issue) => (
                    <li key={issue} className="rounded-xl border border-line px-3 py-2">
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Tudo certo com a transmissão.</p>
              )}

              {report.viewer && <ViewerDetails metrics={report.viewer} />}
              {report.rows && (
                <>
                  <p className="text-muted">
                    Enviando pra {report.rows.length} {report.rows.length === 1 ? "pessoa" : "pessoas"}
                  </p>
                  <SenderDetails rows={report.rows} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
