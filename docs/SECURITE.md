# Sécurité : ce que Sklubot fait pour toi (lot 1, 22/11/2026)

Ce document explique, avec des mots simples, les protections ajoutées au lot 1 de sécurité. Chaque point renvoie à la
ligne de la liste `docs/audits/A-FAIRE.md` et au fichier qui le fait.

## Ce qui part est ce que tu as validé (L29)
- Avant d'envoyer un e-mail (Gmail, ou l'adresse du bot), Sklubot relit le message tel qu'il va partir et compare son
  **empreinte** avec le texte que tu as validé. Si ça ne correspond pas (par exemple un texte trop long qui serait coupé),
  **rien ne part**.
- Après l'envoi, Sklubot va voir dans les **« Envoyés »** (Gmail, Outlook). Absent ou différent : une ligne te prévient
  dans le chat du bot. Fichier : `server/src/native/mailproof.ts`.

## Pas de copie de voix ou de visage sans accord (L30)
- Avant de cloner une voix, échanger un visage, créer un avatar parlant… une carte te demande : **« C'est toi, ou la
  personne a donné son accord écrit ? »**. Refuser = rien n'est copié. Jamais « Toujours ». (`server/src/agent/consent.ts`)
- Les images créées par les bots portent l'étiquette **« généré par IA »** (IPTC, dans le fichier). Les vidéos pas encore.

## Les pièges des pages, e-mails et documents (L33, L35, L36)
- Un **clic** qui emmène le bot vers un autre site après avoir lu du contenu extérieur est **signalé** (à toi et au bot).
- Après du contenu extérieur, fouiller **tes notes, tes conversations, ton coffre ou tes fichiers** demande ton accord,
  sauf si tes propres mots le demandaient.
- Un **banc de tests** (`server/test/injection-bench.test.ts`) prouve à chaque modification, en CI, qu'un bot qui obéit
  aux pièges ne peut rien faire sans ton accord : envoi, publication, mémoire, routine, sortie vers un autre site.

## Le service lui-même (L37)
- Changer de mot de passe déconnecte les autres appareils ; essais limités par adresse IP ; aucun fichier `.map` publié ;
  un compte ne voit rien d'un autre (tests d'isolation) ; SPF/DKIM/DMARC vérifiés à la réception.
- Nouveau : avec la double authentification, **changer d'adresse e-mail demande le code** ; les noms (compte, bots) sont
  sur une seule ligne (pas de fausses consignes cachées dans un nom) ; les règles du contrôle des compétences sont testées
  contre les textes piégés qui font ramer (ReDoS).

## Pas de test de sécurité chez les autres (L38)
- Un bot ne lance jamais de scanner (nmap…), de devineur de mots de passe ou d'outil d'attaque contre un système qui
  n'est pas à toi. Tu peux lister tes propres sites dans **Réglages du bot → Sécurité → Hôtes que ce bot peut tester**.
- Une compétence importée qui parle de ces outils reçoit un avertissement.
- **Grille de tri d'un rapport de faille** (pour l'administrateur) : 1) reproductible sur ton serveur ? 2) touche-t-il
  les secrets, les accords ou l'isolation entre comptes ? → urgent ; 3) seulement l'apparence ou un message ? → normal ;
  4) demande un accès que l'attaquant n'a pas (machine, session) ? → à noter. Ne teste jamais sur un serveur d'autrui.

## Où vont tes bots (L39)
- **Réglages du bot → Sécurité** : la liste des sites contactés (le site seulement, jamais la page), avec « nouveau » et
  « après contenu extérieur ». Option **« Alerte au premier site nouveau »** dans Réglages → Autorisations → Sécurité.

## Accès à Internet par bot (L169)

Réglages du bot → Sécurité → « Accès à Internet » : **Partout** (par défaut), **Seulement une liste** (les sites que tu écris, sous-domaines compris) ou **Nulle part**. Et « Sites interdits à tous tes bots » : une liste qui vaut pour tous tes bots, quel que soit leur réglage. La règle est vérifiée **avant tout envoi** ; le bot reçoit une phrase claire et le refus est écrit dans son journal.

- Couvert : ouvrir une page (`browser_open`), lire une page (`web_fetch`), télécharger (`media_save`), photographier une page à plusieurs largeurs, envoyer une clé (`secret_use`), appeler une API connectée (`api_get` / `api_send`), le relais de clés des programmes de son ordinateur. Sur un ordinateur Linux, la même règle est écrite en règles gérées de Chromium (`URLBlocklist` / `URLAllowlist`) : le navigateur refuse aussi les clics, les redirections et les fichiers qu'une page charge, dès son prochain démarrage.
- Pas couvert : les programmes de son ordinateur qui vont sur Internet tout seuls (curl, pip, git…) — l'ordinateur est la machine du bot et il y est administrateur ; pour un vrai mur, le pare-feu de l'hôte (`deploy/bots-firewall.sh`). Ni les applications que tu as connectées (MCP), ni les fournisseurs de modèles, ni ce que le serveur charge pour lui-même (pages de connexion, images de la discussion).

