/**
 * A bot's computer screen, natively: watch it, or take control (taps → clicks, typed text, keys, scroll, an address).
 * Same server calls as the web viewer's screenshot mode (web/src/components/ComputerViewer.tsx): GET /bots/:id/screen
 * every second (JPEG, 204 when no desktop is open), POST /bots/:id/screen/input, POST /bots/:id/desktop/control
 * { on: true } every 30 s while in control (the bot's own screen actions wait meanwhile), POST /bots/:id/desktop/handback
 * when control ends, POST /bots/:id/takeover/:id/done for "I'm done" on a takeover.
 *
 * The web also offers a live stream of Linux screens (noVNC over the /api/bots/:id/vnc WebSocket, RFB protocol). There
 * is no maintained React Native RFB client; the screenshot mode works for both computer kinds (linux and browser) and is
 * what the web itself falls back to, so the app uses it (1 frame per second, refreshed right after each input).
 */
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Card } from "../api/types";
import { Character } from "../components/Character";
import { Icon } from "../components/Icon";
import { Button, ErrorNote } from "../components/ui";
import { errText, useT, type Key } from "../i18n";
import { jpegSize, normalizeAddress, toBase64, toScreenPoint } from "../lib/screen";
import { useStore } from "../state/store";
import { radius, useTheme } from "../theme";
import type { RootStack } from "./types";

