/**
 * « Chantier » on the phone (web Chantier.tsx, server chantierroutes.ts): read, approve, decide, stop. The list of the
 * owner's chantiers; one chantier with its cards to decide (each answer as on the web), its tasks coloured by state,
 * its figures, « Approuver et lancer » for a plan that is ready, « Arrêter le chantier ». Editing a plan is done on the
 * computer (the web page): the phone shows what is left to fix.
 */
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChantierSummary, ChantierView, DecisionAnswer, TaskState } from "../../../server/src/chantiertypes";
import { Icon } from "../components/Icon";
import { Button, Card, Chip, Empty, ErrorNote, Loading, SectionTitle, tap, text } from "../components/ui";
import { errText, useT, type Key } from "../i18n";
import { useStore } from "../state/store";
import { useTheme } from "../theme";
import { phoneActions, STATUS_TONE, TASK_TONE } from "../lib/chantier";

type View_ = ChantierView & { problems?: string[] };

export function ChantiersScreen() {
  const { c } = useTheme();
  const t = useT();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const call = useStore((s) => s.call);
  const [list, setList] = useState<ChantierSummary[] | null>(null);
  const [open, setOpen] = useState<View_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadList = useCallback(async () => { try { setList((await call<{ chantiers: ChantierSummary[] }>("GET", "/chantiers")).chantiers); setError(null); } catch (e) { setError(errText(e)); } }, [call]);
  const loadOne = useCallback(async (id: string) => { try { setOpen(await call<View_>("GET", `/chantiers/${id}`)); setError(null); } catch (e) { setError(errText(e)); } }, [call]);
  useEffect(() => { void loadList(); }, [loadList]);
  const act = async (method: "POST", path: string, body?: unknown) => {
    if (!open) return;
    setBusy(true); setError(null);
    try { setOpen(await call<View_>(method, `/chantiers/${open.chantier.id}${path}`, body)); } catch (e) { setError(errText(e)); await loadOne(open.chantier.id); } finally { setBusy(false); }
  };
  const ch = open?.chantier;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10} onPress={() => { tap(); if (open) { setOpen(null); void loadList(); } else nav.goBack(); }}><Icon name="back" color={c.text} /></Pressable>
        <Text accessibilityRole="header" numberOfLines={2} style={[text.h1, { color: c.text, flex: 1 }]}>{ch ? ch.title : t("chantier.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await (open ? loadOne(open.chantier.id) : loadList()); setRefreshing(false); }} colors={[c.brand]} tintColor={c.text2} />}>
        <ErrorNote>{error}</ErrorNote>
        {!open && !list && !error && <Loading />}
        {!open && list && list.length === 0 && <Empty icon="tasks" title={t("chantier.emptyTitle")} text={t("chantier.emptyText")} />}
        {!open && list?.map((x) => (
          <Pressable key={x.id} accessibilityRole="button" onPress={() => { tap(); void loadOne(x.id); }} style={({ pressed }) => [styles.item, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{x.title}</Text>
              <Text style={{ color: c.text2, fontSize: 14 }}>{t("chantier.progress", { done: x.accepted, total: x.tasks })}{x.openDecisions ? ` · ${t("chantier.toDecide", { n: x.openDecisions })}` : ""}</Text>
            </View>
            <Chip label={t(`chantier.status.${x.status}` as Key)} tone={STATUS_TONE[x.status]} />
          </Pressable>
        ))}
        {open && ch && (
          <>
            <Chip label={t(`chantier.status.${ch.status}` as Key)} tone={STATUS_TONE[ch.status]} style={{ alignSelf: "flex-start" }} />
            {ch.note ? <Text style={{ color: c.text2, fontSize: 14 }}>{ch.note}</Text> : null}
            {open.decisions.filter((d) => d.status === "open").map((d) => (
              <Card key={d.id} style={{ gap: 10, borderColor: c.warn }}>
                <Text style={{ color: c.warn, fontWeight: "700", fontSize: 13 }}>{t(`chantier.cards.${d.kind}` as Key)}</Text>
                <Text style={{ color: c.text, fontSize: 15 }}>{d.question}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {d.options.map((o: DecisionAnswer) => <Button key={o} small label={t(`chantier.answer.${o}` as Key)} variant={o === "stop_branch" ? "ghost" : "primary"} disabled={busy} onPress={() => void act("POST", `/decisions/${d.id}`, { answer: o })} />)}
                </View>
              </Card>
            ))}
            {ch.status === "proposed" && (
              <Card style={{ gap: 8 }}>
                <Text style={{ color: c.text, fontSize: 15 }}>{t("chantier.proposed")}</Text>
                {(open.problems ?? []).map((p, i) => <Text key={i} style={{ color: c.danger, fontSize: 14 }}>• {p}</Text>)}
                {open.problems?.length ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("chantier.editOnComputer")}</Text> : null}
              </Card>
            )}
            <SectionTitle>{t("chantier.tasks")}</SectionTitle>
            {(ch.plan?.tasks ?? []).map((task) => {
              const st = open.tasks.find((x) => x.key === task.key);
              const state: TaskState = st?.state ?? "waiting";
              const after = (ch.plan?.edges ?? []).filter((e) => e.from === task.key);
              return (
                <Card key={task.key} style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: c.text, fontSize: 15, fontWeight: "600", flex: 1 }}>{task.title}</Text>
                    <Chip label={t(`chantier.state.${state}` as Key)} tone={TASK_TONE[state]} />
                  </View>
                  {st?.attempts ? <Text style={{ color: c.text2, fontSize: 13 }}>{t("chantier.attempts", { n: st.attempts, max: (ch.plan?.maxAttempts ?? 3) + (st.extra ?? 0) })}</Text> : null}
                  {st?.note ? <Text style={{ color: c.text2, fontSize: 13 }}>{st.note}</Text> : null}
                  {after.map((e) => <Text key={e.to} style={{ color: c.text3, fontSize: 13 }}>↓ {t("chantier.passes", { artifact: e.artifact, to: ch.plan?.tasks.find((x) => x.key === e.to)?.title ?? e.to })}</Text>)}
                </Card>
              );
            })}
            {ch.status !== "proposed" && ch.status !== "planning" && (
              <Text style={{ color: c.text2, fontSize: 14 }}>{t("chantier.metrics", { attempts: open.metrics.attempts, defects: open.metrics.defects, interventions: open.metrics.interventions })}</Text>
            )}
            {phoneActions(ch.status).approve && <Button label={t("chantier.approve")} disabled={busy || !!open.problems?.length} onPress={() => void act("POST", "/approve", {})} />}
            {phoneActions(ch.status).stop && <Button label={t("chantier.stop")} variant="danger" disabled={busy} onPress={() => Alert.alert(t("chantier.stop"), t("chantier.stopConfirm"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("chantier.stop"), style: "destructive", onPress: () => void act("POST", "/stop") }])} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 6, flexDirection: "row", alignItems: "center", gap: 12 },
  item: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "center" },
});
