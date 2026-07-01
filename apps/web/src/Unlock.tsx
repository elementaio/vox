import { useState } from "react";
import { unlockIdentity, type Identity } from "./lib/identity";
import { useLocales } from "./locales";

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
  const { t, toggle } = useLocales();
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    const id = await unlockIdentity(pass);
    setBusy(false);
    if (id) onReady(id);
    else setError(t("onboarding.wrongPassphrase"));
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>{t("onboarding.welcomeBack")}</h1>
        <p className="sub">{t("onboarding.unlockSub")}</p>
        <input
          className="pass-input"
          type="password"
          autoFocus
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setError("");
          }}
          placeholder={t("onboarding.passphrasePlaceholder")}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
        />
        {error && <p className="error">{error}</p>}
        <button onClick={unlock} disabled={busy}>
          {busy ? t("onboarding.unlocking") : t("onboarding.unlock")}
        </button>
        <button className="link" onClick={onReset} style={{ marginTop: 12 }}>
          {t("onboarding.forgotRestore")}
        </button>
        <button className="link" onClick={toggle}>
          {t("settings.toggleLanguage")}
        </button>
      </div>
    </div>
  );
}
