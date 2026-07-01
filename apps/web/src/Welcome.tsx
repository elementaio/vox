import { useState } from "react";
import {
  createIdentity,
  persistIdentity,
  restoreIdentity,
  type Identity,
} from "./lib/identity";
import { useLocales } from "./locales";

/**
 * First-run onboarding. Creates or restores a self-owned account (a keypair),
 * then encrypts it at rest under a passphrase. The private key never leaves this
 * device; the 12 words are the only off-device backup.
 */
export default function Welcome({ onReady }: { onReady: (id: Identity) => void }) {
  const { t, toggle } = useLocales();
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
    if (pass.length < 6) return setError(t("onboarding.useAtLeast6"));
    if (pass !== confirm) return setError(t("onboarding.passNoMatch"));
    setBusy(true);
    await persistIdentity(draft, pass);
    onReady(draft);
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>{t("onboarding.accountTitle")}</h1>

        {mode === "choose" && (
          <>
            <p className="sub">{t("onboarding.chooseSub")}</p>
            <button onClick={startCreate}>{t("onboarding.createAccount")}</button>
            <button className="ghost" onClick={() => setMode("restore")} style={{ marginTop: 10 }}>
              {t("onboarding.restoreFromPhrase")}
            </button>
          </>
        )}

        {mode === "backup" && draft && (
          <>
            <p className="sub">{t("onboarding.backupSub")}</p>
            <div className="phrase">
              {draft.mnemonic.split(" ").map((w, i) => (
                <span key={i}>
                  <em>{i + 1}</em>
                  {w}
                </span>
              ))}
            </div>
            <p className="tip">{t("onboarding.youAre", { name: draft.name })}</p>
            <button onClick={() => setMode("pass")}>{t("onboarding.savedContinue")}</button>
          </>
        )}

        {mode === "restore" && (
          <>
            <p className="sub">{t("onboarding.restoreSub")}</p>
            <textarea
              className="phrase-input"
              value={phrase}
              onChange={(e) => {
                setPhrase(e.target.value);
                setError("");
              }}
              placeholder={t("onboarding.phrasePlaceholder")}
              rows={3}
            />
            {error && <p className="error">{error}</p>}
            <button onClick={doRestore}>{t("common.continue")}</button>
            <button className="ghost" onClick={() => setMode("choose")} style={{ marginTop: 10 }}>
              {t("common.back")}
            </button>
          </>
        )}

        {mode === "pass" && (
          <>
            <p className="sub">{t("onboarding.passSub")}</p>
            <input
              className="pass-input"
              type="password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setError("");
              }}
              placeholder={t("onboarding.passphrase")}
            />
            <input
              className="pass-input"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError("");
              }}
              placeholder={t("onboarding.confirmPassphrase")}
              onKeyDown={(e) => e.key === "Enter" && finish()}
            />
            {error && <p className="error">{error}</p>}
            <button onClick={finish} disabled={busy}>
              {busy ? t("onboarding.encrypting") : t("onboarding.encryptContinue")}
            </button>
          </>
        )}

        <button className="link" onClick={toggle} style={{ marginTop: 14 }}>
          {t("settings.toggleLanguage")}
        </button>
      </div>
    </div>
  );
}
