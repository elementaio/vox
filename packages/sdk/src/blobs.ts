import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";

/**
 * Media blobs: the file is encrypted on-device with a fresh random key, and only
 * the CIPHERTEXT is uploaded to the relay's blob store. The key is returned to
 * the caller, who puts it inside the E2E-sealed message — so the relay (which
 * holds the ciphertext) can never decrypt the media. `httpBase` is the relay's
 * http(s) origin (the host provides it; the SDK stays URL-agnostic).
 */

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

/** Encrypt bytes and upload the ciphertext. Returns the blob id + hex key. */
export async function encryptAndUpload(
  httpBase: string,
  bytes: Uint8Array,
): Promise<{ blobId: string; key: string }> {
  const key = randomBytes(32);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(bytes);
  const payload = new Uint8Array(nonce.length + ct.length);
  payload.set(nonce);
  payload.set(ct, nonce.length);

  const form = new FormData();
  form.append("file", new Blob([payload], { type: "application/octet-stream" }), "blob");
  const res = await fetch(`${httpBase}/blobs`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return { blobId: id, key: toHex(key) };
}

/** Download the ciphertext for a blob and decrypt it with the hex key. */
export async function downloadAndDecrypt(
  httpBase: string,
  blobId: string,
  keyHex: string,
): Promise<Uint8Array> {
  const res = await fetch(`${httpBase}/blobs/${blobId}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const nonce = buf.slice(0, 24);
  const ct = buf.slice(24);
  return xchacha20poly1305(fromHex(keyHex), nonce).decrypt(ct);
}
