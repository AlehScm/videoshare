/**
 * Criptografia de cada quadro enviado pelo retransmissor público.
 * A chave (AES-GCM-128) é gerada por quem apresenta e só circula dentro da sala, pelo P2P.
 *
 * Formato: [versão u8][keyId u8][flags u8][timestamp µs u64][seq u32] + AES-GCM(payload).
 * O cabeçalho vai como AAD; o IV é keyId + trilha + seq, então nunca se repete com a mesma chave.
 */
const VERSION = 1;
export const HEADER_BYTES = 15;
export const FLAG_KEYFRAME = 1;
export const FLAG_CONFIG = 2;

export const TRACK_VIDEO = 0;
export const TRACK_AUDIO = 1;

export type FrameHeader = { keyId: number; flags: number; timestampUs: number; seq: number };

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return btoa(String.fromCharCode(...raw));
}

export async function importKey(encoded: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function iv(keyId: number, track: number, seq: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12);
  bytes[0] = keyId;
  bytes[1] = track;
  new DataView(bytes.buffer).setUint32(8, seq >>> 0);
  return bytes;
}

function encodeHeader(header: FrameHeader): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint8(1, header.keyId);
  view.setUint8(2, header.flags);
  view.setBigUint64(3, BigInt(Math.max(0, Math.round(header.timestampUs))));
  view.setUint32(11, header.seq >>> 0);
  return bytes;
}

export function readHeader(data: Uint8Array): FrameHeader | null {
  if (data.byteLength <= HEADER_BYTES) return null;
  const view = new DataView(data.buffer, data.byteOffset, HEADER_BYTES);
  if (view.getUint8(0) !== VERSION) return null;
  return {
    keyId: view.getUint8(1),
    flags: view.getUint8(2),
    timestampUs: Number(view.getBigUint64(3)),
    seq: view.getUint32(11),
  };
}

export async function seal(
  key: CryptoKey,
  header: FrameHeader,
  track: number,
  payload: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const head = encodeHeader(header);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv(header.keyId, track, header.seq), additionalData: head },
    key,
    payload,
  );
  const out = new Uint8Array(HEADER_BYTES + cipher.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(cipher), HEADER_BYTES);
  return out;
}

/** Devolve o payload em claro, ou `null` se a chave estiver errada ou o quadro adulterado. */
export async function open(
  key: CryptoKey,
  header: FrameHeader,
  track: number,
  data: Uint8Array,
): Promise<Uint8Array | null> {
  const head = data.slice(0, HEADER_BYTES);
  const cipher = data.slice(HEADER_BYTES);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv(header.keyId, track, header.seq), additionalData: head },
      key,
      cipher,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
