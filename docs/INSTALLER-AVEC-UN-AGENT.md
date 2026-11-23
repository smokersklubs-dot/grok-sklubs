# Installer Sklubot avec un agent de code

Un agent de code (Claude Code, Codex…) peut faire l'installation à ta place : il tape les commandes, lit les
messages d'erreur et corrige. Ce guide dit **quoi lui demander**, **ce qu'il peut faire seul** et **ce que toi seul
peux faire** (L153). La méthode de référence reste [INSTALLATION-VPS.md](INSTALLATION-VPS.md) : l'agent la suit.

## 1. Ce qu'il te faut avant de commencer

- Un VPS (Ubuntu 22.04 / 24.04 ou Debian 12, 4 Go de mémoire au moins) et son accès `root`.
- Un agent de code installé **sur ton ordinateur**, connecté à ton abonnement (par exemple : `claude` dans un terminal).
- Un nom de domaine qui pointe vers le VPS (conseillé, voir l'étape 1 d'INSTALLATION-VPS.md).

## 2. Le message à donner à l'agent

Ouvre un terminal dans un dossier vide, lance ton agent, puis colle ce message (remplace les deux valeurs) :

```text
Installe Sklubot sur mon VPS en suivant docs/INSTALLATION-VPS.md du dépôt smokersklubs-dot/grok-sklubs.
Adresse IP du VPS : 203.0.113.10 — domaine : bots.exemple.fr.
Règles :
- Connecte-toi en SSH ; quand un mot de passe est demandé, arrête-toi et laisse-moi le taper.
- Ne me demande jamais de coller une clé, un mot de passe ou un code dans la discussion.
- Ne modifie rien d'autre que /opt/sklubot sur le VPS.
- À la fin, donne-moi l'adresse du site, dis-moi où se trouve le code d'installation (sans l'afficher),
  et lance `docker compose -f docker-compose.vps.yml ps` pour montrer que tout tourne.
- Si une étape échoue deux fois, arrête-toi et explique-moi en mots simples ce qui coince.
```

## 3. Ce que l'agent peut faire seul

| Étape | Comment il le vérifie |
|---|---|
| Lancer le script d'installation et répondre « domaine » | Le script finit par l'adresse en vert. |
| Relire les journaux si quelque chose ne démarre pas | `docker compose -f docker-compose.vps.yml logs --tail 100 sklubot` |
| Vérifier HTTPS | `curl -I https://bots.exemple.fr` répond `200` ou `302`. |
| Mettre à jour plus tard | `bash deploy/update.sh` (fait une sauvegarde d'abord). |
| Contrôler l'installation | Réglages → Docteur (en lecture seule) ; l'agent peut aussi lancer le banc d'essai d'un ordinateur de bot : `docker compose -f docker-compose.vps.yml exec sklubot node server/dist/desk-cli.js`. |

## 4. Ce que toi seul peux faire

Ces gestes demandent ton identité, ton argent ou ton accord. **Aucun agent ne doit les faire à ta place**, et
Sklubot ne te les demandera jamais dans une discussion :

1. **Taper les mots de passe** (VPS, comptes) quand ils sont demandés. Rien ne s'affiche pendant la frappe : c'est normal.
2. **Créer ton compte Sklubot** avec le code d'installation (le premier compte créé devient le propriétaire).
3. **Coller tes clés** (Claude, OpenAI, OpenRouter…) dans Réglages → Modèles ou Clés et connexions, jamais dans un message.
4. **Te connecter à ton abonnement** Claude ou ChatGPT dans l'écran du bot (Réglages du bot → Cerveau).
5. **Autoriser les applis** (Google, HubSpot, Notion…) : la page de connexion de l'appli s'ouvre, c'est toi qui acceptes.
6. **Activer la double authentification** (Réglages → Compte) et noter les codes de secours sur papier.
7. **Payer** : hébergeur, nom de domaine, abonnements, comptes Apple ou Google Play.
8. **Approuver** ce qu'un bot demande avant une action qui engage (envoyer, payer, publier, supprimer).

## 5. Si ça coince

- « Permission denied » en SSH : vérifie l'adresse IP et le mot de passe envoyés par l'hébergeur.
- Le site ne s'ouvre pas en HTTPS : le domaine ne pointe pas encore vers le VPS ; attends quelques minutes et relance `docker compose -f docker-compose.vps.yml restart caddy`.
- Code d'installation perdu : il est dans `/opt/sklubot/.env`, ligne `SKLUBOT_SETUP_CODE` (l'agent peut te dire où, toi tu le lis).
- Pour un résumé à coller dans une demande d'aide (sans chemin ni secret) : Réglages → Docteur → **Copier le résumé**.
