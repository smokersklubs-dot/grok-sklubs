import type { HostedLegal, HostedPlan, HostedSettings } from "./shared.js";

/**
 * Hosted mode's public pages (no session, no script, strict CSP like /confidentialite): the prices, generated from the
 * plans (/tarifs in French, /pricing in English), and the legal TEMPLATES (/cgu + /terms, /mentions-legales +
 * /legal-notice). The templates are drafts to be checked by a professional: every page says so at the top, and every
 * detail the owner has not filled in (Settings → Administration → Legal details) shows as [À COMPLÉTER]. Not legal advice.
 */

type Loc = "fr" | "en";
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const TODO = "[À COMPLÉTER]";
const fill = (v: string) => (v.trim() ? esc(v.trim()) : `<mark>${TODO}</mark>`);

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const css = `body{font-family:system-ui,-apple-system,sans-serif;background:#f4f2ee;color:#1e2024;margin:0;padding:24px 16px;line-height:1.6}
main{max-width:860px;margin:0 auto;background:#fff;border:1px solid #e4e0d8;border-radius:14px;padding:24px 28px}
h1{font-size:1.7rem;margin:0 0 .3em}h2{font-size:1.15rem;margin-top:1.6em}h3{font-size:1rem;margin:0}a{color:#2a6fb8}
.muted{color:#5a5f67;font-size:.95rem}.draft{background:#fff4d6;border:1px solid #e8c766;border-radius:10px;padding:10px 14px;margin:0 0 18px;font-weight:600}
mark{background:#ffe9a8;color:#5a4300;padding:0 3px;border-radius:3px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:20px 0}
.plan{border:1px solid #e4e0d8;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:8px}
.price{font-size:1.8rem;font-weight:700}.price small{font-size:.9rem;font-weight:500;color:#5a5f67}
.plan ul{margin:4px 0 8px;padding-left:18px}.plan li{margin:2px 0}.cta{margin-top:auto;display:inline-block;text-align:center;background:#1f6feb;color:#fff;text-decoration:none;border-radius:8px;padding:9px 12px;font-weight:600}
.tag{display:inline-block;font-size:.8rem;background:#eef3fb;color:#2a5ea8;border-radius:999px;padding:1px 9px;align-self:flex-start}
footer{max-width:860px;margin:14px auto 0;text-align:center;font-size:.9rem}footer a{margin:0 8px}
@media(prefers-color-scheme:dark){body{background:#131416;color:#eceef1}main{background:#1a1c1f;border-color:#2b2e32}.plan{border-color:#2b2e32}.muted,.price small{color:#a7adb5}a{color:#79b0ee}.draft{background:#3a3214;border-color:#7a6620;color:#f3e2a6}mark{background:#5a4a12;color:#ffe9a8}.tag{background:#1f2a3a;color:#9cc1f2}.cta{background:#2f7cf6}}`;

function footer(loc: Loc): string {
  const l = loc === "fr"
    ? [["/tarifs", "Tarifs"], ["/cgu", "CGU / CGV"], ["/mentions-legales", "Mentions légales"], ["/confidentialite", "Confidentialité"], ["/", "Se connecter"]]
    : [["/pricing", "Pricing"], ["/terms", "Terms"], ["/legal-notice", "Legal notice"], ["/privacy", "Privacy"], ["/", "Sign in"]];
  return `<footer>${l.map(([h, t]) => `<a href="${h}">${t}</a>`).join("")}</footer>`;
}
function page(loc: Loc, title: string, body: string, other: [string, string]): string {
  return `<!doctype html><html lang="${loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Sklubot</title><style>${css}</style></head><body><main>${body}<p class="muted"><a href="${other[0]}">${other[1]}</a></p></main>${footer(loc)}</body></html>`;
}
const draftBanner = (loc: Loc) => loc === "fr"
  ? `<p class="draft">Brouillon — à faire valider par un professionnel. Ce modèle n'est pas un conseil juridique ; les passages ${TODO} doivent être remplis avant toute mise en ligne commerciale.</p>`
  : `<p class="draft">Draft — to be checked by a professional. This template is not legal advice; the ${TODO} parts must be filled in before any commercial launch. The French version prevails.</p>`;

