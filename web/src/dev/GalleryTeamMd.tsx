/**
 * « Équipe Sklubot (.md) » in the dev gallery (section=equipe): the real windows, with fake data (teamMdFixtures.ts,
 * answered by fakeApi.ts). One window per page, chosen with `view=`:
 *   view=review (default)   the review screen of a team file
 *   view=update             the same file imported again: « Mettre à jour » / « Créer une copie »
 *   view=choose             the first step: file, pasted text or link
 *   view=share              « Partager en fichier .md »: the file, ready to download
 */
import { TeamMdImportModal, TeamMdShareModal } from "../components/TeamMarkdown";
import type { FixtureOptions } from "./fixtures";
import { teamMdPreviewFixture } from "./teamMdFixtures";

export function GalleryTeamMd({ o }: { o: FixtureOptions }) {
  const view = new URLSearchParams(location.search).get("view") ?? "review";
  const close = () => undefined;
  if (view === "share") return <TeamMdShareModal onClose={close} sectionId="sec_gallery" />;
  if (view === "choose") return <TeamMdImportModal onClose={close} initialTab="url" />;
  return <TeamMdImportModal key={view} onClose={close} initialPreview={teamMdPreviewFixture(o, view === "update")} />;
}
