/**
 * Cards in the conversation (web/src/components/Cards.tsx). Approvals and questions are answered natively; the other
 * kinds show their state and a way to finish them on the website (secrets are never typed outside the web card).
 */
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { ApprovalCard, Bot, Card, QuestionCard } from "../api/types";
import { errText, useT } from "../i18n";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Button, ErrorNote } from "./ui";

function Shell({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: accent ?? c.border }]}>{children}</View>;
}

function Approval({ card, bot }: { card: ApprovalCard; bot: Bot }) {
  const { c } = useTheme();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canDecide = !bot.access || bot.access.canApprove;
  const decide = async (d: "allow" | "always" | "deny") => {
    setBusy(d);
    setError(null);
    try {
      await useStore.getState().decide(card.approvalId, d);
      void Haptics.notificationAsync(d === "deny" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const source = card.source || card.tool;
  const done = card.status !== "pending";
  return (
    <Shell accent={done ? undefined : c.warn}>
      <View style={styles.head}>
        <View style={[styles.logo, { backgroundColor: c.surface3 }]}>
          {card.source === "Vault" ? <Icon name="key" size={18} color={c.text2} /> : card.tool.startsWith("mycomputer:") ? <Icon name="monitor" size={18} color={c.text2} /> : <Text style={{ color: c.text2, fontWeight: "700" }}>{(Array.from(source.trim())[0] ?? "?").toUpperCase()}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]}>{card.title}</Text>
          <Text style={{ color: c.text3, fontSize: 13 }} numberOfLines={1}>{source}{card.tool && card.tool !== source ? ` · ${card.tool}` : ""}</Text>
        </View>
      </View>
      {card.detail ? <Text selectable style={[styles.detail, { backgroundColor: c.surface2, color: c.text }]}>{card.detail}</Text> : null}
      {card.quote ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("approval.quote", { quote: card.quote })}</Text> : null}
      {card.why ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("approval.why", { why: card.why })}</Text> : null}
      {!done && card.once ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("approval.onceOnly")}</Text> : null}
      {!done && !canDecide ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("approval.ownerOnly", { name: bot.access?.ownerName ?? "" })}</Text> : null}
      {!done && canDecide ? (
        <View style={styles.actions}>
          <Button small variant="ghost" label={t("approval.deny")} busy={busy === "deny"} disabled={!!busy} onPress={() => void decide("deny")} />
          <View style={{ flex: 1 }} />
          {!card.once && !bot.access ? <Button small variant="ghost" label={t("approval.alwaysBtn")} busy={busy === "always"} disabled={!!busy} onPress={() => void decide("always")} /> : null}
          <Button small variant="primary" label={t("approval.allow")} busy={busy === "allow"} disabled={!!busy} onPress={() => void decide("allow")} />
        </View>
      ) : null}
      {done ? (
        <View style={styles.outcome}>
          <Icon name={card.status === "denied" ? "close" : card.status === "expired" ? "clock" : "check"} size={15} color={card.status === "denied" ? c.danger : card.status === "expired" ? c.text3 : c.ok} />
          <Text style={{ color: c.text2, fontSize: 14 }}>{t(`approval.${card.status}` as "approval.allowed")}{card.outcome && (card.status === "allowed" || card.status === "always") ? ` · ${t(`approval.outcome.${card.outcome}` as "approval.outcome.done")}` : ""}</Text>
        </View>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

function Question({ card, bot, seq }: { card: QuestionCard; bot: Bot; seq: number }) {
  const { c } = useTheme();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const pending = card.status === "pending";
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const s = useStore.getState();
  return (
    <Shell>
      <Text style={[styles.title, { color: c.text }]}>{card.question}</Text>
      <Text style={{ color: c.text3, fontSize: 13 }}>{t(pending ? "question.hint" : card.status === "answered" ? "question.answered" : "question.skipped")}</Text>
      {card.options.map((opt, i) => {
        const chosen = card.status === "answered" && card.answer === opt;
        return <Button key={i} small variant={chosen ? "primary" : "ghost"} label={`${String.fromCharCode(65 + (i % 26))}. ${opt}`} disabled={!pending || busy} onPress={() => void run(() => s.answer(bot.id, seq, opt))} style={{ justifyContent: "flex-start" }} />;
      })}
      {card.status === "answered" && card.answer && !card.options.includes(card.answer) ? <Text style={{ color: c.text2 }}>{card.answer}</Text> : null}
      {pending ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput value={own} onChangeText={setOwn} placeholder="…" placeholderTextColor={c.text3} accessibilityLabel={t("question.hint")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
          <Button small label="OK" disabled={!own.trim() || busy} onPress={() => void run(() => s.answer(bot.id, seq, own.trim()))} />
        </View>
      ) : null}
      {pending ? <Button small variant="plain" label={t("question.skip")} disabled={busy} onPress={() => void run(() => s.dismissCard(bot.id, seq))} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} /> : null}
      <ErrorNote>{error}</ErrorNote>
    </Shell>
  );
}

/** Any other card: its title and state, and the website to act on it. */
function Other({ card }: { card: Card }) {
  const { c } = useTheme();
  const t = useT();
  const origin = useStore((s) => s.origin);
  const title =
    card.type === "task" ? `${t("card.task")} · ${card.title}` :
    card.type === "connect" ? card.name :
    card.type === "secret" ? card.name :
    card.type === "takeover" ? card.detail :
    card.type === "nudge" ? card.title :
    card.type === "uncertain" ? card.title :
    card.type === "spend" ? card.title :
    card.type === "skill" ? card.name :
    card.type === "memory" ? card.newText :
    card.type === "mail" ? card.subject :
    card.type === "apiconnector" ? card.name : "";
  const detail =
    card.type === "task" ? card.now || card.result || card.question || "" :
    card.type === "connect" ? card.reason :
    card.type === "secret" ? card.reason :
    card.type === "nudge" ? card.body :
    card.type === "uncertain" ? card.detail :
    card.type === "mail" ? `${card.from} — ${card.snippet}` : "";
  const pending = "status" in card ? card.status === "pending" : card.type === "task" ? card.state === "running" || card.state === "waiting" : false;
  return (
    <Shell>
      <Text style={[styles.title, { color: c.text }]} numberOfLines={3}>{title}</Text>
      {detail ? <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }} numberOfLines={6}>{detail}</Text> : null}
      {pending && origin ? (
        <>
          <Text style={{ color: c.text3, fontSize: 13 }}>{t("card.onWeb")}</Text>
          <Button small variant="ghost" icon="external" label={t("card.openWeb")} onPress={() => void WebBrowser.openBrowserAsync(origin)} style={{ alignSelf: "flex-start" }} />
        </>
      ) : null}
    </Shell>
  );
}

export function CardView({ card, bot, seq }: { card: Card; bot: Bot; seq: number }) {
  if (card.type === "approval") return <Approval card={card} bot={bot} />;
  if (card.type === "question") return <Question card={card} bot={bot} seq={seq} />;
  return <Other card={card} />;
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
});
