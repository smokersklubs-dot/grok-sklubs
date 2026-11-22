# Compétences des bots : la bibliothèque, l'import depuis GitHub et les pages « comme des artefacts »

Ce guide explique comment apprendre de nouveaux savoir-faire à tes bots, et ce qu'ils savent maintenant faire avec les pages web.

## 1. La bibliothèque de compétences

**Où :** Réglages → **Compétences** (ou le bouton **Bibliothèque** dans l'onglet Compétences d'un bot).

Chaque carte montre le nom de la compétence, à quoi elle sert, d'où elle vient et sa licence. **Lire le texte** affiche exactement ce que le bot lira.

- Choisis **Tous mes bots** ou un bot précis, puis **Ajouter**.
- Le bot l'a tout de suite. Ajouter deux fois ne crée pas de doublon.
- Pour la changer ou la retirer : onglet Compétences du bot.

| Compétence | Origine | Licence | Langue |
|---|---|---|---|
| Méthode de travail | écrite pour Sklubot | MIT (celle du projet) | français + anglais |
| Pages soignées (comme des artefacts) | écrite pour Sklubot | MIT | français + anglais |
| Design de marque | écrite pour Sklubot | MIT | français + anglais |
| Réponses courtes en conversation | adaptée de Hermes Bot Kit | MIT | français + anglais |
| Suivi du travail dans le chat | adaptée de Hermes Bot Kit | MIT | français + anglais |
| E-mails à relire avant envoi | adaptée de Hermes Bot Kit | MIT | français + anglais |
| Design soigné (pages web) | adaptée de `anthropics/skills` (frontend-design) | Apache-2.0 | anglais |
| Affiches et visuels (PNG, PDF) | adaptée de `anthropics/skills` (canvas-design) | Apache-2.0 | anglais |
| Thèmes de couleurs | adaptée de `anthropics/skills` (theme-factory) | Apache-2.0 | anglais |
| Présentations (diapositives) | adaptée d'OpenDesign (cadre de présentation, simple-deck) | Apache-2.0 | français + anglais |
| Règles de métier du design | adaptée d'OpenDesign (`craft/`) | Apache-2.0 (+ avis MIT de refero_skill) | français + anglais |
| Styles de base | adaptée d'OpenDesign (styles « Neutral Modern » et « Warm Editorial ») | Apache-2.0 | français + anglais |
| Modèles de pages | adaptée d'OpenDesign (13 modèles de `design-templates/`) | Apache-2.0 | français + anglais |
| OpenDesign (outil complet) | guide écrit pour Sklubot sur OpenDesign | Apache-2.0 | français + anglais |

Les trois compétences adaptées d'Anthropic viennent du dépôt public github.com/anthropics/skills, dont le dossier de chaque compétence contient la licence Apache 2.0. Elles sont rangées dans `server/skills-library/<nom>/` avec leur `LICENSE.txt` d'origine (inchangé), un fichier `NOTICE` (« © Anthropic, PBC — Apache License 2.0, from github.com/anthropics/skills ») et la liste des modifications faites pour Sklubot, comme la licence l'exige. Aucun script, police, image ou PDF de ces dossiers n'est inclus : seulement le texte.

Les cinq compétences marquées « OpenDesign » viennent du dépôt public github.com/nexu-io/open-design (licence Apache 2.0, « Open Design contributors »), figé au commit `0725880`. Même règle : `LICENSE.txt` du dépôt inchangé, un `NOTICE` qui dit quels fichiers ont servi et ce qui a été modifié, et la première ligne du texte qui le rappelle. « Règles de métier du design » reprend des parties qu'OpenDesign a lui-même adaptées de refero_skill (MIT) : l'avis MIT est ajouté à la fin de son `LICENSE.txt`. « Présentations » contient un cadre HTML prêt : diapositives numérotées, compteur, clavier, glissement au doigt, adresse `#6` pour ouvrir la diapositive 6, une diapositive par page à l'impression en PDF.

Pas inclus d'OpenDesign, et pourquoi :
- Les quelque 140 « systèmes de design » qui imitent la marque d'une vraie entreprise (Apple, Stripe, Linear, Notion, Airbnb…) : utiliser l'identité d'une autre marque dans les pages de tes clients est risqué. Seuls deux styles génériques sont repris.
- Les styles générés « Design System Inspired by … » (provenance non documentée), les compétences qui ne sont que des renvois vers d'autres projets (dont certains ne sont pas sous licence libre), les dossiers sous licence MIT d'autres auteurs, et tous les fichiers non textuels (images, polices, vidéos, exemples).
- L'application elle-même : elle demande Node 24, pnpm et un serveur qui tourne en continu, et ses versions officielles envoient des statistiques d'usage par défaut. Elle n'est donc pas installée sur l'ordinateur des bots ; la compétence « OpenDesign (outil complet) » explique comment un bot peut en récupérer à la demande une copie figée des textes (commit vérifié), ou l'application depuis les sources si tu le demandes.

