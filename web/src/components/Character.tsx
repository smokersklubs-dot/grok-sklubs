/**
 * The bots' animated characters: the bot's silhouette with a face, an optional accessory, and a
 * motion for each state. Pure SVG on a 100×100 grid (drawn with overflow visible, so accessories
 * and bubbles may reach outside it) + CSS animations; JS only for blinking, pointer-following eyes
 * and the speaking level.
 */
import { memo, useEffect, useId, useRef, type ReactNode } from "react";
import { DEFAULT_CHARACTER } from "../types";
import type { AvatarShape, Character as CharacterLook } from "../types";
import { colorOf } from "../lib/colors";
import { followPointer, reducedMotion } from "../lib/pointer";
import type { CharacterState } from "../lib/botState";
import { useT } from "../i18n";
import { Icon } from "./Icon";
import "../styles/character.css";

export type { CharacterState };

/* ---------- Silhouettes ---------- */

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

interface ShapeDef {
  art: ReactNode;
  /** Rounding stroke (same colour as the fill): bigger = friendlier corners. */
  sw: number;
  /** Face centre and scale. */
  fx: number;
  fy: number;
  s: number;
  /** Visual top of the head at x = 50 (where antenna, sprout, cap and halo sit). */
  top: number;
  /** Half width of the head at eye level (for the headset). */
  hw: number;
  /** Where the bow sits (upper left of the outline). */
  bow: [number, number];
  /** A pointed top: hats are drawn smaller. */
  pointy?: boolean;
}

const SHAPES: Record<AvatarShape, ShapeDef> = {
  circle: { art: <circle cx="50" cy="50" r="44" />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 4, hw: 46, bow: [24, 15] },
  squircle: { art: <rect x="8" y="8" width="84" height="84" rx="27" />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 5, hw: 45, bow: [19, 14] },
  hexagon: { art: <polygon points={ngon(6, 43, 30)} />, sw: 8, fx: 50, fy: 51, s: 1, top: 3, hw: 40, bow: [30, 17], pointy: true },
  diamond: { art: <polygon points="50,9 91,50 50,91 9,50" />, sw: 11, fx: 50, fy: 50, s: 0.84, top: 3, hw: 42, bow: [29, 27], pointy: true },
  shield: { art: <path d="M50 8 L88 20 V50 C88 72 71 86 50 93 C29 86 12 72 12 50 V20 Z" />, sw: 7, fx: 50, fy: 45, s: 1.02, top: 5, hw: 41, bow: [20, 17] },
  drop: { art: <path d="M50 7 C62 22 85 44 85 61 A35 35 0 0 1 15 61 C15 44 38 22 50 7 Z" />, sw: 7, fx: 50, fy: 61, s: 0.98, top: 4, hw: 38, bow: [33, 26], pointy: true },
  arch: { art: <path d="M13 91 V46 A37 37 0 0 1 87 46 V91 Z" />, sw: 7, fx: 50, fy: 54, s: 1.04, top: 6, hw: 40, bow: [22, 20] },
  star: { art: <polygon points={starPoints(44, 27)} />, sw: 11, fx: 50, fy: 56, s: 0.68, top: 3, hw: 30, bow: [35, 29], pointy: true },
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
    sw: 6,
    fx: 50,
    fy: 52,
    s: 1.12,
    top: 13,
    hw: 48,
    bow: [14, 15],
  },
  pill: { art: <rect x="20" y="6" width="60" height="88" rx="30" />, sw: 6, fx: 50, fy: 44, s: 0.9, top: 3, hw: 33, bow: [27, 13] },
  triangle: { art: <polygon points="50,17 87,82 13,82" />, sw: 13, fx: 50, fy: 63, s: 0.74, top: 10, hw: 33, bow: [37, 38], pointy: true },
  octagon: { art: <polygon points={ngon(8, 45, 22.5)} />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 5, hw: 44, bow: [23, 15] },
};

/* ---------- Colours derived from the bot's palette entry ---------- */

