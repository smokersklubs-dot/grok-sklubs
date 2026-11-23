# Audit complet : Timon (ai-timon/timon) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.
Dépôt lu : `ai-timon/timon`, commit `7ace147` (21/11/2026), 6 090 fichiers. Sources lues : `README.md`, `LICENSING.md`, `TRADEMARKS.md`, les 52 pages `public-docs/docs/usage/*`, les pages `plugins/*` utiles (mémoire, cartes, permissions), et les commentaires d'en-tête des modules `orchestrator/src/*` qui portent la fiabilité (reprise, repli, disjoncteurs, mémoire). Le code n'a pas été lancé.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 27 |
| PARTIEL | 66 |
| MANQUANT | 29 |
| DIFFÉRENT | 20 |
| NON REPRIS | 8 (+ 7 vus, listés sous le tableau, non comptés) |
| **Total** | **150** |

Lecture rapide : Timon est un **atelier de code** (orchestrateur, Kanban, branches git, relecture, fusion) qui pilote les CLI d'abonnement (Claude Code, Codex…) sur l'ordinateur de l'utilisateur. Sklubot est une **équipe de bots généralistes** avec chacun son ordinateur Linux. Beaucoup de fonctions de Timon (worktrees, fusion, graphe git) ne visent pas le même public. Mais trois familles valent d'être prises :
1. **la conduite d'un tour en cours** : Entrée = glisser la consigne dans le tour, Ctrl+Entrée = mettre en file, ↑ pour rappeler ses anciens messages, « Répondre à ce message », jauge de contexte cliquable avec « Compacter » ;
2. **la fiabilité « sans personne »** : relance automatique 3 fois (30 s, 1 min, 2 min) des tours sans témoin quand le fournisseur est injoignable, raison d'interruption toujours écrite, disjoncteur entre deux bots qui se réveillent l'un l'autre, quota « jamais cru sur parole » (on revérifie avant de refuser) ;
3. **la transparence** : écran « ce que le bot reçoit au démarrage » (dans l'ordre, modifiable), journal réseau par mission avec alerte « nouvel hôte », carte d'accord qui montre le contenu du script qu'on approuve.

---

## 1. Licence

| Partie | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Tout sauf ci-dessous (`orchestrator/`, `app/`, `desktop/`, `public-docs/`, `plugins/`) | **GNU Affero General Public License v3** (AGPL-3.0-only), avec une exception pour les plugins (`LICENSING.md`) | Utiliser, étudier, modifier. **Mais** toute copie distribuée **ou offerte en service sur le réseau** doit publier tout son code source sous AGPL. Sklubot est hébergé et non AGPL : **aucun code ni texte de ces dossiers ne peut être copié**. Idées seulement. |
| `packages/sdk/`, `examples/` | MIT | Copie possible avec la mention MIT. Peu utile (c'est l'interface de plugins de Timon). |
| Nom, logo, mascotte (suricate) | Marques déposées (`TRADEMARKS.md`) | Interdits. |

Conclusion : **tout ce qui suit est à refaire avec nos mots et notre code**.

---

## 2. Tableau complet

Colonnes : Zone · Fonction de Timon · Statut · Preuve dans Sklubot (fichier:ligne, test) · Ce qui manque · Taille (S ≤ 1 j, M 2-4 j, L 1-2 sem.).
« pas de test » = aucun test trouvé. Plusieurs preuves Sklubot viennent de l'audit Hermes du même jour (`audit/AUDIT-HERMES.md`) et ont été relues ici quand elles comptent (pilotage du tour, accords, repli, compaction, Telegram).

### 2.1 Discussion

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Chat | Écrire pendant que le bot travaille : **Entrée** glisse la consigne dans le tour, **Ctrl+Entrée** la met en file pour le tour suivant ; inversion réglable | PARTIEL | `server/src/agent/loop.ts:205,369-380` (`steering`), `Transcript.tsx` (« N en attente ») ; `server/test/engine-queue.test.ts` | Un seul geste : le serveur décide (texte glissé si possible, sinon file). L'utilisateur ne choisit pas « change de cap maintenant » contre « après ». Pas de ligne « tour redirigé ». | S |
| 2 | Chat | ↑ / ↓ dans la zone de saisie : rappeler les 50 derniers messages envoyés à ce bot | MANQUANT | `Composer.tsx:398` : ↑/↓ seulement dans le menu `/skill` | Retaper une consigne longue à chaque fois. | S |
| 3 | Chat | **Répondre à un message** précis (bandeau de citation, clic pour y revenir ; le bot reçoit le début et la référence) | MANQUANT | grep `reply` dans `Composer.tsx` : rien | Impossible de dire « à propos de ta 2e réponse ». | S |
| 4 | Chat | Copier un message | FAIT | `web/src/components/ui.tsx:417` ; pas de test | — | — |
| 5 | Chat | « Copier en Markdown » (titres, listes, code gardés) | MANQUANT | grep `markdown` + `copy` : rien | La copie donne le texte rendu. | S |
| 6 | Chat | Lire un message à voix haute | FAIT | `server/src/voice/speak.ts`, `web/src/components/ListenControls.tsx` ; `server/test/voice-speak.test.ts` | — | — |
| 7 | Chat | Badge d'état d'une conversation : au travail / tour fini / ouverte / **interrompue + cause au survol** (quota, crédit, surcharge, refus, arrêt, silence trop long, plafond de tours, plantage) | PARTIEL | Carte d'échec avec remèdes (`server/src/agent/failures.ts:132-166`) ; `server/test/failures.test.ts` | Pas de badge par bot dans la liste qui dise *pourquoi* il s'est arrêté sans ouvrir le chat. | S |
| 8 | Chat | Redémarrage du serveur pendant un tour : tour marqué « interrompu : redémarrage », **pas rejoué** tout seul (il a pu déjà envoyer des messages), reprise avec le contexte au message suivant | DIFFÉRENT | `loop.ts:1678-1730` (reprise automatique au démarrage) ; `server/test/engine-queue.test.ts` | Sklubot **reprend** le tour. Plus confortable, mais risque de refaire une action déjà faite si l'outil n'est pas protégé par `executions.ts` (e-mails : protégés ; clics dans un site : non). Voir § 3.12. | M |
| 9 | Chat | Carte « session d'origine perdue » qui dit ce que le bot a reçu (tout, un résumé, la fin, rien) | MANQUANT | — | Quand le moteur CLI perd sa session, l'utilisateur ne sait pas ce dont le bot se souvient. | S |
| 10 | Chat | Titre automatique de 4 à 6 mots à la fin de la 1re réponse ; renommer | DIFFÉRENT | Un fil par bot, des « générations » (`server/src/routes.ts:952`, `store.ts:338`) | Pas de liste de conversations par bot, donc pas de titres. L'utilisateur perd la possibilité de garder plusieurs sujets ouverts avec le même bot. | M |
| 11 | Chat | Plusieurs conversations par bot, filtre « lancées par moi / automatiques » (Kanban, routine, autre bot, système) | DIFFÉRENT | Fil unique + fils de tâches (`ThreadPanel.tsx`), historique (`HistoryViewer.tsx`) | Les routines écrivent dans le même fil que l'utilisateur ; pas de filtre par origine. | M |
| 12 | Chat | « Tout arrêter » pour un bot ou un projet : tours, messages en attente, demandes entre bots, tâches → Bloquées, déclencheurs et routines coupés, liste de ce qui a été neutralisé | PARTIEL | Pause d'un bot / de tous (`routes.ts:753` `/pauses/all`, `server/src/pauses.ts`) ; `server/test/pause.test.ts` | La pause ne **rend pas compte** de ce qu'elle a arrêté et ne coupe pas les messages déjà en file entre bots. | S |
| 13 | Chat | Taper « STOP » n'arrête rien : la doc l'explique | DIFFÉRENT | Telegram `/stop` (`telegram.ts:104`) | Sans objet. | — |
| 14 | Chat | Pièces jointes : images réduites à 2 048 px avant envoi, 18 Mo par message, pile de plus de 3 images | PARTIEL | `server/src/uploads.ts`, `uploadparts.ts` ; `server/test/large-attachments.test.ts` | Pas de réduction automatique des grandes photos avant le modèle (coût et refus « image trop grande »). | S |
| 15 | Chat | Le bot montre une image ou une vidéo (fichier, adresse https vérifiée côté serveur, image en ligne) ; 1 Go par conversation | FAIT | `file_send` (`server/src/agent/tools.ts:356`), carte fichier `Transcript.tsx:270` ; `server/test/media-tools.test.ts` | — | — |
| 16 | Chat | **Cartes HTML interactives** dans le chat : le bot affiche un tableau, un graphique ou un formulaire isolé, et **attend la réponse** (un seul clic réel, pas deux fois) | PARTIEL | Aperçu de page isolé (`server/src/pageroutes.ts:47-48`, `PagePreview.tsx:53`) ; `server/test/pages-artifacts.test.ts` | L'aperçu n'est pas un **formulaire qui répond au bot**. Manque déjà noté (COUVERTURE « Graphiques, mini-applis »). | M |
| 17 | Chat | Images Markdown d'autres sites non chargées | FAIT | `web/src/lib/markdown.ts:36-55` + CSP `server/src/hardening.ts:61` | — | — |
| 18 | Chat | Bloc « Raisonnement » replié | FAIT | `loop.ts` (légende), `Transcript.tsx` ; pas de test | — | — |
| 19 | Chat | `/compétence` replié en une ligne « Compétence /nom » dans la bulle | PARTIEL | `/skill nom` (`routes.ts:868`) | Pas de repli visuel. | S |
| 20 | Chat | Choisir le modèle : liste par fournisseur, **favoris ★**, recherche tous fournisseurs, fenêtre de contexte, badge « Nouveau », modèle disparu affiché grisé (jamais remplacé en silence) | PARTIEL | `BotSettings.tsx:31-54`, sélecteur OpenRouter (`AiAccounts.tsx`) ; `server/test/openrouter.test.ts` | Pas de favoris, pas d'affichage « modèle retiré ». | S |
| 21 | Chat | Changer de modèle au milieu d'une conversation : tout passe si ça tient, sinon **résumé par l'ancien modèle**, sinon par le nouveau, sinon la fin seulement, et le chat dit pourquoi | PARTIEL | Choix du modèle par bot ; compaction (`memory.ts` `compactIfNeeded`) | Le changement vaut pour le bot, sans transfert expliqué. | S |
| 22 | Chat | **Jauge de contexte** sous la zone de saisie (anneau, rouge dès 40 %, conseil à 80 %), panneau détaillé | MANQUANT | grep côté web : aucune jauge ; compaction automatique à 80 % (`loop.ts:1125-1137`) ; `server/test/wave10-context.test.ts` | L'utilisateur ne voit jamais quand la conversation est pleine ni pourquoi le bot oublie. | S |
| 23 | Chat | Bouton **Compacter** (sur place ou vers une nouvelle conversation, ou vers un autre modèle), ligne discrète « avant / après » avec « Voir le résumé » | PARTIEL | Route `POST /bots/:id/compact` (`routes.ts:1166`) | Route sans bouton visible relié à une jauge ; pas de « voir le résumé ». | S |
| 24 | Chat | Mode d'autorisation par conversation (Plan / Demander / Modifs OK / Auto / Tout permis) | DIFFÉRENT | Autonomie par bot `careful / balanced / trusted / auto` (`shared.ts:61`) ; `server/test/floor-autonomy.test.ts` | Réglage par bot, pas par conversation. Pas de mode « Plan » (lire et proposer sans rien changer). | S |
| 25 | Chat | Niveau de réflexion par bot et dans la barre du chat | FAIT | `BotSettings.tsx` (effort), `Brain.tsx` ; pas de test | Pas dans la barre du chat. | — |
| 26 | Chat | Fournisseur injoignable : **une ligne** « Impossible de joindre… nouvel essai (2/5) », puis « Reconnecté après 2 essais » ; s'il abandonne, bouton **Réessayer** (jamais de renvoi caché dans un chat surveillé) | PARTIEL | Essais avec délai croissant (`server/src/agent/reliability.ts:41-48`), carte d'échec + Réessayer (`failures.ts`) ; `server/test/codex-retry.test.ts` | Pas de ligne « essai n/5 » visible **pendant** l'attente : le bot paraît figé. | S |
| 27 | Chat | Plusieurs discussions côte à côte (grille 2×2, 3×3), modèles de grille enregistrés | MANQUANT | `WorkspaceDock.tsx` : pages et outils seulement | Suivre deux bots à la fois est impossible. | M |
| 28 | Chat | Une discussion à côté d'une autre page (Kanban, fichiers) dans un « îlot » | PARTIEL | Panneau latéral `DetailsPanel.tsx`, `WorkspaceDock.tsx` | Pas de chat d'un autre bot à côté. | M |
| 29 | Chat | Onglets des bots au travail en haut (anneau qui pulse, « a besoin de toi », temps écoulé, épingler) | PARTIEL | Liste latérale avec état (`Sidebar.tsx:119-123`) ; centre de commande `CommandView.tsx` | Pas de barre « qui travaille maintenant » toujours visible. | S |

### 2.2 Fichiers, navigateur, terminal

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 30 | Fichiers | Aperçu dans l'appli : images, vidéos, PDF, **Word, Excel (1 000 lignes), PowerPoint** en texte ; galerie ← → dans un dossier | PARTIEL | `SpendSkillsFiles.tsx:341-368` (images, PDF, texte, Markdown, CSV 50 lignes) | Pas d'aperçu docx / xlsx / pptx, pas de galerie. | M |
| 31 | Fichiers | Créer, renommer, déplacer (glisser), supprimer avec confirmation, « Copier le chemin » | PARTIEL | Fichiers d'équipe et bibliothèque (`server/src/teamfile.ts`, `pagefiles.ts`) | Pas d'arborescence modifiable par glisser. | M |
| 32 | Fichiers | Un lien de fichier dans la réponse s'ouvre dans l'appli ; hors dossier du bot → demande d'abord | DIFFÉRENT | Fichiers du bot dans son ordinateur ; carte fichier | Sans objet (l'ordinateur du bot est isolé). | — |
| 33 | Fichiers | Éditeur avec Ctrl+S, onglets, « Enregistrer / Ne pas enregistrer » | MANQUANT | — | On ne peut pas corriger un fichier du bot sans passer par lui. | M |
| 34 | Navigateur | Navigateur intégré, profil **persistant par projet** (connexions gardées) | DIFFÉRENT | Navigateur dans l'ordinateur Linux du bot, profil gardé (`server/src/computer.ts`, `docker/desktop`) ; `server/test/linux.test.ts` | Profil par bot, pas par projet. Rien de perdu. | — |
| 35 | Navigateur | Outils de débogage pour le bot : console, requêtes réseau, ralentir le réseau, mesure de performance (Core Web Vitals) ; en-têtes de cookies cachés | MANQUANT | Outils par éléments et captures (`server/src/agent/elements.ts`) ; `server/test/elements.test.ts` | Un bot qui fait un site ne peut pas lire les erreurs de la console. | M |
| 36 | Navigateur | **Enregistrer un parcours** dans le navigateur (mots de passe et codes jamais enregistrés), le relire, puis le bot en fait une compétence rejouable (pause pour les codes à usage unique) | PARTIEL | « Montre-moi » : `server/src/teach.ts` | Vérifier si `teach.ts` masque les champs mot de passe et s'il produit des étapes relisibles ; pas de liste d'étapes modifiable. | M |
| 37 | Navigateur | **Annoter une page** : cliquer un élément, écrire ce qu'il faut changer ; le bot reçoit l'élément + une image ; historique des annotations | MANQUANT | — | Pour un bot qui fait des pages ou des sites, c'est le geste le plus clair. | M |
| 38 | Navigateur | « Se connecter avec Chrome » quand Google refuse le navigateur intégré (copie des cookies dans le profil) | DIFFÉRENT | Navigateur réel dans le bureau du bot + prise en main (`ComputerViewer.tsx`) | Google accepte en général un vrai Chromium ; non vérifié ici (§ 5). | — |
| 39 | Navigateur | Copier-coller texte entre l'appareil et la page pilotée | FAIT | Prise en main VNC (`server/src/vnc.ts`, `ComputerViewer.tsx`) ; pas de test | — | — |
| 40 | Terminal | Terminal intégré par projet (shell qui continue quand on quitte, touches Ctrl/Échap sur téléphone, polices Nerd) | DIFFÉRENT | Écran Linux du bot en direct (`LiveScreen.tsx`) ; commandes par le bot | Pas de terminal texte pour l'utilisateur. Non souhaitable pour un public non développeur, sauf mode expert. | — |
| 41 | Terminal | Carte « commande que le bot ne peut pas lancer » (`sudo`) → « Coller dans un terminal » ; le bot ne tape jamais dans ton terminal | DIFFÉRENT | Le bot est root dans son conteneur ; accord pour l'ordinateur personnel via Relais (`server/src/agent/mycomputer.ts`) ; `server/test/relay.test.ts` | Sans objet. | — |
| 42 | Projets | Widget Docker Compose (démarrer, arrêter, reconstruire) | NON REPRIS | — | Public développeur. | — |
| 43 | Git | Widget git, graphe de commits, publier une branche, créer le dépôt GitHub | NON REPRIS | Intégration GitHub par issues (`server/src/githubissues.ts`) | Public développeur. | — |
| 44 | Git | Un worktree git par tâche, fusion après tests, PR GitHub | NON REPRIS | — | Public développeur. | — |

