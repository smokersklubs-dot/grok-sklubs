/**
 * The message box: text, photos (library or camera) and files, uploaded as soon as they are picked
 * (POST /bots/:id/uploads, then sent by path with the message), and Stop while the bot works.
 * https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/ · https://docs.expo.dev/versions/v58.0.0/sdk/document-picker/
 */
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attachment, Bot, Live } from "../api/types";
import { errText, useT } from "../i18n";
import { File, FileMode } from "expo-file-system";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { tap } from "./ui";
import { ChatSources } from "./ChatSources";
import { mentionAt, replaceMention } from "../../../server/src/clientshared/chatmentions";
import { sendKeysFor } from "../../shared/sendKey";

export const MAX_UPLOAD_BYTES = 1_000_000_000;
export const MAX_ATTACHMENTS = 10;

interface Upload { id: string; name: string; mime: string; uri: string; percent?: number; status: "uploading" | "ready" | "error"; attachment: Attachment | null }
interface Picked { uri: string; name: string; mime: string; size: number | null }

export function Composer({ bot, live }: { bot: Bot; live: Live | undefined }) {
  const { c } = useTheme();
  const t = useT();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(-1);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const insets = useSafeAreaInsets();
  const running = !!live?.running;
  const canTalk = !bot.access || bot.access.canTalk;
  const canAttach = bot.kind === "agent" && !bot.access;
  const mention = canAttach ? mentionAt(text, caret) : null;

  const upload = async (files: Picked[]) => {
    const room = MAX_ATTACHMENTS - uploads.length;
    if (files.length > room) Alert.alert("", t("composer.tooMany"));
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size !== null && f.size > MAX_UPLOAD_BYTES) { Alert.alert("", t("composer.tooBig", { name: f.name })); continue; }
      const id = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { id, name: f.name, mime: f.mime, uri: f.uri, status: "uploading", attachment: null }]);
      try {
        const file = new File(f.uri);
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(t("composer.tooBig", { name: f.name }));
        const client = useStore.getState().client!;
        const path = `/bots/${encodeURIComponent(bot.id)}/uploads`;
        const r = file.size > 25_000_000
          ? await client.uploadLargeFile<{ attachment: Attachment }>(path, f.name, { size: file.size, open: () => file.open(FileMode.ReadOnly) }, percent => setUploads(list => list.map(item => item.id === id ? { ...item, percent } : item)))
          : await client.upload<{ attachment: Attachment }>(path, { name: f.name, type: f.mime, bytes: await file.bytes() });
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: "ready", attachment: r.attachment } : x)));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: "error" } : x)));
        Alert.alert(t("composer.uploadFailed"), errText(e));
      }
    }
  };

  const pickPhotos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: MAX_ATTACHMENTS, quality: 0.85 });
    if (!r.canceled) await upload(r.assets.map((a) => ({ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg", size: a.fileSize ?? null })));
  };
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!r.canceled) await upload(r.assets.map((a) => ({ uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mime: a.mimeType || "image/jpeg", size: a.fileSize ?? null })));
  };
  const pickFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) await upload(r.assets.map((a) => ({ uri: a.uri, name: a.name, mime: a.mimeType || "application/octet-stream", size: a.size ?? null })));
  };
  const [sheet, setSheet] = useState(false);
  const attach = () => { tap(); setSheet(true); };
  const choose = (fn: () => Promise<void>) => { setSheet(false); setTimeout(() => void fn().catch((e) => Alert.alert("", errText(e))), 250); };

  const busyUploads = uploads.some((u) => u.status === "uploading");
  const ready = uploads.filter((u) => u.status === "ready" && u.attachment).map((u) => u.attachment!);
  const canSend = !sending && !busyUploads && (text.trim().length > 0 || ready.length > 0);

  const send = async () => {
    if (!canSend) { if (busyUploads) Alert.alert("", t("composer.waitUploads")); return; }
    tap();
    const body = text.trim();
    setSending(true);
    try {
      // One key per message, the same again if this send is retried after a lost reply: never two messages.
      const keys = sendKeysFor(bot.id);
      await useStore.getState().send(bot.id, body, ready, keys.keyFor(JSON.stringify([body, ready.map((a) => a.path)])));
      keys.done();
      setText("");
      setUploads([]);
    } catch (e) {
      Alert.alert("", errText(e));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    tap();
    setStopping(true);
    try { await useStore.getState().stop(bot.id, live?.tasks?.length ? live.thread ?? 0 : undefined); } catch (e) { Alert.alert("", errText(e)); } finally { setStopping(false); }
  };

  if (!canTalk) return <Text style={[styles.readOnly, { color: c.text3, borderColor: c.border }]}>{t("chat.readOnly")}</Text>;
  const showStop = running && !text.trim() && !ready.length;

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]}>
      <Modal visible={sheet} transparent animationType="fade" onRequestClose={() => setSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" }} onPress={() => setSheet(false)} accessibilityLabel={t("common.cancel")}>
          <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 12 }]}>
            <Text accessibilityRole="header" style={{ color: c.text2, fontWeight: "700", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginLeft: 8 }}>{t("composer.attach")}</Text>
            {([["image", t("composer.photo"), pickPhotos], ["camera", t("composer.camera"), takePhoto], ["file", t("composer.file"), pickFiles]] as const).map(([icon, label, fn]) => (
              <Pressable key={icon} accessibilityRole="button" onPress={() => choose(fn)} style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: c.surface2 }]}>
                <Icon name={icon} size={22} color={c.text} />
                <Text style={{ color: c.text, fontSize: 16 }}>{label}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setSheet(false)} style={({ pressed }) => [styles.sheetRow, { justifyContent: "center" }, pressed && { backgroundColor: c.surface2 }]}>
              <Text style={{ color: c.text2, fontSize: 16, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {uploads.length ? (
        <ScrollView horizontal contentContainerStyle={styles.uploads} keyboardShouldPersistTaps="handled">
          {uploads.map((u) => (
            <View key={u.id} style={[styles.upload, { backgroundColor: c.surface, borderColor: u.status === "error" ? c.danger : c.border }]}>
              {u.mime.startsWith("image/") ? <Image source={{ uri: u.uri }} style={styles.uploadThumb} /> : <Icon name="file" size={18} color={c.text2} />}
              <Text numberOfLines={1} style={{ color: c.text, maxWidth: 110, fontSize: 13 }}>{u.name}</Text>
              {u.status === "uploading" && u.percent !== undefined ? <Text style={{ color: c.text2 }}>{u.percent}%</Text> : u.status === "uploading" ? <ActivityIndicator size="small" color={c.text2} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={t("composer.removeFile", { name: u.name })} hitSlop={10} onPress={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                <Icon name="close" size={16} color={c.text3} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {live?.queued ? <Text style={{ color: c.text3, fontSize: 12, marginLeft: 16, marginBottom: 4 }}>{t.n("composer.queued", live.queued)}</Text> : null}
      {mention && <ChatSources botId={bot.id} query={mention.query} insert={value => {
        const next = replaceMention(text, mention, value);
        setText(next.text); setCaret(next.caret);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelection(next.caret, next.caret); });
      }} />}
      <View style={[styles.box, { backgroundColor: c.surface, borderColor: c.border }]}>
        {canAttach ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("composer.attach")} onPress={attach} style={styles.iconBtn} hitSlop={6}>
            <Icon name="plus" size={22} color={c.text2} />
          </Pressable>
        ) : <View style={{ width: 8 }} />}
        <TextInput
          ref={input}
          value={text}
          onSelectionChange={e => { const { start, end } = e.nativeEvent.selection; setCaret(start === end ? start : -1); }}
          onChangeText={setText}
          placeholder={t("composer.placeholder", { name: bot.name })}
          placeholderTextColor={c.text3}
          multiline
          accessibilityLabel={t("composer.placeholder", { name: bot.name })}
          style={[styles.input, { color: c.text }]}
          maxLength={100_000}
        />
        {showStop ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("composer.stop")} onPress={stop} disabled={stopping} style={[styles.send, { backgroundColor: c.danger }]}>
            {stopping ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="stop" size={18} color="#fff" />}
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={t("composer.send")} accessibilityState={{ disabled: !canSend }} onPress={send} style={[styles.send, { backgroundColor: canSend ? c.ink : c.surface3 }]}>
            {sending ? <ActivityIndicator size="small" color={c.inkFg} /> : <Icon name="send" size={20} color={canSend ? c.inkFg : c.text3} strokeWidth={2.4} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  box: { flexDirection: "row", alignItems: "flex-end", borderWidth: 1, borderRadius: 24, paddingHorizontal: 4, paddingVertical: 4, minHeight: 48 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, fontSize: 16, maxHeight: 140, minHeight: 40, paddingTop: 10, paddingBottom: 10, paddingHorizontal: 6 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  uploads: { gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
  upload: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6 },
  uploadThumb: { width: 28, height: 28, borderRadius: 6 },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 12, gap: 2 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: 12, borderRadius: radius.md },
  readOnly: { textAlign: "center", padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