Pas incluses d'Anthropic, et pourquoi :
- *brand-guidelines* : c'est la charte graphique d'Anthropic elle-même ; l'appliquer aux pages de tes clients serait utiliser la marque d'un autre. Remplacée par « Design de marque », qui applique **ta** marque.
- *web-artifacts-builder* : repose sur des scripts propres à claude.ai ; « Pages soignées » couvre le même besoin avec les outils de Sklubot.
- *algorithmic-art* : dépend d'un gabarit de 20 ko (avec la marque Anthropic) que la compétence ne peut pas emporter.
- Les compétences de documents du même dépôt (*docx, pdf, pptx, xlsx*) ne faisaient pas partie de la sélection.

Les trois adaptations de [Hermes Bot Kit](https://github.com/thomasbek3/hermes-bot-kit/tree/efba9156f49bf69ae763f67135218cf890275083) réutilisent les instructions du kit avec les outils de Sklubot. Chaque fiche inclut la licence MIT et le crédit de Thomas Bekkers. Les brouillons sont préparés dans le compte Gmail ou Outlook choisi. La connexion Slack se vérifie dans **Réglages → Applis**, sur la ligne du compte Slack connecté.

### Compétences adaptées de projets libres (22/11/2026)

La galerie range maintenant les compétences **par thème** (méthode et questions, rédaction et marque, design et pages, animation et vidéo, référencement, commerce et études, outils) avec un filtre en haut ; le badge « Adaptée d'un projet libre » marque ces 41 compétences, toutes en français et en anglais.

| Compétence | Thème | Adaptée de | Licence |
|---|---|---|---|
| Clarifier avant d'agir | Méthode et questions | agent-skills (interview-me), mattpocock/skills (grilling), Spec Kit (clarify) | MIT |
| Mon idée tient-elle ? | Méthode et questions | agent-skills (idea-refine), ECC (product-lens), Spec Kit (assess) | MIT |
| Conseil à trois voix | Méthode et questions | ECC (council) | MIT |
| Vérifier avant de livrer | Méthode et questions | ECC (santa-method, agent-self-evaluation, email-ops), Spec Kit (checklist), agent-skills (shipping-and-launch) | MIT |
| Cahier des charges | Méthode et questions | Spec Kit (specify, analyze, converge) | MIT |
| Professeur particulier | Méthode et questions | mattpocock/skills (teach) | MIT |
| Questionnaire à envoyer | Méthode et questions | mattpocock/skills (to-questionnaire) | MIT |
| Note de passation et bilan de la semaine | Méthode et questions | claude-mem (handoff, weekly-digests, owner-goals) | Apache-2.0 |
| Salons partagés avec des clients | Méthode et questions | ECC (counterparty-channel-discipline) + tri en 4 niveaux écrit pour Sklubot | MIT |
| Leçons de mon travail | Méthode et questions | Noodle (reflect, meditate) | MIT |
| Explique simplement | Rédaction et marque | claude-mem (what-the) | Apache-2.0 |
| Écrire comme un humain | Rédaction et marque | Noodle (unslop), ECC (article-writing) | MIT |
| Écrire un article avec toi | Rédaction et marque | mattpocock/skills (writing-fragments, -beats, -shape) | MIT |
| Contenus par réseau | Rédaction et marque | ECC (content-engine, short-video-distribution) | MIT |
| Entretien de marque | Rédaction et marque | ECC (brand-discovery, brand-voice) | MIT |
| Fiche de charte (design) | Design et pages | stitch-skills (design-md, extract-design-md) | Apache-2.0 |
| Préciser une demande de page | Design et pages | stitch-skills (enhance-prompt) | Apache-2.0 |
| Site en plusieurs passes | Design et pages | stitch-skills (site-md, stitch-loop) | Apache-2.0 |
| Règles de mise en page contre l'air générique | Design et pages | stitch-skills (taste-design), stick-scene | Apache-2.0 + MIT |
| Page d'un commerce par métier | Design et pages | Hallmark | MIT |
| Guides des composants web | Design et pages | modern-web-guidance (guides) | CC-BY-4.0 + Apache-2.0 |
| Accessibilité mesurée | Design et pages | chrome-devtools-mcp (a11y-debugging), agent-skills (accessibility-engineering) | Apache-2.0 + MIT |
| Testeur de site | Design et pages | agent-browser (dogfood) | Apache-2.0 |
| Illustration animée de page | Animation et vidéo | stick-scene | MIT |
| Figure explicative interactive | Animation et vidéo | anatomy | MIT |
| Visite guidée vidéo d'un site | Animation et vidéo | stitch-skills (remotion) | Apache-2.0 |
| Référencement : méthode et audit | Référencement (SEO) | claude-seo (seo, seo-audit, seo-page, seo-technical) | MIT |
| SEO local | Référencement (SEO) | claude-seo (seo-local) | MIT |
| Contenu SEO | Référencement (SEO) | claude-seo (seo-content, -content-brief, -cluster, -plan), FLOW SEO | MIT + CC-BY-4.0 |
| Données structurées et sitemap | Référencement (SEO) | claude-seo (seo-schema, -sitemap, -hreflang, -images) | MIT |
| Visibilité dans les réponses des IA | Référencement (SEO) | claude-seo (seo-geo, seo-agentic) | MIT |
| Surveillance SEO | Référencement (SEO) | claude-seo (seo-drift) | MIT |
| SEO des boutiques et pages comparatives | Référencement (SEO) | claude-seo (seo-ecommerce, seo-sxo, seo-competitor-pages) | MIT |
| Étude de marché et de concurrence | Commerce et études | ECC (market-research, competitive-*, benchmark-methodology, literature-review) | MIT |
| Stocks et réassort | Commerce et études | ECC (inventory-demand-planning) | Apache-2.0 |
| Colis et retours | Commerce et études | ECC (logistics-exception-management, returns-reverse-logistics) | Apache-2.0 |
| Diagrammes | Outils | CLI-Anything (mermaid, drawio) | Apache-2.0 |
| Sous-titres | Outils | CLI-Anything (videocaptioner) | Apache-2.0 |
| Notes Obsidian | Outils | CLI-Anything (obsidian) | Apache-2.0 |
| Code sobre | Outils | DietrichGebert/ponytail | MIT |
| Relecture de code | Outils | DietrichGebert/ponytail (review), alibaba/open-code-review (delegate) | MIT + Apache-2.0 |

Règles suivies pour chacune (vérifiées par les tests de `server/test/skills-library.test.ts`) : seulement des textes sous **MIT, Apache-2.0 ou CC BY 4.0** ; `LICENSE.txt` contient le texte de licence d'origine inchangé (et, pour CC BY, l'attribution demandée) ; `NOTICE` nomme le titulaire des droits, la source figée à un commit (40 caractères) et la liste « Modified for Sklubot (2026-11-22) : … » ; la première ligne de chaque texte dit d'où il vient et qu'il a été modifié. Aucun nom de produit d'origine dans les titres, aucun service payant ni télémétrie, aucun chemin d'extension, rien qui lise les cookies d'un navigateur ou un compte personnel. Chaque texte passe le contrôle de sécurité sans « danger ». Deux compétences (« Illustration animée de page », « Figure explicative interactive ») récupèrent leur bibliothèque de dessin **à la demande**, sur l'ordinateur du bot, à un commit vérifié. « Design de marque » lit maintenant d'abord `~/team/charte.md`, la charte écrite avec « Entretien de marque » et « Fiche de charte (design) ».

