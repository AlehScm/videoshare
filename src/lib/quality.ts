export type Resolution = 480 | 720 | 1080;
export type FrameRate = 30 | 60;
export type QualityPreset = { height: Resolution; fps: FrameRate };

export const DEFAULT_PRESET: QualityPreset = { height: 720, fps: 30 };
export const RESOLUTIONS: readonly Resolution[] = [480, 720, 1080];
export const FRAME_RATES: readonly FrameRate[] = [30, 60];

const WIDTH: Record<Resolution, number> = { 480: 854, 720: 1280, 1080: 1920 };

const BITRATE: Record<`${Resolution}-${FrameRate}`, number> = {
  "480-30": 1_200_000,
  "480-60": 1_800_000,
  "720-30": 2_500_000,
  "720-60": 4_000_000,
  "1080-30": 4_500_000,
  "1080-60": 7_000_000,
};

const STORAGE_KEY = "videoshare:qualidade";

export const presetWidth = (preset: QualityPreset) => WIDTH[preset.height];
export const presetBitrate = (preset: QualityPreset) => BITRATE[`${preset.height}-${preset.fps}`];
export const presetLabel = (preset: QualityPreset) => `${preset.height}p · ${preset.fps} fps`;
export const presetKey = (preset: QualityPreset) => `${preset.height}-${preset.fps}`;

export function parsePreset(value: unknown): QualityPreset | null {
  if (typeof value !== "string") return null;
  const [height, fps] = value.split("-").map(Number);
  if (!RESOLUTIONS.includes(height as Resolution) || !FRAME_RATES.includes(fps as FrameRate)) return null;
  return { height: height as Resolution, fps: fps as FrameRate };
}

export function loadPreset(): QualityPreset {
  try {
    return parsePreset(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

export function savePreset(preset: QualityPreset): void {
  try {
    localStorage.setItem(STORAGE_KEY, presetKey(preset));
  } catch {}
}
