/**
 * L58 « file visible »: the messages typed while the bot works that it has not read yet (server agent/steering.ts), each
 * with « Envoyer maintenant » (stops the step under way, what is done is kept, so the bot reads it at once: server
 * agent/sendnow.ts) and « Retirer » (takes it back before the bot reads it). Same routes as the web app (lib/queuedNotes.ts).
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { errText, useT } from "../i18n";
import { cleanNotes, removeNote, sendNoteNow, type QueuedNote } from "../lib/queuedNotes";
import { useStore } from "../state/store";
import { useTheme } from "../theme";

export function QueuedNotes({ botId, queued }: { botId: string; queued: number }) {
  const { c } = useTheme();
  const t = useT();
  const [notes, setNotes] = useState<QueuedNote[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    if (queued <= 0) { setNotes([]); return; }
    let dead = false;
    useStore.getState().call<{ notes: unknown }>("GET", `/bots/${encodeURIComponent(botId)}/notes`).then((r) => { if (!dead) setNotes(cleanNotes(r?.notes)); }, () => undefined);
    return () => { dead = true; };
  }, [botId, queued]);
  if (!notes.length && !info) return null;
  const call = useStore.getState().call;
  const act = async (id: number, kind: "send" | "remove") => {
    setBusy(id); setInfo(null);
    try {
      if (kind === "send") { const r = await sendNoteNow(call, botId, id); setNotes(r.notes); setInfo(t(r.message)); }
      else setNotes(await removeNote(call, botId, id));
    } catch (e) { setInfo(errText(e)); setNotes((l) => l.filter((n) => n.id !== id)); }
    finally { setBusy(null); }
  };
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 6, gap: 6 }} accessibilityLabel={t("notes.hint")}>
      {notes.map((n) => (
        <View key={n.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, backgroundColor: c.surface }}>
          <Text numberOfLines={2} style={{ flex: 1, color: c.text, fontSize: 13 }}>{n.text}</Text>
          <Pressable accessibilityRole="button" accessibilityHint={t("notes.sendNowHint")} disabled={busy !== null} hitSlop={8} onPress={() => void act(n.id, "send")} style={{ minHeight: 44, justifyContent: "center", opacity: busy !== null ? 0.5 : 1 }}>
            <Text style={{ color: c.ink, fontSize: 13, fontWeight: "700" }}>{t("notes.sendNow")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy !== null} hitSlop={8} onPress={() => void act(n.id, "remove")} style={{ minHeight: 44, justifyContent: "center", opacity: busy !== null ? 0.5 : 1 }}>
            <Text style={{ color: c.text3, fontSize: 13, fontWeight: "600" }}>{t("notes.remove")}</Text>
          </Pressable>
        </View>
      ))}
      {info ? <Text accessibilityLiveRegion="polite" style={{ color: c.text3, fontSize: 12 }}>{info}</Text> : null}
    </View>
  );
}