Non repris de la liste « à adapter » des audits, et pourquoi : la version actuelle d'*app-store-compliance* (licence non libre ; seule une version d'avant le 24/08/2026 serait réutilisable, à vérifier à part) ; *Astryx* (verdict « idée » : modèles en code, pas un texte) ; les règles d'*agent-browser* (core) et d'*agent-desktop* (elles vont dans la description des outils écran, pas dans la bibliothèque) ; *debug-optimize-lcp* et *chrome-devtools-cli* (dépendent d'outils absents de l'ordinateur des bots) ; *investor-materials* et *marketing-campaign* d'ECC (hors du lot 3, à faire plus tard).

## 2. Importer des compétences depuis GitHub

**Où :** Réglages → Compétences, en bas : **Importer depuis GitHub**.

1. Colle l'adresse d'un dépôt **public** de github.com, ou d'un de ses dossiers (par exemple `https://github.com/proprietaire/depot/tree/main/skills`).
2. **Chercher** : Sklubot liste les fichiers `SKILL.md` trouvés, avec leur licence (celle du dossier de la compétence, sinon celle du dépôt, sinon celle annoncée dans le README).
3. Sont cochées d'avance seulement les compétences sous licence libre (Apache-2.0, MIT, BSD, ISC, CC0, Unlicense, CC BY) sans problème signalé. Pour les autres (« aucune licence », « restrictive », GPL…), c'est toi qui décides : sans licence, la réutilisation n'est pas permise par défaut.
4. Signalements : *texte qui semble contenir une clé*, *trop longue* (le nombre de caractères est affiché ; plus de 20 000 : impossible telle quelle), *fichiers cités non importés* (la liste des fichiers que le texte mentionne — scripts, références, images — et que le bot n'aura pas), *annexes jointes* (voir ci-dessous), *autres fichiers non importés*, *nom déjà utilisé*.
   - **Annexes** : quand le texte d'une compétence renvoie à de petits fichiers texte de son propre dossier (`[format](./MISSION-FORMAT.md)`, `references/eeat.md`), ils sont ajoutés à la fin, chacun sous un titre « Annex: … », tant que le tout reste sous 20 000 caractères ; ils passent le même contrôle de sécurité. Les fichiers cités mais non importés sont aussi rappelés à la fin du texte importé, pour que le bot sache qu'il ne peut pas les ouvrir.
5. **Importer en brouillon** : les compétences arrivent **en brouillon**, avec leur source et leur licence à la fin. Le bot ne les utilise pas tant que tu n'as pas cliqué **Activer** dans son onglet Compétences, après les avoir lues.

Sécurité : seul le texte des `SKILL.md` est lu ; rien n'est jamais exécuté sur le serveur. Le téléchargement passe par la protection réseau de Sklubot (adresses publiques seulement, GitHub uniquement, 15 Mo au plus), l'archive est lue sans chemins piégés (`..`, liens, chemins absolus), 10 recherches par heure au plus.

**Qui peut importer :** sur ton propre serveur, tout le monde. En mode hébergé, le propriétaire et les opérateurs, et les clients d'une offre payante ; **pas l'offre gratuite**. La bibliothèque intégrée, elle, est ouverte à toutes les offres.

## 3. Les pages des bots, « comme des artefacts »

Les bots publient des pages web avec `page_publish` et les corrigent avec `page_edit`. Ce qui est nouveau :

- **Pages interactives** : calculatrices, tableaux de bord avec graphiques, listes, quiz, mini-jeux, diaporamas. Le JavaScript tourne dans un **bac à sable** : sans cookie, sans stockage, sans accès à ton compte ni à Sklubot.
- **Plusieurs fichiers** : une page HTML plus jusqu'à 20 fichiers texte à côté (`.css`, `.js`, `.json`, `.csv`, `.svg`…), 5 Mo en tout (offre gratuite : 5 fichiers, 1 Mo).
- **Versions** : chaque publication et chaque modification garde l'ancienne version (20 au plus, 5 sur l'offre gratuite). Réglages → **Pages** → **Versions** : voir une version, **Rétablir**.
- **Aperçu dans la discussion** : quand un bot publie une page, une carte l'affiche directement dans le fil, avec **Ouvrir**, **Copier le lien** et **Versions**.
- **Partage** : « Moi seulement » (connecté) ou « Toute personne avec le lien ». Un bot qui publie pour tout le monde doit d'abord avoir ton accord (carte d'approbation). Dans Réglages → Pages : repasser en privé, **Nouveau lien** (l'ancien ne marche plus aussitôt), **Arrêter le partage**.

Règles exactes du bac à sable (pour les curieux) : scripts et styles de la page elle-même, de ses fichiers, ou de `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com` ; polices aussi depuis Google Fonts ; images depuis n'importe quelle adresse https ; appels réseau seulement vers les fichiers de la page ; pas de formulaires envoyés, pas de fenêtres `alert`, pas de cadres d'autres sites. Une page privée qui a des fichiers s'ouvre, pour toi seul, à une adresse signée valable 12 heures (rouvre-la depuis Sklubot pour en avoir une nouvelle). Le détail est en tête de `server/src/pagefiles.ts`.

Pas encore fait (prochaine étape) : un petit stockage de données propre à chaque page (sondages, listes à cocher qui se souviennent), et une adresse séparée pour les pages (`PAGES_ORIGIN`). Aujourd'hui, une page ne garde rien entre deux visites.

## 4. Le contrôle de sécurité des compétences

Une compétence est un texte que le bot suit. Un texte venu d'ailleurs peut donc essayer de retourner un bot contre toi. Sklubot relit chaque compétence avec des **règles fixes** (pas d'intelligence artificielle : même texte, même résultat) et te montre ce qu'il trouve : **quoi**, **à quelle ligne**, avec un court extrait (les clés sont masquées) et **quoi faire**.

