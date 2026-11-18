# Ouvrir Sklubot au public (phase 1)

Ce guide est pour la personne qui gère le serveur. Il explique comment ouvrir les inscriptions à tout le monde, sur
**un seul serveur**, sans mauvaise surprise : page d'accueil publique, vérification **obligatoire** de l'adresse e-mail, protection
anti-robot, offre Gratuite dimensionnée pour un serveur, et première prise en main guidée.

**Rien ne change tant que tu n'actives rien.** Sans `OPEN_SIGNUP=1` et sans `HOSTED_MODE=1` (les valeurs par défaut),
Sklubot se comporte exactement comme avant : pas de page d'accueil, pas de vérification, pas de Turnstile, pas
d'ordinateurs gratuits (`server/test/public-signup-off.test.ts` le vérifie).

Code : `server/src/publicsignup.ts` (page d'accueil, Turnstile, limites, vérification obligatoire, nettoyage des comptes
non confirmés, première prise en main), `server/src/freecomputers.ts` (ordinateurs gratuits),
`server/src/migrations/013-public-signup.ts`, `014-email-gate.ts`,
`web/src/components/Landing.tsx`, `Turnstile.tsx`, `VerifyEmail.tsx`, `Onboarding.tsx`.
Tests : `server/test/public-signup.test.ts`, `public-signup-off.test.ts`, `google-login.test.ts`, `free-computers.test.ts`,
et la suite d'isolation (`isolation.test.ts`, rejouée en mode hébergé : elle vérifie route par route qu'un compte non
confirmé reçoit 403 partout sauf sur les routes permises). Captures : `docs/screenshots/ouverture-publique/`.

## Ce que ça active

| Interrupteur | Effet |
|---|---|
| `OPEN_SIGNUP=1` | Inscriptions ouvertes ; **page d'accueil publique** sur `/` pour les visiteurs non connectés (sinon : l'écran de connexion habituel) ; limites d'inscription ; liste d'adresses jetables ; Turnstile si ses clés sont là ; première prise en main guidée. |
| `HOSTED_MODE=1` | Offres et abonnements (voir [MODE-HEBERGE.md](MODE-HEBERGE.md)) ; les tarifs s'affichent sur la page d'accueil ; l'offre Gratuite passe sur les **ordinateurs gratuits**. |
| L'un des deux ci-dessus | **Vérification obligatoire de l'adresse e-mail** des nouveaux comptes (voir « Ce que voit un visiteur »). Il faut un compte SMTP : **sans SMTP, les inscriptions par e-mail et mot de passe sont refusées** (seul « Continuer avec Google » marche) et la page Surveillance affiche une alerte **critique** (avertissement en mode hébergé seul). |
| `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (avec `OPEN_SIGNUP=1`) | Vérification anti-robot Cloudflare Turnstile sur le formulaire d'inscription. |

## L'activer sur Coolify

Dans Coolify → ton application Sklubot → **Environment Variables** (le fichier `docker-compose.coolify.yml` transmet
chaque variable `SKLUBOT_…` au serveur ; sur un VPS installé avec l'installateur, mets-les dans le `.env` à côté de
`docker-compose.vps.yml`).

1. **Inscriptions et mode hébergé**
   - `SKLUBOT_OPEN_SIGNUP` = `1`
   - `SKLUBOT_HOSTED_MODE` = `1` (si tu vends des offres ; sinon laisse `0`, la page d'accueil s'affiche sans tarifs)
2. **E-mails du serveur (obligatoire : sans eux, personne ne peut s'inscrire par e-mail)**
   - `SKLUBOT_SMTP_HOST`, `SKLUBOT_SMTP_PORT` (465 ou 587), `SKLUBOT_SMTP_TLS` (`tls` pour 465, `starttls` pour 587),
     `SKLUBOT_SMTP_USER`, `SKLUBOT_SMTP_PASS`, `SKLUBOT_SMTP_FROM` (l'adresse d'expédition).
   - Ou, sans variables : connecte-toi avec ton compte (le premier du serveur) → Réglages → Compte → E-mails du serveur.
   - Envoie-toi un **e-mail de test** depuis ce même écran.
3. **Turnstile (anti-robot)**
   - Tableau de bord Cloudflare → **Turnstile** → **Add widget** : nomme-le « Sklubot », ajoute ton domaine (celui de
     `PUBLIC_URL`), mode **Managed**. Cloudflare te donne une **Site Key** et une **Secret Key**.
   - `SKLUBOT_TURNSTILE_SITE_KEY` = la Site Key, `SKLUBOT_TURNSTILE_SECRET_KEY` = la Secret Key.
   - La clé secrète ne quitte jamais le serveur : le navigateur ne reçoit que la Site Key. Chaque jeton est vérifié côté
     serveur par l'API Siteverify de Cloudflare (`https://challenges.cloudflare.com/turnstile/v0/siteverify`, voir la
     [documentation officielle](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)) ; si
     Cloudflare ne répond pas, l'inscription est refusée (« réessaie dans une minute »), jamais acceptée sans contrôle.
   - La politique de sécurité (CSP) de l'application autorise alors `https://challenges.cloudflare.com` pour le script
     et le cadre du widget, et seulement dans ce cas.
