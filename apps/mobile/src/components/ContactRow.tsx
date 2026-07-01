import { Pressable, StyleSheet, Text } from "react-native";
import type { StoredContact } from "@pochta-chat/sdk";
import { colors } from "../theme";

export default function ContactRow({
  contact,
  onPress,
}: {
  contact: StoredContact;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <Text style={s.name}>{contact.name}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#161a22" },
  name: { color: colors.text, fontSize: 16 },
});