Ce qu'il cherche :

- les ordres d'ignorer tes règles ou d'agir sans ton accord, de te cacher quelque chose, d'effacer des traces ;
- l'envoi de tes données (fichiers, mémoire, coffre, clés, cookies) vers une adresse ;
- une clé ou un mot de passe écrit dans le texte ;
- un programme téléchargé et lancé sans être lu (`curl … | sh`), un bloc codé puis exécuté ;
- les commandes qui détruisent (effacer un disque, `rm -rf` sur un grand dossier), l'arrêt d'une protection (antivirus, pare-feu) ;
- un paiement ou un achat « sans demander » ;
- les caractères invisibles, le texte caché dans un commentaire, les liens raccourcis ou vers une adresse en chiffres ;
- une demande au bot de changer ses propres règles, compétences ou droits.

Trois niveaux : **Risque** (rouge), **À lire** (orange), **Info** (bleu : la ligne dit justement de *ne pas* le faire, par exemple « ne lance jamais curl | sh »).

Ce qui se passe :

- **Avant d'ajouter** : chaque chemin d'import montre le résultat avant que tu valides — bibliothèque, GitHub, fichier d'équipe, modèle d'équipe, zip de projet, fichier à une adresse (bouton « Vérifier le fichier »), compétence proposée par un bot.
- **Un « Risque » = brouillon** : la compétence est enregistrée en brouillon, jamais active en silence. Le bouton « Activer » habituel ne suffit pas : il faut cliquer « J'ai lu : accepter et activer », puis confirmer. C'est noté dans le journal.
- **Un bot ne peut pas l'activer lui-même.** S'il enregistre ou réécrit une compétence avec un risque, elle (re)devient un brouillon qu'il ne peut pas lire. Si le texte change après ton accord, il faut l'accepter à nouveau.
- **Tes compétences déjà là** : Réglages → Compétences → **Vérifier mes compétences**. La liste montre, bot par bot, ce qui a été trouvé. Une ancienne compétence active n'est pas coupée d'office : à toi de la mettre en brouillon, de la corriger ou de l'accepter.

