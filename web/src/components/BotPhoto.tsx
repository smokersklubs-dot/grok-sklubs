import { useEffect, useSyncExternalStore, type ComponentType } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import { Icon } from "./Icon";
import "./BotCare.css";

/**
 * L161 « Avatar photo »: a bot with a photo shows it wherever its character would be drawn (Character.tsx is wrapped
 * with withPhoto). The addresses come from GET /bot-photos (server botphoto.ts: Sklubot serves them itself, never an
 * outside address), loaded once after sign-in and updated when the owner changes a photo.
 */
let photos: Record<string, string> = {};
let state: "idle" | "loading" | "loaded" = "idle";
const subs = new Set<() => void>();
const notify = () => { for (const fn of subs) fn(); };

export function loadBotPhotos(force = false) {
  if (state === "loading" || (state === "loaded" && !force)) return;
  state = "loading";
  api<{ photos: Record<string, string> }>("GET", "/bot-photos").then((r) => { photos = r.photos ?? {}; state = "loaded"; notify(); }, () => { state = "idle"; });
}
export function setBotPhoto(botId: string, url: string | null) {
  photos = { ...photos };
  if (url) photos[botId] = url; else delete photos[botId];
  notify();
}
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

export function useBotPhoto(botId: string | undefined): string | null {
  const ready = useStore((s) => s.boot === "ready");
  useEffect(() => { if (ready && botId) loadBotPhotos(); }, [ready, botId]);
  return useSyncExternalStore(subscribe, () => (botId ? photos[botId] ?? null : null), () => null);
}

interface PhotoProps { bot: { name?: string; id?: unknown }; size?: number; className?: string; ring?: boolean; badge?: boolean; label?: string | null }

/** The character, or the bot's photo in the same place and size (round, with the star of the main bot). */
export function withPhoto<P extends PhotoProps>(Inner: ComponentType<P>): ComponentType<P> {
  return function CharacterOrPhoto(props: P) {
    const t = useT();
    const id = typeof props.bot.id === "string" ? props.bot.id : undefined;
    const url = useBotPhoto(id);
    if (!url) return <Inner {...props} />;
    const size = props.size ?? 36;
    const name = props.bot.name?.trim() || "";
    const aria = props.label === null ? undefined : props.label ?? (name ? t("care.photo.aria", { name }) : undefined);
    return (
      <span className={["avatar", "bot-photo", props.ring ? "is-ring" : "", props.className ?? ""].filter(Boolean).join(" ")} style={{ width: size, height: size }} role={aria ? "img" : undefined} aria-label={aria} aria-hidden={aria ? undefined : true}>
        <img src={url} alt="" width={size} height={size} draggable={false} loading="lazy" />
        {props.badge && (
          <span className="avatar-badge" style={{ width: Math.max(14, size * 0.36), height: Math.max(14, size * 0.36) }}>
            <Icon name="star" size={Math.max(9, size * 0.24)} />
          </span>
        )}
      </span>
    );
  };
}
