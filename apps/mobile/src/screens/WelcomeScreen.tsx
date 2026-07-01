import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { createIdentity, type Identity, type Vault } from "@pochta-chat/sdk";
import { Brand, Button, Centered, Input, Label, Link, Muted, Screen, Sub } from "../ui";
import { useI18n } from "../i18n";
import { colors, radius, space } from "../theme";

export default function WelcomeScreen({
  vault,
  onReady,
}: {
  vault: Vault;
  onReady: (id: Identity) => void;
}) {
  const { t, toggle } = useI18n();
  const [id, setId] = useState<Identity | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!id || pass.length < 4) return;
    setBusy(true);
    await vault.persist(id, pass);
    onReady(id);
  }

  return (
    <Screen>
      <Centered>
        <Brand />
        <Sub>{t("tagline")}</Sub>
        {!id ? (
          <>
            <Button title={t("createAccount")} onPress={() => setId(createIdentity())} />
            <Muted>{t("accountHint")}</Muted>
          </>
        ) : (
          <>
            <Label>{t("recoveryLabel")}</Label>
            <Text style={s.mnemonic}>{id.mnemonic}</Text>
            <Label>{t("passphraseLabel")}</Label>
            <Input secureTextEntry placeholder={t("passphrase")} value={pass} onChangeText={setPass} />
            <Button title={t("encryptContinue")} onPress={finish} busy={busy} />
          </>
        )}
        <Link title={t("toggleLang")} onPress={toggle} />
      </Centered>
    </Screen>
  );
}

const s = StyleSheet.create({
  mnemonic: {
    color: colors.accent2,
    fontSize: 16,
    lineHeight: 26,
    backgroundColor: colors.panel,
    padding: space.lg,
    borderRadius: radius.md,
    textAlign: "center",
  },
});
