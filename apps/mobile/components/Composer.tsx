import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../constants/theme";
import { useLocales } from "../locales";

export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const { t } = useLocales();
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
        placeholder={t("chat.message")}
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
      />
      <Pressable style={s.btn} onPress={send}>
        <Text style={s.btnText}>{t("chat.send")}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.line, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.inset, color: colors.text, borderRadius: radius.full, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line },
  btn: { backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 20, height: 44, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
});
