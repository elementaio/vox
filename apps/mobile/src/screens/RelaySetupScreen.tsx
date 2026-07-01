import { useState } from "react";
import { Brand, Button, Centered, Input, Link, Muted, Screen, Title } from "../ui";
import { useI18n } from "../i18n";

const normalize = (v: string) => {
  let s = v.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  return s;
};

export default function RelaySetupScreen({
  onSet,
  onSignOut,
}: {
  onSet: (relay: string) => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  return (
    <Screen>
      <Centered>
        <Brand />
        <Title>{t("connectRelay")}</Title>
        <Muted>{t("relayHint")}</Muted>
        <Input
          autoCapitalize="none"
          keyboardType="url"
          placeholder={t("relayPlaceholder")}
          value={url}
          onChangeText={setUrl}
        />
        <Button title={t("connect")} onPress={() => url.trim() && onSet(normalize(url))} />
        <Link title={t("signOut")} onPress={onSignOut} />
      </Centered>
    </Screen>
  );
}
