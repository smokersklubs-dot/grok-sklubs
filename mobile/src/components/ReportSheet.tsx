/**
 * L31 — « Signaler cette réponse » on a bot's reply (server: server/src/reports.ts; web: ReportMessage.tsx). A short
 * list of reasons and a few words; the report stays on the server, masked, for whoever runs it (Surveillance). Only on
 * the person's own bots.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Row } from "../api/types";
import { errText, useT, type Key } from "../i18n";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { tap } from "./ui";
import { canReport, REPORT_REASONS, reportRequest, type ReportReason } from "../lib/report";

export { canReport };

export function ReportButton({ row }: { row: Row }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t("report.action")} hitSlop={6} onPress={() => { tap(); setOpen(true); }} style={[styles.button, { borderColor: c.border }]}>
        <Icon name="alert" size={16} color={c.text2} />
        <Text style={{ color: c.text2, fontSize: 13, fontWeight: "600" }}>{t("report.short")}</Text>
      </Pressable>
      {open && <ReportSheet row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const client = useStore((s) => s.client);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason || !client) return;
    setBusy(true);
    try {
      const r = reportRequest(row, reason, note);
      await client.post(r.path, r.body);
      onClose();
      Alert.alert("", t("report.sent"));
    } catch (e) { Alert.alert("", errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" }} onPress={onClose} accessibilityLabel={t("common.cancel")}>
          <Pressable onPress={() => undefined} style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 12 }]}>
            <Text accessibilityRole="header" style={{ color: c.text, fontWeight: "700", fontSize: 17 }}>{t("report.action")}</Text>
            <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }}>{t("report.intro")}</Text>
            <View accessibilityRole="radiogroup">
              {REPORT_REASONS.map((r) => (
                <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: reason === r }} onPress={() => { tap(); setReason(r); }} style={({ pressed }) => [styles.reason, pressed && { backgroundColor: c.surface2 }]}>
                  <View style={[styles.radio, { borderColor: reason === r ? c.info : c.border }]}>{reason === r ? <View style={[styles.radioDot, { backgroundColor: c.info }]} /> : null}</View>
                  <Text style={{ color: c.text, fontSize: 16 }}>{t(`report.reason.${r}` as Key)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={note} onChangeText={setNote} multiline maxLength={500} placeholder={t("report.note")} placeholderTextColor={c.text3}
              accessibilityLabel={t("report.note")} style={[styles.note, { color: c.text, borderColor: c.border, backgroundColor: c.surface2 }]}
            />
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} style={[styles.action, { borderColor: c.border }]}>
                <Text style={{ color: c.text2, fontWeight: "600", fontSize: 16 }}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !reason || busy }} disabled={!reason || busy} onPress={send} style={[styles.action, { backgroundColor: reason ? c.userBubble : c.surface3, borderColor: "transparent" }]}>
                {busy ? <ActivityIndicator color={c.userBubbleFg} /> : <Text style={{ color: reason ? c.userBubbleFg : c.text3, fontWeight: "700", fontSize: 16 }}>{t("report.send")}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 12, marginTop: 4, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 16, gap: 10 },
  reason: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 6, borderRadius: radius.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  note: { minHeight: 72, maxHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 10, fontSize: 15, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  action: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
});