### 2.3 Bots (agents)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 45 | Bots | Créer un bot (nom, consignes, dossier, modèle, autorisations, compétences, MCP) | FAIT | `POST /bots` (`routes.ts`), `Modals.tsx` ; `server/test/team-templates.test.ts` | — | — |
| 46 | Bots | **Documents d'identité** en Markdown (`SOUL.md` caractère, `directives.md`, tout `.md` ajouté), modifiables par l'utilisateur et par le bot lui-même | PARTIEL | Consignes du bot (`shared.ts:162` `instructions`), profil | Un seul champ texte ; pas de fichiers séparés « caractère / règles / style ». | S |
| 47 | Bots | Avatar : emoji, **image téléversée et cadrée**, mascotte configurable | PARTIEL | Personnage dessiné (`CharacterEditor.tsx`) | Pas de photo (déjà noté COUVERTURE). | S |
| 48 | Bots | La mascotte **montre ce que fait le bot** (pense, attend, écrit) partout où il apparaît ; option « mascottes immobiles », respect de « réduire les animations » | PARTIEL | `Character.tsx` | Vérifier si le personnage change selon l'état (non vérifié, § 5). | S |
| 49 | Bots | Noms : toutes les langues, noms réservés Windows refusés, « Foo » = « foo » | NON REPRIS | — | Sklubot n'utilise pas le nom comme dossier. | — |
| 50 | Bots | Renommer : missions, routines, déclencheurs, secrets suivent | FAIT | Identifiant stable, nom libre (`shared.ts`) | — | — |
| 51 | Bots | **Corbeille** : supprimer met le bot (consignes, mémoire, compétences, navigateur) à la corbeille ; « Restaurer » ; purge différée ; les secrets donnés sont révoqués | MANQUANT | `routes.ts:685-691` → `retireBot` : suppression définitive | Un clic de trop efface la mémoire d'un bot. Seule la sauvegarde complète le rattrape. | S |
| 52 | Bots | Dupliquer (mémoire vide par défaut) | FAIT | `routes.ts:720-724` (options mémoire et conversation), `DuplicateBotModal.tsx` ; pas de test | — | — |
| 53 | Bots | Exporter / importer des bots (zip) avec aperçu « créer / mettre à jour / ignorer », secrets jamais exportés (noms seulement), dossier proposé quand il n'existe pas | PARTIEL | Fichier d'équipe `.md` (`server/src/teammd.ts`, `teammdimport.ts`) ; `server/test/team-markdown.test.ts` ; import Grok (`grokimport.ts`) ; `server/test/grok-import.test.ts` | Le fichier d'équipe ne porte pas la mémoire ni les routines (`shared.ts:1109`). | M |
| 54 | Bots | Importer des agents depuis d'autres produits (archive d'export, agents locaux d'un autre outil) | FAIT | `server/src/grokimport.ts`, `vault-import.ts`, `projectimport.ts` ; `server/test/grok-import.test.ts` | — | — |
| 55 | Bots | **Organigramme** : pôles, projets, chef de chaque projet, liens hiérarchiques ; glisser un bot sur un autre pour qu'il en dépende ; annulable | MANQUANT | Sections de la liste (`sectionroutes.ts`), règle de salon `lead` (`shared.ts:17`) | Pas de hiérarchie entre bots. | M |
| 56 | Bots | **Qui peut confier du travail à qui** (seul le chef ou l'orchestrateur ; refus 403 qui nomme la règle) ; un bot ne peut pas changer ses propres droits | PARTIEL | Délégation entre bots du compte (`server/src/agent/team.ts`, `MAX_HOPS = 3`) ; `server/test/room-routing.test.ts` | Tout bot peut solliciter tout autre bot du compte ; pas de liste « peut déléguer à ». | S |
| 57 | Bots | **« Ce que le bot reçoit au démarrage »** : liste numérotée dans l'ordre (préambule, consignes globales, identité, rôle, compétences, mémoire, rappels du moment), chaque élément ouvrable et modifiable à sa vraie source | MANQUANT | grep `promptPreview|injections` : rien | Quand un bot dérive, l'utilisateur ne peut pas voir quelle consigne oubliée il suit. C'est l'outil de diagnostic le plus utile pour un non-développeur. | M |
| 58 | Bots | Ordre stable du prompt : texte fixe d'abord, rappels variables à la fin (cache du fournisseur) | PARTIEL | `server/src/agent/prompt.ts` (mémoire choisie à chaque tour, `prompt.ts:17-45`) | Les notes du tour sont dans le prompt système : le cache est cassé à chaque tour (noté aussi dans l'audit Hermes, ligne 157). | S |
| 59 | Bots | Supprimer ou réécrire une règle de mémoire ⇒ les bots qui l'ont vue **repartent d'une conversation neuve** (sinon l'ancienne règle reste dans l'historique) | MANQUANT | `memory.ts` | Une note supprimée continue d'agir tant que la conversation la contient. | S |
| 60 | Bots | Siège de « bot principal » : il reçoit les récapitulatifs ; ne peut pas être supprimé ; si le siège est vide, choisi seul s'il n'y a qu'un candidat, sinon carte | FAIT | `bot.primary` : refus de suppression (`routes.ts:687`) | — | — |
| 61 | Bots | Rôles prédéfinis dont on peut modifier le texte, marqués « Modifié », « Rétablir » | PARTIEL | Modèles d'équipe (`server/templates/*.md`, `TeamModels.tsx`) | Pas de rôle partagé dont le changement vaut pour tous les bots de ce rôle. | S |
| 62 | Bots | Les bots peuvent lire **la documentation du produit** hors ligne (`docs_search`, `docs_read`) pour aider à configurer | PARTIEL | `guide_read` (`server/src/agent/guides.ts:100-103`) = guides de tâches (réserver, devis…) | Un bot ne peut pas répondre « comment je règle X dans Sklubot ? » à partir de la vraie doc. | S |
| 63 | Bots | Consignes globales (un fichier pour tous les bots : langue, style) | PARTIEL | Règles par compte (`server/src/rules.ts`), consignes de section (`shared.ts:234`, migration 028) | Pas de « consignes pour tous » en texte libre clairement nommé. Non vérifié en détail. | S |

