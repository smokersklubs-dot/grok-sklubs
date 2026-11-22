# Recherche approfondie de Sklubot

Dans la discussion d’un bot, ouvre **+ → Recherche approfondie**. Donne un sujet et une à huit questions. Tu peux limiter le rapport aux adresses de ton choix, autoriser la découverte de pages sur le web, ou demander une synthèse au modèle de ce bot. Une demande de recherche approfondie adressée dans le chat peut aussi démarrer le rapport.

Le serveur enregistre chaque question traitée. Tu peux fermer l’application et rouvrir les rapports depuis le même bot. Le résultat complet revient dans la discussion d’origine. Une question sans extrait utilisable reste signalée. Lors d’une synthèse, chaque constat conservé renvoie à une adresse lue et à un court extrait retrouvé sur cette page. La vérification automatique porte sur la présence des mots cités. Leur interprétation reste à vérifier à la lecture.

Le panneau **Source X** accepte un jeton Bearer personnel de l’API X. Le serveur le chiffre et expose uniquement l’état de configuration. La case « Inclure X » active son utilisation pour le rapport. Les conditions de l’API X s’appliquent à cette source.

## Mesure du 19 novembre 2026

Depuis la racine du dépôt, exécuter `node --import tsx scripts/research-benchmark.mjs`. Ce scénario crée une base temporaire, utilise deux pages publiques et relance le processus Node après la première question. Il s’exécute sans modèle et sans compte X. [Transactions SQLite](https://www.sqlite.org/lang_transaction.html) · [Clés étrangères SQLite](https://www.sqlite.org/foreignkeys.html)

| Question | Résultat observé |
| --- | --- |
| SQLite permet-il plusieurs lectures et écritures simultanées ? | Le passage retenu précise que plusieurs lectures peuvent coexister avec une seule écriture simultanée. |
| Les clés étrangères sont-elles désactivées par défaut ? | Le rapport retrouve cette précision dans la documentation relative aux clés étrangères. |
| Quelle est la température de la surface lunaire ? | La question reste ouverte. |

Les deux extraits ont été retrouvés lors d’une seconde lecture indépendante des pages. Les trois questions ont été traitées, la première a été conservée à travers le redémarrage. Durée de cet essai local, démarrage des deux processus compris, 3,99 s. Ce chiffre dépend du réseau et de la machine. Cette mesure porte sur l’extraction et la reprise. La qualité rédactionnelle des modèles sous abonnement et la recherche X en conditions réelles restent à évaluer.

## Comparaison

ChatGPT documente la révision du plan, les sources web, fichiers et applications et la possibilité de réorienter une recherche en cours. Ce parcours Sklubot accepte un plan modifiable avant lancement, des liens web et, sur demande, X. Une importation de dossiers documentaires ou un changement de plan en cours de tâche demanderaient des essais et du développement supplémentaires. [Documentation OpenAI](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)

Manus décrit une recherche à grande échelle répartie entre plusieurs agents autonomes. Le scénario ci-dessus mesure un rapport de trois questions. Aucune exécution comparative sur compte Manus, ChatGPT, Claude ou Grok n’a été réalisée. [Présentation de Manus Wide Research](https://manus.im/features/wide-research)


## Recherche fiable : période, pertinence, état des sources (22 novembre 2026)

- **Période.** Choisis « 7 derniers jours », « 30 derniers jours », « 12 derniers mois » ou « Toutes dates ». Par défaut, Sklubot la lit dans ta demande : « ce mois-ci », « en ce moment » ou « récemment » donnent 30 jours, « cette semaine » 7 jours, « cette année » 12 mois. Chaque page donne sa date de publication quand elle l’indique (métadonnées de l’article). Une page publiée avant la période est écartée et comptée (« 1 source publiée avant la période écartée »). Une page sans date reste, marquée « date inconnue » : à vérifier.
- **Pertinence.** Une source lue mais hors sujet ne compte plus comme preuve : elle est écartée sous un seuil de pertinence et comptée.
- **Plus de sources.** La recherche web garde 8 résultats par question (au lieu de 4) et jusqu’à 6 constats. En plus, des sources gratuites : **Hacker News** (discussions tech, avec leurs points), **Polymarket** (paris en cours, présentés comme « ce que parient les gens », jamais comme un fait), **Reddit** et **YouTube** par l’ordinateur du bot (Agent Reach, lecture seule, sans lire tes cookies ni tes sessions).
- **Classement.** Les sources sont rangées par pertinence, fraîcheur et engagement réel (points, commentaires, vues, argent misé). Chaque constat affiche sa date et cet engagement.
- **État par source.** Chaque question liste ce que chaque source a fait : a répondu, rien trouvé, en panne, limite de débit, trop lente, connexion à faire, indisponible. Si une source a échoué et qu’il n’y a rien, le rapport dit « Pas de conclusion possible… Impossible de dire que personne n’en parle ». Si toutes ont répondu sans rien de récent : « Rien de solide sur la période ».

Le bot peut aussi le demander dans la discussion (`deep_research_start` accepte `window` et `sources`). Code : `server/src/researchsection.ts`, `researchsignals.ts`, `researchsources.ts` ; tests : `server/test/research-reliable.test.ts`. Le calcul de pertinence, la fenêtre de dates et les appels Hacker News et Polymarket sont adaptés de last30days (licence MIT, voir `THIRD_PARTY_NOTICES.md`).

Pas encore fait : veille « ce qui a changé depuis le dernier rapport », recherche dans les rapports passés, flux Atom. Non vérifié en conditions réelles : les champs exacts (votes, vues) renvoyés par Agent Reach pour Reddit et YouTube, et le taux de blocage de Reddit depuis un serveur.
