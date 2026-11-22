/**
 * Cards in the conversation, natively, with the same server calls as the web app (web/src/components/Cards.tsx,
 * Wave5.tsx, Wave5b.tsx): approvals, questions, app connections, screen takeovers, secrets, uncertain actions,
 * background tasks, nudges, spend checkpoints, learned skills, API connectors, memory questions and received mail.
 *
 * Secrets (secret card, API token, app token): typed into a secureTextEntry field, kept only in this component's state
 * while typed, sent once to the endpoint the web form uses, then cleared. Never logged, never stored on the phone.
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApprovalCard, Bot, Card, QuestionCard } from "../api/types";
import { useT, type Key } from "../i18n";
import { cardReq, type Req } from "../lib/cardActions";
import type { RootStack } from "../screens/types";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { SecretInput, useBusy } from "./cardKit";
import { ConnectSheet } from "./ConnectSheet";
import { Icon } from "./Icon";
import { Button, Chip, ErrorNote } from "./ui";

type Of<T extends Card["type"]> = Extract<Card, { type: T }>;

const post = (r: Req) => useStore.getState().call("POST", r.path, r.body);

function Shell({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: accent ?? c.border }]}>{children}</View>;
}

function Head({ icon, letter, title, sub, tone }: { icon?: string; letter?: string; title: string; sub?: string; tone?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.head}>
      <View style={[styles.logo, { backgroundColor: c.surface3 }]}>
        {icon ? <Icon name={icon} size={18} color={tone ?? c.text2} /> : <Text style={{ color: c.text2, fontWeight: "700" }}>{letter}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        {sub ? <Text style={{ color: c.text3, fontSize: 13 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function Outcome({ ok, icon, label }: { ok: boolean | null; icon: string; label: string }) {
  const { c } = useTheme();
  const color = ok === true ? c.ok : ok === false ? c.danger : c.text3;
  return (
    <View style={styles.outcome}>
      <Icon name={icon} size={15} color={color} />
      <Text style={{ color: c.text2, fontSize: 14, flex: 1 }}>{label}</Text>
    </View>
  );
}

const Spacer = () => <View style={{ flex: 1 }} />;
const letterOf = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();

/* ---------- Approval and question ---------- */

