/** A bot's details: Activité (routines, background tasks, members, computer), Tâches, Bibliothèque (web DetailsPanel.tsx). */
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Bot, FileEntry, Routine } from "../api/types";
import { Character, stateOf } from "../components/Character";
import { Icon } from "../components/Icon";
import { Card, Chip, Empty, ErrorNote, Loading, Row, Segmented, SectionTitle, tap } from "../components/ui";
import { errText, useT } from "../i18n";
import { dayLabel, clockTime, fileSize, relTime } from "../lib/format";
import { shareLibraryFile } from "../lib/files";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import type { RootStack } from "./types";

type Tab = "activity" | "tasks" | "library";

function routineWhen(r: Routine, t: ReturnType<typeof useT>): string {
  if (!r.enabled) return t("routine.paused");
  if (r.trigger === "webhook") return t("routine.webhook");
  if (r.trigger === "watch") return t("routine.watch");
  if (r.trigger === "email" || r.trigger === "slack" || r.trigger === "calendar" || r.trigger === "botmail") return r.describe || t("routine.app");
  if (r.nextRunAt) return t("routine.next", { when: `${dayLabel(r.nextRunAt, t.locale)} ${clockTime(r.nextRunAt)}` });
  return r.describe;
}

function Activity({ bot }: { bot: Bot }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { c } = useTheme();
  const t = useT();
  const bundle = useStore((s) => s.bundles[bot.id]);
  const bots = useStore((s) => s.bots);
  const origin = useStore((s) => s.origin);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (r: Routine, enabled: boolean) => {
    setError(null);
    const swap = (x: Routine) => useStore.setState((s) => (s.bundles[bot.id] ? { bundles: { ...s.bundles, [bot.id]: { ...s.bundles[bot.id], routines: s.bundles[bot.id].routines.map((y) => (y.id === x.id ? x : y)) } } } : {}));
    swap({ ...r, enabled });
    try {
      const res = await useStore.getState().client!.patch<{ routine: Routine }>(`/routines/${encodeURIComponent(r.id)}`, { enabled });
      swap(res.routine);
    } catch (e) { swap(r); setError(errText(e)); }
  };
  return (
    <View>
      {bot.kind === "room" ? (
        <>
          <SectionTitle>{t("details.members")}</SectionTitle>
          <Card style={{ padding: 0 }}>
            {bot.memberIds.map((id) => bots[id]).filter(Boolean).map((m) => (
              <View key={m!.id} style={styles.member}><Character bot={m!} size={30} /><Text style={{ color: c.text, fontSize: 15 }}>{m!.name}</Text><Text style={{ color: c.text3, fontSize: 13 }}>{m!.label}</Text></View>
            ))}
          </Card>
        </>
      ) : null}
      {!bot.access ? (
        <>
          <SectionTitle>{t("details.upcoming")}</SectionTitle>
          {!bundle ? <Loading /> : bundle.routines.length === 0 ? <Text style={[styles.muted, { color: c.text3 }]}>{t("details.noRoutines")}</Text> : (
            <Card style={{ padding: 0 }}>
              {bundle.routines.map((r) => (
                <View key={r.id} style={styles.routine}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: "500" }}>{r.name}</Text>
                    <Text numberOfLines={2} style={{ color: c.text3, fontSize: 13 }}>{routineWhen(r, t)}</Text>
                  </View>
                  <Switch value={r.enabled} onValueChange={(v) => { tap(); void toggle(r, v); }} accessibilityLabel={r.name} />
                </View>
              ))}
            </Card>
          )}
          <ErrorNote>{error}</ErrorNote>
          {bundle?.bgTasks.length ? (
            <>
              <SectionTitle>{t("details.background")}</SectionTitle>
              <Card style={{ padding: 0 }}>
                {bundle.bgTasks.slice(0, 10).map((b) => (
                  <View key={b.id} style={styles.routine}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: c.text, fontSize: 15 }}>{b.title}</Text>
                      <Text numberOfLines={2} style={{ color: c.text3, fontSize: 13 }}>{b.result || t.n("count.step", b.steps)}</Text>
                    </View>
                    <Chip label={b.state} tone={b.state === "done" ? "ok" : b.state === "failed" ? "danger" : b.state === "waiting" ? "warn" : "info"} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
      {bot.kind === "agent" && origin ? (
        <>
          <SectionTitle>{t("details.computer")}</SectionTitle>
          <Card style={{ padding: 0 }}>
            <Row icon="monitor" title={t("details.openComputer")} subtitle={t("details.computerHint")} onPress={() => nav.navigate("Computer", { botId: bot.id })} />
            {!bot.access ? <Row icon="settings" title={t("details.settingsWeb")} onPress={() => void WebBrowser.openBrowserAsync(origin)} right={<Icon name="external" size={18} color={c.text3} />} /> : null}
          </Card>
        </>
      ) : null}
    </View>
  );
}

function Tasks({ bot }: { bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const bundle = useStore((s) => s.bundles[bot.id]);
  if (bot.access) return <Empty icon="tasks" text={t("details.tasksEmpty", { name: bot.name })} />;
  if (!bundle) return <Loading />;
  const tasks = [...bundle.tasks].sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || b.updatedAt - a.updatedAt);
  if (!tasks.length) return <Empty icon="tasks" text={t("details.tasksEmpty", { name: bot.name })} />;
  return (
    <Card style={{ padding: 0, marginTop: 14 }}>
      {tasks.map((task) => (
        <View key={task.id} style={styles.routine}>
          <Icon name={task.state === "done" ? "check" : "clock"} size={18} color={task.state === "done" ? c.ok : task.state === "needs_input" ? c.warn : c.info} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 15 }}>{task.title}</Text>
            {task.note ? <Text numberOfLines={3} style={{ color: c.text3, fontSize: 13 }}>{task.note}</Text> : null}
            <Text style={{ color: c.text3, fontSize: 12, marginTop: 2 }}>{relTime(task.updatedAt, t.locale)}</Text>
          </View>
          <Chip label={t(`task.chip.${task.state}` as "task.chip.done")} tone={task.state === "done" ? "ok" : task.state === "needs_input" ? "warn" : "info"} />
        </View>
      ))}
    </Card>
  );
}

function Library({ bot }: { bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (p: string) => {
    setError(null);
    try {
      const r = await useStore.getState().client!.get<{ entries: FileEntry[] }>(`/bots/${encodeURIComponent(bot.id)}/files?path=${encodeURIComponent(p)}`);
      setEntries([...r.entries].sort((a, b) => Number(b.dir) - Number(a.dir) || b.modifiedAt - a.modifiedAt));
    } catch (e) { setError(errText(e)); setEntries([]); }
  }, [bot.id]);
  useEffect(() => { setEntries(null); void load(path); }, [path, load]);
  if (bot.access) return <Empty icon="folder" text={t("library.empty", { name: bot.name })} />;
  const open = async (e: FileEntry) => {
    const full = path ? `${path}/${e.name}` : e.name;
    if (e.dir) { setPath(full); return; }
    setBusy(full);
    try { await shareLibraryFile(useStore.getState().client!, bot.id, full, e.name); } catch (err) { Alert.alert(e.name, err instanceof Error && err.message === "sharing unavailable" ? t("library.shareFailed") : errText(err)); } finally { setBusy(null); }
  };
  return (
    <View style={{ marginTop: 14, gap: 10 }}>
      {path ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => setPath(path.split("/").slice(0, -1).join("/"))} style={styles.crumb}>
          <Icon name="back" size={18} color={c.text2} />
          <Text numberOfLines={1} style={{ color: c.text2, flex: 1 }}>{t("library.root")} / {path}</Text>
        </Pressable>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
      {!entries ? <Loading /> : entries.length === 0 ? <Empty icon="folder" text={path ? t("library.emptyFolder") : t("library.empty", { name: bot.name })} /> : (
        <Card style={{ padding: 0 }}>
          {entries.map((e) => {
            const full = path ? `${path}/${e.name}` : e.name;
            return (
              <Row key={e.name} icon={e.dir ? "folder" : "file"} title={e.name} subtitle={e.dir ? undefined : `${fileSize(e.size, t.locale)} · ${relTime(e.modifiedAt, t.locale)}`} onPress={() => void open(e)}
                right={busy === full ? <ActivityIndicator color={c.text2} /> : <Icon name={e.dir ? "chevron" : "share"} size={18} color={c.text3} />} />
            );
          })}
        </Card>
      )}
    </View>
  );
}

export function DetailsScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const { botId } = useRoute<RouteProp<RootStack, "Details">>().params;
  const bot = useStore((s) => s.bots[botId]);
  const live = useStore((s) => s.live[botId]);
  const [tab, setTab] = useState<Tab>("activity");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { void useStore.getState().loadBundle(botId); }, [botId]);
  if (!bot) return null;
  const refresh = async () => { setRefreshing(true); await Promise.all([useStore.getState().loadBundle(botId), useStore.getState().loadBots()]); setRefreshing(false); };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => nav.goBack()} hitSlop={8} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="back" size={24} color={c.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[c.brand]} tintColor={c.text2} />}>
        <View style={styles.hero}>
          <Character bot={bot} size={84} state={stateOf(live)} />
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: "700" }}>{bot.name}</Text>
          {bot.label ? <Text style={{ color: c.text2, fontSize: 15 }}>{bot.label}</Text> : null}
          {bot.description ? <Text style={{ color: c.text3, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{bot.description}</Text> : null}
        </View>
        <Segmented label={t("chat.details")} value={tab} onChange={setTab} options={[{ id: "activity", label: t("details.tab.activity") }, { id: "tasks", label: t("details.tab.tasks") }, { id: "library", label: t("details.tab.library") }]} />
        {tab === "activity" && <Activity bot={bot} />}
        {tab === "tasks" && <Tasks bot={bot} />}
        {tab === "library" && <Library bot={bot} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 6 },
  hero: { alignItems: "center", gap: 6, paddingBottom: 18 },
  muted: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  routine: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  member: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
});
