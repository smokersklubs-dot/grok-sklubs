# Méthodes de travail pour Sklubot

Choisis la fiche qui répond à la difficulté du moment. Applique-la aux documents, au dépôt et aux outils disponibles dans la session. Termine par le résultat obtenu et le contrôle réellement effectué. Ce manuel peut aussi être joint à une conversation Claude, ChatGPT ou Grok. Pour explorer d’autres techniques et modèles, ouvre le [répertoire OpenDesign](opendesign.md).

## Cadrer une demande

Pour transformer une demande ouverte en travail vérifiable et décider où commencer.

### Écrire le brief en quatre lignes
Consigne le destinataire, l’action qu’il doit pouvoir réaliser, le livrable qu’il recevra et la contrainte qui compte le plus. Pour une page de devis, « un acheteur peut comparer deux quantités sur mobile » oriente mieux le travail que « une belle page commerciale ».

### Définir le test de réception
Écris une situation de départ, un geste et un résultat observable. Par exemple, avec trois devis dont un accepté, choisir « Accepté » doit afficher une ligne et le bon montant. Conserve ce scénario pour la livraison.

### Dresser la carte de l’existant
Repère le point d’entrée utilisé aujourd’hui, les fichiers ou services qu’il appelle et les données déjà présentes. Ouvre un exemple existant. Désigne l’endroit précis où intégrer l’ajout et le comportement existant à préserver.

### Lever une incertitude à moindre coût
Identifie l’inconnue qui pourrait invalider le projet. Construis le plus petit essai qui permet de trancher, avec son résultat attendu. Pour un export, ouvre un vrai fichier représentatif dans l’application destinataire avant de réaliser tous les écrans.

### Prioriser un premier parcours complet
Classe les demandes selon leur utilité pour le destinataire et leurs dépendances. Livre un parcours qui va de l’entrée au résultat. Garde les autres demandes dans une liste explicite pour que la prochaine itération reprenne au bon endroit.

