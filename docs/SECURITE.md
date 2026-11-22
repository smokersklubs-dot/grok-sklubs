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

## « Montre-moi » (L40)
- Les mots de passe, codes, numéros de carte et clés visibles sur une page sont **noircis** dans les captures ; les jetons
  sont retirés des adresses gardées. Limite : les fenêtres d'applis (hors navigateur) ne peuvent pas être lues.

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
  demande aussi le code. Pas encore : alerte « nouvel appareil », passkeys.

## Pages, secrets, outils ajoutés (L45, L46, L47, L49, L51)
- Pages publiées : un script de CDN sans empreinte `integrity` ou sans version exacte déclenche un avertissement.
- Les clés collées sont reconnues sous plus de formes (motifs repris d'ECC, MIT) et retirées des passations entre bots.
- `git branch -D` est une commande irréversible : toujours demandée.
- chrome-devtools-mcp et modern-web-guidance ajoutés comme outils locaux : version exacte obligatoire, télémétrie
  coupée, leurs outils de clic et de saisie demandent à chaque fois.
- Un connecteur qui ne répond plus deux fois de suite passe **« en panne »** : visible dans Réglages → Applis, dit au bot,
  pas de réessais à l'aveugle. L'adresse est vérifiée à chaque connexion, sur l'adresse réellement jointe.

## Navigateur des bots (L48)
- L'administrateur voit dans Réglages → Autorisations → Sécurité si Chromium a **N versions de retard** (donc des
  correctifs de sécurité manquants) et comment le mettre à jour (`npm run computer:build`).
- Vérifié : Chromium tourne avec `--no-sandbox` en root, protégé par le conteneur (capacités retirées,
  no-new-privileges). Remettre son bac à sable propre demande de changer l'image (utilisateur dédié, profil seccomp) :
  décision à prendre, non faite ici.
