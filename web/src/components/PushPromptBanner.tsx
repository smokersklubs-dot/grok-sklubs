/**
 * Today's one gentle reminder for an account that answered "Plus tard" to the first run's "Active les notifications"
 * (users.push_prompt = 'later' on the server, sent as user.pushPrompt). Shown until it is answered: turned on, or "Non
 * merci" — either answer is kept on the server, so it never comes back (Onboarding.tsx answerPushPrompt).
 */
import { useState } from "react";
import { useT } from "../i18n";
import { pushSupport } from "../lib/push";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { answerPushPrompt, PushEnable } from "./Onboarding";

export function PushPromptBanner() {
  const t = useT();
  const later = useStore((s) => s.user?.pushPrompt === "later" && !s.user?.onboarding);
  const [open, setOpen] = useState(false);
  if (!later || pushSupport() === "unsupported") return null;
  const answered = (status: "enabled" | "dismissed") => {
    if (status === "dismissed") void answerPushPrompt("dismissed");
    useStore.setState((s) => ({ user: s.user ? { ...s.user, pushPrompt: undefined } : s.user }));
  };
  return (
    <div className="push-banner" role="region" aria-label={t("today.pushTitle")}>
      <Icon name="bell" size={18} />
      <div className="push-banner-text">
        <b>{t("today.pushTitle")}</b>
        <span className="muted">{t("today.pushText")}</span>
        {open && <div className="onb-push"><PushEnable onEnabled={() => window.setTimeout(() => answered("enabled"), 1500)} /></div>}
      </div>
      {!open && (
        <div className="push-banner-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => answered("dismissed")}>{t("today.pushDismiss")}</button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setOpen(true)}>{t("today.pushOn")}</button>
        </div>
      )}
    </div>
  );
}
