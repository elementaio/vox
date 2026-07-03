import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createIdentity, persistIdentity, restoreIdentity, type Identity } from "./lib/identity";
import { useLocales } from "./locales";
import { PinInput } from "./PinInput";
import { Logo } from "./components/icons";

/**
 * First-run onboarding, written to be understandable by anyone. Three plain steps:
 *   1. your NAME (what people call you)
 *   2. your ACCOUNT KEY — the 12 words (this is what moves between devices)
 *   3. a device PIN (a lock for THIS device only — like a phone passcode)
 * The passphrase never travels; the 12 words are the account. "Already have an
 * account" restores from those 12 words on this device.
 */
export default function Welcome({
  onReady,
  onBack,
}: {
  onReady: (id: Identity) => void;
  onBack?: () => void;
}) {
  const { t, toggle } = useLocales();
  const [mode, setMode] = useState<"choose" | "restore" | "name" | "kit" | "lock">("choose");
  const [flow, setFlow] = useState<"create" | "restore">("create");
  const [draft, setDraft] = useState<Identity | null>(null);
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinStage, setPinStage] = useState<"set" | "confirm">("set");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setDraft(createIdentity());
    setFlow("create");
    setName("");
    setMode("name");
  }

  function doRestore() {
    try {
      setDraft(restoreIdentity(phrase));
      setError("");
      setFlow("restore");
      setName("");
      setMode("name");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function afterName() {
    if (!draft) return;
    const chosen = name.trim() || draft.name;
    setDraft({ ...draft, name: chosen });
    setMode(flow === "create" ? "kit" : "lock");
  }

  function copyWords() {
    if (draft) void navigator.clipboard?.writeText(draft.mnemonic).then(() => setCopied(true));
  }

  async function finish(code: string) {
    if (!draft) return;
    setBusy(true);
    await persistIdentity(draft, code, draft.name);
    onReady(draft);
  }

  const stepLabel = (n: number) => <p className="step">{t("onboarding.step", { n, total: 3 })}</p>;

  return (
    <div className="lobby">
      <div className="lobby-card">
        {mode === "choose" && (
          <>
            <Logo size={60} />
            <h1>{t("onboarding.welcomeTitle")}</h1>
            <p className="sub">{t("onboarding.welcomeSub")}</p>
            <button onClick={startCreate}>{t("onboarding.createAccount")}</button>
            <button className="ghost" onClick={() => setMode("restore")} style={{ marginTop: 10 }}>
              {t("onboarding.haveAccount")}
            </button>
            {onBack && (
              <button className="link" onClick={onBack} style={{ marginTop: 10 }}>
                {t("common.back")}
              </button>
            )}
          </>
        )}

        {mode === "restore" && (
          <>
            <h1>{t("onboarding.restoreTitle")}</h1>
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
              autoFocus
            />
            {error && <p className="error">{error}</p>}
            <button onClick={doRestore}>{t("common.continue")}</button>
            <button className="ghost" onClick={() => setMode("choose")} style={{ marginTop: 10 }}>
              {t("common.back")}
            </button>
          </>
        )}

        {mode === "name" && (
          <>
            {stepLabel(1)}
            <h1>{t("onboarding.nameTitle")}</h1>
            <p className="sub">{t("onboarding.nameSub")}</p>
            <input
              className="pass-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={draft?.name ?? t("onboarding.namePlaceholder")}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && afterName()}
            />
            <button onClick={afterName}>{t("common.continue")}</button>
          </>
        )}

        {mode === "kit" && draft && (
          <>
            {stepLabel(2)}
            <h1>{t("onboarding.kitTitle")}</h1>
            <p className="sub">{t("onboarding.kitSub")}</p>
            <div className="phrase">
              {draft.mnemonic.split(" ").map((w, i) => (
                <span key={i}>
                  <em>{i + 1}</em>
                  {w}
                </span>
              ))}
            </div>
            <div className="kit-qr">
              <QRCodeSVG value={draft.mnemonic} size={132} />
            </div>
            <button className="ghost" onClick={copyWords} style={{ marginBottom: 10 }}>
              {copied ? t("onboarding.copied") : t("onboarding.copy")}
            </button>
            <p className="warn">{t("onboarding.kitWarn")}</p>
            <label className="check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              {t("onboarding.kitSaved")}
            </label>
            <button disabled={!saved} onClick={() => setMode("lock")}>
              {t("common.continue")}
            </button>
          </>
        )}

        {mode === "lock" && (
          <>
            {stepLabel(3)}
            <h1>{t("onboarding.lockTitle")}</h1>
            <p className="sub">
              {pinStage === "set" ? t("onboarding.lockSub") : t("onboarding.lockAgain")}
            </p>
            {pinStage === "set" ? (
              <PinInput
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  setError("");
                }}
                onComplete={() => setPinStage("confirm")}
                autoFocus
              />
            ) : (
              <PinInput
                value={pin2}
                onChange={(v) => {
                  setPin2(v);
                  setError("");
                }}
                onComplete={(v) => {
                  if (v === pin) void finish(v);
                  else {
                    setError(t("onboarding.pinMismatch"));
                    setPin("");
                    setPin2("");
                    setPinStage("set");
                  }
                }}
                autoFocus
              />
            )}
            {error && <p className="error">{error}</p>}
            {busy && <p className="sub">{t("onboarding.creating")}</p>}
          </>
        )}

        <button className="link lang" onClick={toggle} style={{ marginTop: 14 }}>
          {t("settings.toggleLanguage")}
        </button>
      </div>
    </div>
  );
}
