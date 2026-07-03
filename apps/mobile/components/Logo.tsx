import { StyleSheet, Text as RNText, View } from "react-native";
import { colors } from "../constants/theme";

/** The Vox mark: a five-bar voice waveform on a blue squircle (plain Views, no SVG dep). */
export function Logo({ size = 40 }: { size?: number }) {
  const bars = [0.4, 0.7, 1, 0.65, 0.46];
  return (
    <View style={[s.box, { width: size, height: size, borderRadius: size * 0.29 }]}>
      <View style={[s.bars, { height: size * 0.46 }]}>
        {bars.map((h, i) => (
          <View key={i} style={[s.bar, { height: `${h * 100}%` }]} />
        ))}
      </View>
    </View>
  );
}

/** Logo + wordmark, centered — the onboarding / connect header. */
export function Brand({ size = 40 }: { size?: number }) {
  return (
    <View style={s.brand}>
      <Logo size={size} />
      <RNText style={s.word}>Vox</RNText>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  bars: { flexDirection: "row", alignItems: "center", gap: 2.5 },
  bar: { width: 3, borderRadius: 2, backgroundColor: "#fff" },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 11 },
  word: { color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
});
