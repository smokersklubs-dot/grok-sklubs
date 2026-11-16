/** Line icons drawn for Sklubot (24-unit grid, round strokes). */
import Svg, { Circle, Path, Rect } from "react-native-svg";

const PATHS: Record<string, string> = {
  send: "M12 19V5M5.5 11.5 12 5l6.5 6.5",
  stop: "",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  info: "M12 11v6M12 7.5v.01",
  image: "M4 16l4.5-4.5 4 4L15 13l5 5M4 5h16v14H4z",
  camera: "M4 8h3.5L9 5.5h6L16.5 8H20v11H4zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
  file: "M14 3H6v18h12V7zM14 3v4h4",
  folder: "M3 6h6l2 2.5h10V19H3z",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  share: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v7h14v-7",
  tasks: "M4 6.5l2 2 3.5-3.5M12 7h8M4 13.5l2 2 3.5-3.5M12 14h8M12 20h8",
  bots: "M7 9a5 5 0 0 1 10 0v5a5 5 0 0 1-10 0zM9.5 11h.01M14.5 11h.01M12 2v2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2.1 1.2L14.7 21h-4l-.3-2.1a7 7 0 0 1-2.1-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L4.4 9.6l2-3.4 1.9.7a7 7 0 0 1 2.1-1.2L10.7 3h4l.3 2.1a7 7 0 0 1 2.1 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  alert: "M12 3 2 20h20zM12 10v4.5M12 17.5v.01",
  down: "M6 9l6 6 6-6",
  key: "M14.5 9.5a4 4 0 1 0-3.1 3.9L13 15h2v2h2v2h3v-3l-5.4-5.4c.3-.3-.1-.8-.1-1.1z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  wifiOff: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3.4-2.1M2 8.8a15 15 0 0 1 5-3M22 8.8a15 15 0 0 0-11-3.6M12 20h.01",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
};

export function Icon({ name, size = 22, color = "#000", strokeWidth = 2 }: { name: keyof typeof PATHS | string; size?: number; color?: string; strokeWidth?: number }) {
  if (name === "stop") {
    return <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill={color} /></Svg>;
  }
  if (name === "dot") return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="12" cy="12" r="5" fill={color} /></Svg>;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={PATHS[name] ?? PATHS.info} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {name === "info" && <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />}
    </Svg>
  );
}
