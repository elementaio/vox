import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../theme";
import { useI18n } from "../i18n";

export default function Composer({ onSend }: { onSend: (text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const send = () => {
    const v = text.trim();
    if (v) {
      onSend(v);
      setText("");
    }
  };
  return (
    <View style={s.row}>
      <TextInput
        style={s.input}
        placeholder={t("message")}
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
      />
      <Pressable style={s.btn} onPress={send}>
        <Text style={s.btnText}>{t("send")}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, backgroundColor: colors.panel, color: colors.text, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 18, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