type Status = "loading" | "none" | "ok" | "error";
type Input = { type: "click"; x: number; y: number } | { type: "type"; text: string } | { type: "key"; key: string } | { type: "scroll"; x: number; y: number; dy: number } | { type: "goto"; url: string };
const KEYS = ["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
const enc = encodeURIComponent;

/** Polls the screenshot while the screen is focused and the app in front. */
function useScreenshot(botId: string, intervalMs: number) {
  const [frame, setFrame] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const load = useRef<() => void>(() => undefined);
  useFocusEffect(useCallback(() => {
    let dead = false;
    let busy = false;
    const tick = async () => {
      if (dead || busy || AppState.currentState !== "active") return;
      const client = useStore.getState().client;
      if (!client) return;
      busy = true;
      try {
        const r = await client.bytes(`/bots/${enc(botId)}/screen`);
        if (dead) return;
        if (!r.bytes) { setFrame(null); setStatus("none"); return; }
        const size = jpegSize(r.bytes);
        if (!size) { setStatus("error"); return; }
        setFrame({ uri: `data:image/jpeg;base64,${toBase64(r.bytes)}`, w: size.width, h: size.height });
        setStatus("ok");
      } catch {
        if (!dead) setStatus("error");
      } finally { busy = false; }
    };
    load.current = () => void tick();
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => { dead = true; clearInterval(timer); load.current = () => undefined; };
  }, [botId, intervalMs]));
  return { frame, status, refresh: useCallback(() => load.current(), []) };
}

export function ComputerScreen() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { botId, control: startInControl } = useRoute<RouteProp<RootStack, "Computer">>().params;
  const bot = useStore((s) => s.bots[botId]);
  const [control, setControl] = useState(!!startInControl);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [linux, setLinux] = useState(false);
  const [waking, setWaking] = useState(false);
  const { frame, status, refresh } = useScreenshot(botId, 1000);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controlling = useRef(false);

  // The pending takeover of this bot, if any (the newest takeover card).
  const takeover = useStore((s) => {
    const rows = s.threads[botId]?.rows ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const b = rows[i].body;
      if (b.kind === "card" && b.card.type === "takeover") return b.card.status === "pending" ? (b.card as Extract<Card, { type: "takeover" }>) : null;
    }
    return null;
  });

  useEffect(() => {
    useStore.getState().call<{ kind: string; desktops: { botId: string; open: boolean }[] }>("GET", "/computer")
      .then((r) => setLinux(r.kind === "linux")).catch(() => undefined);
  }, []);

  const handBack = useCallback(() => {
    if (!controlling.current) return;
    controlling.current = false;
    useStore.getState().call("POST", `/bots/${enc(botId)}/desktop/handback`).catch(() => undefined);
  }, [botId]);

  // While in control the server is told so, and reminded every 30 s (as the web viewer does).
  useEffect(() => {
    if (!control) return;
    controlling.current = true;
    const hold = () => useStore.getState().call("POST", `/bots/${enc(botId)}/desktop/control`, { on: true }).catch(() => undefined);
    void hold();
    const timer = setInterval(hold, 30_000);
    return () => clearInterval(timer);
  }, [control, botId]);
  // Leaving the screen while in control hands the screen back.
  useEffect(() => () => { clearTimeout(refreshTimer.current); handBack(); }, [handBack]);

  const send = useCallback((input: Input) => {
    chain.current = chain.current
      .then(() => useStore.getState().call("POST", `/bots/${enc(botId)}/screen/input`, input))
      .then(() => { setError(null); clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(refresh, 250); }, (e: unknown) => setError(errText(e)));
  }, [botId, refresh]);

  const onTap = (e: GestureResponderEvent) => {
    if (!control || !frame) return;
    const p = toScreenPoint(e.nativeEvent.locationX, e.nativeEvent.locationY, box.w, box.h, frame.w, frame.h);
    if (p) send({ type: "click", ...p });
  };
  const scroll = (dy: number) => { if (frame) send({ type: "scroll", x: Math.round(frame.w / 2), y: Math.round(frame.h / 2), dy }); };
  const leave = () => { setControl(false); handBack(); };
  const finish = async () => {
    if (!takeover) return;
    controlling.current = false;
    try {
      await useStore.getState().call("POST", `/bots/${enc(botId)}/takeover/${enc(takeover.takeoverId)}/done`);
      nav.goBack();
    } catch (e) { setError(errText(e)); }
  };
  const wake = async () => {
    setWaking(true);
    try { await useStore.getState().call("POST", `/bots/${enc(botId)}/desktop/wake`); } catch (e) { setError(errText(e)); }
    setWaking(false);
    refresh();
  };

  if (!bot) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const statusText = status === "ok" ? t(control ? "viewer.inControl" : "viewer.watching") : status === "none" ? t(linux ? "viewer.asleep" : "viewer.noDesktop") : status === "error" ? t("viewer.unreachable") : t("common.loading");

  return (
    <View style={{ flex: 1, backgroundColor: "#0e0f11" }}>
      <View style={[styles.bar, { paddingTop: insets.top + 6, backgroundColor: c.surface, borderColor: c.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => nav.goBack()} hitSlop={8} style={styles.barBtn}><Icon name="back" size={24} color={c.text} /></Pressable>
        <Character bot={bot} size={30} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{t("viewer.title", { name: bot.name })}</Text>
          <Text numberOfLines={1} style={{ color: control && status === "ok" ? c.danger : c.text3, fontSize: 13 }}>{statusText}</Text>
        </View>
        {control ? <Button small variant="ghost" label={t("viewer.handBack")} onPress={leave} /> : <Button small variant="primary" icon="cursor" label={t("viewer.take")} onPress={() => setControl(true)} />}
      </View>
      {control || takeover ? (
        <View style={[styles.banner, { backgroundColor: takeover ? c.warnSoft : c.dangerSoft }]}>
          <Icon name="hand" size={15} color={takeover ? c.warn : c.danger} />
          <Text style={{ color: takeover ? c.warn : c.danger, fontSize: 13, flex: 1 }}>{takeover ? t("takeover.bar", { name: bot.name }) : t("viewer.controlHint")}</Text>
        </View>
      ) : null}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityRole="image" accessibilityLabel={t("viewer.screenAlt", { name: bot.name })} disabled={!control} onPress={onTap} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={styles.stage}>
          {frame ? (
            <Image source={{ uri: frame.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={0} cachePolicy="none" />
          ) : status === "none" ? (
            <View style={styles.empty}>
              <Icon name="monitor" size={40} color="#9aa0a8" />
              <Text style={styles.emptyTitle}>{linux ? t("viewer.asleepTitle", { name: bot.name }) : t("viewer.noDesktopTitle")}</Text>
              <Text style={styles.emptyText}>{linux ? t("viewer.asleepText") : t("viewer.noDesktopText", { name: bot.name })}</Text>
              {linux ? <Button variant="accent" label={t(waking ? "viewer.waking" : "viewer.wake")} busy={waking} onPress={() => void wake()} /> : null}
            </View>
          ) : status === "error" ? (
            <View style={styles.empty}>
              <Icon name="alert" size={40} color="#9aa0a8" />
              <Text style={styles.emptyTitle}>{t("viewer.unreachable")}</Text>
              <Text style={styles.emptyText}>{t("viewer.unreachableText")}</Text>
              <Button variant="ghost" label={t("viewer.retry")} onPress={refresh} color="#fff" />
            </View>
          ) : <ActivityIndicator color="#fff" />}
        </Pressable>
        <View style={[styles.foot, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + 8 }]}>
          <ErrorNote>{error}</ErrorNote>
          {control ? (
            <>
              <View style={styles.rowLine}>
                <TextInput value={address} onChangeText={setAddress} placeholder={t("viewer.address")} placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t("viewer.address")} onSubmitEditing={() => { const u = normalizeAddress(address); if (u) send({ type: "goto", url: u }); }} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
                <Button small variant="ghost" label={t("viewer.go")} disabled={!address.trim()} onPress={() => { const u = normalizeAddress(address); if (u) send({ type: "goto", url: u }); }} />
              </View>
              <View style={styles.rowLine}>
                <TextInput value={text} onChangeText={setText} placeholder={t("viewer.type")} placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("viewer.type")} onSubmitEditing={() => { if (text) { send({ type: "type", text }); setText(""); } }} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface2 }]} />
                <Button small variant="ghost" icon="keyboard" label={t("viewer.send")} disabled={!text} onPress={() => { send({ type: "type", text }); setText(""); }} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {KEYS.map((k) => (
                  <Pressable key={k} accessibilityRole="button" accessibilityLabel={k.startsWith("Arrow") ? k : t(`viewer.key.${k}` as Key)} onPress={() => send({ type: "key", key: k })} style={[styles.key, { borderColor: c.borderStrong }]}>
                    {k.startsWith("Arrow") ? <View style={{ transform: [{ rotate: k === "ArrowUp" ? "0deg" : k === "ArrowRight" ? "90deg" : k === "ArrowDown" ? "180deg" : "270deg" }] }}><Icon name="up" size={16} color={c.text} /></View>
                      : <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>{t(`viewer.key.${k}` as Key)}</Text>}
                  </Pressable>
                ))}
                <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.scrollUp")} onPress={() => scroll(-400)} style={[styles.key, { borderColor: c.borderStrong }]}><Icon name="up" size={16} color={c.text} /><Icon name="up" size={16} color={c.text} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.scrollDown")} onPress={() => scroll(400)} style={[styles.key, { borderColor: c.borderStrong }]}><Icon name="down" size={16} color={c.text} /><Icon name="down" size={16} color={c.text} /></Pressable>
              </ScrollView>
            </>
          ) : <Text style={{ color: c.text3, fontSize: 13 }}>{t("viewer.watchingHint", { name: bot.name })}</Text>}
          {takeover ? <Button variant="accent" icon="check" label={t("takeover.done")} onPress={() => void finish()} /> : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  barBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 10, padding: 24 },
  emptyTitle: { color: "#eceef1", fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyText: { color: "#a7adb5", fontSize: 14, textAlign: "center", lineHeight: 20 },
  foot: { gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  rowLine: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
  key: { minWidth: 44, height: 36, borderWidth: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, flexDirection: "row" },
});
