/**
 * Relais report limit — a Stop button on each command line in the chat. While `my_command` runs a command on the
 * owner's computer (agent/mycomputer.ts), its line carries `cmd: { ref, running: true }`; the button calls
 * POST /bots/:id/commands/:ref/stop (comfortroutes.ts), which aborts THAT command only: the relay gets `cancel` for its
 * request (protocol §6, the process tree is killed there), the bot is told "stopped by you" and its turn goes on.
 * The control session and the bot's other work are untouched (the session-wide Stop is still under My computer).
 */
const running = new Map<string, { userId: string; botId: string; ac: AbortController }>();

export const commandStops = {
  /** A command starts: returns the signal to pass along, and the cleanup to call when it ends. */
  start(ref: string, userId: string, botId: string): { signal: AbortSignal; end: () => void } {
    const ac = new AbortController();
    running.set(ref, { userId, botId, ac });
    return { signal: ac.signal, end: () => { running.delete(ref); } };
  },
  /** The owner pressed Stop: true when that command was running for this account's bot. */
  stop(userId: string, botId: string, ref: string): boolean {
    const r = running.get(ref);
    if (!r || r.userId !== userId || r.botId !== botId) return false;
    running.delete(ref);
    r.ac.abort();
    return true;
  },
  isRunning: (ref: string) => running.has(ref),
};
