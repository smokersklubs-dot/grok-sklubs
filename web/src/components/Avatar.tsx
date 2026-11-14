import type { Bot, Character as CharacterLook } from "../types";
import { useStore } from "../store";
import { useBotState, type CharacterState } from "../lib/botState";
import { getVoiceLevel } from "../lib/voiceLevel";
import { Character } from "./Character";

export interface AvatarProps {
  shape: string;
  color: string;
  name: string;
  size?: number;
  primary?: boolean;
  selected?: boolean;
  className?: string;
  character?: Partial<CharacterLook> | null;
  state?: CharacterState;
  interactive?: boolean;
}

/** A character that isn't tied to a live bot (sign-in mark, removed bots, pickers): idle by default. */
export function Avatar({ shape, color, name, size = 36, primary, selected, className, character, state = "idle", interactive }: AvatarProps) {
  return (
    <Character
      bot={{ shape, color, name, character }}
      size={size}
      state={state}
      badge={primary}
      ring={selected}
      className={className}
      interactive={interactive}
    />
  );
}

type AvatarBot = Pick<Bot, "shape" | "color" | "name" | "primary"> & { id?: string; character?: Partial<CharacterLook> | null };

/**
 * A bot's live character: its state comes from the store (working, waiting, in a call, asleep…).
 * Large placements pass `interactive` so the eyes may follow the pointer.
 */
export function BotAvatar({ bot, size, badge = false, className, interactive = false, selected }: { bot: AvatarBot; size?: number; badge?: boolean; className?: string; interactive?: boolean; selected?: boolean }) {
  const state = useBotState(bot.id);
  const inCall = useStore((s) => !!bot.id && s.call?.botId === bot.id);
  return (
    <Character
      bot={bot}
      size={size}
      state={state}
      levelSource={state === "speaking" && inCall ? getVoiceLevel : undefined}
      badge={badge && bot.primary}
      ring={selected}
      className={className}
      interactive={interactive}
    />
  );
}
