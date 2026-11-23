# Du code qui appelle les outils (`run_code`)

Pour un travail qui demande une boucle ou un tri sur plusieurs résultats (chercher, lire chaque résultat, garder le moins cher), ton bot peut écrire un petit script Python qui tourne **sur son propre ordinateur Linux** et qui appelle ses outils Sklubot.

## Comment ça marche

- Dans le script : `import sklubot`, puis `sklubot.call("nom_de_l_outil", argument=valeur)` rend le texte de l'outil ; `sklubot.tools()` donne la liste.
- Chaque appel passe par **exactement le même contrôle** qu'un appel normal du bot : tes règles, le relecteur, le plancher (argent, suppression, secret…), la carte d'accord si elle est nécessaire (le script attend ta réponse), le journal.
- Le script parle au point d'outils du bot sur le réseau interne, avec un jeton fait pour cette exécution seulement, effacé à la fin.

## Limites

- Python 3 avec sa bibliothèque standard, sur l'ordinateur du bot.
- 40 appels d'outils et 20 000 caractères de script au plus ; 290 secondes au plus (au-delà, le script continue en tâche de fond mais ses appels d'outils sont refusés).
- Jamais `run_code`, `run_steps`, `ask_user` (ni les autres outils qui attendent ta réponse) depuis un script.
- Pas proposé quand les bots n'ont pas d'ordinateur Linux ; refusé en offre gratuite hébergée quand le serveur ne donne aucun ordinateur.
- Le code lui-même tourne comme `shell_run` dans le bac à sable du bot : pas de carte pour le script, mais chaque outil Sklubot qu'il appelle est jugé à part.

Code : `server/src/agent/toolcode.ts` (idée venue du « code mode » de Claude Code ; code écrit pour Sklubot).
