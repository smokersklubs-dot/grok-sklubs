/** The call bar of a chat (web/src/components/CallBar.tsx): state, captions, mute, speaker, interrupt, hang up. */
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Bot } from "../api/types";
import { useT } from "../i18n";
import { radius, useTheme } from "../theme";
import { bargeIn, endCall, openMicSettings, setMuted, setSpeaker, useCall } from "../voice/call";
import { Icon } from "./Icon";
import { Button } from "./ui";

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function Round({ icon, label, onPress, on, danger }: { icon: string; label: string; onPress: () => void; on?: boolean; danger?: boolean }) {
  const { c } = useTheme();
  const bg = danger ? c.danger : on ? c.ink : c.surface3;
  const fg = danger ? "#fff" : on ? c.inkFg : c.text;
  return (
    <View style={{ alignItems: "center", gap: 4, width: 76 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }} onPress={onPress} style={({ pressed }) => [styles.round, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}>
        <Icon name={icon} size={24} color={fg} />
      </Pressable>
      <Text numberOfLines={1} style={{ color: c.text2, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function CallPanel({ bot }: { bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const call = useCall((s) => s.call);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!call || call.botId !== bot.id) return null;

  if (call.status === "error") {
    return (
      <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Icon name="alert" size={18} color={c.danger} />
          <Text style={{ color: c.text, flex: 1, fontSize: 15, lineHeight: 21 }}>{call.error}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          {call.blocked ? <Button small variant="ghost" label={t("call.openSettings")} onPress={openMicSettings} /> : null}
          <Button small variant="primary" label={t("common.close")} onPress={endCall} />
        </View>
      </View>
    );
  }

  const state = call.status === "connecting" ? t("call.connecting") : call.status === "reconnecting" ? t("call.reconnecting")
    : call.muted ? t("call.muted") : call.speaking ? t("call.speaking") : call.hearing ? t("call.hearing") : t("call.listening");
  const shown = call.lines.slice(-4);
  return (
    <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityLabel={t("call.title", { name: bot.name })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={[styles.dot, { backgroundColor: call.status === "live" ? (call.speaking ? c.brand : call.hearing ? c.ok : c.info) : c.text3 }]} />
        <Text style={{ color: c.text, fontWeight: "600", fontSize: 15, flex: 1 }} numberOfLines={1}>{state}</Text>
        {call.pipeline ? <Text style={{ color: c.text3, fontSize: 12 }}>{t(call.pipeline === "server" ? "call.server" : "call.device")}</Text> : null}
        {call.startedAt ? <Text style={{ color: c.text3, fontSize: 13, fontVariant: ["tabular-nums"] }}>{clock(now - call.startedAt)}</Text> : null}
      </View>
      <ScrollView style={{ maxHeight: 120 }} contentContainerStyle={{ gap: 4 }}>
        {shown.length === 0 ? <Text style={{ color: c.text3, fontSize: 14 }}>{call.muted ? t("call.muted") : t("call.sayHi", { name: bot.name })}</Text> : shown.map((l) => (
          <Text key={l.id} style={{ color: l.role === "user" ? c.text : c.text2, fontSize: 14, opacity: l.final ? 1 : 0.6, lineHeight: 20 }}>
            <Text style={{ fontWeight: "700" }}>{l.role === "user" ? t("common.you") : bot.name}</Text> {l.text}{l.cut ? ` (${t("call.cut")})` : ""}
          </Text>
        ))}
      </ScrollView>
      {call.note ? <Text style={{ color: c.warn, fontSize: 13 }}>{call.note}</Text> : null}
      <View style={styles.controls}>
        <Round icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "call.unmute" : "call.mute")} on={call.muted} onPress={() => setMuted(!call.muted)} />
        <Round icon="speaker" label={t(call.speaker ? "call.speaker" : "call.earpiece")} on={call.speaker} onPress={() => setSpeaker(!call.speaker)} />
        {call.speaking ? <Round icon="stop" label={t("call.interrupt")} onPress={bargeIn} /> : null}
        <Round icon="hangup" label={t("call.hangUp")} danger onPress={endCall} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 8, marginBottom: 8, padding: 12, borderWidth: 1, borderRadius: radius.xl, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  controls: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start" },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
