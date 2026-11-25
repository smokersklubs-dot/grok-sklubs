import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Icon } from "./src/components/Icon";
import { useT } from "./src/i18n";
import { ensurePermission, setBackgroundCheck } from "./src/notify";
import { useLive } from "./src/live";
import { openRelay } from "./src/relay";
import { BotsScreen } from "./src/screens/Bots";
import { ChatScreen } from "./src/screens/Chat";
import { ComputerScreen } from "./src/screens/Computer";
import { DetailsScreen } from "./src/screens/Details";
import { SettingsScreen } from "./src/screens/Settings";
import { TasksScreen } from "./src/screens/Tasks";
import { InboxScreen, useInbox } from "./src/screens/Inbox";
import { ChantiersScreen } from "./src/screens/Chantiers";
import { DashboardScreen } from "./src/screens/Dashboard";
import { clearBotTheme, loadBotTheme } from "./src/theme/botTheme";
import type { RootStack } from "./src/screens/types";
import { ServerScreen, SignInScreen } from "./src/screens/Welcome";
import { usePrefs } from "./src/state/prefs";
import { useStore } from "./src/state/store";
import { useTheme } from "./src/theme";
import { endCall } from "./src/voice/call";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const Stack = createNativeStackNavigator<RootStack & { Server: undefined; SignIn: undefined }>();
const Tabs = createBottomTabNavigator();
const navRef = createNavigationContainerRef<RootStack>();
let initialUrlHandled = false;

function MainTabs() {
  const { c } = useTheme();
  const t = useT();
  const waiting = useStore((s) => Object.values(s.bots).reduce((n, b) => n + (b.unread > 0 || s.live[b.id]?.awaiting ? 1 : 0), 0));
  const openTasks = useStore((s) => s.tasks?.filter((x) => x.state === "needs_input").length ?? 0);
  const inbox = useInbox().items?.length ?? 0; // « À toi » (L139 on the phone)
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: c.text, tabBarInactiveTintColor: c.text3, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border }, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" } }}>
      <Tabs.Screen name="Bots" component={BotsScreen} options={{ title: t("tabs.bots"), tabBarIcon: ({ color }) => <Icon name="bots" color={color} />, tabBarBadge: waiting || undefined, tabBarBadgeStyle: { backgroundColor: c.brand } }} />
      <Tabs.Screen name="Inbox" component={InboxScreen} options={{ title: t("tabs.inbox"), tabBarIcon: ({ color }) => <Icon name="hand" color={color} />, tabBarBadge: inbox || undefined, tabBarBadgeStyle: { backgroundColor: c.warn } }} />
      <Tabs.Screen name="Tasks" component={TasksScreen} options={{ title: t("tabs.tasks"), tabBarIcon: ({ color }) => <Icon name="tasks" color={color} />, tabBarBadge: openTasks || undefined, tabBarBadgeStyle: { backgroundColor: c.warn } }} />
      <Tabs.Screen name="Settings" component={SettingsScreen} options={{ title: t("tabs.settings"), tabBarIcon: ({ color }) => <Icon name="settings" color={color} /> }} />
    </Tabs.Navigator>
  );
}

/** sklubot://relay (the web app's "Link this phone") opens the phone-control screen; sklubot://bot/<id> a chat. */
function handleUrl(url: string | null) {
  if (!url) return;
  const parsed = Linking.parse(url);
  if (parsed.scheme !== "sklubot") return;
  if (parsed.hostname === "relay") { openRelay(); return; }
  const id = parsed.hostname === "bot" ? parsed.path?.split("/")[0] : null;
  if (id && navRef.isReady() && useStore.getState().bots[id]) navRef.navigate("Chat", { botId: id });
}

export default function App() {
  const { c, dark } = useTheme();
  const boot = useStore((s) => s.boot);
  const notify = usePrefs((p) => p.notify);
  const liveOn = useLive((l) => l.enabled);

  useEffect(() => { void useStore.getState().init(); }, []);
  useEffect(() => { if (boot !== "loading") SplashScreen.hideAsync().catch(() => undefined); }, [boot]);
  // Signed out (or the session lost): a call in progress ends.
  useEffect(() => { if (boot !== "ready") endCall(); }, [boot]);
  // L184: the owner's applied bot theme (a theme belongs to an account: cleared when signed out).
  useEffect(() => { if (boot === "ready") void loadBotTheme(useStore.getState().call); else clearBotTheme(); }, [boot]);
  useEffect(() => {
    if (boot !== "ready") return;
    // With the background connection on (complet build), the service notifies at once: no periodic check on top.
    void setBackgroundCheck(notify && !liveOn);
    // Asked once, after sign-in, while notifications are on (Android 13+ / iOS show the system prompt).
    if (notify) void ensurePermission(true);
  }, [boot, notify, liveOn]);

  // A tap on a notification opens that bot's chat.
  useEffect(() => {
    const open = (data: unknown) => {
      const id = (data as { botId?: string } | null)?.botId;
      if (id && navRef.isReady() && useStore.getState().bots[id]) navRef.navigate("Chat", { botId: id });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last && boot === "ready") setTimeout(() => open(last.notification.request.content.data), 300);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, [boot]);

  useEffect(() => {
    if (boot !== "ready") return;
    // The link that launched the app is handled once, not again after a later sign-in.
    if (!initialUrlHandled) { initialUrlHandled = true; void Linking.getInitialURL().then(handleUrl); }
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [boot]);

  const navTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: c.bg, card: c.surface, text: c.text, border: c.border, primary: c.brand } };
  }, [dark, c]);

  if (boot === "loading") return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? "light" : "dark"} />
      <NavigationContainer ref={navRef} theme={navTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "slide_from_right" }}>
          {boot === "server" ? <Stack.Screen name="Server" component={ServerScreen} /> :
            boot === "signedOut" ? <Stack.Screen name="SignIn" component={SignInScreen} /> : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="Chat" component={ChatScreen} />
                <Stack.Screen name="Details" component={DetailsScreen} />
                <Stack.Screen name="Computer" component={ComputerScreen} />
                <Stack.Screen name="Chantiers" component={ChantiersScreen} />
                <Stack.Screen name="Dashboard" component={DashboardScreen} />
              </>
            )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
