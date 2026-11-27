import { turnKey } from "../store.js";

/**
 * Lanes (agent/lanes.ts): a bot runs up to 3 turns at once, one per thread. What a running turn holds in memory (its stop
 * button, who started it, its spend scope, its watch…) is kept per lane in a LaneMap: a bare bot id, used from inside a
 * turn, means that turn's own lane (the async context it runs in, store.ts rowScope); outside any turn it means the main
 * chat. An explicit "bot~thread" key names one lane from anywhere. So code written for one turn per bot keeps working,
 * each turn seeing only its own entry.
 */
export class LaneMap<V> {
  private m = new Map<string, V>();
  get(k: string): V | undefined { return this.m.get(turnKey(k)); }
  set(k: string, v: V): this { this.m.set(turnKey(k), v); return this; }
  has(k: string): boolean { return this.m.has(turnKey(k)); }
  delete(k: string): boolean { return this.m.delete(turnKey(k)); }
  /** Every lane of this bot that has an entry, as [lane key, thread, value]. */
  lanesOf(botId: string): [string, number, V][] {
    const out: [string, number, V][] = [];
    for (const [k, v] of this.m) if (k.startsWith(`${botId}~`)) out.push([k, Number(k.slice(botId.length + 1)) || 0, v]);
    return out;
  }
  entries() { return this.m.entries(); }
}

/** A Set with the same lane rule as LaneMap. */
export class LaneSet {
  private m = new LaneMap<true>();
  add(k: string) { this.m.set(k, true); return this; }
  has(k: string) { return this.m.has(k); }
  delete(k: string) { return this.m.delete(k); }
}
