import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors, radius, space } from "./theme";

/** Atomic UI primitives — every screen composes these, so no screen restyles from scratch. */

export function Screen({ children }: { children: ReactNode }) {
  return <View style={s.screen}>{children}</View>;
}

export function Centered({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={s.centered} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Brand() {
  return <Text style={s.brand}>📮 Pochta</Text>;
}
export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}
export function Sub({ children }: { children: ReactNode }) {
  return <Text style={s.sub}>{children}</Text>;
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={s.error}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable style={[s.btn, (disabled || busy) && s.btnOff]} onPress={onPress} disabled={disabled || busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.muted} style={s.input} {...props} />;
}

export function Link({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text style={s.link}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.md },
  brand: { color: "#fff", fontSize: 34, fontWeight: "800", textAlign: "center" },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center" },
  sub: { color: colors.muted, fontSize: 16, textAlign: "center", marginBottom: space.sm },
  label: { color: colors.text, fontSize: 14, marginTop: space.sm },
  muted: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  error: { color: colors.accent2, textAlign: "center" },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center" },
  btnOff: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  input: { backgroundColor: colors.panel, color: colors.text, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.line },
  link: { color: colors.muted, textAlign: "center", padding: space.md },
});
