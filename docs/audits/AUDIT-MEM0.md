# Audit de mem0 (mem0ai/mem0) face à Sklubot — mémoire

Date : 22/11/2026. Dépôt cloné en lecture seule (commit le plus récent, `--depth 1`), aucun code exécuté. Côté Sklubot :
lecture de `server/src/agent/recall.ts`, `memory.ts`, `sensitive.ts`, `prompt.ts`, `tools.ts`, `routes.ts`, `store.ts`,
`team.ts`, `loop.ts`, `web/src/components/BotSettings.tsx`, `docs/MEMOIRE.md`. Tests lancés :
`npx tsx --test test/memory-recall.test.ts test/memory-guard.test.ts` → **19/19 réussis** (dont 5 000 notes classées en 177 ms).

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 20 | 17 | 23 | 12 | 18 |

(90 lignes de fonctions, plus 7 lignes de compétences : 6 NON, 1 IDÉE.)

## Licence

**Apache License 2.0** (fichier `LICENSE` à la racine, et une copie Apache 2.0 dans chaque dossier `skills/*`). Elle permet
de lire, copier, modifier et revendre, y compris le code, à condition de garder l'avis de licence et de signaler les
fichiers modifiés. Il n'y a pas de clause « copyleft ». Les résultats de benchmark annoncés (LoCoMo 92,5…) concernent la
**plateforme payante**, pas le code libre : le README le dit lui-même.

## Ce qu'est mem0, en deux phrases

Une « couche mémoire » pour agents : à chaque `add`, un modèle extrait des faits d'une conversation, les stocke avec un
vecteur (embedding) dans une base vectorielle ; à chaque `search`, trois signaux sont additionnés : sens (vecteurs),
mots-clés (BM25 sur texte lemmatisé par spaCy) et entités (noms propres, sujets) reliées entre notes. Autour : un serveur
auto-hébergé avec tableau de bord, des SDK Python/TS, une CLI et des greffons pour Claude Code, Codex, Cursor, etc.

## Tableau complet

Légende taille : S = moins d'une journée, M = quelques jours, L = une semaine ou plus.

### Écriture des souvenirs (extraction)

