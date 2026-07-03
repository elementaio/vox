import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text as RNText, TextInput, View } from "react-native";
import { router } from "expo-router";
import { parseInvite } from "@elementaio/vox-sdk";
import { Brand, Button, Centered, ContactRow, Input, Link, Screen, Text } from "../../components";
import { useLocales } from "../../locales";
import { useAuth, useMessenger } from "../../contexts";
import { colors, radius, space } from "../../constants/theme";

const normalize = (v: string) => {
  let s = v.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  return s;
};

export default function Chats() {
  const { t } = useLocales();
  const { signOut } = useAuth();
  const m = useMessenger();
  const [url, setUrl] = useState("");
  const [invite, setInvite] = useState("");

  const doSignOut = () => {
    signOut();
    router.replace("/");
  };

  // First run for this account: pick which relay to connect to.
  if (!m.relay) {
    return (
      <Screen>
        <Centered>
          <Brand size={44} />
          <Text variant="title">{t("chat.connectRelay")}</Text>
          <Text variant="muted">{t("chat.relayHint")}</Text>
          <Input
            autoCapitalize="none"
            keyboardType="url"
            placeholder={t("chat.relayPlaceholder")}
            value={url}
            onChangeText={setUrl}
          />
          <Button title={t("chat.connect")} onPress={() => url.trim() && m.setRelay(normalize(url))} />
          <Link title={t("common.signOut")} onPress={doSignOut} />
        </Centered>
      </Screen>
    );
  }

  const add = () => {
    const c = parseInvite(invite.trim());
    if (c) {
      void m.addContact(c);
      setInvite("");
    }
  };

  return (
    <Screen>
      <View style={s.bar}>
        <RNText style={s.title}>{t("chat.title")}</RNText>
        <RNText style={s.status}>{m.status}</RNText>
      </View>
      <View style={s.addRow}>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          placeholder={t("chat.addContactPlaceholder")}
          placeholderTextColor={colors.muted}
          value={invite}
          onChangeText={setInvite}
        />
        <Pressable style={s.addBtn} onPress={add}>
          <RNText style={s.addText}>{t("chat.add")}</RNText>
        </Pressable>
      </View>
      <FlatList
        data={m.contacts}
        keyExtractor={(c) => c.pubkey}
        ListEmptyComponent={<Text variant="muted">{t("chat.noContacts")}</Text>}
        renderItem={({ item }) => (
          <ContactRow contact={item} onPress={() => router.push(`/chat/${item.pubkey}`)} />
        )}
      />
      <Link title={t("common.signOut")} onPress={doSignOut} />
    </Screen>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  status: { color: colors.muted, fontSize: 12 },
  addRow: { flexDirection: "row", gap: space.sm, padding: space.md, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.inset, color: colors.text, borderRadius: radius.full, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line },
  addBtn: { backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 20, height: 44, justifyContent: "center" },
  addText: { color: "#fff", fontWeight: "700" },
});