Références · [OpenDesign, brief](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/design-brief) · [Claude Code, pratiques de projet](https://code.claude.com/docs/en/best-practices)

## Rechercher et décider

Pour instruire une décision, comparer des sources et mener une veille datée, y compris sur X.

### Tenir un registre de preuves
Pour chaque affirmation décisive, consigne le lien primaire, la date de l’observation, le périmètre et ce que la source permet de conclure. Relie chaque chiffre de la synthèse à sa ligne. Marque une valeur introuvable comme inconnue.

### Remonter à la source primaire
Ouvre la publication d’origine derrière un article ou une capture. Vérifie la date de l’événement, l’unité et le passage qui étaye l’affirmation. Regroupe les reprises d’une même annonce pour compter correctement les confirmations indépendantes.

### Borner une veille sur X
Fixe une question, une période et les comptes ou termes à suivre. Avec un outil de recherche X disponible, filtre par date, remonte aux messages originaux et lis le fil. Livre les permaliens et les limites de l’échantillon. Avec des liens fournis, précise que la veille porte sur ceux-ci.

### Comparer les options par critère
Choisis les critères avant de noter les options. Pour un fournisseur, ramène prix, délai et quantité au même périmètre. Indique la source de chaque note puis varie le critère décisif pour voir si le classement change.

### Rédiger une note de décision
Ouvre sur la décision attendue. Donne l’option proposée, la preuve la plus forte, une objection sérieuse et l’information susceptible de changer le choix. Attribue à quelqu’un le prochain geste et précise quand réexaminer la décision.

Références · [OpenDesign, dossier de décision](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/research-decision-room) · [xAI, recherche sur X](https://docs.x.ai/developers/tools/x-search)

## Étudier une référence visuelle

Pour tirer des règles de mise en page d’une référence fournie et produire une réalisation originale.

### Relever la composition à deux largeurs
Ouvre la référence publique à une largeur de bureau puis de téléphone si le navigateur le permet. Note les deux dimensions. Relève l’ordre des sections, les colonnes, marges et tailles de titres. Dans Sklubot, utilise design_reference_layout sur l’adresse ouverte pour étayer les mesures.

### Retracer une interaction visible
Choisis une interaction centrale. Observe son état initial, active-la, relève ce qui change puis reviens au point de départ. Décris la séquence de gestes et ses effets. Si tu disposes uniquement d’une capture, indique les étapes qui demandent encore un essai.

### Établir un contrat de réalisation
Transforme les observations en règles vérifiables, par exemple « le panier reste accessible après un filtre » ou « le texte passe au-dessus de l’image sur téléphone ». Recense les contenus, visuels et composants originaux à produire pour le projet.

### Construire une coupe représentative
Réalise une section complète avec le vrai titre, un texte long et l’action principale. Affiche-la aux largeurs relevées. Résous les questions de composition sur cette section avant de décliner le reste des écrans.

### Mesurer les écarts après rendu
Compare référence et réalisation à dimensions égales. Classe les différences visibles par impact sur la lecture et l’action. Corrige d’abord le premier écart matériel, reprends la même capture et conserve les divergences intentionnelles dans le compte rendu.

Références · [OpenDesign, contrat visuel](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/reference-design-contract) · [Craft Anything, mesures de page](https://github.com/storytold/craft-anything/blob/v0.6.1/crates/engine/src/tools/website_tools.rs)

## Construire une direction artistique

Pour retrouver une identité de marque et la décliner sur une page, une campagne ou une interface.

### Extraire un kit de marque
Pars des supports validés par le client. Relève les couleurs, typographies, proportions du logo, traitements photo et exemples de ton effectivement observés. Associe chaque règle à son support et marque les décisions qui restent à prendre.

### Distribuer les rôles typographiques
Définis un style par usage réel, titre, intertitre, texte courant, légende et chiffre. Essaie le titre le plus long et une ligne de chiffres. Vérifie la lecture sur téléphone et l’alignement des valeurs dans un tableau.

### Attribuer une fonction aux couleurs
Attribue des valeurs au fond, au texte, à l’action principale et aux états. Vérifie les couples texte/fond sur les composants rendus. Ajoute une forme ou un libellé lorsqu’une couleur sert à signaler une erreur ou une sélection.

### Comparer deux directions sur le même contenu
Présente deux compositions avec les mêmes textes, images et contraintes. Fais varier un choix identifiable, comme la densité ou la hiérarchie. Explique l’effet sur le destinataire et conserve les choix approuvés pour la suite.

### Décliner une composition en plusieurs formats
Identifie le message, le sujet visuel et le geste à préserver. Recadre chaque format à partir de ces trois éléments. Vérifie chaque sortie à sa taille de diffusion, notamment la lisibilité du titre et la présence entière du produit.

Références · [OpenDesign, extraction de marque](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/brand-extract) · [OpenDesign, principes de composition et de typographie](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/craft)

## Réaliser des visuels produit

Pour préparer et contrôler un packshot, un visuel de packaging ou une série e-commerce.

### Figer les attributs du produit
À partir des photos et fichiers fournis, inventorie silhouette, matière, proportions, fermeture, textes imprimés et variantes. Garde une référence par attribut critique. Pour une zone cachée, demande la vue nécessaire si elle conditionne le livrable.

### Préparer une liste de prises de vue
Attribue un objectif commercial à chaque image. Une vue de face permet d’identifier le produit, une vue en situation en montre l’échelle et un détail explique la finition. Note le cadrage et le critère de réussite pour chaque vue.

### Rédiger une consigne de prise de vue
Pour une image, décris successivement le produit de référence, l’angle, la distance, la lumière, le décor et le format final. Indique les éléments graphiques à conserver. Essaie un seul cadrage avant de lancer une série avec un outil disponible.

### Contrôler la fidélité du packaging
Compare la sortie et le fichier validé à taille égale. Vérifie l’orthographe, l’orientation du motif, la géométrie des soudures et la position du logo. Isole toute divergence qui compromet l’identification et corrige-la avant de décliner l’image.

### Assembler une planche de validation
Place côte à côte référence, résultat et gros plan de la zone sensible. Identifie la variante, la vue et la version. Donne une décision précise pour chaque image, par exemple « face validée » ou « refaire le reflet qui masque le texte ».

Références · [OpenDesign, production d’images e-commerce](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/ecommerce-image-workflow)

## Réaliser une séquence vidéo

Pour passer d’une intention à un découpage, monter une première version et vérifier le rendu final.

### Écrire un traitement court
Identifie le public, l’idée qu’il doit retenir et le dernier plan. Raconte le changement entre première et dernière image en trois phrases. Pour un film produit, précise ce que le spectateur aura vu du produit qui justifie le message final.

### Découper en plans minutés
Établis un tableau avec durée, cadrage, action à l’image, son et fonction de chaque plan. Additionne les durées avec le carton final. Pour une vidéo de quinze secondes, chronomètre la lecture des textes avant de décider combien de plans conserver.

### Monter un animatique
Assemble des images fixes et une voix témoin aux durées prévues. Visionne l’ensemble à vitesse normale sans explication orale. Horodate le premier moment où une information arrive trop tôt ou trop tard, déplace ce plan et revois la séquence.

### Chorégraphier l’attention
Attribue un point d’attention dominant à chaque instant. Fais arriver le titre au moment où le regard quitte le mouvement précédent. Lis la séquence sans son puis sur un petit écran et vérifie que les éléments essentiels restent visibles assez longtemps.

### Contrôler la copie de diffusion
Ouvre le fichier exporté dans son format de diffusion. Contrôle le premier et le dernier plan, les coupes, la synchronisation, les sous-titres et les marges des textes. Note la durée et les paramètres effectivement lus. Si seul le storyboard existe, livre-le en l’identifiant comme tel.

Références · [OpenDesign, direction et composition du mouvement](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/motion-design) · [OpenDesign, revue du mouvement](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/review-animations)

## Préparer une campagne créative

Pour transformer une promesse commerciale en messages et visuels que l’équipe peut tester ou produire.

### Associer une promesse à sa preuve
Écris le bénéfice pour une cible précise puis retrouve la pièce qui l’étaye, photo, démonstration, chiffre daté ou citation autorisée. Vérifie la portée exacte. Un échantillon de matière permet de montrer une texture, tandis qu’une promesse de durée exige une autre preuve.

### Décliner plusieurs angles de campagne
À offre identique, formule un angle par besoin client, par exemple usage, gain de temps ou finition. Donne à chaque angle une accroche, un visuel et un appel à l’action. Sélectionne les pistes dont la preuve peut apparaître dans le format demandé.

### Composer la première image
Dessine la première image telle qu’elle apparaîtra dans le fil de la plateforme. Place le produit, l’accroche et l’information décisive dans le cadrage réel. Vérifie la lecture à taille téléphone et ce que le visuel communique lorsque la légende reste repliée.

### Préparer un test de création
Fixe l’hypothèse, la mesure de réussite et l’élément créatif à comparer. Prépare deux variantes avec audience, placement et offre identiques. Donne les noms de fichiers et les différences prévues pour que l’équipe puisse attribuer les résultats à la bonne variante.

### Constituer le dossier de production
Rassemble brief, textes approuvés, sources visuelles, formats de destination et fichiers de travail. Note les droits ou validations qui restent à obtenir. Associe chaque export à sa variante et ouvre un exemplaire pour contrôler dimensions, lisibilité et présence de l’appel à l’action.

Références · [OpenDesign, créations publicitaires](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/ad-creative) · [OpenDesign, rédaction commerciale](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/copywriting)

## Concevoir une interface utilisable

Pour rendre des formulaires et prototypes utilisables sur téléphone, au clavier et dans plusieurs langues.

### Cartographier les états d’un écran
Pour chaque action centrale, prépare le cas initial, le chargement, le succès, l’absence de données et l’erreur. Fais apparaître chaque état avec des données de test. Vérifie que l’utilisateur comprend ce qu’il peut faire ensuite.

### Valider un formulaire sans perdre la saisie
Teste une soumission vide, une valeur invalide puis une correction. Place l’explication près du champ concerné, préserve les autres valeurs et déplace le focus vers l’erreur utile. Vérifie qu’une soumission réussie donne une confirmation visible.

### Parcourir un écran au clavier
Effectue l’action principale avec Tabulation, Entrée et Échap. Observe l’ordre et la visibilité du focus, l’ouverture des fenêtres puis le retour au contrôle d’origine. Identifie le premier geste bloqué et rejoue le parcours après correction.

### Éprouver la mise en page avec du vrai texte
Teste le plus petit écran pris en charge avec un titre long, une devise, une date et un message d’erreur dans la langue cible. Repère débordements, textes tronqués et boutons inatteignables. Pour une langue RTL, vérifie également l’ordre de lecture et les icônes directionnelles.

### Contrôler le mouvement et sa réduction
Associe chaque animation à un changement que le lecteur doit comprendre. Déclenche-la, interagis pendant la transition puis essaie la préférence de mouvement réduit. Le résultat final et l’accès à l’action doivent rester visibles dans les deux cas.

Références · [OpenDesign, états, accessibilité, formulaires et écriture bidirectionnelle](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/craft) · [OpenDesign, revue des animations](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/review-animations)

## Expliquer des données

Pour livrer des indicateurs, un tableau de bord ou une présentation dont les chiffres se vérifient.

### Établir un dictionnaire des indicateurs
Pour chaque indicateur, consigne sa définition, son unité, son dénominateur, sa période et la source. Pour un taux de conversion, précise ce qui constitue une visite et une conversion. Utilise les mêmes définitions dans le tableau, le graphique et le texte.

### Réconcilier les totaux
Choisis une période et recalcule son total depuis les lignes sources. Vérifie doublons, valeurs manquantes, remboursements et arrondis. Inscris l’écart éventuel avec son origine. Refais le calcul sur les données filtrées avant d’afficher le nouvel indicateur.

### Choisir une figure selon la question
Utilise une courbe pour une évolution, des barres pour une comparaison ou un tableau pour une valeur exacte. Affiche unités et période. Vérifie le message avec une phrase qui peut être confirmée directement par les données visibles.

### Construire un jeu de démonstration
Crée quelques lignes fictives comprenant un cas normal, une valeur nulle et un filtre sans résultat. Identifie clairement les données de démonstration à l’écran. Utilise ce jeu pour vérifier tri, totaux et états vides avant de brancher une source réelle.

### Construire un récit de présentation
Pars de la décision du lecteur. Donne un message vérifiable à chaque diapositive, un visuel qui le démontre et la période concernée. Termine sur la décision ou l’action proposée. Ouvre le fichier exporté et relis les légendes en taille de projection.

Références · [OpenDesign, rapports de données](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/data-report) · [Craft Anything, méthode de réalisation](https://github.com/storytold/craft-anything/tree/v0.6.1/crates/ai/src/rebuild)

## Modifier un logiciel existant

Pour intervenir dans un dépôt, isoler une cause et vérifier la correction sur le parcours utilisateur.

### Suivre un appel de bout en bout
Pars du bouton, de la commande ou de la route utilisée. Retrouve l’appel au service, la persistance et le retour à l’écran. Identifie le premier endroit où l’état réel diverge du résultat attendu avant de choisir le fichier à modifier.

### Capturer le comportement de départ
Rejoue le problème avec une entrée stable. Note version, commande, résultat attendu et résultat observé. Garde un cas voisin déjà correct. Rejoue les deux après la modification pour contrôler à la fois la correction et sa compatibilité.

### Tester une hypothèse à la fois
Formule une cause possible et le signal qui la contredirait. Modifie un seul paramètre ou ajoute une observation ciblée. Si le signal contredit l’hypothèse, abandonne cette piste, conserve l’observation et passe à la suivante.

### Livrer une modification verticale
Fais passer une petite fonctionnalité par ses vraies couches, de l’action utilisateur à la donnée sauvegardée. Réutilise les mécanismes de l’application. Recharge l’écran et vérifie le résultat sur un enregistrement récent puis sur un enregistrement préexistant.

### Relire les conséquences d’un changement
Relis le diff depuis le point de vue des appelants. Cherche les contrats modifiés, les sorties partielles en cas d’erreur et les entrées oubliées. Accompagne chaque problème retenu d’un emplacement, d’un cas observable et d’un contrôle de correction.

Références · [Claude Code, pratiques de développement](https://code.claude.com/docs/en/best-practices) · [Codex, bonnes pratiques](https://developers.openai.com/codex/learn/best-practices) · [OpenDesign, revue de modification](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/pr-feedback-quality-gate)

## Réviser et livrer un artefact

Pour faire évoluer une création dans le chat, contrôler ses versions et remettre des fichiers utilisables.

### Créer une première version privée
Crée un artefact répondant au scénario central, avec des ressources locales et des données de démonstration identifiées si nécessaire. Dans Sklubot, appelle artifact_create. Vérifie que la carte apparaît dans la conversation et que le contrôle principal produit son effet.

### Réviser depuis la source courante
Retrouve le nom de l’artefact et lis les fichiers concernés avec page_source. Applique la demande avec page_edit sur le même artefact. Note le comportement à conserver, teste la modification et vérifie que la version précédente reste consultable.

### Transformer un retour en contrôle
Traduis « on lit mal les montants » en un cas précis avec largeur, écran et exemple de montant. Corrige le problème puis rejoue le cas. Réutilise une preuve antérieure uniquement si les entrées, le rendu et le code dont elle dépend sont identiques.

### Ouvrir le téléchargement livré
Télécharge la version demandée, ouvre le HTML ou extrais l’archive dans un dossier neuf. Vérifie les chemins, les styles et un contrôle interactif. Pour des modules ou un chargement de données local, sers le dossier par HTTP et donne ce mode d’ouverture.

### Vérifier une restauration
Identifie la version voulue et un élément qui permet de la reconnaître. Utilise la restauration demandée, rouvre la version courante et vérifie cet élément. Donne les numéros de version avant et après pour permettre à l’utilisateur de reprendre l’historique.

Références · [Craft Anything, révisions et contrôles conservés](https://github.com/storytold/craft-anything/tree/v0.6.1/crates/ai/src/rebuild) · [OpenDesign, diagnostic des exports](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/skills/export-download-debugging) · [Galerie d’exemples d’artefacts](https://github.com/madewithclaude/awesome-claude-artifacts)

## Utiliser les outils et transmettre le travail

Pour choisir un outil disponible, reprendre une opération et transmettre des résultats contrôlables entre bots.

### Vérifier les capacités de la session
Identifie le moteur, les outils proposés et la donnée qu’ils permettent réellement de lire ou écrire. Pour une capacité essentielle, fais une lecture simple sur la ressource concernée. Si elle manque, utilise une pièce fournie ou indique précisément ce qui reste à obtenir.

### Préparer un appel structuré
Lis le schéma de l’outil et identifie champs obligatoires, identifiants attendus et unités. Récupère les identifiants par une lecture. Après l’appel, examine le résultat métier et son éventuelle erreur avant de l’utiliser à l’étape suivante.

### Reprendre après une réponse perdue
Après une interruption pendant une écriture, retrouve d’abord l’état côté destination avec l’identifiant ou l’historique. Si l’effet est confirmé, reprends après cette étape. Si l’état reste indéterminé, garde la référence et signale cette incertitude avant toute répétition susceptible de dupliquer l’action.

### Transmettre un dossier entre moteurs
Consigne l’objectif, les décisions acceptées, les fichiers et versions, les contrôles déjà exécutés et la prochaine action. Donne les chemins ou liens accessibles au destinataire. Pour passer de Claude Code à Codex ou Grok, joins les pièces nécessaires et vérifie que le nouveau bot peut les ouvrir.

### Rendre un bilan reproductible
Donne le livrable, la commande ou le geste testé, le résultat observé et ce qui reste à vérifier dans l’environnement réel. Identifie les données fictives et le moteur utilisé pour l’essai. Un lecteur doit pouvoir refaire le même contrôle sans avoir suivi la discussion.

Références · [xAI, appels d’outils](https://docs.x.ai/developers/tools/function-calling) · [Codex, bonnes pratiques](https://developers.openai.com/codex/learn/best-practices) · [Craft Anything, suivi des étapes](https://github.com/storytold/craft-anything/tree/v0.6.1/crates/ai/src/rebuild)
