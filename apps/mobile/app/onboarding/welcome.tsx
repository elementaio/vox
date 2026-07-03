import { useState } from "react";
import { StyleSheet, Text as RNText } from "react-native";
import { router } from "expo-router";
import { createIdentity, restoreIdentity, type Identity } from "@elementaio/vox-sdk";
import { Brand, Button, Centered, Input, Link, Screen, Text } from "../../components";
import { useLocales } from "../../locales";
import { useAuth } from "../../contexts";
import { colors, radius, space } from "../../constants/theme";

type Mode = "choose" | "backup" | "restore" | "pass";

export default function Welcome() {
  const { t, toggle } = useLocales();
  const { vault, setIdentity } = useAuth();
  const [mode, setMode] = useState<Mode>("choose");
  const [draft, setDraft] = useState<Identity | null>(null);
  const [phrase, setPhrase] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    await vault.persist(draft, pass);
    setIdentity(draft);
    router.replace("/chats");
  }

  return (
    <Screen>
      <Centered>
        <Brand size={48} />
        <Text variant="sub">{t("onboarding.tagline")}</Text>

        {mode === "choose" && (
          <>
            <Text variant="muted">{t("onboarding.chooseSub")}</Text>
            <Button
              title={t("onboarding.createAccount")}
              onPress={() => {
                setDraft(createIdentity());
                setMode("backup");
              }}
            />
            <Button variant="ghost" title={t("onboarding.restoreFromPhrase")} onPress={() => setMode("restore")} />
          </>
        )}

        {mode === "backup" && draft && (
          <>
            <Text variant="muted">{t("onboarding.backupSub")}</Text>
            <RNText style={s.mnemonic}>{draft.mnemonic}</RNText>
            <Text variant="muted">{t("onboarding.youAre", { name: draft.name })}</Text>
            <Button title={t("onboarding.savedContinue")} onPress={() => setMode("pass")} />
          </>
        )}

        {mode === "restore" && (
          <>
            <Text variant="muted">{t("onboarding.restoreSub")}</Text>
            <Input multiline placeholder={t("onboarding.phrasePlaceholder")} value={phrase} onChangeText={setPhrase} />
            {!!error && <Text variant="error">{error}</Text>}
            <Button title={t("common.continue")} onPress={doRestore} />
            <Button variant="ghost" title={t("common.back")} onPress={() => setMode("choose")} />
          </>
        )}

        {mode === "pass" && (
          <>
            <Text variant="muted">{t("onboarding.passSub")}</Text>
            <Input secureTextEntry placeholder={t("onboarding.passphrase")} value={pass} onChangeText={setPass} />
            <Input secureTextEntry placeholder={t("onboarding.confirmPassphrase")} value={confirm} onChangeText={setConfirm} />
            {!!error && <Text variant="error">{error}</Text>}
            <Button title={busy ? t("onboarding.encrypting") : t("onboarding.encryptContinue")} onPress={finish} busy={busy} />
          </>
        )}

        <Link title={t("settings.toggleLanguage")} onPress={toggle} />
      </Centered>
    </Screen>
  );
}

const s = StyleSheet.create({
  mnemonic: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 26,
    backgroundColor: colors.inset,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    textAlign: "center",
  },
});
