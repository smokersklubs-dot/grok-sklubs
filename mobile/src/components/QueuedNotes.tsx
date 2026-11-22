/**
 * L58 « file visible »: the messages typed while the bot works that it has not read yet (server agent/steering.ts), each
 * with « Retirer » to take it back before the bot reads it at its next step. Same routes as the web app.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { errText, useT } from "../i18n";
import { useStore } from "../state/store";
import { useTheme } from "../theme";

interface Note { id: number; text: string; thread: number }

export function QueuedNotes({ botId, queued }: { botId: string; queued: number }) {
  const { c } = useTheme();
  const t = useT();
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (queued <= 0) { setNotes([]); return; }
    let dead = false;
    useStore.getState().call<{ notes: Note[] }>("GET", `/bots/${encodeURIComponent(botId)}/notes`).then((r) => { if (!dead) setNotes(Array.isArray(r?.notes) ? r.notes : []); }, () => undefined);
    return () => { dead = true; };
  }, [botId, queued]);
  if (!notes.length) return null;
  const remove = async (id: number) => {
    setError(null);
    try { const r = await useStore.getState().call<{ notes: Note[] }>("DELETE", `/bots/${encodeURIComponent(botId)}/notes/${id}`); setNotes(r.notes); }
    catch (e) { setError(errText(e)); setNotes((l) => l.filter((n) => n.id !== id)); }
  };
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 6, gap: 6 }} accessibilityLabel={t("notes.hint")}>
      {notes.map((n) => (
        <View key={n.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, backgroundColor: c.surface }}>
          <Text numberOfLines={2} style={{ flex: 1, color: c.text, fontSize: 13 }}>{n.text}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void remove(n.id)}>
            <Text style={{ color: c.ink, fontSize: 13, fontWeight: "600" }}>{t("notes.remove")}</Text>
          </Pressable>
        </View>
      ))}
      {error ? <Text style={{ color: c.text3, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}