### 2.4 Accords et sécurité

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 64 | Accords | Carte d'accord avec le nom de l'outil dans ta langue et une phrase (« Écrit stats.py ») | FAIT | `loop.ts:1803` (`waitForApproval`), `Cards.tsx` ; `server/test/security.test.ts` | — | — |
| 65 | Accords | **Le script lancé est montré sur la carte** (extrait + empreinte) ; si le fichier change entre la carte et le clic, la commande ne part pas | MANQUANT | — | Le bot peut écrire `run.sh` puis demander « lancer run.sh ? » : l'utilisateur approuve un nom, pas un contenu. Utile pour l'ordinateur personnel (Relais). | M |
| 66 | Accords | « Autoriser pour la session » / « Toujours » limité à **la même commande exacte, le même fichier, le même domaine** ; liste « Toujours autorisé » avec révocation | PARTIEL | « Toujours » sur une carte (`loop.ts:1868` `decideApproval`) ; jamais pour les envois (`irreversible.ts:8`) | Vérifier la portée exacte de « Toujours » (outil entier ou même argument ?) et l'existence d'une liste révocable. Non vérifié (§ 5). | S |
| 67 | Accords | Outils pré-autorisés par motif (`Bash(git:*)`) | DIFFÉRENT | Règles en langage courant + relecteur (`rules.ts`, `authorize.ts:254`) ; `server/test/rule-words.test.ts` | Autre approche, plus simple pour un non-développeur. | — |
| 68 | Accords | Carte sans témoin (routine, tâche) : **délai visible** (« expire dans 12:34 »), puis le bot est prévenu qu'il n'a pas de réponse et continue sans | PARTIEL | Expiration après 25 min (`server/src/config.ts:188-191`), rappel (`config.ts:185`) | Pas de compte à rebours sur la carte ; comportement à l'expiration non vérifié (§ 5). | S |
| 69 | Accords | Questions avec boutons (formulaire `question`) et plan de tâches à valider (`kanban_plan`) | PARTIEL | `ask_user` (`tools.ts:1205-1211`, 6 choix) ; `server/test/ask-wait.test.ts` | Une question à la fois ; pas de plan à cocher. | S |
| 70 | Sécurité | Secrets : le bot ne voit jamais la valeur ; « Afficher » demande le mot de passe et montre 30 s | PARTIEL | Coffre (`VaultSection.tsx`), clés en écriture seule (`AiAccounts.tsx:8`), masquage (`loop.ts:1734`) ; `server/test/security-fixes.test.ts` | Pas de « révéler 30 s après mot de passe » (valeur jamais réaffichée : plus sûr, moins pratique). | — |
| 71 | Sécurité | Le bot crée un secret ou demande un secret par un formulaire | FAIT | Carte secret (`routes.ts` `/cards/:seq/secret`, `pastedsecrets.ts`) ; `server/test/security-fixes.test.ts` | — | — |
| 72 | Sécurité | Appeler un service sous l'identité d'un secret sans le montrer | FAIT | Relais de clés (`server/src/egress.ts:129`) ; `server/test/security.test.ts` | — | — |
| 73 | Sécurité | Clôture de la mission par le système (Landlock / sandbox macOS) : dossier personnel en lecture seule, exceptions par bot | DIFFÉRENT | Un conteneur Docker par bot, réseau isolé (`docker/desktop`, `deploy/bots-firewall.sh`) ; `server/test/isolation.test.ts` | Plus fort chez Sklubot. | — |
| 74 | Sécurité | **Journal réseau par mission** : hôtes contactés, octets, statut, erreurs ; **alerte au premier hôte jamais vu** dans ce projet | MANQUANT | `egress.ts` = relais de clés, pas un journal | Personne ne sait à quels sites un bot a parlé. Utile contre l'injection (« envoie ce fichier à evil.com »). | M |
| 75 | Sécurité | Adresse d'un serveur MCP jugée sur ses **adresses résolues** (pas 127.0.0.1, réseau local, métadonnées), deux fois (écriture et lancement) | PARTIEL | `server/src/net.ts`, `teammcp.ts` ; `server/test/team-mcp.test.ts` | Vérifier la deuxième vérification au lancement (DNS changé entre-temps). Non vérifié (§ 5). | S |
| 76 | Sécurité | Moindre privilège MCP : une tâche n'hérite pas des connecteurs du compte sauf si son rôle les liste | PARTIEL | Connecteurs choisis par bot (`NativeApps.tsx`) | Une routine a tous les connecteurs de son bot. | S |
| 77 | Sécurité | Images Markdown dans une note ou un message jamais chargées | FAIT | `markdown.ts:36-55` | — | — |
| 78 | Sécurité | Appareils reliés par code à usage unique (5 min), liste avec état, IP, révocation | FAIT | Relais (`server/src/relay.ts`, `MyComputer.tsx`) ; `server/test/relay.test.ts` | Renommer un appareil manque (COUVERTURE). | S |
| 79 | Sécurité | Piloter plusieurs machines depuis une seule interface (sélecteur de machine) | NON REPRIS | — | Sklubot est un serveur central ; sans objet. | — |
| 80 | Sécurité | Avertissement : un appareil relié a tous les droits du compte | PARTIEL | `MyComputer.tsx` | Texte d'avertissement non vérifié. | S |

