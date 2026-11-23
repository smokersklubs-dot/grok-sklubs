/**
 * « À toi » (backlog L139, web InboxView.tsx): the cards waiting for the owner across all their bots, newest first, in
 * tabs (all / approvals / questions / other). A plain approval is answered here with 👎 / 👍 (lib/inbox.ts quickAnswer);
 * « Ouvrir » goes to the bot's chat, where every card can be answered in full.
 */
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { Button, Chip, Empty, ErrorNote, Loading, Segmented, tap, text } from "../components/ui";
import { errText, useT } from "../i18n";
import { relTime } from "../lib/format";
import { countOf, decideRequest, inboxTitle, INBOX_TABS, inTab, quickAnswer, type InboxItem, type InboxTab } from "../lib/inbox";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import type { RootStack } from "./types";

/** The waiting cards, kept fresh every 20 s while the tab is open (also used for the tab's badge). */
export function useInbox() {
  const call = useStore((s) => s.call);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setItems((await call<{ items: InboxItem[] }>("GET", "/inbox")).items); setError(null); } catch (e) { setError(errText(e)); }
  }, [call]);
  useEffect(() => { void load(); const id = setInterval(() => void load(), 20_000); return () => clearInterval(id); }, [load]);
  return { items, error, load };
}

export function InboxScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const call = useStore((s) => s.call);
  const { items, error, load } = useInbox();
  const [tab, setTab] = useState<InboxTab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const decide = async (i: InboxItem, decision: "allow" | "deny") => {
    const req = decideRequest(i.card, decision);
    if (!req) return;
    tap();
    setBusy(`${i.botId}/${i.seq}`); setFailed(null);
    try { await call("POST", req.path, req.body); await load(); } catch (e) { setFailed(errText(e)); } finally { setBusy(null); }
  };
  const shown = items ? inTab(items, tab) : null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text accessibilityRole="header" style={[text.h1, { color: c.text }]}>{t("inbox.title")}</Text>
        <Text style={{ color: c.text2, fontSize: 14 }}>{t("inbox.lead")}</Text>
        <Segmented label={t("inbox.title")} value={tab} onChange={setTab} options={INBOX_TABS.map((k) => ({ id: k, label: items && countOf(items, k) ? `${t(`inbox.tab.${k}`)} (${countOf(items, k)})` : t(`inbox.tab.${k}`) }))} />
        <ErrorNote>{error ?? failed}</ErrorNote>
      </View>
      {!shown ? (error ? null : <Loading />) : (
        <FlatList
          data={shown}
          keyExtractor={(i) => `${i.botId}/${i.seq}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[c.brand]} tintColor={c.text2} />}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={<Empty icon="check" title={t("inbox.emptyTitle")} text={t("inbox.empty")} />}
          renderItem={({ item: i }) => {
            const key = `${i.botId}/${i.seq}`;
            const title = inboxTitle(i.card) || t("inbox.untitled");
            const irreversible = i.card.type === "approval" && i.card.irreversible;
            return (
              <View style={[styles.item, { backgroundColor: c.surface, borderColor: irreversible ? c.warn : c.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text numberOfLines={1} style={{ color: c.text, fontWeight: "700", fontSize: 14, flexShrink: 1 }}>{i.botName}</Text>
                  <Text style={{ color: c.text3, fontSize: 13 }}>· {relTime(i.createdAt, t.locale)}</Text>
                  <View style={{ flex: 1 }} />
                  <Chip label={t(`inbox.kind.${i.kind}`)} tone={i.kind === "approval" ? "warn" : i.kind === "question" ? "info" : "neutral"} />
                </View>
                <Text style={{ color: c.text, fontSize: 15 }}>{title}</Text>
                {irreversible ? <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Icon name="alert" size={15} color={c.warn} /><Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>{t("approval.irreversible")}</Text></View> : null}
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Button small variant="ghost" label={t("inbox.open")} onPress={() => { tap(); nav.navigate("Chat", { botId: i.botId }); }} />
                  <View style={{ flex: 1 }} />
                  {quickAnswer(i.card) ? (
                    <>
                      <Button small variant="ghost" label={`👎 ${t("approval.deny")}`} accessibilityLabel={t("inbox.deny", { title })} disabled={busy === key} onPress={() => void decide(i, "deny")} />
                      <Button small variant="primary" label={`👍 ${t("approval.allow")}`} accessibilityLabel={t("inbox.allow", { title })} busy={busy === key} disabled={busy === key} onPress={() => void decide(i, "allow")} />
                    </>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  item: { gap: 8, padding: 14, borderRadius: 14, borderWidth: 1 },
});
