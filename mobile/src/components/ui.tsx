import * as Haptics from "expo-haptics";
import React, { forwardRef, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";

export const tap = () => { if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined); };

type Variant = "primary" | "accent" | "ghost" | "danger" | "plain";
export function Button({ label, onPress, variant = "primary", busy, disabled, icon, style, small, accessibilityLabel, color }: {
  label: string; onPress?: () => void; variant?: Variant; busy?: boolean; disabled?: boolean; icon?: string; style?: StyleProp<ViewStyle>; small?: boolean; accessibilityLabel?: string; color?: string;
}) {
  const { c } = useTheme();
  const bg = variant === "primary" ? c.ink : variant === "accent" ? color ?? c.brand : variant === "danger" ? c.danger : "transparent";
  const fg = variant === "primary" ? c.inkFg : variant === "accent" || variant === "danger" ? "#fff" : variant === "plain" ? c.text : c.text;
  const border = variant === "ghost" ? c.borderStrong : "transparent";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => { tap(); onPress?.(); }}
      style={({ pressed }) => [styles.btn, small && styles.btnSmall, { backgroundColor: bg, borderColor: border, opacity: off ? 0.55 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export const Field = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { label: string; hint?: string; error?: boolean }>(function Field({ label, hint, error, style, ...rest }, ref) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.text2 }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.text3}
        accessibilityLabel={label}
        style={[styles.input, { backgroundColor: c.surface, borderColor: error ? c.danger : c.border, color: c.text }, style]}
        {...rest}
      />
      {hint ? <Text style={[styles.hint, { color: c.text3 }]}>{hint}</Text> : null}
    </View>
  );
});

export function ErrorNote({ children }: { children?: string | null }) {
  const { c } = useTheme();
  if (!children) return null;
  return (
    <View accessibilityRole="alert" style={[styles.note, { backgroundColor: c.dangerSoft }]}>
      <Icon name="alert" size={16} color={c.danger} />
      <Text style={{ color: c.danger, flex: 1, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.sectionHead}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.text2 }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Empty({ icon = "info", title, text, action }: { icon?: string; title?: string; text?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.surface2 }]}><Icon name={icon} size={26} color={c.text3} /></View>
      {title ? <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text> : null}
      {text ? <Text style={[styles.emptyText, { color: c.text2 }]}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.empty} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={c.text2} />
      {label ? <Text style={{ color: c.text3, marginTop: 8 }}>{label}</Text> : null}
    </View>
  );
}

export function Chip({ label, tone = "neutral", style }: { label: string; tone?: "neutral" | "ok" | "warn" | "info" | "danger"; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const map = { neutral: [c.surface3, c.text2], ok: [c.okSoft, c.ok], warn: [c.warnSoft, c.warn], info: [c.infoSoft, c.info], danger: [c.dangerSoft, c.danger] } as const;
  const [bg, fg] = map[tone];
  return <View style={[styles.chip, { backgroundColor: bg }, style]}><Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text></View>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.seg, { backgroundColor: c.surface3 }]}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { tap(); onChange(o.id); }} style={[styles.segItem, on && { backgroundColor: c.surface }]}>
            <Text numberOfLines={1} style={{ color: on ? c.text : c.text2, fontWeight: on ? "600" : "500", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ title, subtitle, onPress, right, icon, danger }: { title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; icon?: string; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} onPress={onPress ? () => { tap(); onPress(); } : undefined} style={({ pressed }) => [styles.row, { backgroundColor: pressed && onPress ? c.surface2 : "transparent" }]}>
      {icon ? <Icon name={icon} size={20} color={danger ? c.danger : c.text2} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? c.danger : c.text, fontSize: 16 }}>{title}</Text>
        {subtitle ? <Text style={{ color: c.text3, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color={c.text3} /> : null)}
    </Pressable>
  );
}

export const text = StyleSheet.create({
  h1: { fontSize: 28, fontWeight: "700", letterSpacing: -0.4 } as TextStyle,
  h2: { fontSize: 20, fontWeight: "700" } as TextStyle,
});

const styles = StyleSheet.create({
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  btnSmall: { minHeight: 40, paddingHorizontal: 14 },
  btnText: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  hint: { fontSize: 13, lineHeight: 18 },
  note: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radius.md, alignItems: "flex-start" },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 14 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  seg: { flexDirection: "row", borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.sm + 1, paddingHorizontal: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14, minHeight: 52 },
});
