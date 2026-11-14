# Couverture des cahiers des charges (salle blanche)

Vérification faite dans le code (pas dans la doc), fonction par fonction, sur les 5 cahiers des charges de `docs/cleanroom/`.

| Cahier | Fait | Partiel | Manquant | Différent exprès | Total |
|---|---|---|---|---|---|
| 01 — produit de base | 50 | 3 | 5 | 11 | 69 |
| 02 — capacités (inventaire large) | 21 | 32 | 34 | 3 | 90 |
| 03 — capacités (inventaire large) | 19 | 35 | 25 | 4 | 83 |
| 04 — documentation publique | 36 | 38 | 43 | 3 | 120 |
| 05 — évolutions du successeur | 26 | 9 | 2 | 12 | 49 |
| **Total** | **152** | **117** | **109** | **33** | **411** |

Le produit de base (01, 05) est presque complet ; les écarts viennent surtout des inventaires larges : équipe et entreprise, canaux, voix, paiements.

## Plan de rattrapage (par vagues, une à la fois)

| Vague | Contenu |
|---|---|
| 1 (en cours) | Réactions, réponses et fils · vidéo (Higgsfield en priorité, OpenAI/Google en secours) · apprendre une compétence par démonstration |
| 2 (fait) | ✅ Gmail, Google Agenda, Drive, Outlook, Slack au catalogue · ✅ déclencheurs natifs (e-mail entrant, message Slack, événement à venir) · ✅ plusieurs comptes étiquetés par appli |
| 3 (fait) | ✅ Notifications push (Web Push) · ✅ le bot demande la prise de main (CAPTCHA, 2FA) et attend · ✅ coffre étendu (clés API en saisie sécurisée, codes TOTP, génération de mot de passe, import CSV) · ✅ épingles, sections, masquer, dupliquer, marquer non lu · ✅ palette de commandes et recherche dans la discussion |
| 4 (fait, sauf pages privées) | ✅ Fiabilité : modèles de secours ordonnés, nouvelles tentatives, reprise après coupure, messages de progression, rappels de travail bloqué, garde anti-boucle plus fine · ✅ bibliothèque de compétences et profil partagés entre bots · ✅ un bot qui crée des bots / se met à jour · ✅ recherche X · ⏳ pages privées/lien et éditions ciblées (reportées) |
| 5 | Mode « Auto » avec relecteur automatique et règles en langage naturel · routines : retard affiché, quotas, surveillance de commandes |
| 6 | Voix temps réel avec interruption (fournisseur vocal) · e-mail propre au bot · bots partagés entre plusieurs personnes, rôles, administration |
| 7 | Avec fournisseur externe : appels téléphoniques, réunions, paiements et cartes virtuelles · applis natives iOS / bureau |

## Vague 2 — ce qui est fait

