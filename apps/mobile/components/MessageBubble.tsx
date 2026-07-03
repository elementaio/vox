import { StyleSheet, Text, View } from "react-native";
import type { StoredMessage } from "@elementaio/vox-sdk";
import { colors } from "../constants/theme";
import { useLocales } from "../locales";

export function MessageBubble({ msg }: { msg: StoredMessage }) {
  const { t } = useLocales();
  return (
    <View style={[s.bubble, msg.mine ? s.mine : s.theirs]}>
      <Text style={s.text}>{msg.deleted ? `🚫 ${t("chat.deleted")}` : msg.text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: "80%", paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, marginVertical: 2 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.sent, borderBottomRightRadius: 5 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.recv, borderBottomLeftRadius: 5 },
  text: { color: "#fff", fontSize: 15, lineHeight: 20 },
});
