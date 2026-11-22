# Audit : affaan-m/ECC (pack de compétences et d'agents) face à Sklubot

Dépôt lu : https://github.com/affaan-m/ECC, commit `4adeee6732a12d1540f49a4d50a38ce8c97f9a53` (115 Mo, clone superficiel, rien exécuté, clone effacé ensuite). « ECC » = un plugin de développement pour Claude Code (et 15 autres outils) : 328 compétences, 72 agents, 99 commandes, 28 crochets, des règles par langage, un tableau de bord et un début de panneau de contrôle en Rust.

## Comptes

- 328 compétences : **80 lignes individuelles** pour les compétences non réservées aux développeurs, **35 lignes individuelles** pour les mécanismes d'agent (mémoire, apprentissage, sécurité, qualité) qui concernent Sklubot, et **213 compétences de développeur regroupées en 12 familles** (chaque nom est listé).
- 72 agents (regroupés par famille, les non-développeurs à part), 99 commandes (regroupées), 28 crochets (une ligne chacun), autres parties (une ligne chacune).

Compétences, statut côté Sklubot :

| Statut | Lignes individuelles | Compétences regroupées | Total |
|---|---|---|---|
| FAIT | 20 | 0 | 20 |
| PARTIEL | 50 | 0 | 50 |
| MANQUANT | 19 | 0 | 19 |
| DIFFÉRENT | 6 | 12 | 18 |
| NON REPRIS | 20 | 201 | 221 |
| **Total** | 115 | 213 | 328 |

Verdicts sur les lignes individuelles : ADAPTER 22 · IDÉE 47 · NON 46 ; les 213 compétences regroupées : NON.

## Licence

- `LICENSE` à la racine : **MIT License**, « Copyright (c) 2026 Affaan Mustafa ». Elle couvre tout ce qui n'a pas de licence propre.
- Licences propres, à respecter dossier par dossier :
  - **Apache-2.0** (8, auteur « evos », origine ECC) : `carrier-relationship-management`, `customs-trade-compliance`, `energy-procurement`, `inventory-demand-planning`, `logistics-exception-management`, `production-scheduling`, `quality-nonconformance`, `returns-reverse-logistics`. Reprise possible avec la licence et la liste des modifications (comme les compétences Anthropic dans `server/skills-library`).
  - **MIT déclarée dans le fichier** (10) : `agent-eval`, `benchmark`, `benchmark-methodology`, `benchmark-optimization-loop`, `data-throughput-accelerator`, `latency-critical-systems`, `mle-workflow`, `parallel-execution-optimizer`, `recursive-decision-ledger`, `verification-loop`.
  - **CC-BY-SA-4.0** : `osint-investigation` (« adapté de shoyann/RZK-The-Hunter », avec `LICENSE.txt`). Le partage à l'identique imposerait la même licence à une adaptation : **ne pas reprendre**.
  - **MIT © Matt Pocock** : `context-and-decisions` (avec son propre `LICENSE`) ; voir l'audit mattpocock/skills.
  - `react-performance` dit être adaptée des « React Best Practices » de Vercel (vercel-labs/agent-skills) : licence d'origine non vérifiée ; ne pas reprendre sans la lire.
- Taille : 30 compétences dépassent ~20 000 caractères, la limite d'import de Sklubot (`server/src/skillsgithub.ts:154`), dont **les 7 compétences « métiers » Apache-2.0** (23 à 30 ko : `inventory-demand-planning`, `logistics-exception-management`, `returns-reverse-logistics`, `customs-trade-compliance`, `energy-procurement`, `production-scheduling`, `quality-nonconformance`), `data-scraper-agent` (26 ko), `gateguard` (44 ko). Elles seront refusées à l'import GitHub ; les reprendre veut dire les **condenser** (modification à déclarer dans le NOTICE).
- Le nom « ECC », « AgentShield », « SocialClaw », « Itô » sont des marques/produits tiers : ne pas les reprendre dans Sklubot.

## Point important côté Sklubot

Les bots « sur abonnement » font tourner Claude Code et Codex dans leur ordinateur Linux (`server/src/agent/engine.ts:1-10`, `docker/desktop/Dockerfile:28`). Le plugin ECC pourrait donc s'y installer. **À ne pas faire** : ses 28 crochets s'exécutent à chaque outil, à chaque message et à l'arrêt, écrivent dans `~/.claude`, envoient des notifications, et certains (apprentissage continu) observent toute la séance. Cela ajouterait un comportement caché aux bots, sans les approbations de Sklubot. Les bonnes idées sont à réécrire dans Sklubot, ou leurs textes MIT/Apache à reprendre dans `server/skills-library` avec licence et avis.

## Ce que Sklubot a déjà (vérifié)

- 17 compétences intégrées (`server/skills-library/catalog.json`), manuel de ~50 méthodes (`server/templates/methodes/manuel.md`, outil `guide_read`, `server/src/agent/guides.ts:115`), 9 guides de tâches (`guides.ts:14-86`), 9 modèles d'équipe (`server/templates/*.md` : assistante, boutique, prospection B2B, réseaux sociaux, secrétariat, SEO contenu, service client, suivi finances, veille).
- `/skill <nom>` force une compétence depuis le chat (`web/src/components/Composer.tsx:49-69`, `server/src/agent/loop.ts:337`). Import GitHub de `SKILL.md` avec contrôle de licence et de sécurité (`server/src/skillsgithub.ts`, `skillscan.ts`, test `server/test/skill-scan.test.ts`).
- Recherche approfondie avec preuves, mails Gmail/Outlook natifs, studio vidéo, pages/artefacts versionnés, mémoire, routines, groupes de bots, relecture entre bots, blocage des commandes irréversibles (`agent/irreversible.ts:47`).

## Tableau 1 — compétences non réservées aux développeurs (une ligne chacune)


