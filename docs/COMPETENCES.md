# Compétences des bots : la bibliothèque, l'import depuis GitHub et les pages « comme des artefacts »

Ce guide explique comment apprendre de nouveaux savoir-faire à tes bots, et ce qu'ils savent maintenant faire avec les pages web.

## 1. La bibliothèque de compétences

**Où :** Réglages → **Compétences** (ou le bouton **Bibliothèque** dans l'onglet Compétences d'un bot).

Chaque carte montre le nom de la compétence, à quoi elle sert, d'où elle vient et sa licence. **Lire le texte** affiche exactement ce que le bot lira.

- Choisis **Tous mes bots** ou un bot précis, puis **Ajouter**.
- Le bot l'a tout de suite. Ajouter deux fois ne crée pas de doublon.
- Pour la changer ou la retirer : onglet Compétences du bot.

| Compétence | Origine | Licence | Langue |
|---|---|---|---|
| Méthode de travail | écrite pour Sklubot | MIT (celle du projet) | français + anglais |
| Pages soignées (comme des artefacts) | écrite pour Sklubot | MIT | français + anglais |
| Design de marque | écrite pour Sklubot | MIT | français + anglais |
| Réponses courtes en conversation | adaptée de Hermes Bot Kit | MIT | français + anglais |
| Suivi du travail dans le chat | adaptée de Hermes Bot Kit | MIT | français + anglais |
| E-mails à relire avant envoi | adaptée de Hermes Bot Kit | MIT | français + anglais |
| Design soigné (pages web) | adaptée de `anthropics/skills` (frontend-design) | Apache-2.0 | anglais |
| Affiches et visuels (PNG, PDF) | adaptée de `anthropics/skills` (canvas-design) | Apache-2.0 | anglais |
| Thèmes de couleurs | adaptée de `anthropics/skills` (theme-factory) | Apache-2.0 | anglais |

Les trois compétences de design en anglais viennent du dépôt public github.com/anthropics/skills, dont le dossier de chaque compétence contient la licence Apache 2.0. Elles sont rangées dans `server/skills-library/<nom>/` avec leur `LICENSE.txt` d'origine (inchangé), un fichier `NOTICE` (« © Anthropic, PBC — Apache License 2.0, from github.com/anthropics/skills ») et la liste des modifications faites pour Sklubot, comme la licence l'exige. Aucun script, police, image ou PDF de ces dossiers n'est inclus : seulement le texte.

Pas incluses, et pourquoi :
- *brand-guidelines* : c'est la charte graphique d'Anthropic elle-même ; l'appliquer aux pages de tes clients serait utiliser la marque d'un autre. Remplacée par « Design de marque », qui applique **ta** marque.
- *web-artifacts-builder* : repose sur des scripts propres à claude.ai ; « Pages soignées » couvre le même besoin avec les outils de Sklubot.
- *algorithmic-art* : dépend d'un gabarit de 20 ko (avec la marque Anthropic) que la compétence ne peut pas emporter.
- Les compétences de documents du même dépôt (*docx, pdf, pptx, xlsx*) ne faisaient pas partie de la sélection.