### 2.5 Mémoire et compétences

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 81 | Mémoire | Règles courtes injectées par portée (global, projet, rôle, bot) et par type (piège, décision, préférence) | PARTIEL | Notes par bot + profil (`prompt.ts:187-221`), mémoire d'équipe absente (COUVERTURE) | Pas de portée « projet » ni « rôle ». | M |
| 82 | Mémoire | **Capture des faits** en fin de mission (réussie *ou ratée* : les pièges naissent des échecs) par un petit modèle, sans lancer d'agent | FAIT | `memory.ts:137` (`consolidate`), modèle d'appoint `config.ts:175` | Vérifier que les tours **ratés** sont aussi lus (non vérifié, § 5). | — |
| 83 | Mémoire | **Curateur de nuit** : nouvelles règles, fusion, remplacement (l'ancienne gardée « remplacée »), rejet ; chaque décision journalisée et **annulable** ; résumé envoyé | PARTIEL | Fusion à la consolidation, carte en cas de contradiction (`memory.ts:182`, `shared.ts:401`) ; `server/test/memory-guard.test.ts` | Pas de journal des décisions de mémoire, pas de « veto » après coup. | M |
| 84 | Mémoire | Promotion : un fait vu N fois chez un bot est **proposé** (jamais écrit seul) comme règle d'équipe | MANQUANT | — | Va avec la mémoire d'équipe (COUVERTURE). | M |
| 85 | Mémoire | Oubli progressif des faits bruts non confirmés | FAIT | Confiance et oubli (`prompt.ts:24-33`) | — | — |
| 86 | Mémoire | Bibliothécaire : après une longue conversation (≥ 5 messages), un agent écrit les leçons dans un coffre de notes ; garde anti-récursion ; verrou posé **avant** le lancement | DIFFÉRENT | Consolidation par bot (`memory.ts:311-319`, au repos) | Pas de coffre de notes lisible. Rien de grave perdu. | — |
| 87 | Mémoire | Coffre Obsidian comme mémoire lisible, connecteur de notes gardé pour les tâches | MANQUANT | — | Les notes du bot ne sont visibles que dans l'appli. | M |
| 88 | Mémoire | Récapitulatif multi-projets injecté au bot principal sans modèle (projets chauds/froids, objectifs) | PARTIEL | Vue « Aujourd'hui » (`server/src/today.ts`) ; `server/test/today.test.ts` | Pas injecté dans le prompt du bot principal. | S |
| 89 | Mémoire | « Rêve » de nuit : le bot propose des pistes **à valider** (jamais exécutées) à partir des objectifs et de signaux web | PARTIEL | Pépites (`GEM_KINDS`, `shared.ts:47`), idées (`server/src/ideas.ts`) | Pas de passe de nuit dédiée. | M |
| 90 | Mémoire | Note des projets (potentiel, avancement) pour signaler le projet presque fini laissé dormant | MANQUANT | — | Idée originale, utile pour un propriétaire dispersé. | M |
| 91 | Mémoire | Conserver moins : effacer les faits bruts après N jours ; tout effacer | PARTIEL | `server/src/privacy.ts` ; `server/test/privacy.test.ts` | Pas de durée de rétention réglable pour la mémoire. | S |
| 92 | Compétences | Compétence = dossier `SKILL.md` + fichiers annexes (`references/`, scripts) ; le bot lit un annexe à la demande | PARTIEL | Bibliothèque (`server/skills-library/`, `skillslibrary.ts`) ; `server/test/skills-library.test.ts` | Vérifier si `skill_read` donne accès aux fichiers annexes d'une compétence (non vérifié). | S |
| 93 | Compétences | Mode **Catalogue** (une ligne, lecture à la demande) ou **Import** (texte entier toujours) choisi par compétence | DIFFÉRENT | Automatique : texte entier si ≤ 6 000 caractères au total, sinon liste + `skill_read` (`prompt.ts:223-231`) | L'utilisateur ne peut pas forcer « toujours en entier » une procédure critique. | S |
| 94 | Compétences | **Portées** : tous les bots / un projet / un rôle / un bot, avec **Exclure** ; la plus étroite gagne | PARTIEL | Compétences partagées entre bots du compte (`prompt.ts:233-236`, `store.ts:590`) | Pas de portée ni d'exclusion. | M |
| 95 | Compétences | **Vérifier que le bot lit la compétence** (compteur de lectures `skill reads`) | MANQUANT | Table `skills` sans compteur (`migrations/001-baseline.ts:62-65`) | Impossible de savoir si une compétence sert. Base du curateur demandé par l'audit Hermes. | S |
| 96 | Compétences | Poids d'une compétence affiché ; conseil « écrire une description qui déclenche » | MANQUANT | — | — | S |
| 97 | Compétences | Créer, lire, modifier une compétence ; pré-autoriser ses outils | PARTIEL | `SkillsLibrary.tsx`, `skill_propose` (`tools.ts:785`) ; `server/test/work-methods.test.ts` | Pas de pré-autorisation d'outils par compétence. | S |
| 98 | Compétences | Reprendre les compétences d'un autre outil (Claude Code) en lecture seule | PARTIEL | Import GitHub (`skillsgithub.ts`) | — | S |
| 99 | Compétences | Compétences de visite guidée par profil, avec dispositions testées | DIFFÉRENT | `Onboarding.tsx` | — | — |

### 2.6 Travail planifié, Kanban, déclencheurs

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 100 | Kanban | Tâche durable (titre, description, responsable, type, priorité, **dépendances**, fichiers joints) | PARTIEL | `TasksView.tsx`, `task_add` (`tools.ts`), objectifs (`goals.ts`) | Pas de dépendances ni de fichiers joints à une tâche. | M |
| 101 | Kanban | Un bot planifie le travail en tâches, l'utilisateur choisit modèles et bots sur un écran | MANQUANT | — | — | M |
| 102 | Kanban | Colonne TO DO = carnet d'idées (ajouter n'ordonne rien), idées qui se ferment seules quand le travail est fait | PARTIEL | Idées (`server/src/ideas.ts`) | Pas de fermeture automatique. | S |
| 103 | Kanban | Retours de tâches dans le chat de celui qui les a lancées, sous le nom et l'avatar du bot qui a travaillé | PARTIEL | Fils de tâches (`ThreadPanel.tsx`), `bgtasks.ts:54-106` ; `server/test/wave9.test.ts` | — | S |
| 104 | Kanban | Tâche qui meurt : relancée 3 fois, puis **Bloquée avec la dernière erreur** ; une relance humaine remet le compteur ; compteur **en base** (un redémarrage ne le remet pas à zéro) | PARTIEL | Coordinateur d'échecs (`failures.ts:342`, anti-tempête 10 min) ; `server/test/failures.test.ts` | Vérifier que le compteur de relances survit à un redémarrage (non vérifié, § 5). | S |
| 105 | Kanban | Raison d'interruption système **séparée** de la raison métier (« bloqué » ≠ « tué par le quota ») | PARTIEL | Types d'échec (`server/src/failuretypes.ts`) | Une tâche de fond arrêtée par le quota doit le dire sur la tâche elle-même. | S |
| 106 | Kanban | Boucle de vérification : après une tâche de code, relecture par un autre modèle, retour au codeur, borné | DIFFÉRENT | Relecture par un autre bot (`server/src/peerreview.ts`) ; `server/test/security-review.test.ts` | Relecture à la demande, pas automatique. | — |
| 107 | Kanban | Séries de nuit réglées sur les quotas (les tâches s'étalent jusqu'à la réouverture) | MANQUANT | Plafonds (`usagecaps.ts`) ; `server/test/usage-caps.test.ts` | Pas de « fais ça cette nuit en respectant mon abonnement ». | M |
| 108 | Déclencheurs | Routines planifiées | FAIT | `server/src/routines.ts:143`, `cron.ts` ; `server/test/features.test.ts` | — | — |
| 109 | Déclencheurs | Webhook entrant avec **filtre** (réponse 200 « ignoré : filtre », journalisé) | PARTIEL | `/hooks/:token` (`routes.ts:400-420`) | Pas de filtre sur le contenu. | S |
| 110 | Déclencheurs | Webhook **signé** (HMAC du secret) | MANQUANT | `routes.ts:400-420` : jeton dans l'adresse seulement | Déjà noté par l'audit Hermes. | S |
| 111 | Déclencheurs | **Regrouper les rafales** (clé, période de calme, plafond) : une issue modifiée 5 fois = un seul réveil | MANQUANT | — | Un service bavard réveille le bot 5 fois (5 tours payés). | S |
| 112 | Déclencheurs | « Envoyer un exemple » : voir ce que ferait le déclencheur sans rien faire ; journal des appels | MANQUANT | — | On ne peut pas tester un déclencheur sans attendre le vrai événement. | S |
| 113 | Déclencheurs | Codes de réponse clairs pour l'expéditeur (200 ignoré, 202 accepté, 429…) | PARTIEL | Limites de débit (`routes.ts:400-420`) | — | S |
| 114 | Déclencheurs | Déclencheurs sur **événements internes** (tâche finie, bot renommé…) | PARTIEL | `scheduler.ts:153-164` (mail, page qui change) | Pas d'événement « un bot a fini ». | S |
| 115 | Déclencheurs | Actions : envoyer un webhook sortant, gabarits, retour silencieux, lancer un script, lancer un workflow | MANQUANT | — | Webhooks sortants déjà notés (Hermes l. 98). | M |
| 116 | Déclencheurs | Les bots gèrent les déclencheurs par outils (`trigger_create/list/test/remove`) | PARTIEL | Routines créées par le bot (outil routine) | Pas de test à blanc. | S |
| 117 | Workflows | Éditeur visuel de workflows (nœuds agents, logique, humain, mémoire, requête HTTP, boucles bornées à 100, « Ranger ») | DIFFÉRENT | Méthodes de travail (`server/src/agent/workmethods.ts`), studio vidéo (`videoworkflows.ts`) ; `server/test/studio-workflows.test.ts` | Pas d'éditeur général. Gros chantier, faible priorité pour un non-développeur. | L |

