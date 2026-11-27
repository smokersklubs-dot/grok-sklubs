# Langues de Sklubot

Sklubot parle **français** et **anglais** (complets), et **espagnol** (complet le 25/11/2026). Le **portugais** (du Brésil) et le **chinois simplifié** sont complets depuis le 25/11/2026 (web, mobile, serveur, e-mails du compte). L'**allemand** (*du*) et l'**italien** (*tu*) sont complets depuis le 25/11/2026 (web, mobile, serveur, e-mails du compte ; plancher 95 %). Sur l'accueil à 390 px, la fin colorée du titre allemand peut passer à la ligne (`:lang(de) .lp-h1 em` dans `web/src/styles/landing.css`).

Règle d'or : **un texte qui manque dans une langue s'affiche en anglais**, jamais une clé brute, jamais un plantage. Une langue peut donc arriver petit à petit.

## Où vivent les textes

| Surface | Référence (clés) | Une langue | Chargement |
|---|---|---|---|
| Liste des langues (une seule source) | `server/src/clientshared/locales.ts` | — | partagé par le serveur, le web et le mobile |
| Appli web | `web/src/i18n/en.ts` (clés), `fr.ts` | `web/src/i18n/<code>.ts`, export `<code>` | à la demande (`import()`), un fichier par langue, hors du paquet principal |
| Tables propres à certains écrans web (connexion, Google, offre, crédits, comptes d'IA, anti-robot, voix) | `web/src/i18n/sides.ts` liste les tables `{ fr, en }` | même fichier, export `side` | avec le dictionnaire de la langue |
| Appli mobile | `mobile/src/i18n/en.ts`, `fr.ts` | `mobile/src/i18n/<code>.ts`, exports `<code>` et `server<Code>` (erreurs de compte renvoyées par le serveur) | dans l'appli (petit) |
| Serveur (avis dans le chat, erreurs, cartes, e-mails) | les textes anglais eux-mêmes ; le français est dans les tables `FR` / `…_FR` à côté du code | `server/src/lang/<code>.ts`, export `<code>`, **clé = texte anglais** | au démarrage |
| E-mails du compte (lien de connexion, mot de passe, adresse, test, confirmation) | `server/src/accountmail.ts` (`MAILS`), `server/src/publicsignup.ts` (`MAIL`) | une entrée `<code>: (…) => ({ subject, text })` par e-mail | — |

La langue du compte (`users.locale`) accepte toutes les langues de la liste. Avant connexion, le web suit la langue du navigateur (`es-MX` → `es`, `pt-BR` → `pt`, `zh-Hans` → `zh`), le serveur l'en-tête `Accept-Language` parmi les 7 langues (y compris les e-mails envoyés avant connexion : lien de connexion, mot de passe oublié, Google), le mobile la langue du téléphone.

Les bots répondent dans la langue de la conversation ; quand elle n'est pas encore connue, dans la langue du compte (`languageName()` de `locales.ts` donne « Spanish », « Simplified Chinese »… aux consignes des modèles).

## Ajouter une langue (exemple : l'allemand `de`)

La langue est déjà déclarée dans `server/src/clientshared/locales.ts` (`LOCALES`, nom affiché, nom anglais, format de date). Pour une langue nouvelle, l'ajouter d'abord là, aux quatre listes.

1. **Créer les fichiers vides** (copier ceux de l'espagnol en vidant les textes) :
   - `web/src/i18n/de.ts` : `export const de: PartialDict = {};` et `export const side: SideTexts = {};`
   - `mobile/src/i18n/de.ts` : `export const de: Partial<Record<Key, string>> = {};` et `export const serverDe: Record<string, string> = {};`
   - `server/src/lang/de.ts` : `export const de: Record<string, string> = {};`
2. **Les déclarer** (une ligne chacun) :
   - web : `LOADERS` dans `web/src/i18n/index.ts` → `de: () => import("./de").then((m) => ({ dict: m.de, side: m.side })),`
   - mobile : `DICTS` et `SERVER_TEXT` dans `mobile/src/i18n/index.ts` (import de `de` et `serverDe`)
   - serveur : `DICTS` dans `server/src/lang/index.ts` (import de `de`)

   La langue apparaît alors toute seule dans les sélecteurs (web : Réglages → Général, connexion, accueil ; mobile : bienvenue, Réglages).
3. **Traduire par morceaux**, jamais à la main dans un fichier de 6 000 lignes :
   ```sh
   node scripts/i18n/chunks.mjs export de web    /tmp/de --chars 16000
   node scripts/i18n/chunks.mjs export de mobile /tmp/de
   node scripts/i18n/chunks.mjs export de server /tmp/de
   ```
   Chaque `web-001.src.tsv` contient une ligne par texte : `numéro<TAB>clé (contexte)<TAB>anglais`. Écrire à côté `web-001.de.tsv` avec une ligne `numéro=traduction` par texte (un retour à la ligne s'écrit `\n`). Puis :
   ```sh
   node scripts/i18n/chunks.mjs merge de web /tmp/de     # idem mobile, server
   ```
   Le merge réécrit les fichiers de la langue dans l'ordre des clés, garde ce qui était déjà traduit et dit combien il reste. Les textes identiques ne sont exportés qu'une fois. Ne pas ré-exporter dans le même dossier en cours de route (les numéros changeraient si d'autres textes sont arrivés) : un nouvel export va dans un nouveau dossier.
4. **Ton et règles de traduction** : tutoiement (comme le français : *du*, *tu*, *tú*, *você* informel ; en chinois un ton simple et chaleureux) ; mots simples ; garder tels quels les noms de produits (Sklubot, Relais, Sentinelle, Claude, ChatGPT, OpenRouter…), les `{variables}`, le Markdown (`**`, `` ` ``, liens), les adresses, les commandes (`npm run …`, `/stop`) et les mots-clés techniques (`true`, `cron`, `SKLUBOT_SETUP_CODE`). Les mots de commande français que les gens tapent (« reprends @Nom ») restent en français.
5. **Vérifier** :
   ```sh
   npm run i18n:report          # couverture % par langue et par surface, problèmes
   node scripts/i18n/check-languages.mjs de   # détail : clés manquantes, textes restés en anglais
   npm run check:i18n           # le test (fait partie de npm test)
   ```
   Le test échoue sur : une clé inconnue de la référence, un texte vide, une `{variable}` ajoutée ou perdue, un domaine de lien changé, un nombre de `` ` `` différent, une paire `_one` / `_other` cassée. Un texte manquant **n'échoue pas** (repli anglais), sauf sous le plancher de la langue : relever `COVERAGE_FLOOR` dans `scripts/i18n/check-languages.mjs` quand la langue est traduite (l'espagnol est à 95 % : les nouveautés peuvent arriver d'abord en anglais).
6. **E-mails** : ajouter l'entrée `de` à chaque e-mail de `MAILS` (`server/src/accountmail.ts`) et de `MAIL` (`server/src/publicsignup.ts`), et les petites tables `{ en, fr, es }` lues par `byLocale()` (`grep -rn "byLocale(" server/src` : annonces, OpenRouter). Les étapes OAuth des applis intégrées (`server/src/native/vendors.ts`), le catalogue (`catalog.ts`) et la Sentinelle (`sentinel/texts.ts`) passent par les fichiers de langue (clé = texte anglais) ; les titres et résumés de la bibliothèque de compétences se traduisent dans `server/skills-library/catalog.json` (une entrée par langue).
7. **Regarder** : `UI=de node web/scripts/shots-langues.mjs` (connexion, chat, Aujourd'hui, accueil, création de bot à 390 et 1440 px dans `docs/screenshots/langues/` ; la galerie accepte `?ui=de`). Les sélecteurs de langue (connexion, accueil) passent à la ligne au-delà de 3 langues : vérifier l'en-tête de l'accueil à 390 px. Puis `npm run build -w web`, `npm run check:bundle -w web` (vérifie que le dictionnaire est bien dans son propre fichier), captures à 390 et 1440 px dans la langue (les mots allemands sont longs : boutons, onglets, menus).

## Taille des fichiers (`npm run check:size`)

Le cliquet de taille (`scripts/file-size-ratchet.test.mjs`) ne compte pas les dictionnaires : une ligne par texte, ils grandissent avec chaque fonction. La règle est écrite dans le script (`EXEMPT` pour `fr.ts`, `en.ts`, `server/src/i18n.ts` ; `EXEMPT_RE` pour **tout** fichier de langue nommé par son code à deux lettres : `web/src/i18n/<code>.ts` et `server/src/lang/<code>.ts`). Un nouveau dictionnaire n'a donc rien à déclarer et ne monte aucune limite. Tout le reste (code de chargement, composants, scripts) reste soumis au cliquet : ne pas mettre de code dans un fichier de langue. Les dictionnaires mobiles (`mobile/src/i18n/`) ne sont pas mesurés.

## Portugais et chinois : choix faits

- **Portugais = portugais du Brésil** (`pt`, `Intl` : `pt-BR`) : le public le plus large. *Você* informel, vocabulaire brésilien (*celular*, *tela*, *arquivo*, *Configurações*, *senha*). Un navigateur `pt-PT` reçoit aussi ce portugais.
- **Chinois simplifié** (`zh`, `Intl` : `zh-CN`) : ton simple et chaleureux avec 你 ; ponctuation pleine chasse (，。：？）) ; pas de pluriel (seules les clés `_other`). « bot » se dit 机器人.
- Mots gardés en français dans les deux langues parce que l'utilisateur les tape ou les voit tels quels : « reprends @Nom », `/taches`, `/etat`, `/memoire`, les boutons « Vérifier » / « Créer » des cartes serveur, les titres de sections des guides (« Sortir par la maison »).
- **Polices** : uniquement celles du système (la CSP n'en autorise aucune venue d'ailleurs). Pour `<html lang="zh">`, `web/src/styles/tokens.css` met les polices CJK du système en tête de `--font` (PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC…), sinon Windows choisit une police au hasard ; le grand titre de l'accueil coupe seulement après la ponctuation (`word-break: keep-all`, `web/src/styles/landing.css`). Le mobile utilise la police du téléphone (PingFang sur iOS, Noto Sans CJK sur Android), qui couvre le chinois sans rien à faire.
- Piège vu en traduisant : le `merge` retire les espaces en fin de texte. Un texte anglais qui finit par une espace (`lp.h1b`, `dl.h1a`) doit la garder, sinon le titre de l'accueil déborde à 390 px (corrigé à la main dans `pt.ts`).
- Un même texte anglais court (« New », « Watch », « Done ») est exporté une seule fois : relire sa traduction dans chaque contexte (corrigé pour `ann.kind.new`, `relay.watch`, `frame.watch`, `today.stat.done`…).

## Pluriels

Les textes à compter ont deux clés `xxx_one` / `xxx_other`. Le web choisit avec `Intl.PluralRules`, le mobile avec `pluralForm()` de `locales.ts`. Le français et le portugais comptent 0 et 1 au singulier. **Le chinois n'a pas de pluriel** : `zh` n'a besoin que des clés `_other` (le contrôle ne demande pas les `_one`, et `NO_PLURAL` dans `locales.ts` le dit).

## Ce qui reste en anglais pour une langue autre que français et anglais

Le 25/11/2026, les phrases écrites dans le code sous la forme `locale === "fr" ? "…" : "…"` ont été déplacées dans les dictionnaires et traduites dans les 7 langues (≈ 175 serveur dans `server/src/inlinei18n.ts`, ≈ 330 web, plus les étapes OAuth, le catalogue d'applis, la Sentinelle, les rôles et personnalités, les exemples de démarrage et les titres de la bibliothèque de compétences). Restent volontairement en français ou en anglais (liste exacte et raison de chacun : `scripts/i18n/inline-allowlist.json`) :

- les pages légales publiques (tarifs, CGU, mentions légales, confidentialité) : une adresse française et une anglaise, texte juridique non traduit automatiquement ;
- les noms d'offres saisis par l'exploitant (`nameFr` / `nameEn`), l'invite d'export Grok (au choix), les noms de dossiers de l'export des notes (`notes/active`…), les titres de section des fichiers d'équipe (relus à l'import) ;
- le texte complet des modèles d'équipe (`server/templates/*.md`) et des compétences de la bibliothèque (`SKILL.md` / `SKILL.fr.md`) : leur titre et leur résumé sont traduits (`server/skills-library/catalog.json`), pas leur corps ;
- la voix : le oui/non dicté au téléphone n'est reconnu qu'en français et en anglais, les voix locales Piper n'existent qu'en français et en anglais ;
- les réponses du modèle de démonstration (`server/src/llm/demo.ts`) et le bot de réunion en cours d'écriture (`server/src/meetingbot/`).

**Garde-fou** : `npm run check:i18n` échoue si un fichier gagne une branche `=== "fr" ?` / `fr ? … : …` de plus que sa liste, ou si un nouveau fichier en a une (`inlineBranches()` de `scripts/i18n/check-languages.mjs`, rapport dans `npm run i18n:report`). Un nouveau texte s'écrit en anglais avec `tr()` côté serveur (le français dans la table `…_FR` de la zone, ou `INLINE_FR`) et avec une clé de `en.ts` / `fr.ts` côté web. Quand on retire une branche autorisée, baisser son compte dans la liste.

Outils pour ne pas en réécrire : `intlOf(locale)` et `colon(locale)` (`server/src/lang/index.ts`), `intlTag()`, `intlLocale()`, `colon()` et `euros()` (`web/src/i18n/index.ts`) pour les dates, nombres, montants et la ponctuation « libellé : valeur » ; `text(key, english)` de `web/src/i18n/lookup.ts` pour un module que les tests node chargent sans l'appli (`lib/blockfold.ts`).

## Fichiers

- `server/src/clientshared/locales.ts` — la liste, les noms, le repli, les pluriels sans `Intl`.
- `server/src/lang/index.ts` — `localize()`, `localizeVars()`, `pickLocale()`, `byLocale()` ; `server/src/i18n.ts` (`tr()`) s'appuie dessus.
- `web/src/i18n/index.ts` — `LOADERS`, `t()`, `tn()`, `useT()`, `sideText()`, `localeReady` (attendu par `main.tsx` avant le premier affichage).
- `mobile/src/i18n/index.ts`, `mobile/src/components/LanguageChoice.tsx`.
- `scripts/i18n/dicts.mjs` (lecture des dictionnaires sans exécuter de code), `check-languages.mjs` (+ test), `chunks.mjs` (export / merge).
- Tests : `scripts/i18n/check-languages.test.mjs`, `server/test/languages.test.ts`.
