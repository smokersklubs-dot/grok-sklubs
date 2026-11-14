# Spécification fonctionnelle 06 — Mise à jour de l'étude « HQ » (bot-hq)

Côté étude d'une salle blanche. Ce document décrit des **comportements**, jamais une implémentation. Aucun code, commentaire, prompt, texte d'interface, identifiant interne ni chemin de fichier de la source n'est repris. Tous les textes visibles par l'utilisateur ou par le modèle doivent être **réécrits** par l'équipe de reconstruction ; quand ce document dit « un message qui dit que… », il donne le sens, pas la formulation.

Références : les exigences de la spécification 05 sont citées HQ-xxx ; les nouvelles exigences de ce document sont numérotées U-xxx.

---

## 0. Version étudiée

- Dépôt public étudié : le successeur open source (licence MIT) décrit dans la spec 05.
- **Commit le plus récent étudié : `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`, daté du 2026-11-11 08:23 UTC.** L'historique public ne compte que 4 commits (09/11/2026 → 11/11/2026).
- **Constat important :** la spec 05 a été écrite à partir de ce même commit (elle décrit déjà le banc d'essai du bureau, l'installateur, le panneau moteur, etc., qui n'existent que dans ce commit). **Il n'y a aucun nouveau commit depuis l'étude précédente.** La partie A ne contient donc pas de nouvelles fonctions : elle regroupe des **précisions et des corrections** de la spec 05 trouvées à la relecture du même code, plus quelques points que la spec 05 ne couvrait pas.

---

## A. Précisions, corrections et points absents de la spec 05

### U-001 — Correspondance appel d'outil ↔ ligne du transcript : ordre « premier arrivé » (correction de HQ-167)
- La spec 05 dit « la plus récente ligne non réclamée ». Le comportement réel est **la plus ancienne** ligne d'outil, encore en cours et non réclamée, qui porte le même nom dans le tour en cours (file FIFO). Avec deux appels parallèles du même outil, le premier appel reçu par le serveur d'outils prend la première ligne annoncée par le flux.
- Le détail complet est en B-3.

### U-002 — Quels déclencheurs font expirer les validations (précision de HQ-197)
- Seul un **nouveau message de l'utilisateur** expire les validations en attente. Un tour lancé par une routine, par un message d'un autre bot ou par une notice système **ne les expire pas**.
- Un **redémarrage du moteur d'un bot** (bouton du panneau moteur) **n'expire pas** les validations dans la source. Recommandation pour notre produit : les expirer aussi (voir B-5).

### U-003 — Suppression d'un bot : ordre des opérations (complète HQ-015)
1. Interrompre le tour en cours du bot (ce qui expire aussi ses validations).
2. Pour chaque routine du bot : la retirer du planificateur **et** supprimer côté fournisseur le déclencheur d'événement associé, s'il existe (une erreur à cette étape est ignorée).
3. Pour un bot qui n'est pas un salon de groupe : arrêter et supprimer son moteur géré ; libérer son écran (déshabillage, écran rendu libre) ; effacer sur l'ordinateur son profil de navigateur et son dossier Bibliothèque (seulement si l'identifiant du bot a le format sûr attendu).
4. Chaque échec d'une de ces étapes est journalisé et n'empêche pas les suivantes ni la suppression en base.

### U-004 — Limite d'équipe comptée sur toute l'installation (rappel précis de HQ-006)
- Le nombre compté = tous les bots « agents » de **tous** les utilisateurs, hors salons de groupe et hors bots masqués. Création refusée avec une erreur 409 dont le message dit que l'équipe est pleine, combien de bots l'ordinateur peut accueillir, et qu'il faut en retirer un.
- Les écrans sont pris par ordre libre : pour un bot non principal, le premier écran supplémentaire existant non loué ; sinon création d'un nouvel écran si moins de 4 existent ; sinon erreur claire. Jamais d'éviction.

### U-005 — Habillage d'écran mémorisé par processus serveur (précision de HQ-059 / HQ-073)
- La préparation d'un écran (« habiller ») est mémorisée **une fois par bot et par exécution du serveur** : tous les appelants concurrents attendent la même tentative. Un échec est journalisé et la mémoire est effacée, pour que la demande suivante réessaie.
- Une modification du nom, du libellé, de la forme ou de la couleur de l'avatar force un nouvel habillage, **seulement si le bot a déjà un écran**. Une modification du nom, du libellé ou de la description réécrit aussi la fiche de personnalité du moteur géré.

### U-006 — Positionnement face au « mode bots » du moteur (point produit absent de la spec 05)
- Le moteur d'agent tiers propose lui-même un mode multi-bots (un seul processus pour tous les profils, transport WebSocket, planification et messagerie inter-agents internes au moteur). Le produit étudié **ne l'utilise pas** : il garde sa propre couche (un processus moteur par bot supplémentaire, transport HTTP de type « Responses », ses propres routines, son propre outil bot-à-bot). Conséquence assumée et documentée : les bots créés dans l'application n'apparaissent pas dans l'application de bureau du moteur, et inversement.
- Pour nous : décider explicitement et l'écrire dans la documentation utilisateur, pour éviter la confusion « pourquoi mon bot n'apparaît pas là-bas ».

### U-007 — Lecteur d'écran en direct : réglages de la session de bureau à distance (complète HQ-231 à HQ-235)
- La connexion est **partagée** (plusieurs spectateurs possibles), l'image est **mise à l'échelle** dans le cadre, la taille du bureau distant n'est **jamais** modifiée par le client, le fond du cadre est transparent, et le clic ne donne le focus clavier au bureau distant **qu'en mode contrôle**. En mode regard, l'entrée est désactivée côté client **et** filtrée côté relais.
- Passer de regard à contrôle (ou l'inverse) **recrée la connexion** avec le mode demandé.
- Après une réinitialisation de l'écran réussie, la connexion est relancée (nouvelle tentative). La grande vue réveille l'ordinateur **une seule fois** à l'ouverture s'il dort.
- Le cadre garde le rapport largeur/hauteur de l'écran ; en mode contrôle, la hauteur disponible pour l'image est réduite de la hauteur de la barre « vous conduisez » (52 px), pour que l'ensemble tienne.

### U-008 — Installateur : détails de robustesse (complète HQ-271)
- Le runtime Node privé est re-téléchargé seulement si la version majeure attendue n'est pas déjà là.
- Lors d'une mise à niveau, seuls les dossiers de code construit (serveur et web) sont effacés avant extraction ; les données vivent ailleurs.
- L'installation des dépendances de production écrit son journal dans un fichier ; en cas d'échec, l'installateur affiche les 20 dernières lignes et s'arrête.
- Le fichier de clés à usage unique est supprimé à chaque exécution où il est fourni (pas seulement au premier passage). Une clé absente du fichier vaut « vide » sans faire échouer le script. La clé du fournisseur d'ordinateur peut venir, à défaut, du fichier d'environnement du moteur principal ; si elle manque partout, arrêt avec un message clair.
- Le service supervisé est **redémarré** s'il est connu du superviseur dans n'importe quel état (en marche, en démarrage, en échec, arrêté…), sinon **ajouté**. Attente de la santé jusqu'à 30 s, puis affichage de la réponse.
- En fin d'installation, un fichier contenant l'entrée « serveur MCP » prête à coller (URL de l'alias principal, en-tête d'autorisation avec le jeton dérivé, délais 1800 s / 30 s) est écrit avec des droits restreints, et son emplacement est affiché.

### U-009 — Lien de connexion à usage unique (rappel complet de HQ-251 à HQ-253)
- Une commande d'opérateur, lancée sur la machine, dérive la clé propriétaire depuis le secret de session lu dans le fichier de réglages, appelle le point d'entrée propriétaire en boucle locale avec « lien = oui » et affiche l'URL obtenue. Le lien vaut 15 minutes, un seul usage ; il est supprimé dès la première visite, même expiré ; réutilisé ou expiré → réponse 410 avec un message simple qui invite à demander un nouveau lien. Les liens vivent en mémoire : un redémarrage les invalide.

### U-010 — Test de bout en bout : identité du bot principal lue, pas codée en dur
- Le scénario de bout en bout ne suppose plus le nom du premier bot : il lit la liste des bots, prend celui marqué « principal » et utilise son nom pour toutes les vérifications (avec un nom de repli seulement si la liste n'en donne aucun). Il peut s'authentifier par connexion de développement **ou** avec un cookie de session existant fourni par variable d'environnement. Il ouvre le lecteur par le bouton « Ouvrir » du panneau, survole l'image pour faire apparaître la pilule, prend le contrôle, attend le bouton « rendre la main à <bot> », le clique, puis vérifie que « prendre le contrôle » réapparaît.

---

## B. Comportement détaillé des points partiels / manquants

### B-1. Décoration du fond d'écran (partiel chez nous)

Ce qui fait la différence visible par rapport à un simple fond uni :

1. **Palette dérivée de la couleur du bot** (HQ-051, HQ-052) : teinte et saturation de la couleur d'avatar ; couleurs très peu saturées (noir, gris) remplacées par une base gris-bleu calme. On en tire : lavis clair, lavis, lavis profond, deux lueurs, et une couleur de trait pour les dessins.
2. **Composition du fond**, dans cet ordre de superposition :
   - un dégradé linéaire en diagonale (haut-gauche → bas-droite) : lavis clair, lavis au milieu, lavis profond ;
   - quatre taches radiales douces qui s'estompent vers la transparence : blanche (85 % d'opacité au centre) en haut à gauche ; lueur A (60 %) en bas à droite ; lueur B (65 %) en haut à droite ; lueur B (65 %) en bas à gauche — positions et rayons en pourcentage de l'écran donnés en HQ-053 ;
   - **14 petits pictogrammes au trait** placés seulement près des bords (le centre et la zone du dock restent vides), aux 14 emplacements de HQ-053.
3. **Pictogrammes** : un jeu de 16 dessins simples à un seul trait (coche, étincelle, feuille, avion en papier, bulle, étoile, gribouillis, lune, nuage, éclair, crayon, cœur, plus, anneau, note de musique, liste), **dessinés par nous** sur une grille 24×24, sans remplissage, trait de 1,5, extrémités et jonctions arrondies, couleur = couleur de trait de la palette.
4. **Aléatoire reproductible** : un générateur pseudo-aléatoire initialisé à partir d'une empreinte de l'identifiant du bot. Les 16 dessins reçoivent chacun une clé aléatoire et sont triés par cette clé (mélange) ; l'emplacement *i* prend le dessin *i* du mélange (en boucle s'il y avait moins de dessins que d'emplacements). Pour chaque emplacement, dans cet ordre : taille 38–64 px, rotation −25° à +25° autour du centre du dessin, décalage horizontal et vertical de ±1,2 point de pourcentage, opacité du trait 0,34–0,60. **Même bot → même disposition, toujours** ; renommer ne la change pas (seul l'identifiant compte), changer de couleur ne change que les teintes.
5. **Taille exacte de l'écran** : le dessin vectoriel est produit avec des repères de largeur/hauteur remplacés sur l'ordinateur par la taille réelle de l'écran, puis rendu à cette taille exacte (si le moteur de rendu rend une autre taille, l'image est redimensionnée avec un lissage bilinéaire).
6. **Repli** : si le rendu vectoriel n'est pas disponible, peindre un dégradé diagonal à deux tons (lavis → lavis profond). Si l'interface graphique de bureau n'est pas disponible du tout, laisser une couleur unie (avertissement, pas d'échec).
7. **Deux modes d'affichage** :
   - si un gestionnaire de bureau possède déjà le fond (cas d'un bureau XFCE avec xfdesktop), enregistrer le rendu en PNG dans le dossier d'état de l'écran (nom contenant l'empreinte et la taille, anciens PNG supprimés), **mémoriser une seule fois** les images de fond précédentes de chaque moniteur/espace de travail, puis pointer chacun vers le PNG avec un style « étiré » ; au déshabillage, restaurer les valeurs mémorisées ;
   - sinon, afficher sa propre fenêtre de type « bureau », sans décoration, sans focus, présente sur tous les espaces, absente des listes de tâches, à la taille de l'écran, placée sous toutes les autres fenêtres.
