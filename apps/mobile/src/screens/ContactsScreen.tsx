import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { parseInvite, type StoredContact } from "@pochta-chat/sdk";
import ContactRow from "../components/ContactRow";
import TopBar from "../components/TopBar";
import { Link, Muted, Screen } from "../ui";
import { useI18n } from "../i18n";
import { colors, radius, space } from "../theme";

export default function ContactsScreen({
  contacts,
  status,
  onOpen,
  onAdd,
  onSignOut,
}: {
  contacts: StoredContact[];
  status: string;
  onOpen: (pubkey: string) => void;
  onAdd: (c: StoredContact) => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [invite, setInvite] = useState("");

  function add() {
    const c = parseInvite(invite.trim());
    if (c) {
      onAdd(c);
      setInvite("");
    }
  }

  return (
    <Screen>
      <View style={s.header}>
        <TopBar title="Pochta" status={status} />
      </View>
      <View style={s.addRow}>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          placeholder={t("addContactPlaceholder")}
          placeholderTextColor={colors.muted}
          value={invite}
          onChangeText={setInvite}
        />
        <Pressable style={s.btn} onPress={add}>
          <Text style={s.btnText}>{t("add")}</Text>
        </Pressable>
      </View>
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.pubkey}
        ListEmptyComponent={<Muted>{t("noContacts")}</Muted>}
        renderItem={({ item }) => <ContactRow contact={item} onPress={() => onOpen(item.pubkey)} />}
      />
      <Link title={t("signOut")} onPress={onSignOut} />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 48 },
  addRow: { flexDirection: "row", gap: space.sm, padding: space.md },
  input: { flex: 1, backgroundColor: colors.panel, color: colors.text, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 18, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
