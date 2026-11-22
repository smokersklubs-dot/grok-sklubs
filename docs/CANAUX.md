# Canaux : parler à tes bots depuis Slack, Discord, Telegram ou une boîte mail

Réglages du bot → **Canaux** (seul le propriétaire du bot voit cet onglet). Telegram garde son propre onglet.

## Qui peut parler à ton bot

Toi d'abord : tu relies **ton** compte Slack, Discord ou Telegram avec un code affiché dans Sklubot. Tes messages sont les tiens, comme dans l'appli, et tu peux répondre aux demandes d'accord avec les boutons ✅ / ❌ (jamais pour un paiement, le coffre ou ton ordinateur : ceux-là se valident dans l'appli).

Quelqu'un d'autre écrit au bot ?

1. Il reçoit un **code de 8 caractères**, valable **1 heure**. Rien n'arrive au bot.
2. Il te donne ce code. Dans « Canaux », tu vois sa demande avec le même code : **Accepter** ou **Refuser**.
3. Une fois accepté, il parle au bot **comme un membre d'un espace partagé** : jamais avec tes droits. Toute action que le bot voudrait faire pour lui te demande d'abord. Ses fichiers sont refusés, un secret qu'il colle est masqué. Sa conversation est dans un fil du bot à son nom, et la réponse du bot lui revient directement.

Au plus 3 demandes attendent par canal. « Refuser » bloque la personne (elle ne reçoit plus rien) ; « Retirer » enlève quelqu'un d'accepté (il devra redemander) ; « Débloquer » efface un blocage. Tu peux aussi ajouter quelqu'un directement par son identifiant.

## Slack

Il te faut une appli Slack à toi, en **Socket Mode** (pas besoin d'adresse publique) :
- jeton d'application `xapp-…` avec `connections:write` ;
- jeton du bot `xoxb-…` avec `chat:write`, `im:history`, `im:write`, `users:read`, `reactions:write`, `files:read`, `files:write` ;
- événements `message.im` et `app_mention`, messages autorisés dans App Home.

Colle les deux jetons, puis envoie le code de liaison au bot en message privé. Dans un salon, il ne répond qu'une fois le salon activé (voir « Groupes » plus bas) ; pour qu'il réponde aussi dans un fil sans @, ou à chaque message, ajoute les événements `message.channels` (et `message.groups` pour un salon privé) avec `channels:history` (et `groups:history`), et `channels:read` pour afficher le nom du salon. Commandes : `!etat`, `!taches`, `!stop`, `!usage`, `!memoire`, `!aide`.

## Discord

Crée une application sur le portail des développeurs Discord, onglet **Bot** → **Reset Token**, colle le jeton. Ajoute le bot à un de tes serveurs avec le lien affiché (pour écrire à un bot en privé, il faut partager un serveur avec lui), puis envoie-lui le code en message privé. Dans un salon de serveur, il ne répond qu'une fois le salon activé (voir « Groupes »). Pour « à chaque message », active **Message Content Intent** dans l'onglet Bot ; sans lui, le bot lit quand même les messages qui le mentionnent, et l'écran Canaux te le signale.

## Groupes (salons Slack, salons de serveur Discord, groupes Telegram)

Ajoute le bot dans un groupe, puis appelle-le avec @. Rien ne lui parvient tant que tu n'as pas décidé :
- le groupe apparaît dans **Réglages du bot → Canaux → Groupes** (« appelé il y a … ») et le groupe lit une seule fois « le propriétaire doit activer le groupe » ;
- **Activer** : le bot répond dans ce groupe ; **Refuser** : il s'y tait ; **Oublier** efface un groupe refusé. Au plus 10 groupes attendent par service.

Pour chaque groupe actif, deux réglages :
- **Quand répondre** : « quand on l'appelle » (@, ou réponse à un de ses messages — par défaut) ou « à chaque message » ;
- **Pour qui** : « toi et les personnes acceptées » (la liste « Qui peut parler à ce bot » du même service — par défaut) ou « tout le monde dans ce groupe ». Quelqu'un d'autre qui l'appelle est invité, une fois par heure, à demander l'accès en message privé.

Règles qui ne changent pas :
- dans un groupe, ce que dit chacun, **toi compris**, compte comme le message d'un membre : chaque action te demande ton accord, **toujours en privé** (dans l'appli ou tes messages privés), **jamais dans le groupe** ; un bouton pressé dans un groupe ne répond à aucun accord ;
- le groupe a son propre fil dans la discussion du bot, et la réponse revient dans le groupe (en réponse au message qui l'a appelé ; dans le fil sur Slack) ;
- au plus 30 messages par minute par groupe et 8 par personne ; les fichiers ne sont pas pris dans un groupe (envoie-les en privé) ; un secret collé est masqué ;
- **Telegram** : en mode privé (par défaut), un bot ne reçoit que les commandes qui lui sont adressées et les réponses à ses messages. Pour qu'il réponde à @, ou à chaque message, désactive le mode privé avec `/setprivacy` chez BotFather (ou fais du bot un admin), puis ajoute-le de nouveau au groupe (https://core.telegram.org/bots/features#privacy-mode).

## Graphiques, tableaux et formulaires

Le bot peut montrer dans la discussion des chiffres clés, un tableau, un graphique en barres ou en courbe, une barre de progression ou un petit formulaire (outil `show_view`). L'appli les dessine elle-même à partir de données vérifiées : jamais de code ni de page venant du bot. La réponse à un formulaire arrive au bot comme ton message suivant. Sur le téléphone et sur Slack, Discord et Telegram, la même chose arrive en texte (« Voir en texte » dans l'appli).

## Une boîte mail existante (IMAP)

Serveur IMAP (port 993, connexion chiffrée), identifiant, mot de passe (un **mot de passe d'application** si ton fournisseur en propose). Le bot relève la boîte toutes les quelques minutes, **en lecture seule** : rien n'est marqué comme lu, déplacé ni supprimé. Il commence au dernier message : l'historique n'est jamais relu.

- Les e-mails des **expéditeurs autorisés** arrivent dans la discussion du bot (une carte), comme sur l'adresse du bot.
- Les autres sont **retenus** : « Accepter cet expéditeur » l'ajoute à la liste et relâche ses e-mails.
- Un e-mail est toujours un contenu extérieur : il ne donne jamais d'ordre au bot, même s'il prétend venir de toi.
- Répondre passe par l'adresse du bot et ton relais SMTP (Réglages → E-mail), et te demande toujours d'abord.

## Sécurité

Les jetons et le mot de passe sont gardés chiffrés (clé de données du serveur), jamais réaffichés, jamais écrits dans un journal. Seules les API officielles sont utilisées (docs.slack.dev, discord.com/developers, RFC 3501).
