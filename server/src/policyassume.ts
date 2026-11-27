import { AsyncLocalStorage } from "node:async_hooks";

/**
 * "What would a standing 'always allow' on this one permission key do?" — asked by the conversation grant
 * (agent/conversationgrants.ts) so that a grant can never let through more than an "always" rule would: the decision
 * is simply taken again as if that rule existed, with every other check (the floor, strict gates, outside content)
 * running exactly as usual. The assumption lives for one call chain only (AsyncLocalStorage: it follows the awaits of
 * that chain and no other turn sees it), only fills in a key the user has NOT decided ("blocked" and "ask first"
 * stay), and nothing is ever written to the policies table.
 */
const assumed = new AsyncLocalStorage<{ userId: string; key: string }>();

/** Runs `fn` as if `userId` had an "always allow" on `key`. */
export const assumeAlways = <T>(userId: string, key: string, fn: () => T): T => assumed.run({ userId, key }, fn);
/** Inside assumeAlways, for that user and key: true. */
export const isAssumed = (userId: string, key: string): boolean => { const a = assumed.getStore(); return !!a && a.userId === userId && a.key === key; };
/** Inside any assumeAlways: such a probe never spends a model call (authorize.ts review). */
export const probing = (): boolean => !!assumed.getStore();
