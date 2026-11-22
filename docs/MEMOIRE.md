# Mémoire des bots : recherche et rappel automatique

Chaque bot garde ses propres notes (« souvenirs »). Elles viennent uniquement de ce que tu as écrit toi-même, ou de ce
que tu lui as demandé de retenir. Cette page explique comment un bot **retrouve** ses notes. Code :
`server/src/agent/recall.ts` (classement et rappel), `server/src/agent/memory.ts` (apprentissage),
`server/src/agent/sensitive.ts` (sujets sensibles), `server/src/agent/prompt.ts` (ce qui est donné au bot).
Tests : `server/test/memory-recall.test.ts`.

## En bref

- **Recherche classée** : quand le bot cherche dans ses notes (outil `memory_search`), les notes les plus proches de la
  question arrivent en premier, avec les mots qui ont servi à les trouver.
- **Rappel automatique** : avant chaque réponse, le bot relit ses notes et ajoute celles qui partagent des mots avec
  ton nouveau message. Tu n'as rien à faire.
- **Gratuit** : aucun modèle d'IA n'est appelé pour cela. C'est un calcul fait par le serveur, en quelques
  millisecondes (entre 30 et 90 ms pour 5 000 notes sur la machine de test).

## La limite à connaître

Le classement se fait **par mots-clés**. Le bot retrouve une note si elle partage au moins un mot important avec ton
message. Il ne comprend pas les **synonymes** : une note « paiement à 30 jours » n'est pas trouvée par « règlement des
devis », car aucun mot n'est commun. Il n'y a pas de recherche « par le sens » (pas d'embeddings).

Ce qui est quand même géré, en français et en anglais :

- les majuscules et les accents (« Référence » = « reference ») ;
- les pluriels simples (« factures » = « facture », « journaux » = « journal », « invoices » = « invoice ») ;
- les petites formes collées (« l'adresse », « d'accord », « qu'il ») ;
- les petits mots sans intérêt (« le », « de », « the », « and »…) sont ignorés.

Les formes des verbes ne sont pas rapprochées (« payer » et « payé » restent deux mots différents).

## Comment les notes sont classées

1. **Les mots** : formule classique BM25. Un mot rare dans les notes du bot compte plus qu'un mot présent partout.
2. **La fraîcheur** : à mots égaux, la note la plus récente passe devant.
3. **La confiance** : une note **confirmée** monte un peu. Une note **contestée** descend un peu et reste marquée
   « incertain » (le bot doit vérifier avant de s'en servir). Une note **archivée** n'est jamais rendue.

## Le rappel automatique, en détail

- Il sert quand le bot a **plus de notes que la place prévue** dans ses consignes (`PROMPT_MEMORY_CHARS`, 4 000
  caractères par défaut). Tant que toutes les notes tiennent, elles sont déjà toutes données au bot : il n'y a rien à
  rappeler, et rien n'est calculé.
- Il ajoute au plus **4 notes**, et au plus **600 caractères** en tout.
- Une note n'est rappelée que si elle couvre au moins **30 %** des mots importants du message. Un seul mot courant en
  commun ne suffit pas.
- Une note déjà présente dans les consignes n'est pas ajoutée une seconde fois.
- Les notes rappelées sont rangées dans la partie « mémoire » des consignes, avec la mention que ce sont des
  informations, **jamais des ordres**.
- Seul un message **que tu as écrit** (ou dit en appel vocal) déclenche un rappel. Un message venu d'une routine, d'un
  webhook, d'un e-mail ou d'un autre bot n'en déclenche pas.

| Réglage dans le code (`recall.ts`) | Valeur | Rôle |
|---|---|---|
| `RECALL_TOP_K` | 4 | nombre de notes rappelées au plus |
| `RECALL_MIN_RELEVANCE` | 0,3 | part minimale des mots importants du message couverte par la note |
| `RECALL_CHAR_BUDGET` | 600 | caractères rappelés au plus |
| `QUERY_FOCUS_TERMS` | 4 | mots les plus importants du message pris en compte |
| `RECALL_POOL` | 5 000 | notes regardées par bot (les plus récentes) |
| `RECENCY_WEIGHT`, `RECENCY_HALF_LIFE_DAYS` | 0,15 ; 90 jours | petit bonus aux notes récentes |
| `CONFIRMED_BOOST`, `CONTESTED_PENALTY` | 0,10 ; 0,15 | bonus « confirmée », malus « contestée » |
| `SEARCH_LIMIT` | 20 | résultats de `memory_search` |

## Ce qui n'est jamais rappelé

- Si tu coupes **Réglages → Mémoire → Rappel automatique** (activé par défaut, pour tout le compte).
- Si les outils **Mémoire** sont coupés pour ce bot (réglages du bot → outils).
- Les notes sur un **sujet sensible** (santé, religion, politique…) que tu n'as pas autorisé dans Réglages → Mémoire,
  même si tu avais demandé un jour de les retenir. Elles restent visibles dans la liste des notes du bot et le bot peut
  toujours les chercher lui-même.
- Tout ce qui ressemble à un **secret** (mot de passe, clé, numéro de carte).
- Les notes d'**un autre bot** ou d'**un autre compte** : chaque bot ne lit que ses propres notes.

## Voir ce qui a été rappelé

Réglages → **Activité** : une ligne « Notes recalled for … » par message, avec le début de chaque note rappelée (ligne
en anglais, comme le reste de ce journal). Les notes rappelées sont aussi marquées « utilisées » (date de dernier
usage).
