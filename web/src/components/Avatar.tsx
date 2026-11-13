import type { ReactNode } from "react";
import type { AvatarShape, Bot } from "../types";
import { colorOf } from "../lib/colors";
import { Icon } from "./Icon";

function ngon(n: number, r: number, rotateDeg: number, cx = 50, cy = 50): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotateDeg + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function starPoints(outer: number, inner: number, cx = 50, cy = 52): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + 36 * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Silhouettes on a 100×100 grid. `y` and `fs` position and size the monogram. */
const SHAPES: Record<AvatarShape, { art: ReactNode; y: number; fs: number }> = {
  circle: { art: <circle cx="50" cy="50" r="44" />, y: 51, fs: 44 },
  squircle: { art: <rect x="8" y="8" width="84" height="84" rx="27" />, y: 51, fs: 44 },
  hexagon: { art: <polygon points={ngon(6, 43, 30)} />, y: 51, fs: 42 },
  diamond: { art: <polygon points="50,7 93,50 50,93 7,50" />, y: 51, fs: 36 },
  shield: { art: <path d="M50 8 L88 20 V50 C88 72 71 86 50 93 C29 86 12 72 12 50 V20 Z" />, y: 48, fs: 40 },
  drop: { art: <path d="M50 7 C62 22 85 44 85 61 A35 35 0 0 1 15 61 C15 44 38 22 50 7 Z" />, y: 60, fs: 38 },
  arch: { art: <path d="M13 91 V46 A37 37 0 0 1 87 46 V91 Z" />, y: 55, fs: 42 },
  star: { art: <polygon points={starPoints(46, 25)} />, y: 54, fs: 28 },
  clover: {
    art: (
      <>
        <circle cx="31" cy="31" r="24" />
        <circle cx="69" cy="31" r="24" />
        <circle cx="31" cy="69" r="24" />
        <circle cx="69" cy="69" r="24" />
        <rect x="30" y="30" width="40" height="40" />
      </>
    ),
    y: 51,
    fs: 42,
  },
  pill: { art: <rect x="20" y="6" width="60" height="88" rx="30" />, y: 51, fs: 40 },
  triangle: { art: <polygon points="50,11 91,85 9,85" />, y: 62, fs: 32 },
  octagon: { art: <polygon points={ngon(8, 45, 22.5)} />, y: 51, fs: 44 },
};

export interface AvatarProps {
  shape: string;
  color: string;
  name: string;
  size?: number;
  primary?: boolean;
  selected?: boolean;
  className?: string;
}

/** A coloured silhouette with the bot's initial as a monogram. */
export function Avatar({ shape, color, name, size = 36, primary, selected, className }: AvatarProps) {
  const c = colorOf(color);
  const s = SHAPES[shape as AvatarShape] ?? SHAPES.circle;
  const letter = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  const cls = ["avatar", selected ? "is-selected" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width={size} height={size} focusable="false">
        <g style={{ fill: c.bg, stroke: c.bg }} strokeWidth="6" strokeLinejoin="round">
          {s.art}
        </g>
        <text
          x="50"
          y={s.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={s.fs}
          fontWeight="700"
          style={{ fill: c.fg, fontFamily: "inherit" }}
        >
          {letter}
        </text>
      </svg>
      {primary && (
        <span className="avatar-badge" style={{ width: Math.max(14, size * 0.36), height: Math.max(14, size * 0.36) }}>
          <Icon name="star" size={Math.max(9, size * 0.24)} />
        </span>
      )}
    </span>
  );
}

export function BotAvatar({ bot, size, badge = false, className }: { bot: Pick<Bot, "shape" | "color" | "name" | "primary">; size?: number; badge?: boolean; className?: string }) {
  return <Avatar shape={bot.shape} color={bot.color} name={bot.name} size={size} primary={badge && bot.primary} className={className} />;
}
