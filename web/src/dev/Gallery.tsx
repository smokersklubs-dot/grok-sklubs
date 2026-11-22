/**
 * Dev-only state gallery: the real components (cards in every status, notices, banners, empty states, the Today and
 * Surveillance pages) rendered with fake data, in light or dark, at full width or in a 390-px phone frame.
 *
 *   npm run dev -w web   →   http://localhost:5173/?dev=gallery
 *
 * Everything is in the address, so a state can be shared or screenshotted:
 *   section=all|basics|cards|notices|banners|empty|today|command|incidents|recruit|salons|surveillance|announcements|landing|download
 *   (confiance: webhooks signés ou non, réponses signalées ; view=report ouvre « Signaler cette réponse » — GalleryTrust.tsx)
 *   (equipe: « Équipe Sklubot (.md) », its windows alone, one per page with view=review|update|choose|share — GalleryTeamMd.tsx)
 *   (chat: the real chat view on a long conversation, see GalleryChat.tsx;
 *   landing, download: the public landing page or /telecharger alone, as a signed-out visitor sees it; empty=1 = no
 *   templates, plans or files)
 *   theme=light|dark   lang=fr|en   frame=390 (phone frame)   long=1 (very long texts)
 *   empty=1 (Today/Surveillance with no data)   fail=1 (buttons answer with an error)
 *   type=<card type>   status=<card status>   (filter the cards)
 *
 * main.tsx loads this file only when `import.meta.env.DEV` is true: production builds never contain it
 * (`npm run check:bundle -w web` checks the built files).
 */
import { GalleryRoutines } from "./GalleryRoutines";
import { CreateBotModal } from "../components/Modals";
import { RelayGuardPanel } from "../components/RelayGuardPanel";
import { RelayEventRow } from "../components/RelayEventRow";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { setLocale, useT } from "../i18n";
import { applyTheme, useStore } from "../store";
import type { Bot } from "../types";
import { CardView } from "../components/Cards";
import { ConversationGrantsBlock } from "../components/ConversationGrants";
import { buildItems, RowItems } from "../components/Transcript";
import { PauseAllNotice, PauseBanner } from "../components/Pause";
import { TodayView } from "../components/TodayView";
import { SurveillanceView } from "../components/SurveillanceView";
import { AnnouncementsView } from "../components/AnnouncementsView";
import { AnnouncementCard, SiteAnnouncementBanner } from "../components/AnnouncementCard";
import { useAnnouncements } from "../lib/announcements";
import { Empty, ErrorNote, IconButton, Loading, Toggle } from "../components/ui";
import { Icon } from "../components/Icon";
import Landing from "../components/Landing";
import DownloadPage from "../components/DownloadPage";
import { announcementsState, cardFixtures, fakeBot, GALLERY_BOT_ID, noticeRows, NOW, type FixtureOptions } from "./fixtures";
import { installFakeApi, type FakeApiState } from "./fakeApi";
import { GalleryChat } from "./GalleryChat";
import { GalleryCommand } from "./GalleryCommand";
import { IncidentsSection } from "../components/Incidents";
import { failureCardFixtures } from "./incidentsFixtures";
import { recruitCardFixtures } from "./recruitFixtures";
import { GalleryRooms } from "./GalleryRooms";
import { GalleryTeamMd } from "./GalleryTeamMd";
import { GalleryTrust } from "./GalleryTrust"; import { GallerySecurity } from "./GallerySecurity";
import { SkillsLibrarySection } from "../components/SkillsLibrary";
import { ScanFindings, SkillsCheckSection } from "../components/SkillScan";
import { scanDangerFixture } from "./skillsFixtures";
import { PagePreview, setPagePreviewSource } from "../components/PagePreview";
import { PageVersions } from "../components/PageVersions";
import { MemoryEdit } from "../components/MemoryEdit";
import samplePage from "./sample-page.html?url";

// Pages published by bots are not served by the dev server: the previews show a sample page instead.
setPagePreviewSource(() => samplePage);
import "./gallery.css";

const SECTIONS = ["all", "basics", "cards", "notices", "banners", "empty", "today", "command", "incidents", "recruit", "salons", "surveillance", "announcements", "skills", "skillscan", "pages", "landing", "download", "chat", "equipe", "grants", "confiance", "securite", "memoire", "relais", "routines", "createbot"] as const;
type Section = (typeof SECTIONS)[number];

