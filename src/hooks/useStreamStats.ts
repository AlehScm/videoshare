"use client";

import { useEffect, useRef, useState } from "react";
import type { Limitation, Participant, PresenterQuality, QualityStatus } from "@/hooks/useRoom";
import { presetBitrate, presetLabel, type QualityPreset } from "@/lib/quality";

const POLL_MS = 1000;
const STATUS_EVERY_TICKS = 2;
const STALE_STATUS_MS = 6000;
const FREEZE_WINDOW_MS = 60_000;
const LOSS_WINDOW = 5;
/** Medições seguidas pra um problema aparecer / sumir (evita o ícone piscar). */
const SHOW_AFTER = 3;
const HIDE_AFTER = 3;
const NO_IMAGE_SECONDS = 4;
/** Abaixo disso a tela está praticamente parada e poucos fps não são problema. */
const MOVING_SOURCE_FPS = 10;
const DROP_RATIO = 0.75;
const VIEWER_FPS_RATIO = 0.6;

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
  note?: string;
};

export type QualityReport = {
  role: "assistindo" | "apresentando";
  level: QualityLevel;
  summary: string;
  /** Qualidade escolhida por quem apresenta, quando conhecida. */
  chosen: string | null;
  /** Por onde a imagem está indo: direto ou via repetidor. */
  path: string;
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
  relay: Participant | null;
  receivingViaRelay: boolean;
  /** Pra quantas pessoas eu estou repassando (0 se não sou o repetidor). */
  relaying: number;
  relayUnavailable: boolean;
};

type Stat = Record<string, unknown> & { id: string; type: string; timestamp: number };
type Counter = { bytes: number; packets: number; lost: number; freezes: number; at: number };
type Candidate = { key: string; text: string; level: QualityLevel };
type Tracked = { on: number; off: number; shown: boolean; last: Candidate };

