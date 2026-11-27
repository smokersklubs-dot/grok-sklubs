/** First run: the server address, then sign in (or create an account when the server allows it). */
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { normalizeOrigin, DEFAULT_SERVER } from "../api/origin";
import { Logo } from "../components/Character";
import { LanguageChoice } from "../components/LanguageChoice";
import { Button, ErrorNote, Field } from "../components/ui";
import { errText, useT } from "../i18n";
import { usePrefs } from "../state/prefs";
import { useStore } from "../state/store";
import { useTheme } from "../theme";

function Frame({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Brand() {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={styles.brand}>
      <Logo size={64} />
      <Text style={[styles.brandName, { color: c.text }]}>Sklubot</Text>
      <Text style={[styles.tagline, { color: c.text2 }]}>{t("signin.tagline")}</Text>
    </View>
  );
}

function LanguagePicker() {
  const t = useT();
  const set = usePrefs((p) => p.set);
  return <LanguageChoice label="Language / Langue / Idioma" value={t.locale} onChange={(l) => set({ locale: l })} />;
}

export function ServerScreen() {
  const { c } = useTheme();
  const t = useT();
  const origin = useStore((s) => s.origin);
  const [value, setValue] = useState(origin ?? DEFAULT_SERVER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const n = normalizeOrigin(value);
    if (!n.ok) { setError(t(n.reason === "empty" ? "server.errEmpty" : n.reason === "insecure" ? "server.errInsecure" : "server.errInvalid")); return; }
    setBusy(true);
    setError(null);
    const r = await useStore.getState().setServer(n.origin);
    setBusy(false);
    if (!r.ok) setError(t(r.reason === "unreachable" ? "server.errUnreachable" : "server.errNotSklubot"));
  };
  return (
    <Frame>
      <Brand />
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t("server.title")}</Text>
        <Text style={{ color: c.text2, fontSize: 15, lineHeight: 21 }}>{t("server.intro")}</Text>
        <Field testID="server-url" label={t("server.label")} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={submit} textContentType="URL" />
        <ErrorNote>{error}</ErrorNote>
        <Button label={busy ? t("server.check") : t("server.connect")} busy={busy} onPress={submit} />
      </View>
      <LanguagePicker />
    </Frame>
  );
}

