/**
 * L157 « rien de perdu » (pagekeep.ts): the card shown when a bot redoes a page and the new version dropped parts of
 * the old one (sections, links, images, text blocks, files). The owner decides: keep the new version, or put the old one
 * back. Wire type shared with the web app.
 */
export interface LostPart { kind: "section" | "link" | "image" | "text" | "file"; text: string; detail?: string }
export interface PageLossCard {
  type: "pageloss"; token: string; title: string;
  /** The version (page_versions.id) the page had before this change: « Remettre l'ancienne version » puts it back. */
  previousVersion: number;
  /** Up to 40 parts, the most visible first; `total` counts them all. */
  lost: LostPart[]; total: number;
  status: "pending" | "kept" | "restored";
}
