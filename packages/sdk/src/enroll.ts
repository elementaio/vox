import { sign, type Identity } from "./identity";

/**
 * Redeem a join token to enroll on a private (guarded) relay. We sign
 * `enroll|token|ts` with the identity key so the relay knows the request comes
 * from the holder of this pubkey. On success the pubkey is added to the relay's
 * member allowlist and can connect. `httpBase` is the target relay's origin.
 */
export async function enroll(
  identity: Identity,
  httpBase: string,
  token: string,
): Promise<boolean> {
  const ts = String(Date.now());
  const sig = sign(identity, `enroll|${token}|${ts}`);
  try {
    const res = await fetch(`${httpBase}/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: identity.publicKeyHex, token, ts, sig }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
