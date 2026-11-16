/**
 * A bot's character, drawn with react-native-svg from the same silhouettes, eyes and colours as the web app's
 * characters (web/src/components/Character.tsx — Sklubot's own designs). Simplified for a phone: one body, a face,
 * a few accessories, a gentle motion while the bot works and a "?" bubble when it waits for you.
 */
import { memo, useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import type { Bot } from "../api/types";
import { botColor, useTheme, type Colors } from "../theme";

export type CharacterState = "idle" | "working" | "waiting" | "thinking";

function ngon(n: number, r: number, rot: number, cx = 50, cy = 50) {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
function star(outer: number, inner: number, cx = 50, cy = 52) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + 36 * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

type Shape = { body: (fill: string) => React.ReactNode; sw: number; fx: number; fy: number; s: number; top: number };
const P = (d: string) => (f: string) => <Path d={d} fill={f} />;
const SHAPES: Record<string, Shape> = {
  pebble: { body: P("M50 8 C75 8 90 29 90 54 C90 79 73 92 50 92 C27 92 10 79 10 54 C10 29 25 8 50 8 Z"), sw: 3, fx: 50, fy: 56, s: 1.12, top: 8 },
  egg: { body: P("M50 6 C70 6 86 34 86 58 C86 80 70 93 50 93 C30 93 14 80 14 58 C14 34 30 6 50 6 Z"), sw: 3, fx: 50, fy: 60, s: 1.02, top: 6 },
  mochi: { body: P("M50 26 C80 26 96 46 96 66 C96 84 80 92 50 92 C20 92 4 84 4 66 C4 46 20 26 50 26 Z"), sw: 3, fx: 50, fy: 62, s: 1.05, top: 26 },
  bean: { body: P("M30 14 C48 6 66 14 72 28 C76 38 88 44 90 60 C92 80 74 94 52 92 C30 90 10 78 10 52 C10 34 16 20 30 14 Z"), sw: 3, fx: 50, fy: 57, s: 1.02, top: 10 },
  cloud: { body: (f) => <G fill={f}><Circle cx="27" cy="60" r="18" /><Circle cx="48" cy="45" r="21" /><Circle cx="70" cy="50" r="18" /><Rect x="9" y="58" width="82" height="33" rx="16" /></G>, sw: 3, fx: 50, fy: 67, s: 0.98, top: 24 },
  cat: { body: (f) => <G fill={f}><Path d="M16 46 L20 9 L46 26 Z" /><Path d="M84 46 L80 9 L54 26 Z" /><Circle cx="50" cy="56" r="37" /></G>, sw: 6, fx: 50, fy: 60, s: 1.05, top: 19 },
  bear: { body: (f) => <G fill={f}><Circle cx="23" cy="26" r="13" /><Circle cx="77" cy="26" r="13" /><Circle cx="50" cy="56" r="37" /></G>, sw: 3, fx: 50, fy: 60, s: 1.05, top: 19 },
  ghost: { body: P("M14 50 A36 36 0 0 1 86 50 V86 Q79 95 71 86 Q64 78 57 86 Q50 95 43 86 Q36 78 29 86 Q21 95 14 86 Z"), sw: 4, fx: 50, fy: 52, s: 1.05, top: 14 },
  circle: { body: (f) => <Circle cx="50" cy="50" r="44" fill={f} />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 4 },
  squircle: { body: (f) => <Rect x="8" y="8" width="84" height="84" rx="27" fill={f} />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 5 },
  hexagon: { body: (f) => <Polygon points={ngon(6, 43, 30)} fill={f} />, sw: 8, fx: 50, fy: 51, s: 1, top: 3 },
  diamond: { body: (f) => <Polygon points="50,9 91,50 50,91 9,50" fill={f} />, sw: 11, fx: 50, fy: 50, s: 0.84, top: 3 },
  shield: { body: P("M50 8 L88 20 V50 C88 72 71 86 50 93 C29 86 12 72 12 50 V20 Z"), sw: 7, fx: 50, fy: 45, s: 1.02, top: 5 },
  drop: { body: P("M50 7 C62 22 85 44 85 61 A35 35 0 0 1 15 61 C15 44 38 22 50 7 Z"), sw: 7, fx: 50, fy: 61, s: 0.98, top: 4 },
  arch: { body: P("M13 91 V46 A37 37 0 0 1 87 46 V91 Z"), sw: 7, fx: 50, fy: 54, s: 1.04, top: 6 },
  star: { body: (f) => <Polygon points={star(44, 27)} fill={f} />, sw: 11, fx: 50, fy: 56, s: 0.68, top: 3 },
  clover: { body: (f) => <G fill={f}><Circle cx="31" cy="31" r="24" /><Circle cx="69" cy="31" r="24" /><Circle cx="31" cy="69" r="24" /><Circle cx="69" cy="69" r="24" /><Rect x="30" y="30" width="40" height="40" /></G>, sw: 6, fx: 50, fy: 52, s: 1.12, top: 13 },
  pill: { body: (f) => <Rect x="20" y="6" width="60" height="88" rx="30" fill={f} />, sw: 6, fx: 50, fy: 44, s: 0.9, top: 3 },
  triangle: { body: (f) => <Polygon points="50,17 87,82 13,82" fill={f} />, sw: 13, fx: 50, fy: 63, s: 0.74, top: 10 },
  octagon: { body: (f) => <Polygon points={ngon(8, 45, 22.5)} fill={f} />, sw: 6, fx: 50, fy: 49, s: 1.15, top: 5 },
};

const EYE_DX: Record<string, number> = { googly: 11.4, round: 13, oval: 12, wide: 14, dot: 12, sleepy: 13, visor: 11 };
const PUPIL = "#1b1d21";

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
/** A deep shade of the body for features drawn on it (mouth, dot eyes). */
function featureColor(body: string) {
  if (!/^#[0-9a-f]{6}$/i.test(body)) return "#1b1d21";
  const l = luminance(body);
  if (l < 0.06) return "#f0f0f0";
  const n = parseInt(body.slice(1), 16);
  const k = l > 0.6 ? 0.12 : 0.22;
  const mix = (v: number) => Math.round(v * k + 0x11 * (1 - k));
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

function Eyes({ style, state, feat }: { style: string; state: CharacterState; feat: string }) {
  const dx = EYE_DX[style] ?? 12;
  if (style === "visor") {
    return (
      <G>
        <Rect x="-25" y="-7.5" width="50" height="15" rx="7.5" fill="#17191d" />
        {[-dx, dx].map((x) => <Rect key={x} x={x - 4.6} y="-2.6" width="9.2" height="5.2" rx="2.6" fill="#cfe6ff" />)}
      </G>
    );
  }
  return (
    <G>
      {[-dx, dx].map((x) => (
        <G key={x} x={x}>
          {style === "dot" ? (
            <Ellipse rx="3.7" ry="4.7" fill={feat} />
          ) : style === "oval" ? (
            <G><Ellipse rx="6.6" ry="9.4" fill="#fff" /><Ellipse rx="3.6" ry="4.9" fill={PUPIL} /><Circle cx="-1.2" cy="-2" r="1.3" fill="#fff" /></G>
          ) : (
            <G>
              <Circle r={style === "googly" ? 10.8 : style === "wide" ? 10.4 : 8.5} fill="#fff" stroke="rgba(0,0,0,0.14)" strokeWidth={0.8} />
              <Circle cy={style === "sleepy" ? 2 : state === "thinking" ? -2 : 0} cx={state === "thinking" ? 2 : 0} r={style === "googly" ? 5.3 : style === "wide" ? 3.9 : 4.4} fill={PUPIL} />
              <Circle cx="-1.7" cy="-1.9" r="1.4" fill="#fff" />
              {style === "sleepy" && <Path d="M-9.4 -0.6 A9.4 9.4 0 0 1 9.4 -0.6 Z" fill="currentColor" />}
            </G>
          )}
        </G>
      ))}
    </G>
  );
}

function Mouth({ state, feat }: { state: CharacterState; feat: string }) {
  if (state === "thinking") return <Ellipse cx="3" cy="13.5" rx="2.2" ry="2.6" fill={feat} />;
  if (state === "working") return <Path d="M-3.6 13 Q0 14.6 3.6 13" fill="none" stroke={feat} strokeWidth={2.5} strokeLinecap="round" />;
  if (state === "waiting") return <Path d="M-4.4 14 H4.4" fill="none" stroke={feat} strokeWidth={2.5} strokeLinecap="round" />;
  return <Path d="M-5 12.6 Q0 16.6 5 12.6" fill="none" stroke={feat} strokeWidth={2.5} strokeLinecap="round" />;
}

function Accessory({ kind, top, accent }: { kind: string; top: number; accent: string }) {
  if (kind === "antenna") return <G><Path d={`M50 ${top + 4} V${top - 8}`} stroke="#555" strokeWidth={3} strokeLinecap="round" /><Circle cx="50" cy={top - 11.5} r="4" fill={accent} /></G>;
  if (kind === "halo") return <Ellipse cx="50" cy={top - 9} rx="17" ry="4.6" fill="none" stroke="#f5c22e" strokeWidth={2.8} />;
  if (kind === "sprout") return <G><Path d={`M50 ${top + 4} Q49 ${top - 2} 50 ${top - 7}`} fill="none" stroke="#3f8f3a" strokeWidth={2.6} strokeLinecap="round" /><Path d={`M50 ${top - 7} C53 ${top - 16} 62 ${top - 18} 66 ${top - 14} C62 ${top - 8} 55 ${top - 6} 50 ${top - 7} Z`} fill="#86d65e" /></G>;
  return null;
}

interface Props {
  bot: Pick<Bot, "shape" | "color" | "name"> & { character?: Partial<Bot["character"]> | null };
  size?: number;
  state?: CharacterState;
}

function CharacterImpl({ bot, size = 40, state = "idle" }: Props) {
  const { c } = useTheme();
  const shape = SHAPES[bot.shape] ?? SHAPES.pebble;
  const ch = bot.character ?? {};
  const body = botColor(bot.color, ch.customColor ?? null, c);
  const feat = bot.color === "ink" && !ch.customColor ? c.inkFg : featureColor(body);
  const motion = useRef(new Animated.Value(0)).current;
  const animate = state === "working" || state === "thinking";
  useEffect(() => {
    if (!animate) { motion.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(motion, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animate, motion]);
  const translateY = motion.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] });
  const showFace = size >= 18;
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Svg width={size} height={size} viewBox="-8 -14 116 116" color={body}>
          <G>{shape.body(body)}</G>
          {showFace && (
            <G x={shape.fx} y={shape.fy} scale={shape.s}>
              <Eyes style={ch.eyes ?? "googly"} state={state} feat={feat} />
              {ch.mouth !== false && <Mouth state={state} feat={feat} />}
            </G>
          )}
          {showFace && ch.accessory && ch.accessory !== "none" && <Accessory kind={ch.accessory} top={shape.top} accent="#ffd166" />}
          {state === "waiting" && size >= 28 && (
            <G x={88} y={4}>
              <Path d="M-10 -9 H10 A5 5 0 0 1 15 -4 V5 A5 5 0 0 1 10 10 H-3 L-8 15 L-7 10 H-10 A5 5 0 0 1 -15 5 V-4 A5 5 0 0 1 -10 -9 Z" fill={c.surface} stroke={c.borderStrong} strokeWidth={1.4} />
              <SvgText x="0" y="6" textAnchor="middle" fontSize="15" fontWeight="800" fill={c.text}>?</SvgText>
            </G>
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}
export const Character = memo(CharacterImpl);

/** The brand mark: an orange rounded square with the white "S" (web/public/icon.svg). */
export function Logo({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="Sklubot">
      <Rect x="24" y="24" width="464" height="464" rx="132" fill="#e2552d" />
      <Path fill="none" stroke="#fff" strokeWidth={46} strokeLinecap="round" strokeLinejoin="round" d="M330 186c-14-30-40-46-76-46-46 0-78 24-78 58 0 36 30 48 80 58 52 10 84 24 84 62 0 36-34 62-84 62-40 0-70-18-84-50" />
    </Svg>
  );
}

export function stateOf(live: { running: boolean; awaiting: unknown } | undefined): CharacterState {
  if (!live) return "idle";
  if (live.awaiting) return "waiting";
  if (live.running) return "working";
  return "idle";
}
export type { Colors };
