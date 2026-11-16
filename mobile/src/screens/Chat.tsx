import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardView } from "../components/Cards";
import { ActivityLine, DayDivider, EventRow, MessageBubble, NoticeRow, StepGroup } from "../components/Chat";
import { Character, stateOf } from "../components/Character";
import { Composer } from "../components/Composer";
import { Icon } from "../components/Icon";
import { Button, Empty, ErrorNote, Loading, tap } from "../components/ui";
import { useT } from "../i18n";
import { buildItems, type Item } from "../state/items";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import type { RootStack } from "./types";

export function ChatScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { botId } = useRoute<RouteProp<RootStack, "Chat">>().params;
  const bot = useStore((s) => s.bots[botId]);
  const live = useStore((s) => s.live[botId]);
  const thread = useStore((s) => s.threads[botId]);
  const user = useStore((s) => s.user);

  useFocusEffect(useCallback(() => {
    const s = useStore.getState();
    s.setOpenBot(botId);
    void s.loadRows(botId, true);
    void s.loadBundle(botId);
    if (s.bots[botId]?.unread) void s.markRead(botId);
    return () => { if (useStore.getState().openBotId === botId) useStore.getState().setOpenBot(null); };
  }, [botId]));
  useEffect(() => { if (bot?.unread && useStore.getState().openBotId === botId) void useStore.getState().markRead(botId); }, [bot?.unread, botId]);

  const items = useMemo(() => buildItems(thread?.rows ?? [], !!live?.running, bot?.access ? user?.id : undefined).reverse(), [thread?.rows, live?.running, bot?.access, user?.id]);

  if (!bot) return <View style={{ flex: 1, backgroundColor: c.bg }}><Empty icon="bots" text={t("common.removedBot")} action={<Button label={t("common.back")} onPress={() => nav.goBack()} />} /></View>;

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.t) {
      case "day": return <DayDivider at={item.at} />;
      case "msg": return <MessageBubble bot={bot} row={item.row} body={item.body} mine={item.mine} first={item.first} />;
      case "steps": return <StepGroup rows={item.rows} live={item.live} />;
      case "row": {
        const b = item.row.body;
        if (b.kind === "card") return <CardView card={b.card} bot={bot} seq={item.row.seq} />;
        if (b.kind === "notice") return <NoticeRow body={b} botId={bot.id} seq={item.row.seq} />;
        if (b.kind === "event") return <EventRow body={b} />;
        return null;
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: c.surface, borderColor: c.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => nav.goBack()} hitSlop={8} style={styles.headerBtn}>
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${bot.name}, ${t("chat.details")}`} onPress={() => { tap(); nav.navigate("Details", { botId }); }} style={styles.headerMain}>
          <Character bot={bot} size={36} state={stateOf(live)} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 17, fontWeight: "600" }}>{bot.name}</Text>
            <Text numberOfLines={1} style={{ color: live?.awaiting ? c.warn : c.text3, fontSize: 13 }}>{live?.awaiting ? t("bots.status.attention") : live?.running ? t("bots.status.working") : bot.label}</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("chat.details")} onPress={() => { tap(); nav.navigate("Details", { botId }); }} hitSlop={8} style={styles.headerBtn}>
          <Icon name="info" size={22} color={c.text2} />
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {!thread?.loaded && thread?.error ? (
          <View style={{ padding: 16, gap: 12 }}><ErrorNote>{thread.error}</ErrorNote><Button variant="ghost" label={t("common.tryAgain")} onPress={() => void useStore.getState().loadRows(botId, true)} /></View>
        ) : !thread?.loaded ? <View style={{ flex: 1 }}><Loading /></View> : items.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
              <Character bot={bot} size={88} state={stateOf(live)} />
              <Text style={{ color: c.text, fontSize: 20, fontWeight: "700" }}>{bot.name}</Text>
              <Text style={{ color: c.text2, textAlign: "center", lineHeight: 21, fontSize: 15 }}>{bot.description || t(bot.kind === "room" ? "chat.emptyRoom" : "chat.empty")}</Text>
            </View>
            <ActivityLine live={live} />
          </View>
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderItem}
            onEndReached={() => void useStore.getState().loadEarlier(botId)}
            onEndReachedThreshold={0.3}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
            ListHeaderComponent={<ActivityLine live={live} />}
            ListFooterComponent={thread.loadingEarlier ? <ActivityIndicator style={{ margin: 12 }} color={c.text3} /> : undefined}
          />
        )}
        <View style={{ paddingBottom: insets.bottom }}>
          <Composer bot={bot} live={live} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
});
