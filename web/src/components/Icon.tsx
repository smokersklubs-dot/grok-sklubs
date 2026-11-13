import type { ReactNode } from "react";
import { useT } from "../i18n";

/** Hand-drawn line icons on a 24×24 grid. */
const PATHS = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15" /></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M14.5 4.5v15" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  tasks: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-5" /></>,
  ring: <circle cx="12" cy="12" r="8.5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  chevronDown: <path d="M6.5 9.5L12 15l5.5-5.5" />,
  chevronRight: <path d="M9.5 6.5L15 12l-5.5 5.5" />,
  arrowUp: <path d="M12 19V5.5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v13.5M6 13l6 6 6-6" />,
  arrowLeft: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5" /></>,
  micOff: <><path d="M9 9.5v2a3 3 0 004.6 2.5M15 10.5v-4a3 3 0 00-5.6-1.5" /><path d="M5.5 11.5a6.5 6.5 0 0010.6 5M18.5 11.5c0 .9-.2 1.8-.5 2.6M12 18v2.5M4 4l16 16" /></>,
  wave: <path d="M4 10v4M8 6.5v11M12 4v16M16 7.5v9M20 10v4" />,
  phoneOff: <><path d="M3.5 14.5c5-4.6 12-4.6 17 0l-1.6 2.6-3.6-1.3-.4-2.5c-1.9-.6-3.9-.6-5.8 0l-.4 2.5-3.6 1.3z" /></>,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M8.5 20h7M12 16.5V20" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 11-2.3-5.4" /><path d="M19.5 4.5v4.2h-4.2" /></>,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  folder: <path d="M3.5 7.5a2 2 0 012-2h3.6l2 2.3h7.4a2 2 0 012 2v7.7a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />,
  file: <><path d="M7 3.5h6.5l4.5 4.5v10.5a2 2 0 01-2 2H7a2 2 0 01-2-2v-13a2 2 0 012-2z" /><path d="M13.5 3.5V8H18" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 5.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  plug: <><path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3.5a5.5 5.5 0 01-11 0zM12 16.5v4" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 11.5a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7M10 11v5M14 11v5" />,
  edit: <><path d="M4.5 19.5l.9-4L16 4.9a1.8 1.8 0 012.6 0l.5.5a1.8 1.8 0 010 2.6L8.5 18.6z" /><path d="M14 7l3 3" /></>,
  star: <path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor" stroke="none" />,
  logout: <path d="M14 4.5H7a2 2 0 00-2 2v11a2 2 0 002 2h7M10.5 12H20M16.5 8.5L20 12l-3.5 3.5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.4-3.3 2.9-5.3 6-5.3s5.6 2 6 5.3M15.5 5.6a3.2 3.2 0 010 5.9M17.5 14.6c2 .7 3.2 2.4 3.5 4.9" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5z" /></>,
  volume: <><path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z" /><path d="M15.5 9a4.2 4.2 0 010 6M18 6.5a7.7 7.7 0 010 11" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.6v.3" /></>,
  alert: <><path d="M12 4.2l8.3 14.6H3.7z" /><path d="M12 10v4M12 16.4v.3" /></>,
  bolt: <path d="M13 3.5L5.5 13.5H11l-1 7 7.5-10H12z" />,
  hook: <><circle cx="6.5" cy="17" r="2.5" /><circle cx="17.5" cy="17" r="2.5" /><circle cx="12" cy="6.5" r="2.5" /><path d="M10.8 8.7L7.7 14.8M13.2 8.7l3.1 6.1M9 17h6" /></>,
  sun: <><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" /></>,
  moon: <path d="M19.5 14.2A8 8 0 019.8 4.5a8 8 0 109.7 9.7z" />,
  brain: <><path d="M12 5.5v13M12 7a3 3 0 00-5.5-1.5A3 3 0 004.5 10a3 3 0 00.5 5 3 3 0 004 3.2 2.5 2.5 0 003-1.2M12 7a3 3 0 015.5-1.5A3 3 0 0119.5 10a3 3 0 01-.5 5 3 3 0 01-4 3.2 2.5 2.5 0 01-3-1.2" /></>,
  book: <><path d="M5 5.5a2 2 0 012-2h12v14H7a2 2 0 00-2 2z" /><path d="M5 19.5a2 2 0 002 2h12v-4" /></>,
  shield: <path d="M12 3.5l7 2.5v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  chart: <path d="M4.5 19.5h15M7.5 16v-5M12 16V6.5M16.5 16v-7" />,
  user: <><circle cx="12" cy="8.5" r="3.7" /><path d="M4.5 20c.6-3.8 3.7-6 7.5-6s6.9 2.2 7.5 6" /></>,
  bell: <><path d="M6.5 16.5V11a5.5 5.5 0 0111 0v5.5l1.5 1.5h-14z" /><path d="M10 20.5a2.2 2.2 0 004 0" /></>,
  external: <path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M17.5 14v3.5a2 2 0 01-2 2h-9a2 2 0 01-2-2v-9a2 2 0 012-2H10" />,
  cursor: <path d="M6 4l12.5 6.5-5.3 1.9-2 5.3z" />,
  eye: <><path d="M2.5 12c2.3-4 5.5-6 9.5-6s7.2 2 9.5 6c-2.3 4-5.5 6-9.5 6s-7.2-2-9.5-6z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M9.6 6.3A9.7 9.7 0 0112 6c4 0 7.2 2 9.5 6a14 14 0 01-2.6 3.3M6.3 7.7A13.6 13.6 0 002.5 12c2.3 4 5.5 6 9.5 6 1.5 0 2.9-.3 4.2-.9M9.9 9.9a2.8 2.8 0 004 4M4 4l16 16" /></>,
  clip: <path d="M19.5 11.5l-7.8 7.8a4.6 4.6 0 01-6.5-6.5l8.3-8.3a3.1 3.1 0 014.4 4.4l-8.3 8.3a1.6 1.6 0 01-2.3-2.3l7.3-7.3" />,
  key: <><circle cx="8" cy="15.5" r="4" /><path d="M11 12.7l8.5-8.5M16 7.5l2.5 2.5M13.5 10l2 2" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.7" /><path d="M4.5 17l4.5-4.2 3.5 3.2 2.5-2.2 4.5 4" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  const t = useT();
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" role="status" aria-label={t("common.loading")}>
      <path d="M12 3.5a8.5 8.5 0 108.5 8.5" />
    </svg>
  );
}
