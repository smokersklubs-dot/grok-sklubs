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

