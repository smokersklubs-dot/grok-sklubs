/**
 * The landing page's illustrations (Landing.tsx): the hero's team window and the small scenes of « Ce qu'ils font ».
 * Drawn with Sklubot's own characters (Character.tsx) and tokens only; every scene is marked as an example and hidden
 * from screen readers behind one sentence that says what it shows. Motion is decoration and stops under
 * prefers-reduced-motion (the cycle below does not start, base.css stops the CSS animations).
 */
import { useEffect, useState } from "react";
import { useT, type Key } from "../i18n";
import { DEFAULT_CHARACTER } from "../types";
import type { AvatarColor, AvatarShape, Character as CharacterLook, TeamFileLook } from "../types";
import { Character, type CharacterState } from "./Character";
import { Icon } from "./Icon";

export interface DeskBot { name: string; job: string; look: TeamFileLook }

/** A team to show before the gallery has loaded (and on /telecharger): the looks of real templates' first bots. */
const look = (shape: AvatarShape, color: AvatarColor, character: Partial<CharacterLook>): TeamFileLook => ({ shape, color, character: { ...DEFAULT_CHARACTER, ...character } });
export const FALLBACK: { name: string; job: Key; look: TeamFileLook }[] = [
  { name: "Paloma", job: "lp.role.assistant", look: look("egg", "amber", { type: "muse" }) },
  { name: "Capucine", job: "lp.role.shop", look: look("mochi", "rose", { accessory: "bow" }) },
  { name: "Basile", job: "lp.role.support", look: look("squircle", "sky", { accessory: "headset", eyes: "round" }) },
  { name: "Ernest", job: "lp.role.research", look: look("octagon", "ink", { type: "dots" }) },
];

const lookOf = (b: { name: string; look: TeamFileLook }) => ({ shape: b.look.shape ?? "pebble", color: b.look.color ?? "indigo", name: b.name, character: b.look.character });
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STATE_KEY: Record<string, Key> = { idle: "lp.state.idle", thinking: "lp.state.thinking", working: "lp.state.working", happy: "lp.state.happy", waiting: "lp.state.waiting", speaking: "lp.state.speaking" };
const CYCLE: CharacterState[] = ["working", "thinking", "happy", "working", "idle"];

/** A tick every few seconds (none under reduced motion): drives the states of the hero's bots. */
function useTick(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced()) return;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return tick;
}

export function Bot({ b, size, state = "idle", interactive = false }: { b: DeskBot; size: number; state?: CharacterState; interactive?: boolean }) {
  return <Character bot={lookOf(b)} size={size} state={state} interactive={interactive} label={null} />;
}

/** The approval card, as the app shows it: who asks, what, why it cannot be undone, and the two answers. */
export function AskCard({ name }: { name: string }) {
  const t = useT();
  return (
    <div className="lp-ask">
      <div className="lp-ask-head"><Icon name="hand" size={15} /><span>{t("lp.ask.title", { name })}</span></div>
      <p className="lp-ask-text">{t("lp.ask.text")}</p>
      <p className="lp-ask-warn"><Icon name="alert" size={13} /><span><b>{t("lp.ask.irreversible")}</b> · {t("lp.ask.why")}</span></p>
      <div className="lp-ask-actions"><span className="lp-fake">{t("lp.ask.refuse")}</span><span className="lp-fake is-primary">{t("lp.ask.allow")}</span></div>
    </div>
  );
}

