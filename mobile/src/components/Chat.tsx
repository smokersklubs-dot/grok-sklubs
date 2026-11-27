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
import { requestSummary } from "../lib/requestSummary";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { listenAvailable, listenKey, listenReply, stopListening, useListen } from "../voice/listen";
import { Markdown } from "./Markdown";
import { canReport, ReportButton } from "./ReportSheet";
import { LinkPreview, QuoteButton, quoteMessage } from "./ChatPlus";
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
  // L184 « citation »: « Citer » under a reply, or a long press on any message, quotes it into the draft.
  const canQuote = !body.streaming && !!body.text.trim() && (!bot.access || bot.access.canTalk);
  const quotable = !mine && canQuote && body.role === "assistant";
  return (
    <View style={[styles.msgWrap, mine ? { alignItems: "flex-end" } : { alignItems: "flex-start" }, first && { marginTop: 10 }]}>
      {sender ? <Text style={[styles.sender, { color: c.text3 }]}>{sender}</Text> : null}
      {(body.text.trim() || body.streaming) ? (
        <Pressable
          accessible
          accessibilityLabel={`${mine ? t("common.you") : body.origin?.name ?? bot.name}, ${clockTime(row.createdAt)}: ${body.text}`}
          accessibilityActions={canQuote ? [{ name: "longpress", label: t("quote.label") }] : undefined}
          onAccessibilityAction={canQuote ? () => quoteMessage(bot.id, body.text) : undefined}
          onLongPress={canQuote ? () => { tap(); quoteMessage(bot.id, body.text); } : undefined}
          delayLongPress={450}
          style={[styles.bubble, mine ? styles.mine : [styles.theirs, { borderColor: c.border }], { backgroundColor: bg }]}
        >
          {mine ? <Text selectable style={{ color: fg, fontSize: 16, lineHeight: 22 }}>{body.text}</Text> : body.text.trim() ? <Markdown text={body.text} color={fg} /> : null}
          {body.streaming ? <View style={styles.typing}><ActivityIndicator size="small" color={c.text3} /></View> : null}
        </Pressable>
      ) : null}
      {!body.streaming && body.text.trim() ? <LinkPreview text={body.text} mine={mine} /> : null}
      {body.attachments?.length ? (
        <View style={[styles.attachments, mine && { alignItems: "flex-end" }]}>
          {body.attachments.map((a) => <AttachmentView key={a.path} botId={bot.id} file={a} mine={mine} />)}
        </View>
      ) : null}
      {!mine && (quotable || canReport(bot, body) || (!body.streaming && body.role === "assistant" && body.text.trim() && listenAvailable)) ? (
        <View style={styles.replyActions}>
          {quotable ? <QuoteButton botId={bot.id} text={body.text} /> : null}
          {!body.streaming && body.role === "assistant" && body.text.trim() && listenAvailable ? <ListenButton bot={bot} row={row} body={body} /> : null}
          {canReport(bot, body) ? <ReportButton row={row} /> : null}
        </View>
      ) : null}
      {body.sources?.length ? (
        <Text style={[styles.sources, { color: c.text3 }]} numberOfLines={2}>{body.sources.map((s) => s.title || s.url.replace(/^https?:\/\//, "").split("/")[0]).join(" · ")}</Text>
      ) : null}
    </View>
  );
});

/** « Écouter »: reads the reply in the bot's voice (voice/listen.ts); a 44-point target, labelled for screen readers. */
function ListenButton({ bot, row, body }: { bot: Bot; row: Row; body: MessageBody }) {
  const { c } = useTheme();
  const t = useT();
  const st = useListen((s) => (s.key === listenKey(row.botId, row.seq) ? s.status : "idle"));
  const active = st === "loading" || st === "playing";
  const voice = body.origin?.kind === "bot" ? useStore.getState().bots[body.origin.id]?.voice ?? bot.voice : bot.voice;
  const label = active ? t("listen.stop") : st === "error" ? t("listen.failed") : t("listen.play");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? t("listen.stop") : t("listen.playLabel")}
      accessibilityState={{ busy: st === "loading", selected: active }}
      hitSlop={6}
      onPress={() => { tap(); if (active) stopListening(); else listenReply(row.botId, row.seq, body.text, voice); }}
      style={[styles.listen, { borderColor: active ? c.info : c.border, backgroundColor: active ? c.surface2 : "transparent" }]}
    >
      {st === "loading" ? <ActivityIndicator size="small" color={c.text2} /> : <Icon name={active ? "stop" : st === "error" ? "alert" : "speaker"} size={16} color={active ? c.info : st === "error" ? c.warn : c.text2} />}
      <Text style={{ color: active ? c.info : c.text2, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

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
export function ActivityLine({ live, rows }: { live: Live | undefined; rows?: Row[] }) {
  const { c } = useTheme();
  const t = useT();
  if (!live?.running && !live?.awaiting) return null;
  // nod item 3: at once, a one-line summary of the request, until the bot's first step or thought.
  const asked = !live.steps && (!live.activity || live.activity.kind === "thinking") && rows ? requestSummary(rows) : "";
  const phrase = live.awaiting ? t("activity.waiting") : live.caption || (asked ? t("activity.request", { text: asked }) : null) || (live.activity ? t(ACTIVITY[live.activity.kind] ?? "activity.working") : t("activity.working"));
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
  replyActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  listen: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 12, marginTop: 4, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
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