4. **« Continuer avec Google »** (facultatif)
   - Console Google Cloud → API et services → Identifiants → **ID client OAuth** (application Web). URI de redirection
     autorisée : `https://<ton domaine>/api/auth/google/callback`.
   - `SKLUBOT_GOOGLE_LOGIN_CLIENT_ID` et `SKLUBOT_GOOGLE_LOGIN_CLIENT_SECRET` (ou Réglages → Compte → Connexion avec
     Google). Un compte créé avec Google compte comme **vérifié** (Google confirme l'adresse) : c'est aussi le moyen
     de confirmer tout de suite depuis l'écran « Confirme ton adresse e-mail » (même adresse). Les limites
     d'inscription et la liste d'adresses jetables s'appliquent aussi ; Turnstile non (le widget ne peut pas être sur
     la page de Google, et la connexion Google est déjà une preuve).
5. **Redeploy.** Les migrations 13 et 14 passent au démarrage, après une copie automatique de la base. Elles sont
   additives : les comptes qui existent déjà sont **considérés comme vérifiés** et n'ont pas de première prise en main.
   Le compte du propriétaire (le plus ancien) n'est jamais bloqué.

## Réglages conseillés pour un seul serveur

| Variable | Défaut | Conseil |
|---|---|---|
| `SKLUBOT_SIGNUP_PER_IP` | 5 | Inscriptions tentées par adresse IP et par quart d'heure. |
| `SKLUBOT_SIGNUP_GLOBAL` | 30 | Inscriptions tentées en tout par quart d'heure. Baisse-le (10) les premiers jours. |
| `SKLUBOT_DISPOSABLE_EMAIL_BLOCK` | actif | `0` pour accepter les adresses jetables (liste courte intégrée, dans `publicsignup.ts`). |
| `SKLUBOT_EMAIL_VERIFICATION` | actif | `0` pour ne pas vérifier les adresses. **Risqué** sur un serveur public : n'importe qui peut s'inscrire avec l'adresse d'un autre et utiliser Sklubot aussitôt (spam, abus, comptes jetables qui coûtent du budget IA). La Surveillance le signale. |
| `SKLUBOT_UNVERIFIED_ACCOUNT_TTL_HOURS` | 5 | Heures avant qu'un compte jamais confirmé soit **supprimé automatiquement** (1 à 720). |
| `SKLUBOT_FREE_PLAN_COMPUTER` | (pool) | `personal` pour revenir à l'ancien fonctionnement (un ordinateur personnel par compte Gratuit). |
| `SKLUBOT_FREE_COMPUTERS_MAX` | 1 | Ordinateurs gratuits allumés **en même temps sur tout le serveur**. `0` : l'offre Gratuite n'a aucun ordinateur (outils web seulement). |
| `SKLUBOT_FREE_COMPUTER_IDLE_MIN` | 5 | Minutes sans usage avant qu'un ordinateur gratuit soit effacé. |
| `SKLUBOT_FREE_COMPUTER_MEMORY` / `_CPUS` | 1g / 1 | Taille d'un ordinateur gratuit (un ordinateur payant garde `DESKTOP_MEMORY`, 2 Go par défaut). |
| `MAX_DESKTOPS` | 4 | Ordinateurs allumés en tout (payants + gratuits). Sur 8 Go de mémoire : 3, avec 1 gratuit. |

