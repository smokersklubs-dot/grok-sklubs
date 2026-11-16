# Mode hébergé (commercial)

Le mode hébergé transforme une installation Sklubot en **service vendu à d'autres personnes** : offres, abonnements,
budget IA par compte, limites, page d'administration, pages publiques (tarifs, CGU, mentions légales).

Tout est derrière **`HOSTED_MODE=1`**. Sans lui (valeur par défaut), Sklubot se comporte exactement comme une
installation personnelle : pas d'offre, pas de case à cocher, pas de limite, les routes du mode hébergé répondent
comme une adresse inconnue (404) et `/tarifs`, `/cgu`… affichent l'application comme n'importe quelle autre adresse
(`server/test/hosted-off.test.ts`, et toute la suite de tests, qui tourne mode éteint).

Code : `server/src/hosted.ts` (règles), `server/src/hostedroutes.ts` (routes), `server/src/hostedpages.ts` (pages
publiques), `server/src/billing/provider.ts` (paiement), `server/src/migrations/004-hosted.ts` (tables),
`web/src/components/Hosted.tsx` (écrans). Tests : `server/test/hosted.test.ts`, `hosted-off.test.ts`,
`isolation-hosted.test.ts` (la suite d'isolation entre comptes rejouée mode allumé).

## L'activer (Coolify)

1. Dans Coolify → ton application Sklubot → **Environment Variables**, ajoute `SKLUBOT_HOSTED_MODE` = `1`
   (`docker-compose.coolify.yml` le passe au serveur comme `HOSTED_MODE`). Sur un VPS installé avec l'installateur,
   ajoute `SKLUBOT_HOSTED_MODE=1` au fichier `.env` à côté de `docker-compose.vps.yml`.
2. Pour que des visiteurs puissent s'inscrire seuls, mets aussi `SKLUBOT_OPEN_SIGNUP=1`. Sinon, invite les gens avec
   un lien d'invitation (Administration → Invitations), qui fonctionne même inscriptions fermées.
3. **Redeploy**. La migration 4 (additive : nouvelles tables, trois colonnes, les trois offres par défaut) passe au
   démarrage, après une copie automatique de la base.
4. Connecte-toi avec ton compte (le plus ancien du serveur : il est **opérateur**, sans offre ni limite).
   Réglages → **Administration** :
   - **Offres** : vérifie les prix, budgets IA et limites des offres « Gratuit », « Tout inclus », « J'apporte ma clé ».
   - **Réglages** : taux USD → EUR, jours d'essai, jours de grâce, budget pendant l'essai, adresse de contact
     (`mailto:` ou `https://`, utilisée par les boutons « Changer d'offre » / « Recharger »), offre par défaut,
     abonnements Claude Code / Codex des clients, estimations des services sans prix, **informations légales**.
   - **Clés prêtées** : prête un de tes fournisseurs d'API (par exemple DeepSeek, ajouté dans Réglages → Modèles) aux
     comptes « Gratuit » / « Tout inclus ».
5. Ouvre `/tarifs`, `/cgu` et `/mentions-legales` pour relire. **Les pages légales sont des modèles** marqués
   « Brouillon — à faire valider par un professionnel » : remplis les champs [À COMPLÉTER] et fais-les relire avant
   d'encaisser quoi que ce soit.

## Comment ça marche

### Comptes et rôles
- **Opérateurs** : la personne propriétaire (le compte le plus ancien) et les comptes qu'elle nomme opérateurs
  (Administration → Clients → Gérer → « Opérateur du serveur » ; colonne `users.server_role`). Ils voient
  l'administration, n'ont ni offre ni limite, et leurs dépenses ne sont comptées dans aucun budget.
- **Clients** : tous les autres comptes, avec une offre et un statut. Un compte créé avant l'activation du mode
  hébergé reçoit l'offre « Gratuit » la première fois qu'il est regardé ; change-la dans Administration.

### Offres (modifiables, Administration → Offres)
| Type | Clés d'IA | Budget | Défaut |
|---|---|---|---|
| `free` (Gratuit) | celles du service (`.env` du serveur, ou tes fournisseurs prêtés) | petit budget mensuel en € | 2 €, 2 bots, 1 ordinateur allumé, 1 Go, 3 routines |
| `included` (Tout inclus) | celles du service | budget mensuel en € | 39 €/mois, 20 € d'IA, 10 bots, 2 ordinateurs, 10 Go, 30 routines |
| `byok` (J'apporte ma clé) | **uniquement celles du client** (Réglages → Modèles) — jamais celles du service | aucun | 15 €/mois, mêmes limites |

Les prix par défaut sont des **exemples à remplacer**.

### Inscription
Le formulaire propose les offres publiques et une case **« J'accepte les CGU »** obligatoire (refusée côté serveur sans
elle). « Gratuit » démarre actif ; une offre payante démarre en **essai** (`trialDays`, 14 par défaut ; budget IA
plafonné à `trialBudgetEur` pendant l'essai). Un lien d'invitation (`/?plan_invite=…`) fixe l'offre, peut être lié à
une adresse, ne sert qu'une fois. « Continuer avec Google » suit les mêmes règles.

### Statuts (le planificateur les fait avancer toutes les 10 minutes)
`trial` → fin de l'essai : `active` si un paiement couvre la suite, sinon `past_due` → après `graceDays` (7 par défaut)
sans paiement : `suspended`. `active` avec une date de fin payée → `past_due` à cette date. « Gratuit » n'expire jamais.
Chaque changement : une ligne au journal d'administration, une au journal du compte, une notice dans son chat.

**Suspendu = lecture seule** : connexion, consultation, export, changement de mot de passe / adresse, suppression du
compte restent possibles ; tout le reste est refusé (403 clair) ; aucun bot ne tourne, les routines sont sautées
(notées « skipped »), les objectifs se mettent en pause.

### Budget IA et coupure
- Chaque ligne de consommation dit qui paie (`usage.payer`) : `operator` (clés du service, fournisseurs prêtés,
  images, vidéos, voix et outils tiers payants faits avec les clés du serveur), `own` (clé du client), `subscription`
  (abonnement Claude / ChatGPT du client).
- Le budget du mois civil (UTC) = budget de l'offre + recharges du mois. Les dépenses `operator` sont converties avec
  le taux USD → EUR ; un prix inconnu compte à son estimation prudente (`est_cost_usd`), comme partout dans Sklubot.
  Images, vidéos sans prix annoncé et voix comptent aux **estimations de l'opérateur** (Réglages), qui ne sont pas des
  prix de fournisseur.
- **Coupure nette** : quand le budget est atteint, l'appel suivant sur les clés du service n'a pas lieu (même au milieu
  d'un tour). Le tour s'arrête avec une carte : « Recharger / changer d'offre », « Utiliser ma propre clé », ou
  attendre le 1er du mois suivant (date affichée). Si la chaîne de modèles du bot contient une clé du client, elle
  prend le relais. Le travail de fond (routines, objectifs, mémoire, points quotidiens, titres) s'arrête de la même
  façon, avec une seule notice par jour.
- **Recharge** : Administration → Clients → Gérer → « Recharger le budget IA de ce mois ».

### Abonnements Claude Code / Codex
L'abonnement personnel de l'opérateur n'est **jamais** utilisé par les bots d'un autre compte : un bot « abonnement »
tourne toujours avec la connexion faite sur l'ordinateur de son propre compte, et en mode hébergé un membre d'un espace
d'équipe d'un autre compte ne peut pas le faire travailler (carte « engines »). L'opérateur peut aussi interdire
complètement aux clients d'utiliser leur propre abonnement (Réglages → case dédiée).

### Limites (appliquées côté serveur)
Bots, routines actives, ordinateurs allumés en même temps (l'ordinateur inactif du compte se met en veille d'abord) et
stockage (bibliothèques des bots et dossier d'équipe sur le serveur). Au-delà : refus clair en français ou en anglais
(`code: "plan_limit"`, `limit`), avec la façon d'avancer (supprimer, mettre en pause, changer d'offre).

## Paiement

Aucun fournisseur n'est choisi. Le seul branché est **manuel** : Administration → Clients → Gérer → « Paiement reçu »
(actif jusqu'à une date, référence facultative). Le planificateur fait le reste (retard, suspension).

### Brancher un fournisseur de paiement (Stripe ou Paddle)
Interface : `server/src/billing/provider.ts` (`PaymentProvider`). Étapes :
1. Écrire `server/src/billing/stripe.ts` ou `paddle.ts` **à partir de la documentation officielle uniquement**
   (citer chaque point d'API et en-tête en commentaire, comme le reste du dépôt). Rien dans le code actuel ne suppose
   une API de fournisseur.
2. `verifyWebhook` : vérifier la signature du corps brut avec le secret de signature (variable d'environnement, jamais
   en base) ; signature fausse → 400.
3. `handleWebhook` : traduire les événements en changements (`BillingChange` : compte, statut, payé jusqu'au,
   référence externe). Les appliquer avec les mêmes fonctions que la page d'administration
   (`adminActions.markPaid`, `setStatus`), après avoir inscrit l'identifiant de l'événement dans la table
   `billing_events` (un même événement reçu deux fois ne change rien la seconde fois).
4. Facultatif : `checkoutUrl` pour envoyer le client vers la page de paiement du fournisseur à la place de l'adresse de
   contact.
5. L'enregistrer dans `PROVIDERS`. D'ici là, `POST /api/billing/webhook/stripe` et `/paddle` répondent **501** et ne
   changent rien.

À savoir pour choisir : Paddle agit comme revendeur officiel (il gère la TVA européenne) ; avec Stripe, la TVA est à
gérer (Stripe Tax). À vérifier dans leurs conditions actuelles.

## Décisions qui restent à la propriétaire / au propriétaire
- **Prix** et contenu des offres (les valeurs par défaut sont des exemples), taux USD → EUR, estimations.
- **Informations légales** : raison sociale, forme, capital, adresse, SIREN/SIRET/RCS, TVA, directeur·rice de la
  publication, hébergeur, médiateur de la consommation, conditions de résiliation, TVA (TTC/HT), et **relecture
  juridique** des CGU / CGV et des mentions légales. La politique de confidentialité (`/confidentialite`) décrit
  encore une installation personnelle : à compléter pour le service (sous-traitants : fournisseurs de modèles,
  hébergeur, paiement).
- **Fournisseur de paiement** (Stripe, Paddle ou autre) et facturation (factures numérotées).
- Vérifier les **conditions d'utilisation commerciale** des fournisseurs de modèles et des outils Claude Code / Codex.

## Routes (toutes en 404 quand `HOSTED_MODE` n'est pas à 1)
| Route | Qui | Rôle |
|---|---|---|
| `GET /api/plans` | public | offres proposées (formulaire d'inscription) |
| `GET /api/plan-invites/:token` | public (le jeton est le secret) | offre d'une invitation |
| `POST /api/billing/webhook/:provider` | public | `stripe`, `paddle` → 501 tant qu'aucun adaptateur n'existe |
| `GET /api/billing` | compte connecté | « Mon abonnement » |
| `GET /api/admin/overview`, `/admin/customers`, `/admin/plans`, `/admin/settings`, `/admin/invites`, `/admin/audit` | opérateurs | lecture |
| `PUT /api/admin/customers/:uid/plan`, `/status`, `/operator` ; `POST …/paid`, `…/credit`, `…/trial` | opérateurs (`/operator` : propriétaire seulement) | actions sur un client, chacune journalisée |
| `POST /api/admin/plans`, `PUT /api/admin/plans/:planId`, `PUT /api/admin/settings` | opérateurs | offres et réglages |
| `POST /api/admin/invites`, `DELETE /api/admin/invites/:inviteId` | opérateurs | liens d'invitation avec offre |
| `PUT /api/admin/providers/:pid/lend` | opérateurs | prêter un de ses fournisseurs d'API |
| `/tarifs`, `/pricing`, `/cgu`, `/terms`, `/mentions-legales`, `/legal-notice` | public | pages sans script, CSP stricte |

Inscription : `POST /api/auth/signup` accepte en plus `plan`, `planInvite` et `acceptTerms` (obligatoire en mode
hébergé, sauf pour le tout premier compte) ; `POST /api/auth/google/start` les transmet de la même façon.
