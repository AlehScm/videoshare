import { presetBitrate, type QualityPreset } from "@/lib/quality";

/** Tamanho do teste de envio que cada computador manda pra quem apresenta. */
export const PROBE_BYTES = 2 * 1024 * 1024;
/** Quanto tempo a limitação de quem apresenta precisa durar antes de ligar o repetidor. */
export const RELAY_AFTER_MS = 8000;
/** Com menos gente assistindo o direto compensa (menos atraso, sem recodificar). */
export const RELAY_MIN_VIEWERS = 3;
const RELAY_HEADROOM = 1.5;

export type Device = "desktop" | "mobile";
export type RelayCandidate = { id: string; uploadMbps: number };

export function measureMbps(bytes: number, elapsedMs: number): number {
  return elapsedMs > 0 ? (bytes * 8) / (elapsedMs * 1000) : 0;
}

/** Upload que o repetidor precisa pra repassar a qualidade escolhida pros outros. */
export function relayNeedMbps(viewers: number, preset: QualityPreset): number {
  return (Math.max(0, viewers - 1) * presetBitrate(preset) * RELAY_HEADROOM) / 1_000_000;
}

/** Quem tem o maior upload medido, desde que dê conta de repassar pra todo mundo. */
export function chooseRelay(
  candidates: RelayCandidate[],
  viewers: number,
  preset: QualityPreset,
): string | null {
  const need = relayNeedMbps(viewers, preset);
  const able = candidates.filter((c) => c.uploadMbps >= need).sort((a, b) => b.uploadMbps - a.uploadMbps);
  return able[0]?.id ?? null;
}
