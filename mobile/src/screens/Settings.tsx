import * as Application from "expo-application";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Modal, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Logo } from "../components/Character";
import { Icon } from "../components/Icon";
import { Button, Card, ErrorNote, Field, Row, Segmented, SectionTitle, tap, text } from "../components/ui";
import { errText, useT } from "../i18n";
import { ensurePermission, setBackgroundCheck } from "../notify";
import { openRelay, relayAvailable } from "../relay";
import { usePrefs, type ThemePref } from "../state/prefs";
import { useStore } from "../state/store";
import { useTheme } from "../theme";

function DeleteAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try { await useStore.getState().deleteAccount(password); onClose(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: c.surface, borderRadius: 20, padding: 18, gap: 14 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{t("account.delete")}</Text>
          <Text style={{ color: c.text2, fontSize: 15, lineHeight: 21 }}>{t("account.deleteHint")}</Text>
          <Field label={t("account.deletePassword")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          <ErrorNote>{error}</ErrorNote>
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" label={t("common.cancel")} onPress={onClose} disabled={busy} />
            <Button variant="danger" label={t("account.deleteConfirm")} busy={busy} disabled={!password} onPress={go} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SettingsScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const user = useStore((s) => s.user);
  const origin = useStore((s) => s.origin);
  const prefs = usePrefs();
  const [denied, setDenied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (prefs.notify) void ensurePermission(false).then((s) => setDenied(s === "blocked")); }, [prefs.notify]);
  const toggleNotify = async (on: boolean) => {
    tap();
    if (on) {
      const s = await ensurePermission(true);
      setDenied(s === "blocked");
      if (s !== "granted") return;
    }
    prefs.set({ notify: on });
    await setBackgroundCheck(on);
  };
  const version = `${Application.nativeApplicationVersion ?? "1.0.0"} (${Application.nativeBuildVersion ?? "1"})`;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text accessibilityRole="header" style={[text.h1, { color: c.text, marginBottom: 4 }]}>{t("settings.title")}</Text>

      <SectionTitle>{t("settings.account")}</SectionTitle>
      <Card style={{ padding: 0 }}>
        <Row icon="user" title={user?.name || user?.email || ""} subtitle={user?.name ? user.email : undefined} />
        <Row icon="globe" title={t("settings.server")} subtitle={origin ?? ""} onPress={() => Alert.alert(t("server.change"), t("settings.changeServerConfirm"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.continue"), onPress: async () => { await useStore.getState().signOut(); await useStore.getState().forgetServer(); } },
        ])} />
      </Card>

      <SectionTitle>{t("settings.language")}</SectionTitle>
      <Segmented label={t("settings.language")} value={t.locale} onChange={(l) => prefs.set({ locale: l })} options={[{ id: "fr", label: "Français" }, { id: "en", label: "English" }]} />

      <SectionTitle>{t("settings.theme")}</SectionTitle>
      <Segmented<ThemePref> label={t("settings.theme")} value={prefs.theme} onChange={(v) => prefs.set({ theme: v })} options={[{ id: "system", label: t("settings.theme.system") }, { id: "light", label: t("settings.theme.light") }, { id: "dark", label: t("settings.theme.dark") }]} />

      <SectionTitle>{t("settings.notifications")}</SectionTitle>
      <Card style={{ padding: 0 }}>
        <Row title={t("settings.notifyOn")} subtitle={t("settings.notifyHint")} right={<Switch value={prefs.notify && !denied} onValueChange={(v) => void toggleNotify(v)} accessibilityLabel={t("settings.notifyOn")} />} />
        {denied && prefs.notify ? <Row icon="alert" title={t("settings.notifyDenied")} subtitle={t("settings.openSystem")} onPress={() => void Linking.openSettings()} /> : null}
      </Card>

      {relayAvailable ? (
        <>
          <SectionTitle>{t("settings.phone")}</SectionTitle>
          <Card style={{ padding: 0 }}>
            <Row icon="phone" title={t("settings.phoneOpen")} subtitle={t("settings.phoneHint")} onPress={() => openRelay()} />
          </Card>
        </>
      ) : null}

      <SectionTitle>{t("settings.web")}</SectionTitle>
      <Card style={{ padding: 0 }}>
        <Row icon="external" title={t("settings.openWeb")} subtitle={t("settings.webHint")} onPress={() => origin && void WebBrowser.openBrowserAsync(origin)} />
      </Card>

      <SectionTitle>{t("settings.about")}</SectionTitle>
      <Card style={{ padding: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
          <Logo size={40} />
          <View>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>Sklubot</Text>
            <Text style={{ color: c.text3, fontSize: 13 }}>{t("settings.version", { v: version })}</Text>
          </View>
        </View>
        <Row icon="info" title={t("settings.privacy")} onPress={() => origin && void WebBrowser.openBrowserAsync(`${origin}/confidentialite`)} />
      </Card>

      <View style={{ height: 18 }} />
      <Card style={{ padding: 0 }}>
        <Row icon="logout" danger title={t("settings.signOut")} right={<Icon name="chevron" size={18} color={c.text3} />} onPress={() => Alert.alert(t("settings.signOut"), t("settings.signOutConfirm"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("settings.signOut"), style: "destructive", onPress: () => void useStore.getState().signOut() },
        ])} />
        <Row icon="close" danger title={t("account.delete")} subtitle={t("account.deleteHint")} onPress={() => setDeleting(true)} />
      </Card>
      <DeleteAccount open={deleting} onClose={() => setDeleting(false)} />
    </ScrollView>
    </View>
  );
}
