import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Connector } from "../../../server/src/shared";
import { featuredRepositories, isGithubConnector, repositoryName } from "../../../server/src/clientshared/chatmentions";
import { useStore } from "../state/store";
import { errText, useT } from "../i18n";
import { useTheme } from "../theme";
import { ConnectSheet } from "./ConnectSheet";
import { Button, ErrorNote } from "./ui";

export function ChatSources({ botId, query, insert }: { botId: string; query: string; insert: (value: string) => void }) {
  const t = useT();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [apps, setApps] = useState<Connector[]>([]);
  const [sheet, setSheet] = useState<"repos" | "setup" | null>(null);
  const [setup, chooseSetup] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    let alive = true;
    useStore.getState().call<{ connectors: Connector[] }>("GET", "/connectors").then(r => {
      if (alive) setApps(r.connectors.filter(a => a.status === "ready"));
    }, () => {});
    return () => { alive = false; };
  }, [sheet === "setup", botId]);
  const connect = (name: string) => { chooseSetup(name); setSheet("setup"); };
  const account = apps.some(a => isGithubConnector(a.url) && a.tools.some(t => t.name === "search_repositories" && t.readOnly));
  const voice = apps.some(a => a.name.toLowerCase() === "voicestudio");
  const rows = [
    { name: "GitHub", label: t("mention.gh"), pick: () => setSheet("repos") },
    { name: "VoiceStudio", label: t(voice ? "mention.connected" : "mention.setup", { name: "VoiceStudio" }), pick: () => voice ? insert("@[VoiceStudio]") : connect("VoiceStudio") },
    ...apps.filter(a => a.name.toLowerCase() !== "voicestudio" && !isGithubConnector(a.url)).map(a => ({ name: a.name, label: a.name, pick: () => insert("@[" + a.name + "]") })),
  ].filter(row => row.name.toLowerCase().includes(query));
  const attach = (name: string) => { setSheet(null); insert("@GitHub https://github.com/" + name); };
  const lookup = async () => {
    const direct = repositoryName(search);
    if (direct) { attach(direct); return; }
    const request = ++version.current;
    const call = useStore.getState().call;
    setBusy(true); setError("");
    try {
      const r = account
        ? await call<{ repositories: { name: string }[] }>("POST", "/connectors/github/account-search", { query: search.trim() })
        : await call<{ repositories: { name: string }[] }>("GET", "/connectors/github/public-search?q=" + encodeURIComponent(search.trim()));
      if (request === version.current) setResults(r.repositories.map(r => r.name));
    } catch (err) { if (request === version.current) setError(errText(err)); }
    finally { if (request === version.current) setBusy(false); }
  };
  return <>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 176 }}>
      {rows.map((row, index) => <Pressable key={index} accessibilityRole="button" onPress={row.pick} style={{ minHeight: 44, padding: 10 }}>
        <Text style={{ color: c.text, fontWeight: "600" }}>{row.label}</Text>
      </Pressable>)}
    </ScrollView>
    {sheet === "setup" && <ConnectSheet name={setup} botId={botId} onClose={() => setSheet(null)} />}
    {sheet === "repos" && <Modal visible onRequestClose={() => setSheet(null)} presentationStyle="pageSheet" animationType="slide">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, flexGrow: 1, backgroundColor: c.bg }}>
        <Text accessibilityRole="header" style={{ fontWeight: "700", color: c.text, fontSize: 19 }}>{t("mention.gh")}</Text>
        <TextInput value={search} maxLength={240} autoCapitalize="none" autoCorrect={false} placeholder={t("mention.query")} placeholderTextColor={c.text3} accessibilityLabel={t("mention.query")}
          style={{ minHeight: 48, borderColor: c.border, borderWidth: 1, padding: 10, color: c.text }} onChangeText={s => { version.current++; setBusy(false); setSearch(s); setResults(null); setError(""); }} />
        <Button label={t(repositoryName(search) ? "mention.join" : account ? "mention.account" : "mention.public")} disabled={!search.trim() || busy} busy={busy} onPress={() => void lookup()} />
        <ErrorNote>{error}</ErrorNote>
        {(results ?? featuredRepositories).map(name => <Button key={name} label={name} variant="ghost" onPress={() => attach(name)} />)}
        {results?.length === 0 && <Text style={{ color: c.text3 }}>{t("mention.none")}</Text>}
        <View><Button label={t("mention.setup", { name: "GitHub" })} variant="plain" onPress={() => connect("GitHub Repositories")} />
          <Button label={t("common.close")} variant="plain" onPress={() => setSheet(null)} /></View>
      </ScrollView>
    </Modal>}
  </>;
}
