# Audit complet : last30days-skill (mvanhorn) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `mvanhorn/last30days-skill`, commit `e63f8e8` (21/11/2026), v4.5.0, 787 fichiers, 70 Mo. Rien n'a été exécuté.

Type : **outil + une compétence**. Une seule compétence (`skills/last30days/SKILL.md`, 260 lignes + 21 références, ~2 900 lignes au total) pilote un **moteur Python** (~150 modules : 30 sources, planification, fusion, classement, regroupement, rendu, bibliothèque, veille) et un serveur MCP en Go. But : « que disent vraiment les gens de ce sujet ces 30 derniers jours », classé par l'engagement réel (votes Reddit, likes X, vues, cotes Polymarket), avec citations.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 9 |
| PARTIEL | 17 |
| MANQUANT | 24 |
| DIFFÉRENT | 6 |
| NON REPRIS | 14 |
| **Total** | **70** |

Lecture rapide : Sklubot a une **recherche approfondie durable** (`deep_research_start`, `server/src/researchroutes.ts` l.67, rapports par questions reprenables, citations vérifiées contre la source : `researchevidence.ts` l.122) et une recherche X par API officielle (`xsearch.ts`). C'est **plus prudent** que last30days sur la vérification des citations. Mais Sklubot ne sait pas : borner une recherche **dans le temps** (30 derniers jours), **classer par engagement**, interroger directement Reddit / Hacker News / Polymarket / YouTube (transcriptions) / GitHub en sources de première classe, **dire honnêtement « rien de solide »** avec un seuil, ni **suivre un sujet** dans le temps (veille + bibliothèque des rapports). Plusieurs parties de last30days sont **à ne pas reprendre** (lecture des cookies du navigateur, client X non officiel avec cookies de session, compte Reddit personnel).

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Dépôt | **MIT License**, © 2026 Matt Van Horn (`LICENSE`) | Copier, modifier, revendre ; garder le copyright et le texte MIT. |
| `scripts/lib/vendor/bird-search/` | MIT (son propre `LICENSE`) | Licence OK mais **contenu non repris** : client de l'API interne de X avec cookies de session (`AUTH_TOKEN`, `CT0`). |
| Images d'exemple (`assets/*.jpeg`, `.mp3`) | non précisé | Ne pas reprendre. |

---

## 2. Tableau des fonctions

