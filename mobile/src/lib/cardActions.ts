/**
 * Every card action as the request the web app sends for it (web/src/components/Cards.tsx, Wave5.tsx, Wave5b.tsx;
 * server/src/routes.ts). Pure: the card components post exactly these, and the tests pin them to the web's calls.
 */
const enc = encodeURIComponent;
export interface Req { path: string; body?: Record<string, unknown> }

export const cardReq = {
  decide: (approvalId: string, decision: "allow" | "always" | "conversation" | "deny"): Req => ({ path: `/approvals/${enc(approvalId)}`, body: { decision } }),
  answer: (botId: string, seq: number, answer: string): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/answer`, body: { answer } }),
  /** Skips a question, a "connect" card or a secret request (the server tells the bot it was not given). */
  dismiss: (botId: string, seq: number): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/dismiss` }),
  /** The secret goes in the body of this one request, to the server's vault; the host may be corrected by the user. */
  secret: (botId: string, seq: number, value: string, host: string): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/secret`, body: { value, host } }),
  takeoverDone: (botId: string, takeoverId: string): Req => ({ path: `/bots/${enc(botId)}/takeover/${enc(takeoverId)}/done` }),
  uncertain: (executionId: string, action: "done" | "check" | "retry"): Req => ({ path: `/executions/${enc(executionId)}`, body: { action } }),
  taskStop: (botId: string, taskId: string): Req => ({ path: `/bots/${enc(botId)}/bgtasks/${enc(taskId)}/stop` }),
  taskReply: (botId: string, taskId: string, text: string): Req => ({ path: `/bots/${enc(botId)}/bgtasks/${enc(taskId)}/reply`, body: { text } }),
  nudge: (botId: string, nudgeId: string, action: "do" | "later" | "never"): Req => ({ path: `/bots/${enc(botId)}/nudges/${enc(nudgeId)}`, body: { action } }),
  spend: (checkpointId: string, action: "continue" | "raise" | "stop"): Req => ({ path: `/spend/${enc(checkpointId)}`, body: { action } }),
  skillSave: (botId: string, seq: number, name: string, steps: string): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/skill`, body: { action: "save", name, steps } }),
  skillDismiss: (botId: string, seq: number): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/skill`, body: { action: "dismiss" } }),
  /** `token` only when the user typed one (the vault may already hold the secret). */
  apiApprove: (botId: string, seq: number, token: string): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/apiconnector`, body: { action: "approve", token: token || undefined } }),
  apiDismiss: (botId: string, seq: number): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/apiconnector`, body: { action: "dismiss" } }),
  memory: (botId: string, seq: number, choice: "old" | "new"): Req => ({ path: `/bots/${enc(botId)}/cards/${seq}/memory`, body: { choice } }),
  mailRelease: (botId: string, mailId: string): Req => ({ path: `/bots/${enc(botId)}/mail/${enc(mailId)}/release` }),
};
