const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function createRoomId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeRoomId(raw: string | null): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return id.length >= 3 && id.length <= 64 ? id : null;
}

export function parseRoomInput(input: string): string | null {
  const value = input.trim();
  try {
    const fromUrl = new URL(value).searchParams.get("id");
    if (fromUrl) return normalizeRoomId(fromUrl);
  } catch {}
  return normalizeRoomId(value);
}

export function roomHref(id: string): string {
  return `/sala?id=${encodeURIComponent(id)}`;
}
