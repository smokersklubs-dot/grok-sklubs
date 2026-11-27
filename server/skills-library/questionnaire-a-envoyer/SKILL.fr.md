---
name: Questionnaire à envoyer
description: Quand la personne ne peut pas décider seule parce que quelqu'un d'autre a la réponse (un comptable, un fournisseur, un associé, un client), lui demander seulement à qui ça va et ce qu'il lui faut en retour, puis écrire un questionnaire clair pour cette personne - contexte, comment répondre, questions par thème, la plus importante d'abord, une idée par question.
---

> Adaptée de mattpocock/skills « to-questionnaire » (© 2026 Matt Pocock, MIT). Modifiée pour Sklubot (22/11/2026) : écrit en fichier Sklubot que la personne peut envoyer ou imprimer, questions posées avec ask_user, traduite en français.

# Questionnaire à envoyer

Il manque à la personne un savoir que quelqu'un d'autre possède. Le questionnaire va le chercher chez cette personne, en une seule fois s'il le faut.

**Interroge sur l'envoi, pas sur le sujet.** Ne demande à la personne que ce à quoi elle peut toujours répondre : à qui c'est destiné, et ce qu'il lui faut en retour. Les questions du document visent ensuite l'écart entre ce que sait le destinataire et ce dont la personne a besoin.

## Étapes

1. **C'est pour qui ?** En un échange (ask_user) : le rôle du destinataire, ce qu'il sait, son lien avec la personne (client, fournisseur, conseiller, collègue). Cela fixe le ton et la quantité de contexte à donner.
2. **Il te faut quoi en retour ?** En un échange : les décisions ou les faits que la personne ne peut pas trancher seule. Arrête-toi quand tu as une liste concrète de ce qu'elle doit pouvoir décider ensuite.
3. **Écris le questionnaire** (file_save, par exemple questionnaires/<sujet>.md) selon le plan ci-dessous, et vérifie que chaque point de l'étape 2 a sa question. Montre-le (file_send). L'envoyer au destinataire est une étape à part, que la personne approuve.

## Le document

```
# <Titre>

Pourquoi ce questionnaire : <la décision qui en dépend>
De : <la personne> · À : <le destinataire> · À quoi serviront tes réponses : <où elles vont>
Merci de répondre avant le : <date> — environ <N> minutes.

## Contexte
<un paragraphe, assez pour bien répondre, pas une page>

## Comment répondre
Les réponses partielles et « je ne sais pas » aident : dis quand tu n'es pas sûr plutôt que de sauter la question.

## <Thème>
### <Une question claire ?>
_Pourquoi c'est important : <seulement si la question peut être mal comprise>_
>

## Autre chose ?
Y a-t-il quelque chose que nous n'avons pas demandé et que nous devrions savoir ?
```

Règles : les questions les plus importantes d'abord (il n'y aura peut-être qu'un passage) ; regroupe par thème au-delà de cinq questions ; une idée par question, jamais deux en une ; des mots simples et le vocabulaire du destinataire ; aucune question dont tu pourrais trouver la réponse toi-même.
