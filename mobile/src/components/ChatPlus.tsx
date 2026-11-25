/**
 * L184 on the phone — the same features as the web app (web/src/components/ChatPlus.tsx), same server routes:
 *  - LinkPreview: under a message, the title and description of its first web address, read by the SERVER
 *    (GET /link-preview, server linkpreview.ts: no picture, private addresses refused); a tap opens it in the browser.
 *  - QuoteButton / quoteMessage: « Citer » puts the message's words as a Markdown quote at the top of the draft
 *    (shared/chatPlus.ts replyDraft, as the web's « Répondre »); a long press on a bubble does the same.
 *  - PinButton: a view drawn in the chat pinned to the dashboard (POST /bots/:id/cards/:seq/pin, server dashboardpins.ts).
 *  - PinnedDashboard: the pins, newest view with the same title each, moved up / down or unpinned (GET/POST/DELETE
 *    /dashboard/pins); a view is shown in its plain-text form (the phone does not draw charts), like in the chat.
 *  - UsageMetrics: the account's numbers (GET /usage-metrics, server metrics.ts).
 */
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { firstLink } from "../../shared/chatPlus";
import { errText, useT } from "../i18n";
import { dash, fetchPreview, metricTiles, quoteMessage, type Metrics, type Pin, type Preview } from "../lib/chatPlus";
import { relTime } from "../lib/format";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Button, ErrorNote, tap } from "./ui";


/* ---------- Quote ---------- */

export { draftWithQuote, quoteMessage, useQuote } from "../lib/chatPlus";

export function QuoteButton({ botId, text }: { botId: string; text: string }) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("quote.label")} hitSlop={6} onPress={() => { tap(); quoteMessage(botId, text); }} style={[styles.pill, { borderColor: c.border }]}>
      <Icon name="quote" size={16} color={c.text2} />
      <Text style={{ color: c.text2, fontSize: 13, fontWeight: "600" }}>{t("quote.button")}</Text>
    </Pressable>
  );
}

/* ---------- Link preview ---------- */

export function LinkPreview({ text, mine }: { text: string; mine: boolean }) {
  const { c } = useTheme();
  const url = firstLink(text);
  const [p, setP] = useState<Preview | null>(null);
  useEffect(() => {
    if (!url) { setP(null); return; }
    let live = true;
    void fetchPreview(useStore.getState().call, url).then((v) => { if (live) setP(v); });
    return () => { live = false; };
  }, [url]);
  if (!p) return null;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${p.title}, ${p.siteName}`} onPress={() => { tap(); void WebBrowser.openBrowserAsync(p.url); }}
      style={[styles.preview, { borderColor: c.border, backgroundColor: c.surface2 }, mine && { alignSelf: "flex-end" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon name="globe" size={12} color={c.text3} />
        <Text numberOfLines={1} style={{ color: c.text3, fontSize: 12, flex: 1 }}>{p.siteName}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: c.text, fontSize: 14, fontWeight: "600" }}>{p.title}</Text>
      {p.description ? <Text numberOfLines={3} style={{ color: c.text2, fontSize: 13, lineHeight: 18 }}>{p.description}</Text> : null}
    </Pressable>
  );
}

/* ---------- Pinned dashboard ---------- */

export function PinButton({ botId, seq }: { botId: string; seq: number }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: 6 }}>
      <Button small variant="ghost" icon="pin" label={t(state === "done" ? "dash.pinnedShort" : "dash.pin")} busy={state === "busy"} disabled={state !== "idle"}
        onPress={async () => { setState("busy"); setError(null); try { await dash.pin(useStore.getState().call, botId, seq); setState("done"); } catch (e) { setError(errText(e)); setState("idle"); } }} />
      <ErrorNote>{error}</ErrorNote>
    </View>
  );
}

export function PinnedDashboard() {
  const { c } = useTheme();
  const t = useT();
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = useStore.getState().call;
  useEffect(() => { dash.list(call).then(setPins, (e) => { setError(errText(e)); setPins([]); }); }, [call]);
  const act = async (fn: () => Promise<Pin[]>) => {
    setError(null);
    try { setPins(await fn()); } catch (e) { setError(errText(e)); }
  };
  if (pins === null) return null;
  return (
    <View style={{ gap: 10 }}>
      <ErrorNote>{error}</ErrorNote>
      {!pins.length ? <Text style={{ color: c.text2, fontSize: 15, lineHeight: 21 }}>{t("dash.empty")}</Text> : null}
      {pins.map((p, i) => (
        <View key={p.id} style={[styles.pinCard, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityLabel={p.title}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="chart" size={18} color={c.text2} />
            <Text style={{ color: c.text, fontSize: 16, fontWeight: "600", flex: 1 }} numberOfLines={2}>{p.title}</Text>
          </View>
          <Text style={{ color: c.text3, fontSize: 12 }}>{t("dash.from", { bot: p.botName, when: relTime(p.updatedAt, t.locale) })}</Text>
          {p.card ? <Text selectable style={[styles.fallback, { backgroundColor: c.surface2, color: c.text }]}>{p.card.fallback}</Text> : <Text style={{ color: c.text2, fontSize: 14 }}>{t("dash.gone", { title: p.title })}</Text>}
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {i > 0 ? <ToolButton icon="up" label={t("dash.up", { title: p.title })} onPress={() => void act(() => dash.move(call, p.id, -1))} /> : null}
            {i < pins.length - 1 ? <ToolButton icon="down" label={t("dash.down", { title: p.title })} onPress={() => void act(() => dash.move(call, p.id, 1))} /> : null}
            <ToolButton icon="close" label={t("dash.unpin", { title: p.title })} onPress={() => void act(() => dash.unpin(call, p.id))} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ToolButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} onPress={() => { tap(); onPress(); }} style={[styles.tool, { borderColor: c.border }]}>
      <Icon name={icon} size={18} color={c.text2} />
    </Pressable>
  );
}

/* ---------- Metrics ---------- */

export function UsageMetrics() {
  const { c } = useTheme();
  const t = useT();
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { useStore.getState().call<{ metrics: Metrics }>("GET", "/usage-metrics").then((r) => setM(r.metrics), (e) => setError(errText(e))); }, []);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!m) return null;
  const n = (v: number) => v.toLocaleString(t.locale === "fr" ? "fr-FR" : "en-US");
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tiles}>
        {metricTiles(m, n, t).map(([k, v, sub]) => (
          <View key={k} style={[styles.tile, { backgroundColor: c.surface, borderColor: c.border }]} accessible accessibilityLabel={`${t(k)} : ${v}${sub ? `, ${sub}` : ""}`}>
            <Text style={{ color: c.text3, fontSize: 12, fontWeight: "600" }}>{t(k)}</Text>
            <Text style={{ color: c.text, fontSize: 20, fontWeight: "700" }} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
            {sub ? <Text style={{ color: c.text3, fontSize: 12 }} numberOfLines={2}>{sub}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={{ color: c.text3, fontSize: 13, lineHeight: 18 }}>{t("metrics.hint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 12, marginTop: 4, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  preview: { maxWidth: "88%", marginTop: 4, padding: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 3 },
  pinCard: { padding: 14, borderRadius: radius.lg, borderWidth: 1, gap: 8 },
  fallback: { fontFamily: "monospace", fontSize: 13, padding: 10, borderRadius: radius.sm, lineHeight: 18 },
  tool: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexBasis: "47%", flexGrow: 1, padding: 12, borderRadius: radius.md, borderWidth: 1, gap: 2 },
});