const num = (stat: Stat | undefined, key: string): number => {
  const value = stat?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const LEVEL_RANK: Record<QualityLevel, number> = { boa: 0, instavel: 1, ruim: 2 };
const worse = (a: QualityLevel, b: QualityLevel) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

const pct = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const people = (n: number) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`;

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
 * diagnóstico. Quem apresenta avisa os outros se está limitado e quantos fps está capturando,
 * pra quem assiste não acusar poucos fps de uma tela parada. Problemas passam por histerese.
 */
export function useStreamStats(options: Options): QualityReport | null {
  const latest = useRef(options);
  const counters = useRef(new Map<string, Counter>());
  const tracked = useRef(new Map<string, Tracked>());
  const freezeTimes = useRef<number[]>([]);
  const lossWindow = useRef<{ packets: number; lost: number }[]>([]);
  const zeroSeconds = useRef(0);
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
    tracked.current.clear();
    freezeTimes.current = [];
    lossWindow.current = [];
    zeroSeconds.current = 0;

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

    /** Só mostra o que persistiu por SHOW_AFTER medições e só esconde após HIDE_AFTER boas. */
    function settle(candidates: Candidate[]): { level: QualityLevel; issues: string[] } {
      const seen = new Set(candidates.map((c) => c.key));
      for (const candidate of candidates) {
        const entry = tracked.current.get(candidate.key) ?? { on: 0, off: 0, shown: false, last: candidate };
        entry.on += 1;
        entry.off = 0;
        entry.last = candidate;
        if (entry.on >= SHOW_AFTER) entry.shown = true;
        tracked.current.set(candidate.key, entry);
      }
      for (const [key, entry] of tracked.current) {
        if (seen.has(key)) continue;
        entry.on = 0;
        entry.off += 1;
        if (!entry.shown || entry.off >= HIDE_AFTER) tracked.current.delete(key);
      }
      const visible = [...tracked.current.values()].filter((e) => e.shown).map((e) => e.last);
      return {
        level: visible.reduce<QualityLevel>((acc, c) => worse(acc, c.level), "boa"),
        issues: visible.map((c) => c.text),
      };
    }

    /** Se eu sou o repetidor: alguma conexão de repasse está limitada? */
    async function forwardingLimited(exceptId: string): Promise<boolean> {
      const connections = Object.entries(latest.current.getConnections()).filter(([id]) => id !== exceptId);
      const results = await Promise.all(
        connections.map(async ([, pc]) => {
          const stats = await readStats(pc).catch(() => null);
          if (!stats) return false;
          return [...stats.values()].some((s) => {
            if (s.type !== "outbound-rtp" || s.kind !== "video") return false;
            const reason = s.qualityLimitationReason;
            const fps = num(s, "framesPerSecond");
            const sourceFps = num(stats.get(String(s.mediaSourceId)), "framesPerSecond");
            return (
              reason === "cpu" ||
              reason === "bandwidth" ||
              (sourceFps >= MOVING_SOURCE_FPS && fps > 0 && fps < sourceFps * DROP_RATIO)
            );
          });
        }),
      );
      return results.some(Boolean);
    }

    async function measureViewer(): Promise<QualityReport | null> {
      const { getConnections, presenter, presenterStream, presenterQuality, relay, receivingViaRelay, relaying } =
        latest.current;
      if (!presenter) return null;
      const source = receivingViaRelay && relay ? relay : presenter;
      const pc = getConnections()[source.id];
      if (!pc) return null;
      const stats = await readStats(pc);
      const trackId = presenterStream?.getVideoTracks()[0]?.id;
      const inbound = [...stats.values()]
        .filter((s) => s.type === "inbound-rtp" && s.kind === "video")
        .sort((a, b) => Number(b.trackIdentifier === trackId) - Number(a.trackIdentifier === trackId))[0];
      if (!inbound) return null;

      const fresh =
        presenterQuality?.peerId === presenter.id && Date.now() - presenterQuality.at < STALE_STATUS_MS
          ? presenterQuality
          : null;
      const sourceFps = fresh?.sourceFps ?? 0;
      const moving = sourceFps >= MOVING_SOURCE_FPS;

      const now = performance.now();
      const d = delta(inbound.id, {
        bytes: num(inbound, "bytesReceived"),
        packets: num(inbound, "packetsReceived"),
        lost: num(inbound, "packetsLost"),
        freezes: num(inbound, "freezeCount"),
        at: inbound.timestamp,
      });
      // Com a tela parada o navegador conta "travadas" que não são travadas de verdade.
      if (d?.freezes && moving) freezeTimes.current.push(...Array(d.freezes).fill(now));
      freezeTimes.current = freezeTimes.current.filter((t) => now - t < FREEZE_WINDOW_MS);
      if (d) lossWindow.current = [...lossWindow.current, { packets: d.packets, lost: d.lost }].slice(-LOSS_WINDOW);
      const windowPackets = lossWindow.current.reduce((sum, s) => sum + s.packets + s.lost, 0);
      const windowLost = lossWindow.current.reduce((sum, s) => sum + s.lost, 0);

      const metrics: ViewerMetrics = {
        width: num(inbound, "frameWidth"),
        height: num(inbound, "frameHeight"),
        fps: Math.round(num(inbound, "framesPerSecond")),
        kbps: d ? Math.round((d.bytes * 8) / d.at) : 0,
        lossPct: windowPackets > 0 ? (windowLost / windowPackets) * 100 : 0,
        rttMs: rttOf(selectedPair(stats)),
        codec: codecLabel(stats.get(String(inbound.codecId))?.mimeType),
        freezes: freezeTimes.current.length,
      };
      zeroSeconds.current = d && metrics.kbps === 0 ? zeroSeconds.current + 1 : 0;

      const chosen = fresh ? presetLabel(fresh.preset) : null;
      const candidates: Candidate[] = [];
      const remote = fresh && chosen ? limitationText(fresh.limitation, presenter.name, chosen) : null;
      if (remote) candidates.push({ key: "remoto", text: remote, level: "instavel" });
      // Tela parada pode passar segundos sem mandar nada; só é problema se ela está se mexendo
      // ou se o status de quem apresenta também parou de chegar.
      if (zeroSeconds.current >= NO_IMAGE_SECONDS && (moving || !fresh)) {
        candidates.push({
          key: "sem-imagem",
          text: "Não está chegando imagem agora. A conexão pode ter caído por um instante.",
          level: "ruim",
        });
      }
      if (metrics.lossPct >= 2) {
        candidates.push({
          key: "perda",
          text: `Perda de ${pct(metrics.lossPct)}% dos pacotes: sua conexão está instável (Wi-Fi fraco?).`,
          level: metrics.lossPct >= 8 ? "ruim" : "instavel",
        });
      }
      if (metrics.rttMs !== null && metrics.rttMs >= 300) {
        candidates.push({
          key: "ping",
          text: `Ping alto (${metrics.rttMs} ms) entre você e ${source.name}.`,
          level: metrics.rttMs >= 600 ? "ruim" : "instavel",
        });
      }
      if (moving && metrics.fps > 0 && metrics.fps < sourceFps * VIEWER_FPS_RATIO) {
        candidates.push({
          key: "fps",
          text: `Chegando ${metrics.fps} de ${Math.round(sourceFps)} quadros por segundo.`,
          level: metrics.fps < sourceFps * 0.3 ? "ruim" : "instavel",
        });
      }
      if (metrics.freezes > 0) {
        candidates.push({
          key: "travadas",
          text: `A imagem travou ${metrics.freezes} ${metrics.freezes === 1 ? "vez" : "vezes"} no último minuto.`,
          level: metrics.freezes >= 3 ? "ruim" : "instavel",
        });
      }

      if (relaying > 0 && (await forwardingLimited(presenter.id))) {
        candidates.push({
          key: "repasse",
          text: `Sua internet de envio ou seu computador não está dando conta de repassar pra ${people(relaying)}.`,
          level: "instavel",
        });
      }

      const { level, issues } = settle(candidates);
      const summary = metrics.height ? `${metrics.height}p · ${metrics.fps} fps` : "Medindo…";
      const path =
        (receivingViaRelay && relay ? `Via ${relay.name} (repetidor)` : `Direto de ${presenter.name}`) +
        (relaying > 0 ? ` · você está repassando pra ${people(relaying)}` : "");
      return { role: "assistindo", level, summary, chosen, path, issues, viewer: metrics };
    }

    async function measurePresenter(): Promise<QualityReport | null> {
      const { getConnections, participants, presenterStream, sendQualityStatus, preset, relay, relayUnavailable } =
        latest.current;
      const trackId = presenterStream?.getVideoTracks()[0]?.id;
      const connections = Object.entries(getConnections());
      const chosen = presetLabel(preset);
      const capKbps = Math.round(presetBitrate(preset) / 1000);
      const names = new Map(participants.map((p) => [p.id, p.name]));

      const rows = (
        await Promise.all(
          connections.map(async ([peerId, pc]): Promise<SendRow | null> => {
            const stats = await readStats(pc).catch(() => null);
            if (!stats) return null;
            // Desligar e religar o envio (repetidor) deixa envios antigos nas estatísticas;
            // só vale o que está mandando a trilha atual.
            const outbounds = [...stats.values()].filter((s) => s.type === "outbound-rtp" && s.kind === "video");
            const outbound = trackId
              ? outbounds.find((s) => stats.get(String(s.mediaSourceId))?.trackIdentifier === trackId)
              : outbounds[0];
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
            const droppingFrames = sourceFps >= MOVING_SOURCE_FPS && fps > 0 && fps < sourceFps * DROP_RATIO;
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
      )
        .filter((row): row is SendRow => row !== null)
        // Com repetidor, o envio direto pros outros é desligado; sobra a linha do repetidor.
        .filter((row) => !relay || row.id === relay.id || row.kbps > 0)
        .map((row) =>
          relay && row.id === relay.id ? { ...row, note: `repassando pra ${people(connections.length - 1)}` } : row,
        );

      const candidates: Candidate[] = [];
      if (relayUnavailable) {
        candidates.push({
          key: "sem-repetidor",
          text: "Ninguém na sala tem internet de envio suficiente pra repassar sua tela. Escolha uma qualidade menor.",
          level: "instavel",
        });
      }
      if (rows.some((r) => r.limitation === "cpu")) {
        candidates.push({
          key: "cpu",
          text: `Seu computador não está dando conta de codificar ${chosen} pra ${people(rows.length)}. Escolha uma qualidade menor ou feche programas pesados.`,
          level: "instavel",
        });
      } else if (rows.some((r) => r.limitation === "bandwidth")) {
        candidates.push({
          key: "banda",
          text: `Sua internet de envio não está dando conta de ${chosen} pra ${people(rows.length)}. Escolha uma qualidade menor.`,
          level: "instavel",
        });
      }
      for (const row of rows) {
        if (row.lossPct >= 5) {
          candidates.push({
            key: `perda:${row.id}`,
            text: `A conexão de ${row.name} está instável (${pct(row.lossPct)}% de perda).`,
            level: row.lossPct >= 15 ? "ruim" : "instavel",
          });
        }
        if (row.rttMs !== null && row.rttMs >= 400) {
          candidates.push({ key: `ping:${row.id}`, text: `Ping alto com ${row.name} (${row.rttMs} ms).`, level: "instavel" });
        }
      }

      const { level, issues } = settle(candidates);
      // O que os outros veem segue o mesmo filtro: só avisa limitação que persistiu.
      const limitation: Limitation = tracked.current.get("cpu")?.shown
        ? "cpu"
        : tracked.current.get("banda")?.shown
          ? "bandwidth"
          : "none";
      const sourceFps = rows.reduce((max, r) => Math.max(max, r.sourceFps), 0);
      if (tick % STATUS_EVERY_TICKS === 0) {
        sendQualityStatus({ limitation, viewers: connections.length, sourceFps });
      }

      const best = rows.reduce<SendRow | null>((acc, r) => (!acc || r.height > acc.height ? r : acc), null);
      const summary = best?.height
        ? `${best.height}p · ${best.fps} fps`
        : rows.length === 0
          ? "Ninguém assistindo"
          : "Medindo…";
      const path = relay ? `${relay.name} está repassando sua tela pros outros` : "Direto pra cada pessoa";
      return { role: "apresentando", level, summary, chosen, path, issues, rows };
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