Preuves Sklubot : `server/src/researchroutes.ts` (outil `deep_research_start` l.67), `researchreports.ts` (`browseSection` l.82-200 : recherche web gratuite, lecture des pages, X optionnel, synthèse par le modèle avec citations contrôlées, notes d'échec ; reprise l.303), `researchevidence.ts` (adresses publiques l.30, extraction l.78, contrôle des citations l.122), test `server/test/research-reports.test.ts` ; `xsearch.ts` (API X v2 officielle, 7 jours) ; `reach.ts` (Agent Reach sur le bureau : recherche/lecture Reddit, YouTube, GitHub, Instagram… en lecture seule) ; `search_web` (`agent/tools.ts` l.814) ; routines (`routines.ts`), mémoire, pages.

### 2.1 Sources

| # | Source | Ce que fait last30days | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| S1 | Reddit (public, sans clé) | Recherche, fils et **meilleurs commentaires avec leurs votes**, enrichissement, garde-fous de santé (`reddit_health.py`, canari quotidien `reddit-canary.yml`), plusieurs chemins de repli (listing, shreddit, arctic, keyless). | PARTIEL | Agent Reach sur le bureau (`reach.ts` l.171-194 : canal reddit) | Pas dans la recherche approfondie ; votes non utilisés pour classer ; pas de suivi de santé du canal. | M |
| S2 | Reddit « avec ton compte » (cookie `reddit_session` lu dans le navigateur, avec accord) | — | NON REPRIS | — | Compte personnel + cookies du navigateur : contraire aux règles Sklubot. | — |
| S3 | X / Twitter : API officielle v2 (jeton d'appli) | Recherche récente, publications du sujet lui-même (`from:`), interactions. | FAIT | `xsearch.ts` l.8-15 ; jeton personnel `researchroutes.ts` l.20-30 | Les publications **du sujet lui-même** (`from:handle`) ne sont pas une requête distincte. | S |
| S4 | X via client non officiel (`bird-search`, cookies `AUTH_TOKEN`/`CT0`, lecture cookies navigateur) | — | NON REPRIS | — | API non officielle + session personnelle. | — |
| S5 | YouTube (yt-dlp local) + **transcriptions** fouillées pour 5 phrases citables | — | PARTIEL | yt-dlp dans l'image (`docker/desktop/Dockerfile` l.63-70) ; Agent Reach canal youtube (sous-titres) | Pas utilisé par la recherche approfondie ; pas d'extraction des « phrases qui comptent ». | M |
| S6 | TikTok, Instagram (via ScrapeCreators, payant après 10 000 appels) | — | NON REPRIS | — | Service payant à clé ; Instagram lecture via Agent Reach existe. | — |
| S7 | Hacker News (Algolia, gratuit) | Points et commentaires. | MANQUANT | — | API publique sans clé, très simple. | S |
| S8 | Polymarket (Gamma, gratuit) | **Cotes** et variation, une ligne sous l'histoire concernée. | MANQUANT | — | API publique sans clé ; à présenter comme « ce que parient les gens », jamais comme un fait. | S |
| S9 | GitHub | Personnes : rythme de PR, dépôts, versions ; sujets : issues, discussions. | PARTIEL | Connecteur GitHub (`githubsearch.ts`, `githubactivity.ts`) | Pas branché à la recherche approfondie. | S |
| S10 | Digg (CLI) | Grappes d'histoires par thème. | NON REPRIS | — | Dépend d'un outil tiers à installer. | — |
| S11 | arXiv (gratuit) | Articles de la période. | MANQUANT | — | API publique. | S |
| S12 | Techmeme | Couche éditoriale tech datée. | MANQUANT | — | Via CLI tiers ; RSS possible. | S |
| S13 | Yahoo Finance | Cours sur 30 jours vs S&P 500, plus forte journée. | NON REPRIS | — | CLI tiers, données financières : hors cible. | — |
| S14 | LinkedIn | Publications et articles. | NON REPRIS | Agent Reach (offres d'emploi) | Accès LinkedIn = compte personnel. | — |
| S15 | Meta Ads (bibliothèque publicitaire) | Pubs lancées ce mois, textes, codes promo. | IDÉE | — | API publique officielle de la bibliothèque publicitaire (jeton). Utile en veille concurrentielle. | M |
| S16 | StockTwits, Threads, Pinterest, Xiaohongshu, Bluesky, Truth Social, Telegram, Trustpilot, Amazon (Bright Data), DripStack, dev.to | Couches sociales diverses ; plusieurs à clé ou via services payants ; Xiaohongshu via service local connecté. | NON REPRIS (sauf Bluesky, dev.to = IDÉE, API publiques) | Agent Reach couvre Xiaohongshu, V2EX, etc. | — | S |
| S17 | Perplexity / OpenRouter Sonar / Brave / Parallel | Recherche web ou synthèse payante. | DIFFÉRENT | Chaîne `search_web` : clés de l'utilisateur, puis gratuit, puis payant avec accord (`agent/tools.ts` l.814) | Rien de perdu. | — |
| S18 | Pages carrières des entreprises (Workday, Oracle, Phenom… + robots.txt/sitemap) → « signaux secrets » d'embauche | — | MANQUANT | — | Lecture publique ; utile pour la prospection B2B (modèle `prospection-b2b.md`). Respecter robots.txt comme eux. | M |
| S19 | Brevets USPTO (gratuit) → signaux « hors de ses habitudes » | — | MANQUANT | — | API publique ; cible restreinte. | M |
| S20 | Corpus local (Markdown, texte, PDF) | — | FAIT | Fichiers d'équipe, bibliothèque, `memory_search` | — | — |
| S21 | Web (éditorial) | Une source parmi d'autres. | FAIT | `browseSection` (recherche web gratuite + lecture) | — | — |
| S22 | Wikidata (résolution d'entité sans clé) | « Apple » → l'entreprise, son site, son symbole boursier. | MANQUANT | — | Voir R3. | S |

### 2.2 Recherche, classement, fiabilité

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| R1 | **Fenêtre de temps** stricte (30 jours par défaut, réglable) appliquée à chaque source (`dates.py`, `freshness.py`). | MANQUANT | `browseSection` ne filtre aucune date ; X = 7 jours imposés par l'API | Une recherche « récente » de Sklubot peut citer une page de 2021 sans le dire. Ajouter une date de publication par source et une fenêtre. | M |
| R2 | Le modèle hôte **écrit le plan** (requêtes par source, comptes à suivre, sous-reddits, hashtags, indices Polymarket) avant le moteur ; plan obligatoire pour les noms propres. | PARTIEL | `deep_research_start` prend `plan` (questions) et `seeds` (adresses) | Pas de plan **par source** ni de comptes à cibler. | M |
| R3 | Résolution d'entité (personne/entreprise/produit → site, ticker, comptes) ; contrôle « phrase entière » contre les faux rejets (`entity-grounding-full-phrase-false-demotion`). | MANQUANT | — | — | M |
| R4 | Fan-out parallèle des sources avec **budget en temps réel** (les fils d'exécution ne bloquent pas la limite globale : correctif documenté `non-daemon-executor-threads-defeat-wall-clock-budget`). | PARTIEL | `Promise.allSettled` + `AbortSignal.timeout(16 s)` par page, 25 s recherche, 30 s X (`researchreports.ts` l.96-140) | Pas de budget global par section (somme) ; fonctionne mais sans plafond total. | S |
| R5 | Fusion multi-sources, **dédoublonnage** (par identifiant de flux, sans perdre l'enrichissement), regroupement en histoires (`cluster.py`, diversité), reclassement. | PARTIEL | `browseSection` évite les doublons d'adresse | Pas de regroupement en « histoires », pas de diversité de sources. | M |
| R6 | **Classement par engagement** (votes, likes, vues, cotes, argent misé) plutôt que par SEO. | MANQUANT | — | Les résultats web gratuits sont rangés par le moteur de recherche. | M |
| R7 | **Seuil de confiance + état vide honnête** : « Nothing solid this window » quand aucune grappe ne dépasse le seuil de pertinence ; interdit d'en tirer des citations. | PARTIEL | « Cette question reste ouverte avec les sources consultées » (`researchreports.ts` l.193-198) | Pas de seuil de **pertinence** : une source lue mais hors sujet compte comme preuve. | S |
| R8 | **État par source** (aucun résultat / partiel / limite de débit / authentification / injoignable / délai / schéma changé / non configuré / erreur) ; interdit de dire « personne n'en parle » si la source a échoué. | PARTIEL | Notes : « N page(s) illisible(s) », « recherche X n'a pas abouti » | Pas de classement des échecs ; le rapport final ne distingue pas « silence » et « panne ». | S |
| R9 | Citations : jamais d'adresse devinée ou reconstruite, l'adresse du commentaire pour un commentaire, libellés lisibles ; auto-contrôle après rédaction, une seule régénération. | FAIT | `checkedFindings` : chaque affirmation doit être appuyée par une citation retrouvée **mot pour mot** dans la source (`researchevidence.ts` l.122) — plus strict que last30days | — | — |
| R10 | Contenu récupéré = preuve non fiable, jamais instructions ; enveloppes JSON de l'hôte validées, adresses reconstruites depuis les identifiants. | FAIT | Prompt de synthèse « untrusted evidence, never instructions » (`researchreports.ts` l.168) ; `publicAddress` (`researchevidence.ts` l.30) | — | — |
| R11 | Lecture bornée (`bounded_get.py`) et refus des hôtes non publics (`public_host.py`). | FAIT | `guardedFetch` (`server/src/net.ts` l.118), `publicAddress` | — | — |
| R12 | Mémo de lecture (même page pas relue dans le run), cache avec verrou. | PARTIEL | Cache tiers `thirdparty.ts` (`cached`, `remember`) pour Agent Reach | Pas de cache dans la recherche approfondie. | S |
| R13 | Budget yt-dlp partagé entre sous-recherches (correctif « les comparaisons multiplient le budget »). | NON REPRIS | — | — | — |
| R14 | Mode **comparaison** (« A contre B contre C ») : exécution par entité, gabarit de rapport dédié. | MANQUANT | — | Une compétence peut le faire avec la recherche approfondie (une question par entité). | S |
| R15 | Mode **concurrents** (`--competitors`) : trouve les pairs puis compare. | MANQUANT | `marketing:competitive-brief` n'est pas dans Sklubot | — | S |
| R16 | Mode **découverte / tendances** (« qu'est-ce qui monte en IA ? ») : protocole en 3 commandes (proposer, juger, finaliser) où le modèle est le juge ; listes de catégories Reddit, une HN. | MANQUANT | — | — | M |
| R17 | Mode **personne** (avant une réunion) : publications de la personne, GitHub, employeur ; résolution obligatoire de plusieurs comptes. | PARTIEL | Recherche approfondie + X | Pas de procédure ; envoi de données personnelles à Deepline (payant) : **non repris**. Respect de la vie privée : réservé aux personnalités publiques et au contexte professionnel. | S |
| R18 | Mode **recommandations** (classer et présenter des éléments recommandés). | MANQUANT | — | Texte. | S |
| R19 | Mode **agent / JSON** (sortie machine, consentement absent ≠ permission). | DIFFÉRENT | Les outils Sklubot rendent du JSON au bot | — | — |
| R20 | Suivis : répondre depuis le cache d'un rapport (ID de suivi), creuser un point, vérifier la fraîcheur, file d'attente. | PARTIEL | Rapports gardés et reprenables (`researchreports.ts` l.303 `resumeReport`) ; panneau Recherche | Pas de « creuser ce point » ni « est-ce encore vrai ? ». | S |
| R21 | Auto-contrôle avant présentation (9 points : citations, pas de méta-commentaire sur l'outil, pas plus de 6 citations, cotes en ligne dédiée…). | PARTIEL | Contrôle des citations côté serveur | Pas de liste de contrôle de rédaction. | S |
| R22 | Interdiction de « raconter l'outil » (« j'ai cherché sur Reddit… ») : parler du sujet, pas de la mécanique. | MANQUANT | Compétence « Réponses courtes » partiellement | — | S |
| R23 | Pied de rapport : statistiques par source (nombre, engagement) en bloc fixe. | PARTIEL | Section : `read`, `attempted`, `notes` (l.199) | Pas de récapitulatif lisible en bas du rapport. | S |
| R24 | Évaluation de la qualité de recherche (`evaluate_search_quality.py`, manuelle par défaut). | MANQUANT | `research-reports.test.ts` teste la mécanique, pas la qualité | — | M |
| R25 | `report_checklist.py`, `quality_nudge.py` : rappels de qualité. | MANQUANT | — | — | S |

### 2.3 Bibliothèque, veille, rendu

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| L1 | Chaque rapport enregistré en `.md` daté dans un dossier lisible. | DIFFÉRENT | Rapports en base, visibles dans le panneau Recherche et la conversation | L'utilisateur ne retrouve pas ses rapports comme fichiers (export ?). Non vérifié. | S |
| L2 | **Bibliothèque** cherchable (SQLite FTS5) de tous les rapports passés ; les anciens résultats nourrissent un nouveau rapport **en contexte daté**, jamais comme preuve fraîche. | MANQUANT | `conversation_search` existe | Pas de recherche dans les rapports passés ; pas de règle « ancien = contexte daté ». | M |
| L3 | **Veille** (`watchlist.py`) : sujets suivis, relancés, résultats en SQLite. | PARTIEL | Routines (`routines.ts`) + `deep_research_start` | Possible à la main (routine qui lance une recherche) ; pas de « liste de veille » ni de « quoi de neuf depuis la dernière fois ». | M |
| L4 | **Brief** (`briefing.py`) : résumé des nouveautés de la veille. | PARTIEL | « Aujourd'hui » (`today.ts`) résume le travail des bots | Pas de brief de veille. | S |
| L5 | Flux : `index.html` + flux **Atom** + pages par rapport. | MANQUANT | `page_publish` | Un flux Atom des rapports serait un plus (lecteur RSS). | S |
| L6 | Rendu HTML d'un rapport (fichier local d'abord, ouverture locale). | FAIT | Bots publient des pages (`page_publish`) | — | — |
| L7 | Publication hébergée **seulement sur demande explicite**, avec avertissement « le lien peut être public/indexé », mot de passe possible. | FAIT | Partage public = carte d'accord ; privé par défaut possible (`docs/COMPETENCES.md` § 3) | Mot de passe sur une page : non. | S |
| L8 | Capture silencieuse du brief en fin de tour (hook `capture_brief_hook.py`). | NON REPRIS | — | Propre à Claude Code. | — |

### 2.4 Installation, réglages, santé, sécurité

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| I1 | **Doctor** : santé de chaque source, en cache, sans réseau pour la partie configuration ; réparation guidée. | PARTIEL | `agent-reach doctor` (`reach.ts` l.19) ; santé des connexions dans « Aujourd'hui » | Pas de santé par source pour la recherche approfondie. | S |
| I2 | Assistant de premier lancement (déblocage des sources, une question à la fois, « passer » respecté, ne jamais redemander). | DIFFÉRENT | Réglages → Applis, jeton X dans Recherche | Rien de perdu. | — |
| I3 | **Consentement** explicite avant lecture de cookies ; « pas de réponse » ≠ accord. | NON REPRIS (pas de lecture de cookies) | — | Le principe « silence ≠ accord » est déjà celui des cartes d'accord. | — |
| I4 | `--preflight` : inspecteur de permissions (où sont lues les configs, quelles écritures prévues, quelles sources), sans rien lire de secret. | MANQUANT | — | Idée : « Ce que ce bot peut lire et écrire » en une carte. | M |
| I5 | Clés jamais écrites dans les sorties ; une clé n'est jamais envoyée à un autre fournisseur. | FAIT | Coffre, `pastedsecrets.ts`, `maskSecrets` | — | — |
| I6 | Clés depuis trousseau (Keychain, `pass`) en plus du `.env`. | DIFFÉRENT | Coffre chiffré Sklubot | — | — |
| I7 | Contrôles de sécurité du dépôt (OSV, Scorecard, zizmor, changelog obligatoire). | DIFFÉRENT | CI Sklubot (non comparée) | — | — |
| I8 | Hôte détecté (Claude Code, Cursor, Grok Bot…) pour adapter le rendu des liens. | NON REPRIS | — | — | — |
| I9 | Installation auto de CLIs tiers au premier lancement (`arxiv-pp-cli`, `techmeme-pp-cli`, `trustpilot-pp-cli`…). | NON REPRIS | — | Installation de binaires non vérifiés à l'exécution. | — |
| I10 | Serveur MCP en Go qui embarque le moteur (verrou de cache, groupes de processus). | NON REPRIS | `botmcp.ts`, `teammcp.ts` existent côté Sklubot | — | — |
| I11 | 10 traductions du README (dont français). | FAIT | Sklubot est en français | — | — |

---

## 3. Installer le moteur dans l'image du bureau des bots ?

- **Pas tel quel.** Le moteur exige Python 3.12+ (l'image est sur Debian bookworm, Python 3.11 : `docker/desktop/Dockerfile` l.4 et l.15) ; il installe des CLIs tiers au premier lancement ; il sait lire les cookies de Chrome/Safari/Firefox ; il embarque un client X non officiel. Il écrit dans `~/.config/last30days/.env` et `~/Documents/Last30Days`.
- **Possible en mode restreint** (avec `uv` et un Python 3.12 dédié) : forcer `FROM_BROWSER=off`, pas d'`AUTH_TOKEN/CT0`, pas d'`AGENTCOOKIE`, sources sans clé seulement (Reddit public, HN, Polymarket, GitHub, YouTube via yt-dlp déjà présent, arXiv, web). Risque : Reddit public bloque souvent les adresses de centres de données (le dépôt a un canari quotidien pour ça) — sur un VPS, Reddit tombera souvent en « limite de débit ».
- **Ce que l'outil rend** : un rapport Markdown avec en-tête, « What I learned », grappes classées par engagement, citations avec votes/likes, ligne de cotes Polymarket, pied de statistiques par source ; ou du JSON (`--agent`). **Ce que rend Sklubot** : `deep_research_start` crée un rapport durable par questions ; chaque section contient jusqu'à 4 affirmations, chacune avec une **citation exacte vérifiée** et son adresse, le nombre de pages lues/tentées et les notes d'échec — sans date, sans engagement, sans sources sociales directes.
- **Recommandation** : ne pas installer le moteur ; reprendre dans `researchreports.ts` 3 sources gratuites (HN, Polymarket, Reddit via Agent Reach déjà présent), la fenêtre de temps, le seuil de pertinence et l'état par source.

---

## 4. Écarts de comportement

1. **« Quoi de neuf sur X ce mois-ci ? »** last30days : plan par source → moteur (fenêtre 30 jours) → grappes classées par engagement → seuil « rien de solide » → rapport avec citations communautaires. Sklubot : `browseSection` (`researchreports.ts` l.82) prend 4 résultats de recherche web gratuite + les adresses fournies, lit les pages, synthèse en 4 affirmations. **Problèmes** : (a) aucune date → du vieux contenu présenté comme actuel ; (b) 4 résultats par question seulement (`slice(0, 4)` l.101) : faible couverture ; (c) rangement par le moteur de recherche, pas par ce que les gens ont réellement lu. **Correctifs** : date de publication par source + fenêtre (M) ; plus de résultats et sources HN/Reddit (M).
2. **Panne vs silence.** last30days interdit d'écrire « personne n'en parle » si une source a échoué. Sklubot note « La recherche X n'a pas abouti » dans la section, mais la synthèse finale (`message()` l.201) ne l'interdit pas explicitement. **Correctif** : état par source + règle dans le prompt de synthèse (S).
3. **Pertinence.** Sklubot considère toute page lue (≥ 20 caractères, l.119) comme source ; la citation est vérifiée mais pas la **pertinence** de la page pour la question. last30days applique un seuil de pertinence et rejette les grappes hors sujet. **Correctif** : seuil simple (termes de la question présents, `terms()` l.74 existe déjà) avant de garder une source (S).
4. **Suivre un sujet.** last30days a une veille + bibliothèque ; Sklubot peut programmer une routine qui relance `deep_research_start`, mais chaque rapport repart de zéro et ne dit pas « ce qui a changé ». **Correctif** : relier une routine à un sujet suivi, comparer au rapport précédent (M).
5. **Citations plus strictes chez Sklubot** : la vérification mot pour mot de `checkedFindings` est meilleure que l'auto-contrôle par le modèle de last30days. À garder.

---

## 5. À faire (classé)

1. Fenêtre de temps et date de publication par source dans la recherche approfondie (dire « page de 2021 » quand c'est le cas) — **M**. — **FAIT 22/11 (L87)**
2. Sources gratuites Hacker News (Algolia) et Polymarket (Gamma) dans `browseSection`, avec classement par points/cotes — **S**. — **FAIT 22/11 (L87)**
3. Reddit et YouTube (transcriptions) dans la recherche approfondie via Agent Reach déjà installé sur le bureau — **M**. — **FAIT 22/11 (L87)**
4. Seuil de pertinence avant de garder une source + état vide honnête « rien de solide sur la période » — **S**. — **FAIT 22/11 (L87)**
5. État par source (panne / limite / vide) et règle « ne jamais conclure au silence si la source a échoué » dans la synthèse — **S**. — **FAIT 22/11 (L87)**
6. Plus de 4 résultats par question, regroupement en histoires et diversité de sources — **M**.
7. ✅ FAIT 23/11 (`researchwatch.ts`, L87) — Veille : sujet suivi + routine + « ce qui a changé depuis le dernier rapport » — **M**.
8. Recherche dans les rapports passés, utilisés comme contexte daté — **M**.
9. Compétences « Comparer A et B », « Avant un rendez-vous (personne publique) », « Signaux d'embauche d'une entreprise » sur la recherche approfondie — **S** chacune.
10. Requête X `from:` du sujet lui-même dans le mode personne — **S**.
11. Flux Atom des rapports et pied de statistiques par source — **S**.
12. Carte « Ce que ce bot peut lire et écrire » (inspirée de `--preflight`) — **M**.

## 6. Non vérifié

- Les 21 références et ~150 modules n'ont été lus qu'en partie (README, SKILL.md complet jusqu'à la sécurité, liste des modules, notes de conception par leurs titres).
- Taux réel de blocage de Reddit public depuis le serveur Sklubot : non testé.
- Export des rapports de recherche Sklubot en fichiers : non vérifié.
- `server/test/research-reports.test.ts` non lancé dans ce passage.
