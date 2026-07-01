import { useState } from "react";
import { httpBase } from "./lib/server";

/**
 * Web admin panel for a private/federated relay — so a NON-technical admin can
 * manage the network from a browser instead of the CLI. Guarded by the relay's
 * admin token. Served at /admin.
 */

const KEY = "chat.adminToken";

interface TokenRow {
  token: string;
  used: boolean;
}
interface PeerRow {
  pubkey: string;
  origin?: string;
  revoked: boolean;
}

export default function AdminPanel() {
  const [token, setToken] = useState(sessionStorage.getItem(KEY) ?? "");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [minted, setMinted] = useState("");
  const [addPk, setAddPk] = useState("");
  const [allowOrigin, setAllowOrigin] = useState("");

  async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`${httpBase()}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(opts.headers ?? {}),
      },
    });
    if (res.status === 401) throw new Error("unauthorized");
    return (await res.json()) as T;
  }

  async function refresh() {
    const [m, t, p] = await Promise.all([
      api<{ members: string[] }>("/admin/members"),
      api<{ tokens: TokenRow[] }>("/admin/tokens"),
      api<{ peers: PeerRow[] }>("/admin/peers"),
    ]);
    setMembers(m.members ?? []);
    setTokens(t.tokens ?? []);
    setPeers(p.peers ?? []);
  }

  async function login() {
    try {
      sessionStorage.setItem(KEY, token);
      await api("/admin/members"); // validates the token
      setAuthed(true);
      setError("");
      await refresh();
    } catch {
      setError("Wrong admin token (or admin is disabled on this relay).");
      setAuthed(false);
    }
  }

  async function mint() {
    const r = await api<{ token: string }>("/admin/tokens", { method: "POST" });
    setMinted(r.token);
    await refresh();
  }
  async function addMember() {
    if (!addPk.trim()) return;
    await api("/admin/members", { method: "POST", body: JSON.stringify({ pubkey: addPk.trim() }) });
    setAddPk("");
    await refresh();
  }
  async function removeMember(pk: string) {
    await api("/admin/members/remove", { method: "POST", body: JSON.stringify({ pubkey: pk }) });
    await refresh();
  }
  async function allowPeer() {
    if (!allowOrigin.trim()) return;
    const r = await api<{ error?: string }>("/admin/peers/allow", {
      method: "POST",
      body: JSON.stringify({ origin: allowOrigin.trim() }),
    });
    if (r.error) alert(r.error);
    setAllowOrigin("");
    await refresh();
  }
  async function revokePeer(pk: string) {
    await api("/admin/peers/revoke", { method: "POST", body: JSON.stringify({ pubkey: pk }) });
    await refresh();
  }

  if (!authed) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>🛠️ Relay admin</h1>
          <p className="sub">
            Enter this relay's admin token to manage members and federated peers.
          </p>
          <input
            className="pass-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin token"
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
          {error && <p className="error">{error}</p>}
          <button onClick={login}>Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>🛠️ Relay admin</h1>
        <button
          className="link"
          onClick={() => {
            setAuthed(false);
            sessionStorage.removeItem(KEY);
          }}
        >
          Sign out
        </button>
      </header>

      <div className="admin-grid">
        <section className="admin-card">
          <h2>Join tokens</h2>
          <button onClick={mint}>Mint a join token</button>
          {minted && (
            <div className="minted">
              New token: <code>{minted}</code>{" "}
              <button className="link" onClick={() => navigator.clipboard.writeText(minted)}>
                copy
              </button>
              <div className="muted">
                Give this to a new member — they redeem it in the app via "Join
                private network".
              </div>
            </div>
          )}
          <ul className="admin-list">
            {tokens.map((t) => (
              <li key={t.token}>
                <code>{t.token}</code>{" "}
                <span className={`tag ${t.used ? "used" : ""}`}>{t.used ? "used" : "unused"}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-card">
          <h2>Members ({members.length})</h2>
          <div className="admin-row">
            <input value={addPk} onChange={(e) => setAddPk(e.target.value)} placeholder="Add member pubkey" />
            <button onClick={addMember}>Add</button>
          </div>
          <ul className="admin-list">
            {members.map((m) => (
              <li key={m}>
                <code className="mono">{m}</code>
                <button className="link danger" onClick={() => removeMember(m)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-card">
          <h2>Federated peers ({peers.length})</h2>
          <div className="admin-row">
            <input
              value={allowOrigin}
              onChange={(e) => setAllowOrigin(e.target.value)}
              placeholder="Allow peer origin (https://relay…)"
            />
            <button onClick={allowPeer}>Allow</button>
          </div>
          <ul className="admin-list">
            {peers.map((p) => (
              <li key={p.pubkey}>
                <code className="mono">{p.origin || p.pubkey}</code>
                {p.revoked ? (
                  <span className="tag used">revoked</span>
                ) : (
                  <button className="link danger" onClick={() => revokePeer(p.pubkey)}>
                    revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
