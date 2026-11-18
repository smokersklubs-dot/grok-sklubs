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

Pour ouvrir le service à tout le monde (page d'accueil publique, vérification des adresses e-mail, Turnstile, ordinateurs
gratuits de l'offre « Gratuit », première prise en main), voir [OUVERTURE-PUBLIQUE.md](OUVERTURE-PUBLIQUE.md).

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
| `free` (Gratuit) | celles du service (`.env` du serveur, ou tes fournisseurs prêtés) | petit budget mensuel en € | 2 €, 2 bots, ordinateurs gratuits jetables (voir OUVERTURE-PUBLIQUE.md), 1 Go, 3 routines |
| `included` (Tout inclus) | celles du service | budget mensuel en € | 39 €/mois, 20 € d'IA, 10 bots, 2 ordinateurs, 10 Go, 30 routines |
| `byok` (J'apporte ma clé) | **uniquement celles du client** (Réglages → Modèles) — jamais celles du service | aucun | 15 €/mois, mêmes limites |

Les prix par défaut sont des **exemples à remplacer**.

### Inscription (« Connexion ou inscription »)
Un seul écran pour se connecter et s'inscrire : **« Continuer avec Google »** en premier (bouton plein, seulement si
Google est configuré), puis l'adresse e-mail → **le même écran pour tout le monde** (on ne dit jamais si un compte
existe) : le mot de passe, ou **« Recevoir un lien de connexion par e-mail »** (`server/src/emaillink.ts` : lien unique,
15 minutes, seule son empreinte SHA-256 est gardée ; pour une adresse nouvelle, le lien crée le compte après une
dernière étape : prénom + case CGU), « Mot de passe oublié ? », et « Créer un compte avec un mot de passe ». La double
authentification s'applique à toutes ces entrées. Plus de choix d'offre : **tout le monde démarre sur l'offre par
défaut** (`signupDefaultPlan`, « Gratuit ») ; un lien `?plan=` ou une invitation `/?plan_invite=…` fixe encore l'offre.
La case **CGU** reste obligatoire (refusée côté serveur sans elle) ; avec Google, si elle n'a pas été cochée, **le compte
n'est pas créé** au retour de Google : une étape (prénom repris de Google + case CGU) le crée
(`/api/auth/google/pending`, `/api/auth/google/finish`). Une offre payante démarre en **essai** (`trialDays`, budget
IA plafonné à `trialBudgetEur`). « Le premier bot » se nomme pendant la première prise en main, plus à l'inscription.
Pas de connexion par SMS ni par Apple pour l'instant.

### Crédits (Réglages → Crédits)
Le compte est gratuit ; pour que les bots travaillent, la personne choisit (première étape de la prise en main, puis
Réglages → Crédits) : **son abonnement Claude ou ChatGPT** (connexion sur l'ordinateur de son bot : réglages du bot →
Cerveau ; mets `FREE_PLAN_COMPUTER=personal` pour que la connexion reste), **sa clé d'API** (Réglages → Modèles), ou
**des crédits** prépayés en € dépensés sur les clés d'IA du service. Code : `server/src/credits.ts`,
`server/src/billing/paddle.ts`, `hosted.ts` (« Prepaid credits »), migration 21, `web/src/components/Credits.tsx`.
- **Ordre de dépense** chaque mois : le budget de l'offre (0 € pour « Gratuit »), puis les recharges du mois, puis les
  crédits. Les crédits **ne s'arrêtent pas à la fin du mois** (le reste est reporté). Sans crédit, la carte d'arrêt
  propose « Acheter des crédits », « Connecter mon abonnement », « Utiliser ma propre clé ».
- **Packs** : Administration → Réglages → Crédits (5, 10, 20 € par défaut ; de 1 à 6 montants). Le client envoie un
  identifiant de pack, jamais un montant.
- **À la main** : Administration → Clients → Gérer → « Ajouter des crédits IA » (case « Crédits durables » cochée :
  ils se reportent ; décochée : budget de ce mois seulement, comme avant).
