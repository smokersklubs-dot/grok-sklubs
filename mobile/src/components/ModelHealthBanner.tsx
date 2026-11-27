/**
 * Model health above the composer (nod item 4, L60; server modelhealth.ts, same as the web's ModelHealth.tsx). Shown
 * only when the bot's model does not answer: the reason in plain words, and the button that fixes it. A refused key
 * reads "à reconnecter"; model settings live in the web app, opened in the in-app browser.
 */
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Bot } from "../api/types";
import { useT } from "../i18n";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Button } from "./ui";

interface ModelHealth { label: string; status: "ok" | "reconnect" | "no_credit" | "down" | "none" | "skipped"; reason: string | null; fix: "models" | "subscription" | "bot" | null }
const BAD = new Set(["reconnect", "no_credit", "down", "none"]);

export function ModelHealthBanner({ bot }: { bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const origin = useStore((s) => s.origin);
  const [health, setHealth] = useState<ModelHealth | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (bot.kind !== "agent" || bot.access) return;
    let live = true;
    setBusy(true);
    useStore.getState().call<{ health: ModelHealth }>("GET", `/bots/${encodeURIComponent(bot.id)}/model-health${nonce ? "?fresh=1" : ""}`)
      .then((r) => { if (live) setHealth(r.health); }, () => { if (live) setHealth(null); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [bot.id, bot.model, bot.kind, bot.access, nonce]);
  if (!health || !BAD.has(health.status)) return null;
  const reconnect = health.status === "reconnect";
  return (
    <View style={[styles.box, { backgroundColor: reconnect || health.status === "none" ? c.dangerSoft : c.warnSoft, borderColor: c.border }]} accessibilityRole="alert">
      <View style={styles.head}>
        <Icon name="alert" size={16} color={reconnect ? c.danger : c.warn} />
        <Text style={[styles.title, { color: c.text }]}>{t(reconnect ? "modelHealth.toReconnect" : health.status === "no_credit" ? "modelHealth.noCredit" : "modelHealth.notAnswering", { model: health.label })}</Text>
      </View>
      {health.reason ? <Text style={{ color: c.text2, fontSize: 13 }}>{health.reason}</Text> : null}
      <View style={styles.actions}>
        {health.fix && origin ? <Button small label={t(reconnect ? "modelHealth.reconnect" : health.fix === "subscription" ? "modelHealth.addCredit" : "modelHealth.openModels")} onPress={() => void WebBrowser.openBrowserAsync(origin)} /> : null}
        <Button small variant="ghost" busy={busy} label={t("modelHealth.retry")} onPress={() => setNonce((n) => n + 1)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 10, marginBottom: 8, padding: 10, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontWeight: "600", flex: 1 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
});
