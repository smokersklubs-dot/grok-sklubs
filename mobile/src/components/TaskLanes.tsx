/**
 * Lanes (server agent/lanes.ts; the web's TaskLanes.tsx): a bot runs up to 3 tasks at once (its main chat, a routine, a
 * teammate's request). While two or more run, this strip above the composer lists them; each stops on its own, and
 * "Tout arrêter" stops them all. Hidden with a single task (the composer's Stop is enough then).
 */
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { Bot, Live, Row } from "../api/types";
import { errText, useT } from "../i18n";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Button, tap } from "./ui";

export function taskName(t: ReturnType<typeof useT>, thread: number, rows: Row[] | undefined): string {
  if (!thread) return t("lanes.main");
  const p = rows?.find((r) => r.seq === thread);
  if (p?.body.kind === "message") {
    if (p.body.origin?.kind === "routine") return t("lanes.routine", { name: p.body.origin.name });
    if (p.body.origin?.kind === "bot") return t("lanes.from", { name: p.body.origin.name });
  }
  return t("lanes.threadN", { n: thread });
}

export function TaskLanes({ bot, live, rows }: { bot: Bot; live: Live | undefined; rows?: Row[] }) {
  const { c } = useTheme();
  const t = useT();
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const tasks = live?.tasks ?? [];
  if (tasks.length < 2) return null;
  const stop = async (thread?: number) => {
    tap();
    setBusy(thread ?? "all");
    try { await useStore.getState().stop(bot.id, thread); } catch (e) { Alert.alert("", errText(e)); } finally { setBusy(null); }
  };
  return (
    <View style={[styles.box, { backgroundColor: c.infoSoft, borderColor: c.border }]} accessibilityLabel={t("lanes.title")}>
      <Text style={[styles.title, { color: c.text }]}>{t.n("lanes.count", tasks.length)}</Text>
      {tasks.map((task) => (
        <View key={task.thread} style={styles.row}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{taskName(t, task.thread, rows)}</Text>
          <Button small variant="ghost" icon="stop" busy={busy === task.thread} label={t("lanes.stop")} accessibilityLabel={`${t("lanes.stop")} : ${taskName(t, task.thread, rows)}`} onPress={() => void stop(task.thread)} />
        </View>
      ))}
      <View style={styles.all}><Button small variant="danger" busy={busy === "all"} label={t("lanes.stopAll")} onPress={() => void stop()} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 10, marginBottom: 8, padding: 10, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  title: { fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  name: { flex: 1, fontSize: 14 },
  all: { flexDirection: "row", justifyContent: "flex-end" },
});