/** A voice call with a bot: its face speaking, a level meter, the call's buttons. */
export function CallCard({ b, compact = false }: { b: DeskBot; compact?: boolean }) {
  const t = useT();
  return (
    <div className={`lp-call ${compact ? "is-compact" : ""}`}>
      <Bot b={b} size={compact ? 44 : 64} state="speaking" />
      <div className="lp-call-text">
        <b>{t("lp.call.title", { name: b.name })}</b>
        <span className="lp-wave" aria-hidden="true">{Array.from({ length: compact ? 14 : 22 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 137) % 900}ms` }} />)}</span>
      </div>
      <span className="lp-call-btns" aria-hidden="true"><span className="lp-round"><Icon name="mic" size={15} /></span><span className="lp-round is-end"><Icon name="phone" size={15} /></span></span>
    </div>
  );
}

/** The hero: a window onto the visitor's future team — three desks, a call in progress, a request for approval. */
export function TeamWindow({ bots }: { bots: DeskBot[] }) {
  const t = useT();
  const tick = useTick(2600);
  const [asker, a, b, caller] = [bots[0], bots[1] ?? bots[0], bots[2] ?? bots[0], bots[3] ?? bots[1] ?? bots[0]];
  const desks: [DeskBot, CharacterState][] = [[asker, "waiting"], [a, CYCLE[tick % CYCLE.length]], [b, CYCLE[(tick + 2) % CYCLE.length]]];
  return (
    <div className="lp-window" role="img" aria-label={t("lp.stage.label")}>
      <div className="lp-window-bar" aria-hidden="true">
        <span className="lp-dots"><i /><i /><i /></span>
        <span className="lp-window-title">{t("lp.stage.title")}</span>
        <span className="lp-tag">{t("lp.example")}</span>
      </div>
      <div className="lp-window-body" aria-hidden="true">
        <div className="lp-desks">
          {desks.map(([bot, state], i) => (
            <div key={`${bot.name}-${i}`} className={`lp-desk ${i === 0 ? "is-asking" : ""}`}>
              <div className="lp-desk-face"><Bot b={bot} size={76} state={state} interactive={i === 0} /></div>
              <b className="lp-desk-name">{bot.name}</b>
              <span className="lp-desk-job">{bot.job}</span>
              <span className={`lp-state is-${state}`}>{t(STATE_KEY[state] ?? "lp.state.idle")}</span>
            </div>
          ))}
        </div>
        <div className="lp-side">
          <CallCard b={caller} compact />
          <AskCard name={asker.name} />
        </div>
      </div>
    </div>
  );
}

/** « Un métier »: the jobs of the real templates, as the chips the app shows. */
export function JobsScene({ jobs }: { jobs: string[] }) {
  return (
    <div className="lp-scene lp-jobs" aria-hidden="true">
      {jobs.slice(0, 7).map((j, i) => <span key={j} className={`lp-job ${i === 1 ? "is-on" : ""}`}>{j}</span>)}
    </div>
  );
}

/** « Une mémoire »: three remembered notes (an example). */
export function MemoryScene() {
  const t = useT();
  return (
    <div className="lp-scene lp-memory" aria-hidden="true">
      <span className="lp-tag">{t("lp.example")}</span>
      {(["lp.f.memory.n1", "lp.f.memory.n2", "lp.f.memory.n3"] as Key[]).map((k) => <span key={k} className="lp-note"><Icon name="brain" size={14} />{t(k)}</span>)}
    </div>
  );
}

/** « Son propre ordinateur »: the bot's screen, live, with a browser open on its task. */
export function ComputerScene({ b }: { b: DeskBot }) {
  const t = useT();
  return (
    <div className="lp-scene lp-pc" aria-hidden="true">
      <div className="lp-pc-bar"><span className="lp-live"><i />{t("lp.live")}</span><span className="lp-pc-task">{t("lp.f.pc.task")}</span></div>
      <div className="lp-pc-screen">
        <div className="lp-pc-win">
          <div className="lp-pc-url"><span className="lp-dots"><i /><i /><i /></span><span className="lp-pc-field" /></div>
          <div className="lp-pc-rows"><span /><span /><span /><span /></div>
        </div>
        <span className="lp-pc-cursor"><Icon name="cursor" size={18} /></span>
        <span className="lp-pc-bot"><Bot b={b} size={40} state="working" /></span>
      </div>
    </div>
  );
}
