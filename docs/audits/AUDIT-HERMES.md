# Audit complet : Hermes Bot Kit + Hermes Agent, comparés à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.

Dépôts lus :
- **Kit** : `thomasbek3/hermes-bot-kit`, commit `372ebefb` (21/11/2026).
- **Moteur** : `NousResearch/hermes-agent`, commit `88a1c1f4` (22/11/2026). Le kit est une surcouche de ce moteur.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 104 |
| PARTIEL | 34 |
| MANQUANT | 37 |
| DIFFÉRENT | 13 |
| NON REPRIS | 14 |
| Non vérifié (voir § 5) | 5 |
| **Total des lignes du tableau** | **207** |

Sur les 104 « FAIT », environ 45 n'ont **aucun test** qui les exerce (presque tout ce qui est dans l'interface web) : ils sont « faits » d'après la lecture du code, pas prouvés.

Lecture rapide : Sklubot est **en avance** sur le kit pour la fiabilité côté serveur (reprise après redémarrage, modèles de secours, carte « ça a marché ? », garde-boucle, plafonds). Il est **en retard** sur trois points qui se voient tous les jours :
1. le **confort du chat** (pas de modifier / régénérer, pas de bouton Copier sur le code, pas de ligne « NOUVEAU », pas d'anti-double-envoi, aucun test sur le chat web) ;
2. le **coût par tour** (une centaine d'outils et tout le mode d'emploi envoyés à chaque appel, pas de « recherche d'outils ») ;
3. l'**entretien des compétences** (pas de curateur : rien ne compte l'usage, rien n'archive, rien ne verrouille).

---

## 1. Licences

| Dépôt | Licence exacte | Ce qu'elle permet |
|---|---|---|
| hermes-bot-kit | **MIT License**, © 2026 Thomas Bekkers (`LICENSE`) | Copier, modifier, revendre, à condition de garder la mention de copyright et le texte MIT. |
| hermes-bot-kit, sous-parties | `grokbot-override/NOTICE.md` : palette, échelle de texte et calcul des couleurs dérivés de « Rakazo » en **Apache-2.0** ; petits portages de Hermes Agent en MIT ; CSS de mise en page en MIT tiers ; logos de services « Simple Icons » en CC0 ; noVNC 1.7.0 embarqué (MPL-2.0, `computer-viewer/vendor/`) | Apache-2.0 : garder la licence, la NOTICE et dire ce qui a été changé. MPL-2.0 : les fichiers noVNC modifiés doivent rester ouverts. |
| hermes-agent | **MIT License**, © 2025 Nous Research (`LICENSE`) | Comme MIT ci-dessus. |

À ne pas copier : les noms « Grok », « Grok Bot », « Hermes », les captures d'écran, les logos de marque. Le kit dit lui-même qu'il « poursuit la même sensation » que Grok Bot : on reprend les idées, pas l'habillage.

---

## 2. Tableau complet des fonctions

Colonnes : Zone · Fonction (K = kit, H = moteur Hermes) · Statut · Preuve dans Sklubot · Ce qui manque · Taille (S petit, M moyen, L gros).
« pas de test » = aucun test trouvé qui exerce cette fonction. Le chat web n'a **aucun test de composant** (`web/package.json:9` ne lance que `scripts/*.test.mjs` : écoute, dictée, sous-titres, résumé d'appel).

### 2.1 Liste des bots (colonne de gauche)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Liste | K R1 : tous les bots dans une seule liste | FAIT | `web/src/components/Sidebar.tsx:255-270` ; pas de test | — | — |
| 2 | Liste | K R2 : avatar (photo, forme, couleur) | FAIT | `web/src/components/Character.tsx`, `CharacterEditor.tsx` ; pas de test | — | — |
| 3 | Liste | K R3 : nom, rôle, titre | FAIT | `Sidebar.tsx:119-123` | — | — |
| 4 | Liste | K R4 : dernier message et âge | FAIT | `Sidebar.tsx:24-28` (`previewOf`) | — | — |
| 5 | Liste | K R5 : chercher un bot par nom | DIFFÉRENT | Palette ⌘K et recherche globale `Sidebar.tsx:300`, `server/src/search.ts` | Pas de champ de filtre dans la liste elle-même. Rien de perdu avec peu de bots. | S |
| 6 | Liste | K R6 : filtre (bots / groupes, actif maintenant, récent, ancien, par machine) | MANQUANT | — | Aucun filtre d'activité. Utile dès 15 bots. | S |
| 7 | Liste | K R7-R8 : sections nommées, renommer, déplacer, replier | FAIT | `Sidebar.tsx:52-62`, `server/src/sectionroutes.ts` ; pas de test web | — | — |
| 8 | Liste | K R10-R11 : épingler, masquer, section « Masqués » | FAIT | `Sidebar.tsx:69,80,264-269` | Le kit montre les 4 épinglés en gros avatars en haut : pas repris (choix d'habillage). | — |
| 9 | Liste | K R12 : menu clic droit (ouvrir, nouveau chat, modifier, dupliquer, supprimer) | FAIT | `Sidebar.tsx:39-80`, `server/src/routes.ts:720` (dupliquer) | — | — |
| 10 | Liste | K R12/C26 : deux chats côte à côte | MANQUANT | — (`WorkspaceDock` ne montre que les pages/outils, `App.tsx:152`) | Impossible de suivre deux bots en même temps. | M |
| 11 | Liste | K R13 : créer un bot (nom, rôle, avatar, modèle) avec message d'accueil | FAIT | `web/src/components/Modals.tsx`, `server/src/routes.ts` (`POST /bots`), `server/test/team-templates.test.ts` | — | — |
| 12 | Liste | K R13 : photo d'avatar importée ou générée par IA | PARTIEL | Personnage dessiné (`CharacterEditor.tsx`) | Pas d'import de photo ni de génération d'avatar. | S |
| 13 | Liste | K R15 : pastille « a besoin de toi » (connexion, quota, config) | FAIT | `Sidebar.tsx:15-18` (`attention`), `server/src/agent/failures.ts:342` ; `server/test/failures.test.ts` (16/16 passés) | — | — |
| 14 | Liste | K R16 : point non lu, indicateur « travaille » | FAIT | `Sidebar.tsx:15-18,74`, routes `/bots/:id/read` et `/unread` | — | — |
| 15 | Liste | K R17 : bulle d'alerte « nouveau message de… » | FAIT | `web/src/lib/notify.ts:67`, `server/src/push.ts` | — | — |
| 16 | Liste | K R18 : réveil du bot au survol de sa ligne | NON REPRIS | — | Utile seulement quand chaque bot est un processus à démarrer (Hermes). Chez Sklubot le serveur est toujours là. | — |
| 17 | Liste | K R9 : bots sur plusieurs machines, bandeau « injoignable » + Réessayer | NON REPRIS | — | Sklubot a un seul serveur ; pas de bots répartis sur plusieurs passerelles. | — |

### 2.2 Le chat (colonne centrale)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 18 | Chat | K C1-C3 : un seul fil permanent par bot | FAIT | `server/src/store.ts` (`rows`, `generation`), `server/test/app.test.ts` | — | — |
| 19 | Chat | K C4 : charger l'historique, y compris la partie résumée | FAIT | `web/src/store.ts:527` (`loadEarlier`), `HistoryViewer.tsx` | — | — |
| 20 | Chat | K C5 : « Voir les messages précédents » sans perdre sa place | PARTIEL | `Transcript.tsx:934-938,962-966` | Sklubot retient une **distance en pixels** depuis le bas. Si une image ou une carte change de hauteur pendant le chargement, la vue saute. Le kit retient **le message visible** et le retrouve. | S |
| 21 | Chat | K : rester en bas pendant que images / cartes / code prennent leur taille | FAIT | `Transcript.tsx:944-952` (ResizeObserver) ; pas de test | — | — |
| 22 | Chat | K : bouton rond « aller au dernier message » | FAIT | `Transcript.tsx:955-960` (`showJump`) ; pas de test | — | — |
| 23 | Chat | K : ligne rouge « NOUVEAU » au-dessus du premier message non lu | MANQUANT | grep `firstUnread|lastRead|newLine` : rien dans `web/src` | En rouvrant un chat après une longue tâche, on ne voit pas où reprendre la lecture. | S |
| 24 | Chat | K C6 : **ne jamais envoyer deux fois** (numéro d'envoi, relecture de l'historique si la réponse est perdue) | MANQUANT | `Composer.tsx:164-183` + `server/src/routes.ts:821-861` : aucun identifiant d'envoi | Si la réponse HTTP se perd après l'enregistrement, le texte reste dans la zone de saisie avec une erreur. L'utilisateur renvoie : **message en double et deux tours du bot**. | S |
| 25 | Chat | K C7 : réponse affichée au fil de l'eau | FAIT | `server/src/agent/loop.ts:1223` (`StreamingRow`), `web/src/events.ts` | — | — |
| 26 | Chat | K C7 : mise en forme propre **pendant** la frappe (un `**` ou un tableau à moitié écrit attend) | MANQUANT | `web/src/lib/markdown.ts:15-27` : `marked` relancé sur le texte brut à chaque morceau | Pendant la frappe on voit des `**`, des `|` et des blocs de code à moitié ouverts qui clignotent. | M |
| 27 | Chat | K C8 : arrêter un tour | FAIT | `Composer.tsx:185-193`, `loop.ts:391` (`interrupt`) | — | — |
| 28 | Chat | K C9 : écrire pendant que le bot travaille (file d'attente, ou message glissé dans le tour) | FAIT | `loop.ts:369-380,398` (`steering`), `Transcript.tsx:870,1026` (« N en attente ») ; `server/test/engine-queue.test.ts` | — | — |
| 29 | Chat | K C10 : cartes d'accord (une fois / toujours / refuser) | FAIT | `loop.ts:1803` (`waitForApproval`), `loop.ts:1868` (`decideApproval`) ; `server/test/security.test.ts`, `wave5.test.ts` | — | — |
| 30 | Chat | K C11 / H `clarify` : carte de question | PARTIEL | `server/src/agent/tools.ts:1205-1211` (`ask_user`, 6 choix) ; `server/test/ask-wait.test.ts` | **Une seule question** à la fois, pas de choix multiple, pas de « recommandé », pas de Suivant / Retour / Passer. Et `ask_user` **termine le tour** : la réponse revient comme nouveau message, pas comme résultat d'outil. Hermes : 1 à 5 questions, choix multiple, la réponse revient dans le même tour. | M |
| 31 | Chat | K C11 : saisie masquée d'un mot de passe ou d'une clé dans le chat | FAIT | carte secret `routes.ts` (`/cards/:seq/secret`), `server/src/pastedsecrets.ts` ; `server/test/security-fixes.test.ts` | — | — |
| 32 | Chat | K C12 : étapes de travail cachées par défaut, repliées en « A travaillé N min » | FAIT | `Transcript.tsx:58-96` (`planWork`) | Pas de réglage global « toujours montrer les étapes ». | S |
| 33 | Chat | K C13 : détail d'une étape (arguments, résultat, différences, image) | PARTIEL | ligne `step` avec `args` et `summary` (`server/src/shared.ts:311`) | Le **résultat complet** de l'outil et le diff coloré ne sont pas affichés dans le chat (carte « Fichiers modifiés » à part). | S |
| 34 | Chat | K C14 : réflexion du modèle repliée | FAIT | `loop.ts:1205` (`Caption`) | — | — |
| 35 | Chat | K C15 : bloc de code avec bouton **Copier** et repli des longs blocs | MANQUANT | `markdown.ts` : aucun bouton ; grep `copy` dans `Transcript.tsx` et `markdown.ts` : rien | Il faut sélectionner le code à la souris. Gêne quotidienne. | S |
| 36 | Chat | K C15 : image d'un autre site non chargée sans clic | FAIT | `markdown.ts:36-55` (`remoteImagesAsLinks`) + CSP `server/src/hardening.ts:61` | — | — |
| 37 | Chat | K C15 : lecteur audio / vidéo dans le chat | FAIT | `web/src/components/MediaVideo.tsx`, `ListenControls.tsx` | — | — |
| 38 | Chat | K C16 : ligne d'état (« je résume… ») | FAIT | `loop.ts:1133` | — | — |
| 39 | Chat | K C17 : tour raté = **une** carte, « Réessayer » une fois, puis « nouveau chat » | FAIT | `failures.ts:132-166,342` (remèdes, anti-tempête 10 min) ; `server/test/failures.test.ts` | Mieux que le kit (coéquipier de secours, disjoncteur par fournisseur). | — |
| 40 | Chat | K C19 : commandes `/` (`/compress`, `/new`, `/retry`, `/undo`, compétences) | PARTIEL | `/skill` (`routes.ts:868`), `/objectif` (`routes.ts:847`), Telegram `/taches /etat /stop /usage /memoire` (`telegram.ts:104`) | Pas de `/compresser`, `/modele`, `/reessayer` dans le chat web ; pas de liste des commandes en tapant `/`. | S |
| 41 | Chat | K C20 : @mention d'un autre bot avec complétion | FAIT | `web/src/components/ComposerMentions.tsx`, `server/src/agent/team.ts` ; `server/test/room-routing.test.ts` | — | — |
| 42 | Chat | K C21 : choisir le modèle du bot (fournisseur, modèle, effort) | FAIT | `web/src/components/BotSettings.tsx:31-54`, `Brain.tsx` ; `server/test/openrouter.test.ts` | — | — |
| 43 | Chat | K C21 : réglage « Vitesse » (standard / rapide) grisé si le modèle ne le permet pas | MANQUANT | — | Niveau de service rapide non proposé. Peu demandé. | S |
| 44 | Chat | K C22 : **modifier** un message envoyé, **régénérer** une réponse, revenir en arrière | MANQUANT | grep `regenerate|rewind|editMessage` : rien (seul « Annuler » des fichiers et des réglages existe, `routes.ts:906`) | Une faute de frappe ou une mauvaise réponse oblige à réécrire tout le message. C'est la plus grosse absence du chat. | M |
| 45 | Chat | K C23 : réactions sous les messages | FAIT | `routes.ts` (`/rows/:seq/reactions`), `tools.ts:511` (`message_react`) | — | — |
| 46 | Chat | K C24 : copier un message | FAIT | `web/src/components/ui.tsx:417` | — | — |
| 47 | Chat | K C25 / H : jauge de contexte et de coût du chat ouvert | PARTIEL | Coût : `server/src/usage.ts`, `/usage` | Aucune jauge « contexte rempli à X % » : l'utilisateur ne voit pas venir le résumé automatique. | S |
| 48 | Chat | K C27 : rafraîchir le chat ouvert quand autre chose écrit dedans (routine, autre appareil) | FAIT | flux `/events` (`server/src/bus.ts`) | — | — |
| 49 | Chat | K C28 : pièces jointes (images, PDF, fichiers) | FAIT | `server/src/uploads.ts`, `uploadparts.ts` ; `server/test/large-attachments.test.ts` | — | — |
| 50 | Chat | K C28 : après un refus, texte **et pièces jointes** reviennent dans la zone de saisie | FAIT | `Composer.tsx:175-178` (rien n'est vidé en cas d'erreur) | — | — |
| 51 | Chat | K C29 : dictée au micro, jamais envoyée toute seule | FAIT | `Composer.tsx:118`, `web/src/lib/dictation.ts` ; `web/scripts/dictation.test.mjs` | — | — |
| 52 | Chat | K C30 : accueil d'un chat vide | FAIT | `Transcript.tsx:883-889` + idées de première tâche | — | — |
| 53 | Chat | K C31 : notification système (réponse finie, accord attendu), texte neutre | FAIT | `web/src/lib/notify.ts`, `server/src/push.ts` ; `server/test/phone.test.ts` | — | — |
| 54 | Chat | K T8 : brouillon gardé par bot | PARTIEL | `web/src/store.ts:217,1048` | En mémoire seulement : perdu au rechargement de la page (le kit aussi). Les fichiers joints sont gardés, mieux que le kit. | S |
| 55 | Chat | K : réponse volontairement vide (`[SILENT]`) : aucune bulle, aucun point non lu | FAIT | `tools.ts:1279` (`stay_quiet`), `loop.ts:1086-1091` | — | — |
| 56 | Chat | K : **liens vers la source** dessinés en pastille (logo Slack, Gmail, GitHub… + 2 ou 3 mots), jamais l'adresse brute | MANQUANT | grep `sourceLink|brandIcon|favicon` : rien | Les réponses montrent des adresses longues. Aucune consigne au bot de finir une ligne par `[Son message](lien exact)`. | M |
| 57 | Chat | K : fichier envoyé = carte (icône par type, nom, taille, télécharger) | FAIT | `Transcript.tsx:270`, `tools.ts:356` (`file_send`) | — | — |
| 58 | Chat | K : visionneuse : tableur (xlsx, ods) en grille avec onglets, sélection et copie de cellules | PARTIEL | `SpendSkillsFiles.tsx:341-368` : images, PDF, texte, Markdown, CSV (50 lignes) | Pas de xlsx / xls / ods, pas d'onglets, pas de copie de cellules, CSV coupé à 50 lignes. | M |
| 59 | Chat | K : long texte à copier (cahier des charges, prompt) envoyé en fichier `.md` plutôt qu'en bloc géant | PARTIEL | `file_save` + `file_send` existent | Aucune consigne dans `prompt.ts` ni dans les compétences : le bot colle le pavé dans le chat. | S |
| 60 | Chat | K : carte de **tâche longue** mise à jour sur place (en cours, fini, erreur, bouton Stop) | FAIT | `server/src/agent/bgtasks.ts:54-106`, `tools.ts` (`progress_update`) ; `server/test/wave9.test.ts` | — | — |
| 61 | Chat | K : `::preview` : petite page HTML dans un cadre sans réseau | FAIT | `server/src/pageroutes.ts:47-48` (bac à sable + CSP), `PagePreview.tsx:53` ; `server/test/pages-artifacts.test.ts` | — | — |
| 62 | Chat | K : message envoyé par une page intégrée : confirmé par l'utilisateur sauf clic direct | NON VÉRIFIÉ → voir § 5 | — | — | — |
| 63 | Chat | K : fils de discussion sous un message | FAIT (en plus du kit) | `web/src/components/ThreadPanel.tsx` | — | — |
| 64 | Chat | K : thème clair / sombre | FAIT | `web/src/store.ts:76` | — | — |
| 65 | Chat | K : bulles à la couleur du bot | DIFFÉRENT | Couleur d'avatar par bot (`BotSettings.tsx:51`) | Habillage propre à Sklubot. Rien de perdu. | — |

### 2.3 Fiche du bot (colonne de droite)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 66 | Fiche | K P1-P3 : routines du bot : lister, créer, modifier, lancer, mettre en pause, supprimer, historique | FAIT | `server/src/routines.ts:143`, routes `/routines/:id/run`, `/runs` ; `server/test/features.test.ts` | — | — |
| 67 | Fiche | K P4 : écran du bot en direct, prendre la main / rendre la main | FAIT | `server/src/takeover.ts`, `web/src/components/ComputerViewer.tsx:160-180` ; `server/test/wave7-linux.test.ts`, `shared-computers.test.ts` | — | — |
| 68 | Fiche | K P6 : compétences, familles d'outils, applis (MCP), consignes, modèle | FAIT | `BotSettings.tsx:54`, `SkillsLibrary.tsx`, `NativeApps.tsx` | — | — |
| 69 | Fiche | K : carte Slack avec « Tester la connexion » (demande à Slack, signale une permission manquante) | PARTIEL | Santé des connexions : `server/src/health.ts`, `/health/credentials/check` | Slack n'est pas un canal de discussion chez Sklubot (voir ligne 92). | — |
| 70 | Fiche | K : groupes du bot listés dans sa fiche | FAIT | `server/src/agent/prompt.ts:205` + `/rooms` | — | — |

### 2.4 Ordinateur du bot et visionneuse

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 71 | Ordinateur | H Bot Screen : un bureau Linux par bot, diffusé en direct | FAIT | `server/src/linux.ts`, `vnc.ts`, `docker/desktop/` ; `server/test/linux.test.ts`, `wave10-linux.test.ts` | — | — |
| 72 | Ordinateur | K : la vue **s'ouvre toute seule** dès que le bot utilise son écran ou son navigateur (1 réveil max par 30 s, jamais sur de l'historique rejoué) | MANQUANT | `openViewer(` n'est appelé que sur clic (`ChatView.tsx:83`, `DetailsPanel.tsx:316-353`) | Le bot ouvre le lien « sur son écran pour que tu regardes » (`prompt.ts:58`), mais **rien ne montre l'écran** : l'utilisateur doit penser à ouvrir le panneau. | S |
| 73 | Ordinateur | K : reconnexion automatique du flux (1, 2, 4, 8, 15 s, 5 essais, puis « Injoignable » + bouton) | PARTIEL | Petit panneau : `DetailsPanel.tsx:324-329` (reconnecte, sans délai ni limite). **Grande vue : bogue** `ComputerViewer.tsx:396` : si le flux tombe après avoir marché, `liveUp` passe à faux et rien ne relance → sablier « connexion… » sans fin. | Délai croissant, limite d'essais, message clair et bouton Reconnecter dans les deux vues. | S |
| 74 | Ordinateur | K : erreurs distinctes (mot de passe refusé ≠ injoignable ≠ jeton expiré) | PARTIEL | Repli sur captures d'écran (`ComputerViewer.tsx:157-162`) | Pas de message disant pourquoi le direct a échoué. | S |
| 75 | Ordinateur | K : règles de sûreté de la prise en main (entrée coupée dès « Rendre la main », réponse tardive ignorée, bail numéroté) | PARTIEL | Bail renouvelé toutes les 30 s (`ComputerViewer.tsx:172-178`), le bot est prévenu au retour (`loop.ts:388,649`) | Pas de numéro d'époque : un « rendre la main » perdu sur le réseau laisse le bot bloqué jusqu'à expiration du bail. Non testé avec coupure réseau. | S |
| 76 | Ordinateur | K : le bot **demande** la main à l'humain (CAPTCHA, code) | FAIT | `tools.ts:1221` (`ask_takeover`), `routes.ts` (`/takeover/:id/done`) | — | — |
| 77 | Ordinateur | K : coller le presse-papiers, Ctrl+Alt+Suppr, capture d'écran, Ajuster / Taille réelle | MANQUANT | grep `clipboard|sendCtrlAltDel|toBlob` dans `LiveScreen.tsx`, `ComputerViewer.tsx`, `ScreenFrame.tsx` : rien | Impossible de coller un texte long (mot de passe, adresse) dans l'écran du bot. | S |
| 78 | Ordinateur | K : mode HD (H.264 matériel) par-dessus VNC | NON REPRIS | — | Utile pour un Mac ou un PC distant ; les bureaux Sklubot tournent sur le même serveur. | — |
| 79 | Ordinateur | K : voir et piloter un Mac / PC / Linux personnel (scripts `connect-*.sh`) | DIFFÉRENT | « Sklubot Relais » : `server/src/relay.ts`, `server/src/agent/mycomputer.ts`, `companion/` ; `server/test/relay.test.ts` | L'app Relais demande l'accord sur l'ordinateur lui-même : plus sûr. Pas de vue VNC continue du poste. | — |
| 80 | Ordinateur | K remote-cua : le bot pilote un **Mac distant** par SSH | NON REPRIS | — | Dépend d'un pilote signé tiers et d'internes Hermes verrouillés à une version. Relais couvre le besoin. | — |
| 81 | Ordinateur | K : choisir quel ordinateur va avec quel bot, bascule entre machines | PARTIEL | Ordinateurs partagés : `server/src/sharedcomputers.ts` | Pas de sélecteur « toutes mes machines » dans la visionneuse. | S |
| 82 | Ordinateur | K : réveiller un écran endormi à l'ouverture | FAIT | `server/src/computer.ts:293`, route `/desktop/wake` | — | — |
| 83 | Ordinateur | H : coffre de connexions (« connecte-toi à GitHub »), saisie masquée, codes à 2 facteurs | FAIT | `server/src/agent/tools.ts` (`vault_type`, `totp_code`), `server/src/totp.ts` ; `server/test/totp.test.ts`, `wave7.test.ts` | — | — |
| 84 | Ordinateur | H : navigateur par références d'éléments plutôt que par pixels | FAIT | `server/src/agent/elements.ts`, `screen-elements.ts` ; `server/test/elements.test.ts` | — | — |
| 85 | Ordinateur | H : navigateur dans le nuage (Browserbase, Browser Use) | NON REPRIS | — | Fournisseur payant ; le bureau du bot suffit. | — |
| 86 | Ordinateur | H : payer et remplir une adresse depuis le coffre | FAIT | `server/src/agent/payments.ts`, `tools.ts` (`card_fill`) ; `server/test/wave7.test.ts` | — | — |

### 2.5 Canaux (où parler au bot)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 87 | Canaux | H Telegram : texte | FAIT | `server/src/telegram.ts:54-63,108-135` ; `server/test/wave3.test.ts` | — | — |
| 88 | Canaux | H Telegram : **photos, vocaux, fichiers reçus** | MANQUANT | `telegram.ts:70-74` : le type `Update` ne lit que `text` | Une photo ou un vocal envoyé au bot sur Telegram est **ignoré sans un mot**. | M |
| 89 | Canaux | H « mode livrable » : le bot **envoie** ses fichiers et images dans le canal | MANQUANT | `telegram.ts:54-63` : `sendMessage` seulement | Un fichier créé par le bot n'arrive jamais sur Telegram. | S |
| 90 | Canaux | H Telegram : mise en forme, message modifié au fil de l'eau, « écrit… » | MANQUANT | `telegram.ts:58` : texte brut, coupé tous les 4000 caractères | Les réponses arrivent avec des `**` et des `#` visibles. | S |
| 91 | Canaux | H Telegram : accords par réaction ou réponse | FAIT | `telegram.ts:40-50,66` (réaction = accord ; paiements et coffre jamais par téléphone) | — | — |
| 92 | Canaux | K + H **Slack** comme canal (messages privés, @mentions, 👀 pendant le travail, liste des personnes autorisées) | MANQUANT | Slack n'est qu'une appli lue par le bot (`server/src/native/vendors.ts:14-15`) | API officielle Slack (mode Socket) : c'est le canal de travail le plus demandé en entreprise. | L |
| 93 | Canaux | K « Ajouter à Slack » en un clic (relais HTTPS public, jeton de configuration) | NON REPRIS | — | Demande une adresse publique et un relais maison ; le mode Socket suffit pour commencer. | — |
| 94 | Canaux | H Discord, Mattermost, Matrix, Teams, Google Chat, e-mail, SMS | PARTIEL | E-mail : `server/src/botmail.ts` (`server/test/wave6-mail.test.ts`) | Les autres canaux officiels manquent. À faire à la demande. | L |
| 95 | Canaux | H WhatsApp (client QR non officiel), Signal, WeChat perso, iMessage (BlueBubbles) | NON REPRIS | `telegram.ts:21-22` l'explique déjà | API non officielles de comptes personnels : risque de bannissement. | — |
| 96 | Canaux | H WhatsApp Cloud (API officielle Meta) | NON REPRIS | — | Compte Meta Business payant et messages à gabarit. | — |
| 97 | Canaux | H webhooks entrants avec **signature HMAC** vérifiée, filtres, gabarit de message | PARTIEL | `server/src/routes.ts:400-420` : jeton dans l'adresse + limites de débit | Pas de vérification de signature (GitHub, Stripe signent leurs appels) : quiconque connaît l'adresse déclenche le bot. | S |
| 98 | Canaux | H webhooks sortants / crochets d'événements | MANQUANT | — | Impossible de prévenir un autre système quand un bot finit. | M |
| 99 | Canaux | H serveur compatible OpenAI (brancher Open WebUI, etc.) | DIFFÉRENT | API propre : `server/src/botapi.ts`, MCP : `botmcp.ts`, `teammcp.ts` ; `server/test/bot-api.test.ts`, `team-mcp.test.ts` | Pas de format `/v1/chat/completions` : les interfaces tierces ne se branchent pas. | M |
| 100 | Canaux | H intégration éditeur de code (ACP) | NON REPRIS | — | Hors du public visé (non-développeurs). | — |
| 101 | Canaux | H A2A (bots d'autres systèmes) | NON REPRIS | — | Pas de besoin identifié. | — |

### 2.6 Mémoire

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 102 | Mémoire | H : mémoire **bornée** (2 200 caractères pour le bot, 1 375 pour le profil), l'outil refuse quand c'est plein et dit quoi retirer | DIFFÉRENT | Notes sans limite en base ; choix par tour dans un budget de 4 000 caractères (`prompt.ts:17-45`, `config.ts:174`) ; `server/test/memory-guard.test.ts` | Sklubot garde tout et **choisit par mots communs**. Risque : une note utile sans mot commun avec le message du jour n'est pas montrée. Le bot ne voit jamais « mémoire pleine à 67 % ». | — |
| 103 | Mémoire | H : la mémoire apparaît dans le prompt avec son taux de remplissage | MANQUANT | `prompt.ts:219-221` : liste + « N anciennes notes non montrées » | Ajouter « X notes, Y montrées » ne suffit pas à pousser le bot à fusionner. | S |
| 104 | Mémoire | H : modifier une note par petit morceau (`patch`), pas d'écrasement | NON VÉRIFIÉ → § 5 | `tools.ts:862` (`memory_save`) | — | — |
| 105 | Mémoire | H : notes analysées avant d'être gardées (injection, secrets, caractères invisibles) | FAIT | `server/src/agent/sensitive.ts:68-71` (`memoryVerdict`), `memory.ts:10` ; `server/test/memory-guard.test.ts` | — | — |
| 106 | Mémoire | H : profil de l'utilisateur à part | FAIT | `prompt.ts:187-192`, `tools.ts` (`profile_update`) | — | — |
| 107 | Mémoire | H : recherche dans les anciennes conversations | FAIT | `tools.ts:743` (`conversation_search`), `server/src/search.ts` | — | — |
| 108 | Mémoire | H : revue en arrière-plan après un tour (« qu'ai-je appris ? »), sur un modèle moins cher | FAIT | `memory.ts:137` (`consolidate`), `config.ts:175` (`AUX_MODEL`) | — | — |
| 109 | Mémoire | H : accord demandé avant d'écrire en mémoire (`write_approval`) | PARTIEL | Carte en cas de contradiction (`shared.ts:401`, `memory.ts:182`) | Pas de mode « demande-moi avant chaque note ». | S |
| 110 | Mémoire | H : confiance d'une note (confirmée / vue une fois / contestée), oubli des notes vieilles | FAIT (en plus de Hermes) | `prompt.ts:24-33` | — | — |
| 111 | Mémoire | H : mémoire externe (Honcho, Mem0…) | NON REPRIS | — | Services tiers payants, données envoyées dehors. | — |
| 112 | Mémoire | H : export / import de la mémoire | FAIT | routes `/bots/:id/memories/export` et `/import` | — | — |

### 2.7 Compétences (skills)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 113 | Compétences | H : compétences lues à la demande (liste courte dans le prompt, texte complet sur lecture) | FAIT | `prompt.ts:223-231` (texte complet si ≤ 6 000 caractères au total, sinon liste + `skill_read`) | — | — |
| 114 | Compétences | H : le bot propose de garder une procédure, l'utilisateur relit | FAIT | `tools.ts:785` (`skill_propose`), brouillons : `migrations/009-skill-drafts.ts` ; `server/test/work-methods.test.ts` | — | — |
| 115 | Compétences | H **curateur** : compter les usages, passer en « ancienne » à 14 jours, archiver à 30 jours, jamais une compétence épinglée ou utilisée par une routine | MANQUANT | Table `skills` : `id, name, description, body, created_at, updated_at, draft` (`migrations/001-baseline.ts:62-65`) : **aucun compteur d'usage** | Les compétences apprises s'empilent pour toujours. La liste dans le prompt grossit, sans limite pour les compétences du bot (`prompt.ts:227`). | M |
| 116 | Compétences | H curateur : fusion des doublons par un modèle, rapport, essai à blanc | MANQUANT | — | Va avec la ligne 115. | M |
| 117 | Compétences | H : épingler (jamais supprimée) et **verrouiller** (le bot ne peut plus la modifier) | MANQUANT | grep `locked|pinned` dans `skillsroutes.ts`, `skillstypes.ts` : rien | Un bot peut réécrire avec `skill_save` une compétence que tu as soignée. | S |
| 118 | Compétences | H : sauvegarde avant modification, journal, retour en arrière d'une seule modification | MANQUANT | `store.ts:581` (`update` écrase) | Aucune version précédente d'une compétence. | S |
| 119 | Compétences | H : analyse de sécurité à l'installation, niveaux de confiance | FAIT | `server/src/skillscan.ts:223` ; `server/test/skill-scan.test.ts` | — | — |
| 120 | Compétences | H : installer depuis GitHub, une adresse, un catalogue | PARTIEL | `server/src/skillsgithub.ts`, bibliothèque locale `skillslibrary.ts` ; `server/test/skills-library.test.ts` (7/7 passés) | Pas de catalogue en ligne ni de mise à jour d'une compétence installée. | M |
| 121 | Compétences | H : compétence forcée par commande (`/nom`), plusieurs à la fois | PARTIEL | `routes.ts:868-877` (`/skill nom`) | Une seule à la fois. | S |
| 122 | Compétences | H : compétences partagées entre bots | FAIT | `prompt.ts:233-236`, `store.ts:590` | — | — |
| 123 | Compétences | H : compétence limitée à un canal ou une plateforme | MANQUANT | — | Voir ligne 139 (réponses courtes seulement dans le chat). | S |
| 124 | Compétences | H : apprendre une compétence depuis un dossier, une page ou un livre (`/learn`) | PARTIEL | « Montre-moi » : `server/src/teach.ts` | Pas d'apprentissage depuis une documentation. | M |

### 2.8 Routines et automatismes

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 125 | Routines | H : planifié, une fois, fuseau horaire par routine | FAIT | `server/src/routines.ts:32-44,106`, `cron.ts` ; `server/test/features.test.ts` | — | — |
| 126 | Routines | H : rattrapage après un arrêt du serveur (une seule fois, dernière journée) | FAIT | `server/src/scheduler.ts:183-193,121-131` | — | — |
| 127 | Routines | H : déclenchée par un événement (webhook, nouveau mail, fichier ou page qui change) | FAIT | `scheduler.ts:153-154,164`, `routes.ts:400` | — | — |
| 128 | Routines | H : modèle propre à une routine (moins cher), verrouillable | MANQUANT | `routines.ts` : pas de champ modèle | Une veille quotidienne tourne sur le modèle cher du bot. | S |
| 129 | Routines | H : **mode sans IA** (un script planifié, sa sortie livrée telle quelle, 0 jeton) | MANQUANT | — | Les vérifications simples coûtent un tour de modèle à chaque fois. | M |
| 130 | Routines | H : enchaîner des routines (`context_from` : la sortie de l'une nourrit l'autre) | MANQUANT | — | — | S |
| 131 | Routines | H : arrêter une exécution en cours sans toucher au planning | FAIT | `routes.ts` (`/bots/:id/stop`), pause : `server/src/pauses.ts` ; `server/test/pause.test.ts` | — | — |
| 132 | Routines | H : erreur de la dernière exécution et « passage manqué » visibles | FAIT | `/routines/:id/runs`, `failures.ts` (journal par bot) | — | — |
| 133 | Routines | H : compétences attachées à une routine | PARTIEL | Les compétences du bot s'appliquent | Pas de liste par routine. | S |
| 134 | Routines | H : livrer le résultat ailleurs (autre canal, fichier) | PARTIEL | Chat du bot, Telegram, notification | Pas de choix de destination par routine. | S |
| 135 | Routines | H `/goal` : objectif tenu sur plusieurs tours, juge automatique, plafond de tours | FAIT | `server/src/agent/goals.ts:16-44`, `routes.ts:847-857` ; `server/test/spec06.test.ts` (non relancé) | Chez Hermes un **juge séparé** décide si c'est fini ; chez Sklubot le bot se déclare fini lui-même, avec preuve. | S |
| 136 | Routines | H `/heartbeat` et `/loop` : refaire une consigne toutes les N minutes dans la même conversation | DIFFÉRENT | Points réguliers : `scheduler.ts:197` (`fireCheckin`), `server/src/agent/nudges.ts` | Pas de « revérifie ça toutes les 10 minutes jusqu'à ce que ce soit vert » lancé depuis le chat ; il faut créer une routine. | S |
| 137 | Routines | H : tableau de tâches partagé entre bots (Kanban), reprises, disjoncteur | PARTIEL | `web/src/components/TasksView.tsx`, `tools.ts` (`task_add`) | Suivi simple ; pas de colonnes, de dépendances ni de reprise automatique d'une carte. | L |
| 138 | Routines | H : traitement par lots (des centaines de prompts) | NON REPRIS | — | Outil de recherche, hors usage. | — |

### 2.9 Style des réponses et consignes (les compétences du kit)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 139 | Style | K texting-style : réponses courtes **automatiques dans le chat seulement**, longues ailleurs, réglable par canal | PARTIEL | `server/skills-library/conversation-courte/SKILL.md` (à ajouter bot par bot) + `prompt.ts:178-184` | C'est une compétence à choisir, pas un réglage : pas d'interrupteur par bot, pas de filtre par canal, pas de règle « 25 mots, une seule question, jamais de titres ». | S |
| 140 | Style | K agent-cards : quand montrer une carte (choix → question ; envoi / paiement → accord ; plus d'une minute → tâche) | FAIT | `server/skills-library/cartes-de-suivi/SKILL.md`, `prompt.ts:163,170` | — | — |
| 141 | Style | K email-drafts : le bot n'envoie jamais, il prépare | PARTIEL | `server/skills-library/brouillon-email/SKILL.md`, `server/src/native/tools.ts:244-262` | Voir lignes 142-146. | — |

### 2.10 E-mails à relire (module email-drafts du kit)

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 142 | E-mail | K : carte de brouillon **dans le chat** (À, Cc et texte modifiables, signature, pièces jointes, Envoyer / Abandonner) | DIFFÉRENT | Brouillon créé **dans Gmail / Outlook** (`native/tools.ts:244`) ; envoi direct par `mail_send` avec carte d'accord (`native/tools.ts:266`) | L'utilisateur doit quitter Sklubot pour relire et corriger. Avec `mail_send`, il dit oui ou non mais ne peut pas corriger une virgule. | M |
| 143 | E-mail | K : `email_draft_update` : corriger le brouillon existant | MANQUANT | Aucun outil de mise à jour. Or la compétence dit « évite de créer une autre copie » (`brouillon-email/SKILL.md`) : **consigne impossible à suivre** | Chaque correction crée un nouveau brouillon dans la boîte. | S |
| 144 | E-mail | K : pièces jointes, Cci, signature de l'utilisateur | MANQUANT | `native/tools.ts:246` : `to, cc, subject, body, reply_to_id` seulement | Pas de pièce jointe ni de Cci dans un brouillon ou un envoi. | M |
| 145 | E-mail | K : règle « destinataire autorisé » posée depuis la carte (envoi sans attendre pour ces adresses) | PARTIEL | Règles en mots + relecteur (`server/src/rules.ts`, `server/src/agent/authorize.ts:254`), « Toujours » sur une carte | Pas de liste d'adresses autorisées visible et modifiable. « Toujours » ne vaut pas pour les envois (`irreversible.ts:8`) : c'est plus prudent, mais ça lasse sur les envois répétés. | S |
| 146 | E-mail | K : **jamais deux fois** : en attente → envoi → envoyé ; « Livraison inconnue : vérifie tes Envoyés », sans bouton Réessayer | FAIT | `server/src/agent/executions.ts:15,30,75` (état « incertain »), `loop.ts:1581` ; `server/test/security-review.test.ts` | — | — |
| 147 | E-mail | K : journal de qui a approuvé quoi (jamais le texte du mail) | FAIT | `server/src/journal.ts`, `store.ts:880` (`audit`) | — | — |

### 2.11 Modèles, coût, contexte

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 148 | Modèles | H : modèle de secours automatique, par bot ou par compte | FAIT | `server/src/agent/reliability.ts:18-26`, `loop.ts:1017-1027` ; `server/test/failures.test.ts`, `codex-retry.test.ts` | — | — |
| 149 | Modèles | H : nouveaux essais avec délai croissant et respect de « Retry-After » | FAIT | `reliability.ts:41-48`, `loop.ts:1010-1016` | — | — |
| 150 | Modèles | H : **délai de garde sur l'appel au modèle** (flux muet 180 s → coupé et relancé ; 3 coupures → abandon) | MANQUANT | `server/src/llm/anthropic.ts:128`, `openai-compat.ts:122` : seul le signal d'arrêt du tour, **aucun délai** | Voir § 3.7 : un fournisseur qui garde la connexion ouverte sans rien envoyer bloque le bot ; seule une personne peut le débloquer en cliquant. | S |
| 151 | Modèles | H **recherche d'outils** : les outils d'applis remplacés par 3 petits outils (`tool_search`, `tool_describe`, `tool_call`), chargés à la demande | MANQUANT | `loop.ts:440-481` : **tous** les outils intégrés (environ 100, `tools.ts:1356-1368`) + tous ceux des applis connectées, envoyés à chaque appel | Coût et lenteur à chaque tour ; les petits modèles se perdent dans 100 outils. Plus il y a d'applis, pire c'est. | L |
| 152 | Modèles | H : plusieurs clés pour un même fournisseur, rotation en cas de limite | MANQUANT | grep `rotate|pool` dans `llm/`, `providers.ts` : rien | Une clé en limite = bascule sur le modèle de secours, pas sur une autre clé. | M |
| 153 | Modèles | H : routage OpenRouter (prix, vitesse, fournisseurs autorisés ou interdits) | MANQUANT | `server/src/openrouter.ts` : choix de modèles seulement | Pas de « le moins cher » ni de liste blanche de fournisseurs. | S |
| 154 | Modèles | H : mélange d'agents (plusieurs modèles conseillent, un écrit) | DIFFÉRENT | Relecture par un autre bot : `server/src/peerreview.ts` ; `server/test/security-review.test.ts` | Autre idée (relire après, pas conseiller avant). Rien de perdu. | — |
| 155 | Contexte | H : résumé automatique à 50 % du contexte, fin de conversation gardée, 2e filet à 85 % | DIFFÉRENT | Dans le tour à 80 % (`loop.ts:1125-1137`, `config.ts:165`) + entre les tours (`memory.ts` `compactIfNeeded`) + rattrapage sur erreur « trop long » (`loop.ts:1002-1008`) ; `server/test/wave10-context.test.ts` | Seuil plus haut (80 %) : plus de jetons payés par appel avant le résumé. Un échec du résumé n'est pas retenté dans le tour (`loop.ts:1136`). | S |
| 156 | Contexte | H : anciens résultats d'outils et anciennes images retirés | FAIT | `server/src/agent/context.ts:36,91` | — | — |
| 157 | Contexte | H : cache de prompt (préfixe stable) | PARTIEL | `llm/anthropic.ts:88` (cache sur le système), outils triés (`loop.ts:475`) | L'heure est mise dans chaque message, pas dans le système : bien. Mais le prompt contient les notes choisies **par tour** (`prompt.ts:219`) : dès que la sélection change, le cache du système saute. | M |
| 158 | Contexte | H : `/compress` à la main avec sujet à garder | PARTIEL | route `/bots/:id/compact` | Pas de « garde surtout ceci ». | S |
| 159 | Contexte | H : fichiers de contexte du projet (`AGENTS.md`, `SOUL.md`) et références `@fichier` | DIFFÉRENT | Consignes du bot et du projet (`prompt.ts:243-245`), `@[Appli]` (`ComposerMentions.tsx:52-63`) | Pas de `@fichier` de la bibliothèque dans le message. | S |

### 2.12 Aides et sous-agents

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 160 | Aides | H `delegate_task` : sous-agents en parallèle, contexte séparé, seul le résumé remonte | FAIT | `tools.ts:1123-1127` (`helper_start`, 4 max : `team.ts:9`), `bgtasks.ts:18,54` (3 tâches de fond) ; `server/test/wave9.test.ts` | — | — |
| 161 | Aides | H : résultat au format imposé (`output_schema`) | MANQUANT | — | Le parent reçoit du texte libre. | S |
| 162 | Aides | H : modèle moins cher pour les aides | MANQUANT | L'aide hérite du modèle du parent | Les recherches de fond coûtent le prix fort. | S |
| 163 | Aides | H : détection d'aide bloquée, délai max par aide | PARTIEL | Veille du tour (`watch.ts`) : avis seulement | Voir ligne 150 : pas d'arrêt automatique. | S |
| 164 | Aides | H : suivre, piloter et lire en direct une aide en cours | FAIT | `bgtasks.ts:79,89` (arrêter, répondre), carte de tâche | — | — |
| 165 | Aides | H : accords demandés par une aide de fond | FAIT | `loop.ts:1803` (même chemin) | — | — |
| 166 | Aides | H : exécution de code qui appelle les outils (un script au lieu de 10 tours) | MANQUANT | — | Les traitements répétitifs font un appel de modèle par étape. | L |

### 2.13 Groupes de bots

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 167 | Groupes | H/K R14 : salons à plusieurs bots, tours de parole | FAIT | `server/src/agent/team.ts`, `tools-room.ts` ; `server/test/room-routing.test.ts`, `roombudget.test.ts` | — | — |
| 168 | Groupes | H : qui répond quand personne n'est nommé | FAIT | `server/src/agent/roomrouting.ts:13-32` | — | — |
| 169 | Groupes | H : garde-boucle entre bots | FAIT | `server/src/agent/roombudget.ts:1-30`, `team.ts:8` (`MAX_HOPS = 3`) | Tout en mémoire vive : remis à zéro au redémarrage (dit dans le fichier). | — |
| 170 | Groupes | H : message de bot à bot, avec attente de la réponse | FAIT | `tools.ts:1085` (`bot_message`, `wait: true`) | — | — |
| 171 | Groupes | H 0.23.3 : bandeau « un coéquipier attend » au-dessus de la saisie | NON VÉRIFIÉ → § 5 | — | — | — |

### 2.14 Voix

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 172 | Voix | H : appel vocal avec le bot | FAIT | `server/src/voice/session.ts`, `calls.ts`, `web/src/lib/call.ts` ; `server/test/voice-bots.test.ts`, `wave6-voice.test.ts` | Les appels en cours sont en mémoire vive (`calls.ts:12`) : un redémarrage perd le compte rendu. | S |
| 173 | Voix | H : plusieurs moteurs de voix, dont gratuits et locaux | FAIT | `server/src/voice/` (`piper.ts`, `kokoro.ts`, `fish.ts`) ; `server/test/voice-fish-kokoro.test.ts` | — | — |
| 174 | Voix | H : transcription des vocaux reçus | PARTIEL | `voice/transcribe.ts` ; `server/test/voice-transcribe.test.ts` | Pas sur Telegram (ligne 88). | — |
| 175 | Voix | H : mot de réveil (« Hey Hermes ») | MANQUANT | grep `wake.?word` : rien | Confort, pas prioritaire. | M |

### 2.15 Accords et sécurité

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 176 | Sécurité | H : accord avant une action dangereuse, avis d'un modèle relecteur (« smart ») | FAIT | `loop.ts:1314` (`judge`), `authorize.ts:254` ; `server/test/security.test.ts` | — | — |
| 177 | Sécurité | H : en mode sans surveillance (routine, webhook), l'action dangereuse est **refusée**, pas mise en attente | NON VÉRIFIÉ → § 5 | `config.ts:191` (accord expiré après 25 min) | — | — |
| 178 | Sécurité | H : mode « tout accepter » (YOLO) | NON REPRIS | — | Retrait de sécurité. | — |
| 179 | Sécurité | H : contenu extérieur = information, jamais un ordre ; suivi de la « souillure » du tour | FAIT | `prompt.ts:166`, `loop.ts:1293` (`taintGuard`) ; `server/test/security-review.test.ts` | — | — |
| 180 | Sécurité | H : secrets masqués dans ce que lit le modèle | FAIT | `loop.ts:1734`, `shared.ts:1166-1181` ; `server/test/security-fixes.test.ts` | — | — |
| 181 | Sécurité | H : adresses privées bloquées (SSRF) | FAIT | `server/src/net.ts:11-25` | — | — |
| 182 | Sécurité | H : sortie réseau filtrée, clés injectées hors de la machine du bot | FAIT | `server/src/egress.ts`, relais de clés (`prompt.ts:155`) | — | — |
| 183 | Sécurité | H : arrêt d'urgence de tous les bots | FAIT | `routes.ts:753` (`/pauses/all`) ; `server/test/pause.test.ts` | — | — |
| 184 | Sécurité | H : instantanés des fichiers avant modification, retour en arrière | FAIT | `server/src/snapshots.ts`, carte « Fichiers modifiés » (`shared.ts:422`) ; `server/test/wave5b-files.test.ts` | — | — |
| 185 | Sécurité | K : empreinte SHA-256 de chaque fichier installé, pas de script chargé d'un CDN | DIFFÉRENT | Image Docker construite par le projet | Autre mode de livraison. | — |
| 186 | Sécurité | K : seul l'installateur peut parler au bot sur Slack ; liste d'autorisés | DIFFÉRENT | Telegram lié par code (`telegram.ts:111-121`), membres d'espace de travail | — | — |

### 2.16 Fiabilité

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 187 | Fiabilité | H : reprise après redémarrage du serveur | FAIT | `loop.ts:1678-1730` ; `server/test/engine-queue.test.ts` | — | — |
| 188 | Fiabilité | H : limite de pas par tour | DIFFÉRENT | 60 pas (`config.ts:67`), puis « Continuer » (`loop.ts:1143-1157`) | Hermes a retiré la limite par défaut (« coupait des tâches en plein milieu »). Sklubot garde 60 avec un bouton : choix prudent mais qui arrête les longues tâches surveillées. | S |
| 189 | Fiabilité | H : réponse coupée par la limite de sortie → suite automatique | FAIT | `loop.ts:1051-1063` | — | — |
| 190 | Fiabilité | H : réponse vide → une relance | FAIT | `loop.ts:1086-1091` | — | — |
| 191 | Fiabilité | H : garde-boucle sur les outils | FAIT | `reliability.ts:86-107`, `loop.ts:1106-1112` | — | — |
| 192 | Fiabilité | H : rapport final exigé après un travail | FAIT (en plus de Hermes) | `loop.ts:1076-1084` | — | — |
| 193 | Fiabilité | K : auto-diagnostic lisible (« docteur ») avec la commande qui répare | PARTIEL | `server/src/health.ts`, `/health/deep`, `desk-cli.ts` ; `server/test/monitor.test.ts` | Pas de résumé à coller dans une demande d'aide, sans chemin ni secret. | S |
| 194 | Fiabilité | K : mise à jour automatique quotidienne, avec sauvegarde | NON VÉRIFIÉ → § 5 | `server/src/autobackup.ts` (sauvegardes) | — | — |
| 195 | Fiabilité | K : si un détail interne change, retour à l'écran d'origine plutôt qu'une panne | NON REPRIS | — | Propre à un greffon ; sans objet. | — |
| 196 | Fiabilité | K : tests de l'interface (163 fichiers : défilement, flux, jamais deux fois) | MANQUANT | `web/package.json:9` | Aucun test sur `Transcript.tsx` (1 000+ lignes) ni `Composer.tsx`. Toute régression du chat passe inaperçue. | L |

### 2.17 Réglages, comptes, installation

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 197 | Réglages | H : profils isolés = bots, export / import d'une équipe | FAIT | `server/src/teamfile.ts`, `teammd.ts` ; `server/test/team-templates.test.ts`, `team-markdown.test.ts` | — | — |
| 198 | Réglages | H : sauvegarde et transfert | FAIT | `autobackup.ts`, `backuparchive.ts` ; `server/test/auto-backup.test.ts`, `backup-drill.test.ts` | — | — |
| 199 | Réglages | H : import depuis un autre agent | FAIT | `server/src/grokimport.ts` ; `server/test/grok-import.test.ts` | — | — |
| 200 | Réglages | H : plafonds de dépense | FAIT (en plus de Hermes) | `server/src/usagecaps.ts`, `agent/spend.ts` ; `server/test/usage-caps.test.ts` | — | — |
| 201 | Réglages | H : greffons (outils, crochets) sans toucher au cœur | MANQUANT | — | Extension par MCP seulement (`connectors.ts:144-158`, HTTP). | L |
| 202 | Réglages | H : serveurs MCP locaux (stdio) et distants, filtre d'outils par serveur | PARTIEL | Distants : `connectors.ts`, locaux sur l'ordinateur du bot : `server/src/localtools.ts` ; `server/test/irreversible-skills-localtools.test.ts` | Pas de filtre « ces 5 outils seulement » par appli. | S |
| 203 | Réglages | H : génération d'images, vidéo, recherche web, recherche X, vision | FAIT | `images.ts`, `video.ts`, `search.ts`, `xsearch.ts`, `visionpayload.ts` ; `server/test/media-tools.test.ts`, `visionpayload.test.ts` | — | — |
| 204 | Réglages | H : thèmes et « personnalités » toutes prêtes | PARTIEL | Consignes par bot, modèles d'équipe | Pas de personnalités à changer d'un clic. | S |
| 205 | Accueil | H : assistant de première installation | FAIT | `web/src/components/Onboarding.tsx:1-11`, `server/src/publicsignup.ts` ; `server/test/public-signup.test.ts` | — | — |
| 206 | Accueil | K : « Tu devrais voir… » à chaque étape + tableau « ce que tu vois → pourquoi → quoi faire » | PARTIEL | `docs/` et dépannage dans l'app | Pas de vérification automatique après chaque étape. | S |
| 207 | Mobile | H : notifications, app de bureau | FAIT | `mobile/` (Expo), `companion/` (Electron), `push.ts` | — | — |

---

## 3. Écarts de comportement, parcours par parcours

### 3.1 Premier message à un bot

**Hermes / kit.** Le chat est créé une seule fois (« registre d'abord, adopter l'existant en cas de conflit »). Chaque message porte un **numéro d'envoi** ; le moteur ne l'exécute jamais deux fois. Si la réponse du serveur se perd, l'interface **relit l'historique** au lieu de proposer de renvoyer (`grokbot-override/README.md`, « Sending: never twice »).

**Sklubot.** `Composer.tsx:164-183` poste `{text, attachments}` sans identifiant. `routes.ts:849` écrit la ligne puis `submitUserMessage` lance le tour. En cas d'erreur réseau, le brouillon reste et une erreur s'affiche.

**Écart.** Réseau mobile coupé juste après l'envoi : le message est déjà en base et le bot travaille, mais l'utilisateur voit « erreur » et renvoie. Résultat : deux messages, deux tours, parfois deux actions.

**Correction.** Générer un identifiant par envoi dans `Composer.tsx`, le garder en base avec la ligne, et renvoyer la même ligne si le même identifiant revient (`routes.ts:821`). Taille S.

### 3.2 Un bot qui utilise son ordinateur sur un lien, sans qu'on le lui dise

**Hermes / kit.** Le bot a `browser_*` dans ses outils de base. Le kit **ouvre la vue de l'écran à l'instant** où le bot appelle un outil d'écran ou de navigateur (`computer-viewer/README.md`, « Opens when your bot goes to work »), au plus une fois par 30 s, jamais sur un historique rejoué.

**Sklubot.** Deux consignes : une règle générale dans le prompt (`prompt.ts:58`) et une note ajoutée au message quand il contient un lien (`links.ts:40-49`, appelée en `loop.ts:658,718`). Test : `server/test/links.test.ts` (8/8 passés).

**Écarts.**
1. `links.ts:14` ne reconnaît que les adresses qui commencent par `http://` ou `https://`. « regarde sklubs.fr » ou « youtube.com/watch?v=… » **ne déclenche pas la note** : seul le prompt général joue, et les modèles faibles répondent alors de tête ou avec `web_fetch`.
2. La note n'est ajoutée que pour un message tapé par une personne à ce bot (`links.ts:56`). Dans un salon de groupe, un message relayé par un autre bot ou une routine n'en a pas (voulu pour la sécurité, mais ça explique « il n'a pas ouvert le lien »).
3. Le bot ouvre la page « pour que tu regardes » mais **l'écran ne s'ouvre pas** côté utilisateur (ligne 72). La promesse du prompt n'est pas tenue à l'écran.

**Corrections.** Reconnaître aussi les domaines nus (`mot.tld/…`) dans `publicLinksIn` ; ouvrir le panneau Ordinateur quand `live.activity` passe à une action d'écran (une fois par tour, refermable). Taille S chacune.

### 3.3 Longue tâche qui échoue en route, puis reprend

**Hermes.** Pas de limite de pas par défaut. Erreur du fournisseur : classée, relancée, clé suivante du lot, puis modèle de secours. Flux muet : coupé à 180 s et relancé.

**Sklubot.** Très complet : relances (`loop.ts:1010`), modèle de secours avec ligne dans le chat (`loop.ts:1025`), résumé si trop long (`loop.ts:1002`), limite de 60 pas avec « Continuer » (`loop.ts:1156`), routines qui continuent seules une fois (`loop.ts:1151`), journal des échecs et carte avec remèdes (`failures.ts`). Tests passés : `failures.test.ts` 16/16.

**Écarts.**
- La limite de 60 pas arrête une tâche surveillée et attend un clic. Sur une tâche de 3 heures, c'est plusieurs arrêts. Hermes a supprimé cette limite parce qu'elle « coupait en silence ».
- `stepLimitReached` ne relance seule que les routines (`turn.autoContinue`) et les objectifs. Une longue tâche demandée dans le chat s'arrête la nuit.

**Correction.** Laisser l'utilisateur choisir « continuer seul jusqu'à N fois » par bot, ou relever la limite quand le bot poste des `progress_update` réguliers. Taille S.

### 3.4 Accords

**Hermes / kit.** Carte avec « une fois / session / toujours / refuser ». En sans-surveillance : refus net par défaut. Les cartes du kit montrent **le texte exact** qu'un bouton enverra quand il diffère de son libellé.

**Sklubot.** Plus riche : citation obligatoire des mots de l'utilisateur (`prompt.ts:164`), relecteur automatique (`authorize.ts`), actions irréversibles toujours à l'unité (`irreversible.ts:8`), accord par réaction Telegram, expiration à 25 minutes (`config.ts:191`).

**Écart.** Une carte expirée après 25 minutes : à vérifier que le travail reprend proprement quand l'utilisateur revient une heure plus tard (non vérifié, § 5). Chez Hermes, l'accord attend tant que la session vit.

### 3.5 Mémoire apprise puis rappelée plus tard

**Hermes.** Deux petits fichiers toujours **entiers** dans le prompt, avec le taux de remplissage. Quand c'est plein, l'outil refuse et demande de fusionner. La mémoire est figée au début de la session (cache stable).

**Sklubot.** Tout est gardé ; à chaque tour `pickMemories` (`prompt.ts:17-45`) classe par mots de 3 lettres ou plus en commun avec les 3 derniers messages, puis remplit 4 000 caractères.

**Écarts.**
- Rappel par **mots identiques** : « mon comptable s'appelle Marc » ne remonte pas sur « envoie la facture à l'expert-comptable » si le budget est déjà pris par des notes plus récentes. Pas de synonymes, pas de sens.
- La sélection change d'un tour à l'autre : le prompt système change, donc le **cache du fournisseur saute** (ligne 157).
- Le bot ne sait pas combien de notes il a ni lesquelles se répètent.

**Corrections.** (a) Garder un noyau fixe de notes « confirmées » toujours présent, en tête ; (b) mettre les notes choisies par tour **dans le message**, pas dans le système, pour garder le cache ; (c) dire au bot « 212 notes, 37 montrées ». Taille M.

### 3.6 Une routine qui se déclenche

**Hermes.** Session neuve par exécution, modèle par routine, mode sans IA, enchaînement, erreur et passage manqué visibles, action dangereuse refusée.

**Sklubot.** Solide : rattrapage (`scheduler.ts:183`), retard dit au bot (`scheduler.ts:127-129`), « seulement s'il y a du nouveau » (`scheduler.ts:98`), pause et plafond respectés avec réponse 2xx aux webhooks (`routes.ts:412-418`).

**Écarts.** Pas de modèle par routine, pas de mode sans IA, pas de signature sur les webhooks. Et le point 3.7 : une routine dont l'appel au modèle se fige **bloque la file du bot** sans que personne soit là pour cliquer.

### 3.7 Erreur ou silence du fournisseur de modèle (le défaut le plus sérieux)

**Hermes.** `HERMES_STREAM_STALE_TIMEOUT` (180 s sans morceau → connexion coupée, nouvel essai), `HERMES_STREAM_READ_TIMEOUT` (120 s), `HERMES_API_TIMEOUT` (1 800 s) ; trois coupures du même essai → abandon avec message (`agent/chat_completion_stream_monitor.py:22`).

**Sklubot.** `llm/anthropic.ts:128` et `llm/openai-compat.ts:122` ne passent que le signal d'arrêt du tour. La veille (`watch.ts:247-254`) poste un avis à 20 s (« ne répond pas encore ») et un autre à 5 min (« semble bloqué ») avec des boutons. Elle **n'arrête rien d'elle-même** pour un modèle par API. Les tours sur abonnement ont, eux, une limite de 60 min (`loop.ts:654-657`).

**Écart.** Un fournisseur qui accepte la connexion puis n'envoie rien : le tour reste ouvert **sans fin** tant que personne ne clique. Pour une routine de nuit, un objectif, une aide de fond ou un message Telegram, personne ne clique : le bot est bloqué, sa file aussi. Les relances et le modèle de secours ne jouent pas, car aucune erreur n'est levée.

**Correction.** Dans `modelLoop`, entourer `call()` d'un délai d'inactivité (par exemple 180 s sans aucun morceau) qui lève une erreur « passagère » : le circuit existant (relance, puis secours) fait le reste. Pour les tours sans personne, arrêter et reprendre automatiquement au lieu d'attendre un clic. Taille S, gain très élevé.

### 3.8 Redémarrage pendant le travail

**Hermes.** Sessions rattachées, tours repris, notes de redémarrage.

**Sklubot.** `recoverInterruptedTurns` (`loop.ts:1678-1704`) : la file est rejouée dans l'ordre, le tour coupé reçoit une consigne de reprise prudente selon qu'il avait déjà agi, une action au résultat inconnu n'est jamais rejouée, et le chat dit « Le serveur a redémarré, je reprends ». **Meilleur que le kit**, dont un chat fermé depuis 30 minutes peut perdre son travail.

**Écarts mineurs.** Garde-boucle des salons, appels vocaux en cours et offres « demander d'abord » sont en mémoire vive et perdus au redémarrage (`roombudget.ts`, `calls.ts:12`).

### 3.9 Conversation de groupe à plusieurs bots

**Hermes.** Salons tenus par la passerelle, tours, relais, accords des membres dans le salon.

**Sklubot.** Choix de qui répond en trois passes avec délai de 1,5 s (`roomrouting.ts:13-32`), ligne « → Léa a pris la question » avec « Plutôt demander à… », budget anti-boucle détaillé (`roombudget.ts`). À égalité ou mieux.

**Écart.** Les cartes ne s'affichent que dans le chat du bot, pas dans le salon (comme le kit). `cartes-de-suivi/SKILL.md` le dit au bot.

### 3.10 Appel vocal

Non comparé en détail : le kit n'a que la dictée ; Hermes a un mode vocal complet et un mot de réveil. Sklubot a les appels et trois moteurs de voix. Seul écart relevé : pas de mot de réveil, compte rendu d'appel perdu si le serveur redémarre pendant l'appel.

### 3.11 Livraison d'un fichier ou d'une page

**Kit.** Carte de fichier, visionneuse avec tableur en grille, PDF, texte « Tout copier », 25 Mo max ; long texte envoyé en `.md`.

**Sklubot.** Pages versionnées dans un bac à sable (`pageroutes.ts`), liens publics temporaires, aperçu image / PDF / texte / CSV.

**Écarts.** Pas de xlsx, CSV limité à 50 lignes, pas de bouton Copier sur le code, pas de consigne « long texte = fichier ». Sur Telegram, **aucun fichier n'est livré**.

### 3.12 Accueil d'un nouvel utilisateur

**Kit.** Chaque étape dit « tu devrais voir… », un docteur en lecture seule imprime OK / À CORRIGER avec la commande, et un résumé sans chemin ni secret à coller dans une demande d'aide.

**Sklubot.** Parcours guidé en 5 étapes (`Onboarding.tsx:1-11`), chaque étape passable. Bien pensé pour un non-développeur.

**Écart.** Si la connexion du modèle échoue pendant l'accueil, pas de diagnostic « voici ce qui ne va pas et le bouton qui répare » au même endroit (existe ailleurs : Incidents, Santé).

### 3.13 Style des réponses

**Kit.** Doctrine injectée **par le système**, seulement dans le chat du bot, réglable par canal, avec rattrapage pour les vieilles conversations. Règles chiffrées : 1 à 2 phrases, moins de 25 mots si rien n'exige plus, une question au plus, jamais de titres ni de listes, « je m'en occupe » puis le résultat.

**Sklubot.** Section fixe du prompt (`prompt.ts:178-184`) + compétence facultative. La compétence est noyée parmi les autres : si le bot en a pour plus de 6 000 caractères, elle n'est plus dans le prompt, seulement **listée** (`prompt.ts:227-229`), donc le bot doit penser à la lire à chaque fois. **Une règle de ton ne devrait pas être une compétence à lire.**

**Correction.** En faire un réglage du bot (« Réponses courtes : oui / non ») écrit dans la section « How you write ». Taille S.

---

## 4. Les autres éléments du kit : faut-il les adapter ?

Sklubot a déjà repris trois compétences (`brouillon-email`, `cartes-de-suivi`, `conversation-courte`). Voici **tout le reste** du kit.

| Élément du kit | Ce que c'est | À adapter ? | Pourquoi |
|---|---|---|---|
| `texting-style/__init__.py` (la doctrine complète) | 11 règles chiffrées de réponse courte | **Oui, en réglage** | La version Sklubot a perdu les chiffres (25 mots, une question, pas de titres) et le filtre par canal. Voir § 3.13. |
| `texting-style/plugin.yaml` (réglages `enabled`, `bot_chat_only`, `platforms`, `extra_rules`) | Interrupteur, canaux, règle en plus | **Oui** | Donne le modèle du réglage par bot. |
| `grokbot-override/skills/agent-cards/SKILL.md`, partie « Long text the user will copy » | Long texte = fichier `.md` | **Oui** | Absent de `cartes-de-suivi`. Une phrase à ajouter. |
| idem, partie « Link your sources » | Finir la ligne par `[2-3 mots](lien exact)`, règles Slack et Gmail | **Oui** | Absent. Va avec la ligne 56. |
| idem, partie « Previews » | Page HTML sans réseau | Non | Déjà couvert par les pages de Sklubot. |
| idem, format `card.v1` (fichier JSON + ligne `::card`) | Cartes écrites par le bot | Non | Sklubot a des cartes natives par outil, plus sûres (le bot n'écrit pas le bouton). |
| `email-drafts/` (moteur, `store.py`, `engine.py`) | Brouillon avec états, verrou, révision, journal | **En partie** | Reprendre : mise à jour du brouillon, pièces jointes, Cci, signature, carte modifiable (lignes 142-144). L'anti-double-envoi existe déjà. |
| `email-drafts/composio_sender.py` | Envoi par la CLI Composio | Non | Service tiers ; Sklubot a Gmail et Outlook en direct. |
| `email-drafts/senders.py` (SMTP) | Envoi SMTP | Non | Couvert par `botmail.ts` et le relais de courrier. |
| `email-drafts/plugin.yaml` (règles par bot : autoriser, approbation, désactivé) | Trois modes | **Oui** | Modèle pour la liste d'adresses autorisées (ligne 145). |
| `computer-viewer/plugin.js` | Visionneuse VNC | **En partie** | Reprendre : ouverture automatique, reconnexion avec délais, erreurs distinctes, coller / capture (lignes 72-77). |
| `computer-viewer/connect-mac.sh`, `connect-windows.ps1`, `connect-linux.sh` | Transformer un poste en écran VNC | Non | Ouvre VNC sur le réseau (mot de passe de 8 caractères). Relais est plus sûr. |
| `computer-viewer/hiperf-*` | Flux H.264 | Non | Sans objet (ligne 78). |
| `computer-viewer/remove-orgo-computer.sh` | Nettoyage d'un fournisseur tiers | Non | Propre à un service. |
| `computer-viewer/docs/KNOWN-ISSUES.md` | Pannes réelles et remèdes | **À lire** | « Chrome meurt en root », « mot de passe refusé pris pour injoignable » concernent aussi `docker/desktop/`. |
| `remote-cua/` | Mac distant par SSH | Non | Ligne 80. L'idée du **bail numéroté** est à reprendre (ligne 75). |
| `slack-check/` | Test de connexion Slack | Plus tard | Seulement si Slack devient un canal (ligne 92). |
| `slack-connect/`, `slack-relay/`, `slack-http/` | Slack en un clic | Non | Ligne 93. |
| `docs/SLACK.md` | Mode d'emploi, étapes « HUMAIN » | **Modèle à suivre** | Bon exemple de guide qui dit ce que seul l'humain peut faire. |
| `docs/LINUX-VM.md`, `docs/COMPATIBILITY.md` | Réglages Hermes | Non | Propres à Hermes. |
| `install.sh`, `scripts/doctor.sh` | Installation vérifiée, docteur | **Idée du docteur** | Ligne 193. |
| `install.sh --auto-update` | Mise à jour quotidienne | Non vérifié | § 5. |
| `AGENTS.md` | Guide pour qu'une IA installe le kit | **Idée** | Un fichier équivalent aiderait les utilisateurs qui installent Sklubot avec une IA. |
| `SECURITY.md` | Politique de sécurité | Non | Sklubot a la sienne. |
| `MANIFEST.sha256`, `scripts/make-manifest.sh`, `release.sh` | Empreintes de publication | Non | Autre mode de livraison. |
| `.github/ISSUE_TEMPLATE/not-working.yml` | Demande d'aide guidée par le résumé du docteur | **Idée** | Va avec le docteur. |
| `grokbot-override/src/core/streamSafe.js` | Mise en forme sûre pendant la frappe | **Oui (idée)** | Ligne 26. Réécrire, ne pas copier (dépend du rendu Hermes). |
| `grokbot-override/src/core/sourceLinks.js` + `brandMarks.ts` | Pastilles de sources | **Oui (idée)** | Ligne 56. Logos CC0 réutilisables. |
| `grokbot-override/src/core/newMarker.js` | Ligne « NOUVEAU » | **Oui (idée)** | Ligne 23. |
| `grokbot-override/src/ui/stickToBottom.ts` | Tenue du bas et retour à sa place | **Oui (idée)** | Ligne 20. |
| `grokbot-override/src/core/sheetGrid.js`, `sheetRead.js` | Tableur en grille | **Oui (idée)** | Ligne 58. |
| `grokbot-override/src/core/rewind.js` | Modifier / régénérer | **Oui (idée)** | Ligne 44. |
| `grokbot-override/src/core/outcomes.js` | Classement « refus sûr / résultat inconnu » d'un envoi | **Oui (idée)** | Ligne 24. |
| `grokbot-override/src/core/contract.js` | Vérifie les détails internes de Hermes | Non | Sans objet. |
| `grokbot-override/src/core/colors.js`, `styles-ref.ts` | Palette Rakazo (Apache-2.0) | Non | Habillage ; licence à suivre si repris. |
| `grokbot-override/src/ui/avatarShapes.ts` | 12 formes d'avatar | Non | Sklubot a ses personnages. |

---

## 5. Non vérifié

- **Aucune application n'a été lancée** : ni Hermes, ni le kit, ni Sklubot dans un navigateur. Tout vient de la lecture du code et de 4 fichiers de tests Sklubot relancés (`skills-library` 7/7, `watch` 14/14, `failures` 16/16, `links` 8/8).
- Le kit dit lui-même que son chat n'est « pas qualifié en conditions réelles » (`PARITY.md`, « none of the rows is live-qualified ») : ses 51 lignes « Implemented » sont prouvées par des tests avec faux serveur, pas par l'usage.
- Hermes Agent fait plus de 27 000 fichiers. J'ai lu la documentation (`website/docs`, environ 200 pages parcourues par titres, 25 lues) et vérifié quelques points dans le code. Les fonctions non documentées ne sont pas dans le tableau.
- Ligne 62 : confirmation d'un message envoyé par une page intégrée de Sklubot (non cherché).
- Ligne 104 : forme exacte de la modification d'une note chez Sklubot (`memory_save` lu, pas les outils de correction).
- Ligne 171 : bandeau « un coéquipier attend » (non cherché dans le web).
- Ligne 177 : ce que fait exactement une routine Sklubot face à une action qui demande un accord (attente 25 min puis expiration ? refus direct ?). Le code d'expiration existe (`loop.ts:1781-1800`) ; le parcours complet n'a pas été suivi.
- Ligne 194 : mise à jour automatique de Sklubot (non cherchée).
- Applications mobile et de bureau de Sklubot : présence constatée, code non lu.
- Le bogue de la grande vue (ligne 73) est déduit du code (`ComputerViewer.tsx:396` comparé à `DetailsPanel.tsx:324-329`) ; il n'a pas été reproduit.
- Les tests ont été lancés sans rien écrire volontairement ; ils créent leurs propres dossiers temporaires. Je n'ai pas contrôlé qu'ils ne laissent rien dans `server/data`.
- Les comptes du haut sont calculés par script sur les 207 lignes du tableau. Le chiffre « environ 45 sans test » est une estimation à l'œil, pas un compte exact.

---

## 6. À faire, classé par valeur

> **Mise à jour du 2026-11-22 (chantier « cœur : fiabilité »).** Les lignes marquées ✅ sont faites et testées (`server/test/core-timeouts.test.ts`, `core-reliability.test.ts`, `core-engine.test.ts`) ; « en partie » dit ce qui reste. Détail dans `docs/COUVERTURE.md`, section « Cœur : fiabilité ».

| Rang | Quoi | Taille |
|---|---|---|
| 1 | ✅ **Fait (2026-11-22).** Délai d'inactivité sur chaque appel au modèle (180 s sans rien → erreur passagère → relance puis secours), plafond de connexion (180 s) et plafond par appel (30 min) ; le tour finit toujours (relances, secours, puis carte d'échec et nouveaux essais du coordinateur), sans clic. `server/src/llm/timeouts.ts`, réglages `MODEL_IDLE_TIMEOUT_SEC`, `MODEL_CONNECT_TIMEOUT_SEC`, `MODEL_CALL_TIMEOUT_MIN`. (§ 3.7, ligne 150) | S |
| 2 | ✅ **Fait (2026-11-22).** Numéro d'envoi sur chaque message (web et mobile), gardé 24 h par compte et par bot : le même envoi répété rend le premier message, sans second tour. `server/src/sendkeys.ts`. (ligne 24) | S |
| 3 | Modifier un message envoyé et régénérer une réponse. (ligne 44) | M |
| 4 | Recherche d'outils : ne plus envoyer la centaine d'outils et tous les outils d'applis à chaque appel. (ligne 151) | L |
| 5 | ✅ **Fait en partie (2026-11-22).** Liens sans `http` reconnus (« youtube.com/watch?v=… », « www.site.fr », « sklubs.fr »), sans prendre « file.txt » ou « e.g. » pour un lien : fait (`agent/links.ts`). Reste : ouvrir l'écran du bot tout seul quand il s'en sert. (§ 3.2, ligne 72) | S |
| 6 | Réparer la grande vue de l'écran qui ne se reconnecte pas, avec délais croissants et bouton Reconnecter. (ligne 73) | S |
| 7 | Bouton Copier sur les blocs de code, repli des longs blocs. (ligne 35) | S |
| 8 | Telegram : recevoir photos, vocaux et fichiers ; envoyer les fichiers du bot ; mise en forme propre. (lignes 88-90) | M |
| 9 | Curateur de compétences : compter l'usage, archiver les inutilisées, épingler, verrouiller, garder la version d'avant. (lignes 115-118) | M |
| 10 | Mémoire : noyau fixe de notes confirmées, notes du tour hors du prompt système (cache), taux de remplissage dit au bot. (§ 3.5, lignes 102-103, 157) | M |
| 11 | Brouillons d'e-mail : outil de mise à jour (la compétence actuelle demande une chose impossible), pièces jointes, Cci, signature. (lignes 143-144) | M |
| 12 | Carte de brouillon modifiable dans le chat avec Envoyer / Abandonner. (ligne 142) | M |
| 13 | Tests de l'interface du chat (défilement, flux, envoi, cartes). (ligne 196) | L |
| 14 | Réponses courtes en réglage du bot, avec les règles chiffrées et le choix par canal. (§ 3.13, ligne 139) | S |
| 15 | Mise en forme stable pendant la frappe (pas de `**` ni de tableau à moitié écrit). (ligne 26) | M |
| 16 | Ligne « NOUVEAU » au premier message non lu. (ligne 23) | S |
| 17 | Pastilles de sources + consigne « finis la ligne par un lien court et exact ». (ligne 56) | M |
| 18 | Question à plusieurs volets, choix multiple, réponse rendue dans le même tour. (ligne 30) | M |
| 19 | Modèle moins cher par routine et pour les aides de fond. (lignes 128, 162) | S |
| 20 | ✅ **Fait (2026-11-22, L20).** Signature HMAC-SHA256 facultative sur les webhooks entrants (GitHub, Stripe, Standard Webhooks), clé scellée et montrée une fois, dédoublonnage, regroupement, essai à blanc, journal des refus. `server/src/hooktrust.ts`, `hookroutes.ts`. (ligne 97) | S |
| 21 | Longue tâche demandée dans le chat : continuer seule après 60 pas, N fois au choix. (§ 3.3, ligne 188) | S |
| 22 | Slack comme canal (mode Socket officiel). (ligne 92) | L |
| 23 | Coller le presse-papiers, Ctrl+Alt+Suppr et capture dans la vue de l'écran. (ligne 77) | S |
| 24 | Visionneuse de tableur (xlsx, onglets, copie de cellules, CSV entier). (ligne 58) | M |
| 25 | Jauge « contexte rempli à X % » et résumé plus tôt que 80 %. (lignes 47, 155) | S |
| 26 | Routines sans IA (script planifié) et enchaînement de routines. (lignes 129-130) | M |
| 27 | Plusieurs clés par fournisseur avec rotation. (ligne 152) | M |
| 28 | Consigne « long texte = fichier .md ». (ligne 59) | S |
| 29 | Retrouver sa place par message visible quand on charge les anciens messages. (ligne 20) | S |
| 30 | Bail numéroté pour la prise en main de l'écran. (ligne 75) | S |
| 31 | Docteur avec résumé à coller, sans chemin ni secret. (ligne 193) | S |
| 32 | Commandes `/` dans le chat web avec liste. (ligne 40) | S |
| 33 | Liste d'adresses autorisées pour les envois. (ligne 145) | S |
| 34 | Détail complet d'une étape (résultat, diff). (ligne 33) | S |
| 35 | Filtre d'activité dans la liste des bots ; deux chats côte à côte. (lignes 6, 10) | S / M |
| 36 | Garder en base ce qui est en mémoire vive (garde-boucle des salons, appels en cours). (§ 3.8) | S |
| 37 | Serveur compatible OpenAI, webhooks sortants. (lignes 98-99) | M |
| 38 | Résultat d'aide au format imposé ; `@fichier` ; routage OpenRouter ; filtre d'outils par appli. (lignes 161, 159, 153, 202) | S chacun |
| 39 | Exécution de code qui appelle les outils ; tableau de tâches à colonnes ; greffons. (lignes 166, 137, 201) | L chacun |
| 40 | Mot de réveil, personnalités toutes prêtes, photo d'avatar. (lignes 175, 204, 12) | S / M |
