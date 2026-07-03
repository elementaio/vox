import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StoredContact } from "@elementaio/vox-sdk";
import { colors } from "../constants/theme";

export function ContactRow({
  contact,
  onPress,
}: {
  contact: StoredContact;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={s.avatar}>
        <Text style={s.initial}>{(contact.name.trim()[0] || "?").toUpperCase()}</Text>
      </View>
      <Text style={s.name} numberOfLines={1}>
        {contact.name}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: "#fff", fontWeight: "700", fontSize: 18 },
  name: { color: colors.text, fontSize: 16, fontWeight: "600", flex: 1 },
});