function Approval({ card, bot }: { card: ApprovalCard; bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const canDecide = !bot.access || bot.access.canApprove;
  const decide = (d: "allow" | "always" | "conversation" | "deny") => run(d, async () => {
    await useStore.getState().decide(card.approvalId, d);
    void Haptics.notificationAsync(d === "deny" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  });
  const source = card.source || card.tool;
  const done = card.status !== "pending";
  return (
    <Shell accent={done ? undefined : c.warn}>
      <Head icon={card.source === "Vault" ? "key" : card.tool.startsWith("mycomputer:") ? "monitor" : undefined} letter={letterOf(source)} title={card.title} sub={`${source}${card.tool && card.tool !== source ? ` · ${card.tool}` : ""}`} />
      {card.detail ? <Text selectable style={[styles.detail, { backgroundColor: c.surface2, color: c.text }]}>{card.detail}</Text> : null}
      {card.quote ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("approval.quote", { quote: card.quote })}</Text> : null}
      {card.why ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("approval.why", { why: card.why })}</Text> : null}
      {!done && card.once ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("approval.onceOnly")}</Text> : null}
      {!done && card.parked ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("approval.parked")}</Text> : null}
      {!done && !canDecide ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("approval.ownerOnly", { name: bot.access?.ownerName ?? "" })}</Text> : null}
      {!done && canDecide ? (
        <View style={styles.actions}>
          <Button small variant="ghost" label={t("approval.deny")} busy={busy === "deny"} disabled={!!busy} onPress={() => void decide("deny")} />
          <Spacer />
          {!card.once && !bot.access ? <Button small variant="ghost" label={t("approval.alwaysBtn")} busy={busy === "always"} disabled={!!busy} onPress={() => void decide("always")} /> : null}
          <Button small variant="primary" label={t("approval.allow")} busy={busy === "allow"} disabled={!!busy} onPress={() => void decide("allow")} />
        </View>
      ) : null}
      {/* « Autoriser pour cette conversation »: offered by the server on this card, to the bot's owner only (its own line: the label is long). */}
      {!done && canDecide && card.conversation && !card.once && !bot.access ? (
        <View style={styles.actions}>
          <Spacer />
          <Button small variant="ghost" label={t("approval.conversationBtn")} busy={busy === "conversation"} disabled={!!busy} onPress={() => void decide("conversation")} />
        </View>
      ) : null}
      {done ? (
        <Outcome ok={card.status === "denied" ? false : card.status === "expired" ? null : true} icon={card.status === "denied" ? "close" : card.status === "expired" ? "clock" : "check"}
          label={`${t(card.status === "allowed" && card.grantedFor === "conversation" ? "approval.grantedConversation" : `approval.${card.status}` as Key)}${card.outcome && (card.status === "allowed" || card.status === "always") ? ` · ${t(`approval.outcome.${card.outcome}` as Key)}` : ""}`} />
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function Question({ card, bot, seq }: { card: QuestionCard; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const [own, setOwn] = useState("");
  const pending = card.status === "pending";
  const s = useStore.getState();
  return (
    <Shell>
      <Text style={[styles.title, { color: c.text }]}>{card.question}</Text>
      <Text style={{ color: c.text3, fontSize: 13 }}>{t(pending ? "question.hint" : card.status === "answered" ? "question.answered" : "question.skipped")}</Text>
      {card.options.map((opt, i) => {
        const chosen = card.status === "answered" && card.answer === opt;
        return <Button key={i} small variant={chosen ? "primary" : "ghost"} label={`${String.fromCharCode(65 + (i % 26))}. ${opt}`} disabled={!pending || !!busy} onPress={() => void run("a", () => s.answer(bot.id, seq, opt))} style={{ justifyContent: "flex-start" }} />;
      })}
      {card.status === "answered" && card.answer && !card.options.includes(card.answer) ? <Text style={{ color: c.text2 }}>{card.answer}</Text> : null}
      {pending ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput value={own} onChangeText={setOwn} placeholder="…" placeholderTextColor={c.text3} accessibilityLabel={t("question.hint")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
          <Button small label="OK" disabled={!own.trim() || !!busy} onPress={() => void run("own", () => s.answer(bot.id, seq, own.trim()))} />
        </View>
      ) : null}
      {pending ? <Button small variant="plain" label={t("question.skip")} disabled={!!busy} onPress={() => void run("skip", () => s.dismissCard(bot.id, seq))} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} /> : null}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/* ---------- Connect an app ---------- */

function Connect({ card, bot, seq }: { card: Of<"connect">; bot: Bot; seq: number }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const [open, setOpen] = useState(false);
  return (
    <Shell>
      <Head letter={letterOf(card.name)} title={t("connect.title", { name: card.name })} sub={card.hint || undefined} />
      {card.reason ? <Reason text={card.reason} /> : null}
      {card.status === "pending" ? (
        <View style={styles.actions}>
          <Button small variant="ghost" label={t("connect.skip")} busy={busy === "skip"} disabled={!!busy} onPress={() => void run("skip", () => useStore.getState().dismissCard(bot.id, seq))} />
          <Spacer />
          <Button small variant="accent" label={t("connect.btn")} disabled={!!busy} onPress={() => setOpen(true)} />
        </View>
      ) : (
        <Outcome ok={card.status === "connected"} icon={card.status === "connected" ? "check" : "close"} label={card.status === "connected" ? t("connect.connected", { name: card.name }) : t("connect.skipped")} />
      )}
      <ErrorNote>{error}</ErrorNote>
      {open ? <ConnectSheet name={card.name} botId={bot.id} seq={seq} onClose={() => setOpen(false)} /> : null}
    </Shell>
  );
}

function Reason({ text: s }: { text: string }) {
  const { c } = useTheme();
  return <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }}>{s}</Text>;
}

/* ---------- Takeover: the bot needs the user on its screen ---------- */

/** Ticks every `ms` while `on`, for the "waits N more min" countdown. */
function useNow(ms: number, on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}

export const minutesLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 60_000));

