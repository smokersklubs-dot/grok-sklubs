/**
 * "Connect <app>" from a bot's card: the server's catalogue of apps, filtered on the name the bot asked for, with the
 * same calls as the web's connectors window (web/src/components/Modals.tsx, CatalogCard and ConnectorsModal):
 * POST /connectors (with botId + seq so the card resolves), POST /connectors/:id/oauth/start for apps that sign in on
 * their own page (opened in the system browser; the server's callback finishes it and updates the card through the
 * live channel). Built-in apps (Gmail, Outlook…) need their own OAuth client set up on the website.
 */
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CatalogApp, Connector } from "../../../server/src/shared";
import { errText, useT } from "../i18n";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import { answersCard, rankApps, sameUrl } from "../lib/catalog";
import { SecretInput, useBusy } from "./cardKit";
import { Icon } from "./Icon";
import { Button, ErrorNote, Loading } from "./ui";


function AppRow({ app, existing, asked, botId, seq, redirectUri, onDone }: { app: CatalogApp; existing?: Connector; asked: string; botId: string; seq?: number; redirectUri: string; onDone: (msg: string | null) => void }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [askClient, setAskClient] = useState(app.oauthClient === "manual");
  const { busy, error, run } = useBusy();
  const needsToken = app.auth === "token";
  const oauth = app.auth === "oauth";
  const card = seq !== undefined && answersCard(app.name, asked) ? { botId, seq } : {};
  const signedIn = existing?.status === "ready";
  const blocked = !!busy || (app.instanceUrl && !/^https:\/\/\S+$/i.test(endpoint.trim())) || (needsToken && !token.trim()) || (oauth && askClient && !clientId.trim());
  useEffect(() => () => { setToken(""); setClientSecret(""); }, []);

  const submit = () => run("go", async () => {
    const s = useStore.getState();
    const client = askClient && clientId.trim() ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined } : {};
    let target = existing;
    if (!target) {
      target = (await s.call<{ connector: Connector }>("POST", "/connectors", {
        name: app.name, url: app.instanceUrl ? endpoint.trim() : app.url,
        ...(app.instanceUrl ? { catalogId: app.id } : {}),
        ...(needsToken ? { token: token.trim() } : {}),
        ...(oauth ? { auth: "oauth", ...client } : card),
      })).connector;
    }
    if (target.status === "error" && !oauth) throw new Error(target.error || t("connect.failed"));
    setToken("");
    setClientSecret("");
    if (oauth) {
      const r = await s.call<{ authorizeUrl?: string; needsClientId?: boolean }>("POST", `/connectors/${encodeURIComponent(target.id)}/oauth/start`, { ...client, ...card });
      if (r.needsClientId) { setAskClient(true); return; }
      // The provider's page in the system browser (a Custom Tab): the app never sees the password typed there.
      // https://docs.expo.dev/versions/v58.0.0/sdk/webbrowser/#webbrowseropenbrowserasyncurl-browserparams
      if (r.authorizeUrl) await WebBrowser.openBrowserAsync(r.authorizeUrl);
      onDone(t("connect.added", { name: app.name }));
      return;
    }
    onDone(null);
  });

  return (
    <View style={[styles.app, { borderColor: c.border, backgroundColor: c.surface }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={[styles.logo, { backgroundColor: c.surface3 }]}><Text style={{ color: c.text2, fontWeight: "700" }}>{(Array.from(app.name)[0] ?? "?").toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{app.name}</Text>
          <Text style={{ color: c.text3, fontSize: 13 }} numberOfLines={2}>{app.description}</Text>
        </View>
        {signedIn ? <Icon name="check" size={18} color={c.ok} /> : app.native ? null : (
          <Button small variant={open ? "plain" : "ghost"} label={open ? t("common.cancel") : t("connect.btn")} onPress={() => setOpen((v) => !v)} accessibilityLabel={`${t("connect.btn")} ${app.name}`} />
        )}
      </View>
      {app.native ? <Text style={{ color: c.text3, fontSize: 13 }}>{t("connect.builtin")}</Text> : null}
      {open && !signedIn && !app.native ? (
        <View style={{ gap: 8 }}>
          {app.instanceUrl && <TextInput value={endpoint} onChangeText={setEndpoint} accessibilityLabel="URL VoiceStudio" placeholder="https://…/mcp/" autoCapitalize="none" keyboardType="url" style={[styles.input, { color: c.text, borderColor: c.border }]} />}
          {needsToken ? (
            <>
              <View style={{ flexDirection: "row" }}><SecretInput value={token} onChangeText={setToken} placeholder={t("connect.token")} label={t("connect.token")} /></View>
              {app.tokenHelp ? <Text style={{ color: c.text3, fontSize: 13 }}>{app.tokenHelp}</Text> : null}
              <Text style={{ color: c.text3, fontSize: 13 }}>{t("connect.tokenStored")}</Text>
            </>
          ) : oauth ? (
            <>
              <Text style={{ color: c.text2, fontSize: 13 }}>{t("connect.oauthNote", { name: app.name })}</Text>
              {askClient ? (
                <>
                  <Text style={{ color: c.text2, fontSize: 13 }}>{t("connect.clientNeeded")}</Text>
                  {redirectUri ? <Text selectable style={{ color: c.text, fontSize: 13, fontFamily: "monospace" }}>{t("connect.redirect", { uri: redirectUri })}</Text> : null}
                  {app.tokenHelp ? <Text style={{ color: c.text3, fontSize: 13 }}>{app.tokenHelp}</Text> : null}
                  <TextInput value={clientId} onChangeText={setClientId} placeholder={t("connect.clientId")} placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("connect.clientId")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
                  <View style={{ flexDirection: "row" }}><SecretInput value={clientSecret} onChangeText={setClientSecret} placeholder={t("connect.clientSecret")} label={t("connect.clientSecret")} /></View>
                </>
              ) : app.tokenHelp ? <Text style={{ color: c.text3, fontSize: 13 }}>{app.tokenHelp}</Text> : null}
            </>
          ) : <Text style={{ color: c.text3, fontSize: 13 }}>{t("connect.noToken")}</Text>}
          <ErrorNote>{error}</ErrorNote>
          <Button small variant="primary" label={oauth ? t("connect.signInWith", { name: app.name }) : t("connect.btn")} busy={busy === "go"} disabled={blocked} onPress={() => void submit()} style={{ alignSelf: "flex-end" }} />
        </View>
      ) : null}
    </View>
  );
}

/** "Another app": a name, the address of its remote MCP server and an optional token (POST /connectors, like the web). */
function Manual({ asked, botId, seq, onDone }: { asked: string; botId: string; seq?: number; onDone: (msg: string | null) => void }) {
  const { c } = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(asked);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(() => () => setToken(""), []);
  const valid = !!name.trim() && /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 8 }}>
        <Icon name={open ? "down" : "chevron"} size={16} color={c.text2} />
        <Text style={{ color: c.text2, fontSize: 15, fontWeight: "600" }}>{t("connect.manual")}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.text3, fontSize: 13 }}>{t("connect.manualIntro")}</Text>
          <TextInput value={name} onChangeText={setName} maxLength={60} placeholder={t("connect.name")} placeholderTextColor={c.text3} accessibilityLabel={t("connect.name")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
          <TextInput value={url} onChangeText={setUrl} placeholder="https://example.com/mcp" placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t("connect.url")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
          <View style={{ flexDirection: "row" }}><SecretInput value={token} onChangeText={setToken} placeholder={t("connect.token")} label={t("connect.token")} /></View>
          <ErrorNote>{error}</ErrorNote>
          <Button small variant="primary" label={t("connect.btn")} busy={!!busy} disabled={!valid || !!busy} style={{ alignSelf: "flex-end" }} onPress={() => void run("m", async () => {
            const r = await useStore.getState().call<{ connector: Connector }>("POST", "/connectors", { name: name.trim(), url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}), ...(seq !== undefined ? { botId, seq } : {}) });
            setToken("");
            onDone(r.connector.status === "needs_auth" ? t("connect.added", { name: r.connector.name }) : null);
          })} />
        </View>
      ) : null}
    </View>
  );
}

