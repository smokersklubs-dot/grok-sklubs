import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Profile } from "../types";
import { relTime } from "../lib/format";
import { Icon } from "./Icon";
import { ErrorNote, Loading } from "./ui";

/** Timezones the browser knows (IANA names), for the picker; the server checks the value again. */
function timezones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC", "Europe/Paris", "Europe/London", "America/New_York"]; }
}

/** Settings → Profile: what every bot knows about the user (name, timezone, company, preferences). */
export function ProfileSection() {
  const t = useT();
  const uid = useId();
  const profileTick = useStore((s) => s.profileTick);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: "", timezone: "", company: "", preferences: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ profile: Profile }>("GET", "/profile").then(({ profile: p }) => {
      setProfile(p);
      // A bot's profile_update arriving while the form is untouched refreshes it.
      if (!dirty) setForm({ name: p.name, timezone: p.timezone, company: p.company, preferences: p.preferences });
    }, (e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileTick]);

  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setDone(false); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ profile: Profile }>("PUT", "/profile", form);
      setProfile(r.profile);
      setDirty(false);
      setDone(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <h2>{t("settings.section.profile")}</h2>
      <p className="muted">{t("profile.intro")}</p>
      {!profile ? <Loading /> : (
        <form className="profile-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}n`}>{t("profile.name")}</label>
            <input id={`${uid}n`} className="input" value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder={t("profile.namePlaceholder")} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}t`}>{t("profile.timezone")}</label>
            <div className="field-inline">
              <input id={`${uid}t`} className="input" list={`${uid}tz`} value={form.timezone} maxLength={60} onChange={(e) => set("timezone", e.target.value)} placeholder="Europe/Paris" />
              {here && form.timezone !== here && (
                <button type="button" className="btn btn-small" onClick={() => set("timezone", here)}>
                  <Icon name="clock" size={14} /> {t("profile.useMine", { tz: here })}
                </button>
              )}
            </div>
            <datalist id={`${uid}tz`}>{timezones().map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}c`}>{t("profile.company")}</label>
            <input id={`${uid}c`} className="input" value={form.company} maxLength={120} onChange={(e) => set("company", e.target.value)} placeholder={t("profile.companyPlaceholder")} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}p`}>{t("profile.preferences")}</label>
            <textarea id={`${uid}p`} className="input" rows={5} value={form.preferences} maxLength={2000} onChange={(e) => set("preferences", e.target.value)} placeholder={t("profile.preferencesPlaceholder")} />
            <p className="field-hint">{t("profile.preferencesHint")}</p>
          </div>
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          <div className="row-end">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !dirty}>{t(busy ? "common.saving" : "common.save")}</button>
            {done && <span className="muted small" role="status">{t("common.saved")}</span>}
            {!done && profile.updatedAt && <span className="muted small">{t("profile.updated", { when: relTime(profile.updatedAt) })}</span>}
          </div>
          <p className="muted small profile-note"><Icon name="shield" size={13} /> {t("profile.note")}</p>
        </form>
      )}
    </>
  );
}
