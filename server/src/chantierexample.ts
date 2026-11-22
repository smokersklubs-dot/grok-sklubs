/**
 * « Chantier » — the worked example (docs/CHANTIER.md, the tests and the web gallery): « outil qui transforme un article
 * en cartes pour les réseaux sociaux » (paste a text → edit the cards → export images). Its export task carries the
 * contract of the owner's article: as many files as cards, in the editor's order, at the chosen size, each card's text
 * present; scope: do not change the text generation nor the editor. No imports: the web app loads it as it is.
 */
import type { ChantierPlan } from "./chantiertypes.js";

export const ARTICLE_CARDS_TITLE = "Outil qui transforme un article en cartes pour les réseaux sociaux";
export const ARTICLE_CARDS_BRIEF = "Je colle le texte d'un article, l'outil le découpe en cartes ; je corrige les cartes dans un éditeur, puis j'exporte une image par carte (format 1080 × 1350) pour les réseaux sociaux.";

/** The plan, for three bots of the owner: a researcher, a builder, a reviewer. */
export function articleCardsPlan(ids: { research: string; build: string; review: string }): ChantierPlan {
  return {
    observations: ["On colle le texte d'un article.", "L'outil propose des cartes qu'on peut corriger dans un éditeur.", "On exporte une image par carte."],
    assumptions: ["Format d'export 1080 × 1350 (portrait, réseaux sociaux).", "Images en PNG."],
    unknowns: [{ id: "q1", text: "Combien de cartes au plus par article ?", answer: "" }],
    requirements: [
      { id: "r1", text: "Le texte collé est découpé en cartes, dans l'ordre de l'article.", acceptance: "cards.json contient les cartes dans l'ordre." },
      { id: "r2", text: "L'export produit une image par carte, dans l'ordre de l'éditeur, à la taille choisie.", acceptance: "Nombre d'images = nombre de cartes ; ordre identique ; 1080 × 1350." },
      { id: "r3", text: "Chaque image porte le texte de sa carte.", acceptance: "Le manifeste de l'export reprend le texte de chaque carte." },
    ],
    tasks: [
      {
        key: "recherche", title: "Recherche : formats des réseaux sociaux", role: "research", botId: ids.research, reviewerBotId: "",
        deliverable: "sources.md : les tailles d'image conseillées, avec leurs sources.",
        contract: { input: "Le brief du chantier.", output: "sources.md", checks: [{ id: "c1", kind: "file_exists", label: "sources.md existe", path: "sources.md" }, { id: "c2", kind: "size_between", label: "sources.md fait au moins 40 octets", path: "sources.md", min: 40 }], criteria: [], scope: ["Ne recopier aucun texte d'un autre outil : seulement des faits et des liens."] },
        resources: [],
      },
      {
        key: "exigences", title: "Cahier des charges et cartes d'exemple", role: "spec", botId: ids.review, reviewerBotId: "",
        deliverable: "exigences.md et cards.json (les cartes d'exemple, dans l'ordre de l'éditeur).",
        contract: { input: "Le brief du chantier.", output: "exigences.md, cards.json ({\"cards\":[{\"text\":…}]})", checks: [{ id: "c1", kind: "file_exists", label: "exigences.md existe", path: "exigences.md" }, { id: "c2", kind: "json_fields", label: "chaque carte a un texte", path: "cards.json", field: "cards", fields: ["text"] }], criteria: [], scope: ["Décrire le comportement observable seulement, jamais le code d'un autre outil."] },
        resources: [],
      },
      {
        key: "export", title: "Export des images", role: "build", botId: ids.build, reviewerBotId: ids.review,
        deliverable: "Une image PNG par carte dans images/, et manifest.json (fichier, ordre, texte).",
        contract: {
          input: "cards.json et exigences.md (de « exigences »), sources.md (de « recherche »).",
          output: "images/carte-1.png…, cards.json (copie de l'ordre de l'éditeur), manifest.json ({\"files\":[{\"file\",\"text\"}]})",
          checks: [
            { id: "count", kind: "file_count", label: "autant d'images que de cartes", path: "images", ext: "png", countOf: { path: "cards.json", field: "cards" } },
            { id: "order", kind: "same_order", label: "images dans l'ordre de l'éditeur", path: "manifest.json", field: "text", other: { path: "cards.json", field: "text" } },
            { id: "size", kind: "image_size", label: "images en 1080 × 1350", path: "images", width: 1080, height: 1350 },
            { id: "text", kind: "text_present", label: "le texte de chaque carte est présent", path: "manifest.json", textsOf: { path: "cards.json", field: "text" } },
          ],
          criteria: [{ id: "k1", text: "Le texte de chaque carte est complet, sans phrase coupée." }],
          scope: ["Ne pas changer la génération du texte.", "Ne pas changer l'éditeur."],
        },
        resources: ["fichier:export"],
      },
      {
        key: "ensemble", title: "Vérification d'ensemble", role: "check", botId: ids.review, reviewerBotId: "", integration: true,
        deliverable: "Rien de nouveau : les vérifications sur le résultat de l'export.",
        contract: { input: "Le résultat de « export ».", output: "Aucun fichier.", checks: [{ id: "c1", kind: "file_count", label: "l'export a autant d'images que de cartes", path: "images", ext: "png", task: "export", countOf: { path: "cards.json", field: "cards", task: "export" } }], criteria: [], scope: ["Ne rien modifier."] },
        resources: [],
      },
    ],
    edges: [
      { from: "recherche", to: "export", artifact: "sources (tailles d'image)" },
      { from: "exigences", to: "export", artifact: "cahier des charges et cartes" },
      { from: "export", to: "ensemble", artifact: "images exportées et manifeste" },
    ],
    maxAttempts: 3,
  };
}