export function ConnectSheet({ name, botId, seq, onClose }: { name: string; botId: string; seq?: number; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [apps, setApps] = useState<CatalogApp[] | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [redirectUri, setRedirectUri] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const s = useStore.getState();
    Promise.all([s.call<{ apps: CatalogApp[]; oauthRedirectUri?: string }>("GET", "/connectors/catalog"), s.call<{ connectors: Connector[] }>("GET", "/connectors").catch(() => ({ connectors: [] as Connector[] }))]).then(
      ([cat, con]) => { if (dead) return; setApps(Array.isArray(cat?.apps) ? cat.apps : []); setRedirectUri(cat?.oauthRedirectUri ?? ""); setConnectors(con.connectors ?? []); },
      (e) => { if (!dead) setFailed(errText(e)); },
    );
    return () => { dead = true; };
  }, []);
  const list = useMemo(() => rankApps(apps ?? [], name, q), [apps, name, q]);
  const done = (msg: string | null) => { if (msg) setNote(msg); else onClose(); };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={[styles.bar, { borderColor: c.border, backgroundColor: c.surface }]}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontWeight: "700", flex: 1 }}>{t("connect.title", { name })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={onClose} hitSlop={10} style={{ padding: 6 }}><Icon name="close" size={22} color={c.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.text2, fontSize: 14, lineHeight: 20 }}>{t("connect.intro")}</Text>
          {note ? <View style={[styles.ok, { backgroundColor: c.okSoft }]}><Icon name="check" size={16} color={c.ok} /><Text style={{ color: c.ok, flex: 1 }}>{note}</Text></View> : null}
          <ErrorNote>{failed}</ErrorNote>
          {apps === null && !failed ? <Loading label={t("connect.loading")} /> : null}
          {apps && apps.length > 0 ? (
            <TextInput value={q} onChangeText={setQ} placeholder={t("connect.search")} placeholderTextColor={c.text3} accessibilityLabel={t("connect.search")} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]} />
          ) : null}
          {apps && list.length === 0 && q.trim() ? <Text style={{ color: c.text3 }}>{t("connect.none", { q: q.trim() })}</Text> : null}
          {list.map((app) => <AppRow key={app.id} app={app} existing={connectors.find((k) => app.instanceUrl ? k.name === app.name && k.status === "ready" : sameUrl(k.url, app.url))} asked={name} botId={botId} seq={seq} redirectUri={redirectUri} onDone={done} />)}
          {apps !== null || failed ? <Manual asked={name} botId={botId} seq={seq} onDone={done} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  app: { borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
  ok: { flexDirection: "row", gap: 8, padding: 12, borderRadius: radius.md, alignItems: "center" },
});
