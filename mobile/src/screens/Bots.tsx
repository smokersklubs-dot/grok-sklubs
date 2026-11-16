import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Bot } from "../api/types";
import { Character, stateOf } from "../components/Character";
import { Icon } from "../components/Icon";
import { RelayOffBanner } from "../components/RelayOffBanner";
import { Empty, ErrorNote, Loading, tap, text } from "../components/ui";
import { useT } from "../i18n";
import { listTime } from "../lib/format";
import { firstWords, sortBots } from "../state/reducers";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import type { RootStack } from "./types";

function BotRow({ bot, onPress }: { bot: Bot; onPress: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const live = useStore((s) => s.live[bot.id]);
  const waiting = !!live?.awaiting;
  const working = !!live?.running;
  const preview = waiting ? `${t("bots.status.attention")} · ${live!.awaiting!.reason}` : working ? t("bots.status.working") : bot.preview ? firstWords(bot.preview, 90) : t("bots.noMessages");
  const label = [bot.name, bot.label, bot.unread ? t.n("bots.unread", bot.unread) : "", waiting ? t("bots.status.attention") : working ? t("bots.status.working") : "", preview].filter(Boolean).join(", ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surface2 : c.surface }]}>
      <Character bot={bot} size={46} state={stateOf(live)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>{bot.name}</Text>
          {bot.primary ? <Icon name="star" size={13} color={c.warn} /> : null}
          <View style={{ flex: 1 }} />
          <Text style={{ color: bot.unread ? c.text : c.text3, fontSize: 12 }}>{listTime(bot.lastActivityAt, t.locale)}</Text>
        </View>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={{ color: waiting ? c.warn : c.text2, fontSize: 14, flex: 1, fontWeight: bot.unread ? "600" : "400" }}>{preview}</Text>
          {bot.unread ? <View style={[styles.badge, { backgroundColor: c.brand }]}><Text style={styles.badgeText}>{bot.unread > 99 ? "99+" : bot.unread}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function BotsScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const bots = useStore((s) => s.bots);
  const error = useStore((s) => s.botsError);
  const online = useStore((s) => s.online);
  const [refreshing, setRefreshing] = useState(false);
  const loaded = Object.keys(bots).length > 0 || error !== null;
  const sections = useMemo(() => {
    const g = sortBots(Object.values(bots));
    return [
      { key: "team", title: t("bots.team"), data: g.team },
      { key: "rooms", title: t("bots.rooms"), data: g.rooms },
      { key: "shared", title: t("bots.shared"), data: g.shared },
    ].filter((s) => s.data.length);
  }, [bots, t]);
  const refresh = async () => {
    setRefreshing(true);
    await useStore.getState().loadBots();
    setRefreshing(false);
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text accessibilityRole="header" style={[text.h1, { color: c.text }]}>{t("bots.title")}</Text>
        {!online ? <View style={styles.offline}><Icon name="wifiOff" size={16} color={c.warn} /><Text style={{ color: c.warn, fontSize: 13 }}>{t("api.offline")}</Text></View> : null}
      </View>
      <RelayOffBanner />
      {error && !Object.keys(bots).length ? <View style={{ padding: 16 }}><ErrorNote>{error}</ErrorNote></View> : null}
      {!loaded ? <Loading /> : (
        <SectionList
          sections={sections}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text2} colors={[c.brand]} />}
          renderSectionHeader={({ section }) => sections.length > 1 ? <Text style={[styles.section, { color: c.text3, backgroundColor: c.bg }]}>{section.title}</Text> : null}
          renderItem={({ item }) => <BotRow bot={item} onPress={() => nav.navigate("Chat", { botId: item.id })} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 74 }} />}
          ListEmptyComponent={<Empty icon="bots" text={t("bots.empty")} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingBottom: 10, gap: 6 },
  offline: { flexDirection: "row", alignItems: "center", gap: 6 },
  section: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 72 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
