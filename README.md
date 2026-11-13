# Sklubot

Une équipe de bots IA auto-hébergée. Chaque bot a un nom, un rôle, sa mémoire, ses compétences, son
propre navigateur, ses fichiers, ses routines — et ils travaillent ensemble. Tout tourne sur ta machine,
avec tes clés ; les données restent dans un fichier SQLite local.

Sklubot a été reconstruit **en salle blanche** : voir [docs/CLEANROOM.md](docs/CLEANROOM.md).

## Ce que ça fait

| Domaine | Fonctions |
|---|---|
| **Bots** | Nom, rôle, description, consignes permanentes, avatar (12 formes × 11 couleurs), mode assistant personnel ou coéquipier, bot principal, niveau de réflexion, **modèle au choix par bot**, niveau d'autonomie |
| **Discussion** | Réponses en direct, étapes d'outils repliables, sources web, cartes d'approbation / de question / de connexion, envoi pendant que le bot travaille (le message rejoint le tour en cours), arrêt, nouvelle conversation |
| **Ordinateur** | Un vrai navigateur par bot (profil et connexions conservés), capture, clic, saisie, touches, défilement, glisser ; lecture de page ; ligne de commande dans un dossier privé ; bibliothèque de fichiers téléchargeables ; **vue en direct et prise de contrôle** depuis l'interface |
| **Applications** | Connecteurs = serveurs d'outils distants au standard ouvert MCP (URL + jeton). Lectures automatiques, écritures soumises à approbation, « toujours autoriser » mémorisé et révocable |
| **Mémoire** | Souvenirs enregistrés par le bot, **apprentissage automatique** après les conversations (avec dédoublonnage), sélection des souvenirs pertinents à chaque tour, **résumé automatique** des longues conversations |
| **Compétences** | Procédures rédigées par toi, injectées dans le bot |
| **Automatisation** | Routines créées en discutant : planifiées (cron + fuseau), ponctuelles, ou **déclenchées par webhook** ; points réguliers proactifs du bot principal |
| **Équipe** | Messages entre bots, assistants temporaires en parallèle (4 max, compte rendu automatique), discussions de groupe avec @mentions |
| **Tâches** | Suivi du travail en cours, en attente de toi, terminé |
| **Voix** | Appel vocal et dictée dans le navigateur (reconnaissance et synthèse vocales du navigateur), voix / vitesse / langue par bot |
| **Maîtrise** | Compteur de jetons et de coût par bot, **budget mensuel** qui met les bots en pause, garde-fou contre les boucles, limite d'étapes |

## Démarrage

Il te faut **Node.js 22.13 ou plus récent**.

```bash
npm install
cp .env.example .env        # puis remplis SESSION_SECRET et ANTHROPIC_API_KEY
npm run build
npm start                   # http://localhost:8787
```

Le premier compte créé est le tien ; les inscriptions se ferment ensuite (sauf `OPEN_SIGNUP=1`).

Pour que les bots aient un navigateur (facultatif mais recommandé) :

```bash
npm i playwright && npx playwright install chromium
```

Sans cela, ils gardent la lecture de pages web, la ligne de commande, les fichiers et les connecteurs.

### Développement

```bash
npm run dev -w server       # API sur le port 8787
npm run dev -w web          # interface sur http://localhost:5173
npm test                    # tests de bout en bout (modèle simulé, navigateur réel, connecteur réel)
npm run typecheck
```

## Sécurité — à lire

- **La ligne de commande des bots s'exécute sur la machine qui héberge Sklubot**, dans le dossier du bot,
  avec un environnement vidé (aucune clé du serveur n'y est visible). Par défaut un bot « prudent » demande
  ton accord avant chaque commande. Pour une vraie isolation, lance Sklubot dans un conteneur ou une machine
  dédiée, ou coupe l'outil avec `SHELL_ENABLED=0`.
- Trois niveaux d'autonomie par bot : **prudent** (demande avant les commandes et les écritures dans les
  applications), **équilibré** (demande seulement avant les écritures dans les applications), **confiance**
  (ne demande jamais).
- Les jetons des connecteurs sont chiffrés dans la base et ne sont jamais renvoyés au navigateur ni au modèle.
- Les mots de passe sont hachés (scrypt) ; seules les empreintes des sessions sont stockées.
- Mets `PUBLIC_URL` en `https://…` si tu exposes le serveur, et place-le derrière un proxy TLS.

## Organisation

```text
server/src/llm/        fournisseurs de modèles (Claude, compatible OpenAI/xAI)
server/src/agent/      boucle d'agent, outils, mémoire, équipe, prompt
server/src/            base, routes HTTP, ordinateur, connecteurs, planificateur, usage
server/test/           tests de bout en bout
web/src/               interface React
docs/API.md            référence de l'API
docs/cleanroom/        cahiers des charges fonctionnels issus de l'étude
```

## Limites connues

Voir la section « Écarts » de [docs/CLEANROOM.md](docs/CLEANROOM.md).

## Licence

MIT.
