import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Task } from "../api/types";
import { Character } from "../components/Character";
import { Icon } from "../components/Icon";
import { Chip, Empty, Loading, Segmented, tap, text } from "../components/ui";
import { useT } from "../i18n";
import { relTime } from "../lib/format";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import type { RootStack } from "./types";

type Filter = "open" | "done" | "all";

export function sortTasks(tasks: Task[]): Task[] {
  const rank = (t: Task) => (t.state === "needs_input" ? 0 : t.state === "working" ? 1 : 2);
  return [...tasks].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

export function TasksScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const tasks = useStore((s) => s.tasks);
  const bots = useStore((s) => s.bots);
  const [filter, setFilter] = useState<Filter>("open");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { void useStore.getState().loadTasks(); }, []);
  const shown = useMemo(() => (tasks ? sortTasks(tasks.filter((x) => (filter === "all" ? true : filter === "done" ? x.state === "done" : x.state !== "done"))) : null), [tasks, filter]);
  const openCount = tasks?.filter((x) => x.state !== "done").length ?? 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text accessibilityRole="header" style={[text.h1, { color: c.text }]}>{t("tasks.title")}</Text>
        <Segmented label={t("tasks.title")} value={filter} onChange={setFilter} options={[{ id: "open", label: openCount ? `${t("tasks.filter.open")} (${openCount})` : t("tasks.filter.open") }, { id: "done", label: t("tasks.filter.done") }, { id: "all", label: t("tasks.filter.all") }]} />
      </View>
      {!shown ? <Loading /> : (
        <FlatList
          data={shown}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await useStore.getState().loadTasks(); setRefreshing(false); }} colors={[c.brand]} tintColor={c.brand} />}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28, gap: 11, flexGrow: 1 }}
          ListEmptyComponent={<Empty icon="tasks" title={t(filter === "done" ? "tasks.emptyDoneTitle" : "tasks.emptyOpenTitle")} text={t(filter === "done" ? "tasks.emptyDoneText" : "tasks.emptyOpenText")} />}
          renderItem={({ item }) => {
            const bot = bots[item.botId];
            return (
              <Pressable accessibilityRole="button" disabled={!bot} onPress={() => { tap(); if (bot) nav.navigate("Chat", { botId: bot.id }); }} style={({ pressed }) => [styles.task, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border, opacity: pressed ? 0.94 : 1 }]}>
                <View style={[styles.taskIcon, { backgroundColor: item.state === "done" ? c.okSoft : item.state === "needs_input" ? c.warnSoft : c.infoSoft }]}>
                  <Icon name={item.state === "done" ? "check" : "clock"} size={19} color={item.state === "done" ? c.ok : item.state === "needs_input" ? c.warn : c.info} />
                </View>
                <View style={{ flex: 1, gap: 5, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: "700" }}>{item.title}</Text>
                  {item.note ? <Text numberOfLines={3} style={{ color: c.text2, fontSize: 13, lineHeight: 19 }}>{item.note}</Text> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {bot ? <Character bot={bot} size={17} /> : null}
                    <Text numberOfLines={1} style={{ color: c.text3, fontSize: 12, flexShrink: 1 }}>{bot ? bot.name : t("common.removedBot")} · {relTime(item.updatedAt, t.locale)}</Text>
                  </View>
                </View>
                <Chip label={t(`task.chip.${item.state}` as "task.chip.done")} tone={item.state === "done" ? "ok" : item.state === "needs_input" ? "warn" : "info"} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, gap: 13, paddingBottom: 4 },
  task: { flexDirection: "row", gap: 11, padding: 14, borderRadius: 18, borderWidth: 1, alignItems: "center", minHeight: 80, elevation: 1 },
  taskIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
