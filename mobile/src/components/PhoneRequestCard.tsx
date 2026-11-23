import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useT } from "../i18n";
import { locationPageUrl, mmss, onPhoneRequests, secondsLeft, visibleRequests, type PhoneRequest } from "../lib/phoneRequests";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { Button } from "./ui";

/**
 * L177: « {bot} voudrait une photo / ta position » — shown at the top of the bots list while a request waits. The owner
 * decides here, each time: take the photo (system camera), share the position (one-time page, the phone asks too), or
 * refuse. Checked when the app comes to the front, when the server says something changed, and every 15 s while open.
 */
export function PhoneRequestCard() {
  const { c } = useTheme();
  const t = useT();
  const call = useStore((s) => s.call);
  const origin = useStore((s) => s.origin);
  const [list, setList] = useState<PhoneRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try { setList(visibleRequests((await call<{ requests: unknown }>("GET", "/phone/requests")).requests)); } catch { /* offline: try again later */ }
  }, [call]);
  useEffect(() => { void load(); return onPhoneRequests(() => void load()); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void load(); });
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    const poll = setInterval(() => { if (AppState.currentState === "active") void load(); }, 15_000);
    return () => { sub.remove(); clearInterval(id); clearInterval(poll); };
  }, [load]);
  const r = list[0];
  if (!r || secondsLeft(r) === 0) return null;
  const done = (text: string) => { setNote(text); setBusy(null); void load(); };
  const photo = async () => {
    setBusy(r.id);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return done(t("phoneReq.noCamera"));
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      if (shot.canceled || !shot.assets[0]?.base64) return done(t("phoneReq.cancelled"));
      await call("POST", `/phone/requests/${encodeURIComponent(r.id)}/photo`, { data: shot.assets[0].base64 });
      done(t("phoneReq.sent"));
    } catch { done(t("phoneReq.failed")); }
  };
  const where = async () => {
    setBusy(r.id);
    try {
      const res = await call<{ url: string }>("POST", `/phone/requests/${encodeURIComponent(r.id)}/location-link`);
      const url = origin ? locationPageUrl(origin, res.url) : null;
      if (!url) return done(t("phoneReq.failed"));
      await WebBrowser.openBrowserAsync(url);
      done("");
    } catch { done(t("phoneReq.failed")); }
  };
  const refuse = async () => { setBusy(r.id); try { await call("POST", `/phone/requests/${encodeURIComponent(r.id)}/refuse`); done(t("phoneReq.refused")); } catch { done(t("phoneReq.failed")); } };
  const isPhoto = r.kind === "photo";
  return (
    <View accessibilityRole="alert" style={[styles.box, { backgroundColor: c.surface, borderColor: c.brand }]}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Icon name={isPhoto ? "camera" : "globe"} size={18} color={c.brand} />
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 15, flex: 1 }}>{t(isPhoto ? "phoneReq.photoTitle" : "phoneReq.whereTitle", { bot: r.botName })}</Text>
        <Text style={{ color: c.text2, fontSize: 13 }} accessibilityLabel={t("phoneReq.left", { time: mmss(secondsLeft(r)) })}>{mmss(secondsLeft(r))}</Text>
      </View>
      <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }}>{t("phoneReq.why", { reason: r.reason })}</Text>
      <Text style={{ color: c.text3, fontSize: 13, lineHeight: 18 }}>{t(isPhoto ? "phoneReq.photoNote" : "phoneReq.whereNote")}</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button small variant="accent" label={t(isPhoto ? "phoneReq.take" : "phoneReq.share")} onPress={isPhoto ? photo : where} disabled={busy === r.id} />
        <Button small variant="plain" label={t("phoneReq.refuse")} onPress={refuse} disabled={busy === r.id} />
      </View>
      {!!note && <Text style={{ color: c.text2, fontSize: 13 }}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, gap: 8 },
});
