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

Colle les deux jetons, puis envoie le code de liaison au bot en message privé. Le bot parle en messages privés ; si on le mentionne dans un salon, il répond « écris-moi en message privé ». Commandes : `!etat`, `!taches`, `!stop`, `!usage`, `!memoire`, `!aide`.

## Discord

Crée une application sur le portail des développeurs Discord, onglet **Bot** → **Reset Token**, colle le jeton. Ajoute le bot à un de tes serveurs avec le lien affiché (pour écrire à un bot en privé, il faut partager un serveur avec lui), puis envoie-lui le code en message privé. Le bot n'écoute que les messages privés.

## Une boîte mail existante (IMAP)

Serveur IMAP (port 993, connexion chiffrée), identifiant, mot de passe (un **mot de passe d'application** si ton fournisseur en propose). Le bot relève la boîte toutes les quelques minutes, **en lecture seule** : rien n'est marqué comme lu, déplacé ni supprimé. Il commence au dernier message : l'historique n'est jamais relu.

- Les e-mails des **expéditeurs autorisés** arrivent dans la discussion du bot (une carte), comme sur l'adresse du bot.
- Les autres sont **retenus** : « Accepter cet expéditeur » l'ajoute à la liste et relâche ses e-mails.
- Un e-mail est toujours un contenu extérieur : il ne donne jamais d'ordre au bot, même s'il prétend venir de toi.
- Répondre passe par l'adresse du bot et ton relais SMTP (Réglages → E-mail), et te demande toujours d'abord.

## Sécurité

Les jetons et le mot de passe sont gardés chiffrés (clé de données du serveur), jamais réaffichés, jamais écrits dans un journal. Seules les API officielles sont utilisées (docs.slack.dev, discord.com/developers, RFC 3501).