Dans **Administration → Offres** (mode hébergé), pour l'offre « Gratuit » : 1 ou 2 bots, 3 routines, 1 Go, un petit
budget IA (2 €). Prête-lui un fournisseur bon marché (Administration → Clés prêtées) plutôt que tes clés les plus chères.

### Les ordinateurs gratuits : comment ça marche, et pourquoi

Un ordinateur garde tout : profil du navigateur, connexions, téléchargements, ce qu'un bot a installé. Partager un même
ordinateur entre inconnus ferait passer tout ça d'un compte à l'autre, et on ne peut pas « brancher » le dossier
personnel d'un autre compte dans un ordinateur déjà allumé. Donc, en mode hébergé, un compte **Gratuit** :

- n'a **pas d'ordinateur personnel** ; quand un de ses bots en a besoin, il reçoit un **ordinateur jetable**, à lui seul
  (un conteneur par bot, même image et mêmes protections que les autres : droits réduits, réseau isolé), plus petit ;
- cet ordinateur est **effacé** (conteneur et dossier personnel) après quelques minutes sans usage, quand sa place va à
  quelqu'un d'autre, ou au redémarrage du serveur. Seule la bibliothèque du bot (ses fichiers, comptés dans le stockage
  de l'offre) est gardée, comme pour tout bot ;
- au plus `FREE_COMPUTERS_MAX` existent en même temps. Un bot qui en demande un quand tout est pris **attend**
  (`COMPUTER_WAIT_SEC`, 90 s par défaut) ; un ordinateur gratuit libre depuis 30 s est alors effacé et lui est donné.
  Sinon, il reçoit un message clair (« les ordinateurs gratuits sont tous occupés, réessaie dans quelques minutes, ou
  change d'offre ») qu'il transmet ;
- les abonnements Claude Code / Codex ne sont pas disponibles sur l'offre Gratuite (leur connexion ne survivrait pas à
  l'effacement) ; les bots utilisent les modèles d'API du service.

Les offres payantes et les opérateurs gardent leur ordinateur personnel (et leurs ordinateurs partagés), comme avant.
Un client qui passe d'une offre Gratuite à une offre payante retrouve son ordinateur personnel aussitôt.

## Ce que voit un visiteur

1. **Page d'accueil** (`/`) : présentation, fonctionnement en 3 étapes, la vraie galerie de modèles d'équipe, les
   tarifs (mode hébergé), la sécurité, les questions fréquentes, et les liens CGU, mentions légales, confidentialité.
   Français par défaut, anglais d'un clic, clair et sombre. Les liens d'invitation (`/?invite=…`, `/?plan_invite=…`)
   ouvrent directement le formulaire.
2. **« Connexion ou inscription »** (un seul écran) : « Continuer avec Google » en premier (s'il est configuré), puis
   l'adresse e-mail → mot de passe **ou** « Recevoir un lien de connexion par e-mail » (le même écran pour toutes les
   adresses : rien ne dit si un compte existe). Le lien (15 min, une fois, empreinte SHA-256 seulement, 3 demandes par
   adresse et 10 par IP par quart d'heure, Turnstile et adresses jetables vérifiés pour tout le monde) connecte un compte,
   ou en crée un pour une adresse nouvelle après une dernière étape (prénom + CGU en mode hébergé) — l'adresse est alors
   vérifiée. « Créer un compte avec un mot de passe » reste là (e-mail, mot de passe, CGU, Turnstile). La double
   authentification s'applique partout.
3. **Vérification obligatoire** (« compte obligatoire, sinon ça ne fonctionne pas ») : un e-mail avec un lien (une seule
   fois ; seule son empreinte SHA-256 est gardée). Tant qu'il n'est pas ouvert, le compte peut se connecter mais ne voit
   **que** l'écran « Confirme ton adresse e-mail » : l'adresse, l'heure de suppression (« Sans confirmation, ce compte
   sera supprimé à HH:MM »), « J'ai confirmé », « Renvoyer l'e-mail » (3 fois par quart d'heure au plus), « Continuer
   avec Google » (même adresse : confirmée aussitôt), « Changer d'adresse » (avec le mot de passe : le lien part à la
   nouvelle adresse et la confirme) et « Se déconnecter ». L'écran se met à jour seul quand le lien est ouvert ailleurs.
   - **Côté serveur, pas seulement dans l'interface** : le contrôle de session (`routes.ts`) répond
     `403 { code: "email_unverified" }` à **toutes** les routes, sauf : `GET /api/me`, `/api/auth/…` (dont la
     déconnexion et `POST /api/auth/verify-email`), `POST /api/account/verify-email/resend`, `GET`/`POST
     /api/account/email` et `DELETE /api/account/email/pending` (changer d'adresse), `DELETE /api/account` (supprimer
     son compte), `GET /api/export/data` (ses données), `PUT /api/prefs` (la langue). La voix, le relais et l'écran des
     ordinateurs (WebSockets) refusent aussi le compte.
   - **Aucun bot avant la confirmation** : le premier bot (nom et rôle choisis à l'inscription, gardés dans
     `users.first_bot`) est créé au moment où l'adresse est prouvée (lien, Google ou changement d'adresse confirmé) ;
     la première prise en main vient ensuite.
   - **Nettoyage** : un compte toujours pas confirmé `UNVERIFIED_ACCOUNT_TTL_HOURS` heures (5 par défaut) après son
     inscription est **supprimé** avec ses données, par un passage toutes les 10 minutes (donc au plus ~10 min après
     l'heure affichée). Chaque suppression s'inscrit dans l'activité du propriétaire et dans le journal du serveur. Le
     lien de l'e-mail est valable jusqu'à cette échéance, pas plus : **un renvoi ne repousse pas l'échéance** (elle part
     toujours de l'inscription).
   - **Sans SMTP** : aucun lien ne peut partir, donc les inscriptions par e-mail et mot de passe sont refusées
     (« Les inscriptions par e-mail sont fermées tant que les e-mails du serveur ne sont pas réglés — utilise Continuer
     avec Google ») ; « Continuer avec Google » marche toujours. Un compte déjà en attente quand le SMTP disparaît reste
     bloqué (Google le débloque, sinon il est supprimé à l'échéance).
   - `EMAIL_VERIFICATION=0` coupe tout ça (choix explicite de l'opérateur, risqué : voir les réglages plus haut).
4. **Première prise en main** (« Passer » à tout moment) : en mode hébergé, « Choisis comment tes bots travaillent »
   (abonnement Claude/ChatGPT, clé d'API ou crédits — voir MODE-HEBERGE.md) ; « Active les notifications » (Web Push,
   avec les cas bloqué, iPhone sans l'icône sur l'écran d'accueil et navigateur sans notifications ; demandé une seule
   fois : la réponse est gardée sur le serveur, `users.push_prompt`, et « Plus tard » laisse un seul rappel sur
   Aujourd'hui) ; un modèle d'équipe ou « un seul assistant », son nom et son rôle, puis une première tâche proposée. Les bots créés sont prudents : compétences en
   brouillon, routines en pause, modèle par défaut du compte, dans la limite de l'offre.

## À vérifier avant d'ouvrir

- [ ] `PUBLIC_URL` est l'adresse publique en `https://` (les liens des e-mails et la vérification Turnstile en dépendent).
- [ ] Un e-mail de test arrive (Réglages → Compte → E-mails du serveur), et pas dans les indésirables (SPF/DKIM du domaine
      d'expédition).
- [ ] Inscris-toi toi-même avec une autre adresse, dans une fenêtre privée : le widget Turnstile s'affiche, l'e-mail
      arrive, l'écran de confirmation affiche l'heure de suppression, le lien confirme, l'application s'ouvre, la
      première prise en main fonctionne. Essaie aussi une route de l'API avant de confirmer : 403 `email_unverified`.
- [ ] La page **Surveillance** n'affiche ni « Inscriptions par e-mail fermées », ni « sans vérification d'adresse », ni
      « sans vérification anti-robot ».
- [ ] Mode hébergé : offres, prix et limites relus (Administration → Offres) ; **CGU, mentions légales et politique de
      confidentialité complétées et relues par un professionnel** (les modèles sont des brouillons, voir
      [MODE-HEBERGE.md](MODE-HEBERGE.md)) ; adresse de contact remplie.
- [ ] `MAX_DESKTOPS` et `FREE_COMPUTERS_MAX` tiennent dans la mémoire du serveur (chaque ordinateur payant : 2 Go ;
      gratuit : 1 Go), avec de la marge pour Sklubot lui-même.
- [ ] Sauvegarde automatique active et testée ([SAUVEGARDE.md](SAUVEGARDE.md)).
- [ ] Les alertes de la Surveillance t'arrivent (Réglages → Surveillance).

## Variables, en résumé

| Variable du serveur (Coolify : préfixe `SKLUBOT_`) | Rôle |
|---|---|
| `OPEN_SIGNUP` | `1` : inscriptions ouvertes et page d'accueil publique |
| `HOSTED_MODE` | `1` : offres, abonnements, tarifs, ordinateurs gratuits |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Turnstile (les deux, ou rien) |
| `SIGNUP_PER_IP`, `SIGNUP_GLOBAL` | limites d'inscription par quart d'heure |
| `DISPOSABLE_EMAIL_BLOCK` | `0` : accepte les adresses jetables |
| `EMAIL_VERIFICATION` | `0` : pas de vérification d'adresse (risqué) |
| `UNVERIFIED_ACCOUNT_TTL_HOURS` | heures avant la suppression d'un compte non confirmé (défaut 5) |
| `FREE_PLAN_COMPUTER` | `personal` : ancien fonctionnement de l'offre Gratuite |
| `FREE_COMPUTERS_MAX`, `FREE_COMPUTER_IDLE_MIN`, `FREE_COMPUTER_MEMORY`, `FREE_COMPUTER_CPUS` | ordinateurs gratuits |
| `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET` | « Continuer avec Google » |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | e-mails du serveur |

## Routes ajoutées

| Route | Qui | Rôle |
|---|---|---|
| `GET /api/public/landing` | public, seulement avec `OPEN_SIGNUP=1` (sinon 404) | modèles (titres, descriptions, apparences), offres, présence de Turnstile et de la vérification |
| `POST /api/auth/verify-email` | public (le jeton est le secret ; même origine exigée) | confirme l'adresse (et crée le premier bot) ; ne connecte personne |
| `POST /api/account/verify-email/resend` | compte connecté | renvoie le lien (3 par quart d'heure) |
| `POST /api/onboarding/commit`, `POST /api/onboarding/skip` | compte connecté, une seule fois | première prise en main (`commit` accepte `label`, le rôle du premier bot) |
| `POST /api/auth/email-link`, `POST /api/auth/email-link/use` | public (même origine ; le jeton est le secret) | lien de connexion / d'inscription par e-mail (`server/src/emaillink.ts`) |
| `POST /api/auth/google/pending`, `POST /api/auth/google/finish` | public (jeton à usage unique) | mode hébergé : l'étape CGU après Google pour un nouveau compte |
| `PUT /api/account/push-prompt` | compte connecté | `later` / `enabled` / `dismissed` (« Active les notifications ») |

`POST /api/auth/signup` accepte en plus `turnstileToken` ; sans SMTP (vérification active), il répond
`403 { code: "email_signup_closed" }`. `GET /api/me` ajoute `landing` et `turnstileSiteKey` quand c'est utile, et
l'utilisateur porte `emailUnverified` + `emailVerifyDeadline` (heure de suppression, en ms) / `onboarding` seulement
quand c'est vrai. Toute autre route répond `403 { code: "email_unverified" }` à un compte non confirmé.
