/**
 * L184 « sondages » on the phone (same card as the web app, server polls.ts): the answers with their bars, a tap votes
 * (or toggles when several answers are allowed), « Fermer le sondage ». Results from shared/chatPlus.ts.
 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { myChoices, nextChoice, pollResults } from "../../shared/chatPlus";
import type { PollCard as Poll } from "../../../server/src/polltypes";
import { errText, useT } from "../i18n";
import { useStore } from "../state/store";
import { useTheme } from "../theme";

export function PollCard({ card }: { card: Poll }) {
  const { c } = useTheme();
  const t = useT();
  const me = useStore((s) => s.user?.id ?? "");
  const [poll, setPoll] = useState(card);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPoll(card), [card]);
  const mine = myChoices(poll, `user:${me}`);
  const open = poll.status === "open";
  const send = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { setPoll((await useStore.getState().call<{ poll: Poll }>("POST", `/polls/${encodeURIComponent(poll.pollId)}/${path}`, body)).poll); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginHorizontal: 12, marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, gap: 8 }} accessibilityLabel={poll.question}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{poll.question}</Text>
      <Text style={{ color: c.text3, fontSize: 12 }}>{t(poll.multi ? "poll.multi" : "poll.single")} · {t(open ? "poll.open" : "poll.closed")} · {t("poll.voters", { n: poll.votes.length })}</Text>
      {pollResults(poll).map((r, i) => (
        <Pressable key={i} accessibilityRole="button" accessibilityState={{ selected: mine.includes(i), disabled: !open || busy }} disabled={!open || busy} onPress={() => void send("vote", { choices: nextChoice(poll, mine, i) })}
          style={{ minHeight: 44, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: mine.includes(i) ? c.ink : c.border, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${r.pct}%`, backgroundColor: c.surface2 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, gap: 8 }}>
            <Text style={{ color: c.text, fontSize: 14, flex: 1, fontWeight: mine.includes(i) ? "700" : "400" }}>{mine.includes(i) ? "✓ " : ""}{r.label}</Text>
            <Text style={{ color: c.text3, fontSize: 13 }}>{r.count} · {r.pct} %</Text>
          </View>
        </Pressable>
      ))}
      {error ? <Text style={{ color: c.text3, fontSize: 12 }}>{error}</Text> : null}
      {open ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send("close")} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: c.ink, fontSize: 14, fontWeight: "600" }}>{t("poll.close")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