const money = (n: number, loc: Loc) => n.toLocaleString(loc === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const limitLine = (n: number | null, loc: Loc, one: [string, string], many: [string, string], none: [string, string]) =>
  n === null ? (loc === "fr" ? none[0] : none[1]) : `${n} ${n === 1 ? (loc === "fr" ? one[0] : one[1]) : (loc === "fr" ? many[0] : many[1])}`;

export function pricingPage(loc: Loc, plans: HostedPlan[], s: HostedSettings): string {
  const fr = loc === "fr";
  const cards = plans.map((p) => {
    const lines = [
      p.kind === "byok"
        ? (fr ? "Tes propres clés d'API : tu paies ton fournisseur d'IA directement" : "Your own API keys: you pay your AI provider directly")
        : (fr ? `Budget IA inclus : ${money(p.aiBudgetEur, loc)} € par mois (clés d'IA du service)` : `AI budget included: €${money(p.aiBudgetEur, loc)} per month (the service's AI keys)`),
      limitLine(p.maxBots, loc, ["bot", "bot"], ["bots", "bots"], ["Bots illimités", "Unlimited bots"]),
      limitLine(p.maxAwakeComputers, loc, ["ordinateur allumé à la fois", "computer awake at a time"], ["ordinateurs allumés à la fois", "computers awake at a time"], ["Ordinateurs sans limite du plan", "Computers: no plan limit"]),
      p.storageGb === null ? (fr ? "Stockage sans limite du plan" : "Storage: no plan limit") : (fr ? `${money(p.storageGb, loc)} Go de stockage` : `${money(p.storageGb, loc)} GB of storage`),
      limitLine(p.maxRoutines, loc, ["routine active", "active routine"], ["routines actives", "active routines"], ["Routines illimitées", "Unlimited routines"]),
    ];
    const trial = p.kind !== "free" && s.trialDays > 0 ? `<span class="tag">${fr ? `${s.trialDays} jours d'essai` : `${s.trialDays}-day trial`}</span>` : "";
    return `<section class="plan"><h3>${esc(fr ? p.nameFr : p.nameEn)}</h3>${trial}<div class="price">${fr ? `${money(p.priceEur, loc)} €` : `€${money(p.priceEur, loc)}`} <small>${fr ? "/ mois" : "/ month"}</small></div>
<p class="muted">${esc(fr ? p.descriptionFr : p.descriptionEn)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<a class="cta" href="/?plan=${encodeURIComponent(p.id)}">${fr ? "Créer un compte" : "Create an account"}</a></section>`;
  }).join("");
  // No Sklubot credits for sale (the default): every account brings its own AI account.
  const own = s.creditsForSale ? "" : `<p class="lead">${fr ? "Gratuit — tu utilises ton propre compte OpenRouter, ChatGPT ou Claude : il te facture directement." : "Free — you use your own OpenRouter, ChatGPT or Claude account: it bills you directly."}</p>\n`;
  const body = `<h1>${fr ? "Tarifs" : "Pricing"}</h1>
${own}<p class="muted">${fr ? "Prix par mois. Le budget IA est compté en euros pour chaque mois civil ; une fois épuisé, les bots s'arrêtent sur les clés du service (tu peux recharger, utiliser ta propre clé ou attendre le mois suivant). Rien n'est facturé au-delà de ton offre sans ton accord." : "Prices per month. The AI budget is counted in euros for each calendar month; once it is used up, bots stop on the service's keys (you can top up, use your own key, or wait for the next month). Nothing beyond your plan is billed without your agreement."}</p>
<div class="plans">${cards || `<p>${fr ? "Aucune offre n'est proposée pour l'instant." : "No plan is offered right now."}</p>`}</div>
<p class="muted">${fr ? `Prix ${TODO} (TTC ou HT, TVA applicable). Paiement : ${TODO}. Conditions : <a href="/cgu">CGU / CGV</a>.` : `Prices ${TODO} (including or excluding VAT). Payment: ${TODO}. Terms: <a href="/terms">terms of service</a>.`}</p>
${s.contactUrl ? `<p class="muted">${fr ? "Une question ?" : "A question?"} <a href="${esc(s.contactUrl)}">${fr ? "Nous contacter" : "Contact us"}</a></p>` : ""}`;
  return page(loc, fr ? "Tarifs" : "Pricing", body, fr ? ["/pricing", "English version"] : ["/tarifs", "Version française"]);
}

export function legalNoticePage(loc: Loc, l: HostedLegal): string {
  const fr = loc === "fr";
  const rows: [string, string, string][] = [
    ["Raison sociale ou nom", "Company or name", l.company], ["Forme juridique", "Legal form", l.legalForm], ["Capital social", "Share capital", l.capital],
    ["Adresse du siège", "Registered address", l.address], ["SIREN / SIRET, RCS", "Company registration (SIREN / SIRET, RCS)", l.siret],
    ["N° de TVA intracommunautaire", "EU VAT number", l.vat], ["Directeur ou directrice de la publication", "Publication director", l.director],
    ["Contact (e-mail)", "Contact (e-mail)", l.email], ["Téléphone", "Phone", l.phone],
  ];
  const body = `${draftBanner(loc)}<h1>${fr ? "Mentions légales" : "Legal notice"}</h1>
<h2>${fr ? "Éditeur du service" : "Publisher of the service"}</h2>
<ul>${rows.map(([a, b, v]) => `<li><strong>${fr ? a : b}</strong> : ${fill(v)}</li>`).join("")}</ul>
<h2>${fr ? "Hébergement" : "Hosting"}</h2>
<p>${fill(l.host)}${fr ? " (nom, adresse et téléphone de l'hébergeur)" : " (the host's name, address and phone number)"}</p>
<h2>${fr ? "Logiciel" : "Software"}</h2>
<p>${fr ? "Le service repose sur Sklubot, logiciel libre publié sous licence MIT." : "The service runs Sklubot, free software published under the MIT licence."}</p>
<h2>${fr ? "Données personnelles" : "Personal data"}</h2>
<p>${fr ? `Voir la <a href="/confidentialite">politique de confidentialité</a> et les <a href="/cgu">CGU</a>.` : `See the <a href="/privacy">privacy policy</a> and the <a href="/terms">terms of service</a>.`}</p>`;
  return page(loc, fr ? "Mentions légales" : "Legal notice", body, fr ? ["/legal-notice", "English version"] : ["/mentions-legales", "Version française"]);
}

export function termsPage(loc: Loc, l: HostedLegal, s: HostedSettings): string {
  const fr = loc === "fr";
  const who = fill(l.company);
  const mediator = fill(l.mediator);
  const contact = fill(l.email);
  const trial = s.trialDays;
  const grace = s.graceDays;
  const body = fr ? `${draftBanner(loc)}<h1>Conditions générales d'utilisation et de vente (CGU / CGV)</h1>
<p class="muted">Version du ${TODO}. Service édité par ${who} (voir les <a href="/mentions-legales">mentions légales</a>).</p>
<h2>1. Objet</h2><p>Les présentes conditions régissent l'accès au service hébergé Sklubot (le « Service ») et sa vente. Créer un compte vaut acceptation des présentes conditions, que tu acceptes en cochant la case prévue à l'inscription.</p>
<h2>2. Le Service</h2><p>Le Service met à ta disposition des assistants d'intelligence artificielle (« bots ») qui peuvent converser, garder des souvenirs, exécuter des routines, utiliser un ordinateur virtuel et des applications que tu connectes. Les capacités exactes dépendent de l'offre choisie (<a href="/tarifs">tarifs</a>).</p>
<h2>3. Compte</h2><p>Tu dois être majeur·e (ou avoir l'accord de ton représentant légal) et fournir une adresse e-mail valide. Tu es responsable de la confidentialité de tes identifiants et de l'usage fait de ton compte. ${TODO} (conditions d'âge minimal, usage professionnel ou personnel).</p>
<h2>4. Offres, prix et paiement</h2><p>Les offres, leurs prix et leurs limites sont décrits sur la page <a href="/tarifs">Tarifs</a>, au jour de la souscription. Prix ${TODO} (TTC / HT). Les offres payantes commencent par un essai de ${trial} jours ; à son terme, l'abonnement doit être réglé pour continuer. Moyens de paiement, facturation et renouvellement : ${TODO}. Les crédits IA prépayés achetés en ligne sont vendus par notre revendeur Paddle (${TODO} : dénomination exacte de l'entité Paddle qui vend), qui agit comme vendeur officiel (« merchant of record ») : il encaisse le paiement, facture, applique la TVA et ses propres conditions d'achat, affichées au moment du paiement. Les crédits sont ajoutés à ton compte dès que Paddle confirme le paiement ; en cas de remboursement, les crédits correspondants encore disponibles sont retirés. En cas de défaut de paiement, le compte passe « en retard de paiement » pendant ${grace} jours, puis il est suspendu (lecture seule : connexion, consultation, export et suppression restent possibles ; les bots et routines sont arrêtés).</p>
<h2>5. Budget IA et usage</h2><p>Les offres « Gratuit » et « Tout inclus » comprennent un budget mensuel d'intelligence artificielle, compté en euros par mois civil sur les clés d'IA du Service. Quand il est épuisé, les bots s'arrêtent sur ces clés jusqu'au mois suivant, sauf recharge ou passage à ta propre clé ; rien n'est facturé au-delà sans ton accord. Avec l'offre « J'apporte ma clé », seules tes propres clés d'API sont utilisées et ton fournisseur te facture directement selon ses conditions. Tes abonnements personnels à des outils tiers (par exemple Claude Code, Codex) ne sont utilisés que par tes propres bots, sur ton propre ordinateur virtuel, et restent soumis aux conditions de leur fournisseur.</p>
<h2>6. Droit de rétractation (consommateurs)</h2><p>Si tu es un consommateur, tu disposes d'un délai de quatorze (14) jours à compter de la souscription pour te rétracter, sans avoir à te justifier (articles L221-18 et suivants du Code de la consommation), en nous l'indiquant par une déclaration dénuée d'ambiguïté à ${contact}. Si tu demandes que le Service commence avant la fin de ce délai, tu reconnais que tu devras payer le montant correspondant au service fourni jusqu'à ta rétractation (article L221-25). ${TODO} (modèle de formulaire de rétractation, modalités de remboursement sous 14 jours).</p>
<h2>7. Durée, résiliation, suppression</h2><p>L'abonnement est ${TODO} (mensuel, sans engagement / avec engagement). Tu peux le résilier à tout moment ${TODO}. Tu peux supprimer ton compte et toutes ses données depuis Réglages → Compte. L'éditeur peut suspendre ou résilier un compte en cas de manquement grave aux présentes conditions, après notification sauf urgence.</p>
<h2>8. Usage acceptable</h2><p>Tu t'engages à ne pas utiliser le Service pour des activités illégales, la diffusion de contenus illicites, l'atteinte aux droits de tiers, l'envoi de messages non sollicités, ni pour contourner les limites techniques du Service. ${TODO}</p>
<h2>9. Contenus générés par l'intelligence artificielle</h2><p>Tu interagis avec des systèmes d'intelligence artificielle : les réponses, textes, images, vidéos et actions des bots sont produits automatiquement par des modèles d'IA (transparence prévue à l'article 50 du règlement européen sur l'IA, règlement (UE) 2024/1689). Ils peuvent être inexacts, incomplets ou inadaptés : vérifie-les avant de t'y fier ou de les publier, et signale-les comme générés par une IA lorsque la loi l'exige. Les actions sensibles (paiements, envois, suppressions) te sont soumises pour accord.</p>
<h2>10. Responsabilité</h2><p>Le Service est fourni avec une obligation de moyens. ${TODO} (limites de responsabilité, disponibilité, sauvegardes). Rien dans les présentes ne limite les droits que la loi garantit aux consommateurs.</p>
<h2>11. Données personnelles</h2><p>Le traitement de tes données est décrit dans la <a href="/confidentialite">politique de confidentialité</a>. Sous-traitants (fournisseurs de modèles d'IA, hébergeur) : ${TODO}. Paiement des crédits : Paddle, revendeur et vendeur officiel, qui traite tes données de paiement selon sa propre politique de confidentialité. Tu peux exercer tes droits (accès, rectification, effacement, portabilité, opposition) à ${contact} et saisir la CNIL.</p>
<h2>12. Propriété intellectuelle</h2><p>Tu restes titulaire des contenus que tu fournis. Le logiciel Sklubot est publié sous licence MIT. ${TODO}</p>
<h2>13. Médiation de la consommation</h2><p>En cas de litige, tu peux recourir gratuitement au médiateur de la consommation : ${mediator} (articles L612-1 et suivants du Code de la consommation), après une réclamation écrite préalable auprès de l'éditeur.</p>
<h2>14. Modification des conditions</h2><p>L'éditeur peut modifier les présentes conditions ; tu en es informé·e ${TODO} jours avant leur entrée en vigueur et peux résilier si tu les refuses.</p>
<h2>15. Droit applicable</h2><p>Droit français. ${TODO} (juridiction compétente ; pour les consommateurs, les règles légales de compétence s'appliquent).</p>`
    : `${draftBanner(loc)}<h1>Terms of service and sale</h1>
<p class="muted">Version of ${TODO}. Service published by ${who} (see the <a href="/legal-notice">legal notice</a>).</p>
<h2>1. Purpose</h2><p>These terms govern access to and the sale of the hosted Sklubot service (the "Service"). Creating an account means accepting them, which you do by ticking the box at sign-up.</p>
<h2>2. The Service</h2><p>The Service gives you artificial intelligence assistants ("bots") that can chat, remember, run routines, use a virtual computer and the apps you connect. What exactly is included depends on your plan (<a href="/pricing">pricing</a>).</p>
<h2>3. Account</h2><p>You must be an adult (or have your legal guardian's consent) and give a valid e-mail address. You are responsible for keeping your credentials secret and for what is done with your account. ${TODO}</p>
<h2>4. Plans, prices and payment</h2><p>Plans, prices and limits are those of the <a href="/pricing">pricing</a> page on the day you subscribe. Prices ${TODO} (VAT). Paid plans start with a ${trial}-day trial; after it, the subscription must be paid to continue. Payment means, invoicing and renewal: ${TODO}. Prepaid AI credits bought online are sold by our reseller Paddle (${TODO}: exact name of the Paddle entity that sells), which acts as merchant of record: it takes the payment, issues the invoice, applies VAT and its own buyer terms, shown at checkout. Credits are added to your account as soon as Paddle confirms the payment; after a refund, the matching credits still available are removed. If a payment is missing, the account is "past due" for ${grace} days, then suspended (read-only: you can still sign in, look at, export and delete your data; bots and routines stop).</p>
<h2>5. AI budget and usage</h2><p>The "Free" and "All included" plans include a monthly artificial intelligence budget, counted in euros per calendar month on the Service's AI keys. Once it is used up, bots stop on those keys until the next month, unless you top up or switch to your own key; nothing beyond is billed without your agreement. With "Bring your own key", only your own API keys are used and your provider bills you directly under its own terms. Your personal subscriptions to third-party tools (e.g. Claude Code, Codex) are only used by your own bots, on your own virtual computer, and remain subject to their provider's terms.</p>
<h2>6. Right of withdrawal (consumers)</h2><p>If you are a consumer, you may withdraw within fourteen (14) days of subscribing, without giving a reason (French Consumer Code, articles L221-18 ff.), by a clear statement sent to ${contact}. If you ask for the Service to start before that period ends, you will owe the amount for the service provided until you withdraw (article L221-25). ${TODO}</p>
<h2>7. Term, termination, deletion</h2><p>The subscription is ${TODO}. You may cancel at any time ${TODO}. You can delete your account and all its data in Settings → Account. The publisher may suspend or close an account for a serious breach of these terms, after notice except in an emergency.</p>
<h2>8. Acceptable use</h2><p>You agree not to use the Service for illegal activities, unlawful content, infringing the rights of others, unsolicited messages, or to get around the Service's technical limits. ${TODO}</p>
<h2>9. AI-generated content</h2><p>You are interacting with artificial intelligence systems: the bots' answers, texts, images, videos and actions are produced automatically by AI models (transparency under Article 50 of the EU AI Act, Regulation (EU) 2024/1689). They may be inaccurate, incomplete or unsuitable: check them before relying on or publishing them, and label them as AI-generated where the law requires it. Sensitive actions (payments, sending, deleting) are submitted to you for approval.</p>
<h2>10. Liability</h2><p>The Service is provided on a best-efforts basis. ${TODO}. Nothing here limits the rights the law guarantees to consumers.</p>
<h2>11. Personal data</h2><p>How your data is processed is described in the <a href="/privacy">privacy policy</a>. Processors (AI model providers, host): ${TODO}. Payment for credits: Paddle, reseller and merchant of record, which processes your payment details under its own privacy policy. You can exercise your rights at ${contact} and complain to the CNIL.</p>
<h2>12. Intellectual property</h2><p>You keep the rights to the content you provide. The Sklubot software is published under the MIT licence. ${TODO}</p>
<h2>13. Consumer mediation</h2><p>In a dispute, you may use the consumer mediator free of charge: ${mediator} (French Consumer Code, articles L612-1 ff.), after a prior written complaint to the publisher.</p>
<h2>14. Changes</h2><p>The publisher may change these terms; you are told ${TODO} days before they apply and may cancel if you refuse them.</p>
<h2>15. Governing law</h2><p>French law. ${TODO}</p>`;
  return page(loc, fr ? "CGU / CGV" : "Terms of service", body, fr ? ["/terms", "English version"] : ["/cgu", "Version française"]);
}

/**
 * /paiement: the page Paddle's checkout links point to (credits.ts PAY_PATH; the owner also sets it as Paddle's "default
 * payment link"). It loads Paddle.js from cdn.paddle.com — the only page of the service that runs a third-party script —
 * and Paddle.js opens the checkout of the transaction named in `?_ptxn=` by itself
 * (https://developer.paddle.com/build/transactions/default-payment-link). Documented calls only:
 * `Paddle.Environment.set("sandbox")` before anything else in sandbox
 * (https://developer.paddle.com/paddle-js/methods/paddle-environment-set), then `Paddle.Initialize({ token, checkout:
 * { settings }, eventCallback })` (https://developer.paddle.com/paddle-js/methods/paddle-initialize: `displayMode`,
 * `locale`, `theme`, `successUrl`, `showAddDiscounts`; events `checkout.completed` and `checkout.closed`,
 * https://developer.paddle.com/paddle-js/events). The client-side token is public by design ("Safe to publish in your
 * app code", https://developer.paddle.com/api-reference/about/authentication); the API key never leaves the server.
 */
export function payPage(loc: Loc, o: { env: "sandbox" | "production"; clientToken: string; publicUrl: string; nonce: string }): string {
  const fr = loc === "fr";
  const cfg = JSON.stringify({ sandbox: o.env === "sandbox", token: o.clientToken, locale: loc, success: `${o.publicUrl}/?credits=success`, cancel: `${o.publicUrl}/?credits=cancel` }).replace(/</g, "\\u003c");
  const body = `<h1>${fr ? "Paiement des crédits" : "Paying for credits"}</h1>
<p class="muted" id="msg">${fr ? "Ouverture du paiement sécurisé de Paddle, notre revendeur…" : "Opening Paddle's secure checkout, our reseller…"}</p>
<p class="muted">${fr ? "Paddle vend les crédits en son nom (revendeur officiel) et gère la TVA." : "Paddle sells the credits in its own name (merchant of record) and handles VAT."}</p>
<p><a href="${esc(o.publicUrl)}/?credits=cancel">${fr ? "Revenir à Sklubot" : "Back to Sklubot"}</a></p>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js" nonce="${o.nonce}"></script>
<script nonce="${o.nonce}">(function(){var c=${cfg};var done=false;var msg=document.getElementById("msg");
if(typeof Paddle==="undefined"){msg.textContent=${JSON.stringify(fr ? "Le paiement n'a pas pu se charger. Vérifie ta connexion, puis réessaie depuis Réglages → Crédits." : "The payment could not load. Check your connection, then try again from Settings → Credits.")};return;}
if(!/[?&]_ptxn=txn_/.test(location.search)){msg.textContent=${JSON.stringify(fr ? "Aucun paiement en cours. Choisis un pack dans Réglages → Crédits." : "No payment in progress. Choose a pack in Settings → Credits.")};return;}
if(c.sandbox)Paddle.Environment.set("sandbox");
Paddle.Initialize({token:c.token,checkout:{settings:{displayMode:"overlay",locale:c.locale,theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light",successUrl:c.success,showAddDiscounts:false}},
eventCallback:function(e){if(e&&e.name==="checkout.completed")done=true;if(e&&e.name==="checkout.closed"&&!done)location.assign(c.cancel);}});})();</script>`;
  return page(loc, fr ? "Paiement" : "Payment", body, fr ? ["/cgu", "Conditions de vente"] : ["/terms", "Terms of sale"]);
}
/**
 * The pay page's own CSP. Scripts: only cdn.paddle.com ("Always load Paddle.js directly from https://cdn.paddle.com/",
 * https://developer.paddle.com/paddle-js/about/include-paddlejs) and our inline start-up (by nonce). Paddle does not
 * document the hosts its checkout frame and requests use, so frames, requests, images and fonts may come from any https
 * host — this page shows nothing private and runs no other script.
 */
export const payPageCsp = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.paddle.com; style-src 'unsafe-inline' https:; img-src 'self' data: https:; font-src https:; frame-src https:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