8. **Réactivité** : le programme de fond relit l'apparence quand elle change, quand la taille de l'écran ou la disposition des moniteurs change ; il s'arrête tout seul quand l'apparence de son écran disparaît.
9. **Projection conteneur (notre cas)** : un conteneur = un écran, donc pas besoin de la logique « quel écran ». On peut générer le PNG côté serveur et le poser comme fond racine (ou dans le gestionnaire de bureau du conteneur), avec la même palette, le même semis et le même placement.

### B-2. Sonde « écran prêt » avant chaque tour (partiel chez nous)

À chaque tour, **avant** d'envoyer le message au moteur :
1. Si aucun ordinateur n'est configuré : ne rien faire.
2. Si le navigateur de ce bot **n'est pas géré par l'application** (bot principal qui a déjà son propre navigateur) : lancer la préparation de l'écran **en arrière-plan** et ne pas faire attendre le tour (rien de ce dont il a besoin ne dépend de l'habillage).
3. Sinon : louer l'écran (vérification de la location au plus toutes les 120 s auprès du fournisseur ; si l'écran a disparu, nouvelle location) puis **attendre** l'habillage (mémorisé, voir U-005). L'habillage vérifie lui-même tout ce qui doit tourner (voir HQ-057) : enregistrement d'apparence à jour, programme de dock vivant avec la bonne empreinte, serveur de page d'accueil vivant, navigateur du bot lancé sur cet écran ; il refait ce qui manque.
4. En mode « application installée sur l'ordinateur » seulement : interroger le point de version du protocole de débogage du navigateur du bot avec **un délai de 1,5 s**. S'il ne répond pas (ou répond en erreur), **forcer un nouvel habillage**, qui redémarre le navigateur sur le profil du bot et sur la page d'accueil.
5. Toute erreur de cette étape est journalisée mais **ne bloque pas** le tour. Si l'utilisateur interrompt pendant cette étape, le tour s'arrête avant l'envoi.
6. Raison à garder en tête : sans cette sonde, un agent qui ne trouve pas de navigateur en lance un à lui, sur le mauvais écran, invisible pour l'utilisateur.
7. Projection conteneur : « conteneur démarré → affichage X répond → navigateur répond sur son port de débogage en ≤ 1,5 s → sinon relancer le navigateur ». Garder l'idée de mémoriser une préparation réussie par exécution du serveur et d'oublier un échec.

