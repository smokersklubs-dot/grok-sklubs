# Créer un artefact dans Sklubot

Dans la discussion d’un bot, choisis **+ → Créer un artefact** ou décris directement ton projet. Par exemple, « Crée un tableau de bord de suivi des devis avec un filtre par statut et des données de démonstration ». La carte interactive apparaît dans la discussion. Le bot enregistre le HTML et les fichiers CSS, JavaScript ou données dans sa bibliothèque de pages. Un nouvel artefact est privé.

**Agrandir et voir les versions** ouvre l’atelier. Choisis une version pour la tester ou la télécharger. La version courante accepte une demande de modification en langage naturel. La demande revient dans la conversation d’origine, où apparaissent la progression du bot et ses erreurs. Pour une refonte, demande de régénérer le même artefact. **Réglages → Pages** permet de retrouver les pages du compte et de restaurer une ancienne version. Une restauration crée une nouvelle version.

Le téléchargement donne un fichier HTML pour une page autonome, ou une archive TAR contenant `index.html` et ses ressources aux chemins relatifs d’origine. Pour un projet utilisant des modules JavaScript ou `fetch`, extrais l’archive et sers le dossier avec un serveur statique. Les données saisies dans l’aperçu pendant une session ne font pas partie du téléchargement.

## Design et références

Les bots Sklubot peuvent consulter le [manuel des 60 méthodes de travail](../server/templates/methodes/manuel.md) à la demande. Essaie « Relève la composition sur ordinateur et téléphone, crée une version privée de mon catalogue, puis vérifie son téléchargement ». Le bot retrouve les familles et les fiches par titre avec `guide_read`. Le manuel Markdown peut aussi être joint à une conversation externe pour lui donner les mêmes procédures. Le [répertoire OpenDesign](../server/templates/methodes/opendesign.md) classe 169 ressources supplémentaires et renvoie à la version d’origine de chacune.

Joins une capture ou donne l’adresse d’une référence publique et précise ce que tu veux en retenir. Sur un bot équipé d’un navigateur, l’outil `design_reference_layout` mesure le rendu à la largeur affichée. Il reprend le calcul de Craft Anything pour les sections, colonnes, marges intérieures, tailles de texte et couleurs de fond. Le bot peut compléter ces mesures par une capture et signaler les comportements qu’il n’a pas vérifiés. Le calcul s’exécute dans le navigateur du bot. [Source de Craft Anything v0.6.1](https://github.com/storytold/craft-anything/blob/v0.6.1/crates/engine/src/tools/website_tools.rs)

Pour une direction graphique monochrome, demande « utilise le thème Atelier Zero ». Sklubot joint la feuille de variables CSS d’OpenDesign au projet. Le navigateur peut ainsi afficher la création hors ligne avec les fichiers exportés. [Atelier Zero dans OpenDesign](https://github.com/nexu-io/open-design/tree/07258801b9e4ae80553816bb1606af7aa9a63dff/design-systems/atelier-zero)

## Installation et comptes

L’installation standard de Sklubot inclut l’atelier (`npm ci`, puis `npm run build`). Le moteur choisi pour le bot réalise la création. Pour utiliser son abonnement ChatGPT dans le parcours CLI existant, active l’ordinateur Linux du bot, puis ouvre **Réglages → Mes comptes IA**, connecte ChatGPT et affecte Codex au bot. La session est celle de cet ordinateur. Une connexion Codex sur le PC Windows ne connecte pas automatiquement le conteneur. Si Codex demande de se reconnecter, termine la connexion sur l’ordinateur du bot, puis reprends la demande. Claude Code utilise son propre compte Claude.

Pour publier séparément sur Claude, le formulaire **Outils locaux** du bot propose le préréglage **Claude Artifacts**. Il lance `npx -y --package claude-artifacts@0.1.18 claude-artifacts-mcp` dans l’ordinateur Linux du bot. Connecte le CLI dans ce même environnement avec `npx -y --package claude-artifacts@0.1.18 claude-artifacts auth login`. Sur un PC où le paquet est installé globalement, la commande est `claude-artifacts auth login`. Une publication externe nécessite une demande de partage et produit sa propre adresse Claude. [Documentation du CLI et du MCP](https://github.com/kamilio/claude-artifacts)

Les artefacts du MVP sont des projets web statiques. L’aperçu exécute leur JavaScript avec une origine isolée et limite le chargement des ressources au projet. Une application nécessitant un serveur, une clé ou une API tierce doit utiliser des données de démonstration pour cet aperçu. Les versions et quotas suivent le forfait Sklubot. La galerie communautaire donne des exemples de tableaux de bord et de jeux. [Awesome Claude Artifacts](https://github.com/madewithclaude/awesome-claude-artifacts)

## Fonctionnement dans Sklubot

L’interface React ouvre l’atelier depuis le message qui contient l’artefact. Le serveur Hono enregistre le HTML dans la bibliothèque du bot, les fichiers annexes et les versions dans SQLite, et le lien dans la conversation active. L’export utilise l’archiveur déjà présent dans Sklubot. Les mêmes outils de création et de lecture des méthodes sont proposés au moteur choisi pour le bot. Les règles de sélection sont communes aux comptes et aux bots. La création native fonctionne avec l’abonnement ChatGPT déjà connecté au bot.

Pour demander une création, décris simplement son usage dans la conversation. Sklubot choisit le guide et l’outil utiles. Un calculateur devient un artefact privé. Une demande de montage ouvre le studio vidéo. L’étude d’une référence utilise les mesures de mise en page de Craft Anything. Chaque compte conserve ses propres fichiers et autorisations.

Craft Anything 0.6.1 est fourni dans l’image des nouveaux ordinateurs Linux. Sur un ordinateur plus ancien, le bot prépare automatiquement la même version lors de la première utilisation. Les archives officielles amd64 et arm64 sont vérifiées par SHA-256. Pour une création web avec le générateur Craft et l’abonnement Codex du bot, le choix de pile est `Plain HTML and CSS`. Le fichier HTML autonome généré peut être ouvert directement comme artefact dans la conversation. La source, les modifications et les versions restent liées au même bot.