| Élément | État | Où |
|---|---|---|
| Gmail, Google Agenda, Google Drive, Outlook (mail + agenda), Slack disponibles pour les bots | Fait — apps intégrées par les API REST officielles (Gmail API, Calendar API, Drive API, Microsoft Graph, Slack Web API), OAuth 2.0 code + PKCE (Google, Microsoft ; Slack : secret client) avec le client OAuth créé par l'utilisateur ; pas-à-pas vérifié dans l'interface | `server/src/native/` |
| Serveurs MCP officiels | Slack (MCP) ajouté au catalogue (client manuel). Google : Developer Preview réservée au programme ; Microsoft Work IQ : locataire professionnel + crédits Copilot — non retenus | `server/src/catalog.ts`, `server/src/native/vendors.ts` |
| Outils (lecture libre, écriture avec accord, contenu extérieur) | Fait — recherche/lecture/fil, brouillon, envoi, étiquette/archive ; agenda, disponibilités, créer/modifier/supprimer ; Drive recherche/lecture texte/envoi ; Slack canaux/lecture/publication/réaction. Après lecture, tout envoi demande l'accord | `server/src/native/tools.ts`, `judgeNative` dans `server/src/agent/loop.ts` |
| Déclencheurs natifs | Fait — nouvel e-mail (Gmail : recherche + `after:` ; Outlook : delta Graph), message Slack (Socket Mode + rattrapage par l'historique), événement dans N minutes ; une seule fois par élément (`native_seen`), rattrapage après coupure, historique `routine_runs` | `server/src/native/triggers.ts` |
| Plusieurs comptes étiquetés | Fait — « Gmail — perso », « Gmail — pro » : outils nommés par compte, routines liées à un compte, autorisations par compte | `server/src/native/accounts.ts` |
| Jetons | Scellés, renouvelés automatiquement, état « se reconnecter » avec bouton, déconnexion = révocation chez le fournisseur (Google, Slack) + oubli local | `server/src/native/accounts.ts` |
| Tests | `server/test/apps.test.ts` (faux Google / Microsoft / Slack locaux) | |

## Vague 3 — ce qui est fait

| Élément | État | Où |
|---|---|---|
| Notifications push (téléphone et ordinateur, appli fermée) | Fait — Web Push implémenté d'après les RFC 8030, 8291/8188 (chiffrement `aes128gcm`, vérifié sur l'exemple de la RFC 8291) et 8292 (VAPID ES256), sans bibliothèque ; clés VAPID générées une fois (privée scellée) ; envoi par `guardedFetch` ; abonnement par appareil, marche/arrêt par appareil, types (besoin de toi, pépite, réponse appli cachée, routine), heures calmes ; `sw.js` affiche et ouvre le bon bot ; consigne iOS (écran d'accueil, iOS 16.4+) | `server/src/push.ts`, `web/public/sw.js`, `web/src/lib/push.ts`, `web/src/components/NotificationsSection.tsx` |
| Le bot demande la prise de main et attend | Fait — outil `ask_takeover` (CAPTCHA, 2FA, connexion, paiement…), carte « Juno a besoin de toi sur son écran », écran en mode contrôle, « J'ai fini, rends-lui la main », 30 min puis le bot est prévenu ; push envoyé ; exclusivité côté serveur (actions d'écran du bot refusées pendant que l'utilisateur pilote) | `server/src/takeover.ts`, `server/src/vnc.ts`, `server/src/agent/tools.ts`, `web/src/components/Cards.tsx`, `ComputerViewer.tsx` |
| Coffre étendu | Fait — `secret_request` (carte sécurisée, valeur jamais vue du modèle), `secret_use` (en-tête HTTP, hôtes liés, https, sans redirection ; pas d'injection dans le shell, choix documenté), TOTP (RFC 6238, URI otpauth, code seulement sur le site lié, accord si contenu extérieur), `password_generate` (renvoie un nom, pas le mot de passe), import CSV (générique, Bitwarden, 1Password + correspondance manuelle), masquage exact de toutes les valeurs du coffre dans les résultats d'outils et la discussion | `server/src/agent/tools.ts`, `server/src/totp.ts`, `server/src/vault-import.ts`, `server/src/store.ts`, `web/src/components/VaultSection.tsx` |
| Organiser les bots | Fait — épingler, sections (créer/renommer/supprimer, glisser-déposer ou menu « Déplacer vers »), masquer/afficher (liste « Masqués »), dupliquer (souvenirs et discussion au choix), marquer non lu | `server/src/store.ts` (`sections`, `bots.duplicate`), `web/src/components/Sidebar.tsx`, `DuplicateBotModal.tsx` |
| Palette de commandes | Fait — Ctrl/Cmd+K ou bouton dans l'en-tête (mobile) : aller à un bot, chercher dans tous les messages, chercher dans la discussion (surlignage + suivant/précédent), commandes (nouveau bot, réglages, thème, ordinateur, chasse aux pépites…) | `web/src/components/CommandPalette.tsx`, `FindBar.tsx` |
| Tests | `server/test/wave3.test.ts` (faux service push et fausse API locaux, vecteurs RFC 8291 et RFC 6238) | |

## Vague 4 — ce qui est fait

| Élément | État | Où |
|---|---|---|
| Modèles de secours ordonnés | Fait — liste du compte (Réglages › Modèles, 5 au plus, réordonnable), liste propre à un bot (réglages du bot › Cerveau) ou `FALLBACK_MODELS` du serveur ; modèles non configurés écartés ; une ligne dans la discussion à chaque changement, la suite du tour reste sur le nouveau modèle | `server/src/agent/reliability.ts` (`modelChain`), `web/src/components/Reliability.tsx` |
| Nouvelles tentatives | Fait — erreurs passagères (429, 5xx, 529 surchargé, réseau) réessayées avec attente exponentielle + gigue, `Retry-After` respecté (au-delà de 60 s : modèle suivant) ; réponse commencée puis coupée : retirée proprement avant le nouvel essai ; nouvelles tentatives silencieuses du SDK Anthropic désactivées | `server/src/llm/types.ts` (`ProviderError`), `server/src/llm/anthropic.ts`, `openai-compat.ts` |
| Reprise après coupure | Fait — réponse coupée par la limite de sortie : suite automatique (3 par défaut, réglable) recousue dans le même message ; limite d'étapes : bouton « Continuer » (une fois) ; routine : reprend d'elle-même une fois ; réponse vide : une relance | `server/src/agent/loop.ts` |
| Messages de progression | Fait — outil `progress_update` (lignes légères, 1 toutes les 20 s au plus, pas comptées comme réponse), encouragé par le prompt pour les longues tâches | `server/src/agent/tools-team.ts`, `web/src/components/Transcript.tsx` |
| Rappels de travail bloqué | Fait — autorisation en attente, tour en cours ou attente de l'utilisateur > 4 h : un seul rappel (ligne + push) ; autorisations des tours sur abonnement : expirent après 30 min et dès un nouveau message | `server/src/agent/stuck.ts`, `waitForApproval` |
| Garde anti-boucle plus fine | Fait — même outil en échec 4 fois de suite, ou même résultat 4 fois de suite → arrêt avec explication (tours sur abonnement : « arrête-toi ») | `LoopGuard` |
| Bibliothèque de compétences partagée | Fait — compétence « partagée » visible de tous les bots (index du prompt, `skill_read`), `/skill nom` dans le champ de saisie (liste de choix), import depuis l'adresse d'un fichier markdown public (outil `skill_import` avec accord à chaque fois, ou import direct par l'utilisateur) | `server/src/store.ts` (`skills.available`), `web/src/components/Composer.tsx`, `BotSettings.tsx` |
| Profil partagé | Fait — Réglages › Profil (nom, fuseau, entreprise, préférences), outil `profile_update` (accord après contenu extérieur), injecté dans le prompt de chaque bot | `web/src/components/ProfileSection.tsx`, `server/src/agent/prompt.ts` |
| Un bot crée un bot / se met à jour | Fait — `bot_create` (accord toujours, 3 par jour, démarre « prudent », lien `createdBy`) ; `self_update` (consignes, apparence, familles d'outils ; jamais autonomie, modèle ni nom ; bouton « Annuler » ; accord pour réactiver un outil coupé et après contenu extérieur) | `server/src/agent/tools-team.ts`, table `bot_revisions` |
| Recherche X | Fait — `x_search` : API X v2 « recent search » avec `X_BEARER_TOKEN` (préférée), sinon outil `x_search` de l'API xAI (Responses) avec `XAI_API_KEY` ; résultats = contenu extérieur | `server/src/xsearch.ts` |
| Pages privées / éditions ciblées | Reporté à une vague suivante | |
| Tests | `server/test/wave4.test.ts` (faux modèles en panne/surchargés/coupés/muets, fausse API X, fausse API xAI, faux service push) | |

## Sklubot Relais (ton propre ordinateur) — ce qui est fait

| Élément | État | Où |
|---|---|---|
| Connexion du Relais | Fait — WebSocket `GET /api/relay/connect` sur le même serveur (un seul écouteur d'upgrade), `maxPayload` 5 Mio, pings, une connexion par appareil (4010), anti-inondation (4008), messages invalides fermés en 4400 sans jamais arrêter le serveur, refus des pages web (en-tête Origin), fonctionne derrière Caddy/Coolify en `wss://` (vérifié avec Caddy `tls internal`) | `server/src/relay.ts`, `server/src/vnc.ts` |
| Appairage | Fait — code de 8 caractères sans sosies, 10 min, usage unique, tapé dans Réglages › Ordinateurs (comparaison en temps constant, 5 essais / 10 min par compte), jeton aléatoire stocké haché, rotation à chaque connexion et toutes les 24 h (ancien jeton valable jusqu'à l'accusé), retrait = `revoke` + 4003 | `server/src/relay.ts`, `server/src/routes.ts`, `web/src/components/MyComputer.tsx` |
| Outils des bots | Fait — groupe « Mon ordinateur » (désactivable par bot) : capture envoyée au modèle en image, clic/double/droit/glisser/défilement, saisie, touches, ouvrir appli/adresse, fenêtres, commande, rendre la main ; `no_session` → `session.start` avec une raison ; aucune nouvelle tentative automatique sur un refus ; contenu de l'ordinateur = contenu extérieur | `server/src/agent/mycomputer.ts` |
| Double accord | Fait — carte d'accord de l'appli pour prendre le contrôle et pour chaque commande (la première fois ; toujours après du contenu extérieur ; pas de « Toujours » pour une commande après contenu extérieur), en plus des questions du Relais sur l'ordinateur | `server/src/agent/mycomputer.ts`, `server/src/agent/loop.ts` |
| Vue en direct et Stop | Fait — section « Mon ordinateur » du panneau et visionneuse plein écran : images relayées avec contrôle de flux de bout en bout (accusé quand le navigateur a affiché l'image), arrêt quand personne ne regarde, état (en ligne, en pause, verrouillé, question ouverte, bot aux commandes), bouton Stop à distance ; lignes dans la discussion (prise de contrôle, fin, Stop sur l'ordinateur, refus) | `web/src/components/MyComputer.tsx`, `server/src/relay.ts` |
| Notifications et journal | Fait — push « Mes ordinateurs » (relié, demande de contrôle, début/fin, Stop, commande exécutée) ; journal d'activité « Ordinateurs » (appairage, codes faux, sessions, chaque commande) | `server/src/relay.ts`, `server/src/agent/mycomputer.ts` |
| Tests | `server/test/relay.test.ts` (un faux Relais qui parle le vrai protocole au vrai serveur) ; `companion/test/e2e/sklubot-server.e2e.test.js` (le vrai Relais Electron sous Xvfb face au vrai serveur : appairage, capture, commande, Stop, retrait) | |

