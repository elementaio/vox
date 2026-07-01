import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";

/**
 * End-to-end message security: sign-then-seal.
 *
 *   1. The sender SIGNS the message with their Ed25519 identity key — proof of
 *      authorship that a group member (or anyone) can verify.
 *   2. The signed message is SEALED to the recipient with X25519 ECDH +
 *      XChaCha20-Poly1305 — only the recipient can open it.
 *
 * A relay (or any middle box) only ever sees ciphertext, and cannot forge or
 * tamper. This is what makes relayed/offline delivery safe: the server carries
 * sealed envelopes it can't read.
 *
 * No forward secrecy yet (each message uses a fresh ephemeral key on the
 * sender side, but the recipient key is long-lived). A Double-Ratchet upgrade
 * for full forward secrecy is future hardening.
 */

export interface SealedEnvelope {
  epk: string; // ephemeral X25519 public key (hex)
  n: string; // nonce (hex)
  ct: string; // ciphertext (hex)
}

export interface OpenedMessage<T = unknown> {
  from: string; // sender Ed25519 public key (hex) — verified
  ts: number;
  body: T; // structured payload: chat text, receipt, typing, …
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
};

/** Derive a long-lived X25519 keypair from the 32-byte identity seed. */
export function deriveEncryptionKey(seed: Uint8Array): {
  priv: Uint8Array;
  pubHex: string;
} {
  const priv = sha256(concat(seed, enc.encode("x25519-v1")));
  return { priv, pubHex: toHex(x25519.getPublicKey(priv)) };
}

// Signed bytes and the KDF must be byte-for-byte identical on both sides.
const signedBytes = (from: string, ts: number, body: unknown): Uint8Array =>
  enc.encode(JSON.stringify({ from, ts, body }));

const deriveKey = (
  shared: Uint8Array,
  epk: Uint8Array,
  recipientPub: Uint8Array,
): Uint8Array => sha256(concat(shared, epk, recipientPub));

/** Sign `body` and seal it to one recipient's X25519 public key. */
export function seal(
  senderSignSeed: Uint8Array,
  senderPubHex: string,
  recipientEncPubHex: string,
  body: unknown,
  ts: number,
): SealedEnvelope {
  const sig = ed25519.sign(signedBytes(senderPubHex, ts, body), senderSignSeed);
  const plaintext = enc.encode(
    JSON.stringify({ from: senderPubHex, ts, body, sig: toHex(sig) }),
  );

  const ephPriv = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephPriv);
  const recipientPub = fromHex(recipientEncPubHex);
  const shared = x25519.getSharedSecret(ephPriv, recipientPub);
  const key = deriveKey(shared, ephPub, recipientPub);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);

  return { epk: toHex(ephPub), n: toHex(nonce), ct: toHex(ct) };
}

/**
 * Open a sealed envelope and verify the sender's signature. Throws if the
 * ciphertext is tampered, the signature is invalid, or (when `expectFrom` is
 * given) the author isn't who we expect.
 */
export function open<T = unknown>(
  recipientEncPriv: Uint8Array,
  recipientEncPubHex: string,
  env: SealedEnvelope,
  expectFrom?: string,
): OpenedMessage<T> {
  const ephPub = fromHex(env.epk);
  const shared = x25519.getSharedSecret(recipientEncPriv, ephPub);
  const key = deriveKey(shared, ephPub, fromHex(recipientEncPubHex));
  const plaintext = xchacha20poly1305(key, fromHex(env.n)).decrypt(fromHex(env.ct));

  const obj = JSON.parse(dec.decode(plaintext)) as {
    from: string;
    ts: number;
    body: T;
    sig: string;
  };

  const ok = ed25519.verify(
    fromHex(obj.sig),
    signedBytes(obj.from, obj.ts, obj.body),
    fromHex(obj.from),
  );
  if (!ok) throw new Error("bad signature");
  if (expectFrom && obj.from !== expectFrom) {
    throw new Error("author mismatch");
  }

  return { from: obj.from, ts: obj.ts, body: obj.body };
}