interface GalleryState extends FakeApiState {
  section: Section;
  theme: "light" | "dark";
  frame: "full" | "390";
  type: string;
  status: string;
  embed: boolean;
}

function readState(): GalleryState {
  const p = new URLSearchParams(location.search);
  const section = SECTIONS.find((s) => s === p.get("section")) ?? "all";
  return {
    section,
    theme: p.get("theme") === "dark" ? "dark" : "light",
    frame: p.get("frame") === "390" ? "390" : "full",
    lang: p.get("lang") === "en" ? "en" : "fr",
    long: p.get("long") === "1",
    empty: p.get("empty") === "1",
    fail: p.get("fail") === "1",
    type: p.get("type") ?? "",
    status: p.get("status") ?? "",
    embed: p.get("embed") === "1",
  };
}

function toQuery(s: GalleryState, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ dev: "gallery" });
  if (s.section !== "all") p.set("section", s.section);
  if (s.theme !== "light") p.set("theme", s.theme);
  if (s.lang !== "fr") p.set("lang", s.lang);
  if (s.frame !== "full") p.set("frame", s.frame);
  for (const k of ["long", "empty", "fail"] as const) if (s[k]) p.set(k, "1");
  if (s.type) p.set("type", s.type);
  if (s.status) p.set("status", s.status);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `?${p.toString()}`;
}

let current = readState();
installFakeApi(() => current);

export function mountGallery(root: HTMLElement): void {
  document.title = "Sklubot — galerie des états (dev)";
  // The cards read their bot's name from the store.
  useStore.setState({ bots: { [GALLERY_BOT_ID]: fakeBot({ lang: current.lang, long: false }) } });
  // « Annonces »: what a reader sees on Today and in the band, from the fixtures.
  useAnnouncements.setState({ state: announcementsState(current, current.empty) });
  createRoot(root).render(<Gallery />);
}

function Gallery() {
  const [s, setS] = useState<GalleryState>(current);
  current = s;
  const set = (patch: Partial<GalleryState>) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    applyTheme(s.theme);
    setLocale(s.lang);
    useAnnouncements.setState({ state: announcementsState(s, s.empty) });
    if (!s.embed) history.replaceState(null, "", toQuery(s));
  }, [s]);

  if (s.frame === "390" && !s.embed) {
    return (
      <div className="gallery" data-gallery="sklubot-dev-gallery">
        <Toolbar s={s} set={set} />
        <div className="gallery-phone">
          <p className="gallery-phone-label">390 × 844</p>
          {/* An iframe, so the phone-width media queries apply as on a real phone. */}
          <iframe key={toQuery(s)} title="390 px" src={toQuery({ ...s, frame: "full" }, { embed: "1" })} width={390} height={844} />
        </div>
      </div>
    );
  }
  return (
    <div className={`gallery ${s.embed ? "is-embed" : ""}`} data-gallery="sklubot-dev-gallery">
      {!s.embed && <Toolbar s={s} set={set} />}
      {s.section === "chat" ? <GalleryChat key={`${s.lang}`} o={{ lang: s.lang, long: s.long }} /> : s.section === "equipe" ? <GalleryTeamMd key={`${s.lang}:${s.long}`} o={{ lang: s.lang, long: s.long }} /> : s.section === "routines" ? <GalleryRoutines key={`${s.lang}:${s.long}:${s.empty}`} o={{ lang: s.lang, long: s.long }} empty={s.empty} /> : s.section === "confiance" ? <GalleryTrust key={`${s.lang}:${s.long}:${s.empty}`} o={{ lang: s.lang, long: s.long }} empty={s.empty} /> : s.section === "securite" ? <GallerySecurity key={`${s.lang}:${s.long}:${s.empty}`} o={{ lang: s.lang, long: s.long }} empty={s.empty} /> : s.section === "createbot" ? <CreateBotModal key={s.lang} onClose={() => undefined} /> : s.section === "landing" ? <Landing key={`${s.lang}:${s.empty}`} onAuth={() => undefined} /> : s.section === "download" ? <DownloadPage key={`${s.lang}:${s.empty}`} /> : <Sections key={`${s.lang}:${s.long}:${s.empty}`} s={s} />}
    </div>
  );
}