function Takeover({ card, bot }: { card: Of<"takeover">; bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const pending = card.status === "pending";
  const now = useNow(15_000, pending);
  const { busy, error, run } = useBusy();
  const done = () => run("done", () => post(cardReq.takeoverDone(bot.id, card.takeoverId)));
  return (
    <Shell accent={pending ? c.warn : undefined}>
      <Head icon="hand" title={t("takeover.title", { name: bot.name })} sub={`${t(`takeover.reason.${card.reason}` as Key)}${pending ? ` · ${t("takeover.left", { n: minutesLeft(card.expiresAt, now) })}` : ""}`} tone={pending ? c.warn : undefined} />
      {card.detail ? <Reason text={card.detail} /> : null}
      {pending ? (
        <>
          <Text style={{ color: c.text3, fontSize: 13 }}>{t("takeover.hint")}</Text>
          <Button small variant="ghost" icon="monitor" label={t("takeover.open")} disabled={!!busy} onPress={() => nav.navigate("Computer", { botId: bot.id, control: true })} />
          <Button small variant="accent" icon="check" label={t("takeover.done")} busy={busy === "done"} disabled={!!busy} onPress={() => void done()} />
        </>
      ) : (
        <Outcome ok={card.status === "done" ? true : card.status === "timeout" ? null : false} icon={card.status === "done" ? "check" : card.status === "timeout" ? "clock" : "close"} label={t(`takeover.status.${card.status}` as Key)} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/* ---------- Secret: straight into the server's vault ---------- */

function Secret({ card, bot, seq }: { card: Of<"secret">; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const [value, setValue] = useState("");
  const [host, setHost] = useState(card.host);
  const [reveal, setReveal] = useState(false);
  const { busy, error, run } = useBusy();
  // Leaving the screen forgets what was typed (the component's state is the only copy).
  useEffect(() => () => setValue(""), []);
  const save = () => run("save", async () => {
    await post(cardReq.secret(bot.id, seq, value, host));
    setValue("");
  });
  return (
    <Shell accent={card.status === "pending" ? c.info : undefined}>
      <Head icon="lock" title={t("secret.title", { bot: bot.name, name: card.name })} sub={t("secret.sub", { host: card.host })} />
      {card.reason ? <Reason text={card.reason} /> : null}
      {card.status === "pending" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <SecretInput value={value} onChangeText={setValue} placeholder={t("secret.placeholder")} label={t("secret.label", { name: card.name })} reveal={reveal} />
            <Pressable accessibilityRole="button" accessibilityLabel={t(reveal ? "secret.hide" : "secret.show")} hitSlop={8} onPress={() => setReveal((v) => !v)} style={styles.iconBtn}>
              <Icon name={reveal ? "eyeOff" : "eye"} size={20} color={c.text2} />
            </Pressable>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ color: c.text3, fontSize: 13 }}>{t("secret.host")}</Text>
            <TextInput value={host} onChangeText={setHost} autoCapitalize="none" autoCorrect={false} spellCheck={false} accessibilityLabel={t("secret.host")} style={[styles.input, { flex: 0, borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
          </View>
          <View style={styles.note}><Icon name="shield" size={14} color={c.text3} /><Text style={{ color: c.text3, fontSize: 13, flex: 1 }}>{t("secret.never", { bot: bot.name })}</Text></View>
          <View style={styles.actions}>
            <Button small variant="ghost" label={t("secret.skip")} busy={busy === "skip"} disabled={!!busy} onPress={() => void run("skip", async () => { setValue(""); await useStore.getState().dismissCard(bot.id, seq); })} />
            <Spacer />
            <Button small variant="accent" label={t(busy === "save" ? "common.saving" : "secret.save")} busy={busy === "save"} disabled={!!busy || !value.trim()} onPress={() => void save()} />
          </View>
        </>
      ) : (
        <Outcome ok={card.status === "saved"} icon={card.status === "saved" ? "check" : "close"} label={card.status === "saved" ? t("secret.saved", { host: card.host }) : t("secret.skipped")} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/* ---------- Wave 5: uncertain action, background task, nudge ---------- */

function Uncertain({ card }: { card: Of<"uncertain"> }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "done" | "check" | "retry") => run(action, () => post(cardReq.uncertain(card.executionId, action)));
  const pending = card.status === "pending";
  return (
    <Shell accent={pending ? c.warn : undefined}>
      <Head icon="alert" title={t("uncertain.title")} sub={card.title} tone={c.warn} />
      {card.detail ? <Text selectable style={[styles.detail, { backgroundColor: c.surface2, color: c.text }]}>{card.detail}</Text> : null}
      {pending ? (
        <>
          <Reason text={t("uncertain.hint")} />
          <View style={styles.actions}>
            <Button small variant="ghost" label={t("uncertain.retry")} busy={busy === "retry"} disabled={!!busy} onPress={() => void act("retry")} />
            <Spacer />
            <Button small variant="ghost" icon="search" label={t("uncertain.check")} busy={busy === "check"} disabled={!!busy} onPress={() => void act("check")} />
            <Button small variant="accent" icon="check" label={t("uncertain.done")} busy={busy === "done"} disabled={!!busy} onPress={() => void act("done")} />
          </View>
        </>
      ) : (
        <Outcome ok={card.status === "done" ? true : card.status === "dismissed" ? false : null} icon={card.status === "done" ? "check" : card.status === "checking" ? "search" : card.status === "retried" ? "refresh" : "close"} label={t(`uncertain.status.${card.status}` as Key)} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

const TASK_ICON: Record<Of<"task">["state"], string> = { running: "refresh", waiting: "hand", done: "check", failed: "alert", stopped: "stop" };
const TASK_TONE: Record<Of<"task">["state"], "info" | "warn" | "ok" | "danger" | "neutral"> = { running: "info", waiting: "warn", done: "ok", failed: "danger", stopped: "neutral" };

function TaskCard({ card, bot }: { card: Of<"task">; bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const live = useStore((s) => s.live[card.helperId]);
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useBusy();
  const running = card.state === "running";
  const steps = card.steps + (running ? live?.steps ?? 0 : 0);
  const finished = card.state === "done" || card.state === "stopped" || card.state === "failed";
  return (
    <Shell accent={card.state === "waiting" ? c.warn : undefined}>
      <Head icon={TASK_ICON[card.state]} title={card.title} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Chip label={t(`task.state.${card.state}` as Key)} tone={TASK_TONE[card.state]} />
        <Text style={{ color: c.text3, fontSize: 13 }}>{t.n("count.step", steps)}</Text>
        <Spacer />
        {running || card.state === "waiting" ? <Button small variant="ghost" icon="stop" label={t("task.stop")} busy={busy === "stop"} disabled={!!busy} onPress={() => void run("stop", () => post(cardReq.taskStop(bot.id, card.taskId)))} /> : null}
      </View>
      {running && (live?.caption || card.now) ? <Text style={{ color: c.text2, fontSize: 14 }}>{live?.caption || card.now}</Text> : null}
      {card.approval ? (
        <View style={[styles.inner, { backgroundColor: c.surface2 }]}>
          <Text style={[styles.title, { color: c.text, fontSize: 15 }]}>{card.approval.title}</Text>
          {card.approval.detail ? <Text selectable style={[styles.detail, { backgroundColor: c.surface, color: c.text }]}>{card.approval.detail}</Text> : null}
          <View style={styles.actions}>
            <Button small variant="ghost" label={t("approval.deny")} disabled={!!busy} busy={busy === "deny"} onPress={() => void run("deny", () => useStore.getState().decide(card.approval!.approvalId, "deny"))} />
            <Spacer />
            <Button small variant="primary" label={t("approval.allow")} disabled={!!busy} busy={busy === "allow"} onPress={() => void run("allow", () => useStore.getState().decide(card.approval!.approvalId, "allow"))} />
          </View>
        </View>
      ) : null}
      {card.question ? <View style={styles.note}><Icon name="hand" size={14} color={c.warn} /><Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{card.question}</Text></View> : null}
      {card.result ? (
        <View style={{ gap: 4 }}>
          <Text selectable style={{ color: c.text2, fontSize: 14, lineHeight: 20 }} numberOfLines={open ? undefined : 6}>{card.result}</Text>
          {card.result.length > 280 ? <Button small variant="plain" label={t(open ? "task.less" : "task.more")} onPress={() => setOpen((v) => !v)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} /> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput value={reply} onChangeText={setReply} maxLength={4000} placeholder={t(finished ? "task.resumePlaceholder" : "task.replyPlaceholder")} placeholderTextColor={c.text3} accessibilityLabel={t(finished ? "task.resumePlaceholder" : "task.replyPlaceholder")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("task.send")} disabled={!reply.trim() || !!busy} onPress={() => void run("reply", async () => { await post(cardReq.taskReply(bot.id, card.taskId, reply.trim())); setReply(""); })} style={[styles.iconBtn, { opacity: reply.trim() && !busy ? 1 : 0.4 }]}>
          <Icon name="send" size={20} color={c.text} />
        </Pressable>
      </View>
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function Nudge({ card, bot }: { card: Of<"nudge">; bot: Bot }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "do" | "later" | "never") => run(action, () => post(cardReq.nudge(bot.id, card.nudgeId, action)));
  const pending = card.status === "pending";
  return (
    <Shell>
      <Head icon="bulb" title={card.title} sub={t("nudge.sub")} />
      <Reason text={card.body} />
      {pending ? (
        <View style={styles.actions}>
          <Button small variant="ghost" label={t("nudge.never")} busy={busy === "never"} disabled={!!busy} onPress={() => void act("never")} />
          <Spacer />
          <Button small variant="ghost" icon="clock" label={t("nudge.later")} busy={busy === "later"} disabled={!!busy} onPress={() => void act("later")} />
          <Button small variant="accent" icon="bolt" label={t("nudge.do")} busy={busy === "do"} disabled={!!busy} onPress={() => void act("do")} />
        </View>
      ) : (
        <Outcome ok={card.status === "doing" ? true : card.status === "never" ? false : null} icon={card.status === "doing" ? "check" : card.status === "later" ? "clock" : "close"} label={t(`nudge.status.${card.status}` as Key)} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/* ---------- Wave 5b: spend checkpoint, learned skill, API connector, memory question ---------- */

export const usd = (n: number) => `${n.toFixed(2)} $`;

function Spend({ card }: { card: Of<"spend"> }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "continue" | "raise" | "stop") => run(action, () => post(cardReq.spend(card.checkpointId, action)));
  const pct = Math.min(100, Math.round((card.spentUsd / Math.max(0.01, card.thresholdUsd)) * 100));
  return (
    <Shell accent={card.status === "pending" ? c.warn : undefined}>
      <Head icon="chart" title={t("spend.title", { spent: usd(card.spentUsd) })} sub={`${card.title} · ${t(`spend.scope.${card.scope}` as Key)}`} />
      <View style={[styles.meter, { backgroundColor: c.surface3 }]}><View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.warn, borderRadius: 3 }} /></View>
      <Reason text={t("spend.body", { threshold: usd(card.thresholdUsd) })} />
      {card.status === "pending" ? (
        <View style={styles.actions}>
          <Button small variant="ghost" label={t("spend.stop")} busy={busy === "stop"} disabled={!!busy} onPress={() => void act("stop")} />
          <Spacer />
          <Button small variant="ghost" label={t("spend.raise", { next: usd(card.thresholdUsd * 2) })} busy={busy === "raise"} disabled={!!busy} onPress={() => void act("raise")} />
          <Button small variant="accent" label={t("spend.continue")} busy={busy === "continue"} disabled={!!busy} onPress={() => void act("continue")} />
        </View>
      ) : (
        <Outcome ok={card.status !== "stopped"} icon={card.status === "stopped" ? "stop" : "check"} label={t(`spend.status.${card.status}` as Key, { threshold: usd(card.thresholdUsd) })} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function Skill({ card, bot, seq }: { card: Of<"skill">; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const [name, setName] = useState(card.name);
  const [steps, setSteps] = useState(card.steps);
  const { busy, error, run } = useBusy();
  if (card.status !== "pending") {
    return (
      <Shell>
        <Head icon="book" title={t("skillCard.title")} sub={card.name} />
        <Outcome ok={card.status === "saved"} icon={card.status === "saved" ? "check" : "close"} label={t(card.status === "saved" ? "skillCard.saved" : "skillCard.dismissed")} />
      </Shell>
    );
  }
  return (
    <Shell>
      <Head icon="book" title={t("skillCard.title")} sub={t("skillCard.sub")} />
      {card.outside ? <View style={styles.note}><Icon name="alert" size={14} color={c.warn} /><Text style={{ color: c.text2, fontSize: 13, flex: 1 }}>{t("skillCard.outside")}</Text></View> : null}
      <Text style={{ color: c.text3, fontSize: 13 }}>{t("skillCard.name")}</Text>
      <TextInput value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t("skillCard.name")} style={[styles.input, { flex: 0, borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
      {card.when ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("skillCard.when", { when: card.when })}</Text> : null}
      <Text style={{ color: c.text3, fontSize: 13 }}>{t("skillCard.steps")}</Text>
      <TextInput value={steps} onChangeText={setSteps} multiline accessibilityLabel={t("skillCard.steps")} style={[styles.input, styles.area, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
      <View style={styles.note}><Icon name="shield" size={14} color={c.text3} /><Text style={{ color: c.text3, fontSize: 13, flex: 1 }}>{t("skillCard.anonymised")}</Text></View>
      <View style={styles.actions}>
        <Button small variant="ghost" label={t("skillCard.dismiss")} busy={busy === "no"} disabled={!!busy} onPress={() => void run("no", () => post(cardReq.skillDismiss(bot.id, seq)))} />
        <Spacer />
        <Button small variant="accent" label={t("skillCard.save")} busy={busy === "save"} disabled={!!busy || !name.trim() || !steps.trim()} onPress={() => void run("save", () => post(cardReq.skillSave(bot.id, seq, name, steps)))} />
      </View>
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function ApiConnector({ card, bot, seq }: { card: Of<"apiconnector">; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const [token, setToken] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(() => () => setToken(""), []);
  return (
    <Shell>
      <Head icon="plug" title={t("apiCard.title", { name: card.name })} sub={card.baseUrl} />
      <View style={{ gap: 4 }}>
        {card.endpoints.map((e) => (
          <Text key={`${e.method} ${e.path}`} style={{ color: c.text2, fontSize: 13 }}>
            <Text style={{ fontWeight: "700", color: c.text }}>{e.method}</Text> <Text style={{ fontFamily: "monospace" }}>{e.path}</Text>{e.description ? ` — ${e.description}` : ""}
          </Text>
        ))}
      </View>
      <View style={styles.note}><Icon name="key" size={14} color={c.text3} /><Text style={{ color: c.text3, fontSize: 13, flex: 1 }}>{t("apiCard.secret", { secret: card.secret, host: card.host })}</Text></View>
      {card.status === "pending" ? (
        <>
          {!card.secretSaved ? <View style={{ flexDirection: "row" }}><SecretInput value={token} onChangeText={setToken} placeholder={t("apiCard.token")} label={t("apiCard.token")} /></View> : null}
          <View style={styles.note}><Icon name="shield" size={14} color={c.text3} /><Text style={{ color: c.text3, fontSize: 13, flex: 1 }}>{t("apiCard.never")}</Text></View>
          <View style={styles.actions}>
            <Button small variant="ghost" label={t("apiCard.dismiss")} busy={busy === "no"} disabled={!!busy} onPress={() => void run("no", async () => { setToken(""); await post(cardReq.apiDismiss(bot.id, seq)); })} />
            <Spacer />
            <Button small variant="accent" label={t("apiCard.approve")} busy={busy === "ok"} disabled={!!busy || (!card.secretSaved && !token.trim())} onPress={() => void run("ok", async () => { await post(cardReq.apiApprove(bot.id, seq, token)); setToken(""); })} />
          </View>
        </>
      ) : (
        <Outcome ok={card.status === "approved"} icon={card.status === "approved" ? "check" : "close"} label={t(card.status === "approved" ? "apiCard.approved" : "apiCard.dismissed")} />
      )}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function Memory({ card, bot, seq }: { card: Of<"memory">; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const choose = (choice: "old" | "new") => run(choice, () => post(cardReq.memory(bot.id, seq, choice)));
  const option = (choice: "old" | "new", label: string, value: string, chosen: boolean) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: card.status !== "pending" || !!busy }} disabled={card.status !== "pending" || !!busy} onPress={() => void choose(choice)}
      style={[styles.option, { borderColor: chosen ? c.ink : c.border, backgroundColor: chosen ? c.surface2 : c.surface }]}>
      <Text style={{ color: c.text3, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 15 }}>{value}</Text>
    </Pressable>
  );
  return (
    <Shell>
      <Head icon="brain" title={t("memCard.title")} sub={t("memCard.sub", { quote: card.quote })} />
      {option("old", t("memCard.old"), card.oldText, card.status === "kept")}
      {option("new", t("memCard.new"), card.newText, card.status === "replaced")}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/* ---------- Wave 6: mail received at the bot's own address ---------- */

const AUTH_KEYS = ["spf", "dkim", "dmarc"] as const;

function Mail({ card, bot }: { card: Of<"mail">; bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const { busy, error, run } = useBusy();
  const own = !bot.access;
  return (
    <Shell accent={card.status === "held" ? c.warn : undefined}>
      <Head icon="mail" title={card.subject} sub={t("mail.from", { from: card.from })} />
      <Chip label={t(`mail.status.${card.status}` as Key)} tone={card.status === "held" ? "warn" : "neutral"} />
      {card.snippet ? <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }} numberOfLines={6}>{card.snippet}</Text> : null}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {AUTH_KEYS.map((k) => <Chip key={k} label={`${k.toUpperCase()} ${card.auth[k]}`} tone={card.auth[k] === "pass" ? "ok" : card.auth[k] === "fail" ? "danger" : "neutral"} />)}
        {card.spam > 0 ? <Chip label={t("mail.spam", { n: card.spam })} tone={card.spam >= 5 ? "danger" : "neutral"} /> : null}
      </View>
      <View style={styles.note}><Icon name="shield" size={14} color={c.text3} /><Text style={{ color: c.text3, fontSize: 13, flex: 1 }}>{card.status === "held" ? t("mail.heldNote") : t("mail.outsideNote")}</Text></View>
      {card.status === "held" && own ? (
        <View style={styles.actions}><Spacer /><Button small variant="ghost" label={t("mail.release")} busy={busy === "r"} disabled={!!busy} onPress={() => void run("r", () => post(cardReq.mailRelease(bot.id, card.mailId)))} /></View>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

export function CardView({ card, bot, seq }: { card: Card; bot: Bot; seq: number }) {
  switch (card.type) {
    case "approval": return <Approval card={card} bot={bot} />;
    case "question": return <Question card={card} bot={bot} seq={seq} />;
    case "connect": return <Connect card={card} bot={bot} seq={seq} />;
    case "takeover": return <Takeover card={card} bot={bot} />;
    case "secret": return <Secret card={card} bot={bot} seq={seq} />;
    case "uncertain": return <Uncertain card={card} />;
    case "task": return <TaskCard card={card} bot={bot} />;
    case "nudge": return <Nudge card={card} bot={bot} />;
    case "spend": return <Spend card={card} />;
    case "skill": return <Skill card={card} bot={bot} seq={seq} />;
    case "apiconnector": return <ApiConnector card={card} bot={bot} seq={seq} />;
    case "memory": return <Memory card={card} bot={bot} seq={seq} />;
    case "mail": return <Mail card={card} bot={bot} />;
    default: return null;
  }
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1, gap: 10 },
  head: { flexDirection: "row", gap: 10, alignItems: "center" },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  detail: { fontFamily: "monospace", fontSize: 13, padding: 10, borderRadius: radius.sm, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  outcome: { flexDirection: "row", gap: 6, alignItems: "center" },
  input: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
  area: { flex: 0, minHeight: 120, paddingVertical: 10, textAlignVertical: "top" },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  note: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  inner: { padding: 10, borderRadius: radius.md, gap: 8 },
  meter: { height: 6, borderRadius: 3, overflow: "hidden" },
  option: { borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 4 },
});
