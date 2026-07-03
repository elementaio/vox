import { useLocales } from "./locales";
import type { AccountRef } from "./lib/identity";
import { Logo } from "./components/icons";

/**
 * "Who's using Vox?" — the return screen when this device holds one or more
 * accounts. Pick a name to unlock, add another, or remove one from the device.
 * Signing out lands here; nobody's data is wiped by switching.
 */
export default function AccountPicker({
  accounts,
  onPick,
  onAdd,
  onForget,
}: {
  accounts: AccountRef[];
  onPick: (a: AccountRef) => void;
  onAdd: () => void;
  onForget: (pubkey: string) => void;
}) {
  const { t, toggle } = useLocales();
  return (
    <div className="lobby">
      <div className="lobby-card">
        <Logo size={60} />
        <h1>{t("onboarding.pickTitle")}</h1>
        <p className="sub">{t("onboarding.pickSub")}</p>
        <div className="accounts">
          {accounts.map((a) => (
            <div className="account" key={a.pubkey}>
              <button className="account-pick" onClick={() => onPick(a)}>
                <span className="account-avatar">{a.name.slice(0, 1).toUpperCase()}</span>
                <span className="account-name">{a.name}</span>
              </button>
              <button
                className="account-x"
                title={t("onboarding.forget")}
                onClick={() => {
                  if (confirm(t("onboarding.forgetConfirm", { name: a.name }))) onForget(a.pubkey);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="ghost" onClick={onAdd}>
          {t("onboarding.addAccount")}
        </button>
        <button className="link lang" onClick={toggle} style={{ marginTop: 14 }}>
          {t("settings.toggleLanguage")}
        </button>
      </div>
    </div>
  );
}
