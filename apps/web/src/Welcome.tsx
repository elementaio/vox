import { useState } from "react";
import {
  createIdentity,
  persistIdentity,
  restoreIdentity,
  type Identity,
} from "./lib/identity";

/**
 * First-run onboarding. Creates or restores a self-owned account (a keypair),
 * then encrypts it at rest under a passphrase. The private key never leaves this
 * device; the 12 words are the only off-device backup.
 */
export default function Welcome({ onReady }: { onReady: (id: Identity) => void }) {
  const [mode, setMode] = useState<"choose" | "backup" | "restore" | "pass">("choose");
  const [draft, setDraft] = useState<Identity | null>(null);
  const [phrase, setPhrase] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setDraft(createIdentity());
    setMode("backup");
  }

  function doRestore() {
    try {
      setDraft(restoreIdentity(phrase));
      setError("");
      setMode("pass");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finish() {
    if (!draft) return;
    if (pass.length < 6) return setError("Use at least 6 characters.");
    if (pass !== confirm) return setError("Passphrases don't match.");
    setBusy(true);
    await persistIdentity(draft, pass);
    onReady(draft);
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>🔒 Your account</h1>

        {mode === "choose" && (
          <>
            <p className="sub">
              Your account lives on this device — a key only you hold. No email,
              no password server, no company that can take it.
            </p>
            <button onClick={startCreate}>Create new account</button>
            <button className="ghost" onClick={() => setMode("restore")} style={{ marginTop: 10 }}>
              Restore from 12-word phrase
            </button>
          </>
        )}

        {mode === "backup" && draft && (
          <>
            <p className="sub">
              Write down these 12 words and keep them safe. They are the{" "}
              <strong>only</strong> way to restore your account on another device.
            </p>
            <div className="phrase">
              {draft.mnemonic.split(" ").map((w, i) => (
                <span key={i}>
                  <em>{i + 1}</em>
                  {w}
                </span>
              ))}
            </div>
            <p className="tip">
              You are: <strong>{draft.name}</strong>
            </p>
            <button onClick={() => setMode("pass")}>I saved my 12 words — continue</button>
          </>
        )}

        {mode === "restore" && (
          <>
            <p className="sub">Enter your 12-word phrase, words separated by spaces.</p>
            <textarea
              className="phrase-input"
              value={phrase}
              onChange={(e) => {
                setPhrase(e.target.value);
                setError("");
              }}
              placeholder="word1 word2 word3 …"
              rows={3}
            />
            {error && <p className="error">{error}</p>}
            <button onClick={doRestore}>Continue</button>
            <button className="ghost" onClick={() => setMode("choose")} style={{ marginTop: 10 }}>
              Back
            </button>
          </>
        )}

        {mode === "pass" && (
          <>
            <p className="sub">
              Set a passphrase to <strong>encrypt this account on this device</strong>.
              You'll enter it to unlock the app. If you forget it, restore with your
              12 words.
            </p>
            <input
              className="pass-input"
              type="password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setError("");
              }}
              placeholder="Passphrase"
            />
            <input
              className="pass-input"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError("");
              }}
              placeholder="Confirm passphrase"
              onKeyDown={(e) => e.key === "Enter" && finish()}
            />
            {error && <p className="error">{error}</p>}
            <button onClick={finish} disabled={busy}>
              {busy ? "Encrypting…" : "Encrypt & continue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
