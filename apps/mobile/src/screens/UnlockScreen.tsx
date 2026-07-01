import { useState } from "react";
import { type Identity, type Vault } from "@pochta-chat/sdk";
import { Brand, Button, Centered, ErrorText, Input, Label, Link, Screen } from "../ui";
import { useI18n } from "../i18n";

export default function UnlockScreen({
  vault,
  onReady,
  onReset,
}: {
  vault: Vault;
  onReady: (id: Identity) => void;
  onReset: () => void;
}) {
  const { t, toggle } = useI18n();
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    const id = await vault.unlock(pass);
    setBusy(false);
    if (id) onReady(id);
    else setError(t("wrongPassphrase"));
  }

  return (
    <Screen>
      <Centered>
        <Brand />
        <Label>{t("unlockTitle")}</Label>
        <Input
          secureTextEntry
          placeholder={t("passphrase")}
          value={pass}
          onChangeText={setPass}
          onSubmitEditing={unlock}
        />
        {!!error && <ErrorText>{error}</ErrorText>}
        <Button title={t("unlock")} onPress={unlock} busy={busy} />
        <Link title={t("resetAccount")} onPress={onReset} />
        <Link title={t("toggleLang")} onPress={toggle} />
      </Centered>
    </Screen>
  );
}
