/**
 * Local notifications (no push service, no account needed):
 * - while the app runs (foreground or recently in the background), the live channel raises them;
 * - when the system stopped the app, a background task checks the server every ~15 minutes (expo-background-task,
 *   WorkManager on Android) and tells about new unread messages and bots waiting for an answer.
 * Real push (FCM / APNs) is designed in mobile/README.md; it needs the user's own Firebase / Apple accounts.
 * Docs: https://docs.expo.dev/versions/v58.0.0/sdk/notifications/ and /sdk/background-task/
 */
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { ApiClient } from "../api/client";
import type { Bot, Live } from "../api/types";
import { t } from "../i18n";
import { firstWords } from "../state/reducers";
import { loadOrigin, loadToken } from "../state/session";
import { newsSince, type Seen } from "./news";
export { newsSince };

export const CHANNEL = "bots";
export const BG_TASK = "sklubot-check";
const SEEN_KEY = "sklubot.seen";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let channelReady = false;
async function ensureChannel() {
  if (channelReady || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: t("notify.channel"), importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200] });
  channelReady = true;
}

/**
 * "granted", "blocked" (refused for good: only the phone's settings can change it) or "ask" (not decided yet).
 * Android 13+ shows the system prompt only after a channel exists.
 */
export async function ensurePermission(ask = true): Promise<"granted" | "blocked" | "ask"> {
  await ensureChannel().catch(() => undefined);
  let cur = await Notifications.getPermissionsAsync();
  if (cur.status === "granted") return "granted";
  // Before the first request Android reports canAskAgain=false too (no rationale yet), so it says nothing about a
  // refusal: only the answer to a real request tells "blocked". Android shows no prompt when it was refused for good.
  if (!ask) return "ask";
  cur = await Notifications.requestPermissionsAsync();
  return cur.status === "granted" ? "granted" : cur.canAskAgain ? "ask" : "blocked";
}

export async function notifyBot(botId: string, title: string, body: string) {
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title, body: firstWords(body, 180), data: { botId } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
    });
  } catch { /* notifications off: nothing to do */ }
}

/** Notifications of one bot are cleared when its chat is opened. */
export async function clearBot(botId: string) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown.filter((n) => n.request.content.data?.botId === botId).map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch { /* ignore */ }
}

/** Remembers what was already told, so the background check only announces what is new. */
export async function rememberSeen(bots: Bot[], live: Record<string, Live>) {
  const seen: Seen = {};
  for (const b of bots) seen[b.id] = { unread: b.unread, waiting: !!live[b.id]?.awaiting };
  try { await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(seen)); } catch { /* ignore */ }
}

TaskManager.defineTask(BG_TASK, async () => {
  try {
    const raw = await SecureStore.getItemAsync("sklubot.prefs");
    if (raw && (JSON.parse(raw) as { notify?: boolean }).notify === false) return BackgroundTask.BackgroundTaskResult.Success;
    const origin = await loadOrigin();
    const token = origin ? await loadToken(origin) : null;
    if (!origin || !token) return BackgroundTask.BackgroundTaskResult.Success;
    const client = new ApiClient({ origin, token, timeoutMs: 20_000 });
    const r = await client.get<{ bots: Bot[]; live: Record<string, Live> }>("/bots");
    const prevRaw = await SecureStore.getItemAsync(SEEN_KEY);
    const prev: Seen = prevRaw ? JSON.parse(prevRaw) : {};
    for (const n of newsSince(prev, r.bots, r.live ?? {})) await notifyBot(n.botId, n.title, n.body);
    await rememberSeen(r.bots, r.live ?? {});
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setBackgroundCheck(on: boolean) {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(BG_TASK);
  } catch { /* background work unavailable on this device */ }
}
