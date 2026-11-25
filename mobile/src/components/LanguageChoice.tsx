/**
 * The language picker (Welcome, Settings): every language with a dictionary (src/i18n/index.ts LANGUAGES). Up to three
 * fit one segmented row; more wrap as pills so long names never get cut at 390 px.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LANGUAGES, type Locale } from "../i18n";
import { useTheme } from "../theme";
import { Segmented } from "./ui";

export function LanguageChoice({ value, onChange, label }: { value: Locale; onChange: (l: Locale) => void; label: string }) {
  const { c } = useTheme();
  if (LANGUAGES.length <= 3) return <Segmented<Locale> label={label} value={value} options={LANGUAGES} onChange={onChange} />;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.wrap}>
      {LANGUAGES.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.id)}
            style={[styles.pill, { backgroundColor: on ? c.surface : c.surface3, borderColor: on ? c.text2 : "transparent" }]}>
            <Text style={{ color: on ? c.text : c.text2, fontWeight: on ? "600" : "500", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, justifyContent: "center" },
});