Les trois adaptations de [Hermes Bot Kit](https://github.com/thomasbek3/hermes-bot-kit/tree/efba9156f49bf69ae763f67135218cf890275083) réutilisent les instructions du kit avec les outils de Sklubot. Chaque fiche inclut la licence MIT et le crédit de Thomas Bekkers. Les brouillons sont préparés dans le compte Gmail ou Outlook choisi. La connexion Slack se vérifie dans **Réglages → Applis**, sur la ligne du compte Slack connecté.

## 2. Importer des compétences depuis GitHub

**Où :** Réglages → Compétences, en bas : **Importer depuis GitHub**.

1. Colle l'adresse d'un dépôt **public** de github.com, ou d'un de ses dossiers (par exemple `https://github.com/proprietaire/depot/tree/main/skills`).
2. **Chercher** : Sklubot liste les fichiers `SKILL.md` trouvés, avec leur licence (celle du dossier de la compétence, sinon celle du dépôt, sinon celle annoncée dans le README).
3. Sont cochées d'avance seulement les compétences sous licence libre (Apache-2.0, MIT, BSD, ISC, CC0, Unlicense, CC BY) sans problème signalé. Pour les autres (« aucune licence », « restrictive », GPL…), c'est toi qui décides : sans licence, la réutilisation n'est pas permise par défaut.
4. Signalements : *texte qui semble contenir une clé*, *trop longue* (plus de 20 000 caractères : impossible), *autres fichiers non importés* (scripts, images), *nom déjà utilisé*.
5. **Importer en brouillon** : les compétences arrivent **en brouillon**, avec leur source et leur licence à la fin. Le bot ne les utilise pas tant que tu n'as pas cliqué **Activer** dans son onglet Compétences, après les avoir lues.

Sécurité : seul le texte des `SKILL.md` est lu ; rien n'est jamais exécuté sur le serveur. Le téléchargement passe par la protection réseau de Sklubot (adresses publiques seulement, GitHub uniquement, 15 Mo au plus), l'archive est lue sans chemins piégés (`..`, liens, chemins absolus), 10 recherches par heure au plus.

**Qui peut importer :** sur ton propre serveur, tout le monde. En mode hébergé, le propriétaire et les opérateurs, et les clients d'une offre payante ; **pas l'offre gratuite**. La bibliothèque intégrée, elle, est ouverte à toutes les offres.

## 3. Les pages des bots, « comme des artefacts »

Les bots publient des pages web avec `page_publish` et les corrigent avec `page_edit`. Ce qui est nouveau :

- **Pages interactives** : calculatrices, tableaux de bord avec graphiques, listes, quiz, mini-jeux, diaporamas. Le JavaScript tourne dans un **bac à sable** : sans cookie, sans stockage, sans accès à ton compte ni à Sklubot.
- **Plusieurs fichiers** : une page HTML plus jusqu'à 20 fichiers texte à côté (`.css`, `.js`, `.json`, `.csv`, `.svg`…), 5 Mo en tout (offre gratuite : 5 fichiers, 1 Mo).
- **Versions** : chaque publication et chaque modification garde l'ancienne version (20 au plus, 5 sur l'offre gratuite). Réglages → **Pages** → **Versions** : voir une version, **Rétablir**.
- **Aperçu dans la discussion** : quand un bot publie une page, une carte l'affiche directement dans le fil, avec **Ouvrir**, **Copier le lien** et **Versions**.
- **Partage** : « Moi seulement » (connecté) ou « Toute personne avec le lien ». Un bot qui publie pour tout le monde doit d'abord avoir ton accord (carte d'approbation). Dans Réglages → Pages : repasser en privé, **Nouveau lien** (l'ancien ne marche plus aussitôt), **Arrêter le partage**.

Règles exactes du bac à sable (pour les curieux) : scripts et styles de la page elle-même, de ses fichiers, ou de `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com` ; polices aussi depuis Google Fonts ; images depuis n'importe quelle adresse https ; appels réseau seulement vers les fichiers de la page ; pas de formulaires envoyés, pas de fenêtres `alert`, pas de cadres d'autres sites. Une page privée qui a des fichiers s'ouvre, pour toi seul, à une adresse signée valable 12 heures (rouvre-la depuis Sklubot pour en avoir une nouvelle). Le détail est en tête de `server/src/pagefiles.ts`.

Pas encore fait (prochaine étape) : un petit stockage de données propre à chaque page (sondages, listes à cocher qui se souviennent), et une adresse séparée pour les pages (`PAGES_ORIGIN`). Aujourd'hui, une page ne garde rien entre deux visites.

## 4. Pour aller plus loin

- La compétence **Pages soignées** apprend aux bots tout ce qui précède (quand faire une page, la construire, la vérifier sur téléphone et ordinateur, la partager).
- La compétence **Méthode de travail** leur apprend à comprendre le but, vérifier avant de dire « c'est fait », demander ton accord avant l'irréversible, et te rendre compte simplement.
- Les avis de licence affichés sont une aide, pas un conseil juridique.