## « Montre-moi » (L40)
- Les mots de passe, codes, numéros de carte et clés visibles sur une page sont **noircis** dans les captures ; les jetons
  sont retirés des adresses gardées.
- **Fenêtres d'applis** (terminal, éditeur…, sur l'ordinateur Linux du bot) : une fenêtre dont le titre annonce des
  secrets (gestionnaire de mots de passe, trousseau, demande de phrase secrète ou de PIN) est noircie **entière** ; les
  autres sont lues par OCR (Tesseract) et les mots qui ressemblent à une clé, un jeton ou un numéro de carte, ainsi que
  ce qui suit « mot de passe : », « password: », « token = », « code »… sur la même ligne, sont noircis. Une fenêtre
  qui ne peut pas être lue (pas d'OCR, trop lent) est noircie entière : dans le doute, on cache. Les cases sont
  ramenées à la taille de l'image gardée (960 px) — avant, celles des pages étaient dessinées à la taille de l'écran
  et pouvaient tomber à côté (corrigé). Code : `server/src/teachappmask.ts` ; test : `server/test/teach-app-mask.test.ts`.

## Coffre et e-mail du bot (L41, L42)
- Chaque élément du coffre peut être **réservé à certains bots**, réglé sur **« demander à chaque fois »**, et montre
  son **historique d'utilisation**. L'import CSV existait déjà.
- Le bot n'écrit **qu'à toi** par défaut (et à l'expéditeur d'un e-mail auquel il répond). Les autres adresses vont dans
  **Réglages du bot → E-mail → Destinataires autorisés**.

## Accords au plus juste (L43, L44)
- « Toujours » et « pour cette conversation » sur une commande ne couvrent **que cette commande exacte** (approuver
  `npm test` n'approuve pas `npm test && rm -rf ~`) ; sur un fichier, que ce fichier.
- **Option (désactivée par défaut)** : « Code à double facteur avant les accords sensibles ». Activée, accepter un
  paiement, une suppression définitive, un envoi à quelqu'un de nouveau demande le code de ton appli. La désactiver
  demande aussi le code (ou la clé d'accès, voir plus bas).

## Nouvel appareil et clés d'accès (L44, décision du 25/11/2026)
- **Alerte « nouvel appareil »** : quand ton compte se connecte depuis un navigateur ou un appareil jamais utilisé, tu
  reçois un **e-mail** et une **notification** (téléphone, et la cloche) : l'heure, le navigateur et le système (« Safari
  sur iOS »), la façon de se connecter (mot de passe, Google, clé d'accès, lien par e-mail…). Pas de lieu : Sklubot n'en
  connaît pas et n'en demande à personne. Un lien et un bouton **« Ce n'est pas moi »** (Réglages → Autorisations →
  Sécurité) ferment cette connexion et oublient l'appareil ; il faut ensuite changer le mot de passe. Le lien de l'e-mail
  marche une fois, 7 jours, et ouvre d'abord une page avec un bouton (un antivirus qui ouvre les liens ne déclenche rien).
- Comment l'appareil est reconnu : un **numéro au hasard** dans un cookie du navigateur (`sklubot_device`, 400 jours),
  dont le serveur ne garde qu'une empreinte, plus la famille du navigateur. Pas de pistage, pas d'adresse IP gardée.
  L'inscription et la toute première connexion d'un compte qui n'a encore aucun appareil connu ne préviennent pas (rien
  à comparer). **Au plus 5 alertes par heure** et par compte ; au-delà, la connexion reste listée et dans le journal.
- **Clés d'accès (passkeys)** : Réglages → Autorisations → Sécurité → « Ajouter une clé d'accès » (mot de passe demandé ;
  sans mot de passe, une connexion de moins de 15 minutes). Renommer, retirer. Sur la page de connexion : « Se connecter
  avec une clé d'accès ». La clé demande toujours de déverrouiller l'appareil (empreinte, visage ou code) : elle vaut
  deux facteurs, donc la double authentification n'est pas redemandée après elle ; le mot de passe la redemande toujours.
- Une clé d'accès remplace aussi le **code avant les accords sensibles** : « Utiliser ma clé d'accès » sur la carte
  donne une preuve à usage unique, valable 2 minutes, pour **cette** carte seulement.
- Perdre ses clés ne bloque jamais : mot de passe, Google, lien par e-mail et « Mot de passe oublié ? » marchent toujours.
- Il faut que le serveur soit en **https** (son `PUBLIC_URL`) ou sur `localhost`. L'appli mobile ne les gère pas encore
  (un message le dit sur son écran de connexion).
- Contrôles (W3C WebAuthn niveau 3) : défi de 32 octets au hasard, à usage unique, 5 minutes, lié à son usage et au
  compte ; origine et identifiant du site (`PUBLIC_URL`) vérifiés ; vérification de l'utilisateur exigée ; compteur qui
  doit monter (sinon clé copiée) ; signature vérifiée. Vérification écrite d'après SimpleWebAuthn (MIT, voir
  `THIRD_PARTY_NOTICES.md`), sans dépendance ajoutée. Code : `server/src/webauthn.ts`, `passkeys.ts`, `newdevice.ts`,
  `web/src/components/Passkeys.tsx` ; tests : `server/test/passkeys.test.ts`, `newdevice.test.ts` ; captures :
  `docs/screenshots/passkeys/`. **Pas encore essayé avec un vrai appareil** (téléphone, clé de sécurité) : les tests
  utilisent un authentificateur logiciel.

## Pages, secrets, outils ajoutés (L45, L46, L47, L49, L51)
- Pages publiées : un script de CDN sans empreinte `integrity` ou sans version exacte déclenche un avertissement.
- Les clés collées sont reconnues sous plus de formes (motifs repris d'ECC, MIT) et retirées des passations entre bots.
- `git branch -D` est une commande irréversible : toujours demandée.
- chrome-devtools-mcp et modern-web-guidance ajoutés comme outils locaux : version exacte obligatoire, télémétrie
  coupée, leurs outils de clic et de saisie demandent à chaque fois.
- L115 : Lighthouse, axe, mermaid-cli et chrome-devtools-mcp sont dans l'ordinateur du bot, à des versions figées,
  télémétrie coupée (le module d'envoi d'erreurs de Lighthouse est retiré). Ils lancent le Chromium de l'ordinateur sous
  l'utilisateur « browser », avec le bac à sable de Chromium quand l'ordinateur le permet, jamais en root.
- Un connecteur qui ne répond plus deux fois de suite passe **« en panne »** : visible dans Réglages → Applis, dit au bot,
  pas de réessais à l'aveugle. L'adresse est vérifiée à chaque connexion, sur l'adresse réellement jointe.

## Navigateur des bots (L48)
- L'administrateur voit dans Réglages → Autorisations → Sécurité si Chromium a **N versions de retard** (donc des
  correctifs de sécurité manquants) et comment le mettre à jour (`npm run computer:build`).
- ✅ Fait (2026-11-22, décision du propriétaire) : **le bac à sable propre de Chromium est remis**. Le navigateur ne
  tourne plus en root : il passe à l'utilisateur `browser` (créé dans l'image, `setpriv`, environnement vidé) ; le
  terminal du bot reste root. Son profil et ses téléchargements restent dans le dossier du bot
  (`/root/.config/sklubot-browser`, `/root/Downloads`) et lui sont remis avant chaque démarrage ; `/root` passe en 711
  (on traverse, on ne liste pas).