| Domaine | Fonction mem0 | Statut | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Écriture | Extraction par modèle à chaque `add` (un seul appel, JSON) — `mem0/memory/main.py:881` | DIFFÉRENT | `consolidate` `server/src/agent/memory.ts:134`, lancé quand le bot est resté calme `CONSOLIDATE_IDLE_MIN` = 10 min (`memory.ts:309`, `config.ts:173`) ou par le bouton « Revoir » ; tests `wave5.test.ts`, `wave5b.test.ts` | Rien ne s'apprend tant que la conversation ne fait pas de pause de 10 minutes | — |
| Écriture | Ajout brut sans modèle (`infer=False`) | FAIT | `memory_save` `tools.ts:862` ; `POST /bots/:id/memories` `routes.ts:1152` ; test `memory-guard.test.ts` | — | — |
| Écriture | Faits venant aussi des réponses de l'agent (« agent-generated facts first class ») | NON REPRIS | `memory.ts:129` : seuls les messages tapés par l'utilisateur comptent | Choix de sécurité (spec 07 A8) : un bot ne doit pas s'auto-persuader. À garder | — |
| Écriture | Mode « mémoire de l'agent » (faits sur l'assistant lui-même, `AGENT_CONTEXT_SUFFIX` `configs/prompts.py:947`) | NON REPRIS | Les traits du bot viennent de ses consignes | Inutile : consignes et caractère du bot couvrent ce besoin | — |
| Écriture | Contexte des 10 derniers messages pour comprendre « oui, celui-là », « elle » (`main.py:938`) | PARTIEL | `memory.ts:157` n'envoie au modèle que les messages de l'utilisateur | Le modèle ne voit jamais la question du bot : « oui, mardi » ne peut pas devenir un fait. Envoyer aussi les réponses du bot comme **contexte seulement**, en gardant l'extrait obligatoire tiré des mots de l'utilisateur | S |
| Écriture | Dates relatives transformées en dates réelles (« la semaine prochaine » → « semaine du 30/11/2026 ») via « Observation Date » (`prompts.py:524-540`) | MANQUANT | Le prompt de `consolidate` (`memory.ts:160-166`) ne donne ni la date ni la consigne | Un souvenir « part à Lisbonne la semaine prochaine » reste vrai pour toujours. Donner la date du message et exiger des dates absolues | S |
| Écriture | Dates affichées avec les souvenirs dans l'invite | MANQUANT | `prompt.ts:45` et `recall.ts:265` écrivent le texte sans date | Le bot ne sait pas si une note a 2 jours ou 2 ans (seul `memory_search` montre la date, `recall.ts:187`) | S |
| Écriture | Consignes personnalisées d'extraction (`custom_instructions`, `includes`/`excludes`, `prompts.py:543-548`) | MANQUANT | Réglages mémoire = `autoCapture`, `autoRecall`, sujets sensibles (`store.ts:708-726`) | Pas de « retiens surtout mes clients et mes prix, jamais mes horaires » | S |
| Écriture | Générer ces consignes depuis un cas d'usage (`POST /generate-instructions`, `server/main.py:340`) | MANQUANT | — | Petit assistant de réglage | S |
| Écriture | Anti-doublon par empreinte (md5) + 10 souvenirs proches retrouvés par le sens (`main.py:921-1000`) | PARTIEL | `similar()` (Jaccard de mots) `memory.ts:107` ; liste des 200 derniers souvenirs donnée au modèle `memory.ts:159` | **Bogue testé** : « Dupont » et « Durand », « lundi » et « vendredi » jugés identiques (voir « Écarts » n° 8). Au-delà de 200 notes, les plus anciennes ne sont plus montrées au modèle → doublons. Utiliser `rankNotes` pour envoyer les 20 notes **les plus proches** au lieu des 200 plus récentes | S |
| Écriture | IDs remplacés par des numéros pour empêcher le modèle d'inventer un ID (`main.py:930`) | DIFFÉRENT | `contradicts` comparé au texte (`memory.ts:178`) | Sklubot est plus strict ailleurs (extrait mot pour mot vérifié, `findQuote`) ; la correspondance par texte peut rater, mais sans danger | — |
| Écriture | Extrait vérifié mot pour mot dans le message source | FAIT (Sklubot seul) | `memory.ts:190`, `grounding.ts` `findQuote` ; test `wave5.test.ts` | mem0 n'a aucune vérification de ce genre : avantage Sklubot | — |
| Écriture | Liens entre souvenirs (`linked_memory_ids`, `prompts.py:513`) | MANQUANT | — | Pas de « voir aussi » entre notes liées | M |
| Écriture | Extraction d'entités (noms propres, sujets, termes entre guillemets) par spaCy et index d'entités (`utils/entity_extraction.py`, `main.py:1104-1200`) | MANQUANT | — | Voir « lecture » : sert au classement | M |
| Écriture | Souvenirs « riches en contexte » plutôt qu'atomiques, et « dans le doute, extrais » (`prompts.py:578, 607`) | DIFFÉRENT | `memory.ts:162` : phrases courtes, 8 au plus, prudence | Choix prudent assumé ; perd les détails secondaires (prénom de l'enfant, marque de la voiture) | — |
| Écriture | Faits extraits des documents collés par l'utilisateur (`prompts.py:562`) | NON REPRIS | `memory.ts:153` ignore les messages de plus de 4 000 caractères | Prudence face aux contenus collés venus d'ailleurs ; à garder | — |
| Écriture | Faits tirés d'une image partagée (vision, `parse_vision_messages`, `main.py:872`) | MANQUANT | `consolidate` ne lit que le texte | Peu utile ; coûteux | S |
| Écriture | « Mémoire procédurale » (résumé d'une exécution d'agent, `main.py:2007`) | DIFFÉRENT | Compétences apprises proposées en carte et validées (`routes.ts:2507`), résumé de compaction `memory.ts:79` | Sklubot fait mieux (validation par l'utilisateur) | — |
| Écriture | Erreur du modèle remontée au lieu d'une liste vide silencieuse (`main.py:954-962`) | PARTIEL | `consolidate` : si le modèle échoue, la marque n'avance pas (bien) ; mais si la réponse JSON est illisible, `facts = []` puis `setMark` (`memory.ts:167-171, 203`) | Une réponse illisible fait **perdre pour toujours** les messages de ce passage. Ne pas avancer la marque quand le JSON est illisible (ou réessayer une fois) | S |
| Écriture | Gros volumes découpés « sans jeter de texte » (greffon Claude Code, README) | PARTIEL | `rows.messagesAfter` prend les **60 plus récents** messages après la marque (`store.ts:449-450` : `ORDER BY seq DESC LIMIT`), puis la marque saute au plus récent | Plus de 60 messages sans pause de 10 min → le début n'est **jamais** lu. Parcourir par paquets du plus ancien au plus récent | S |
| Écriture | Insertion un par un si l'insertion groupée échoue, embeddings un par un en secours (`main.py:1005-1050`) | NON REPRIS | SQLite local, insertion simple | Sans objet | — |
| Écriture | Messages bruts gardés à côté (`db.save_messages`) | FAIT | Table `rows` (`store.ts`) | — | — |
| Écriture | Qui a dit quoi (`actor_id`, `role`, `attributed_to`) | FAIT | `source` (chat / learned / import) + `quote` (`store.ts:518-521`) | — | — |
| Écriture | Confirmation quand l'utilisateur répète un fait ; contradiction → note « contestée » + carte « laquelle est juste ? » | FAIT (Sklubot seul) | `memory.ts:141-148, 176-186, 213-219`, `routes.ts:2533` ; test `wave5b.test.ts` | mem0 v3 n'écrase plus rien (« ADD-only ») et laisse les deux versions : Sklubot est plus clair pour l'utilisateur | — |

### Lecture et rappel

| Domaine | Fonction mem0 | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Lecture | Recherche **par le sens** (embeddings, 20+ fournisseurs) — `main.py:1652-1660` | MANQUANT | `recall.ts:12-15` le dit : mots-clés seulement | « règlement des devis » ne trouve pas « paiement à 30 jours ». Voir « À faire » n° 3 | L |
| Lecture | BM25 sur texte lemmatisé (spaCy : verbes, comparatifs, pluriels, et forme en -ing gardée) — `utils/lemmatization.py` | PARTIEL | `rankNotes` `recall.ts:110`, racinisation légère `stem` `recall.ts:72` ; test `memory-recall.test.ts` (19 tests) | Pas de formes verbales (« payer » ≠ « payé », reconnu dans `docs/MEMOIRE.md`). Un racinisateur français léger (Snowball, MIT/BSD) règlerait la plupart des cas | S |
| Lecture | Normalisation BM25 par sigmoïde selon la longueur de la question (`utils/scoring.py:16-55`) | DIFFÉRENT | « pertinence » = part pondérée des 4 mots les plus rares de la question (`recall.ts:146-160`) | Équivalent raisonnable, mieux expliqué | — |
| Lecture | Bonus « entité » : une note qui parle de la même personne/marque remonte (`main.py:1747-1827`) | MANQUANT | — | « Que sait-on de Dupont ? » ne remonte pas une note « le client D. Dupont SARL » si le mot n'est pas identique ; partiel avec BM25 | M |
| Lecture | Fusion de plusieurs signaux (sens + mots + entités, `score_and_rank`) | MANQUANT | Un seul signal + fraîcheur + confiance | Dépend de l'ajout d'embeddings | M |
| Lecture | Seuil (`threshold`) et nombre de résultats (`top_k`) | FAIT | `RECALL_MIN_RELEVANCE`, `RECALL_TOP_K`, `SEARCH_LIMIT` `recall.ts:36-46` | — | — |
| Lecture | Explication des scores (`explain=True` → détail par signal) | PARTIEL | `memory_search` montre les mots trouvés (`recall.ts:187`) | Pas de score visible ; dans « Activité », seul le début de la note est noté | S |
| Lecture | Re-classement par un second modèle (Cohere, cross-encoder, LLM — `mem0/reranker/`) | MANQUANT | — | Optionnel, coûteux ; pas prioritaire | M |
| Lecture | Filtres avancés (ET/OU/NON, >, <, contient…) sur les métadonnées | MANQUANT | `memory_search` n'a qu'un paramètre `query` (`tools.ts:876`) | Au minimum : filtrer par date, statut, source (« ce que je t'ai dit ce mois-ci ») | S |
| Lecture | Fraîcheur (récent d'abord à égalité) | FAIT (Sklubot seul en libre) | `recall.ts:162-164` | mem0 libre n'en a pas (version payante seulement) | — |
| Lecture | Confiance (confirmée monte, contestée descend et marquée « incertain ») | FAIT (Sklubot seul) | `recall.ts:165-166`, `UNCERTAIN_MARK` | — | — |
| Lecture | Souvenirs expirés cachés (`expiration_date`, `show_expired`) — `main.py:427-459` | MANQUANT | `pickMemories` fait seulement reculer une note non confirmée et inutilisée depuis 90 jours (`prompt.ts:30`) | Pas de « valable jusqu'au… » ; `COUVERTURE.md:345` le note aussi | S |
| Lecture | Raisonnement temporel (« où j'habite maintenant ») | NON REPRIS | — | Réservé à la version payante de mem0 | — |
| Lecture | Rappel automatique au début (greffon : 1er message ≥ 20 caractères, 5 souvenirs, sans modèle) | PARTIEL | `recallForTurn` `recall.ts:236`, appelé par `buildSystemPrompt` `prompt.ts:221` ; test `memory-recall.test.ts` | **Bogue** : voir « Écarts » n° 2 — sur un tour de routine, de salon ou de reprise, il rappelle des notes pour le **dernier vieux message** tapé par l'utilisateur, contrairement à ce que promet `docs/MEMOIRE.md` | S |
| Lecture | Ne pas réinjecter un souvenir déjà montré dans la session (`mark_injected` / `unseen`, greffon `memory_core.py:976-1040`) | PARTIEL | `exclude` des notes déjà dans l'invite (`recall.ts:246`) ; journal une fois par tour (`recall.ts:255`) | À chaque tour, le bloc est recalculé (ce qui change l'invite système et casse le cache du fournisseur, voir « Écarts » n° 3) | S |
| Lecture | Outil de recherche pour l'agent (`search_memories`, 3 résultats par défaut, 4 000 caractères au plus) | FAIT | `memory_search` `tools.ts:876` ; test `memory-recall.test.ts` | Pas de plafond de caractères (20 × 500 = 10 000 caractères possibles) | S |
| Lecture | Mémoire par utilisateur partagée entre agents (`user_id` commun) | MANQUANT | Chaque bot n'a que ses notes (`recall.ts:224-228`) ; `FEUILLE-DE-ROUTE.md:63` et `COUVERTURE.md:51` le notent | Tu dis ton fuseau horaire à un bot, les autres l'ignorent. Une « fiche sur moi » commune, sous ton contrôle, couvrirait 80 % du besoin | M |
| Lecture | Mémoire de projet partagée vs mémoire personnelle (greffon : `agent_id` par dépôt, `user_id` perso) | MANQUANT | Projets (sections) ont des consignes (`prompt.ts:246`) mais pas de mémoire | Mémoire par projet / espace d'équipe | M |
| Lecture | Mémoire de session (`run_id`) | DIFFÉRENT | Fils de discussion + compaction (`memory.ts:63`) | — | — |
| Lecture | Lire un souvenir (`get`) | FAIT | `memories.owned` `store.ts:523` | — | — |
| Lecture | Tout lister avec filtres et pagination (`get_all`) | PARTIEL | `GET /bots/:id` renvoie `memories.list(bot.id)` limité à **500** (`routes.ts:1102`, `store.ts:515`) | Au-delà de 500 notes, l'écran n'affiche plus les anciennes et le compteur est faux | S |
| Lecture | Recherche dans l'écran | PARTIEL | Filtre « contient » côté navigateur (`BotSettings.tsx:586`) | N'utilise pas le classement BM25 ni les accents ; ne voit que les 500 chargées | S |
| Lecture | Invite « répondre avec les souvenirs » (`MEMORY_ANSWER_PROMPT`) | DIFFÉRENT | Souvenirs dans la section « What you remember » de l'invite (`prompt.ts:223`) | — | — |

### Gestion des souvenirs

| Domaine | Fonction mem0 | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Gestion | Modifier le **texte** d'un souvenir (`update`, `PUT /memories/{id}`) | MANQUANT | `PATCH /memories/:id` ne change que statut/confiance (`routes.ts:2644-2656`) ; l'écran n'a pas d'édition | Pour corriger une faute, il faut supprimer et recréer | S |
| Gestion | Historique de chaque souvenir (ADD / UPDATE / DELETE, ancienne et nouvelle valeur — `GET /memories/{id}/history`) | MANQUANT | Pas de table d'historique (les règles en ont une, `db.ts:343`) | On ne sait pas quand une note est devenue « contestée » ni ce qu'elle disait avant | S |
| Gestion | Supprimer un souvenir | FAIT | `DELETE /memories/:id` `routes.ts:1160`, bouton « Oublier » + « Annuler » (`BotSettings.tsx:594-610`) | — | — |
| Gestion | « Annuler » une suppression | PARTIEL | L'annulation recrée la note par `POST` (`BotSettings.tsx:602`) | La note revient **neuve** : extrait, confiance « confirmée », source, catégorie et date perdus. Faire une corbeille (archivage) au lieu d'une vraie suppression immédiate | S |
| Gestion | Tout effacer pour un agent/utilisateur (`delete_all` par lots, protection contre la boucle infinie `main.py:1904-1958`) | MANQUANT | — | Aucun « tout oublier » pour un bot | S |
| Gestion | Le bot peut oublier sur demande (`/mem0:forget`, outil de suppression MCP) | MANQUANT | Outils mémoire = `memory_save`, `memory_search` seulement (`tools.ts:861-885`) | « Oublie ce que je t'ai dit sur X » : le bot ne peut pas le faire. Ajouter `memory_forget` (archive, pas suppression ; seulement sur demande tapée par l'utilisateur, comme `explicitRemember`) | S |
| Gestion | Mettre en pause / reprendre la capture (`/mem0:pause`, `/mem0:resume`) | PARTIEL | Réglage `autoCapture` (`store.ts:711`), pour tout le compte | Pas par bot | S |
| Gestion | « Retiens ça » explicite (`/mem0:remember`) | FAIT | `explicitRemember` `sensitive.ts:58` | — | — |
| Gestion | État (`/mem0:status` : config, en attente, clé valide) | FAIT | `memoryStatus` `memory.ts:96`, commande Telegram `/memoire` (`telegram.ts:103`) | — | — |
| Gestion | Export JSON / CSV / schéma | PARTIEL | Markdown et JSON `routes.ts:2657` ; test `wave5.test.ts` | Pas de CSV (pratique pour un tableur) | S |
| Gestion | Import | FAIT (Sklubot mieux) | `importCandidates` `memory.ts:223` (aperçu à cocher, doublons, secrets, sujets sensibles) ; test `wave5.test.ts` | mem0 libre n'a qu'une migration vers sa plateforme | — |
| Gestion | Catégories personnalisées (santé, travail, préférences…) | MANQUANT | Seules les catégories « sensibles » existent (`sensitive.ts:13`) | Ranger ses notes par thème dans l'écran | S |
| Gestion | Webhooks sur création / modification / suppression | MANQUANT | — | Peu utile pour l'utilisateur final ; « teaser » de la version payante | S |
| Gestion | Statistiques d'usage de la mémoire (opérations, latence) | PARTIEL | Journal « Activité » : ligne « Notes recalled… » (`recall.ts:257`) | Pas de compteur « notes utilisées cette semaine » | S |
| Gestion | Journal des requêtes (tableau de bord `requests`) | DIFFÉRENT | Journal d'audit non modifiable | — | — |
| Gestion | Page « entités » (qui a des souvenirs) avec suppression | DIFFÉRENT | Écran mémoire par bot | — | — |

### Sécurité et vie privée

| Domaine | Fonction mem0 | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Sécurité | Masquage des secrets avant envoi (greffon `memory_core.py:140-180`, `[REDACTED]`) | FAIT | `looksSecret` refuse la note (`sensitive.ts:47`) ; test `memory-guard.test.ts` | Sklubot refuse plutôt que masquer : plus sûr | — |
| Sécurité | Sujets sensibles | FAIT (Sklubot seul) | `sensitiveCategory`, `memoryVerdict` `sensitive.ts:34, 70` | mem0 demande au contraire d'extraire « santé/bien-être » (`prompts.py:559`) : Sklubot est nettement plus protecteur | — |
| Sécurité | Cloisonnement strict (id obligatoire, rejet des ids au mauvais endroit, `main.py:165-210`) | FAIT | `recallForTurn` ne lit que `memories.usable(bot.id)` ; test « never crosses bots or accounts » | — | — |
| Sécurité | Souvenirs présentés comme « informations, jamais des ordres » | FAIT (Sklubot seul) | `recall.ts:263` | — | — |
| Sécurité | Pas de rappel pour un message venu d'une routine, d'un webhook, d'un autre bot | PARTIEL | `newUserMessage` `recall.ts:217` | Vrai seulement si le message est une ligne visible ; voir le bogue « Écarts » n° 2 | S |
| Sécurité | Longueur de requête bornée (`_validate_and_trim_search_query`) | FAIT | `RECALL_QUERY_CHARS` `recall.ts:42` | — | — |
| Sécurité | Serveur auto-hébergé : authentification activée par défaut, assistant d'admin, clés d'API, jetons rafraîchis | DIFFÉRENT | Comptes Sklubot, 2FA, sessions (`auth.ts`, `twofactor.ts`) | — | — |
| Sécurité | Limitation de débit (slowapi, `server/rate_limit.py`) | DIFFÉRENT | `RateWindow` sur certaines routes (`roomrouting.ts`) | Routes mémoire non vérifiées | — |
| Sécurité | Télémétrie PostHog activée par défaut (`memory/telemetry.py`) | NON REPRIS | — | Vie privée | — |
| Sécurité | Base locale corrompue mise en quarantaine (greffon `memory_core.py:577`) | NON REPRIS | SQLite + sauvegardes (`autobackup.ts`) | Sans objet | — |

### Outils, intégrations, développeurs

| Domaine | Fonction mem0 | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Dev | SDK Python et TypeScript, client asynchrone | NON REPRIS | Sklubot est un produit, pas une bibliothèque | — | — |
| Dev | API REST des souvenirs | PARTIEL | Routes de session (`routes.ts:1152-1160, 2644-2670`) | Absentes de l'API pour programmes (`botapi.ts` n'en parle pas) | S |
| Dev | Serveur MCP mémoire (greffon `core/mcp_server.py`) | FAIT | Outils d'équipe exposés aux moteurs Claude Code / Codex (`prompt.ts:175`, `botmcp.ts`) | — | — |
| Dev | CLI `mem0` (add, search, init) | NON REPRIS | — | Pas utile à l'utilisateur visé | — |
| Dev | Inscription « en tant qu'agent » qui fabrique une clé sans e-mail | NON REPRIS | — | Risque d'abus | — |
| Dev | Greffons Claude Code, Codex, Cursor, OpenCode, Hermes, OpenClaw, Kimi… | NON REPRIS | — | Hors produit | — |
| Dev | Greffon Claude Code : capture des commandes **ratées et de leur correctif** (catégorie `problems_and_fixes`) | MANQUANT | `failures.ts` gère les incidents du tour, la compaction note « ce qu'il ne faut pas refaire » (`memory.ts:85`) mais rien de durable | Le bot refait la même erreur d'une semaine sur l'autre (site qui bloque, mauvais chemin). Une note « leçon apprise » proposée en carte, comme les compétences | M |
| Dev | Envoi par lots toutes les 5 réponses, à l'inactivité (5 min) et en fin de session ; travailleur détaché qui survit à l'arrêt | DIFFÉRENT | Passage périodique après 10 min de calme (`memory.ts:304`), marque en base (reprend après redémarrage) | Voir le bogue des 60 messages | — |
| Dev | Agent « sidekick » Sonnet dans un worktree séparé | NON REPRIS | Assistants (`startHelper`, `team.ts:109`) | Propre au codage | — |
| Dev | Proxy compatible OpenAI qui ajoute la mémoire (`mem0/proxy`) | NON REPRIS | — | — | — |
| Dev | 25+ bases vectorielles, 20 fournisseurs de modèles, 13 d'embeddings | NON REPRIS | SQLite, fournisseurs Sklubot | — | — |
| Dev | Tableau de bord : page de configuration (choix du modèle et de l'embedder) | PARTIEL | `AUX_MODEL` pour les demandes annexes (`memory.ts:19`) | Pas de choix dans l'interface | S |
| Dev | Nœuds n8n, Zapier, Vercel AI SDK, Strands | NON REPRIS | — | — | — |
| Dev | Banc d'essai de qualité du rappel (LoCoMo, LongMemEval, BEAM) | MANQUANT | Tests unitaires + performance (`memory-recall.test.ts`) | Aucune mesure « sur 100 questions, combien de bonnes notes trouvées ». Un petit jeu de questions en français suffirait | M |
| Dev | Notices de mise à niveau vers le cloud (`memory/notices.py`, 1 667 lignes) | NON REPRIS | — | Publicité | — |
| Dev | Mémoire en graphe (ancienne, `examples/graph-db-demo`) | NON REPRIS | — | Retirée par mem0 lui-même en v3 | — |
| Dev | Exemples (extension Chrome YouTube, démo multimodale, multi-agents) | NON REPRIS | — | Démos | — |

### Compétences (`skills/`)

Toutes sous Apache 2.0 (un `LICENSE` par dossier). Ce sont des compétences **pour développeurs qui intègrent mem0** ; aucune
ne correspond à un métier d'utilisateur de Sklubot. Équivalents cherchés dans `server/skills-library/catalog.json`,
`server/templates/`, `docs/COMPETENCES.md` : aucun.

| Compétence | Ce qu'elle fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `mem0` | Référence du SDK (add/search/filtres) pour un assistant de code | Apache 2.0 | — | NON (outil de développeur) |
| `mem0-cli` | Mode d'emploi de la CLI | Apache 2.0 | — | NON |
| `mem0-integrate` | Ajoute mem0 dans un dépôt existant, de bout en bout | Apache 2.0 | — | NON |
| `mem0-test-integration` | Vérifie une intégration mem0 | Apache 2.0 | — | NON |
| `mem0-oss-to-platform` | Migre du libre vers la plateforme payante | Apache 2.0 | — | NON (commercial) |
| `mem0-vercel-ai-sdk` | Mémoire dans Vercel AI SDK | Apache 2.0 | — | NON |
| Greffon : `search`, `remember`, `forget`, `pause`, `resume`, `status` | Commandes de mémoire dans Claude Code | Apache 2.0 | `memory_search`, `explicitRemember`, `/memoire` Telegram ; **pas** de `forget` ni de pause par bot | IDÉE : reprendre `forget` (outil) et pause par bot |

## Écarts de comportement (flux par flux)

Seuls les flux qui touchent la mémoire ont un sens ici (mem0 n'a ni chat, ni ordinateur, ni appels, ni routines). Les
autres flux du cahier des charges sont marqués « sans objet ».

1. **Un fait appris, puis rappelé plus tard.**
   - mem0 : à chaque `add`, un appel de modèle extrait tout de suite (date d'observation fournie, 10 derniers messages en
     contexte, 10 souvenirs proches pour éviter les doublons). Au `search` suivant, le fait est trouvé même avec d'autres
     mots (vecteurs), surtout s'il partage une entité.
   - Sklubot : rien n'est appris pendant la conversation ; 10 minutes après le dernier message, `consolidationSweep`
     (`memory.ts:304`) lit au plus les **60 derniers** messages, n'envoie que les mots de l'utilisateur, sans date. Le fait
     n'est rappelé que s'il partage un mot (après accents et pluriels) avec un message futur.
   - Différences où mem0 est plus solide : (a) dates absolues ; (b) contexte de la question du bot ; (c) synonymes ;
     (d) rien de perdu quand la conversation est longue.
   - Correctifs : donner `new Date(message).toISOString()` dans la liste des messages et la consigne « convertis toute date
     relative en date absolue » ; parcourir les messages par paquets de 60 du plus ancien au plus récent
     (`ORDER BY seq ASC LIMIT 60` puis avancer la marque) ; envoyer les réponses du bot marquées « contexte, n'apprends
     rien d'ici » ; ne pas avancer la marque sur un JSON illisible.

2. **Une routine se déclenche (ou un salon, ou une reprise) : rappel automatique.**
   - mem0 (greffon) : la recherche automatique ne part que du premier message de session tapé par la personne.
   - Sklubot : `buildSystemPrompt` appelle `recallForTurn` à **chaque** tour (`prompt.ts:221`). `newUserMessage`
     (`recall.ts:217-225`) prend la dernière ligne `role = 'user'` de la discussion. Or une routine n'écrit qu'une ligne
     `event` (`scheduler.ts:90`), un message de salon arrive comme déclencheur `system` sans ligne (`team.ts:186`), une
     reprise (`CONTINUE_TEXT`, `loop.ts:1153`) non plus. Résultat : le rappel se fait pour **le dernier message tapé, peut-être
     vieux de plusieurs jours**, et des notes sans rapport entrent dans l'invite. Le test (`memory-recall.test.ts:33, 227`)
     simule une routine comme une ligne `message` avec `origin`, ce que le vrai code ne produit pas : le test passe, le
     comportement réel diffère de `docs/MEMOIRE.md` (« Un message venu d'une routine… n'en déclenche pas »).
   - Correctif : passer à `recallForTurn` le déclencheur du tour (rappel seulement si `trigger.kind === "user"` et le
     message de ce tour), ou vérifier que la ligne trouvée a moins de quelques minutes. Ajouter un test qui passe par le
     vrai chemin d'une routine. Taille S.

3. **Coût et cache.** mem0 garde les souvenirs hors de l'invite système (ils sont injectés à part). Sklubot met le bloc
   « What you remember » dans l'invite système et le recalcule à chaque tour selon les derniers mots (`pickMemories`
   `prompt.ts:18-46`, plus le rappel). Le code dit ailleurs vouloir une invite système identique pour profiter du cache
   (`loop.ts:714`). Chaque nouveau message qui change le choix des notes invalide ce cache. Correctif : mettre les notes
   rappelées dans le message de l'utilisateur du tour (comme l'heure), pas dans l'invite système. Taille S.

4. **Deux classements différents pour la même mémoire.** `pickMemories` (`prompt.ts:12, 29`) compte les mots de 3 lettres
   et plus, **sans** enlever les accents ni les pluriels, sur les 3 derniers messages ; `recall.ts` a son propre
   tokeniseur, plus juste. Une note peut donc être exclue par le premier et rattrapée (ou non) par le second. De plus
   `pickMemories` ne charge que 500 notes : `omitted` et le texte « N older memories » sont faux au-delà. Correctif :
   faire choisir `pickMemories` avec `rankNotes`. Taille S.

5. **L'utilisateur dit « oublie ça ».** mem0 : commande `forget` / suppression par API. Sklubot : aucun outil ; le bot
   ne peut que répondre qu'il ne peut pas, ou faire semblant. Correctif : outil `memory_forget` (archive la note trouvée,
   seulement sur demande tapée par l'utilisateur), ligne dans « Activité ». Taille S.

6. **Corriger un souvenir.** mem0 : `update` garde l'historique. Sklubot : statut seulement ; « Annuler » une suppression
   recrée une note neuve (perd confiance, extrait, date). Correctif : édition du texte + table `memory_history` ;
   suppression = archivage pendant 30 jours. Taille S.

7. **Erreur du fournisseur pendant l'apprentissage.** mem0 lève `LLMError` pour que l'appelant réessaie. Sklubot : si
   `ask` échoue, l'erreur part dans la console (`memory.ts:313`), la marque ne bouge pas, on réessaiera au prochain
   passage — correct ; mais rien n'est montré à l'utilisateur, et un JSON abîmé fait perdre le passage (point 1).

8. **Deux faits presque pareils.** mem0 compare par empreinte exacte puis par le sens, et laisse le modèle décider.
   Sklubot décide seul avec `similar()` (`memory.ts:107-115`, Jaccard ≥ 0,7). Testé le 22/11 :
   `similar("Le client Dupont paie toujours ses factures à 30 jours fin de mois", "Le client Durand paie …")` → `true`,
   et « rapport le lundi matin » / « rapport le vendredi matin » → `true`. Dans `consolidate` (`memory.ts:183-187`) le
   fait sur Durand est jeté, ou la note Dupont devient « confirmée » ; à l'import il est écarté comme doublon.
   Correctif : veto quand un mot présent d'un seul côté est rare (idf, déjà calculé dans `recall.ts`), un nombre, un
   jour ou un nom propre. Taille S. (Détails dans `AUDIT-CLAUDE-MEM.md`, « Écarts » n° 3.)

9. **Plusieurs bots, une seule personne.** mem0 : `user_id` partagé, chaque agent retrouve les préférences. Sklubot : chaque
   bot réapprend tout. Correctif minimal : une « fiche sur moi » au niveau du compte (quelques lignes que l'utilisateur
   relit), donnée à tous ses bots ; les notes apprises restent par bot. Taille M.

Flux sans objet pour mem0 (pas d'équivalent) : premier message, ordinateur sur un lien, tâche longue qui reprend,
validations, salon multi-bots (sauf le bogue n° 2), appel vocal, livraison de fichiers, inscription, redémarrage.

## À faire (du plus utile au moins utile)

0. Corriger l'anti-doublon `similar()` qui confond « Dupont »/« Durand » et « lundi »/« vendredi » (testé) — S.
1. Corriger le rappel sur les tours non tapés par l'utilisateur (routine, salon, reprise) et tester le vrai chemin — S.
2. Apprentissage : lire tous les messages par paquets du plus ancien au plus récent (plus de perte au-delà de 60) et ne pas avancer la marque sur un JSON illisible — S.
3. Recherche par le sens en option : embeddings multilingues locaux (petit modèle ONNX dans le serveur) ou via le fournisseur, fusionnés avec BM25 comme mem0 — L.
4. Dates absolues à l'apprentissage + date affichée à côté de chaque note dans l'invite — S.
5. Outil `memory_forget` (archive sur demande explicite) — S.
6. Édition du texte d'une note + historique des changements + corbeille au lieu de suppression immédiate — S.
7. `pickMemories` classé par `rankNotes` (un seul tokeniseur, plus de compte faux au-delà de 500) — S.
8. ✅ Fait (2026-11-22, `llm/cachelayout.ts`). Notes rappelées déplacées de l'invite système vers le message du tour (cache conservé) — S.
9. Anti-doublon : montrer au modèle les 20 notes les plus proches plutôt que les 200 plus récentes — S.
10. Envoyer les réponses du bot comme contexte (sans en apprendre) pour comprendre « oui, celle-là » — S.
11. ✅ FAIT (L88 : profil partagé + « Ajouter à ma fiche », `memoryviewroutes.ts`) — « Fiche sur moi » commune à tous les bots du compte — M.
12. Racinisation française des verbes (Snowball) — S.
13. Date de fin par note (« valable jusqu'au ») — S.
14. Écran : charger toutes les notes (pagination) et utiliser la recherche classée — S.
15. Consignes personnalisées d'extraction (« retiens surtout… ») — S.
16. Leçons apprises des échecs, proposées en carte — M.
17. Petit banc d'essai français de qualité du rappel — M.
18. Filtres de `memory_search` (date, statut, source) et plafond de caractères — S.
19. Pause de l'apprentissage par bot — S.
20. Catégories de notes, export CSV, mémoire dans l'API pour programmes — S chacun.
21. Liens entre notes et index d'entités (après les embeddings) — M.

## Non vérifié

- Que la suppression d'un bot supprime bien ses souvenirs (`retire.ts` n'en parle pas ; peut-être une cascade SQL).
- La limitation de débit sur les routes mémoire.
- Le comportement réel du moteur Claude Code / Codex quand il appelle `memory_search` par MCP (pas lancé).
- Les chiffres de qualité de mem0 (non reproduits ; ils concernent la version payante).
- La partie TypeScript `mem0-ts` n'a été que survolée (même logique que Python d'après les noms de fichiers).
