# Installer Sklubot sur un VPS, depuis ton ordinateur

Tu n'as rien à installer sur ton ordinateur. Tout se passe sur le VPS ; ton ordinateur sert seulement à s'y connecter.

## Ce qu'il te faut

| | |
|---|---|
| **Un VPS** | Ubuntu 22.04 ou 24.04 (ou Debian 12). **4 Go de mémoire au minimum, 8 Go conseillés** : chaque ordinateur de bot éveillé en prend 2. 40 Go de disque. |
| **Ses accès** | L'adresse IP et le mot de passe administrateur (`root`), envoyés par l'hébergeur à la commande. |
| **Un nom de domaine** (conseillé) | Par exemple `bots.tonsite.fr`. Sans lui, pas de HTTPS : le micro, l'installation sur iPhone et la plupart des connexions OAuth aux applications (HubSpot, Notion…) ne marcheront pas. Si tu changes de domaine plus tard, mets à jour l'adresse publique dans `.env` : c'est elle qui sert d'adresse de retour après une connexion. |
| **Une clé Claude** (facultatif au début) | Sur console.anthropic.com. Sans clé, Sklubot démarre en mode démo, gratuit, pour tout visiter. |

## Étape 1 — Faire pointer le domaine vers le VPS

Chez le vendeur de ton nom de domaine, ajoute un enregistrement **A** : nom `bots` (ou ce que tu veux), valeur = l'adresse IP du VPS. Attends quelques minutes.

## Étape 2 — Lancer l'installation

**Le plus simple : le lanceur.** Télécharge le dossier `deploy` du dépôt, puis :

- **Windows** : double-clique sur **`Installer Sklubot sur mon VPS.cmd`**.
- **Mac** : ouvre le Terminal, tape `bash ` (avec un espace), glisse **`Installer Sklubot sur mon VPS.command`** dans la fenêtre, puis Entrée.

Il te demande l'adresse IP du VPS, puis le mot de passe (rien ne s'affiche pendant la frappe : c'est normal).

**À la main**, c'est la même chose en deux commandes. Ouvre un terminal (Windows : PowerShell) :

```bash
ssh root@ADRESSE_IP_DU_VPS
```

puis, une fois connecté au VPS :

```bash
curl -fsSL https://raw.githubusercontent.com/smokersklubs-dot/grok-sklubs/claude/trusting-knuth-awqogb/deploy/install.sh -o install.sh && SKLUBOT_BRANCH=claude/trusting-knuth-awqogb bash install.sh
```

## Étape 3 — Répondre aux deux questions

1. **Nom de domaine** : celui de l'étape 1 (laisse vide pour essayer sans domaine).
2. **Clé Claude** : colle-la (laisse vide pour le mode démo).

L'installation dure 5 à 10 minutes. À la fin, l'adresse de ton Sklubot s'affiche en vert.

## Étape 4 — Créer ton compte

Ouvre l'adresse dans ton navigateur et crée ton compte. **Le premier compte créé est le tien** ; les inscriptions se ferment ensuite.

Téléphone : voir [DEPLOIEMENT.md](DEPLOIEMENT.md) (iPhone : Safari → Partager → Sur l'écran d'accueil ; Android : `/download/sklubot.apk`).

## Ensuite

Sur le VPS, dans `/opt/sklubot` :

| Pour… | Commande |
|---|---|
| Ajouter ou changer la clé Claude, le domaine | `nano .env` puis `docker compose -f docker-compose.vps.yml up -d` |
| Mettre à jour Sklubot | `bash deploy/update.sh` |
| Sauvegarder les données | `bash deploy/backup.sh` |
| Voir ce qui se passe | `docker compose -f docker-compose.vps.yml logs -f sklubot` |
| Arrêter | `docker compose -f docker-compose.vps.yml down` |

## Si ça coince

| Symptôme | Que faire |
|---|---|
| « Connection refused » ou rien à la connexion | Vérifie l'adresse IP et que le VPS est démarré chez l'hébergeur. |
| « Permission denied » | Mauvais mot de passe ; certains hébergeurs imposent un autre utilisateur que `root` (`ubuntu`, `debian`). |
| La page ne s'ouvre pas en https | Le domaine ne pointe pas encore vers le VPS (étape 1), ou les ports 80 et 443 sont fermés dans le pare-feu de l'hébergeur. |
| « Sklubot ne répond pas » en fin d'installation | Le journal s'affiche juste au-dessus : la cause y est. Le plus souvent, pas assez de mémoire. |
| Les bots ne répondent pas | Pas de clé de modèle : ajoute `ANTHROPIC_API_KEY` dans `.env` et mets `SKLUBOT_DEMO_MODE=0`. |

## Sécurité

- Sklubot crée les ordinateurs des bots avec le Docker du VPS : **réserve ce VPS à Sklubot**.
- Après l'installation, pense à remplacer la connexion par mot de passe par une clé SSH (ton hébergeur a un guide).
- Le fichier `/opt/sklubot/.env` contient tes clés : il n'est lisible que par l'administrateur. Ne le partage pas.

## Utiliser tes abonnements Claude et ChatGPT (sans clé d'API)

1. Ouvre les réglages d'un bot → **Cerveau** → choisis « Claude — Sonnet (mon abonnement) » ou « ChatGPT (mon abonnement) ».
2. Clique **Se connecter sur l'ordinateur de …** : un terminal et la page de connexion s'ouvrent sur l'écran du bot, et la vue en direct s'ouvre en mode « prise de main ».
3. Connecte-toi avec ton compte Claude ou ChatGPT, puis **rends la main**. C'est fait : ce bot travaille désormais sur ton abonnement.

À savoir :
- La connexion est faite **par bot** (chaque bot a son propre ordinateur). Refais l'étape 2 pour chaque bot que tu veux brancher.
- Ce sont les outils officiels (Claude Code d'Anthropic, Codex d'OpenAI) avec ton compte : les limites de ton forfait s'appliquent, et c'est prévu pour **ton usage personnel** — ne fais pas travailler les bots de quelqu'un d'autre sur ton abonnement.
- Après une mise à jour, efface une fois l'ordinateur des bots existants (Réglages → Ordinateur → Effacer) pour qu'ils reçoivent la nouvelle image avec Claude Code et Codex.
