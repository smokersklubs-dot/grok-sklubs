import type { ToolSpec } from "../llm/types.js";
import { phoneRequests, type PhoneKind } from "../phonerequests.js";
import { clip } from "../store.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L177 — a photo from the owner's phone camera, or the phone's position (phonerequests.ts). The owner approves each
 * request ON THE PHONE when it arrives (the Sklubot app shows it); nothing is ever taken in the background. No card
 * here: the phone's own « Prendre la photo » / « Partager ma position » tap is the approval, every time.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const REASON = { type: "string", description: "Why you need it, in one short sentence: shown to the user on their phone" };

async function ask(c: ToolContext, kind: PhoneKind, reason: string): Promise<ToolOutput> {
  const what = kind === "photo" ? "photo" : "position";
  const a = await phoneRequests.ask({ id: c.bot.id, userId: c.user.id, name: c.bot.name }, kind, reason, c.signal);
  switch (a.kind) {
    case "busy": return { content: "You already have a request waiting on the user's phone: wait for its answer.", isError: true, summary: "already waiting" };
    case "refused": return { content: `The user refused on their phone: no ${what} was shared. Do not ask again now; carry on without it or ask them in the chat.`, isError: true, summary: "refused" };
    case "expired": return { content: `Nobody answered on the phone within 3 minutes: no ${what} was shared. Do not retry in a loop; tell the user you are waiting for it.`, isError: true, summary: "no answer" };
    case "photo": return { content: [{ type: "text", text: "The photo the user just took on their phone for you:" }, { type: "image", mediaType: a.mediaType, data: a.data }], summary: "photo" };
    case "location": return { content: `The user's phone is at latitude ${a.latitude}, longitude ${a.longitude}${a.accuracy !== null ? ` (± ${a.accuracy} m)` : ""}. Map: https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=17/${a.latitude}/${a.longitude}. Use it only for what they asked.`, summary: "position" };
  }
}

export const phoneTools: BuiltinTool[] = [
  {
    spec: { name: "phone_photo", description: "Ask the user for a photo taken now with their phone's camera (the Sklubot app on the phone shows your request; they take it or refuse). Waits up to 3 minutes. Only when the task needs it.", inputSchema: obj({ reason: REASON }, ["reason"]) },
    group: "mycomputer", activity: "waiting", label: "Waiting for a photo from your phone", audited: true,
    run: (a, c) => ask(c, "photo", clip(String(a.reason ?? ""), 300)),
  },
  {
    spec: { name: "phone_location", description: "Ask the user to share their phone's current position (the Sklubot app on the phone shows your request; they share it or refuse). Waits up to 3 minutes. Only when the task needs it (directions, a nearby place…).", inputSchema: obj({ reason: REASON }, ["reason"]) },
    group: "mycomputer", activity: "waiting", label: "Waiting for your position", audited: true,
    run: (a, c) => ask(c, "location", clip(String(a.reason ?? ""), 300)),
  },
];
