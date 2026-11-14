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
| 3 | Notifications push (Web Push) · le bot demande la prise de main (CAPTCHA, 2FA) et attend · coffre étendu (clés API en saisie sécurisée, codes TOTP, génération de mot de passe, import CSV) · épingles, sections, masquer, dupliquer, marquer non lu · palette de commandes et recherche dans la discussion |
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
