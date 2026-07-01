import type { Identity } from "./identity";
import type { StoredContact } from "./types";

/**
 * An invite carries your identity (public + encryption key + name) AND your
 * home-relay hint — so the person who opens it can add you, message you, and (if
 * you're on a different server) have their relay forward to yours. No central
 * directory: discovery info rides in the invite you share. `relay` is your home
 * relay's http base (the host passes it; the SDK doesn't assume where it runs).
 */
export function inviteToken(id: Identity, relay: string): string {
  return btoa(
    encodeURIComponent(
      JSON.stringify({
        p: id.publicKeyHex,
        e: id.encPublicKeyHex,
        n: id.name,
        r: relay, // home relay (http base)
      }),
    ),
  );
}

export function parseInvite(token: string): StoredContact | null {
  try {
    const o = JSON.parse(decodeURIComponent(atob(token)));
    if (!o.p || !o.e) return null;
    return {
      pubkey: o.p,
      enc: o.e,
      name: o.n || o.p.slice(0, 6),
      relay: o.r,
      addedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
