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
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text accessibilityRole="header" style={[text.h1, { color: c.text }]}>{t("tasks.title")}</Text>
        <Pressable accessibilityRole="button" onPress={() => { tap(); nav.navigate("Chantiers"); }} style={({ pressed }) => [styles.task, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border, alignItems: "center", paddingVertical: 10 }]}>
          <Icon name="tasks" size={18} color={c.text2} />
          <Text style={{ color: c.text, fontSize: 15, fontWeight: "600", flex: 1 }}>{t("chantier.open")}</Text>
        </Pressable>
        <Segmented label={t("tasks.title")} value={filter} onChange={setFilter} options={[{ id: "open", label: openCount ? `${t("tasks.filter.open")} (${openCount})` : t("tasks.filter.open") }, { id: "done", label: t("tasks.filter.done") }, { id: "all", label: t("tasks.filter.all") }]} />
      </View>
      {!shown ? <Loading /> : (
        <FlatList
          data={shown}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await useStore.getState().loadTasks(); setRefreshing(false); }} colors={[c.brand]} tintColor={c.text2} />}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          ListEmptyComponent={<Empty icon="tasks" title={t(filter === "done" ? "tasks.emptyDoneTitle" : "tasks.emptyOpenTitle")} text={t(filter === "done" ? "tasks.emptyDoneText" : "tasks.emptyOpenText")} />}
          renderItem={({ item }) => {
            const bot = bots[item.botId];
            return (
              <Pressable accessibilityRole="button" disabled={!bot} onPress={() => { tap(); if (bot) nav.navigate("Chat", { botId: bot.id }); }} style={({ pressed }) => [styles.task, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border }]}>
                <Icon name={item.state === "done" ? "check" : "clock"} size={20} color={item.state === "done" ? c.ok : item.state === "needs_input" ? c.warn : c.info} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: c.text, fontSize: 16, fontWeight: "500" }}>{item.title}</Text>
                  {item.note ? <Text numberOfLines={3} style={{ color: c.text2, fontSize: 14 }}>{item.note}</Text> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {bot ? <Character bot={bot} size={16} /> : null}
                    <Text style={{ color: c.text3, fontSize: 13 }}>{bot ? bot.name : t("common.removedBot")} · {relTime(item.updatedAt, t.locale)}</Text>
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
  header: { paddingHorizontal: 16, gap: 12, paddingBottom: 4 },
  task: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
});
