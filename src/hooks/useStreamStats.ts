"use client";

import { useEffect, useRef, useState } from "react";
import type { Limitation, Participant, PresenterQuality, QualityStatus } from "@/hooks/useRoom";
import { presetBitrate, presetLabel, type QualityPreset } from "@/lib/quality";

const POLL_MS = 1000;
const STATUS_EVERY_TICKS = 2;
const STALE_STATUS_MS = 6000;
const FREEZE_WINDOW_MS = 60_000;
const DROP_RATIO = 0.75;

export type QualityLevel = "boa" | "instavel" | "ruim";

export type ViewerMetrics = {
  height: number;
  width: number;
  fps: number;
  kbps: number;
  lossPct: number;
  rttMs: number | null;
  codec: string | null;
  freezes: number;
};

export type SendRow = {
  id: string;
  name: string;
  height: number;
  fps: number;
  sourceFps: number;
  kbps: number;
  capKbps: number;
  limitation: Limitation;
  lossPct: number;
  rttMs: number | null;
};

export type QualityReport = {
  role: "assistindo" | "apresentando";
  level: QualityLevel;
  summary: string;
  /** Qualidade escolhida por quem apresenta, quando conhecida. */
  chosen: string | null;
  issues: string[];
  viewer?: ViewerMetrics;
  rows?: SendRow[];
};

type Options = {
  getConnections: () => Record<string, RTCPeerConnection>;
  presenter: Participant | null;
  presenterStream: MediaStream | null;
  participants: Participant[];
  presenterQuality: PresenterQuality | null;
  sendQualityStatus: (status: Omit<QualityStatus, "preset">) => void;
  preset: QualityPreset;
};

type Stat = Record<string, unknown> & { id: string; type: string; timestamp: number };
type Counter = { bytes: number; packets: number; lost: number; freezes: number; at: number };

const num = (stat: Stat | undefined, key: string): number => {
  const value = stat?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const LEVEL_RANK: Record<QualityLevel, number> = { boa: 0, instavel: 1, ruim: 2 };
const worse = (a: QualityLevel, b: QualityLevel) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

const pct = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function codecLabel(mimeType: unknown): string | null {
  if (typeof mimeType !== "string") return null;
  const name = mimeType.split("/")[1]?.toUpperCase() ?? "";
  return name === "H264" ? "H.264" : name || null;
}

function selectedPair(stats: Map<string, Stat>): Stat | undefined {
  for (const stat of stats.values()) {
    if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
      return stats.get(stat.selectedCandidatePairId);
    }
  }
  return [...stats.values()].find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");
}

function rttOf(pair: Stat | undefined): number | null {
  const rtt = pair?.currentRoundTripTime;
  return typeof rtt === "number" ? Math.round(rtt * 1000) : null;
}

async function readStats(pc: RTCPeerConnection): Promise<Map<string, Stat>> {
  const report = await pc.getStats();
  const stats = new Map<string, Stat>();
  report.forEach((stat: Stat) => stats.set(stat.id, stat));
  return stats;
}

function limitationText(limitation: Limitation, who: string, chosen: string): string | null {
  if (limitation === "bandwidth") {
    return `A internet de envio de ${who} não está dando conta de ${chosen}; a imagem pode perder quadros ou nitidez.`;
  }
  if (limitation === "cpu") return `O computador de ${who} não está dando conta de codificar ${chosen}.`;
  return null;
}

/**
 * Lê `getStats()` das conexões WebRTC a cada segundo enquanto alguém apresenta e traduz em
 * diagnóstico. Quem apresenta também avisa os outros se está limitado por CPU ou banda.
 */
