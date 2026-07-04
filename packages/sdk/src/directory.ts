import { ed25519 } from "@noble/curves/ed25519.js";
import type { Identity } from "./identity";
import type { StoredContact } from "./types";

/**
 * The opt-in "find people" directory client. Every call is SIGNED with the
 * identity key so the relay can prove who's asking (and gate a private org's
 * directory to its members). Discovery is opt-in: you only appear once you
 * register a handle.
 */

export interface DirectoryEntry {
  handle: string;
  name: string;
  pubkey: string;
  enc: string;
  relay?: string;
}

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const sign = (identity: Identity, msg: string): string =>
  toHex(ed25519.sign(new TextEncoder().encode(msg), identity.privateKey));

const authHeaders = (identity: Identity, ts: string, sig: string) => ({
  "x-vox-pubkey": identity.publicKeyHex,
  "x-vox-ts": ts,
  "x-vox-sig": sig,
});

/** Claim/replace your handle so others can find you. Returns {ok} or an error code. */
export async function registerHandle(
  identity: Identity,
  httpBase: string,
  handle: string,
  relay?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ts = Date.now().toString();
  const sig = sign(identity, `directory|${handle}|${ts}`);
  const res = await fetch(`${httpBase}/directory/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pubkey: identity.publicKeyHex,
      enc: identity.encPublicKeyHex,
      handle,
      name: identity.name,
      relay,
      ts,
      sig,
    }),
  });
  if (res.ok) return { ok: true };
  const e = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: e.error };
}

/** Search the directory by handle/name prefix. */
export async function searchDirectory(
  identity: Identity,
  httpBase: string,
  q: string,
): Promise<DirectoryEntry[]> {
  const ts = Date.now().toString();
  const sig = sign(identity, `directory-search|${ts}`);
  const res = await fetch(`${httpBase}/directory/search?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(identity, ts, sig),
  });
  if (!res.ok) return [];
  const d = (await res.json()) as { results?: DirectoryEntry[] };
  return d.results ?? [];
}

/** Resolve an exact handle to an identity. */
export async function lookupHandle(
  identity: Identity,
  httpBase: string,
  handle: string,
): Promise<DirectoryEntry | null> {
  const ts = Date.now().toString();
  const sig = sign(identity, `directory-search|${ts}`);
  const res = await fetch(`${httpBase}/directory/lookup?handle=${encodeURIComponent(handle)}`, {
    headers: authHeaders(identity, ts, sig),
  });
  if (!res.ok) return null;
  return (await res.json()) as DirectoryEntry;
}

/** Remove yourself from the directory. */
export async function unregisterHandle(identity: Identity, httpBase: string): Promise<void> {
  const ts = Date.now().toString();
  const sig = sign(identity, `directory-remove|${ts}`);
  await fetch(`${httpBase}/directory/unregister`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pubkey: identity.publicKeyHex, ts, sig }),
  }).catch(() => {});
}

/** Turn a directory result into a contact you can add + message. */
export function entryToContact(e: DirectoryEntry): StoredContact {
  return {
    pubkey: e.pubkey,
    enc: e.enc,
    name: e.name || e.handle,
    relay: e.relay,
    addedAt: Date.now(),
  };
}