### B-3. Corrélation des appels du serveur d'outils avec les lignes d'outil du transcript (partiel chez nous)

Contexte : le moteur annonce chaque appel d'outil dans son flux d'événements (ce qui crée une ligne « étape » dans le transcript), puis appelle réellement l'outil sur le serveur d'outils de l'application. Il faut relier les deux pour afficher sur la bonne ligne le statut et le résumé connus par l'application.

1. **Côté flux** : à chaque appel annoncé, l'application crée une ligne d'outil (identifiant d'appel, nom affiché, libellé, statut « en cours », arguments) et l'inscrit dans une liste du tour en cours : {position de la ligne, identifiant d'appel, nom normalisé, réclamée = non, terminée = non}.
2. **Normalisation du nom** : le moteur préfixe les outils venant d'un serveur MCP par « mcp », un ou plusieurs soulignés, le nom du serveur, un ou plusieurs soulignés. Pour le serveur de l'application, on retire ce préfixe puis on retrouve l'outil propre **sans tenir compte de la casse** (le moteur peut tout mettre en minuscules) ; les méta-outils du fournisseur d'applications connectées sont remis en majuscules. Pour un autre serveur MCP, on garde le nom après le préfixe et on retient le nom du serveur pour l'activité affichée. Les outils internes de recherche d'outils du moteur ne créent **aucune** ligne (seulement une légende « cherche le bon outil »).
3. **Côté serveur d'outils** : à la réception d'un appel, on normalise le nom de la même façon (recherche insensible à la casse parmi les outils propres) puis on **réclame** une ligne : on cherche dans le tour en cours de ce bot la **première** ligne (la plus ancienne) qui porte ce nom, n'est pas encore réclamée et n'est pas terminée. On réessaie **toutes les 40 ms pendant 600 ms au plus**, car le flux annonce l'appel juste avant que le moteur l'exécute. Trouvée → marquée réclamée. Pas trouvée, ou pas de tour en cours pour ce bot → aucune ligne (l'appel vient d'une session du moteur hors de l'application, par exemple une messagerie) : l'outil s'exécute quand même.
4. **Résultat connu par l'application** : quand l'outil se termine, l'application enregistre pour cette ligne un « résultat déclaré » (statut fait / erreur / refusé, et un court résumé) et met à jour la ligne tout de suite. Exemples : outil propre réussi → fait + résumé de l'outil ; politique bloquante → refusé + « pas autorisé » ; validation refusée / expirée → refusé + « pas autorisé » / « passé » ; erreur → erreur + message tronqué à 200 caractères ; échec d'une action d'application connectée → erreur + « échec ».
5. **Pendant une validation** : la ligne réclamée passe en « attend ton accord », puis revient en « en cours » si l'utilisateur accepte.
6. **Arrivée du résultat dans le flux** (vu une seule fois par identifiant d'appel) : on retrouve la ligne par **identifiant d'appel** (pas par nom), on la marque terminée. Si l'application a déclaré un statut autre que « en cours », **il l'emporte** ; sinon on devine le statut depuis la sortie brute (erreur JSON, code de sortie non nul, succès = faux, texte commençant par « erreur ») et on garde le résumé déclaré s'il existe, sinon le résumé deviné.
7. **Fin de tour** : toute ligne encore « en cours » ou « attend ton accord » devient « fait » si le tour a réussi, ou « erreur » avec un résumé « arrêté » (interruption) / « pas terminé » (échec).

### B-4. Panneau moteur : redémarrage (partiel chez nous)

1. **Où** : dans le pied du panneau moteur du bot, à côté de la ligne d'état (point coloré + « famille du moteur · profil · état »). Le lien « redémarrer l'agent » n'apparaît **que** si l'état est « erreur » ou « arrêté ». Le texte d'erreur s'affiche sous le pied quand l'état est « erreur ».
2. **Pendant** : libellé occupé « redémarrage… », bouton désactivé ; une seule action du panneau à la fois.
3. **Serveur** :
   - bot lié au moteur **principal** (l'agent propre de la machine, qui sert aussi d'autres canaux) → refus 409 avec un message qui explique que l'application ne redémarre pas cet agent ;
   - bot **géré** → attendre un démarrage déjà en cours (sans échouer s'il a échoué), arrêter le processus (signal d'arrêt au groupe, attente jusqu'à 10 s, puis arrêt forcé ; un fichier de PID n'est cru que s'il désigne bien ce dossier et ce programme), vider le cache des options de modèles, relancer le démarrage **en arrière-plan**, puis renvoyer tout de suite l'état du moteur (en général « démarrage »). Erreur → 502 avec le message tronqué à 300 caractères.
4. **Client** : applique l'état reçu en **gardant** un brouillon fournisseur/modèle non enregistré ; tant que l'état est « démarrage », il se rafraîchit discrètement **toutes les 3 s** jusqu'à « prêt » ou « erreur ». Un échec affiche une note en ligne du type « impossible de redémarrer : … ».
5. **Démarrage automatique** : si la vérification de santé d'un moteur géré échoue et qu'aucun démarrage n'est en cours, la simple lecture de l'état **déclenche** un démarrage et répond « démarrage » ; si un démarrage récent a échoué, elle répond « erreur » avec le dernier message d'échec mémorisé.
6. **À ajouter chez nous** (amélioration) : à un redémarrage, expirer les validations en attente de ce bot (voir B-5) — la source ne le fait pas.

### B-5. Expiration des validations pour les tours du moteur (partiel chez nous)

Les validations ont lieu **à l'intérieur** de l'appel d'outil : l'appel reste bloqué jusqu'à une décision.

1. **Création** : carte de validation dans la conversation (titre « autoriser <bot> à <action> ? », action = nom d'action humanisé sans le préfixe de l'application ; détail = jusqu'à 6 arguments simples par action, chaque valeur tronquée à 160 caractères, l'ensemble à 1 200), enregistrement « en attente », compteur de non-lus +1, ligne d'outil en « attend ton accord », état en direct « a besoin de toi » avec la raison, puis attente.
2. **Fins possibles** : autoriser (une fois), toujours autoriser (enregistre une politique « toujours » pour cet outil et cet utilisateur), refuser, ou **expiration**.
3. **Ce qui fait expirer** :
   - un **nouveau message de l'utilisateur** à ce bot (avant même que le tour soit mis en file) ;
   - une **interruption** du bot (bouton stop, ou suppression du bot) ;
   - le **délai maximal de 25 minutes** (gardé sous le délai d'outil de 30 minutes côté moteur) ;
   - un **redémarrage du serveur** : au démarrage, toutes les validations encore « en attente » sont marquées expirées et leurs cartes mises à jour, car les attentes vivaient en mémoire ;
   - un clic sur une carte dont l'attente n'existe plus (cas d'un redémarrage) : la carte passe en expirée au lieu d'agir.
4. **Effets d'une expiration** : enregistrement et carte « expirée » ; l'appel d'outil se débloque et renvoie au moteur un texte qui dit que l'action n'a pas été approuvée (nouveau message ou pas de réponse à temps) et qu'il ne faut pas réessayer sauf demande ; la ligne d'outil passe en « refusé » avec le résumé « passé ». Un refus explicite renvoie un autre texte : l'utilisateur a refusé, ne pas réessayer, trouver un autre moyen ou dire ce qui n'a pas pu être fait.
5. **Retour de l'état en direct** : quand plus aucune validation n'est en attente pour ce bot : si un tour tourne encore → « en cours », activité « connexion au service <app> » après une autorisation, sinon « réfléchit » ; si aucun tour ne tourne (appel venu d'une autre session du moteur) → inactif. À la fin d'un tour, si une validation demandée **hors de ce tour** est encore en attente, on ne touche pas à l'état « a besoin de toi » (on efface seulement « en cours » et la légende).
6. **Non couvert par la source et recommandé** : expirer aussi sur redémarrage du moteur du bot, sur « nouvelle conversation » et sur arrêt d'un conteneur.

### B-6. Outil de recherche sur X parmi les outils de l'application (partiel chez nous)

1. **Paramètres** : question (obligatoire, en mots simples) ; liste de comptes auxquels se limiter (au plus 10, « @ » initial retiré, vides ignorés) ; liste de comptes à exclure (utilisée **seulement** si aucune liste de limitation n'est donnée) ; date de début et date de fin au format année-mois-jour (ignorées si mal formées).
2. **Description donnée au modèle** (à réécrire) : recherche en direct sur X — ce qui se dit sur un sujet, ce qui devient viral, les réactions à une actualité, les derniers messages d'un compte ; renvoie une réponse rédigée avec les liens ; poser une question ciblée par appel et préciser ce qu'on veut en retour (par exemple « les N messages les plus engagés sur tel sujet ces 48 dernières heures, avec auteur, likes et lien »).
3. **Exécution dans la source** : un seul appel, non conservé, à l'API de type « Responses » du fournisseur xAI, avec l'outil de recherche X natif du fournisseur configuré selon les paramètres, et une consigne système courte : « tu es un outil de recherche pour un autre agent ; réponds précisément ; pour chaque message utilisé, donne l'auteur, la date, l'engagement visible et le lien ; pas de préambule ni de conseil » (sens, à reformuler). Délai 240 s. Erreur HTTP → erreur d'outil avec le code et un extrait de 300 caractères.
4. **Sortie** : le texte de réponse (ou un texte disant qu'aucune réponse n'est revenue), puis une section « sources » listant jusqu'à **40 liens uniques** pris dans les annotations du texte et dans la liste de citations ; le tout tronqué à 60 000 caractères.
5. **Affichage** : activité « cherche » avec le détail « X », libellé d'étape « recherche sur X », résumé « recherche X faite ».
6. **Coût** : nécessite une clé payante xAI. Voir C pour une alternative gratuite.

### B-7. Bloc « réfléchit » avec compteur d'étapes en direct (partiel chez nous)

1. **Donnée serveur** : l'état en direct du bot contient un compteur d'étapes = nombre d'appels d'outil annoncés depuis le début du tour (les outils internes de recherche d'outils ne comptent pas). Remis à 0 au début du tour, envoyé à chaque nouvel appel (même quand le bot attend l'utilisateur : on met à jour le compteur sans changer l'activité).
2. **Quand le bloc s'affiche** : en fin de transcript, quand le bot tourne et n'est pas en train d'écrire du texte en flux, ou quand il attend l'utilisateur.
3. **Ligne méta du bloc** : « travaille depuis <durée> » (depuis le début du tour, affiché après 1 s) ou, en attente, « attend depuis <durée> » (depuis le début de l'attente) ; puis « · N étape(s) ». Tic toutes les secondes. Format des durées : « 8 s », « 1 min 23 s », « 1 h 4 min » (à franciser).
4. **Éviter le double comptage** : si la dernière chose du transcript est un groupe d'étapes encore ouvert (le tour est en cours et ce groupe est le dernier élément), c'est **la pastille du groupe** qui montre le compte, et le bloc **n'affiche pas** « · N étapes ». Sinon (par exemple un message intermédiaire a été écrit après les étapes), le bloc affiche le compte serveur.
5. **Compte de la pastille ouverte** = lignes d'étapes du groupe + étapes comptées par le serveur qui n'ont pas encore de ligne côté client. Le « surplus » = max(0, compteur serveur − nombre de lignes d'outil depuis le dernier message de l'utilisateur). Quand le tour n'est plus en cours, le surplus vaut 0.
6. **Pastille ouverte et active** (tour en cours, pas d'attente) : un indicateur qui tourne, le libellé de l'étape en cours la plus récente (sinon de la dernière étape) qui glisse en entrant quand il change, un séparateur, le compte. En attente : pastille fermée avec point ambre.
7. **Bloc lui-même** (rappel HQ-221 à HQ-223) : avatar qui flotte doucement posé sur une pilule sombre (nom + mot d'état qui pulse) ; petite ampoule lumineuse pendant le travail, remplacée par un point d'alerte ambre et un état ambre fixe en attente ; à droite, la légende (raison d'attente, sinon légende dérivée du raisonnement, sinon une phrase amicale qui change toutes les 6 s), avec un fondu montant de 320 ms quand elle change.

### B-8. Pilule plein écran et barre « tu conduis » (manquant chez nous)

1. **Pilule de contrôle** (en bas au centre de l'image, fond sombre translucide) : apparaît au survol ou quand le focus clavier est dans l'image ; **toujours visible** sur les appareils sans survol (tactile) ; reste affichée tant qu'une question ou une note y est montrée. Contenu, seulement quand l'image est en direct et qu'on ne conduit pas :
   - un interrupteur à deux segments **Regarder / Prendre le contrôle** (icônes en plus du texte dans la grande vue) ;
   - un séparateur ;
   - un bouton **plein écran** si le navigateur le permet (sinon absent) ; échec de la demande → note « le plein écran n'est pas disponible ici » ;
   - un bouton **réinitialiser** → la pilule se transforme en question « fermer toutes les fenêtres ? » avec Réinitialiser (rouge, libellé occupé pendant l'action) et Annuler. La question s'annule seule après **6 s** ; les notes disparaissent après **4 s**. Échec → note « impossible de réinitialiser l'écran ».
2. **Plein écran** : c'est le **cadre de l'écran** (pas toute la page) qui passe en plein écran ; l'état suit l'événement natif de changement de plein écran ; l'icône bascule entre « agrandir » et « réduire ».
3. **Prendre le contrôle depuis le petit panneau** : le petit panneau est trop petit pour conduire. Hors plein écran, « prendre le contrôle » ouvre la **grande vue directement en mode contrôle**. En plein écran du panneau, on peut conduire ; **quitter le plein écran rend la main** automatiquement.
4. **Barre « tu conduis »** (sous le cadre, seulement en mode contrôle) : hauteur 52 px, couleur d'action du bot, texte dans la couleur contrastée ; entrée animée (fondu + montée de 8 px, ~220 ms) ; le cadre reçoit un anneau de 2 px de la même couleur. Contenu : un point qui pulse, puis l'indication (par exemple « termine la connexion sur l'ordinateur de <bot>, puis rends la main ») ou à défaut « tu conduis » ; à droite un bouton plein écran et un bouton **« rendre la main à <bot> »** avec l'avatar du bot. Les animations sont coupées si l'utilisateur demande moins de mouvement.
5. **Rendre la main** : repasse en regard, prévient le serveur (qui note l'heure ; au tour suivant, le message du bot est précédé d'une note disant que l'utilisateur a eu la main et qu'il faut regarder l'écran avant de se fier à l'état précédent ; la note est effacée ensuite). L'échec de l'appel au serveur est ignoré (le bot continue de toute façon).
6. **Grande vue** : fermer en conduisant rend la main ; Échap ferme la grande vue **seulement** en mode regard et hors plein écran (en conduite, Échap appartient au bureau distant ; en plein écran, le navigateur l'utilise pour sortir) ; l'indication disparaît dès qu'on repasse en regard.

### B-9. Nom du premier bot (codé en dur chez nous)

1. À la **création d'un compte** (premier passage d'une adresse autorisée), l'application crée automatiquement le bot principal : nom et libellé lus dans les **réglages** (valeurs par défaut : un prénom humain et « chef de cabinet »), forme d'avatar et couleur fixes (une forme « tache » noire), une description fixe qui dit qu'il est le point de contact principal, qu'il fait des points réguliers de sa propre initiative et qu'il coordonne les autres bots ; marqué « principal ». Il est lié au moteur principal si celui-ci est libre.
2. L'installateur accepte ces deux valeurs en entrée et ne les écrit dans les réglages **que si elles sont fournies** (sinon les valeurs par défaut s'appliquent).
3. Le nom reste **modifiable ensuite** dans les réglages du bot : un renommage réécrit la fiche de personnalité (moteur géré seulement — le moteur principal garde la sienne) et réhabille l'écran (nouvelle salutation sur la page d'accueil sans rechargement manuel).
4. Aucun autre composant ne suppose ce nom : les tests le lisent depuis le serveur (U-010).
5. Pour nous : sortir le nom (et le libellé) du code vers un réglage, et idéalement le **demander à l'utilisateur à la première ouverture** (amélioration, absente de la source).

### B-10. Banc d'essai du bureau (« desk test ») (manquant chez nous)

Un script d'opérateur, distinct des tests unitaires, qui habille de vrais écrans d'un **ordinateur de test dédié** pour des bots inventés et vérifie le résultat en conditions réelles.

1. **Pré-conditions** : refuse de tourner si l'application est en mode « installée sur l'ordinateur » (il pilote un ordinateur de test **à distance** via l'API du fournisseur) ; exige l'identifiant de l'ordinateur de test. Réglages : dossier des captures (par défaut un dossier temporaire) et nombre d'écrans supplémentaires à utiliser (1 à 3 ; par défaut tous ceux qui existent, au moins 2). Il crée des écrans seulement s'il en manque ; il ne supprime **jamais** un écran ni l'ordinateur.
2. **Jeu de bots fictifs** : trois bots supplémentaires (nom, rôle, forme, couleur différents), un jeu de renommage (autre nom, rôle, forme et couleur — couleur bleue pour vérifier l'accent attendu), un bot principal fictif.
3. **Petit client de débogage navigateur** déposé sur l'ordinateur : il liste les onglets du navigateur sur un port donné, trouve celui qui affiche la page d'accueil locale, s'y connecte et évalue une expression qui renvoie le texte du titre principal, le texte du rôle et le nombre de tuiles d'applications. Les vérifications de salutation **réessaient jusqu'à 12 s**.
4. **Liste des navigateurs** : il recense les processus principaux du navigateur (hors processus auxiliaires) avec leur dossier de profil, leur port de débogage, et s'ils ont été lancés par l'application (repérés par un marqueur de ligne de commande).
5. **Séquence et vérifications** (chacune affichée « ok » ou « ÉCHEC » avec un détail, et chaque étape chronométrée) :
   1. installation de base deux fois (la deuxième doit être bon marché) ;
   2. écrans supplémentaires : déshabillage pour partir propre, puis habillage en parallèle ; pour chacun : le navigateur tourne avec le profil de ce bot sur le port attendu ; la page d'accueil salue ce bot par son nom ; l'apparence enregistrée porte le nom du bot ; capture ;
   3. ré-habillage sans changement : **moins de 3 s** chacun et **même processus** de navigateur ;
   4. renommage + recoloration + changement de forme du dernier bot : la page d'accueil **déjà ouverte** salue le nouveau nom sans rechargement manuel ; l'accent enregistré est le nouveau bleu ; un habillage avec « redémarrer le navigateur » donne un **nouveau** processus qui salue aussi le nouveau nom ; capture ;
   5. premier écran : réduire la fenêtre du navigateur pour montrer fond et dock (capture), ouvrir un terminal titré « connexion » qui exécute une petite commande, vérifier que la fenêtre existe (attente jusqu'à 6 s), capture, réinitialiser l'écran : le terminal a disparu et le navigateur est revenu sur la page d'accueil ; capture ;
   6. isolation : chaque écran a son propre profil, et chacun salue toujours son propre bot ;
   7. écran par défaut avec navigateur géré : déshabillage (capture), habillage, navigateur sur le port de l'écran par défaut avec le profil du bot principal, salutation correcte, capture ; les navigateurs **qui ne sont pas à l'application** sont toujours là, mêmes PID ;
   8. déshabillage de l'écran par défaut : le navigateur de l'application a disparu et aucune apparence n'est enregistrée ; capture ;
   9. écran par défaut **sans gestion du navigateur** (deux fois) : aucun navigateur de l'application lancé ; navigateurs étrangers intacts ; si un navigateur étranger expose un port de débogage, un nouvel onglet ouvert dedans affiche la page d'accueil du bot principal (identifiée par l'écran sur lequel il tourne), puis cet onglet est refermé ; captures fond + dock ; terminal ouvert ; réinitialisation : terminal fermé, navigateurs étrangers toujours en marche, aucun navigateur lancé ; capture.
6. **Fin** : tableau des durées, puis « tout est passé » ou « N vérifications ont échoué ». Codes de sortie : 0 = tout bon, 1 = au moins un échec, 2 = arrêt sur exception. Il laisse tous les écrans habillés.
7. **Projection conteneur (notre cas)** : même esprit, adapté : démarrer 2–3 conteneurs de bots fictifs, vérifier profil isolé, port de débogage propre à chaque conteneur, salutation via le protocole de débogage, ré-habillage < 3 s sans redémarrer le navigateur, renommage visible sans recharger, réinitialisation qui ferme un terminal et ramène l'accueil, captures enregistrées dans un dossier ; ne jamais supprimer de données utilisateur.

### B-11. Désinstallation complète (manquant chez nous)

Ce que la source documente (procédure manuelle, en root, sur l'ordinateur), dans cet ordre :
1. **Déshabiller l'écran principal** (le remettre comme avant : fond, panneaux, thème, processus de l'application arrêtés).
2. **Retirer l'entrée « serveur d'outils »** de la configuration du moteur principal, avec le même outil d'édition sûr qui l'avait ajoutée (édition texte en place, copie datée de l'ancien fichier, vérification que tous les autres réglages sont inchangés et que l'entrée a bien disparu, remplacement atomique en gardant droits et propriétaire, « rien à changer » si déjà absente). Le moteur recharge sa configuration sans redémarrage.
3. **Arrêter puis retirer** le service supervisé de l'application.
4. **Supprimer** : la configuration du service, le dossier de l'application (code, données, moteurs gérés, runtime Node), le dossier des journaux, le dossier des profils de navigateur et des Bibliothèques, et le fichier de politique du navigateur géré.
5. **Supprimer l'URL publique** chez le fournisseur.
6. Les écrans des autres bots sont libérés quand on supprime ces bots dans l'application (donc à faire **avant** l'étape 3).

Lacunes de la source à **corriger** chez nous (pour une vraie désinstallation complète, en une commande) :
- supprimer d'abord chaque bot (ou arrêter chaque moteur/conteneur géré) : les passerelles des moteurs gérés **survivent** à l'arrêt du serveur et ne sont pas arrêtées par la procédure ;
- arrêter le serveur de page d'accueil et les programmes de dock/fond encore en marche sur d'autres écrans ;
- retirer aussi le fichier de politique dans le dossier de politiques de Chromium (pas seulement celui de Chrome), et la clé de signature de l'extension ;
- restaurer le fichier de réglages GTK de l'utilisateur depuis la sauvegarde faite à l'installation ;
- proposer, avant d'effacer, une **sauvegarde** des Bibliothèques et de la base (données de l'utilisateur), avec confirmation explicite ;
- rendre la commande idempotente (relançable sans erreur) et afficher à la fin ce qui a été retiré et ce qui reste.

---

## C. À ne pas reproduire tel quel (services propriétaires ou payants) et alternatives gratuites

| Élément de la source | Pourquoi ne pas reproduire | Alternative gratuite / libre |
|---|---|---|
| Ordinateur cloud Orgo (écrans, VNC, URL publique, 4 écrans max) | Service payant ; limite de 4 écrans | Un conteneur Docker local par bot (Xvfb + gestionnaire de fenêtres + Chromium + serveur VNC sur la boucle locale), limite fixée par les ressources de la machine ; exposition par un tunnel gratuit (Cloudflare Tunnel, Tailscale) ou un proxy inverse. |
| Recherche X via l'outil natif de xAI | Clé xAI payante ; l'API officielle de X est payante | Recherche web générale restreinte au domaine x.com (moteur de recherche déjà utilisé par l'agent ou instance SearXNG auto-hébergée), puis lecture des pages publiques avec le navigateur du bot ; présenter le résultat dans le même format (réponse + liste de sources). Garder l'outil xAI en option si l'utilisateur fournit sa clé. |
| Voix temps réel, synthèse et dictée xAI | Payant | Dictée : Whisper local (whisper.cpp / faster-whisper) ; synthèse : Piper ; ou rester texte seul. |
| Composio (applications connectées, déclencheurs, connexion Google gérée) | Service tiers à clé ; connexion Google déléguée | Serveurs MCP libres par service (déjà en place chez nous), OAuth géré par nous ; webhooks/sondage maison pour les déclencheurs. |
| Moteur Hermes Agent comme boucle d'agent | Dépendance externe ; ses invites « commande risquée » ne remontent pas dans l'application | Garder notre propre boucle d'agent ; si on adopte un jour un moteur externe, reprendre seulement les idées : validation **dans** l'appel d'outil avec délai borné, corrélation des lignes (B-3), consignes par tour stables pour le cache. |
| Connexion à un **abonnement grand public** (Claude Pro/Max, ChatGPT…) pour faire tourner un agent | Les conditions des fournisseurs peuvent l'interdire | Clés API, ou modèles locaux (Ollama) ; si on garde la connexion par abonnement, afficher l'avertissement sur les conditions d'utilisation. |
| Illustrations des bots et certaines icônes reprises d'un produit commercial (exclues de la licence MIT) | Propriété de tiers | Nos propres formes d'avatar et pictogrammes, dessinés par nous. |
| Mise en page et page d'accueil « inspirées » d'un autre projet | Risque de ressemblance | Notre propre dessin (palette, pictogrammes, page d'accueil), en suivant seulement les comportements décrits ici. |
