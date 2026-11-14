import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Icon, Spinner, type IconName } from "./Icon";

/* ---------- Escape handling: only the top-most overlay reacts ---------- */

type EscapeRef = { current: () => void };
const escapeStack: EscapeRef[] = [];
let escapeBound = false;

function bindEscape(): void {
  if (escapeBound) return;
  escapeBound = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || escapeStack.length === 0) return;
    e.preventDefault();
    escapeStack[escapeStack.length - 1].current();
  });
}

export function useEscape(handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    bindEscape();
    escapeStack.push(ref);
    return () => {
      const i = escapeStack.indexOf(ref);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [enabled]);
}

/* ---------- Focus helpers ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus the first field on mount, keep Tab inside, and restore focus on unmount. */
export function useDialogFocus(ref: { current: HTMLElement | null }): void {
  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (root) {
      const first =
        root.querySelector<HTMLElement>("[data-autofocus]") ??
        root.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), textarea:not([disabled])") ??
        root.querySelector<HTMLElement>(FOCUSABLE) ??
        root;
      first.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  onClose,
  children,
  size = "md",
  header,
  hideTitle,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  header?: ReactNode;
  hideTitle?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const t = useT();
  useEscape(onClose);
  useDialogFocus(ref);
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={`modal modal-${size} ${className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        {header ?? (
          <div className={hideTitle ? "sr-only" : "modal-head"}>
            <h2 id={titleId}>{title}</h2>
            {!hideTitle && <IconButton icon="close" label={t("common.close")} onClick={onClose} />}
          </div>
        )}
        {header && <h2 id={titleId} className="sr-only">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Buttons ---------- */

export function IconButton({
  icon,
  label,
  onClick,
  size = 18,
  className,
  disabled,
  active,
  title,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  size?: number;
  className?: string;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? "is-active" : ""} ${className ?? ""}`}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Two-step confirm: the first click arms the button, a second click within 4 s runs the action. */
export function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  onConfirm,
  disabled,
  className = "btn",
  title,
  icon,
  ariaLabel,
}: {
  label: ReactNode;
  confirmLabel?: ReactNode;
  busyLabel?: ReactNode;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  title?: string;
  icon?: IconName;
  ariaLabel?: string;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const click = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`${className} ${armed ? "is-armed" : ""}`}
      onClick={click}
      disabled={disabled || busy}
      title={title}
      aria-label={armed || busy ? undefined : ariaLabel}
    >
      {icon && !armed && !busy && <Icon name={icon} size={16} />}
      {busy ? (busyLabel ?? t("common.working")) : armed ? (confirmLabel ?? t("common.confirmAgain")) : label}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/* ---------- Popover menu ---------- */

export function Menu({
  open,
  onClose,
  children,
  align = "left",
  side = "bottom",
  label,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right" | "center";
  side?: "bottom" | "top";
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const onDown = (e: MouseEvent) => {
      const wrap = ref.current?.parentElement;
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      const active = document.activeElement;
      if (previous && document.contains(previous) && (!active || active === document.body)) previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };
  return (
    <div ref={ref} className={`menu menu-${align} menu-${side} ${className ?? ""}`} role="menu" aria-label={label} onKeyDown={onKey}>
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  hint,
  danger,
  disabled,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? "is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={16} />}
      <span className="menu-item-label">{children}</span>
      {hint && <kbd className="menu-item-hint">{hint}</kbd>}
    </button>
  );
}

/* ---------- Small pieces ---------- */

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: IconName; title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      {title && <p className="empty-title">{title}</p>}
      {children && <p className="empty-text">{children}</p>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="loading">
      <Spinner /> <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

export function ErrorNote({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  const t = useT();
  if (!children) return null;
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" size={16} />
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className="error-note-x" aria-label={t("common.dismiss")} onClick={onDismiss}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Re-render on an interval (used for clocks and relative times). */
export function useTick(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms, enabled]);
  return now;
}

/** A small "Copy" button that shows "Copied" for a moment. */
export function CopyButton({ text, label, className = "btn btn-small", onFail }: { text: string; label?: string; className?: string; onFail?: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        } else onFail?.();
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={13} /> <span role="status">{t(copied ? "common.copied" : "common.copy")}</span>
    </button>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