export function useStreamStats(options: Options): QualityReport | null {
  const latest = useRef(options);
  const counters = useRef(new Map<string, Counter>());
  const freezeTimes = useRef<number[]>([]);
  const [report, setReport] = useState<QualityReport | null>(null);

  useEffect(() => {
    latest.current = options;
  });

  const presenterId = options.presenter?.id ?? null;
  const presenting = options.presenter?.isSelf ?? false;
  const active = presenterId !== null && options.presenterStream !== null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let tick = 0;
    counters.current.clear();
    freezeTimes.current = [];

    function delta(key: string, now: Counter): Counter | null {
      const prev = counters.current.get(key);
      counters.current.set(key, now);
      if (!prev || now.at <= prev.at) return null;
      return {
        bytes: Math.max(0, now.bytes - prev.bytes),
        packets: Math.max(0, now.packets - prev.packets),
        lost: Math.max(0, now.lost - prev.lost),
        freezes: Math.max(0, now.freezes - prev.freezes),
        at: now.at - prev.at,
      };
    }

    async function measureViewer(): Promise<QualityReport | null> {
      const { getConnections, presenter, presenterStream, presenterQuality } = latest.current;
      const pc = presenter ? getConnections()[presenter.id] : undefined;
      if (!presenter || !pc) return null;
      const stats = await readStats(pc);
      const trackId = presenterStream?.getVideoTracks()[0]?.id;
      const inbound = [...stats.values()]
        .filter((s) => s.type === "inbound-rtp" && s.kind === "video")
        .sort((a, b) => Number(b.trackIdentifier === trackId) - Number(a.trackIdentifier === trackId))[0];
      if (!inbound) return null;

      const now = performance.now();
      const d = delta(inbound.id, {
        bytes: num(inbound, "bytesReceived"),
        packets: num(inbound, "packetsReceived"),
        lost: num(inbound, "packetsLost"),
        freezes: num(inbound, "freezeCount"),
        at: inbound.timestamp,
      });
      if (d?.freezes) freezeTimes.current.push(...Array(d.freezes).fill(now));
      freezeTimes.current = freezeTimes.current.filter((t) => now - t < FREEZE_WINDOW_MS);

      const metrics: ViewerMetrics = {
        width: num(inbound, "frameWidth"),
        height: num(inbound, "frameHeight"),
        fps: Math.round(num(inbound, "framesPerSecond")),
        kbps: d ? Math.round((d.bytes * 8) / d.at) : 0,
        lossPct: d && d.packets + d.lost > 0 ? (d.lost / (d.packets + d.lost)) * 100 : 0,
        rttMs: rttOf(selectedPair(stats)),
        codec: codecLabel(stats.get(String(inbound.codecId))?.mimeType),
        freezes: freezeTimes.current.length,
      };

      let level: QualityLevel = "boa";
      const issues: string[] = [];
      const fresh =
        presenterQuality?.peerId === presenter.id && Date.now() - presenterQuality.at < STALE_STATUS_MS;
      const chosen = fresh ? presetLabel(presenterQuality.preset) : null;
      const remote = fresh && chosen ? limitationText(presenterQuality.limitation, presenter.name, chosen) : null;
      if (remote) {
        issues.push(remote);
        level = worse(level, "instavel");
      }
      if (d && metrics.kbps === 0) {
        issues.push("Não está chegando imagem agora. A conexão pode ter caído por um instante.");
        level = "ruim";
      }
      if (metrics.lossPct >= 2) {
        issues.push(`Perda de ${pct(metrics.lossPct)}% dos pacotes: sua conexão está instável (Wi-Fi fraco?).`);
        level = worse(level, metrics.lossPct >= 8 ? "ruim" : "instavel");
      }
      if (metrics.rttMs !== null && metrics.rttMs >= 250) {
        issues.push(`Ping alto (${metrics.rttMs} ms) entre você e ${presenter.name}.`);
        level = worse(level, metrics.rttMs >= 500 ? "ruim" : "instavel");
      }
      if (metrics.fps > 0 && metrics.fps < 20) {
        issues.push(`Poucos quadros por segundo (${metrics.fps} fps).`);
        level = worse(level, metrics.fps < 10 ? "ruim" : "instavel");
      }
      if (metrics.freezes > 0) {
        issues.push(
          `A imagem travou ${metrics.freezes} ${metrics.freezes === 1 ? "vez" : "vezes"} no último minuto.`,
        );
        level = worse(level, metrics.freezes >= 3 ? "ruim" : "instavel");
      }

      const summary = metrics.height ? `${metrics.height}p · ${metrics.fps} fps` : "Medindo…";
      return { role: "assistindo", level, summary, chosen, issues, viewer: metrics };
    }

    async function measurePresenter(): Promise<QualityReport | null> {
      const { getConnections, participants, presenterStream, sendQualityStatus } = latest.current;
      const trackId = presenterStream?.getVideoTracks()[0]?.id;
      const connections = Object.entries(getConnections());
      const { preset } = latest.current;
      const chosen = presetLabel(preset);
      const capKbps = Math.round(presetBitrate(preset) / 1000);
      const names = new Map(participants.map((p) => [p.id, p.name]));

      const rows = (
        await Promise.all(
          connections.map(async ([peerId, pc]): Promise<SendRow | null> => {
            const stats = await readStats(pc).catch(() => null);
            if (!stats) return null;
            const outbound = [...stats.values()].find((s) => {
              if (s.type !== "outbound-rtp" || s.kind !== "video") return false;
              const source = stats.get(String(s.mediaSourceId));
              return !trackId || !source || source.trackIdentifier === trackId;
            });
            if (!outbound) return null;
            const sourceFps = num(stats.get(String(outbound.mediaSourceId)), "framesPerSecond");
            const remoteIn = [...stats.values()].find(
              (s) => s.type === "remote-inbound-rtp" && s.localId === outbound.id,
            );
            const d = delta(`${peerId}:${outbound.id}`, {
              bytes: num(outbound, "bytesSent"),
              packets: num(outbound, "packetsSent"),
              lost: 0,
              freezes: 0,
              at: outbound.timestamp,
            });
            const reason = outbound.qualityLimitationReason;
            const remoteRtt = num(remoteIn, "roundTripTime");
            const fps = Math.round(num(outbound, "framesPerSecond"));
            // Com a resolução travada, falta de banda aparece como quadros descartados no envio,
            // que o navegador não marca como limitação. Tela parada gera poucos quadros na captura
            // também, então compara com o que foi capturado e não com o fps escolhido.
            const droppingFrames = sourceFps >= 10 && fps > 0 && fps < sourceFps * DROP_RATIO;
            return {
              id: peerId,
              name: names.get(peerId) ?? "Alguém",
              height: num(outbound, "frameHeight"),
              fps,
              sourceFps: Math.round(sourceFps),
              kbps: d ? Math.round((d.bytes * 8) / d.at) : 0,
              capKbps,
              limitation:
                reason === "cpu" || reason === "bandwidth" || reason === "other"
                  ? reason
                  : droppingFrames
                    ? "bandwidth"
                    : "none",
              lossPct: num(remoteIn, "fractionLost") * 100,
              rttMs: remoteRtt > 0 ? Math.round(remoteRtt * 1000) : rttOf(selectedPair(stats)),
            };
          }),
        )
      ).filter((row): row is SendRow => row !== null);

      const limitation: Limitation = rows.some((r) => r.limitation === "cpu")
        ? "cpu"
        : rows.some((r) => r.limitation === "bandwidth")
          ? "bandwidth"
          : "none";
      if (tick % STATUS_EVERY_TICKS === 0) sendQualityStatus({ limitation, viewers: rows.length });

      let level: QualityLevel = "boa";
      const issues: string[] = [];
      if (limitation === "bandwidth") {
        issues.push(
          `Sua internet de envio não está dando conta de ${chosen} pra ${rows.length} ${rows.length === 1 ? "pessoa" : "pessoas"}. Escolha uma qualidade menor.`,
        );
        level = "instavel";
      }
      if (limitation === "cpu") {
        issues.push(
          `Seu computador não está dando conta de codificar ${chosen} pra ${rows.length} ${rows.length === 1 ? "pessoa" : "pessoas"}. Escolha uma qualidade menor ou feche programas pesados.`,
        );
        level = "instavel";
      }
      for (const row of rows) {
        if (row.lossPct >= 5) {
          issues.push(`A conexão de ${row.name} está instável (${pct(row.lossPct)}% de perda).`);
          level = worse(level, row.lossPct >= 15 ? "ruim" : "instavel");
        }
        if (row.rttMs !== null && row.rttMs >= 400) {
          issues.push(`Ping alto com ${row.name} (${row.rttMs} ms).`);
          level = worse(level, "instavel");
        }
      }

      const best = rows.reduce<SendRow | null>((acc, r) => (!acc || r.height > acc.height ? r : acc), null);
      const summary = best?.height
        ? `${best.height}p · ${best.fps} fps`
        : rows.length === 0
          ? "Ninguém assistindo"
          : "Medindo…";
      return { role: "apresentando", level, summary, chosen, issues, rows };
    }

    async function poll() {
      tick += 1;
      const next = await (latest.current.presenter?.isSelf ? measurePresenter() : measureViewer()).catch(
        () => null,
      );
      if (!cancelled) setReport(next);
    }

    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, presenterId, presenting]);

  return active ? report : null;
}
