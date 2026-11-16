/** The pieces of a conversation: message bubbles, attachments, tool steps, notices and events. */
import { Image } from "expo-image";
import { memo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attachment, Bot, EventBody, Live, MessageBody, NoticeBody, Row, StepBody } from "../api/types";
import { errText, useT, type Key } from "../i18n";
import { clockTime, dayLabel, fileSize, isImage } from "../lib/format";
import { shareLibraryFile } from "../lib/files";
import { stepSummary } from "../state/items";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { tap } from "./ui";

export function DayDivider({ at }: { at: number }) {
  const { c } = useTheme();
  const t = useT();
  return <Text accessibilityRole="header" style={[styles.day, { color: c.text3 }]}>{dayLabel(at, t.locale)}</Text>;
}

function AttachmentView({ botId, file, mine }: { botId: string; file: Attachment; mine: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const client = useStore((s) => s.client);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  if (!client) return null;
  const share = async () => {
    setBusy(true);
    try { await shareLibraryFile(client, botId, file.path, file.name, file.mime); } catch (e) { Alert.alert(file.name, e instanceof Error && e.message === "sharing unavailable" ? t("library.shareFailed") : errText(e)); } finally { setBusy(false); }
  };
  if (isImage(file.mime)) {
    const source = { uri: client.fileUrl(botId, file.path), headers: client.authHeaders() };
    return (
      <>
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={file.name} onPress={() => { tap(); setOpen(true); }}>
          <Image source={source} style={[styles.thumb, { backgroundColor: c.surface3 }]} contentFit="cover" transition={150} />
        </Pressable>
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
          <View style={styles.lightbox}>
            <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" />
            <View style={[styles.lightboxBar, { top: insets.top + 8 }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={() => setOpen(false)} style={styles.lightboxBtn}><Icon name="close" color="#fff" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={file.name} onPress={share} style={styles.lightboxBtn}>{busy ? <ActivityIndicator color="#fff" /> : <Icon name="share" color="#fff" />}</Pressable>
            </View>
          </View>
        </Modal>
      </>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${file.name}, ${fileSize(file.size, t.locale)}`} onPress={() => { tap(); void share(); }} style={[styles.file, { backgroundColor: mine ? "rgba(127,127,127,0.18)" : c.surface2, borderColor: c.border }]}>
      <Icon name="file" size={20} color={c.text2} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontWeight: "600" }}>{file.name}</Text>
        <Text style={{ color: c.text3, fontSize: 12 }}>{fileSize(file.size, t.locale)}</Text>
      </View>
      {busy ? <ActivityIndicator color={c.text2} /> : <Icon name="share" size={18} color={c.text2} />}
    </Pressable>
  );
}

export const MessageBubble = memo(function MessageBubble({ bot, row, body, mine, first }: { bot: Bot; row: Row; body: MessageBody; mine: boolean; first: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const bg = mine ? c.userBubble : c.surface;
  const fg = mine ? c.userBubbleFg : c.text;
  const sender = !mine && first && body.origin && body.origin.kind !== "voice" ? body.origin.name : !mine && first && bot.kind === "room" ? null : null;
  return (
    <View style={[styles.msgWrap, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }, first && { marginTop: 10 }]}>
      {sender ? <Text style={[styles.sender, { color: c.text3 }]}>{sender}</Text> : null}
      {(body.text.trim() || body.streaming) ? (
        <View
          accessible
          accessibilityLabel={`${mine ? t("common.you") : body.origin?.name ?? bot.name}, ${clockTime(row.createdAt)}: ${body.text}`}
          style={[styles.bubble, mine ? styles.mine : [styles.theirs, { borderColor: c.border }], { backgroundColor: bg }]}
        >
          {mine ? <Text selectable style={{ color: fg, fontSize: 16, lineHeight: 22 }}>{body.text}</Text> : body.text.trim() ? <Markdown text={body.text} color={fg} /> : null}
          {body.streaming ? <View style={styles.typing}><ActivityIndicator size="small" color={c.text3} /></View> : null}
        </View>
      ) : null}
      {body.attachments?.length ? (
        <View style={[styles.attachments, mine && { alignItems: "flex-end" }]}>
          {body.attachments.map((a) => <AttachmentView key={a.path} botId={bot.id} file={a} mine={mine} />)}
        </View>
      ) : null}
      {body.sources?.length ? (
        <Text style={[styles.sources, { color: c.text3 }]} numberOfLines={2}>{body.sources.map((s) => s.title || s.url.replace(/^https?:\/\//, "").split("/")[0]).join(" · ")}</Text>
      ) : null}
    </View>
  );
});

const STEP_MARK: Partial<Record<StepBody["status"], Key>> = { error: "step.mark.error", denied: "step.mark.denied", waiting: "step.mark.waiting", running: "step.mark.running" };

export function StepGroup({ rows, live }: { rows: Row[]; live: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const { label, count, problem } = stepSummary(rows);
  const waiting = rows.some((r) => r.body.kind === "step" && r.body.status === "waiting");
  return (
    <View style={styles.steps}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${t.n("count.step", count)}. ${label}`} onPress={() => { tap(); setOpen(!open); }} style={[styles.stepsHead, { backgroundColor: c.surface2, borderColor: c.border }]}>
        {live ? <ActivityIndicator size="small" color={c.text2} /> : waiting ? <Icon name="clock" size={16} color={c.warn} /> : <Icon name={problem ? "alert" : "check"} size={16} color={problem ? c.warn : c.ok} />}
        <Text numberOfLines={1} style={{ color: c.text2, flex: 1, fontSize: 14 }}>{live || waiting ? label : t("work.summary", { steps: t.n("count.step", count) })}</Text>
        <Icon name={open ? "down" : "chevron"} size={16} color={c.text3} />
      </Pressable>
      {open && (
        <View style={{ paddingLeft: 12, paddingTop: 6, gap: 6 }}>
          {rows.map((r) => {
            const b = r.body as StepBody;
            const mark = STEP_MARK[b.status];
            const color = b.status === "error" || b.status === "denied" ? c.danger : b.status === "waiting" ? c.warn : b.status === "running" ? c.info : c.ok;
            return (
              <View key={r.seq} style={{ flexDirection: "row", gap: 8 }}>
                <View style={[styles.stepDot, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 14 }}>{b.label}{mark ? <Text style={{ color }}> · {t(mark)}</Text> : null}</Text>
                  {b.summary ? <Text style={{ color: c.text3, fontSize: 13 }} numberOfLines={3}>{b.summary}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function NoticeRow({ body, botId, seq }: { body: NoticeBody; botId: string; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const tone = body.tone === "error" ? [c.dangerSoft, c.danger] : body.tone === "warn" ? [c.warnSoft, c.warn] : [c.infoSoft, c.info];
  return (
    <View style={[styles.notice, { backgroundColor: tone[0] }]}>
      <Text style={{ color: tone[1], fontSize: 14, lineHeight: 20 }}>{body.text}</Text>
      {body.action?.kind === "continue" && body.action.status === "pending" && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => { setBusy(true); try { await useStore.getState().continueRow(botId, seq); } catch (e) { Alert.alert("", errText(e)); } finally { setBusy(false); } }} style={[styles.noticeBtn, { borderColor: tone[1] }]}>
          <Text style={{ color: tone[1], fontWeight: "600" }}>{t("card.notice.continue")}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EventRow({ body }: { body: EventBody }) {
  const { c } = useTheme();
  return <Text style={[styles.event, { color: body.tone === "warn" ? c.warn : c.text3 }]}>{body.text}</Text>;
}

const ACTIVITY: Record<string, Key> = {
  thinking: "activity.thinking", writing: "activity.writing", searching: "activity.searching", reading: "activity.reading", browsing: "activity.browsing",
  computer: "activity.computer", shell: "activity.shell", messaging: "activity.messaging", connector: "activity.connector", waiting: "activity.waiting",
  saving: "activity.saving", remembering: "activity.remembering", planning: "activity.planning", filming: "activity.filming",
};

/** "Thinking it through…" under the conversation while the bot works. */
export function ActivityLine({ live }: { live: Live | undefined }) {
  const { c } = useTheme();
  const t = useT();
  if (!live?.running && !live?.awaiting) return null;
  const phrase = live.awaiting ? t("activity.waiting") : live.caption || (live.activity ? t(ACTIVITY[live.activity.kind] ?? "activity.working") : t("activity.working"));
  return (
    <View style={styles.activity} accessibilityLiveRegion="polite">
      {live.awaiting ? <Icon name="dot" size={14} color={c.warn} /> : <ActivityIndicator size="small" color={c.text3} />}
      <Text numberOfLines={1} style={{ color: c.text2, fontSize: 14, flex: 1 }}>{phrase}{live.activity?.detail && !live.awaiting ? ` · ${live.activity.detail}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  day: { textAlign: "center", fontSize: 12, fontWeight: "600", marginVertical: 12 },
  msgWrap: { paddingHorizontal: 12, marginTop: 3 },
  sender: { fontSize: 12, fontWeight: "600", marginBottom: 3, marginLeft: 4 },
  bubble: { maxWidth: "88%", borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { borderBottomRightRadius: 6 },
  theirs: { borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  typing: { paddingTop: 4, alignItems: "flex-start" },
  attachments: { gap: 6, marginTop: 4, maxWidth: "88%" },
  thumb: { width: 220, height: 220, borderRadius: radius.lg },
  file: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, minWidth: 220 },
  sources: { fontSize: 12, marginTop: 4, marginHorizontal: 6 },
  lightbox: { flex: 1, backgroundColor: "#000" },
  lightboxBar: { position: "absolute", left: 12, right: 12, flexDirection: "row", justifyContent: "space-between" },
  lightboxBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  steps: { paddingHorizontal: 12, marginTop: 8 },
  stepsHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignSelf: "flex-start", maxWidth: "92%" },
  stepDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  notice: { marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: radius.md, gap: 8 },
  noticeBtn: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  event: { textAlign: "center", fontSize: 13, marginVertical: 8, marginHorizontal: 24 },
  activity: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
});
