import { api, errText } from "../api";
import { useStore } from "../store";
import type { Row } from "../types";
import { sendKeysFor } from "../../../mobile/shared/sendKey";

/**
 * Sends one message to a bot's main chat from a one-click button (passage bar, « Explique plus simplement », form cards,
 * personal commands), the same way the composer does: POST /bots/:id/messages with a send key, so a retried click never
 * sends the message twice (mobile/shared/sendKey.ts). Returns false (and shows the error) when it did not go through.
 */
export async function quickSend(botId: string, text: string): Promise<boolean> {
  const words = text.trim();
  if (!words) return false;
  const keys = sendKeysFor(botId);
  try {
    const r = await api<{ row: Row }>("POST", `/bots/${botId}/messages`, { text: words, clientKey: keys.keyFor(JSON.stringify([words, [], false])) });
    keys.done();
    useStore.getState().addRows(botId, [r.row]);
    return true;
  } catch (e) {
    useStore.getState().showToast(errText(e));
    return false;
  }
}
