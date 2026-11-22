# Audit : alibaba/open-code-review (OCR) face à la relecture de code de Sklubot

Type : **OUTIL** de relecture de code (CLI Go `ocr`, agent spécialisé, mode « délégation » pour l'agent hôte, CI,
visionneuse web, extensions VS Code/IDEA, 2 skills). Clone superficiel lu le 2026-11-22, jamais exécuté, supprimé
après écriture.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 6 | 11 | 24 | 5 | 6 |

(52 lignes + 2 skills.)

## Licence

`LICENSE` : **Apache License 2.0** (© 2026 Alibaba). Copier/adapter/redistribuer avec notice et mention des
changements. Les 2 skills déclarent `license: Apache-2.0`. Télémétrie OpenTelemetry **désactivée par défaut**
(`pages/.../telemetry.md`). Le module `internal/chatgptauth` se connecte au compte ChatGPT par OAuth
(`auth.openai.com`, portée `chatgpt.tokens.use.direct`) ; Sklubot fait déjà travailler Codex sur l'abonnement de
l'utilisateur via la CLI officielle dans l'ordinateur du bot (Dockerfile ligne 27) : ce chemin propre à OCR n'est pas
repris.

## Ce que fait Sklubot aujourd'hui (lu dans le code)

- **Relecture par un pair** (`server/src/peerreview.ts`, routes `server/src/peerreviewroutes.ts`, stockage
  `server/src/peerreviewstore.ts`, écran `web/src/components/PeerReview.tsx`) : sur une carte « fichiers modifiés »,
  l'utilisateur choisit un autre bot de son compte ; Sklubot envoie **en un seul appel sans outils** (`ask(...)`,
  peerreview.ts:94) au plus **12 fichiers et 24 000 caractères** de diff, masqués (secrets, `redactSecrets` +
  `pastedsecrets.screen`), plus jusqu'à **6 étapes de test enregistrées** dans le tour (peerreview.ts:73-86). Consigne :
  données non fiables, ne pas prétendre qu'un test a tourné sans preuve. Réponse : JSON
  `{"verdict":"approved|changes|inconclusive","reason":"…"}` ; si la relecture est **partielle**, « approved » devient
  « inconclusive » (peerreview.ts:28-29). Revérifie que la carte n'a pas changé avant de rendre le résultat.
  Test : `server/test/studio-workflows.test.ts:160`.
- **Issue GitHub → correctif** (`server/src/githubissues.ts`) : phases `prepare` (bot auteur) → `review` (autre bot,
  jamais le même : githubissues.ts:158, 252-253) → `commit` → `publish` → `ci`, avec bail exclusif par phase.

## Tableau complet

### Choisir quoi relire

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Entrée | Modes : espace de travail, branche (`--from/--to`, merge-base), commit, plage | PARTIEL | Diff d'un instantané de tour (carte « fichiers », `snapshots.ts`) ; GitHub : branche de travail | Relire un commit ou une branche quelconque | M |
| Entrée | `ocr scan` : relire des fichiers entiers sans historique | MANQUANT | — | « Relis ce dossier » | M |
| Entrée | Extrémités **figées** (le commit cible ne bouge pas pendant la relecture) | FAIT (esprit) | Revérifie que la carte n'a pas changé (peerreview.ts:96-104) | — | — |
| Sélection | **Sélection déterministe des fichiers en 5 portes** (chemin/extension, suppression, taille max par fichier, secrets, exclusions) — `internal/agent/selection.go` | PARTIEL | Ignore binaires et chemins non listés (`listedPathOk`), plafond 12 fichiers/24 000 car. (peerreview.ts:58-71) | Au-delà de 12 fichiers, **le reste n'est pas relu** et l'utilisateur ne voit que « partiel » | M |
| Sélection | Chemins secrets jamais relus (`.ssh`, clés, `.netrc`, `.npmrc`, `.env*` sauf modèles) | PARTIEL | Les **valeurs** sont masquées (`redactSecrets`, `screen`) | Le fichier `.env` est envoyé (masqué) au lieu d'être exclu | S |
| Sélection | Exclusions par défaut (tests, fixtures, fichiers générés, verrous) | MANQUANT | — | Un `package-lock.json` peut manger tout le budget de 24 000 car. | S |
| Sélection | `--exclude`, `ocr rules check` (quelle règle gagne) | MANQUANT | — | — | S |
| Sélection | `delegate preview` : liste « relu / exclu + raison » **avant** la relecture | MANQUANT | — | L'utilisateur ne sait pas à l'avance ce qui sera relu | S |
| Budget | Estimation du coût (`estimate.go`) et garde-fou 80 % du contexte avant l'appel | PARTIEL | Plafond fixe 24 000 car. | Pas d'estimation montrée | S |

