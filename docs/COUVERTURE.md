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
| 4 | Fiabilité : modèles de secours ordonnés, nouvelles tentatives, reprise après coupure, messages de progression, rappels de travail bloqué, garde anti-boucle plus fine · pages privées/lien et éditions ciblées · bibliothèque de compétences et profil partagés entre bots · un bot qui crée des bots / se met à jour · recherche X |
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

