import { memo, useMemo } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown";
import { useTheme, type Colors } from "../theme";

function inlines(nodes: Inline[], c: Colors, base: TextStyle, key = ""): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text": return n.v;
      case "b": return <Text key={k} style={{ fontWeight: "700" }}>{inlines(n.c, c, base, k)}</Text>;
      case "i": return <Text key={k} style={{ fontStyle: "italic" }}>{inlines(n.c, c, base, k)}</Text>;
      case "s": return <Text key={k} style={{ textDecorationLine: "line-through" }}>{inlines(n.c, c, base, k)}</Text>;
      case "code": return <Text key={k} style={[styles.inlineCode, { backgroundColor: c.surface3, color: base.color }]}>{n.v}</Text>;
      case "link":
        return (
          <Text key={k} accessibilityRole="link" style={{ color: c.info, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(n.href)}>
            {inlines(n.c, c, base, k)}
          </Text>
        );
    }
  });
}

function BlockView({ b, c, base }: { b: Block; c: Colors; base: TextStyle }) {
  switch (b.t) {
    case "p": return <Text selectable style={base}>{inlines(b.c, c, base)}</Text>;
    case "h": return <Text accessibilityRole="header" style={[base, { fontWeight: "700", fontSize: b.level <= 1 ? 20 : b.level === 2 ? 18 : 16, marginTop: 4 }]}>{inlines(b.c, c, base)}</Text>;
    case "hr": return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong, marginVertical: 4 }} />;
    case "code":
      return (
        <ScrollView horizontal style={[styles.code, { backgroundColor: c.surface2, borderColor: c.border }]} contentContainerStyle={{ padding: 10 }}>
          <Text selectable style={[styles.mono, { color: c.text }]}>{b.v}</Text>
        </ScrollView>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderColor: c.borderStrong }]}>
          {b.c.map((x, i) => <BlockView key={i} b={x} c={c} base={{ ...base, color: c.text2 }} />)}
        </View>
      );
    case "list":
      return (
        <View style={{ gap: 4 }}>
          {b.items.map((it, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={[base, { minWidth: 18, textAlign: "right" }]}>{it.checked !== null ? (it.checked ? "☑" : "☐") : b.ordered ? `${b.start + i}.` : "•"}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text selectable style={base}>{inlines(it.c, c, base)}</Text>
                {it.sub.map((x, j) => <BlockView key={j} b={x} c={c} base={base} />)}
              </View>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <ScrollView horizontal style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
          <View>
            {[b.head, ...b.rows].map((r, ri) => (
              <View key={ri} style={{ flexDirection: "row", backgroundColor: ri === 0 ? c.surface2 : "transparent", borderTopWidth: ri ? StyleSheet.hairlineWidth : 0, borderColor: c.border }}>
                {r.map((cell, ci) => (
                  <Text key={ci} selectable style={[base, { width: 140, padding: 8, fontWeight: ri === 0 ? "700" : "400", fontSize: 14 }]}>{inlines(cell, c, base)}</Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
  }
}

export const Markdown = memo(function Markdown({ text, color }: { text: string; color?: string }) {
  const { c } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const base: TextStyle = { color: color ?? c.text, fontSize: 16, lineHeight: 23 };
  return <View style={{ gap: 8 }}>{blocks.map((b, i) => <BlockView key={i} b={b} c={c} base={base} />)}</View>;
});

const styles = StyleSheet.create({
  inlineCode: { fontFamily: "monospace", fontSize: 14 },
  mono: { fontFamily: "monospace", fontSize: 13, lineHeight: 19 },
  code: { borderWidth: 1, borderRadius: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, gap: 6 },
});
