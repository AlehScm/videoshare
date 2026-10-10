const STORAGE_KEY = "videoshare:volume";

export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = Number(raw);
    return raw !== null && stored >= 0 && stored <= 1 ? stored : 1;
  } catch {
    return 1;
  }
}

export function saveVolume(volume: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(volume));
  } catch {}
}