### Règles de relecture

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Règles | Chaîne de priorité 4 niveaux : `--rule` > `.opencodereview/rule.json` du projet > global > règles système intégrées par langage | MANQUANT | Consigne unique « correctness and regressions » (peerreview.ts:89-93) | Les conventions du projet de l'utilisateur ne sont pas prises en compte | M |
| Règles | Règle par chemin (glob) avec liste d'exigences (ex. « toute nouvelle entrée doit avoir son test et sa doc ») | MANQUANT | — | — | M |
| Règles | Règles regroupées : fichiers partageant la même règle relus ensemble | MANQUANT | — | — | S |
| Contexte | `--background` / fichier d'exigences (cahier des charges, 8 000 car. max, sans troncature silencieuse) | PARTIEL | Le diff seul ; GitHub : texte de l'issue au bot auteur | Le relecteur ne reçoit pas la demande de l'utilisateur : il ne peut pas dire « ça ne fait pas ce qui était demandé » | S |
| Contexte | Exigences depuis une base de connaissance interne | NON REPRIS | — | — | — |

### Moteur de relecture

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Moteur | **Agent avec outils** : `file_read` (côté ancien/nouveau), `file_read_diff`, `file_find`, `code_search`, `code_comment`, `task_done` | MANQUANT | Un seul appel **sans outils** (peerreview.ts:94) | Le relecteur ne voit pas l'appelant d'une fonction modifiée ni le reste du fichier : il juge sur des morceaux | M |
| Moteur | Regroupement sémantique des fichiers par LLM (indices au lieu de chemins), un sous-agent isolé par groupe | MANQUANT | Un seul lot | — | M |
| Moteur | Phase « plan » optionnelle puis boucle principale, tours de relecture | MANQUANT | — | — | M |
| Moteur | **Couverture obligatoire** : chaque fichier finit « relu » ou « sauté + raison » ; `total/reviewed/skipped/coverage_rate` | PARTIEL | Drapeau `partial` + « approved » rétrogradé (peerreview.ts:28,58-71) — bon garde-fou | Pas de liste par fichier ; l'utilisateur ne sait pas lesquels ont été sautés | S |
| Moteur | Ne pas s'arrêter au premier problème grave | MANQUANT | — | Consigne absente | S |
| Moteur | **Changement de comportement signalé même sans bug** (« avant / maintenant », appelant touché) | MANQUANT | — | Une option publique supprimée passe pour « approved » | S |
| Moteur | Compression mémoire en 3 zones (60 % asynchrone, 80 % synchrone) | DIFFÉRENT | Compactage de contexte du loop principal (`server/src/agent/context.ts`) ; inutile pour un appel unique | — | — |
| Moteur | Échec d'un sous-agent isolé, pas de nouvelle tentative interne | DIFFÉRENT | Erreur stockée, l'utilisateur relance (peerreviewstore.ts) | — | — |
| Moteur | **Série d'échecs d'outil par (tâche, outil)** : réponse durcie au lieu de laisser renvoyer la même trouvaille reformulée (`tool_failure_streak.go`) | PARTIEL | Appel **identique** bloqué après N fois (`execute`, loop.ts:1395-1398) | Un appel reformulé qui échoue pour la même raison n'est pas compté | S |
| Moteur | Réparation des arguments JSON mal échappés par le modèle (`comment_args_repair.go`) | PARTIEL | `parseReview` retire les clôtures ``` puis refuse si non-JSON (peerreview.ts:11-22) | Une seule erreur de guillemet perd tout le verdict | S |
| Moteur | Prompts et outils réglés sur des traces de production, benchmark public (AACR-Bench, 200 PR, 1 505 problèmes annotés) | MANQUANT | — | Aucune mesure de la qualité des relectures de Sklubot | M |

### Commentaires

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Sortie | **Commentaires ligne par ligne** (`path`, `start_line`, `end_line`, `category`, `severity`, suggestion) | MANQUANT | Un seul texte `reason` (3 500 car. max) | L'utilisateur ne peut pas aller au problème | M |
| Sortie | **Ancrage** : le modèle cite le code ; OCR retrouve les lignes par fenêtre glissante insensible aux espaces (côté nouveau, puis ancien, puis fichier entier), sinon tâche de re-localisation, sinon « ligne 0 » honnête | MANQUANT | — | — | M |
| Sortie | **Filtre de réflexion** : un 2ᵉ appel retire les commentaires prouvés faux | MANQUANT | — | Faux positifs non filtrés | S |
| Sortie | Deuxième passe d'ancrage après tout le reste | MANQUANT | — | — | S |
| Sortie | Suggestions de code validées (`suggestdiff`) | MANQUANT | — | — | M |
| Sortie | Tri par gravité ; faibles seulement si utiles ; faux positifs probables écartés | MANQUANT | — | — | S |
| Sortie | Verdict global | DIFFÉRENT | `approved / changes / inconclusive` (peerreview.ts) — plus simple et clair pour un non-développeur | — | — |
| Sortie | Format texte ou JSON, `--output` fichier | DIFFÉRENT | Résultat dans l'écran `PeerReview.tsx` | — | — |
| Preuves | Les étapes de test réellement lancées sont jointes | FAIT (mieux) | `recordedSteps` (peerreview.ts:73-86) : test/build/typecheck enregistrés, statut et résumé | OCR ne lit pas les tests lancés | — |
| Sécurité | Données de diff traitées comme non fiables ; secrets masqués | FAIT | Consigne + `mask` (peerreview.ts:49,89-93) | — | — |
| Sécurité | Relecteur différent de l'auteur | FAIT | peerreview.ts:38-44 ; githubissues.ts:158 | — | — |
| Sécurité | Une relecture à la fois par relecteur ; relecteur en pause/occupé refusé | FAIT | `reviewing` + `isBusy`/`isPaused`/`capHolds` (peerreview.ts:45-52) | — | — |

### Sessions, visionneuse, intégrations

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Sessions | Session persistée, **reprise** d'une relecture interrompue (`--resume`), identité de reprise vérifiée | PARTIEL | Résultat/erreur stockés (peerreviewstore.ts) | Reprise impossible : on relance tout | S |
| Sessions | Lister / comparer / supprimer des sessions | MANQUANT | — | Comparer deux relectures d'une même modification | S |
| Visionneuse | Pages : dépôts, sessions, détail (réponses, appels d'outils, jetons), **comparer deux sessions** | MANQUANT | — | — | M |
| Visionneuse | **Marquer « corrigé / ignoré »** et masquer les marqués pendant qu'on corrige | MANQUANT | — | Suivre ce qui reste à corriger | S |
| Correction | « Relire et corriger » : appliquer critique/haut, décrire moyen, ignorer bas | PARTIEL | GitHub : phase `changes` renvoie à l'auteur (githubissues.ts) | Sur une carte « fichiers », pas de bouton « corriger ce que le relecteur a trouvé » | S |
| CI | GitHub Actions (`action.yml`), GitLab CI, GitFlic, Gerrit | PARTIEL | Phase `ci` du flux GitHub (githubissues.ts:59) | Commenter une PR existante de l'utilisateur | M |
| IDE | Extensions VS Code, IntelliJ | NON REPRIS | — | Public développeur | — |
| Agents | Plugins Claude Code, Codex, Cursor, Kimi, OpenCode, QCA | NON REPRIS | — | — | — |
| Agents | **Mode délégation** : la CLI choisit les fichiers et les règles, l'agent hôte relit avec son propre modèle | DIFFÉRENT | Le relecteur est un bot Sklubot avec son propre modèle | — | — |
| MCP | Le relecteur peut utiliser des outils MCP externes | NON REPRIS | — | — | — |
| ACP | Agent Client Protocol (`acp/`) | NON REPRIS | — | — | — |
| Fournisseurs | Registre de fournisseurs (Anthropic, OpenAI, Bedrock…), test de connexion `ocr llm test` | FAIT (esprit) | Moteurs et santé des clés Sklubot (`KeysHealthLinks.tsx`) | — | — |
| Auth | Connexion ChatGPT par OAuth (`chatgptauth`) | NON REPRIS | — | Chemin d'authentification non vérifié comme officiel | — |
| Télémétrie | OpenTelemetry (désactivé par défaut) | MANQUANT | — | Observabilité des relectures (coût, durée) pour l'admin | S |
| Qualité | `ASSURANCE_CASE.md`, OpenSSF Gold, centaines de tests Go | — | — | — | — |

### Skills (2)

| Skill | Ce qu'il fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `open-code-review` | Lancer `ocr review` (modèle configuré dans OCR) | Apache-2.0 | Relecture par un pair | NON (clé séparée ; préférer intégrer les idées) |
| `open-code-review-delegate` | Procédure : aperçu des fichiers, règles groupées, diffs en `git --no-pager --no-ext-diff --no-textconv`, liste de contrôle par fichier, couverture obligatoire, commentaires structurés, changements de comportement, correction optionnelle | Apache-2.0 | Consigne de `peerreview.ts:89-93` | **ADAPTER** : c'est presque mot pour mot la consigne qui manque au relecteur Sklubot (couverture par fichier, gravité, « avant/maintenant », ne pas s'arrêter au premier problème) |

## Peut-on l'installer dans l'image des bots ?

Oui, sans risque pour l'hôte : binaire Go via `npm install -g @alibaba-group/open-code-review` (Node 22 présent). Le
**mode délégation** ne demande aucune clé : un bot qui travaille avec Claude Code ou Codex dans son ordinateur peut
lancer `ocr delegate preview --format json` puis relire. Le mode natif demanderait une clé d'API : elle doit passer par
le relais `sklubot-api`, jamais dans l'ordinateur. Git 2.41+ requis : **l'image a Git 2.39.5** (vérifié : `git --version` dans `sklubot-desktop:latest`) → il faudrait
un Git plus récent (rétroportage Debian ou binaire) avant de l'utiliser. Ce que l'outil renvoie : liste de fichiers relus/exclus avec
raisons, règles par groupe, commentaires JSON ancrés aux lignes avec gravité ; Sklubot renvoie un verdict et un
paragraphe.

## Écarts de comportement

1. **Grosse modification (30 fichiers).** OCR : sélection déterministe, regroupement, un sous-agent par groupe,
   couverture 100 % ou raison par fichier. Sklubot : 12 premiers fichiers jusqu'à 24 000 car., le reste ignoré,
   verdict « inconclusive » au mieux (peerreview.ts:58-71). L'utilisateur reçoit « je n'ai pas pu tout voir » sans
   savoir quoi. **Correction (M)** : découper en lots (par dossier), une relecture par lot, puis une synthèse ; montrer
   la liste « relu / sauté (raison) ».
2. **Le relecteur manque de contexte.** OCR : outils `file_read`, `code_search`, `file_read_diff` en lecture seule.
   Sklubot : un appel sans outils, uniquement des diffs. Une fonction renommée sans mise à jour d'un appelant passe.
   **Correction (M)** : donner au relecteur des outils en lecture seule sur l'instantané (`fileDiff` existe ; ajouter
   lire le fichier complet et chercher dans l'instantané), avec un plafond de tours.
3. **Où est le problème ?** OCR : commentaires ancrés aux lignes, gravité, filtre de réflexion. Sklubot : un texte.
   **Correction (M)** : demander `findings[] {path, code cité, gravité, explication}` dans le JSON, retrouver les lignes
   côté serveur par fenêtre glissante, afficher dans `PeerReview.tsx` à côté du diff (la route `files/diff` existe).
4. **Ce que voulait l'utilisateur.** OCR : `--background`. Sklubot : le relecteur ne voit pas la demande. **Correction
   (S)** : joindre le dernier message de l'utilisateur du tour (masqué) comme « objectif ».
5. **Verdict perdu sur une virgule.** OCR répare l'échappement. Sklubot : `JSON.parse` ou erreur
   « pas de verdict exploitable ». **Correction (S)** : une seconde tentative courte (« renvoie seulement le JSON ») ou
   une réparation tolérante avant d'abandonner.
6. **Après la relecture.** OCR : marquer corrigé/ignoré ; « relire et corriger ». Sklubot : rien à faire du résultat
   sauf le lire. **Correction (S)** : bouton « Demander à {auteur} de corriger » qui envoie les points à l'auteur.

## À faire (classé)

1. Consigne du relecteur adaptée du skill `open-code-review-delegate` : couverture par fichier, gravité, changements de comportement, ne pas s'arrêter au premier problème (S). — **FAIT 22/11 (L77/L180)**
2. Joindre l'objectif de l'utilisateur au relecteur (S). — **FAIT 22/11 (L77/L180)**
3. Exclure les fichiers verrous/générés/secrets du budget avant d'envoyer (S). — **FAIT 22/11 (L77/L180)**
4. Liste « relu / sauté + raison » dans le résultat et l'écran (S). — **FAIT 22/11 (L77/L180)**
5. Découpage en lots pour les grosses modifications au lieu de couper à 12 fichiers (M). — **FAIT 22/11 (L77/L180)**
6. Outils en lecture seule pour le relecteur (lire un fichier entier, chercher) sur l'instantané (M). — **FAIT 22/11 (L77/L180)**
7. Commentaires ancrés aux lignes + affichage à côté du diff (M). — **FAIT 22/11 (L77/L180)**
8. Passe de réflexion qui retire les faux positifs (S). — **FAIT 22/11 (L77/L180)**
9. Bouton « faire corriger par l'auteur » + marquer corrigé/ignoré (S).
10. Réparation/relance du JSON du verdict (S). — **FAIT 22/11 (L77/L180)**
11. Règles de relecture par projet (fichier `rule.json`-like dans le dépôt de l'utilisateur) (M).
12. Compter les échecs d'outil par (outil, raison) et pas seulement les appels identiques, dans le loop principal (S).
13. Mesurer la qualité des relectures sur un petit jeu de PR annotées (M). — **FAIT 22/11 (L77/L180)**

## Non vérifié

- Que la CLI refuse réellement de démarrer avec Git 2.39 (déduit de la documentation « Git >= 2.41 »).
- Les gains du benchmark (précision, 1/9 des jetons) sont ceux annoncés par le dépôt.
- `studio-workflows.test.ts` (relecture) n'a pas été lancé.
- Le statut officiel du flux OAuth ChatGPT d'OCR n'a pas été vérifié.