- Le bac à sable utilisé est celui des **espaces de noms utilisateur** (Chromium de Debian n'a pas d'aide setuid, et
  `no-new-privileges` est gardé). Le profil seccomp par défaut de Docker les refuse (essayé : « No usable sandbox! ») :
  l'ordinateur est donc créé avec `docker/desktop/seccomp-chromium.json` = le profil par défaut de Docker
  (moby/profiles, Apache-2.0) **plus trois règles étroites** : `clone` avec espaces de noms utilisateur, PID et réseau
  seulement (montage, cgroup, UTS, IPC toujours refusés), `unshare` d'un espace utilisateur seulement, `chroot` (le
  noyau exige toujours la capacité dans l'espace de noms de l'appelant). **Aucune capacité ajoutée**, pas de
  `--privileged`, pas de `SYS_ADMIN`. Le proxy Docker de Sklubot n'accepte que ce profil exact.
- Vérifié dans un vrai conteneur : `chrome://sandbox` dit « You are adequately sandboxed » (couche 1 : Namespace,
  seccomp-BPF : oui), aucun processus avec `--no-sandbox`, moteurs de rendu dans leur propre espace de noms
  (`server/test/browser-sandbox.test.ts`).
- Si le bac à sable ne peut pas démarrer (ordinateur fait sans le profil, hôte qui interdit les espaces de noms
  utilisateur — par exemple certaines règles AppArmor), le navigateur s'ouvre quand même **sans bac à sable mais pas
  en root**, et l'administrateur le voit dans Réglages → Autorisations → Sécurité (« ordinateurs où le navigateur a dû
  démarrer sans lui »). Même chose pour une image pas encore reconstruite ou des ordinateurs encore sur l'ancienne image.
- Reste à savoir : le navigateur propre d'Agent Reach (port 9333) et les scripts que le bot lance lui-même ne sont pas
  concernés ; sous gVisor (`runsc`), le profil seccomp n'est pas celui de Docker (vérifier avec le test d'ordinateur).