function Toolbar({ s, set }: { s: GalleryState; set: (p: Partial<GalleryState>) => void }) {
  const seg = <K extends keyof GalleryState>(key: K, options: readonly [GalleryState[K], string][]) => (
    <div className="segmented" role="group" aria-label={String(key)}>
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={s[key] === v ? "is-active" : ""} aria-pressed={s[key] === v} onClick={() => set({ [key]: v } as Partial<GalleryState>)}>{label}</button>
      ))}
    </div>
  );
  return (
    <header className="gallery-bar">
      <strong className="gallery-title">Galerie des états <span className="chip">dev</span></strong>
      <label className="gallery-field">
        <span className="sr-only">Section</span>
        <select className="input input-small" value={s.section} onChange={(e) => set({ section: e.target.value as Section })}>
          {SECTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      {seg("theme", [["light", "Clair"], ["dark", "Sombre"]])}
      {seg("frame", [["full", "Large"], ["390", "390 px"]])}
      {seg("lang", [["fr", "FR"], ["en", "EN"]])}
      <span className="gallery-toggle"><Toggle checked={s.long} onChange={(v) => set({ long: v })} label="Textes longs" /> Textes longs</span>
      <span className="gallery-toggle"><Toggle checked={s.empty} onChange={(v) => set({ empty: v })} label="Données vides" /> Vide</span>
      <span className="gallery-toggle"><Toggle checked={s.fail} onChange={(v) => set({ fail: v })} label="Les boutons échouent" /> Échecs</span>
    </header>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="gallery-section" id={`g-${id}`} aria-labelledby={`g-${id}-h`}>
      <h2 id={`g-${id}-h`} className="gallery-h">{title}</h2>
      {hint && <p className="gallery-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Sections({ s }: { s: GalleryState }) {
  const o: FixtureOptions = { lang: s.lang, long: s.long };
  const show = (x: Section) => s.section === "all" || s.section === x;
  return (
    <main className="gallery-body">
      {show("basics") && <Basics />}
      {show("cards") && <Cards o={o} type={s.type} status={s.status} />}
      {show("notices") && <Notices o={o} />}
      {show("banners") && <Banners o={o} />}
      {show("empty") && <EmptyStates />}
      {show("incidents") && <Section id="incidents" title="Incidents" hint="Coordinateur d'échecs : la section « Incidents » de l'onglet Activité (interrupteur « Vide » : aucun incident), puis les cartes d'échec."><div className="gallery-page is-auto"><IncidentsSection bot={fakeBot(o)} /><div className="gallery-cards">{failureCardFixtures(o).map((c) => <figure key={c.failureId} className="gallery-figure"><figcaption><code>{c.cls} · {c.status}</code></figcaption><CardView card={c} botId={GALLERY_BOT_ID} seq={1} /></figure>)}</div></div></Section>}
      {show("recruit") && <Section id="recruit" title="Bot recruteur" hint="La carte où le bot principal propose un nouveau spécialiste : en attente (« Modifier » édite sur place), limites (offre, quota du jour), créé, refusé."><div className="gallery-cards recruit-gallery">{recruitCardFixtures(o).map((x) => <figure key={x.label} className="gallery-figure"><figcaption><code>recruit · {x.label}</code></figcaption><CardView card={x.card} botId={GALLERY_BOT_ID} seq={1} /></figure>)}</div></Section>}
      {show("salons") && <GalleryRooms o={o} />}
      {show("relais") && <Section id="relais" title="Relais : règles de sécurité" hint="Réglages → Ordinateurs → « Règles de sécurité » d'un ordinateur : terminaux (désactivés par défaut, avertissement), listes « garder à l'écart », applis toujours refusées, raccourcis protégés (« Vide » : aucune liste)."><div className="gallery-page is-auto"><RelayGuardPanel deviceId="dev_gallery" /><div className="transcript"><RelayEventRow seq={1} warn={false} text={"$ npm test — ~/projets/site · portable-lea (macOS) · exit 0\n> site@1.0.0 test\n> vitest run\n\n ✓ src/panier.test.ts (12 tests) 41ms\n Test Files  1 passed (1)\n      Tests  12 passed (12)\n API_KEY=[secret]"} /></div></div></Section>}
      {show("memoire") && <Section id="memoire" title="Mémoire : modifier une note" hint="Réglages → Mémoire → « Modifier » : le texte se corrige sur place, l'historique montre chaque changement (« Vide » : aucun)."><div className="gallery-page is-auto"><ul className="list"><li className="list-row is-card"><div className="list-row-text"><MemoryEdit key={`${s.lang}:${s.long}:${s.empty}`} historyOpen memory={{ id: "mem_gallery", botId: GALLERY_BOT_ID, text: o.lang === "fr" ? "Préfère les réunions le matin" : "Prefers meetings in the morning", source: "learned", createdAt: NOW - 10 * 86400_000, status: "active", quote: "", category: null, confidence: "once", confirmedAt: null, lastUsedAt: null }} onSaved={() => undefined} onCancel={() => undefined} /></div></li></ul></div></Section>}
      {show("grants") && <Section id="grants" title="Autoriser pour cette conversation" hint="Réglages → Autorisations : ce qui a été autorisé pour une conversation (« Vide » : aucune ; « Échecs » : « Retirer » échoue). En dessous, la carte qui le propose, puis une fois accordé."><div className="gallery-page is-auto"><ConversationGrantsBlock key={`${s.empty}:${s.lang}:${s.long}`} /></div><div className="gallery-cards">{cardFixtures(o).filter((c) => c.type === "approval" && c.card.type === "approval" && c.card.conversation).map((c) => <figure key={c.status} className="gallery-figure"><figcaption><code>approval · {c.status}</code></figcaption><CardView card={c.card} botId={GALLERY_BOT_ID} seq={1} /></figure>)}</div></Section>}
      {show("today") && <Section id="today" title="Aujourd'hui" hint="La vraie page, avec des données factices (interrupteur « Vide » pour la journée calme)."><div className="gallery-page"><TodayView /></div></Section>}
      {show("command") && <Section id="command" title="Centre de commandement" hint="La vraie page : toute l'équipe en direct, avec ses liens (« Vide » : équipe vide). Les connecteurs apparaissent à partir de 1100 px de large."><div className="gallery-page is-tall"><GalleryCommand o={o} empty={s.empty} /></div></Section>}
      {show("announcements") && <Announcements o={o} empty={s.empty} />}
      {show("surveillance") && <Section id="surveillance" title="Surveillance" hint="La vraie page : incidents critiques, à surveiller, acquittés, info ; historique ; santé."><div className="gallery-page"><SurveillanceView /></div></Section>}
      {show("skills") && <Section id="skills" title="Bibliothèque de compétences" hint="Réglages → Compétences : les cartes de la bibliothèque, puis l'import depuis GitHub (« Chercher » répond avec un dépôt d'exemple)."><div className="gallery-page is-auto"><SkillsLibrarySection /></div></Section>}
      {show("skillscan") && <Section id="skillscan" title="Contrôle de sécurité des compétences" hint="Réglages → Compétences → « Vérifier mes compétences » : ce qui a été trouvé, où, et quoi faire (empty=1 : rien à signaler). En dessous, l'encadré montré avant un import."><div className="gallery-page is-auto"><SkillsCheckSection auto /><div className="editor" style={{ marginTop: 18 }}><ScanFindings scan={scanDangerFixture()} /></div></div></Section>}
      {show("pages") && <Section id="pages" title="Pages publiées" hint="L'aperçu d'une page dans la discussion (une page d'exemple dans le bac à sable), puis son historique (Réglages → Pages)."><div className="gallery-page is-auto"><PagePreview text={`[${s.lang === "fr" ? "Ventes de novembre" : "November sales"}](${location.origin}/p/galleryDemoPageToken0001)`} /><PageVersions page={{ token: "galleryDemoPageToken0001", botId: GALLERY_BOT_ID, title: "Ventes de novembre", url: `${location.origin}/p/galleryDemoPageToken0001`, createdAt: NOW, visibility: "link" }} defaultOpen /></div></Section>}
    </main>
  );
}

/** « Annonces »: the maintenance band, the bell's panel, then the real page « Annonces » (its editor opens with « Nouvelle annonce »). */
function Announcements({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const state = announcementsState(o, empty);
  return (
    <Section id="announcements" title="Annonces" hint="Le bandeau de maintenance, le panneau de la cloche (cartes compactes), puis la vraie page « Annonces » de l'administrateur. Les cartes sur Aujourd'hui sont dans la section « today ».">
      <div className="gallery-page gallery-ann-band"><div className="shell has-site-banner gallery-ann-shell"><SiteAnnouncementBanner /></div></div>
      <div className="gallery-ann-pop">
        <div className="ann-pop-head"><h2>{o.lang === "fr" ? "Annonces" : "Announcements"}</h2></div>
        <div className="ann-pop-list">{state.items.map((a) => <AnnouncementCard key={a.id} a={a} compact now={NOW} onDismiss={() => undefined} />)}</div>
      </div>
      <div className="gallery-page"><AnnouncementsView /></div>
    </Section>
  );
}

function Basics() {
  return (
    <Section id="basics" title="Bases" hint="Boutons, badges, pastilles, encadrés, champs : les briques de docs/DESIGN.md.">
      <div className="gallery-row">
        <button type="button" className="btn btn-primary">Principal</button>
        <button type="button" className="btn btn-accent">Accent</button>
        <button type="button" className="btn">Normal</button>
        <button type="button" className="btn btn-ghost">Discret</button>
        <button type="button" className="btn btn-danger">Supprimer</button>
        <button type="button" className="btn btn-ghost-danger">Retirer</button>
        <button type="button" className="btn" disabled>Désactivé</button>
      </div>
      <div className="gallery-row">
        <button type="button" className="btn btn-small btn-primary">Petit principal</button>
        <button type="button" className="btn btn-small">Petit</button>
        <IconButton icon="settings" label="Réglages" />
        <IconButton icon="refresh" label="Actualiser" />
        <IconButton icon="trash" label="Supprimer" disabled />
        <button type="button" className="icon-btn round-btn" aria-label="Micro"><Icon name="mic" size={16} /></button>
        <button type="button" className="link">Un lien</button>
      </div>
      <div className="gallery-row">
        <span className="chip">neutre</span>
        <span className="chip state-ready">prêt</span>
        <span className="chip state-working">au travail</span>
        <span className="chip state-needs_input">attend ta réponse</span>
        <span className="chip state-error">erreur</span>
        <span className="count-badge">3</span>
        <span className="count-badge is-attention">!</span>
        <span className="dot-inline dot-ok" /> <span className="dot-inline dot-warn" /> <span className="dot-inline dot-error" />
        <kbd>Ctrl+K</kbd>
      </div>
      <div className="gallery-col">
        <p className="callout is-warn"><Icon name="alert" size={15} /> <span>Attention : cette action ne peut pas être annulée.</span></p>
        <p className="callout is-ok"><Icon name="check" size={15} /> <span>C'est fait : la clé fonctionne.</span></p>
        <ErrorNote onDismiss={() => undefined}>Impossible de joindre le serveur. Vérifie ta connexion puis réessaie.</ErrorNote>
        <Loading label="Chargement…" />
      </div>
      <div className="gallery-row">
        <div className="segmented" role="group" aria-label="Exemple"><button type="button" className="is-active">Hier</button><button type="button">Aujourd'hui</button></div>
        <div className="tabs" style={{ minWidth: 240 }}><button type="button" className="tab is-active">Général</button><button type="button" className="tab">Routines</button></div>
        <GalleryToggle />
      </div>
      <div className="gallery-col gallery-fields">
        <label className="field"><span className="field-label">Nom du bot</span><input className="input" placeholder="Par exemple : Juno" /><span className="field-hint">Visible dans la barre latérale.</span></label>
        <label className="field"><span className="field-label">Clé</span><input className="input" defaultValue="sk-…" aria-invalid="true" /><span className="field-hint is-error">Cette clé est refusée par le service.</span></label>
      </div>
      <Swatches />
    </Section>
  );
}

function GalleryToggle() {
  const [on, setOn] = useState(true);
  return <Toggle checked={on} onChange={setOn} label="Interrupteur" />;
}

const SWATCH_TOKENS = ["--bg", "--surface", "--surface-2", "--surface-3", "--border", "--border-strong", "--text", "--text-2", "--text-3", "--ink", "--on-strong", "--danger", "--danger-soft", "--warn", "--warn-soft", "--ok", "--ok-soft", "--info", "--info-soft", "--focus"];

function Swatches() {
  return (
    <div className="gallery-swatches">
      {SWATCH_TOKENS.map((name) => (
        <div key={name} className="gallery-swatch"><span style={{ background: `var(${name})` }} /><code>{name}</code></div>
      ))}
    </div>
  );
}

function Cards({ o, type, status }: { o: FixtureOptions; type: string; status: string }) {
  const all = useMemo(() => cardFixtures(o), [o.lang, o.long]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = all.filter((c) => (!type || c.type === type) && (!status || c.status === status));
  const types = [...new Set(list.map((c) => c.type))];
  return (
    <Section id="cards" title={`Cartes (${list.length})`} hint="Chaque type de carte dans chaque état. Filtrer : &type=approval&status=pending.">
      {types.map((tp) => (
        <div key={tp} className="gallery-group">
          <h3 className="gallery-h3"><code>{tp}</code></h3>
          <div className="gallery-cards">
            {list.filter((c) => c.type === tp).map((c, i) => (
              <figure key={`${c.status}:${i}`} className="gallery-figure">
                <figcaption><code>{c.status}</code></figcaption>
                <CardView card={c.card} botId={GALLERY_BOT_ID} seq={i + 1} />
              </figure>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Notices({ o }: { o: FixtureOptions }) {
  const rows = useMemo(() => noticeRows(o), [o.lang, o.long]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => buildItems(rows, false), [rows]);
  return (
    <Section id="notices" title="Avis dans la discussion" hint="Info, attention, erreur ; limite d'étapes ; « ne répond pas encore » et « semble bloqué » ; plafonds ; clé cassée ; forfait ; pause.">
      <div className="gallery-chat"><RowItems items={items} bot={fakeBot(o)} /></div>
    </Section>
  );
}

function Banners({ o }: { o: FixtureOptions }) {
  const t = useT();
  useEffect(() => {
    useStore.setState({ pauses: { all: { since: NOW - 3_600_000 }, sections: [], bots: [] } });
    return () => useStore.setState({ pauses: { all: null, sections: [], bots: [] } });
  }, []);
  const pause = { by: "bot", self: true, sectionId: null, since: NOW - 3_600_000, queued: 3 } as const;
  const own = fakeBot(o, { pause: { ...pause } });
  const all = fakeBot(o, { pause: { ...pause, by: "all", queued: 0 } });
  const shared = fakeBot(o, { pause: { ...pause }, access: { ownerName: "Claire", canApprove: false } } as unknown as Partial<Bot>);
  return (
    <Section id="banners" title="Bandeaux" hint="Au-dessus de la zone de saisie (bot en pause, tous en pause, bot partagé) et dans la barre latérale.">
      <div className="gallery-col">
        <PauseBanner bot={own} />
        <PauseBanner bot={all} />
        <PauseBanner bot={shared} />
        <div className="gallery-sidebar-sample" aria-label={t("pause.sidebarAll")}><PauseAllNotice collapsed={false} /></div>
      </div>
    </Section>
  );
}

function EmptyStates() {
  return (
    <Section id="empty" title="États vides" hint="Toujours : une icône, un titre court, une phrase qui dit quoi faire. Les pages Aujourd'hui et Surveillance vides : interrupteur « Vide ».">
      <div className="gallery-cards">
        <div className="gallery-box"><Empty icon="tasks" title="Aucune tâche pour l'instant">Demande quelque chose à un bot : ses tâches apparaîtront ici.</Empty></div>
        <div className="gallery-box"><Empty icon="key" title="Aucune clé enregistrée">Ajoute une clé quand un bot en a besoin ; il te la demandera.</Empty></div>
        <div className="gallery-box"><Empty icon="search" title="Aucun résultat">Essaie un autre mot.</Empty></div>
        <div className="gallery-box"><Empty icon="history" /></div>
      </div>
    </Section>
  );
}