Ses limites, pour ne pas lui faire dire plus qu'il ne sait :

- Il reconnaît des tournures en français et en anglais, pas des intentions. Un ordre reformulé, réparti sur plusieurs lignes ou écrit dans une autre langue peut passer.
- Il ne voit une négation que sur la même ligne (« ne … jamais », « never ») ou sous un titre qui ne dit que cela (« Jamais », « À ne pas faire »). Un exemple cité (« un pirate écrirait… ») est signalé comme un vrai ordre. Sous un tel titre, ce qui serait un danger reste affiché comme un avertissement : un titre est facile à ajouter pour tromper le contrôle.
- Il ne sait pas si un site est honnête : un installateur sérieux et un piège s'écrivent pareil, les deux sont « Risque ».
- « Rien à signaler » ne veut donc pas dire « sûr » : lis toujours ce qui vient d'ailleurs.

Pour les curieux : `server/src/skillscan.ts` (les règles), `skillscanroutes.ts` (les routes), `server/test/skill-scan.test.ts` (les tests).

## 5. Santé des compétences, catalogue de l'équipe et banc d'essai (22/11/2026)

**Où :** onglet **Compétences** d'un bot (une ligne de santé sous chaque compétence, puis « Santé et réglages ») et
**Réglages → Compétences** (« Catalogue de l'équipe » et « Santé des compétences » pour tous tes bots).

- **Ce qui est compté** : chaque lecture d'une compétence par le bot (`skill_read`), et chaque échec que le bot signale
  avec `skill_feedback` (« l'étape 1 ne marche plus »). Tu vois « Lue 12 fois · dernière il y a 2 j », « Jamais lue »,
  « 2 échecs signalés » et le dernier problème. Une compétence donnée en entier dans le prompt (peu de compétences
  courtes) s'affiche « Toujours sous ses yeux » : ses lectures ne peuvent pas être comptées.
- **Presque identique** : en écrivant une compétence, un bandeau prévient si une autre de tes compétences dit presque la
  même chose ; le bot reçoit la même alerte après `skill_save`.
- **Épingler / Verrouiller** : épinglée, elle n'est jamais archivée toute seule ; verrouillée, le bot ne peut plus la
  modifier (`skill_save` refuse et lui dit de te demander).
- **Garde-fou de révision** : le bot ne peut pas retirer plus d'un quart du texte d'une compétence en une fois.
- **Versions d'avant** : avant chaque modification (par toi, par le bot ou par « Mettre à jour »), l'ancien texte est
  gardé (10 au plus). « Remettre » le replace, et le texte remplacé est gardé à son tour.
- **Le curateur** (repris du curateur de hermes-agent, MIT — voir `THIRD_PARTY_NOTICES.md`) : une compétence **faite
  par le bot** passe « peu servie » après 14 jours sans lecture, puis est **archivée** après 30 jours. Jamais une
  compétence épinglée, verrouillée, utilisée par une routine, donnée en entier dans le prompt, ou faite par toi, par la
  bibliothèque ou par le catalogue. Archiver ne supprime rien : « Remettre » la rend au bot. La carte « Le curateur te
  propose » liste ce qu'il a vu (jamais lue, peu servie, échecs, doublons, archivée toute seule) avec une action
  chacune ; rien ne change tant que tu ne cliques pas.
- **Qui la reçoit** (compétence partagée) : tous tes bots, ou seulement certaines sections et certains bots, avec des
  exclusions. Un bot hors de la portée ne la voit ni dans sa liste ni avec `skill_read`.
- **Seulement quand je le demande** : le bot ne la voit pas dans sa liste et ne la lit pas seul ; elle sert quand tu
  écris « /skill nom ».
- **Longues compétences** : au-delà de 6 000 caractères, `skill_read` donne d'abord le sommaire (les parties de la
  compétence), puis le bot lit la partie utile. Ce qui demande ton accord, les vérifications et ce qu'il faut rendre
  sont redonnés à chaque lecture. « Toujours en entier » garde une compétence entière dans le prompt.
- **Mettre à jour** : une compétence ajoutée depuis la bibliothèque ou le catalogue retient sa version ; quand la source
  a un texte plus récent, la puce « Mettre à jour » apparaît. Ton texte actuel est gardé dans les versions.
- **Catalogue de l'équipe** : « Mettre au catalogue » (dans « Santé et réglages ») range une compétence vérifiée dans le
  catalogue privé de ton compte ; chaque nouvel envoi crée une version ; tu l'ajoutes à tous tes bots ou à un seul.
  Personne d'autre ne voit ton catalogue.
- **Essayer avec / sans** : la même demande envoyée deux fois au modèle du bot, avec la compétence et sans, côte à côte
  (2 appels). Aussi sur les cartes de la bibliothèque, avant d'ajouter une compétence.

Code : `server/src/skillhealth.ts`, `skillcatalog.ts`, `skillhealthroutes.ts`, `agent/skilltools.ts`,
`web/src/components/SkillHealth.tsx`. Tests : `server/test/skill-health.test.ts`. Captures :
`docs/screenshots/skill-health/`.

### Outils de contrôle des pages (L109, L114, L117) et modèle « Contrôle qualité des pages » (L116)

- `guide_search` : retrouve la bonne règle dans les guides des composants web (fenêtre, menu, onglets, formulaire, mode
  sombre…) et dit si elle repose sur une fonction récente du navigateur (vérifier la prise en charge, garder la solution
  de repli).
- `page_contact_sheet` : une seule image avec le premier écran d'une page à 390, 768 et 1280 px, côte à côte, plus la
  mesure d'un éventuel défilement de côté. Pris dans un onglet temporaire du navigateur du bot.
- `web_fetch` avec `tags: true` : les balises d'une page (titre, description, robots, canonique, hreflang, réseaux
  sociaux, titres, JSON-LD, images sans texte de remplacement) avant son texte, sans note inventée.
- Le modèle d'équipe **« Contrôle qualité des pages »** (Suzanne) utilise ces trois outils et la compétence « Testeur de
  site », et n'envoie aucun formulaire réel sans ton accord.

## 6. Pour aller plus loin

- La compétence **Pages soignées** apprend aux bots tout ce qui précède (quand faire une page, la construire, la vérifier sur téléphone et ordinateur, la partager).
- La compétence **Méthode de travail** leur apprend à comprendre le but, vérifier avant de dire « c'est fait », demander ton accord avant l'irréversible, et te rendre compte simplement.
- Les avis de licence affichés sont une aide, pas un conseil juridique.