- **Sans Paddle** (tant que les variables ne sont pas posées) : les boutons « Acheter » affichent « Paiement en ligne
  bientôt disponible » et ton adresse de contact.
- **Remboursements** : un remboursement (ou une contestation bancaire) **approuvé** par Paddle retire du solde les
  crédits correspondants **encore disponibles**, une seule fois, jamais plus que le pack payé. Ce qui a déjà été
  dépensé sur les clés d'IA du service ne peut pas être repris : le solde reste à 0 € et le journal d'administration
  affiche une ligne « refund-unrecovered » avec le montant. Un remboursement « en attente d'approbation » ne change rien
  (ligne « refund-pending ») ; une contestation finalement gagnée (« chargeback_reverse ») n'est **pas** recréditée
  automatiquement (ligne « refund-reversed ») : à toi de décider avec « Ajouter des crédits IA ».

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
- **Plafonds d'usage par client** (Administration → Clients → Gérer) : par jour ou par mois, en dollars ou en tokens,
  sur ce que paient les clés du service ; ils s'ajoutent au budget de l'offre sans le remplacer. Le client les voit
  et ne peut pas les changer. Voir `docs/PLAFONDS.md`.

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

### Crédits payés par Paddle (revendeur officiel)
Paddle est le **vendeur officiel** (« merchant of record ») des crédits : c'est lui qui vend au client en son nom,
encaisse, facture, applique la TVA et verse ensuite l'argent sur ton compte bancaire (moins ses frais). Ses propres
conditions (pays acceptés, activités autorisées, vérification de l'entreprise, frais, délais de versement)
s'appliquent : lis-les avant de t'engager. Ce n'est pas un conseil juridique ni fiscal : fais valider par ton
comptable. Documentation suivie : <https://developer.paddle.com> (liens précis dans `server/src/billing/paddle.ts`).

Comment ça marche : le client choisit un pack ; le serveur crée chez Paddle une **transaction** au prix du pack (prix
TTC fixé par le serveur, quantité 1, en euros), puis l'envoie sur **`https://<ton domaine>/paiement`**, une petite page
qui charge Paddle.js : la fenêtre de paiement Paddle s'ouvre par-dessus. Une fois payé, Paddle prévient le serveur
(webhook signé) et les crédits arrivent. Le prix du pack est **toutes taxes comprises** : 10 € payés = 10 € de crédits ;
Paddle prélève la TVA et ses frais sur ce montant.

**D'abord en test (sandbox), puis en réel** — les deux comptes Paddle sont séparés (clés, produit, webhook, réglages) :
1. **Compte de test** : inscris-toi sur <https://sandbox-vendors.paddle.com/signup> et confirme ton adresse e-mail
   (pas de vérification d'entreprise en sandbox).
2. **Produit** : Paddle → **Catalog → Products** → nouveau produit, par exemple « Crédits IA Sklubot », avec la
   **catégorie de taxe** qui convient (à confirmer avec ton comptable). Copie son identifiant **`pro_…`**. Pas besoin de
   créer un prix par pack : le serveur envoie le prix de chaque achat (« prix hors catalogue » rattaché à ce produit).
   Si tu changes tes packs (Administration → Réglages → Crédits), rien à changer chez Paddle.
3. **Clé d'API** : Paddle → **My account → Settings → Authentication** → onglet **API keys** → « New API key », avec la
   permission **`transaction.write`** (créer des transactions) ; note la date d'expiration (90 jours par défaut, un an
   au plus) pour la renouveler à temps. La clé commence par `pdl_sdbx_apikey_` (test) ou `pdl_live_apikey_` (réel).
4. **Jeton côté client** (pour la page `/paiement`) : même écran, onglet des **client-side tokens** → nouveau jeton.
   Il commence par `test_` (sandbox) ou `live_` (réel). Ce jeton est public par nature ; la clé d'API, elle, reste
   secrète (jamais dans le navigateur).
5. **Lien de paiement par défaut** : Paddle → **Checkout → Checkout configuration → Default payment link** :
   **`https://<ton domaine>/paiement`**. Paddle l'exige avant toute transaction. En réel, ton domaine doit d'abord être
   **approuvé** : Paddle → **My account → Settings → Website approval** (en sandbox, rien à approuver).
6. **Webhook** : Paddle → **Events → Notifications** → « New destination » : type **URL**, adresse
   **`https://<ton domaine>/api/billing/paddle/webhook`**, version d'API **1**, événements **`transaction.paid`**,
   **`transaction.completed`**, **`adjustment.created`** et **`adjustment.updated`**. Enregistre, puis rouvre la
   destination (« Edit destination ») et copie la **clé secrète** (`pdl_ntfset_…`). Ne supprime pas une destination
   pour la recréer : cela change la clé.
7. **Coolify** (ou le `.env` du VPS) — les cinq, sinon le paiement reste éteint :
   `SKLUBOT_PADDLE_ENV=sandbox` (puis `production`), `SKLUBOT_PADDLE_API_KEY`, `SKLUBOT_PADDLE_WEBHOOK_SECRET`,
   `SKLUBOT_PADDLE_CLIENT_TOKEN`, `SKLUBOT_PADDLE_PRODUCT_ID`, puis **Redeploy**. Administration → Réglages → Crédits
   affiche « Fournisseur : Paddle », le mode (test ou réel) et « Branché » — ou la liste des variables qui manquent
   (une clé de test avec `production`, ou l'inverse, est refusée).
8. **Teste un achat** (sandbox) avec la carte **`4242 4242 4242 4242`** (sans 3-D Secure ; `4000 0038 0000 0446` avec),
   n'importe quel nom et une date future : le solde augmente dans Réglages → Crédits, une ligne apparaît au journal
   d'administration et une notice dans le chat du client. Teste aussi un remboursement depuis le tableau de bord Paddle
   (en sandbox, Paddle approuve les remboursements toutes les 10 minutes) : le solde diminue. Les e-mails de Paddle en
   sandbox ne partent qu'aux adresses de ton domaine ; les autres sont renvoyés vers ton adresse principale.
9. **Passage en réel** : inscris-toi sur <https://vendors.paddle.com/signup>, fais la **vérification de l'entreprise et
   de l'identité** demandée par Paddle et l'**approbation du domaine** ; Paddle regarde aussi que le site montre des
   conditions de vente, une politique de confidentialité et une politique de remboursement. Refais les étapes 2 à 7
   dans le compte réel (nouveaux identifiants : rien n'est partagé avec la sandbox), mets
   `SKLUBOT_PADDLE_ENV=production`, redéploie, puis fais un vrai petit achat et rembourse-le.

Sécurité : signature `Paddle-Signature` (`ts=…;h1=…`, HMAC-SHA256 de `ts:corps brut` avec la clé secrète de la
destination) vérifiée sur le corps brut, 5 minutes de tolérance ; seules les transactions créées par ce serveur sont
créditées, au compte inscrit dans la transaction (données personnalisées vérifiées), du montant et en euros comme fixé
par le serveur, **une seule fois** (identifiant d'événement et de transaction). Un écart (autre montant, autre devise,
code de réduction, autre compte) n'est pas crédité et apparaît au journal (« credit-refused »). La page `/paiement` est
la seule à charger un script tiers (Paddle.js, depuis `cdn.paddle.com`), avec sa propre politique de sécurité ; le
reste de l'application garde la sienne. Les codes de réduction sont masqués dans la fenêtre de paiement.

### Abonnements (offres payantes)
Aucun fournisseur n'est choisi. Le seul branché est **manuel** : Administration → Clients → Gérer → « Paiement reçu »
(actif jusqu'à une date, référence facultative). Le planificateur fait le reste (retard, suspension).

### Brancher un fournisseur de paiement pour les abonnements
Interface : `server/src/billing/provider.ts` (`PaymentProvider`). Les appels à Paddle et la vérification de signature
existent déjà (`server/src/billing/paddle.ts`, utilisés pour les crédits). Étapes :
1. Écrire l'adaptateur **à partir de la documentation officielle uniquement**
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
5. L'enregistrer dans `PROVIDERS`. D'ici là, `POST /api/billing/webhook/paddle` répond **501** tant que Paddle n'est
   pas configuré (ensuite c'est le webhook des crédits), et `/stripe` (adresse d'une ancienne version) répond **501** et
   ne change rien.

## Décisions qui restent à la propriétaire / au propriétaire
- **Prix** et contenu des offres (les valeurs par défaut sont des exemples), taux USD → EUR, estimations.
- **Informations légales** : raison sociale, forme, capital, adresse, SIREN/SIRET/RCS, TVA, directeur·rice de la
  publication, hébergeur, médiateur de la consommation, conditions de résiliation, TVA (TTC/HT), et **relecture
  juridique** des CGU / CGV et des mentions légales. La politique de confidentialité (`/confidentialite`) décrit
  encore une installation personnelle : à compléter pour le service (sous-traitants : fournisseurs de modèles,
  hébergeur, paiement : Paddle).
- **Paddle** : ouvrir les comptes (test puis réel), vérification de l'entreprise, choix de la catégorie de taxe du
  produit, montant des packs (prix TTC) ; les abonnements payants restent en paiement manuel pour l'instant.
- Vérifier les **conditions d'utilisation commerciale** des fournisseurs de modèles et des outils Claude Code / Codex.

## Routes (toutes en 404 quand `HOSTED_MODE` n'est pas à 1)
| Route | Qui | Rôle |
|---|---|---|
| `GET /api/plans` | public | offres proposées (formulaire d'inscription) |
| `GET /api/plan-invites/:token` | public (le jeton est le secret) | offre d'une invitation |
| `POST /api/billing/webhook/:provider` | public | `paddle` : le webhook Paddle une fois configuré (501 avant) ; `stripe` → 501 |
| `POST /api/billing/paddle/webhook` | public (signature Paddle) | crédite une transaction payée, retire les crédits d'un remboursement ; 503 sans les variables |
| `GET /paiement` | public | page de paiement (Paddle.js ouvre la transaction `?_ptxn=…`) ; seulement quand Paddle est configuré |
| `GET /api/billing/credits`, `POST /api/billing/credits/checkout` | compte connecté | Réglages → Crédits ; `{ pack }` → `{ url }` (503 `payments_off` sans Paddle) |
| `GET /api/billing` | compte connecté | « Mon abonnement » |
| `GET /api/admin/overview`, `/admin/customers`, `/admin/plans`, `/admin/settings`, `/admin/invites`, `/admin/audit` | opérateurs | lecture |
| `PUT /api/admin/customers/:uid/plan`, `/status`, `/operator` ; `POST …/paid`, `…/credit`, `…/trial` | opérateurs (`/operator` : propriétaire seulement) | actions sur un client, chacune journalisée |
| `POST /api/admin/plans`, `PUT /api/admin/plans/:planId`, `PUT /api/admin/settings` | opérateurs | offres et réglages |
| `POST /api/admin/invites`, `DELETE /api/admin/invites/:inviteId` | opérateurs | liens d'invitation avec offre |
| `PUT /api/admin/providers/:pid/lend` | opérateurs | prêter un de ses fournisseurs d'API |
| `GET`, `PUT /api/admin/customers/:uid/caps` | opérateurs | plafonds d'usage du client (journalisés) |
| `/tarifs`, `/pricing`, `/cgu`, `/terms`, `/mentions-legales`, `/legal-notice` | public | pages sans script, CSP stricte |

Inscription : `POST /api/auth/signup` accepte en plus `plan`, `planInvite` et `acceptTerms` (obligatoire en mode
hébergé, sauf pour le tout premier compte) ; `POST /api/auth/google/start` les transmet de la même façon.
