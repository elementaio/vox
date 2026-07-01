import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, space } from "../theme";

export default function TopBar({
  title,
  status,
  left,
}: {
  title: string;
  status?: string;
  left?: ReactNode;
}) {
  return (
    <View style={s.bar}>
      <View style={s.side}>{left}</View>
      <Text style={s.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={s.side}>{!!status && <Text style={s.status}>{status}</Text>}</View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  side: { flex: 1 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700", flex: 2, textAlign: "center" },
  status: { color: colors.muted, fontSize: 12, textAlign: "right" },
});
