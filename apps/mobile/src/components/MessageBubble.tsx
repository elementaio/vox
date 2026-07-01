import { StyleSheet, Text, View } from "react-native";
import type { StoredMessage } from "@pochta-chat/sdk";
import { colors, radius } from "../theme";
import { useI18n } from "../i18n";

export default function MessageBubble({ msg }: { msg: StoredMessage }) {
  const { t } = useI18n();
  return (
    <View style={[s.bubble, msg.mine ? s.mine : s.theirs]}>
      <Text style={s.text}>{msg.deleted ? `🚫 ${t("deleted")}` : msg.text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: "80%", padding: 10, borderRadius: radius.md },
  mine: { alignSelf: "flex-end", backgroundColor: colors.accent },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.panel },
  text: { color: "#fff", fontSize: 15 },
});