### 2.7 Fournisseurs, quotas, fiabilité

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 118 | Fournisseurs | Faire tourner les bots sur ses **abonnements CLI** (Claude Code, Codex, Copilot…) | FAIT | `server/src/agent/engine.ts` (codex / claude dans l'ordinateur du bot), `subscriptionconnect.ts:12-19` ; `server/test/codex-retry.test.ts` | — | — |
| 119 | Fournisseurs | **Plusieurs comptes d'un même fournisseur** (« Claude · Perso », « Claude · Travail »), chacun avec sa jauge ; compte « d'instance » pour les routines | PARTIEL | Connexion par bot (`AiAccounts.tsx`) | Pas de nom de compte, pas de choix « ce bot sur le compte Travail ». | M |
| 120 | Fournisseurs | Jauge de quota par compte, **« inconnu » ≠ 0 %** | PARTIEL | Consommation (`usage.ts`), plafonds (`usagecaps.ts`) ; `server/test/usage-caps.test.ts` | Pas de lecture du quota restant de l'abonnement. | M |
| 121 | Fournisseurs | Proxy LiteLLM, fournisseur par fichier, clés au coffre | DIFFÉRENT | OpenRouter + compatible OpenAI (`server/src/llm/openai-compat.ts`) | — | — |
| 122 | Fiabilité | Quota épuisé dans un chat : bascule **dans la même conversation** sur le secours, historique gardé ; sinon pause jusqu'à réouverture | FAIT | `modelChain` (`reliability.ts:18-26`), `loop.ts:1017-1027` ; `server/test/failures.test.ts` | — | — |
| 123 | Fiabilité | **Un refus de quota enregistré n'est jamais cru sur parole** : avant chaque tour on revérifie (vraie jauge, sinon un essai toutes les 2 min) | MANQUANT | Disjoncteur par fournisseur (`failures.ts`) | Incident Timon : refus pendant 5 h alors que le compte était rouvert. Vérifier la durée du disjoncteur Sklubot (§ 5). | S |
| 124 | Fiabilité | Jamais de secours sur un moteur dont le CLI n'est pas installé | PARTIEL | `engine.ts` | Non vérifié. | S |
| 125 | Fiabilité | Bot principal sans quota au redémarrage → passé sur le secours **sans être relancé**, carte « Secours automatique » | PARTIEL | `modelChain` | Pas de carte expliquant la bascule. | S |
| 126 | Fiabilité | « Modèle saturé » (Overloaded) ≠ plantage : bascule immédiate, sinon 3 essais | FAIT | `reliability.ts:41-48` (passager), `loop.ts:1010-1016` | — | — |
| 127 | Fiabilité | **Tour sans témoin** (routine, tâche, réveil) : relancé 3 fois (30 s, 1 min, 2 min) dans la même session, « reprends sans refaire ce qui est fait » ; jamais pour quota, connexion ou refus | PARTIEL | Essais dans l'appel (`reliability.ts`) ; carte d'échec | Une fois l'appel abandonné, une routine attend un clic. Lié au manque de délai de garde (Hermes l. 150). | S |
| 128 | Fiabilité | Délai « mission silencieuse trop longtemps » puis arrêt ; nettoyage des missions coincées | MANQUANT | Veille du tour = avis seulement (`server/src/agent/watch.ts`) ; `server/test/watch.test.ts` | Pas d'arrêt automatique d'un tour muet (déjà noté Hermes l. 150). | S |
| 129 | Fiabilité | **Disjoncteur entre deux bots** qui s'écrivent et se réveillent en boucle : par paire, fenêtre glissante, messages mis de côté, **en base** | PARTIEL | `server/src/agent/roombudget.ts:1-30`, `team.ts` `MAX_HOPS = 3` ; `server/test/roombudget.test.ts` | En mémoire vive : remis à zéro au redémarrage (dit dans le fichier). Hors salons (délégation directe), non vérifié. | S |
| 130 | Fiabilité | Disque en panne au démarrage : pas de relance toutes les 3 s (incident 4 718 redémarrages) | PARTIEL | Surveillance disque (`server/src/diskwatch.ts`), Sentinelle | Comportement en boucle de redémarrage non vérifié. | S |
| 131 | Fiabilité | Réponse arrivée après coup (carte décidée après la fin du tour) livrée seulement si le bot peut encore agir | PARTIEL | `ask_user` termine le tour, la réponse revient en message | — | — |
| 132 | Fiabilité | Récapitulatif des retours de tâches trié et formaté pour le bot principal (incident : il ne recevait que des titres vides) | PARTIEL | Fils de tâches | Non comparé en détail. | S |
| 133 | Fiabilité | Sauvegardes et corbeille ; rétention de l'historique (180 j) | PARTIEL | `server/src/autobackup.ts`, `backuparchive.ts` ; `server/test/auto-backup.test.ts`, `backup-drill.test.ts` | Pas de corbeille de bots (ligne 51). | S |
| 134 | Fiabilité | `doctor` : vérifie service, moteurs, chemins | PARTIEL | Santé (`server/src/health.ts`, `/api/health`), Sentinelle (`server/src/sentinel/`) ; `server/test/sentinel.test.ts`, `monitor.test.ts` | Pas d'écran « tout est-il en place ? » pour l'utilisateur. | S |

### 2.8 Voix, notifications, réglages, accès

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 135 | Voix | Dictée locale (modèle téléchargé **après accord**, taille affichée), texte provisoire, rien n'est envoyé seul | DIFFÉRENT | Dictée serveur (`web/src/lib/dictation.ts`, `server/src/voice/transcribe.ts`) ; `web/scripts/dictation.test.mjs`, `server/test/voice-transcribe.test.ts` | Pas de modèle local dans le navigateur. Rien de grave. | — |
| 136 | Voix | Conversation vocale en temps réel qui confie le travail au bot et lit sa réponse | FAIT | Appels (`server/src/voice/session.ts`, `calls.ts`) ; `server/test/voice-bots.test.ts`, `wave6-voice.test.ts` | — | — |
| 137 | Notifications | Trois sortes : **A besoin de toi** / Alertes / Rapports ; menu de la cloche réglable | PARTIEL | Types de notification et heures calmes (`server/src/push.ts:94-104`) ; `server/test/phone.test.ts` | Pas de cloche avec archive dans l'appli. | S |
| 138 | Notifications | Notifications push par appareil | FAIT | `server/src/push.ts`, `PushPromptBanner.tsx` ; `server/test/phone.test.ts` | — | — |
| 139 | Notifications | **Sons** (réponse finie, accord demandé), son personnalisé | MANQUANT | grep `new Audio` : lecture de voix seulement | Utile quand l'onglet est en arrière-plan. | S |
| 140 | Réglages | **Recherche dans les réglages** (noms, descriptions, mots cachés, sans accents) | FAIT | `SettingsNavigation.tsx:47` ; pas de test | Vérifier les mots cachés et l'insensibilité aux accents. | — |
| 141 | Réglages | Thèmes, verre dépoli, disposition en îlots, widgets, dispositions enregistrées | PARTIEL | Thème clair/sombre (`web/src/store.ts:76`) | Pas de widgets déplaçables. Faible valeur. | L |
| 142 | Réglages | Interface en 11 langues, traduction par PR | PARTIEL | `web/src/i18n/` français + anglais | Déjà noté (COUVERTURE). | M |
| 143 | Réglages | Accès à distance (Tailscale, tunnel SSH, Cloudflare) documenté | DIFFÉRENT | Mode hébergé + VPS (`docs/INSTALLATION-VPS.md`, `MODE-HEBERGE.md`) | — | — |
| 144 | Admin | Plusieurs utilisateurs, groupes, permissions par personne, journal d'activité (offre payante) | PARTIEL | Espaces d'équipe (`server/src/workspaces.ts`) ; `server/test/wave6-workspaces.test.ts` | Déjà noté (COUVERTURE « Équipe »). | L |
| 145 | Admin | Licence payante, contrôle en ligne | NON REPRIS | — | Modèle commercial propre à Timon. | — |
| 146 | Vie privée | Statistiques d'usage **activées par défaut** | NON REPRIS | — | Sklubot n'envoie rien : à garder ainsi. | — |
| 147 | Accès | Telegram comme canal | PARTIEL | `server/src/telegram.ts:71` (texte seulement) | Photos, vocaux, fichiers ignorés (audit Hermes l. 88-89). | M |
| 148 | Accès | CLI complète (`spawn`, `send`, `steer`, `wait`, `status`, `kill`) et API distante | PARTIEL | API bot (`server/src/botapi.ts`, `docs/API-BOT.md`) ; `server/test/bot-api.test.ts` | Pas de « attendre la fin du tour » ni de « redresser le tour » par l'API. Non vérifié en détail. | S |
| 149 | Plugins | Plugins signés installés sans redémarrage, SDK, galerie | NON REPRIS | — | Ouvrir du code tiers dans le serveur hébergé = risque de sécurité entre comptes. | — |
| 150 | Onboarding | Conversation de configuration avec le bot principal, projet de démonstration, visite guidée | FAIT | `Onboarding.tsx`, recruteur (`server/src/agent/recruit.ts`) ; `server/test/recruiter.test.ts` | — | — |

Lignes NON REPRIS non détaillées ci-dessus mais vues : passerelle vers un autre agent distant (Hermes gateway), fournisseurs propres à Timon (Antigravity, Kimi, LLMTR, Pi), éditeur de layouts « îlots » par plugin, mascotte 3D de la marque, programme d'installation `curl | sh`, offre « agence » par e-mail, lecture de la base d'un projet voisin (« video-factory »). Elles ne comptent pas dans le total.

---

## 3. Écarts de comportement (flux par flux)

### 3.1 Premier message à un bot
- **Timon** : on choisit un agent, on écrit ; le tour est un processus CLI (Claude Code, Codex) qui reste vivant après le tour. Le titre de la conversation est écrit à la fin de la 1re réponse (`mission-titles.ts`). Les onglets du haut montrent qui travaille.
- **Sklubot** : un fil unique par bot, la boucle maison (`loop.ts`) ou le moteur CLI dans l'ordinateur du bot (`engine.ts`).
- **Écart** : rien de bloquant. Timon garde **plusieurs conversations** par agent ; Sklubot mélange routines et discussion dans un seul fil (ligne 11). **Correctif** : séparer au moins visuellement les messages des routines (filtre « automatiques ») dans `Transcript.tsx`. S.

### 3.2 Écrire pendant que le bot travaille
- **Timon** : deux gestes explicites (Entrée = redresser maintenant, Ctrl+Entrée = file), placeholder qui rappelle les deux, ligne « tour redirigé », refus nommés (`no_turn_to_steer`, `steer_unsupported`) côté CLI/API.
- **Sklubot** : `loop.ts:369-380` choisit seul (texte glissé si le moteur l'accepte, sinon file). L'utilisateur ne sait pas lequel des deux s'est produit.
- **Correctif** : afficher « pris en compte dans le tour » ou « en file pour la suite » sous le message, et offrir le choix au clavier. S.

### 3.3 Un tour long qui échoue au milieu
- **Timon** (`turn-retry.ts`) : deux couches **jamais mélangées** : les essais du fournisseur (affichés « nouvel essai 2/5 » pendant que le tour continue) puis, s'il abandonne, ceux de Timon : **3 relances du même tour dans la même session**, 30 s / 1 min / 2 min, **seulement sans témoin**. Dans un chat surveillé : bouton Réessayer, jamais de renvoi caché (« un tour rejoué derrière ton dos pourrait envoyer un message deux fois »).
- **Sklubot** : essais avec délai croissant dans l'appel (`reliability.ts:41-48`), puis carte d'échec (`failures.ts`). Pas de délai de garde sur un flux muet (`llm/anthropic.ts`, `openai-compat.ts`), donc un fournisseur qui garde la connexion ouverte bloque le bot sans fin (déjà vu dans l'audit Hermes § 3.7). Une routine qui échoue attend un humain.
- **Correctifs** : (a) délai de garde 180 s ; (b) pour les tours sans témoin, 3 relances espacées avec la consigne « reprends sans refaire » ; (c) ligne « nouvel essai n/N » visible dans le chat. S chacun.

### 3.4 Accords
- **Timon** : carte avec nom lisible + phrase ; portée « session » ou « toujours » limitée à la même commande exacte / le même fichier / le même domaine ; **le contenu du script lancé est montré, avec son empreinte, et la commande est refusée si le fichier change avant le clic** (`script-preview.ts`). Carte sans témoin : compte à rebours visible, puis le bot est prévenu et continue.
- **Sklubot** : cartes une fois / toujours / refuser (`loop.ts:1803,1868`), relecteur IA (`authorize.ts:254`), jamais « toujours » pour un envoi (`irreversible.ts:8`), expiration 25 min (`config.ts:191`).
- **Écart** : sur l'ordinateur personnel (Relais), approuver « lancer script.sh » sans voir son contenu est le même trou que celui que Timon a fermé. **Correctif** : sur les cartes de commande du Relais, montrer les 40 premières lignes et une empreinte ; refuser si l'empreinte change. M. Ajouter un compte à rebours sur les cartes sans témoin. S.

### 3.5 Mémoire apprise puis rappelée
- **Timon** : trois mécanismes — capture des faits (réussites **et** échecs) par un petit modèle ; curateur de nuit qui décide nouveau / fusion / remplacement / rejet, **chaque décision journalisée et réversible** ; promotion **proposée** en règle d'équipe. Et surtout : **retirer une règle force une conversation neuve** chez les bots qui l'ont vue (`memory-session-fence.ts`), sinon l'ancienne règle reste dans l'historique.
- **Sklubot** : consolidation au repos (`memory.ts:137,311-319`), rappel par mots-clés BM25 avant chaque tour, confiance et oubli (`prompt.ts:24-33`), carte en cas de contradiction.
- **Écarts** : (a) une note supprimée par l'utilisateur continue d'agir tant que la conversation la contient (rien ne le signale) ; (b) aucune trace des fusions faites par la consolidation : impossible de revenir dessus. **Correctifs** : après suppression d'une note, proposer « repartir d'une conversation neuve » ou injecter « la note X n'est plus valable » ; journal `memory_audit` avec Annuler. S + M.

### 3.6 Une routine qui se déclenche
- **Timon** : webhook avec filtre, regroupement des rafales, signature, test à blanc, journal ; tâche créée, relancée 3 fois si elle meurt, raison d'interruption système écrite à part.
- **Sklubot** : `/hooks/:token` + limites de débit (`routes.ts:400-420`), routines planifiées avec rattrapage (`scheduler.ts:183-193`).
- **Correctifs** : signature HMAC (S), regroupement par clé (S), « Envoyer un exemple » (S). Ensemble ils évitent qu'un service bavard coûte 5 tours.

### 3.7 Plusieurs bots qui se parlent
- **Timon** (`agent-pair-breaker.ts`) : incident réel de deux agents qui se réveillaient en boucle ; un « STOP » écrit ne marchait pas (toute réponse réveille l'autre). Règle : par **paire non ordonnée**, N messages dans une fenêtre glissante, ensuite messages mis de côté, **lu en base**.
- **Sklubot** : `roombudget.ts` + `MAX_HOPS = 3` dans les salons, **en mémoire vive**.
- **Correctif** : stocker le compteur en base et l'appliquer aussi à la délégation directe bot → bot hors salon. S.

### 3.8 Quota épuisé
- **Timon** (`backend-recheck.ts`) : un refus enregistré « réouverture dans 5 h » n'est **jamais cru** : avant chaque tour, on redemande au fournisseur ou on fait un essai toutes les 2 min.
- **Sklubot** : disjoncteur par fournisseur (`failures.ts`). Durée de mise à l'écart non lue ici.
- **Correctif** : avant de refuser un tour à cause d'un disjoncteur ouvert, tenter un appel d'essai si le dernier date de plus de 2 min. S.

### 3.9 Livraison d'un fichier ou d'une page
- **Timon** : `chat_show_media`, cartes HTML interactives qui **attendent la réponse** (un seul clic réel, jamais deux fois), aperçu Office dans l'appli.
- **Sklubot** : `file_send`, pages et artefacts isolés (`pageroutes.ts:47-48`). Pas d'aperçu Word/Excel/PowerPoint.
- **Correctif** : aperçu Office en texte (M) ; carte-formulaire qui renvoie sa réponse au bot (M).

### 3.10 Nouvel utilisateur
- Les deux ont une conversation d'accueil avec le bot principal. Timon y ajoute « ce que le bot reçoit au démarrage » pour comprendre une dérive, et des bots qui lisent la doc du produit. **Correctif** : outil `docs_read` sur `docs/*.md` de Sklubot (S) et écran « Ce que reçoit ce bot » (M).

### 3.11 Erreur du moteur / fournisseur
- **Timon** : badge « interrompu » avec la cause au survol (quota, crédit, surcharge, refus, tué, silence, plafond de tours, plantage) **dans la liste**, sans ouvrir la conversation (`interruption.ts`).
- **Sklubot** : carte dans le chat (`failures.ts`), page Incidents (`Incidents.tsx`).
- **Correctif** : pastille de cause sur la ligne du bot dans `Sidebar.tsx`. S.

### 3.12 Redémarrage pendant le travail
- **Timon** : le tour est marqué interrompu et **pas rejoué** (il a pu déjà agir) ; l'utilisateur relance.
- **Sklubot** : reprise automatique (`loop.ts:1678-1730`). Plus agréable, mais sûr seulement pour les outils protégés « jamais deux fois » (`executions.ts`). Un clic d'achat dans un site, une publication sur un réseau par le navigateur ne sont pas dans ce registre.
- **Correctif** : à la reprise, injecter « tu as été coupé ; vérifie ce qui est déjà fait avant de refaire une action visible » et marquer la reprise dans le chat. S.

---

## 4. À faire (classé)

1. Délai de garde 180 s sur chaque appel au modèle et **3 relances espacées des tours sans témoin**, avec ligne « nouvel essai n/N » visible. S.
2. ✅ FAIT (L137, `agent/promptview.ts`, `MemoryInsight.tsx` ; morceaux ouvrables, pas encore le lien vers leur source) — Écran **« Ce que reçoit ce bot »** : prompt dans l'ordre, chaque morceau ouvrable à sa source. M.
3. **Corbeille de bots** avec Restaurer (consignes, mémoire, compétences). S.
4. Pilotage du tour : choix Entrée / Ctrl+Entrée, retour « pris dans le tour / en file », **↑ pour rappeler ses messages**, **Répondre à un message**. S.
5. **Jauge de contexte** + bouton Compacter relié à la route existante + « voir le résumé ». S.
6. Note de mémoire supprimée ⇒ conversation neuve proposée (ou consigne d'annulation), et **journal réversible** des fusions de la consolidation. S + M.
7. Carte de commande du Relais qui **montre le script** et refuse s'il change. M.
8. Webhooks : **signature HMAC**, **regroupement des rafales**, **test à blanc** + journal. S chacun.
9. Disjoncteur entre bots **en base**, appliqué aussi hors salons. S.
10. Disjoncteur de quota revérifié avant refus (essai toutes les 2 min). S.
11. **Journal réseau par bot** avec alerte au premier hôte nouveau. M.
12. Pastille de cause d'arrêt sur chaque bot dans la liste. S.
13. À la reprise après redémarrage, consigne « vérifie avant de refaire » + ligne dans le chat. S.
14. Compteur de lectures des compétences (base d'un futur curateur). S.
15. Aperçu Word / Excel / PowerPoint dans la visionneuse. M.
16. Outil `docs_read` sur la documentation de Sklubot. S.
17. Carte-formulaire HTML qui renvoie la réponse au bot. M.
18. Annoter une page dans le navigateur du bot (élément + image + consigne). M.
19. Console et requêtes réseau du navigateur lisibles par le bot. M.
20. Plusieurs comptes nommés par fournisseur, choix du compte par bot. M.
21. « Tout arrêter » qui rend compte de ce qu'il a neutralisé. S.
22. Hiérarchie / « peut déléguer à » entre bots. M.
23. Portées des compétences (tous / section / bot) avec Exclure, et mode « toujours en entier ». M.
24. Dépendances et fichiers joints sur les tâches ; plan de tâches à valider. M.
25. Sons de notification, cloche avec archive. S.
26. Favoris dans le choix de modèle ; modèle retiré affiché grisé. S.
27. Réduction automatique des grandes images avant envoi au modèle. S.
28. Plusieurs conversations par bot avec titres automatiques, filtre « automatiques ». M.
29. Discussions côte à côte. M.
30. ✅ FAIT (L79, 2026-11-23, `agent/planmode.ts` : « /plan », refus de tout changement avant un plan approuvé, « Relire mon plan contre la demande ») — Mode « Plan » (lire et proposer sans agir). S.

---

## 5. Non vérifié

- Portée exacte du bouton « Toujours » de Sklubot (outil entier ou même argument) et existence d'une liste révocable (ligne 66).
- Ce qui se passe à l'expiration d'un accord sans témoin chez Sklubot (refus, attente, consigne au bot ?) (ligne 68).
- Durée du disjoncteur fournisseur de Sklubot et s'il est revérifié (ligne 123).
- Si la consolidation de mémoire lit aussi les tours **ratés** (ligne 82).
- Si `teach.ts` masque les champs mot de passe et produit des étapes relisibles (ligne 36).
- Si le personnage Sklubot change selon l'état du bot (ligne 48).
- Si le compteur de relances du coordinateur d'échecs survit au redémarrage (ligne 104).
- Deuxième vérification des adresses MCP au lancement (ligne 75).
- Google « navigateur non sûr » dans le Chromium du bureau Sklubot (ligne 38).
- Aucun test Sklubot relancé pour cet audit (les tests nommés existent ; `engine-queue`, `failures`, `pause`, `wave10-context` ont été relancés par l'audit OpenClaw du même jour, journaux dans `audit/oc-test-*.log`).
- Le code de Timon n'a pas été exécuté ; ses comportements viennent de sa documentation et des commentaires de ses modules.
