/**
 * L149 — the numbered control lease (idea from the Hermes audit, line 75; our own code). While the user drives a bot's
 * screen, the viewer holds a lease the server numbers (`epoch`). Each renewal names its number; « Rendre la main » releases
 * that number only. So:
 *  - a renewal still on the network when the user hands back never takes control again (the server refuses an old number,
 *    and this side drops any answer that arrives after handing back);
 *  - a hand-back lost on the network is sent again (3 tries), and the lease lapses on the server anyway (75 s);
 *  - after a server restart (lease forgotten), the next renewal is refused while the user still drives: a new lease is taken.
 */
export interface LeaseAnswer { ok: boolean; epoch?: number }
export type LeasePost = (body: { on: boolean; epoch?: number }) => Promise<LeaseAnswer>;

export function createControlLease(post: LeasePost) {
  let epoch: number | null = null;
  let driving = false;
  const take = async () => {
    driving = true;
    try {
      const r = await post({ on: true });
      if (driving && r.ok && typeof r.epoch === "number") epoch = r.epoch;
    } catch { /* the next renewal tries again */ }
  };
  const renew = async () => {
    if (!driving) return;
    if (epoch === null) return take();
    const mine = epoch;
    try {
      const r = await post({ on: true, epoch: mine });
      // Refused while still driving with this number (the server forgot it): take a new one.
      if (!r.ok && driving && epoch === mine) { epoch = null; await take(); }
    } catch { /* lost: the lease lasts 75 s, the next renewal is in 30 s */ }
  };
  const handBack = async () => {
    const mine = epoch;
    driving = false;
    epoch = null;
    for (let i = 0; i < 3; i++) {
      try { await post({ on: false, ...(mine !== null ? { epoch: mine } : {}) }); return; } catch { await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
    }
  };
  return { take, renew, handBack, epoch: () => epoch, driving: () => driving };
}
