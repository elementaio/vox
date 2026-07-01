import { useState } from "react";
import { unlockIdentity, type Identity } from "./lib/identity";

/**
 * Unlock screen — shown when an encrypted account exists on this device.
 * The passphrase decrypts the seed phrase (and, downstream, the message store).
 */
export default function Unlock({
  onReady,
  onReset,
}: {
  onReady: (id: Identity) => void;
  onReset: () => void;
}) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    const id = await unlockIdentity(pass);
    setBusy(false);
    if (id) onReady(id);
    else setError("Wrong passphrase.");
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>🔒 Welcome back</h1>
        <p className="sub">Enter your passphrase to unlock this device.</p>
        <input
          className="pass-input"
          type="password"
          autoFocus
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setError("");
          }}
          placeholder="Passphrase"
          onKeyDown={(e) => e.key === "Enter" && unlock()}
        />
        {error && <p className="error">{error}</p>}
        <button onClick={unlock} disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        <button className="link" onClick={onReset} style={{ marginTop: 12 }}>
          Forgot passphrase? Restore with 12 words
        </button>
      </div>
    </div>
  );
}