export function SignInScreen() {
  const { c } = useTheme();
  const t = useT();
  const me = useStore((s) => s.me);
  const origin = useStore((s) => s.origin);
  const signupOpen = !!me?.signupOpen;
  const setupCodeRequired = !!me?.setupCodeRequired;
  const [mode, setMode] = useState<"login" | "signup">(signupOpen ? "signup" : "login");
  const creating = mode === "signup" && signupOpen;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [botName, setBotName] = useState("");
  const [botLabel, setBotLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Two-factor on (server twofactor.ts): the password answered with a pending token; the code is asked next.
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => { if (!signupOpen) setMode("login"); }, [signupOpen]);

  const submit = async () => {
    if (busy) return;
    const mail = email.trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(mail)) return setError(t("signin.errEmail"));
    if (!password) return setError(t("signin.errPassword"));
    if (creating && password.length < 8) return setError(t("signin.errShort"));
    if (creating && setupCodeRequired && !setupCode.trim()) return setError(t("signin.errSetupCode"));
    setBusy(true);
    setError(null);
    try {
      const s = useStore.getState();
      if (creating) await s.signUp({ email: mail, password, name: name.trim() || undefined, setupCode: setupCodeRequired ? setupCode.trim() : undefined, botName: botName.trim() || undefined, botLabel: botLabel.trim() || undefined });
      else {
        const r = await s.signIn(mail, password);
        if (r?.twoFactor) { setPending(r.twoFactor); setBusy(false); return; }
      }
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy || !pending || !code.trim()) return;
    setBusy(true);
    setError(null);
    try { await useStore.getState().verifySecondStep(pending, code); } catch (e) {
      setError(errText(e));
      setCode("");
      // Expired or too many wrong codes: back to the password.
      if (e instanceof Error && "status" in e && (e as { status?: number }).status === 410) setPending(null);
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <Frame>
        <Brand />
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t("signin.secondTitle")}</Text>
          <Text style={{ color: c.text2, fontSize: 15, lineHeight: 21 }}>{t("signin.secondHint")}</Text>
          <Field testID="signin-code" label={t("signin.codeLabel")} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" returnKeyType="go" onSubmitEditing={verify} />
          <ErrorNote>{error}</ErrorNote>
          <Button label={t(busy ? "signin.signingIn" : "signin.signIn")} busy={busy} onPress={verify} />
          <Pressable accessibilityRole="button" onPress={() => { setPending(null); setCode(""); setError(null); }} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: c.info, fontWeight: "600" }}>{t("signin.secondBack")}</Text>
          </Pressable>
        </View>
      </Frame>
    );
  }

  return (
    <Frame>
      <Brand />
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t(creating ? "signin.create" : "signin.signIn")}</Text>
        {creating ? <Field label={t("signin.name")} value={name} onChangeText={setName} placeholder={t("signin.namePlaceholder")} autoComplete="name" maxLength={80} /> : null}
        <Field testID="signin-email" label={t("signin.email")} value={email} onChangeText={setEmail} placeholder={t("signin.emailPlaceholder")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
        <Field ref={pwRef} testID="signin-password" label={t("signin.password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={creating ? "new-password" : "current-password"} textContentType={creating ? "newPassword" : "password"} hint={creating ? t("signin.passwordHint") : undefined} returnKeyType="go" onSubmitEditing={submit} />
        {creating && setupCodeRequired ? <Field label={t("signin.setupCode")} value={setupCode} onChangeText={setSetupCode} autoCapitalize="none" autoCorrect={false} hint={t("signin.setupCodeHint")} /> : null}
        {creating ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: c.text2, fontWeight: "700", marginTop: 4 }}>{t("signin.firstBot")}</Text>
            <Field label={t("signin.firstBotName")} value={botName} onChangeText={setBotName} placeholder={me?.firstBot.name} maxLength={60} />
            <Field label={t("signin.firstBotLabel")} value={botLabel} onChangeText={setBotLabel} placeholder={me?.firstBot.label} maxLength={60} />
          </View>
        ) : null}
        <ErrorNote>{error}</ErrorNote>
        <Button label={t(busy ? (creating ? "signin.creating" : "signin.signingIn") : creating ? "signin.createBtn" : "signin.signIn")} busy={busy} onPress={submit} />
        {!creating ? <Text style={{ color: c.text3, fontSize: 13, lineHeight: 18 }}>{t("signin.passkeyNote")}</Text> : null}{/* L44: passkeys are web-only for now */}
        {signupOpen ? (
          <Pressable accessibilityRole="button" onPress={() => { setMode(creating ? "login" : "signup"); setError(null); }} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: c.text2 }}>{t(creating ? "signin.haveAccount" : "signin.newHere")} <Text style={{ color: c.info, fontWeight: "600" }}>{t(creating ? "signin.signIn" : "signin.createLink")}</Text></Text>
          </Pressable>
        ) : <Text style={{ color: c.text3, fontSize: 13, textAlign: "center" }}>{t("signin.closed")}</Text>}
      </View>
      <Text style={{ color: c.text3, fontSize: 13, textAlign: "center", lineHeight: 18 }}>{t("signin.foot")}</Text>
      <Pressable accessibilityRole="button" onPress={() => void useStore.getState().forgetServer()} style={{ alignSelf: "center", padding: 8 }}>
        <Text style={{ color: c.text2, fontSize: 14 }}>{origin?.replace(/^https?:\/\//, "")} · <Text style={{ color: c.info }}>{t("server.change")}</Text></Text>
      </Pressable>
      <LanguagePicker />
    </Frame>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, gap: 18, flexGrow: 1, maxWidth: 520, width: "100%", alignSelf: "center" },
  brand: { alignItems: "center", gap: 8, marginBottom: 4 },
  brandName: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  tagline: { fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 12 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 14 },
  title: { fontSize: 21, fontWeight: "700" },
});