/** A friendly accent per body colour, for antenna tips and bows. */
const ACCENT: Record<string, string> = {
  ink: "#ff7aa2", clay: "#ffd166", ember: "#ffd166", amber: "#ff7aa2", moss: "#ff9fb8", teal: "#ffc09f",
  sky: "#ffd166", indigo: "#ffb3cf", plum: "#ffd166", rose: "#ffe08a", slate: "#ffb3cf",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid "#rrggbb" or null. */
export function validHex(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null;
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG), 0 = black, 1 = white. */
function luminance(hex: string): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hueOf(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function palette(color: string, custom: string | null): Record<string, string> {
  const named = !custom;
  const bg = custom ?? colorOf(color).bg;
  const ink = named && color === "ink";
  // Custom colours: features switch to light on very dark bodies; very light bodies get a darker shade.
  const lum = custom ? luminance(custom) : 0.2;
  const dark = custom ? lum < 0.06 : false;
  const hue = custom ? hueOf(custom) : -1;
  const acc = named ? ACCENT[color] ?? ACCENT.slate : hue >= 25 && hue <= 75 ? "#ff7aa2" : "#ffd166";
  return {
    "--chr-body": bg,
    // Features drawn straight on the body (dot eyes, mouth, brows): a deep shade of the body.
    "--chr-feat": ink ? "var(--ink-fg)" : dark ? `color-mix(in srgb, ${bg} 25%, #ffffff)` : `color-mix(in srgb, ${bg} ${lum > 0.6 ? 12 : 22}%, #111215)`,
    "--chr-shade": ink ? "color-mix(in srgb, var(--ink) 70%, var(--ink-fg))" : dark ? `color-mix(in srgb, ${bg} 65%, #ffffff)` : `color-mix(in srgb, ${bg} 70%, #111215)`,
    "--chr-light": `color-mix(in srgb, ${bg} 30%, #ffffff)`,
    // Dots on a light backdrop: very light colours are deepened so the face stays readable.
    // Muse eye marks: light on the glow, dark when the body itself is very light.
    "--chr-eye": ink ? "var(--ink-fg)" : lum > 0.6 ? "#2a2c31" : "#ffffff",
    "--chr-dot-l": ink ? "var(--ink)" : lum > 0.5 ? `color-mix(in srgb, ${bg} 55%, #111215)` : bg,
    "--chr-dot-d": ink ? "var(--ink)" : lum < 0.08 ? `color-mix(in srgb, ${bg} 45%, #ffffff)` : lum > 0.5 ? bg : `color-mix(in srgb, ${bg} 72%, #ffffff)`,
    // A thin outline so very dark or very light custom colours never melt into the page.
    "--chr-rim": custom && lum < 0.06 ? "rgba(255,255,255,0.22)" : custom && lum > 0.75 ? "rgba(0,0,0,0.14)" : "transparent",
    "--chr-acc": acc,
    // The cap's brim: a deeper shade of the accent.
    "--chr-cap": `color-mix(in srgb, ${acc} 72%, #3a2a20)`,
  };
}

/* ---------- Eyes ---------- */

type EyeStyle = CharacterLook["eyes"];
/** Half spacing between the eyes and how far the pupils may travel (face units). */
const EYES: Record<EyeStyle, { dx: number; tx: number; ty: number }> = {
  round: { dx: 13, tx: 3.2, ty: 3.2 },
  oval: { dx: 12, tx: 2.4, ty: 3.8 },
  wide: { dx: 14, tx: 5, ty: 5 },
  dot: { dx: 12, tx: 2.4, ty: 2.4 },
  sleepy: { dx: 13, tx: 3, ty: 1.4 },
  visor: { dx: 11, tx: 5.5, ty: 1.5 },
};

const PUPIL = "#1b1d21";
const WHITE_STROKE = "rgba(0,0,0,0.14)";

function OneEye({ style }: { style: EyeStyle }) {
  switch (style) {
    case "oval":
      return (
        <>
          <ellipse rx="6.6" ry="9.4" fill="#fff" stroke={WHITE_STROKE} strokeWidth="0.8" />
          <g className="chr-gaze"><g className="chr-pupil">
            <ellipse rx="3.6" ry="4.9" fill={PUPIL} />
            <circle cx="-1.2" cy="-2" r="1.3" fill="#fff" />
          </g></g>
        </>
      );
    case "wide":
      return (
        <>
          <circle r="10.4" fill="#fff" stroke={WHITE_STROKE} strokeWidth="0.8" />
          <g className="chr-gaze"><g className="chr-pupil">
            <circle r="3.9" fill={PUPIL} />
            <circle cx="-1.3" cy="-1.4" r="1.2" fill="#fff" />
          </g></g>
        </>
      );
    case "dot":
      return (
        <g className="chr-gaze"><g className="chr-pupil">
          <ellipse rx="3.7" ry="4.7" style={{ fill: "var(--chr-feat)" }} />
          <circle cx="-1" cy="-1.8" r="1.1" fill="#fff" opacity="0.85" />
        </g></g>
      );
    case "sleepy":
      return (
        <>
          <circle r="8.5" fill="#fff" stroke={WHITE_STROKE} strokeWidth="0.8" />
          <g className="chr-gaze"><g className="chr-pupil">
            <circle cy="2" r="4.3" fill={PUPIL} />
            <circle cx="-1.2" cy="1.2" r="1.2" fill="#fff" />
          </g></g>
          {/* Heavy upper lid */}
          <path d="M-9.4 -0.6 A9.4 9.4 0 0 1 9.4 -0.6 Z" style={{ fill: "var(--chr-body)" }} />
          <path d="M-8.8 -0.6 Q0 1.2 8.8 -0.6" fill="none" style={{ stroke: "var(--chr-feat)" }} strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    default:
      return (
        <>
          <circle r="8.5" fill="#fff" stroke={WHITE_STROKE} strokeWidth="0.8" />
          <g className="chr-gaze"><g className="chr-pupil">
            <circle r="4.4" fill={PUPIL} />
            <circle cx="-1.4" cy="-1.7" r="1.35" fill="#fff" />
          </g></g>
        </>
      );
  }
}

const CLOSED = "M-5.6 -0.5 Q0 4.2 5.6 -0.5";
const SQUINT = "M-5.8 2 Q0 -5 5.8 2";

function Eyes({ style, state, uid }: { style: EyeStyle; state: CharacterState; uid: string }) {
  const { dx } = EYES[style];
  const closed = state === "sleeping";
  const squint = state === "happy";
  if (style === "visor") {
    const lineColor = "var(--chr-light)";
    return (
      <g className="chr-eyes">
        <defs>
          <clipPath id={`${uid}v`}>
            <rect x="-25" y="-7.5" width="50" height="15" rx="7.5" />
          </clipPath>
        </defs>
        <rect x="-25" y="-7.5" width="50" height="15" rx="7.5" fill="#17191d" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />
        {closed || squint ? (
          <g fill="none" style={{ stroke: lineColor }} strokeWidth="2.4" strokeLinecap="round" opacity={closed ? 0.55 : 1}>
            {[-dx, dx].map((x) => (
              <path key={x} transform={`translate(${x} ${closed ? -0.5 : 0}) scale(0.8)`} d={closed ? CLOSED : SQUINT} />
            ))}
          </g>
        ) : (
          <g clipPath={`url(#${uid}v)`}>
            <g className="chr-gaze">
              <g className="chr-pupil">
                {[-dx, dx].map((x) => (
                  <g key={x} transform={`translate(${x} 0)`}>
                    <g className="chr-eye">
                      <rect x="-4.6" y="-2.6" width="9.2" height="5.2" rx="2.6" style={{ fill: lineColor }} />
                    </g>
                  </g>
                ))}
              </g>
            </g>
            <rect className="chr-sweep" x="-3" y="-9" width="4" height="18" fill="#fff" opacity="0.22" transform="skewX(-18)" />
          </g>
        )}
      </g>
    );
  }
  if (closed || squint) {
    return (
      <g className="chr-eyes" fill="none" style={{ stroke: "var(--chr-feat)" }} strokeWidth="2.7" strokeLinecap="round">
        {[-dx, dx].map((x) => (
          <path key={x} transform={`translate(${x} 0)`} d={closed ? CLOSED : SQUINT} />
        ))}
      </g>
    );
  }
  return (
    <g className="chr-eyes">
      {[-dx, dx].map((x) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <g className="chr-eye">
            <OneEye style={style} />
          </g>
        </g>
      ))}
    </g>
  );
}

/* ---------- Mouth ---------- */

function Mouth({ state, mouthRef }: { state: CharacterState; mouthRef: React.Ref<SVGGElement> }) {
  const feat = { stroke: "var(--chr-feat)" };
  const fill = { fill: "var(--chr-feat)" };
  switch (state) {
    case "thinking":
      return <ellipse cx="3" cy="13.5" rx="2.2" ry="2.6" style={fill} />;
    case "working":
      return <path d="M-3.6 13 Q0 14.6 3.6 13" fill="none" style={feat} strokeWidth="2.5" strokeLinecap="round" />;
    case "waiting":
      return <path d="M-4.4 14 H4.4" fill="none" style={feat} strokeWidth="2.5" strokeLinecap="round" />;
    case "speaking":
      return (
        <g transform="translate(0 11.5)">
          <g ref={mouthRef} className="chr-mouth-open">
            <ellipse cx="0" cy="3.4" rx="5.4" ry="4.6" style={fill} />
            <ellipse cx="0" cy="6" rx="3" ry="1.6" fill="#ff8fa3" opacity="0.85" />
          </g>
        </g>
      );
    case "happy":
      return (
        <g>
          <path d="M-7 11.5 Q0 21 7 11.5 Z" style={{ ...fill, ...feat }} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M-3.2 16.6 Q0 15 3.2 16.6 Q0 18.6 -3.2 16.6 Z" fill="#ff8fa3" />
        </g>
      );
    case "sleeping":
      return <ellipse cx="0" cy="14" rx="1.7" ry="1.3" style={fill} />;
    case "listening":
      return <path d="M-4 13 Q0 16.4 4 13" fill="none" style={feat} strokeWidth="2.5" strokeLinecap="round" />;
    default:
      return <path d="M-5 12.6 Q0 16.6 5 12.6" fill="none" style={feat} strokeWidth="2.5" strokeLinecap="round" />;
  }
}

/* ---------- Accessories (viewBox coordinates) ---------- */

type Accessory = CharacterLook["accessory"];

function AccessoryArt({ kind, shape, front }: { kind: Accessory; shape: ShapeDef; front: boolean }) {
  const { top, fy, hw, bow, pointy, s } = shape;
  switch (kind) {
    case "antenna":
      return front ? (
        <g className="chr-antenna">
          <path d={`M50 ${top + 4} V${top - 8}`} style={{ stroke: "var(--chr-shade)" }} strokeWidth="3" strokeLinecap="round" />
          <circle className="chr-tip-glow" cx="50" cy={top - 11.5} r="7" style={{ fill: "var(--chr-acc)" }} opacity="0.3" />
          <circle className="chr-tip" cx="50" cy={top - 11.5} r="4" style={{ fill: "var(--chr-acc)" }} />
        </g>
      ) : null;
    case "sprout":
      return front ? (
        <g className="chr-sprout">
          <path d={`M50 ${top + 4} Q49 ${top - 2} 50 ${top - 7}`} fill="none" stroke="#3f8f3a" strokeWidth="2.6" strokeLinecap="round" />
          <path d={`M50 ${top - 6} C46 ${top - 13} 38 ${top - 14} 35 ${top - 10} C39 ${top - 5} 46 ${top - 4} 50 ${top - 6} Z`} fill="#6cc04a" stroke="#3f8f3a" strokeWidth="1.2" strokeLinejoin="round" />
          <path d={`M50 ${top - 7} C53 ${top - 16} 62 ${top - 18} 66 ${top - 14} C62 ${top - 8} 55 ${top - 6} 50 ${top - 7} Z`} fill="#86d65e" stroke="#3f8f3a" strokeWidth="1.2" strokeLinejoin="round" />
        </g>
      ) : null;
    case "bow":
      return front ? (
        <g transform={`translate(${bow[0]} ${bow[1]}) rotate(-24) scale(1.2)`} style={{ fill: "var(--chr-acc)" }} stroke="rgba(0,0,0,0.18)" strokeWidth="1" strokeLinejoin="round">
          <path d="M0 0 C-4 -8 -13 -8.5 -13 0 C-13 8.5 -4 8 0 0 Z" />
          <path d="M0 0 C4 -8 13 -8.5 13 0 C13 8.5 4 8 0 0 Z" />
          <path d="M-2 2 L-6 10 L-2.5 9 L0 3 M2 2 L6 10 L2.5 9 L0 3" />
          <circle r="3.3" />
        </g>
      ) : null;
    case "cap": {
      if (!front) return null;
      const k = pointy ? 0.95 : 1.3;
      const base = top + (pointy ? 7 : 13);
      return (
        <g transform={`translate(50 ${base}) scale(${k})`}>
          <path d="M-19 0 C-19 -21 19 -21 19 0 Z" style={{ fill: "var(--chr-acc)" }} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
          <path d="M-6 -16 Q0 -8 0 0 M6 -16 Q2 -8 2 0" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
          <path d="M8 -1 Q22 -5 30 0.5 Q22 3.5 8 2 Z" style={{ fill: "var(--chr-cap)" }} stroke="rgba(0,0,0,0.25)" strokeWidth="1" strokeLinejoin="round" />
          <circle cy="-15.6" r="2.4" style={{ fill: "var(--chr-cap)" }} stroke="rgba(0,0,0,0.2)" strokeWidth="0.8" />
        </g>
      );
    }
    case "halo":
      return front ? (
        <g className="chr-halo">
          <ellipse cx="50" cy={top - 9} rx="17" ry="4.6" fill="none" stroke="#ffd45c" strokeWidth="6" opacity="0.25" />
          <ellipse cx="50" cy={top - 9} rx="17" ry="4.6" fill="none" stroke="#f5c22e" strokeWidth="2.8" />
        </g>
      ) : null;
    case "headset": {
      const x1 = 50 - hw;
      const x2 = 50 + hw;
      const dark = "#30333a";
      if (!front) {
        return <path d={`M${x1} ${fy - 4} C${x1} ${top - 14} ${x2} ${top - 14} ${x2} ${fy - 4}`} fill="none" stroke={dark} strokeWidth="3.6" strokeLinecap="round" />;
      }
      const my = fy + 14 * s;
      return (
        <g>
          <path d={`M${x1 + 1} ${fy + 6} Q${x1 + 3} ${my + 6} ${50 - 10 * s} ${my + 1}`} fill="none" stroke={dark} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx={50 - 10 * s} cy={my + 1} r="2.8" fill={dark} />
          <circle cx={50 - 10 * s} cy={my + 1} r="1.1" style={{ fill: "var(--chr-acc)" }} />
          {[x1, x2].map((x) => (
            <g key={x}>
              <rect x={x - 5} y={fy - 10} width="10" height="18" rx="4.6" fill={dark} />
              <rect x={x - 2.2} y={fy - 6} width="4.4" height="10" rx="2.2" style={{ fill: "var(--chr-acc)" }} opacity="0.9" />
            </g>
          ))}
        </g>
      );
    }
    default:
      return null;
  }
}

/* ---------- State overlays (only on avatars large enough to animate) ---------- */

function Overlay({ state, shape }: { state: CharacterState; shape: ShapeDef }) {
  switch (state) {
    case "thinking":
      return (
        <g className="chr-orbit" transform="translate(86 8)">
          {[0, 1, 2].map((i) => (
            <circle key={i} className={`chr-dot chr-dot-${i}`} r={3.3 - i * 0.4} style={{ fill: "var(--chr-body)" }} />
          ))}
        </g>
      );
    case "waiting":
      return (
        <g transform="translate(88 6)">
         <g className="chr-ask">
          <path d="M-10 -9 H10 A5 5 0 0 1 15 -4 V5 A5 5 0 0 1 10 10 H-3 L-8 15 L-7 10 H-10 A5 5 0 0 1 -15 5 V-4 A5 5 0 0 1 -10 -9 Z" style={{ fill: "var(--surface)", stroke: "var(--border-strong)" }} strokeWidth="1.4" strokeLinejoin="round" />
          <text x="0" y="1" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="800" style={{ fill: "var(--text)", fontFamily: "inherit" }}>?</text>
         </g>
        </g>
      );
    case "sleeping":
      return (
        <g className="chr-zz" style={{ fill: "var(--text-2)", fontFamily: "inherit" }} fontWeight="800">
          <text className="chr-z chr-z-0" x="79" y="15" fontSize="16">z</text>
          <text className="chr-z chr-z-1" x="90" y="2" fontSize="12">z</text>
        </g>
      );
    case "working": {
      const l = 50 - shape.hw - 6;
      const r = 50 + shape.hw + 6;
      const y = shape.fy;
      return (
        <g className="chr-lines" style={{ stroke: "var(--text-3)" }} strokeWidth="2.4" strokeLinecap="round">
          <path className="chr-line-a" d={`M${l} ${y - 6} h-6 M${l + 1} ${y + 3} h-8`} />
          <path className="chr-line-b" d={`M${r} ${y - 6} h6 M${r - 1} ${y + 3} h8`} />
        </g>
      );
    }
    case "happy":
      return (
        <g style={{ fill: "var(--chr-acc)" }}>
          <g transform="translate(12 10)"><path className="chr-spark chr-spark-0" d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z" /></g>
          <g transform="translate(90 18) scale(0.75)"><path className="chr-spark chr-spark-1" d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z" /></g>
        </g>
      );
    default:
      return null;
  }
}

/* ---------- Type "dots": a minimal face of a few soft dots ---------- */

type Arrangement = [number, number, number][];
/** Mouth dots per state: x, y offset and scale (left to right). Morphs are CSS transitions on registered properties. */
const DOT_MOUTH: Record<CharacterState, Arrangement> = {
  idle: [[-13, -2, 0.8], [-6.5, 2, 0.9], [0, 3.4, 0.95], [6.5, 2, 0.9], [13, -2, 0.8]],
  happy: [[-15, -5, 1], [-8, 3, 1.05], [0, 6, 1.1], [8, 3, 1.05], [15, -5, 1]],
  waiting: [[-12, 1, 0.75], [-6, 1, 0.75], [0, 1, 0.75], [6, 1, 0.75], [12, 1, 0.75]],
  working: [[-11, 1, 0.75], [-5.5, 1, 0.75], [0, 1, 0.75], [5.5, 1, 0.75], [11, 1, 0.75]],
  thinking: [[0, 0, 0.8], [0, 0, 0.7], [0, 0, 0.6], [0, 0, 0], [0, 0, 0]],
  speaking: [[-12, 0, 0.85], [-6, 0, 0.9], [0, 0, 0.95], [6, 0, 0.9], [12, 0, 0.85]],
  listening: [[-10, 1, 0.8], [-5, 2, 0.85], [0, 2.6, 0.9], [5, 2, 0.85], [10, 1, 0.8]],
  sleeping: [[0, 0, 0], [0, 0, 0], [-3, 0, 0.6], [1, -1, 0.5], [5, -2, 0.42]],
};

/** A soft organic outline: 8 points around (cx, cy), joined by smooth cubic curves. */
function blobPath(r: number, wob: number[], cx = 50, cy = 52): string {
  const pts = wob.map((w, i) => {
    const a = (Math.PI * 2 * i) / wob.length - Math.PI / 2;
    return [cx + r * (1 + w) * Math.cos(a), cy + r * (1 + w) * Math.sin(a)];
  });
  const n = pts.length;
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const BLOBS = [
  blobPath(30, [0.02, -0.04, 0.05, -0.02, 0.04, -0.05, 0.03, -0.03]),
  blobPath(30, [-0.05, 0.04, -0.02, 0.06, -0.04, 0.03, -0.05, 0.04]),
  blobPath(30, [0.05, 0.01, -0.05, 0.02, 0.06, -0.02, -0.03, 0.05]),
];

/** CSS that is easier to generate than to write: dot arrangements and the flowing blob keyframes. */
function generatedCss(): string {
  const rules: string[] = [];
  for (const [state, arr] of Object.entries(DOT_MOUTH)) {
    arr.forEach(([x, y, k], i) => rules.push(`.chr.type-dots.st-${state} .dt-m${i}{--x:${x};--y:${y};--s:${k}}`));
  }
  rules.push(`@keyframes chr-mu-flow{0%,100%{d:path("${BLOBS[0]}")}33%{d:path("${BLOBS[1]}")}66%{d:path("${BLOBS[2]}")}}`);
  return rules.join("\n");
}
if (typeof document !== "undefined" && !document.getElementById("chr-generated")) {
  const el = document.createElement("style");
  el.id = "chr-generated";
  el.textContent = generatedCss();
  document.head.appendChild(el);
}

type GRef = React.Ref<SVGGElement>;

function DotsArt({ state, faceRef, mouthRef, levelRef, tx, ty, backdrop }: { state: CharacterState; faceRef: GRef; mouthRef: GRef; levelRef: GRef; tx: number; ty: number; backdrop: boolean }) {
  const dot = { fill: "var(--chr-dot)" };
  return (
    <>
      {backdrop && <circle cx="50" cy="50" r="46" className="dt-back" />}
      <g className="chr-motion">
        <g ref={levelRef} className="dt-level">
          <g className="chr-face" ref={faceRef} style={{ "--tx": tx, "--ty": ty } as React.CSSProperties}>
            <g className="chr-gaze">
              <g className="chr-pupil">
                {[36, 64].map((x) => (
                  <g key={x} transform={`translate(${x} 44)`}>
                    <g className="chr-eye dt-eye">
                      <ellipse rx="6" ry="6.8" style={dot} />
                    </g>
                  </g>
                ))}
              </g>
            </g>
            <g transform="translate(50 67)">
              <g ref={mouthRef} className="dt-mouth">
                {DOT_MOUTH.idle.map((_, i) => (
                  <circle key={i} className={`dt-m dt-m${i}`} r="3.1" style={dot} />
                ))}
              </g>
            </g>
          </g>
        </g>
      </g>
    </>
  );
}

/* ---------- Type "muse": a soft shape of light with a breathing halo ---------- */

function MuseArt({ state, uid, faceRef, glowRef, levelRef, tx, ty }: { state: CharacterState; uid: string; faceRef: GRef; glowRef: GRef; levelRef: GRef; tx: number; ty: number }) {
  return (
    <>
      <defs>
        <radialGradient id={`${uid}mg`} cx="0.42" cy="0.36" r="0.75">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--chr-body) 30%, #ffffff)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--chr-body)" }} />
          <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--chr-body) 78%, #101114)" }} />
        </radialGradient>
        <radialGradient id={`${uid}mh`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.45" style={{ stopColor: "var(--chr-body)" }} stopOpacity="0.5" />
          <stop offset="0.75" style={{ stopColor: "var(--chr-body)" }} stopOpacity="0.16" />
          <stop offset="1" style={{ stopColor: "var(--chr-body)" }} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="mu-halo-size">
        <g className="mu-halo-breathe">
          <g ref={levelRef} className="mu-level">
            <circle cx="50" cy="52" r="49" fill={`url(#${uid}mh)`} />
          </g>
        </g>
      </g>
      {state === "happy" && (
        <g className="mu-ripples" style={{ stroke: "var(--chr-body)" }} fill="none" strokeWidth="2">
          <circle className="mu-ripple" cx="50" cy="52" r="32" />
          <circle className="mu-ripple mu-ripple-2" cx="50" cy="52" r="32" />
        </g>
      )}
      <g className="chr-motion">
        <g className="mu-swirl">
          <path className="mu-blob mu-core" d={BLOBS[0]} fill={`url(#${uid}mg)`} />
          <path className="mu-blob mu-warm" d={BLOBS[0]} fill="#ffc48a" />
          <g ref={glowRef} className="mu-glow">
            <path className="mu-blob" d={BLOBS[0]} fill="#fff1d6" />
          </g>
          <path className="mu-blob mu-cool" d={BLOBS[0]} fill="#8fb4ff" />
          <ellipse cx="41" cy="37" rx="11" ry="6" fill="#fff" opacity="0.22" transform="rotate(-24 41 37)" />
        </g>
        <g className="chr-face" ref={faceRef} style={{ "--tx": tx, "--ty": ty } as React.CSSProperties}>
          <g className="chr-gaze">
            <g className="chr-pupil">
              {[42.5, 57.5].map((x) => (
                <g key={x} transform={`translate(${x} 51)`}>
                  <g className="chr-eye mu-eye">
                    <rect x="-1.7" y="-5" width="3.4" height="10" rx="1.7" style={{ fill: "var(--chr-eye)" }} opacity="0.92" />
                  </g>
                </g>
              ))}
            </g>
          </g>
        </g>
      </g>
    </>
  );
}

/* ---------- The component ---------- */

export interface CharacterBot {
  shape: string;
  color: string;
  name?: string;
  character?: Partial<CharacterLook> | null;
}

export interface CharacterProps {
  bot: CharacterBot;
  size?: number;
  state?: CharacterState;
  /** 0–1 output level while speaking (static). */
  level?: number;
  /** Read every frame while speaking, for a live level (voice call, editor preview). */
  levelSource?: () => number;
  /** Eyes may follow the pointer (when the character allows it). */
  interactive?: boolean;
  /** Primary star. */
  badge?: boolean;
  /** Selection ring. */
  ring?: boolean;
  className?: string;
  /** Accessible label; defaults to "<name>, <state>". `null` hides the image from assistive tech. */
  label?: string | null;
}

const FOLLOW_STATES: CharacterState[] = ["idle", "listening", "happy"];
const SMALL = 32;
/** Bubbles, dots and "z"s only where they can be read. */
const OVERLAY_MIN = 44;

function CharacterView({ bot, size = 36, state = "idle", level, levelSource, interactive = false, badge = false, ring = false, className, label }: CharacterProps) {
  const t = useT();
  const look: CharacterLook = { ...DEFAULT_CHARACTER, ...(bot.character ?? {}) };
  const shape = SHAPES[bot.shape as AvatarShape] ?? SHAPES.circle;
  const eyes = EYES[look.eyes] ? look.eyes : "round";
  const type = look.type === "dots" || look.type === "muse" ? look.type : "mascot";
  const custom = validHex(look.customColor);
  const small = size < SMALL;
  const amp = Math.max(0.08, Math.min(1, look.intensity ?? 0.6));
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const root = useRef<HTMLSpanElement>(null);
  const follow = useRef<SVGGElement>(null);
  const mouth = useRef<SVGGElement>(null);
  const squash = useRef<SVGGElement>(null);

  // Blinking: random 2.5–6 s, sometimes twice.
  const canBlink = look.blink && !small && state !== "sleeping" && state !== "happy";
  useEffect(() => {
    if (!canBlink || reducedMotion()) return;
    const el = root.current;
    if (!el) return;
    let timer = 0;
    const blinkOnce = (then: () => void) => {
      el.classList.add("is-blink");
      timer = window.setTimeout(() => {
        el.classList.remove("is-blink");
        then();
      }, 120);
    };
    const schedule = () => {
      timer = window.setTimeout(() => {
        blinkOnce(() => {
          if (Math.random() < 0.22) timer = window.setTimeout(() => blinkOnce(schedule), 140);
          else schedule();
        });
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      el.classList.remove("is-blink");
    };
  }, [canBlink]);

  // Eyes follow the pointer: one shared listener for the whole app.
  const canFollow = interactive && look.followCursor && !small && FOLLOW_STATES.includes(state);
  const { tx, ty } = type === "dots" ? { tx: 5, ty: 4 } : type === "muse" ? { tx: 4, ty: 3 } : EYES[eyes];
  useEffect(() => {
    const g = follow.current;
    const el = root.current;
    if (!canFollow || !g || !el || reducedMotion()) return;
    let cx = 0;
    let cy = 0;
    let gx = 0;
    let gy = 0;
    const stop = followPointer({
      read(x, y) {
        const r = el.getBoundingClientRect();
        const dx = x - (r.left + r.width / 2);
        const dy = y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / (r.width * 2 + 140));
        gx = (dx / d) * k * tx;
        gy = (dy / d) * k * ty;
        const ox = cx;
        const oy = cy;
        cx += (gx - cx) * 0.16;
        cy += (gy - cy) * 0.16;
        return Math.abs(cx - ox) + Math.abs(cy - oy) > 0.01;
      },
      write() {
        g.style.setProperty("--fx", cx.toFixed(2));
        g.style.setProperty("--fy", cy.toFixed(2));
      },
    });
    return () => {
      stop();
      g.style.removeProperty("--fx");
      g.style.removeProperty("--fy");
    };
  }, [canFollow, tx, ty]);

  // Speaking: mouth and squash follow the level.
  const speaking = state === "speaking";
  useEffect(() => {
    const m = mouth.current;
    const sq = squash.current;
    if (!speaking) return;
    const apply = (lvl: number) => {
      const v = Math.max(0, Math.min(1, lvl));
      if (type === "dots") {
        if (m) m.style.setProperty("--lv", v.toFixed(3));
        if (sq && !small) sq.style.transform = `scale(${(1 + 0.03 * v * amp).toFixed(4)})`;
      } else if (type === "muse") {
        if (m) m.style.opacity = (0.06 + 0.34 * v).toFixed(3);
        if (sq && !small) sq.style.transform = `scale(${(1 + 0.22 * v * amp).toFixed(4)})`;
      } else {
        if (m) m.style.transform = `scale(${(0.85 + 0.25 * v).toFixed(3)}, ${(0.18 + 0.95 * v).toFixed(3)})`;
        if (sq && !small) sq.style.transform = `scale(${(1 - 0.035 * v * amp).toFixed(4)}, ${(1 + 0.055 * v * amp).toFixed(4)})`;
      }
    };
    const clear = () => {
      if (sq) sq.style.transform = "";
      if (m) {
        m.style.removeProperty("--lv");
        m.style.opacity = "";
      }
    };
    if (!levelSource || small || reducedMotion()) {
      apply(level ?? 0.55);
      return clear;
    }
    let frame = requestAnimationFrame(function loop() {
      apply(levelSource());
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      clear();
    };
  }, [speaking, level, levelSource, small, amp, type]);

  const name = bot.name?.trim() || "";
  const aria = label === null ? undefined : label ?? (name ? t("character.aria", { name, state: t(`character.state.${state}`) }) : t(`character.state.${state}`));
  const cls = [
    "avatar",
    "chr",
    `type-${type}`,
    `st-${state}`,
    `idle-${look.idle}`,
    small ? "is-small" : "",
    ring ? "is-ring" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const accessory = look.accessory;

  return (
    <span
      ref={root}
      className={cls}
      style={{ width: size, height: size, "--amp": amp, ...palette(bot.color, custom) } as React.CSSProperties}
      role={aria ? "img" : undefined}
      aria-label={aria}
      aria-hidden={aria ? undefined : true}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} focusable="false" aria-hidden="true">
        {type === "dots" ? (
          <DotsArt state={state} faceRef={follow} mouthRef={mouth} levelRef={squash} tx={tx} ty={ty} backdrop={size >= 20} />
        ) : type === "muse" ? (
          <MuseArt state={state} uid={uid} faceRef={follow} glowRef={mouth} levelRef={squash} tx={tx} ty={ty} />
        ) : (
          <>
        <defs>
          <linearGradient id={`${uid}h`} x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.8" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.12" />
          </linearGradient>
          <mask id={`${uid}m`} maskUnits="userSpaceOnUse" x="-5" y="-5" width="110" height="110">
            <g fill="#fff" stroke="#fff" strokeWidth={shape.sw} strokeLinejoin="round">
              {shape.art}
            </g>
          </mask>
        </defs>
        <g className="chr-motion">
          <g className="chr-squash" ref={squash}>
            <AccessoryArt kind={accessory} shape={shape} front={false} />
            {custom && (
              <g fill="none" style={{ stroke: "var(--chr-rim)" }} strokeWidth={shape.sw + 2.4} strokeLinejoin="round">
                {shape.art}
              </g>
            )}
            <g style={{ fill: "var(--chr-body)", stroke: "var(--chr-body)" }} strokeWidth={shape.sw} strokeLinejoin="round">
              {shape.art}
            </g>
            <rect x="-5" y="-5" width="110" height="110" fill={`url(#${uid}h)`} mask={`url(#${uid}m)`} />
            <g transform={`translate(${shape.fx} ${shape.fy}) scale(${shape.s})`}>
              <g className="chr-face" ref={follow} style={{ "--tx": tx, "--ty": ty } as React.CSSProperties}>
                {look.cheeks && (
                  <g className="chr-cheeks" fill="#ff8fa8">
                    <ellipse cx={-(EYES[eyes].dx + 8)} cy="9.5" rx="5" ry="3.1" />
                    <ellipse cx={EYES[eyes].dx + 8} cy="9.5" rx="5" ry="3.1" />
                  </g>
                )}
                {state === "waiting" && (
                  <g fill="none" style={{ stroke: "var(--chr-feat)" }} strokeWidth="2.3" strokeLinecap="round">
                    <path d={`M${-EYES[eyes].dx - 6} ${eyes === "visor" ? -12 : -13.5} Q${-EYES[eyes].dx} ${eyes === "visor" ? -17 : -19} ${-EYES[eyes].dx + 5} ${eyes === "visor" ? -13 : -15}`} />
                    <path d={`M${EYES[eyes].dx - 5} ${eyes === "visor" ? -12 : -13} Q${EYES[eyes].dx} ${eyes === "visor" ? -13 : -14} ${EYES[eyes].dx + 6} ${eyes === "visor" ? -11.5 : -12.5}`} />
                  </g>
                )}
                <Eyes style={eyes} state={state} uid={uid} />
                {look.mouth && <Mouth state={state} mouthRef={mouth} />}
              </g>
            </g>
            <AccessoryArt kind={accessory} shape={shape} front />
          </g>
        </g>
          </>
        )}
        {size >= OVERLAY_MIN && (type === "mascot" || state === "waiting") && <Overlay state={state} shape={shape} />}
      </svg>
      {badge && (
        <span className="avatar-badge" style={{ width: Math.max(14, size * 0.36), height: Math.max(14, size * 0.36) }}>
          <Icon name="star" size={Math.max(9, size * 0.24)} />
        </span>
      )}
    </span>
  );
}

export const Character = memo(CharacterView);