### Écrire et communiquer

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| article-writing | MIT (dépôt) | Écrire articles, guides, lettres d'info avec une vraie voix, à partir d'exemples ; bannit les tournures « IA ». | Modèle d'équipe `seo-contenu.md` ; compétence « Réponses courtes ». | PARTIEL | ADAPTER : règles anti-« style IA » utiles à tous les bots rédacteurs. | S |
| brand-discovery | MIT (dépôt) | Entretien d'identité de marque en 8 modules sur plusieurs séances, réponses écrites au fur et à mesure, synthèse « brandbook ». | « Design de marque » applique une marque existante (`skills-library/design-de-marque`) ; rien pour la **construire**. | MANQUANT | ADAPTER : très parlant pour un petit patron (sortie en fichier d'équipe). | M |
| brand-voice | MIT (dépôt) | Construire un profil de voix à partir de vrais textes, puis l'utiliser partout. | « Design de marque » lit couleurs, polices, logo **et ton** du compte. | PARTIEL | ADAPTER : la méthode « extraire la voix de 5 vrais textes » manque. | S |
| content-engine | MIT (dépôt) | Contenus natifs par réseau (X, LinkedIn, TikTok, YouTube, lettre) sans aplatir la voix ; recyclage d'un contenu en plusieurs. | Modèle d'équipe `reseaux-sociaux.md`. | PARTIEL | ADAPTER (texte court, MIT). | S |
| crosspost | MIT (dépôt) | Diffuser sur X, LinkedIn, Threads, Bluesky en adaptant chaque version, jamais le même texte. | Rien pour publier ; `reseaux-sociaux.md` prépare seulement. | PARTIEL | IDÉE : la règle « jamais deux fois le même texte » dans le modèle réseaux sociaux. Publication : chaque envoi avec accord. | S |
| investor-materials | MIT (dépôt) | Pitch deck, mémo, one-pager, modèle financier, dossiers d'accélérateur cohérents entre eux. | « Présentations » + `openman_workspace` ; rien sur la cohérence des chiffres entre documents. | PARTIEL | ADAPTER : la liste « mêmes chiffres partout » est utile. | S |
| investor-outreach | MIT (dépôt) | E-mails froids, intros, relances, nouvelles aux investisseurs. | « E-mails à relire avant envoi » (`brouillon-email`). | PARTIEL | IDÉE (modèle d'équipe « Levée de fonds »). | S |
| marketing-campaign | MIT (dépôt) | Campagne de bout en bout : audience, positionnement, angle, page, séquence e-mail, calendrier. | Manuel « Préparer une campagne créative » (`manuel.md:131`). | PARTIEL | ADAPTER la partie plan + calendrier. | S |
| growth-log | MIT (dépôt) | Journal d'apprentissage qui extrait la règle réutilisable (cause, règle, signal) au lieu d'un journal intime. | `skill_propose` après une tâche (`tools.ts:785`) ; mémoire. | PARTIEL | IDÉE : format « cause / règle / signal » pour les leçons proposées par les bots. | S |
| token-budget-advisor | MIT (dépôt) | Propose une profondeur de réponse (25/50/75/100 %) avant de répondre. | « Réponses courtes » ; réglage de longueur absent. | PARTIEL | NON (trop technique) ; IDÉE : bouton « plus court / plus détaillé ». | — |
| visa-doc-translate | MIT (dépôt) | Traduit des documents de visa (OCR) en PDF bilingue, **sans demander confirmation**. | `ocr`, `office_convert`. | PARTIEL | IDÉE seulement : la consigne « sans confirmation » sur des papiers d'identité est contraire aux règles Sklubot. | S |

### Recherche

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| deep-research | MIT (dépôt) | Rapports cités multi-sources via Firecrawl et Exa (MCP payants). | `deep_research_start`, registre de preuves (`researchevidence.ts`), rapports (`researchreports.ts`). | FAIT | NON (couvert, sans fournisseurs payants). | — |
| research-ops | MIT (dépôt) | Recherche « état actuel » fondée sur des preuves fraîches, avec recommandation. | Idem + manuel « Rechercher et décider » (`manuel.md:26`). | FAIT | NON | — |
| market-research | MIT (dépôt) | Étude de marché, TAM/SAM/SOM, concurrence, dossier investisseur, sources citées. | Recherche approfondie ; guide « Recherche et synthèse » (`guides.ts:86`). | PARTIEL | ADAPTER : gabarit TAM/SAM/SOM + « décision, pas théâtre ». | S |
| exa-search | MIT (dépôt) | Recherche via le MCP Exa (payant). | `search_web` avec fournisseurs gratuits d'abord (`tools.ts:814`). | FAIT | NON (fournisseur payant) | — |
| competitive-platform-analysis | MIT (dépôt) | Délimiter et filtrer un ensemble de concurrents avant de les comparer. | Manuel « Comparer les options par critère » (`manuel.md:39`). | PARTIEL | ADAPTER avec les deux suivantes en une compétence « Étude de concurrence ». | M |
| benchmark-methodology | MIT | Fiches concurrents notées sur 9 dimensions pondérées (positionnement, voix, offre, preuves…). | — | MANQUANT | ADAPTER (voir ci-dessus) | S |
| competitive-report-structure | MIT (dépôt) | Assembler les fiches en rapport de décision avec carte du marché. | Modèles de pages (`modeles-de-pages`, « rapport »). | PARTIEL | ADAPTER (voir ci-dessus) | S |
| product-lens | MIT (dépôt) | Valider le « pourquoi » avant de construire : 4 diagnostics, fiche produit avec go/no-go. | Rien. | MANQUANT | ADAPTER (« Mon idée tient-elle ? »). | S |
| osint-investigation | CC-BY-SA-4.0 | Méthode d'enquête à partir d'indices maigres (photos, profils), relier les preuves. | Recherche approfondie. | NON REPRIS | NON : licence **CC-BY-SA-4.0** (le partage à l'identique contaminerait l'adaptation) et risque de viser des personnes privées. | — |
| scientific-db-openalex-database | MIT (dépôt) | Recherche de littérature scientifique via l'API OpenAlex (gratuite). | Recherche approfondie générale. | PARTIEL | IDÉE : source « articles scientifiques » pour la recherche approfondie. | S |
| scientific-db-pubmed-database | MIT (dépôt) | Recherche biomédicale PubMed/NCBI. | — | PARTIEL | IDÉE (même source) | S |
| scientific-db-uspto-database | MIT (dépôt) | Brevets et marques américains (USPTO). | — | MANQUANT | IDÉE : vérifier une marque avant de nommer un produit. | S |
| scientific-pkg-gget | MIT (dépôt) | Requêtes génomiques gget. | — | NON REPRIS | NON (spécialisé) | — |
| scientific-thinking-literature-review | MIT (dépôt) | Revue de littérature systématique : plan de recherche, tri, synthèse. | Recherche approfondie. | PARTIEL | ADAPTER la grille de tri des sources. | S |
| scientific-thinking-scholar-evaluation | MIT (dépôt) | Évaluer un article ou une proposition (méthode, preuves, citations). | — | MANQUANT | IDÉE | S |
| knowledge-ops | MIT (dépôt) | Base de connaissances multi-couches : ingérer, ranger, synchroniser, retrouver. | Mémoire (`memory_save`/`memory_search`), fichiers d'équipe, recherche dans les conversations (`tools.ts:743`). | PARTIEL | IDÉE : règles « où ranger quoi » pour les bots. | S |

### Commerce, opérations, documents

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| lead-intelligence | MIT (dépôt) | Pipeline de prospects : signaux, score, chemins d'introduction chaleureux ; vise à remplacer Apollo/Clay/ZoomInfo ; API X, Exa. | Modèle d'équipe `prospection-b2b.md`. | PARTIEL | IDÉE : la notation par signaux ; sans API payantes ni données personnelles. | S |
| connections-optimizer | MIT (dépôt) | Trier ses abonnements X/LinkedIn, recommandations, messages d'approche (Apple Mail, DM X, LinkedIn). | — | NON REPRIS | NON : comptes personnels X/LinkedIn automatisés. | — |
| social-graph-ranker | MIT (dépôt) | Classement pondéré du réseau social pour trouver des intros. | — | NON REPRIS | NON (même raison) | — |
| social-publisher | MIT (dépôt) | Publication programmée sur 13 réseaux via le service SocialClaw (clé API). | — | NON REPRIS | NON : service tiers payant ; IDÉE de connecteurs officiels plus tard. | — |
| short-video-distribution | MIT (dépôt) | Publier une vidéo verticale sur TikTok, Shorts, Reels : contrôle des limites de chaque plateforme, légendes natives, pas d'envoi surprise. | Studio vidéo (`videostudio.ts`). | PARTIEL | ADAPTER la liste de contrôle par plateforme (durée, format, légende) ; publication avec accord. | S |
| x-api | MIT (dépôt) | API X : publier, lire, rechercher. | Recherche X (`server/src/xsearch.ts`). | PARTIEL | NON pour publier (accès payant). | — |
| customer-billing-ops | MIT (dépôt) | Abonnements, remboursements, résiliations via outils de facturation connectés. | Connecteur Stripe (`catalog.ts`), modèle `service-client.md`. | NON REPRIS | NON : paiements hors périmètre. | — |
| finance-billing-ops | MIT (dépôt) | Instantané des ventes, prix, remboursements. | Modèle `suivi-finances.md`. | PARTIEL | IDÉE (lecture seule des ventes). | S |
| email-ops | MIT (dépôt) | Tri de boîte, brouillons, envoi **vérifié dans Envoyés**, relances. | Gmail/Outlook natifs (`docs/COUVERTURE.md:199-205`), `brouillon-email`. | PARTIEL | ADAPTER : « prouver que c'est parti » (vérifier le dossier Envoyés après un envoi). | S |
| messages-ops | MIT (dépôt) | Lire iMessage/DM, récupérer un code à usage unique. | `email_code_type` (code par e-mail, `tools.ts:691`). | NON REPRIS | NON : messageries personnelles non officielles. | — |
| google-workspace-ops | MIT (dépôt) | Docs, Sheets, Slides comme un seul espace de travail (trackers, decks). | Drive natif ; Sheets/Docs non vérifiés. | PARTIEL | IDÉE | S |
| unified-notifications-ops | MIT (dépôt) | Toutes les notifications (GitHub, Linear, bureau) en un flux. | Notifications push (`server/src/push.ts`), vue Aujourd'hui. | PARTIEL | NON | — |
| master-agreement-generator | MIT (dépôt) | Contrats-cadres à partir d'un modèle + une fiche JSON ; toujours marqués **BROUILLON**. | Guide « Rédiger un devis » (`guides.ts:40`). | MANQUANT | IDÉE : la règle « tout document juridique est un brouillon marqué » ; pas de modèle de contrat (avis juridique). | S |
| esign-field-placement | MIT (dépôt) | Placer signature/date dans un outil de signature en ligne avec calibrage et accord de l'opérateur. | `element_click` / `screen_click`. | NON REPRIS | NON (signature = acte engageant). | — |
| nutrient-document-processing | MIT (dépôt) | Convertir, OCR, caviarder, signer des documents via l'API payante Nutrient. | `ocr`, `office_convert`, `office_render`. | FAIT (sans API payante) | NON | — |
| customs-trade-compliance | Apache-2.0 | Douane : classement tarifaire, factures, Incoterms. (Apache-2.0) | — | MANQUANT | IDÉE : bibliothèque « métiers » ; texte Apache réutilisable, mais conseil réglementaire. | M |
| carrier-relationship-management | Apache-2.0 | Transporteurs : sélection, tarifs, appels d'offres, fiches de notation. (Apache-2.0) | — | MANQUANT | IDÉE (bibliothèque métiers) | S |
| energy-procurement | Apache-2.0 | Achat d'électricité et de gaz pour sites pros. (Apache-2.0) | — | MANQUANT | IDÉE | S |
| inventory-demand-planning | Apache-2.0 | Prévision de la demande, stock de sécurité, ABC/XYZ. (Apache-2.0) | Modèle `boutique-en-ligne.md` (stocks). | PARTIEL | **ADAPTER** pour le modèle boutique (Apache-2.0, garder NOTICE). | S |
| logistics-exception-management | Apache-2.0 | Retards, casse, pertes, litiges transporteur. (Apache-2.0) | Modèle `boutique-en-ligne.md` (colis). | PARTIEL | **ADAPTER** (même modèle). | S |
| returns-reverse-logistics | Apache-2.0 | Retours, inspection, remboursement, fraude. (Apache-2.0) | Modèle `service-client.md`. | PARTIEL | **ADAPTER** (boutique / service client). | S |
| production-scheduling | Apache-2.0 | Ordonnancement d'atelier. (Apache-2.0) | — | MANQUANT | IDÉE | S |
| quality-nonconformance | Apache-2.0 | Non-conformités en industrie réglementée. (Apache-2.0) | — | MANQUANT | IDÉE | S |

### Création visuelle et vidéo

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| frontend-slides | MIT (dépôt) | Présentations HTML animées, ou conversion de PowerPoint. | « Présentations » (`skills-library/presentations`), `openman_workspace`. | FAIT | NON | — |
| design-system | MIT (dépôt) | Extraire un système de design (couleurs, typo, espacements) d'un code ou l'auditer. | « Styles de base », « Design de marque ». | PARTIEL | IDÉE : audit de cohérence d'une page. | S |
| frontend-design-direction | MIT (dépôt) | Direction visuelle pour une interface de production. | « Design soigné » (frontend-design). | FAIT | NON | — |
| make-interfaces-feel-better | MIT (dépôt) | Détails concrets qui rendent une interface soignée (espacements, bordures, ombres). | « Règles de métier du design ». | FAIT (proche) | IDÉE : comparer les listes. | S |
| accessibility | MIT (dépôt) | Concevoir et auditer l'accessibilité WCAG 2.2 AA (web, iOS, Android). | `metier-du-design` (règles), pas d'outil d'audit. | PARTIEL | IDÉE : audit outillé des pages. | S |
| ui-canvas | MIT (dépôt) | La personne ajuste à la main une maquette HTML dans le navigateur (déplacer, redimensionner, texte), « Enregistrer » renvoie le résultat exact à l'agent. | Atelier d'artefact : demande de modification en langage naturel (`docs/ARTEFACTS.md`). | MANQUANT | IDÉE (L) : retouche directe d'un artefact à la souris. | L |
| plan-canvas | MIT (dépôt) | La personne annote un élément précis d'un plan/artefact, discute, puis « Approuver / Demander des changements » ; l'agent attend le verdict. | Atelier + versions ; pas d'annotation par élément. | PARTIEL | IDÉE (M) : cliquer un élément d'un artefact pour commenter « ceci ». | M |
| ui-demo | MIT (dépôt) | Enregistrer une vidéo de démonstration d'une appli web avec Playwright. | Atelier vidéo GitHub (`video-github`), enregistrement d'écran du bot. | PARTIEL | IDÉE | S |
| video-editing | MIT (dépôt) | Montage assisté : FFmpeg, Remotion, structure, sous-titres. | Studio vidéo (`videostudio.ts`, `studiomp4.ts`). | FAIT | NON | — |
| remotion-video-creation | MIT (dépôt) | 29 règles Remotion (vidéo en React). | Studio + techniques d'animation (`studiotechniques.ts`). | DIFFÉRENT | NON (dev) | — |
| manim-video | MIT (dépôt) | Vidéos explicatives Manim. | — | MANQUANT | IDÉE | S |
| videodb | MIT (dépôt) | Indexer, chercher, monter de la vidéo via le SDK VideoDB (service). | `video_frames`, `transcribe`. | PARTIEL | NON (service tiers) | — |
| fal-ai-media | MIT (dépôt) | Images, vidéos, sons via fal.ai. | `image_generate`, `video_generate`, connecteur Higgsfield. | FAIT | NON | — |
| taste | MIT (dépôt) | Vocabulaire esthétique pour clips (genres « angelcore », « hyperpop »…). | Direction artistique de Sklubot. | NON REPRIS | NON (niche) | — |
| taste-distillation | MIT (dépôt) | Mesurer des vidéos de référence en « pack de style » (LUT couleur, rythme de coupe, images clés). | Animation de références (`animationreferences.ts`). | PARTIEL | IDÉE (M) : « fais une vidéo dans le style de celle-ci » chiffré (rythme, couleurs). | M |
| taste-application | MIT (dépôt) | Générer une vidéo selon un pack de style et la monter. | Studio vidéo. | PARTIEL | IDÉE (avec la précédente) | S |
| tasteforge-video | MIT (dépôt) | Découverte et entretien de goût pour images, vidéos, 3D. | — | NON REPRIS | NON | — |
| blender-motion-state-inspection | MIT (dépôt) | Vérifier poses et animations de personnages Blender. | — | NON REPRIS | NON (spécialisé) | — |

### Qualité et méthode (utile à tous les bots)

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| council | MIT (dépôt) | Quatre voix (l'agent, un sceptique, un pragmatique, un critique) pour une décision ambiguë ; désaccord structuré avant de trancher. | Groupes : `@everyone` ou la règle « everyone » font répondre tous les bots (`agent/team.ts:120-163`) ; mais pas de rôles (sceptique, pragmatique, critique) ni de synthèse finale. | PARTIEL | **ADAPTER** : « Conseil » pour les décisions du patron (go/no-go, choix de fournisseur). | M |
| council-multi-model | MIT (dépôt) | Ajoute une critique d'un autre modèle (Codex) au conseil. | Moteurs Claude/Codex disponibles (`engine.ts`). | MANQUANT | IDÉE : l'avis d'un bot d'un autre moteur dans le conseil. | S |
| santa-method | MIT (dépôt) | Deux relecteurs indépendants, même grille, tous deux doivent valider avant publication ; boucle correction/relecture. | Relecture entre bots (`peerreviewstore.ts`), un seul relecteur. | PARTIEL | **ADAPTER** pour tout ce qui part chez un client (page publique, e-mail de masse). | S |
| agent-self-evaluation | MIT (dépôt) | Après une tâche complexe, l'agent se note sur 5 axes (justesse, complétude, clarté, actionnable, concision) et signale ses excès de confiance. | « Méthode de travail » §3 (vérifier avant « fini »). | PARTIEL | ADAPTER (court). | S |
| operator-approval-loop | MIT (dépôt) | Chaque brouillon sortant est une obligation ; l'opérateur décide sur le **texte exact** (empreinte du brouillon), registre de livraison qui prouve ce qui est parti. | Cartes d'approbation (`agent/authorize.ts`), journal (`journal.ts`). | PARTIEL | IDÉE (S) : vérifier que le texte envoyé est **identique** à celui approuvé (empreinte) — non vérifié côté Sklubot. | S |
| counterparty-channel-discipline | MIT (dépôt) | Dans un canal partagé avec clients/fournisseurs : séparer « qui est là », « a-t-il accepté », « ai-je le droit d'envoyer » ; observer sans parler ; pas de traces internes. | Bots partagés dans un espace de travail (tour « prudent », `loop.ts` « message from someone of a workspace »), Slack. | PARTIEL | ADAPTER : règles pour un bot présent dans un salon Slack client. | S |
| intent-driven-development | MIT (dépôt) | Transformer une demande floue en critères d'acceptation vérifiables. | Manuel « Définir le test de réception » (`manuel.md:12`). | PARTIEL | NON (couvert en court) | — |
| data-scraper-agent | MIT (dépôt) | Agent de collecte planifiée sur sources publiques (emplois, prix, actualités) avec stockage et enrichissement (26 ko). | Routines + `web_fetch`/navigateur ; guide « Comparer des prix » (`guides.ts:30`). | FAIT (autrement) | IDÉE : modèle de routine « veille de prix » ; texte trop long pour l'import (26 ko > 20 000). | S |
| canary-watch | MIT (dépôt) | Après une mise en ligne, surveiller adresses, ressources, erreurs console, performances. | Routines + navigateur ; pas de contrôle des erreurs console. | PARTIEL | IDÉE : routine « ma boutique répond-elle ? ». | S |
| browser-qa | MIT (dépôt) | Vérif d'interface après déploiement : erreurs console, Core Web Vitals. | Captures par le bot. | PARTIEL | IDÉE : outil « erreurs de la page ». | S |
| seo | MIT (dépôt) | Audit et plan SEO technique + contenu. | Modèle `seo-contenu.md`, connecteurs Ahrefs/Semrush. | PARTIEL | ADAPTER la liste technique (balises, données structurées). | S |
| homelab-network-setup | MIT (dépôt) | Planifier le réseau d'une maison (box, Wi-Fi, IP, DNS) pour débutants. | — | MANQUANT | IDÉE (faible priorité) | S |

## Tableau 2 — mécanismes d'agent qui concernent Sklubot (une ligne chacun)

| Compétence | Licence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|---|
| continuous-learning-v2 | MIT (dépôt) | Observe les séances par crochets, crée des « instincts » atomiques avec **score de confiance**, propres à un projet ou globaux, puis les fait évoluer en compétences. | `skill_propose` (proposition après une tâche, relue par l'utilisateur, `tools.ts:785`) ; « Montre-moi comment » (`teach.ts`). | PARTIEL | IDÉE (M) : un score de confiance par leçon apprise, qui monte quand elle sert et baisse quand l'utilisateur corrige ; jamais d'activation sans accord. | M |
| continuous-learning | MIT (dépôt) | Version 1 dépréciée de la précédente. | — | NON REPRIS | NON | — |
| ck | MIT (dépôt) | Mémoire par projet (init, save, resume, forget). | Mémoire par bot, « oublier » (`MEMOIRE.md`). | FAIT | NON | — |
| unified-memory | MIT (dépôt) | Coffre de mémoire partagé entre plusieurs agents (Claude, Codex, Hermes…), documents Markdown portables. | Mémoire par bot ; compétences partagées entre coéquipiers (`prompt.ts:237`). | PARTIEL | IDÉE : mémoire d'équipe partagée et lisible (fichier). | S |
| strategic-compact | MIT (dépôt) | Proposer de compacter le contexte à des moments logiques plutôt qu'au hasard. | Gestion du contexte côté serveur (`agent/context.ts`). | DIFFÉRENT | NON | — |
| context-budget | MIT (dépôt) | Mesurer le contexte consommé. | — | NON REPRIS | NON | — |
| cost-tracking | MIT (dépôt) | Rapport de jetons, dépenses, budgets à partir d'un journal local. | Journal des dépenses, plafonds (`usagecaps.ts`). | FAIT | NON | — |
| safety-guard | MIT (dépôt) | Trois modes : « prudent » (confirme `rm -rf`, `push --force`, `DROP TABLE`), « gel » (n'écrit que dans un dossier), les deux ; **simples consignes**, pas des blocages. | Blocage réel côté serveur des commandes irréversibles (`agent/irreversible.ts:47`) + approbations. | FAIT (plus fort) | IDÉE : ajouter `DROP TABLE`, `branch -D` au motif ; mode « n'écris que dans ce dossier » pour une tâche. | S |
| gateguard | MIT (dépôt) | Refuse la **première** modification d'un fichier tant que l'agent n'a pas présenté des faits concrets (imports, appelants, format des données). | — | MANQUANT | IDÉE pour bots qui codent seulement. | S |
| delivery-gate | MIT (dépôt) | Empêche l'agent de finir tant que des contrôles mécaniques ne passent pas (horodatages, disque, motifs de « rationalisation » dans le texte). | « Méthode de travail » §3 (consigne). | PARTIEL | IDÉE (M) : avant « c'est fait » sur une page ou un fichier, contrôle automatique (le fichier existe, la page s'ouvre sans erreur). | M |
| loop-design-check | MIT (dépôt) | Revoir une boucle d'agent : tourne en rond, triche avec le vérificateur, va au bout d'une mauvaise réponse. | Loop guard (`loop.ts:1111`). | PARTIEL | IDÉE : relire le loop guard avec ces 3 cas. | S |
| continuous-agent-loop | MIT (dépôt) | Boucles autonomes avec contrôles qualité, évaluations, reprise. | Tâches de fond, objectifs. | DIFFÉRENT | NON | — |
| autonomous-loops | MIT (dépôt) | Patrons de boucles autonomes (conservé pour compatibilité). | — | NON REPRIS | NON | — |
| autonomous-agent-harness | MIT (dépôt) | Faire de Claude Code un agent autonome : mémoire, tâches planifiées, ordinateur, file de tâches. | C'est ce que Sklubot fait déjà (moteurs, routines, ordinateur Linux). | FAIT | NON | — |
| agentic-os | MIT (dépôt) | Système multi-agents persistant sur Claude Code (noyau, spécialistes, mémoire fichiers, tâches planifiées). | Équipe de bots Sklubot. | FAIT | NON | — |
| enterprise-agent-ops | MIT (dépôt) | Cycle de vie (démarrer, pause, arrêt, redémarrage), observabilité, contrôles pour agents longs. | Pause/reprise (`agent/pause.ts`), sentinelle (`server/src/sentinel`). | FAIT | NON | — |
| agent-introspection-debugging | MIT (dépôt) | Auto-diagnostic d'un échec d'agent : capturer, diagnostiquer, réparer en zone limitée, rapport. | Coordinateur d'échecs (`agent/failures.ts`). | FAIT (autrement) | IDÉE : relire le format de rapport. | S |
| agent-architecture-audit | MIT (dépôt) | Audit d'une appli d'agents sur 12 couches (régression d'emballage, pollution de mémoire, discipline des outils…). | — | NON REPRIS | IDÉE : grille d'auto-audit de Sklubot (pollution de mémoire). | S |
| agent-security-hardening | MIT (dépôt) | Durcir un cadre d'agents qui lit du contenu non fiable et appelle des outils. | Marquage « contenu extérieur » et tour prudent (`turn-request.ts`, `loop.ts:1290-1356`), contrôle des compétences (`skillscan.ts`). | FAIT | IDÉE : comparer la liste. | S |
| agent-harness-construction | MIT (dépôt) | Concevoir l'espace d'actions et les descriptions d'outils d'un agent. | — | NON REPRIS | NON (interne) | — |
| agent-eval | MIT | Comparer des agents de code sur des tâches (réussite, coût, temps, constance). | — | MANQUANT | IDÉE : comparer les moteurs d'un bot sur 5 tâches types. | S |
| eval-harness | MIT (dépôt) | Évaluations avant de coder (capacité, régression). | — | NON REPRIS | NON | — |
| skill-comply | MIT (dépôt) | Vérifie si compétences et règles sont **vraiment suivies** : scénarios à 3 niveaux, fait tourner l'agent, note. | — | MANQUANT | IDÉE (M) : « ce bot suit-il sa compétence ? » sur un exemple. | M |
| skill-stocktake | MIT (dépôt) | Audit qualité des compétences (rapide ou complet). | Contrôle de sécurité, pas de qualité (`skillscan.ts`). | PARTIEL | IDÉE : signaler compétences jamais utilisées, en double, contradictoires. | S |
| skill-scout | MIT (dépôt) | Chercher une compétence existante avant d'en créer une. | Bibliothèque + import GitHub (`skillsgithub.ts`). | PARTIEL | IDÉE : `skill_save` vérifie d'abord la bibliothèque. | S |
| rules-distill | MIT (dépôt) | Extraire des principes communs à plusieurs compétences en règles. | Règles (`agent/ruletools.ts`). | MANQUANT | IDÉE | S |
| security-scan | MIT (dépôt) | Scanner la configuration `.claude/` (AgentShield) pour injections et mauvais réglages. | Contrôle des compétences ; outils locaux approuvés. | DIFFÉRENT | NON | — |
| iterative-retrieval | MIT (dépôt) | Affiner pas à pas le contexte donné à un sous-agent. | Helpers avec objectif écrit. | DIFFÉRENT | NON | — |
| dynamic-workflow-mode | MIT (dépôt) | Harnais et contrôles locaux à une tâche. | — | NON REPRIS | NON | — |
| benchmark-optimization-loop | MIT | Boucle d'amélioration bornée : objectif, contraintes, mesure de départ, une hypothèse à la fois. | Manuel « Tester une hypothèse à la fois » (`manuel.md:204`). | PARTIEL | NON | — |
| recursive-decision-ledger | MIT | Essais répétés avec registre des décisions en ajout seul. | — | NON REPRIS | NON | — |
| agent-runtime-gateway-smoke-test | MIT (dépôt) | Vérifier API d'agent, tunnel et rappel de bac à sable avec une tâche sans outil. | Test de l'ordinateur du bot (`desktest.ts`). | FAIT (autrement) | NON | — |
| ai-first-engineering | MIT (dépôt) | Organisation d'équipe quand l'IA écrit le code. | — | NON REPRIS | NON | — |
| agentic-engineering | MIT (dépôt) | Exécution guidée par évaluations, routage de modèles selon le coût. | Choix du cerveau par bot. | DIFFÉRENT | NON | — |
| team-builder | MIT (dépôt) | Choisir et regrouper des personas d'agents. | Recruteur de bots (`agent/recruit.ts`), modèles d'équipe (`server/templates/`). | FAIT | NON | — |

## Tableau 3 — compétences de développeur, regroupées par famille

Licence : MIT (dépôt) sauf mention dans la section Licence. Toutes NON pour la bibliothèque grand public de Sklubot (public non développeur) ; elles restent importables via « Importer depuis GitHub » pour un compte qui code.

| Famille | Nb | Compétences | Équivalent Sklubot | Statut | Verdict |
|---|---|---|---|---|---|
| Langages et frameworks : bonnes pratiques | 60 | `angular-developer`, `android-clean-architecture`, `backend-patterns`, `bun-runtime`, `clickhouse-io`, `compose-multiplatform-patterns`, `cpp-coding-standards`, `dart-flutter-patterns`, `django-patterns`, `django-celery`, `dotnet-patterns`, `fastapi-patterns`, `frontend-patterns`, `golang-patterns`, `godot-patterns`, `hexagonal-architecture`, `java-coding-standards`, `jpa-patterns`, `kotlin-coroutines-flows`, `kotlin-exposed-patterns`, `kotlin-ktor-patterns`, `kotlin-patterns`, `laravel-patterns`, `mybatis-patterns`, `mysql-patterns`, `nestjs-patterns`, `nextjs-turbopack`, `nuxt4-patterns`, `perl-patterns`, `postgres-patterns`, `prisma-patterns`, `python-patterns`, `pytorch-patterns`, `quarkus-patterns`, `rails-patterns`, `react-native-patterns`, `react-patterns`, `react-performance`, `redis-patterns`, `rust-patterns`, `springboot-patterns`, `swift-actor-persistence`, `swift-concurrency-6-2`, `swift-protocol-di-testing`, `swiftui-patterns`, `tinystruct-patterns`, `typescript-patterns`, `vite-patterns`, `vue-patterns`, `liquid-glass-design`, `foundation-models-on-device`, `motion-foundations`, `motion-patterns`, `motion-advanced`, `ui-to-vue`, `coding-standards`, `error-handling`, `flutter-dart-code-review`, `frontend-a11y`, `laravel-plugin-discovery` | Manuel « Modifier un logiciel existant » (`manuel.md:194`) ; rien par langage. | NON REPRIS | NON (développeur). Possible plus tard via l'import GitHub si un compte code. |
| Tests par langage | 19 | `cpp-testing`, `csharp-testing`, `django-tdd`, `fsharp-testing`, `golang-testing`, `godot-testing`, `kotlin-testing`, `laravel-tdd`, `perl-testing`, `python-testing`, `quarkus-tdd`, `rust-testing`, `springboot-tdd`, `react-testing`, `tdd-workflow`, `e2e-testing`, `windows-desktop-e2e`, `ai-regression-testing`, `test-collaboration` | — | NON REPRIS | NON (développeur) |
| Sécurité et vérification par framework | 14 | `django-security`, `django-verification`, `laravel-security`, `laravel-verification`, `perl-security`, `quarkus-security`, `quarkus-verification`, `rails-security`, `springboot-security`, `springboot-verification`, `security-review`, `security-bounty-hunter`, `web-perimeter-owasp-2025-audit`, `verification-loop` | Sécurité du serveur Sklubot (`hardening.ts`, `egress.ts`). | NON REPRIS | NON (développeur). `security-bounty-hunter` et `web-perimeter-owasp-2025-audit` : à ne pas proposer (sonder des sites tiers). |
| Processus d'ingénierie (plans, PR, docs, dépôts) | 39 | `api-design`, `api-connector-builder`, `architecture-decision-records`, `blueprint`, `brownfield-retrospective`, `change-impact`, `click-path-audit`, `code-tour`, `codebase-onboarding`, `codehealth-mcp`, `conventional-commit-review`, `contract-first`, `context-and-decisions`, `database-migrations`, `docs-governance`, `documentation-lookup`, `git-workflow`, `github-ops`, `inherit-legacy-style`, `issue-review`, `living-docs-governance`, `module-governance`, `module-regression`, `plan-orchestrate`, `plankton-code-quality`, `product-capability`, `production-audit`, `ralphinho-rfc-pipeline`, `search-first`, `story-lifecycle`, `project-flow-ops`, `jira-integration`, `opensource-pipeline`, `mcp-server-patterns`, `mcp-dependency-review`, `hookify-rules`, `regex-vs-llm-structured-text`, `content-hash-cache-pattern`, `i18n-sync` | Issues GitHub → brouillon de PR + CI (`githubissuegit.ts`), relecture entre bots, manuel. | NON REPRIS | NON (développeur). `context-and-decisions` est © Matt Pocock (MIT), voir audit mattpocock. |
| Orchestration de code (orch-*, équipes de dev) | 12 | `orch-add-feature`, `orch-build-mvp`, `orch-change-feature`, `orch-fix-defect`, `orch-pipeline`, `orch-refine-code`, `dev-team`, `devfleet`, `dmux-workflows`, `gan-style-harness`, `team-agent-orchestration`, `parallel-execution-optimizer` | Helpers et tâches de fond (`bgtasks.ts`), groupes. | DIFFÉRENT | NON (développeur). IDÉE retenue de `gan-style-harness` : un bot « évaluateur » qui teste le résultat vivant contre une grille (voir santa-method). |
| Infra, déploiement, performance | 16 | `deployment-patterns`, `docker-patterns`, `kubernetes-patterns`, `terraform-patterns`, `uncloud`, `flox-environments`, `platform-factory`, `dashboard-builder`, `benchmark`, `latency-critical-systems`, `data-throughput-accelerator`, `terminal-ops`, `terminal-opener`, `generating-python-installer`, `ios-icon-gen`, `mailtrap-email-integration` | — | NON REPRIS | NON (développeur) |
| Données, ML, IA appliquée | 7 | `mle-workflow`, `ml-adoption-playbook`, `recsys-pipeline-architect`, `bengali-nlp`, `yoruba-localization-testing`, `cost-aware-llm-pipeline`, `prompt-caching-strategy` | — | NON REPRIS | NON (développeur) |
| Réseau d'entreprise et homelab avancé | 9 | `cisco-ios-patterns`, `netmiko-ssh-automation`, `network-bgp-diagnostics`, `network-config-validation`, `network-interface-health`, `homelab-network-readiness`, `homelab-pihole-dns`, `homelab-vlan-segmentation`, `homelab-wireguard-vpn` | — | NON REPRIS | NON (administrateur réseau) |
| Santé (applications médicales) | 5 | `healthcare-cdss-patterns`, `healthcare-emr-patterns`, `healthcare-eval-harness`, `healthcare-phi-compliance`, `hipaa-compliance` | — | NON REPRIS | NON (développeur d'appli médicale ; risque de conseil médical) |
| Crypto, paiements d'agents, marchés prédictifs, calcul loué | 12 | `agent-payment-x402`, `roundhouse-x402`, `ito-baskets`, `ito-compute`, `ito-inference`, `ito-training`, `prediction-market-oracle-research`, `prediction-market-risk-review`, `llm-trading-agent-security`, `evm-token-decimals`, `defi-amm-security`, `nodejs-keccak256` | — | NON REPRIS | NON : paiements hors périmètre, finance spéculative. |
| Rétro-ingénierie | 1 | `leanrea` | — | NON REPRIS | NON (inspection de logiciels livrés par des tiers) |
| Méta ECC / réglage du harnais Claude Code | 19 | `agent-sort`, `configure-ecc`, `deepseek-harness-setup`, `ecc-contribution-review`, `ecc-guide`, `ecc-recipes`, `ecc-tools-cost-audit`, `hermes-imports`, `nanoclaw-repl`, `nasiko-control-plane`, `openclaw-persona-forge`, `repo-scan`, `skill-host-compat`, `workspace-surface-audit`, `automation-audit-ops`, `config-gc`, `config-health`, `token-card`, `prompt-optimizer` | — | NON REPRIS | NON (propre à ECC). `openclaw-persona-forge` est en chinois et vise un autre produit. |

## Tableau 4 — les 72 agents (`agents/*.md`)

Licence : MIT (dépôt). Un « agent » ECC est une fiche de rôle que Claude Code lance comme sous-agent. Côté Sklubot, l'équivalent est un **bot** (rôle, personnalité, consignes) ou un **helper** (`helper_start`, `server/src/agent/tools.ts:1123`).

| Agent ou famille | Nb | Ce qu'il fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|---|
| chief-of-staff | 1 | Trie e-mail, Slack, LINE, Messenger en 4 niveaux (ignorer / info / à traiter / urgent), prépare les réponses. | Modèles `secretariat.md`, `assistant-personnel.md` ; Gmail/Outlook/Slack natifs. | PARTIEL | IDÉE (S) : les 4 niveaux de tri dans le modèle Secrétariat. LINE/Messenger : NON (comptes personnels). |
| marketing-agent | 1 | Stratégie, audience, positionnement, textes, relecture de contenu. | Modèle `reseaux-sociaux.md`, `seo-contenu.md`. | PARTIEL | IDÉE : modèle d'équipe « Marketing » complet (plan + textes + relecture). |
| seo-specialist | 1 | Audit SEO technique, données structurées, mots-clés. | `seo-contenu.md` + connecteurs Ahrefs/Semrush. | PARTIEL | IDÉE |
| agent-evaluator | 1 | Note une production sur 5 axes. | Relecture entre bots (`peerreviewstore.ts`). | PARTIEL | IDÉE (voir agent-self-evaluation) |
| homelab-architect | 1 | Plan réseau domestique par étapes sûres. | — | MANQUANT | NON (faible priorité) |
| loop-operator | 1 | Surveille des boucles autonomes et intervient quand elles calent. | Rappels de travail bloqué (`agent/stuck.ts`), coordinateur d'échecs (`agent/failures.ts`). | FAIT (autrement) | NON |
| conversation-analyzer | 1 | Lit les transcriptions pour trouver des comportements à empêcher par une règle. | — | MANQUANT | IDÉE : routine qui propose des règles à partir des corrections de l'utilisateur. |
| gan-planner / gan-generator / gan-evaluator | 3 | Planifie, construit, puis **teste l'appli en marche** avec Playwright contre une grille et renvoie des corrections. | Helpers ; pas de bot « évaluateur » qui teste un résultat vivant. | PARTIEL | IDÉE (M) : un helper évaluateur pour les artefacts (ouvre, clique, note). |
| opensource-forker / -sanitizer / -packager | 3 | Copier un projet privé, retirer secrets et données perso (20+ motifs), préparer la publication. | Détection de secrets collés (`pastedsecrets.ts`), anonymisation (`agent/anonymise.ts`). | NON REPRIS | NON (développeur) ; la liste de motifs de secrets pourrait enrichir `pastedsecrets.ts` (IDÉE S). |
| Relecteurs par langage | 22 | `cpp-reviewer`, `csharp-reviewer`, `django-reviewer`, `fastapi-reviewer`, `flutter-reviewer`, `fsharp-reviewer`, `gdscript-reviewer`, `go-reviewer`, `java-reviewer`, `kotlin-reviewer`, `php-reviewer`, `python-reviewer`, `react-reviewer`, `ruby-reviewer`, `rust-reviewer`, `swift-reviewer`, `typescript-reviewer`, `vue-reviewer`, `bengali-reviewer`, `healthcare-reviewer`, `mle-reviewer`, `rag-pipeline-reviewer` | — | NON REPRIS | NON (développeur) |
| Résolveurs d'erreurs de construction | 12 | `build-error-resolver`, `cpp-`, `dart-`, `django-`, `go-`, `java-`, `kotlin-`, `pytorch-`, `react-`, `rust-`, `swift-build-resolver`, `harmonyos-app-resolver` | — | NON REPRIS | NON |
| Code général | 15 | `architect`, `code-architect`, `code-explorer`, `code-reviewer`, `code-simplifier`, `comment-analyzer`, `commit-reviewer`, `database-reviewer`, `doc-updater`, `docs-lookup`, `e2e-runner`, `performance-optimizer`, `planner`, `pr-test-analyzer`, `refactor-cleaner` | Relecture entre bots, issues GitHub. | NON REPRIS | NON |
| Qualité / sécurité du code | 6 | `security-reviewer`, `silent-failure-hunter`, `tdd-guide`, `type-design-analyzer`, `spec-miner`, `a11y-architect` | — | NON REPRIS | NON ; `silent-failure-hunter` (erreurs avalées) : IDÉE pour l'auto-audit de Sklubot. |
| Réseau | 3 | `network-architect`, `network-config-reviewer`, `network-troubleshooter` | — | NON REPRIS | NON |
| Harnais | 1 | `harness-optimizer` | — | NON REPRIS | NON |

## Tableau 5 — les 99 commandes (`commands/*.md`), regroupées

| Groupe | Commandes | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| Lancer une compétence | une commande par compétence ou famille (`/plan`, `/code-review`, `/santa-loop`, `/marketing-campaign`, `/plan-canvas`, `/ui-canvas`, `/token-card`…) | `/skill <nom>` (`web/src/components/Composer.tsx:49`). | FAIT | NON |
| Séances | `/save-session`, `/resume-session`, `/sessions`, `/checkpoint`, `/aside` | Conversations gardées, tâches de fond, recherche dans les conversations. | FAIT (autrement) | NON ; `/aside` (question à côté sans interrompre) : IDÉE S (même idée que `/btw` de Craft Anything). |
| Apprentissage | `/learn`, `/learn-eval`, `/evolve`, `/instinct-status`, `/instinct-import`, `/instinct-export`, `/promote`, `/prune`, `/skill-create`, `/skill-health` | `skill_propose`, `skill_save`, export d'équipe (`team_export`). | PARTIEL | IDÉE : « santé des compétences » (voir skill-stocktake). |
| Coûts et modèles | `/cost-report`, `/model-route` | Journal des dépenses ; choix du cerveau par bot. | FAIT | NON |
| Boucles | `/loop-start`, `/loop-status` | Routines, tâches de fond. | FAIT | NON |
| Épopées / gestion de projet | `/epic-claim`, `/epic-decompose`, `/epic-publish`, `/epic-review`, `/epic-sync`, `/epic-unblock`, `/epic-validate`, `/jira`, `/projects`, `/project-init` | Tâches, objectifs. | NON REPRIS | NON |
| Code (par langage, PR, PRP, orch, multi-*) | `/build-fix`, `/cpp-*`, `/go-*`, `/kotlin-*`, `/rust-*`, `/react-*`, `/flutter-*`, `/python-review`, `/vue-review`, `/fastapi-review`, `/gradle-build`, `/feature-dev`, `/gan-build`, `/gan-design`, `/multi-backend`, `/multi-execute`, `/multi-frontend`, `/multi-plan`, `/multi-workflow`, `/orch-*`, `/pr`, `/review-pr`, `/prp-*`, `/plan-prd`, `/quality-gate`, `/refactor-clean`, `/test-coverage`, `/update-codemaps`, `/update-docs`, `/issue-review`, `/astra-review` | — | NON REPRIS | NON |
| Réglage ECC | `/auto-update`, `/ecc-guide`, `/harness-audit`, `/hookify*`, `/pm2`, `/setup-pm`, `/security-scan`, `/skill-host-compat` | — | NON REPRIS | NON |

## Tableau 6 — les 28 crochets (`hooks/hooks.metadata.json`), un par ligne

Ce sont des programmes qui tournent autour de chaque action de Claude Code. Sklubot n'ajoute pas de crochets au moteur : la ligne dit si Sklubot a l'équivalent **côté serveur**.

| Crochet | Ce qu'il fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| pre:bash:dispatcher | Contrôles avant chaque commande shell (qualité, tmux, push, GateGuard). | Blocage des commandes irréversibles (`agent/irreversible.ts:47`) et approbations. | FAIT (autrement) | NON |
| pre:powershell:gateguard-fact-force | Même chose pour PowerShell. | — (Linux) | NON REPRIS | NON |
| pre:write:doc-file-warning | Avertit si l'agent crée un fichier de doc non standard. | — | NON REPRIS | NON |
| pre:edit-write:suggest-compact | Propose de compacter le contexte. | Contexte géré par le serveur. | DIFFÉRENT | NON |
| pre:observe:continuous-learning | Enregistre chaque outil utilisé pour l'apprentissage continu. | — | NON REPRIS | NON (observation permanente) |
| pre:governance-capture | Capture secrets, violations, demandes d'accord (optionnel). | Journal/audit (`journal.ts`, `audit`). | FAIT | NON |
| pre:config-protection | **Bloque la modification des fichiers de configuration du linter/formateur** : l'agent doit corriger le code au lieu d'affaiblir la règle. | — | MANQUANT | IDÉE (S) : un bot ne doit pas « réussir » en changeant le critère (même idée que `constraint-driven` chez addyosmani). |
| pre:mcp-health-check | **Vérifie la santé d'un serveur MCP avant de l'appeler et bloque les appels vers un serveur malade.** | Outils locaux MCP (`server/src/agent/mcp.ts`), état non vérifié avant appel. | PARTIEL / non vérifié | IDÉE (S) : marquer un connecteur « malade » après N échecs et le dire au bot et à l'utilisateur au lieu de réessayer. |
| pre:edit-write:gateguard-fact-force | Refuse la 1re modification de chaque fichier tant que l'agent n'a pas donné des faits. | — | MANQUANT | IDÉE (bots qui codent) |
| pre:hookify-runtime / prompt:hookify-runtime / stop:hookify-runtime | Règles locales écrites par l'utilisateur (regex sur commande, fichier, message, fin). | Règles (`agent/ruletools.ts`, `rule_propose`). | FAIT (autrement) | NON |
| user-prompt:context-gate | À ≥ 90 % du contexte : point d'arrêt propre, sauvegarde, redémarrage (optionnel). | `agent/context.ts`. | DIFFÉRENT | NON |
| pre:compact | Sauve l'état avant compaction. | — | DIFFÉRENT | NON |
| session:start | Recharge le contexte précédent. | Mémoire + historique. | FAIT | NON |
| session-start:plan-canvas-sessions | Rappelle les revues de plan en cours au démarrage. | Rappels de travail en attente (`agent/stuck.ts`). | FAIT (autrement) | NON |
| post:dispatcher:sync / post:dispatcher:async | Crochets après outil (synchrones / en fond). | — | NON REPRIS | NON |
| post:mcp-health-check | **Après un échec MCP : marque le serveur malade et tente de le reconnecter.** | Non vérifié. | PARTIEL / non vérifié | IDÉE (voir ci-dessus) |
| post:skill:track | Enregistre les échecs d'une compétence (« santé des compétences »). | — | MANQUANT | IDÉE (S) : compter, par compétence, les tâches qui ont échoué en la suivant. |
| stop:plan-canvas-pending | Livre les retours non lus avant que l'agent s'arrête. | Messages pendant un tour pliés au tour (`loop.ts:816` `leftover`). | FAIT | NON |
| stop:format-typecheck | Formate et vérifie les types une fois à la fin. | — | NON REPRIS | NON |
| stop:check-console-log | Cherche des `console.log` oubliés. | — | NON REPRIS | NON |
| stop:session-end | Sauve l'état après chaque réponse. | Historique en base. | FAIT | NON |
| stop:evaluate-session | Cherche des leçons à extraire. | `skill_propose`. | FAIT (sur proposition) | NON |
| stop:cost-tracker | Compte jetons et coût par séance. | `usage.ts`. | FAIT | NON |
| stop:desktop-notify | Notification bureau avec résumé à la fin. | Push (`push.ts`). | FAIT | NON |
| session:end:marker | Marqueur de fin. | — | NON REPRIS | NON |

## Tableau 7 — autres parties du dépôt

| Partie | Ce que c'est | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| `rules/` (common + 21 langages) | Règles de style, tests, sécurité, git, par langage. | Règles du compte (`ruletools.ts`). | NON REPRIS | NON (développeur) |
| `contexts/` (dev, research, review) | Trois « modes » de consignes. | Rôle et consignes du bot. | DIFFÉRENT | NON |
| `SOUL.md` | Principes : agent d'abord, tests d'abord, sécurité d'abord. | Prompt (`agent/prompt.ts`) et « Méthode de travail ». | FAIT | NON |
| `ecc2/` (Rust, alpha) | Tableau de bord terminal, séances en SQLite, démon de fond, **score de risque**, observabilité, notifications. | Centre de commande (`CommandView.tsx`), sentinelle. | FAIT (autrement) | IDÉE : relire le score de risque. |
| `ecc_dashboard.py` | Interface Tkinter pour gérer les composants ECC. | Réglages Sklubot. | DIFFÉRENT | NON |
| `mcp-configs/mcp-servers.json` | 37 serveurs MCP proposés (GitHub, Jira, Firecrawl, Supabase, Vercel, Cloudflare, Context7, Playwright, fal-ai, browserbase, mémoires diverses, Confluence…). | Catalogue de connecteurs (`server/src/catalog.ts` : Context7, DeepWiki, Cloudflare Docs, GitHub, Notion, HubSpot…). | PARTIEL | IDÉE : vérifier Confluence, Jira, Supabase pour les équipes. |
| Installateurs (`install.sh`, `install.ps1`, profils `manifests/`, `configure-ecc`) | Installation guidée par outil et par profil (minimal, standard…). | Bibliothèque intégrée + import. | DIFFÉRENT | NON |
| Docs multilingues (`docs/ja-JP`, `zh-CN`, `tr`, `es`, `ko-KR`, `zh-TW`) | Traductions des compétences. | FR/EN. | DIFFÉRENT | NON |
| `the-security-guide.md`, `SECURITY.md`, politique des connecteurs MCP, réponse aux incidents de chaîne d'approvisionnement | Guide de sécurité des agents ; « n'installer que depuis les sources officielles ». | Contrôle des compétences, protection réseau (`egress.ts`). | FAIT (autrement) | IDÉE : relire la politique des connecteurs MCP. |
| `workflows/orch-review.workflow.js`, `scripts/`, `tests/`, `schemas/` | Outillage du dépôt. | — | NON REPRIS | NON |
| `integrations/`, `plugins/`, `pi/`, `.kiro`, `.agents` | Portages vers d'autres outils. | — | NON REPRIS | NON |

## Écarts de comportement

1. **Décider à plusieurs.** ECC (`council`) : quatre voix avec des rôles fixes (sceptique, pragmatique, critique) avant de trancher ; `santa-method` : deux relecteurs indépendants, tous deux doivent valider. Sklubot : `@everyone` fait répondre chaque bot d'un groupe (`agent/team.ts:120-163`), mais sans rôle, sans indépendance (chacun voit les autres) et sans synthèse. Pour un patron qui hésite (fournisseur, prix, recrutement), le « conseil » est plus clair. Correctif M : mode « Conseil » dans un groupe ou via helpers : 3 avis à rôles fixes, puis une décision avec risques.
2. **Ce qui part chez un client.** ECC (`operator-approval-loop`) fait approuver le **texte exact** (empreinte) et tient un registre de livraison. Sklubot : carte d'approbation sur une action ; non vérifié que le texte envoyé est identique octet pour octet au texte montré. Correctif S : garder l'empreinte du contenu approuvé et la comparer à l'envoi ; et (idée `email-ops`) vérifier après envoi que le mail est bien dans « Envoyés ».
3. **Connecteurs malades.** ECC vérifie un serveur MCP avant de l'appeler, le marque malade après échec et tente une reconnexion. Sklubot : non vérifié ; un bot peut réessayer un connecteur cassé. Correctif S : état « en panne » par connecteur, visible dans Réglages → Applis et donné au bot.
4. **Tricher avec le critère.** ECC bloque la modification des fichiers de règles (linter) : l'agent doit corriger le travail, pas le critère. Sklubot n'a pas cette protection : un bot peut abaisser son propre objectif (« 50 prospects » → « 10 ») ou modifier un test. Correctif S : règle dans « Méthode de travail » + signalement quand un bot modifie un critère qu'on lui a donné.
5. **Apprendre sur la durée.** ECC donne un score de confiance à chaque « instinct » appris et le fait évoluer. Sklubot propose une compétence après une tâche (relue par l'utilisateur), puis plus rien : une compétence qui échoue souvent n'est jamais signalée. Correctif M : santé des compétences (succès/échecs, dernière utilisation, doublons).
6. **Compétences « métiers ».** Les 7 compétences Apache-2.0 (stocks, logistique, retours, douane, énergie, production, qualité) sont du vrai savoir-faire métier, utile à des PME — mais trop longues pour l'import Sklubot (23–30 ko). Correctif M : les condenser en français dans `server/skills-library` avec `LICENSE.txt` Apache et `NOTICE` des modifications, en commençant par stocks + logistique + retours pour le modèle « Boutique en ligne ».
7. **Agir sans demander.** `visa-doc-translate` dit d'exécuter « sans demander confirmation » sur des papiers d'identité. Vérifié : le contrôle de sécurité de Sklubot la signale à l'import (règle `skip-approval`, niveau « À lire », motif « without asking… » `server/src/skillscan.ts:73`). Bien : rien à faire, sinon garder ce cas comme exemple de test.

## À faire, par ordre de valeur

1. Mode « Conseil » : 3 avis à rôles fixes (sceptique, pragmatique, critique) puis une décision, adapté de `council` (MIT) — M.
2. Double relecture indépendante avant tout envoi public ou de masse, adaptée de `santa-method` — S.
3. Empreinte du texte approuvé comparée au texte envoyé + vérification « bien dans Envoyés » (idées `operator-approval-loop`, `email-ops`) — S.
4. Compétences métiers Apache-2.0 condensées : stocks, logistique, retours (pour « Boutique en ligne »), puis douane — M — **douane faite le 22/11/2026** (`douane`).
5. Compétence « Entretien de marque » (adaptée de `brand-discovery`) + « Profil de voix » (`brand-voice`) — M.
6. Santé des compétences : échecs par compétence, jamais utilisées, doublons (idées `post:skill:track`, `skill-stocktake`, `continuous-learning-v2`) — M.
7. État « en panne » par connecteur MCP, sans réessais aveugles (idée `mcp-health-check`) — S.
8. Règle « ne pas changer le critère pour réussir » + signalement (idée `config-protection`) — S.
9. Compétence « Mon idée tient-elle ? » (adaptée de `product-lens`) et « Étude de concurrence » (`competitive-*` + `benchmark-methodology`, MIT) — M.
10. Grille d'auto-évaluation en fin de tâche (adaptée d'`agent-self-evaluation`) — S.
11. Règles anti-« style IA » pour les bots rédacteurs (`article-writing`, `content-engine`) — S.
12. Annotation d'un élément d'artefact (« ceci ») et retouche à la souris (idées `plan-canvas`, `ui-canvas`) — M/L.
13. Helper « évaluateur » qui teste un artefact vivant contre une grille (idée `gan-evaluator`) — M.
14. Règles pour un bot présent dans un salon client (adaptées de `counterparty-channel-discipline`) — S.
15. Liste de contrôle par plateforme pour publier une vidéo courte (`short-video-distribution`) — S.
16. Source « articles scientifiques » (OpenAlex, PubMed) et « marques déposées » (USPTO) pour la recherche approfondie — M.
17. Les 4 niveaux de tri du `chief-of-staff` dans le modèle Secrétariat — S — **fait le 22/11/2026** (`server/templates/secretariat.md`).
18. Ajouter le texte de `visa-doc-translate` comme cas de test de `server/test/skill-scan.test.ts` (déjà signalé par `skillscan.ts:73`) — S.
19. Question « à côté » (`/aside`) qui n'interrompt pas un travail en cours — S.
20. Enrichir `pastedsecrets.ts` avec la liste de motifs de l'agent `opensource-sanitizer` (après lecture de la licence MIT, texte de motifs) — S.

## Non vérifié

- Le contenu complet de chacune des 328 compétences : les lignes s'appuient sur leur description et, pour ~40 d'entre elles (non-développeurs et mécanismes), sur le début du texte. Les familles de développeur sont classées d'après leur description.
- La licence d'origine de `react-performance` (adaptée de vercel-labs) et de `plan-canvas` (« inspiré de lavish-axi »).
- Côté Sklubot : identité exacte texte approuvé / texte envoyé ; état de santé des serveurs MCP.
- Aucun test Sklubot lancé pour ce dépôt.
