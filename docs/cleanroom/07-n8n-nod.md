# 07 — « nod » (n8n) : cahier des charges fonctionnel issu de l'étude

## Source étudiée

| Élément | Valeur |
|---|---|
| Dépôt | dépôt public GitHub de n8n nommé « nod » |
| Commit étudié | `49ac8277593d9a5b7d966c6142f07696b1e99251` |
| Date du commit | 14/11/2026, 13:01 (UTC+1) |
| Licence | **Apache License 2.0** (licence open source reconnue par l'OSI). Un fichier de mentions signale en plus un composant vocal local sous **GPL-3.0-or-later** (phonétiseur), et des polices / logos sous leurs propres conditions. |
| Statut annoncé | « aperçu de recherche » : fonctions et formats encore instables |

**Ce que la licence implique pour nous.** Contrairement à la plupart des projets n8n (licence « Sustainable Use », non OSI), celui‑ci est sous Apache 2.0 : la réutilisation du code serait juridiquement possible avec attribution. **Nous ne le faisons pas quand même** : selon notre méthode de salle blanche, nous ne reprenons que des idées et des comportements, jamais le code, les textes d'interface, les invites (prompts), les noms internes, les images ni la structure des fichiers. La partie GPL ne doit en aucun cas entrer dans Sklubot (licence MIT).

Méthode : lecture seule de la documentation publique livrée avec le dépôt et d'un survol de l'arborescence ; rien n'a été installé ni exécuté. Tout ce qui suit est décrit avec nos propres mots.

## Ce qu'est nod, en bref

nod est un **assistant personnel unique** (une seule personne, une seule conversation) qui a **son propre ordinateur Linux** (un conteneur « espace de travail » pour les commandes et les fichiers, plus un conteneur navigateur séparé) et qui travaille sur de vrais sites et dans les applis de l'utilisateur (Gmail, Agenda, Slack, Notion, Linear, serveurs MCP…). Il tourne sur l'ordinateur de l'utilisateur (application de bureau Mac/Windows/Linux) ou sur un serveur auto‑hébergé (Docker Compose, PostgreSQL), avec le modèle choisi par l'utilisateur (20+ fournisseurs, serveur local compatible OpenAI, ou connexion avec un abonnement ChatGPT). On lui parle dans l'appli, le navigateur, Telegram ou WhatsApp : c'est toujours la même conversation.

Son cœur différenciant est la **sécurité côté serveur** : un vérificateur décide, pour chaque action qui modifie quelque chose (appli, clic de navigateur, fichier local, réglage de l'assistant), si **les propres mots de l'utilisateur** l'autorisent, et sinon pose une question. S'y ajoutent un coffre qui saisit mots de passe, codes et cartes sans que le modèle les voie, un principe « une seule exécution, un seul résultat », une mémoire très encadrée, des tâches de fond suivies, des routines, et une « préparation discrète » qui lit les sources de l'utilisateur et ne le dérange que quand ça en vaut la peine.

Comparé à Sklubot : Sklubot a déjà l'essentiel du socle (un ordinateur Linux par bot, coffre, approbations, prudence face au contenu extérieur, routines, déclencheurs natifs, mémoire, compétences, Telegram, budget, prise de main, Relais). nod va **plus loin sur la finesse des autorisations, la fiabilité des actions et la proactivité** ; Sklubot va plus loin sur l'équipe de bots, les salons, l'écran en direct et le Relais.

---

## A) Fonctions à intégrer

Chaque fiche décrit le comportement attendu, pas une implémentation.

### A1. Autorisation fondée sur les mots de l'utilisateur (« parce que tu l'as dit ») — importance : **haute**

- **Ce que l'utilisateur obtient.** Le bot fait tout le chemin vers le résultat demandé sans demander à chaque étape, mais rien au‑delà. « Réserve une table pour deux ce soir à 20 h chez X » couvre le choix de l'heure, la saisie du nom et la confirmation ; pas un acompte par carte, ni un autre restaurant. Chaque action exécutée affiche dans le journal la citation exacte de la phrase de l'utilisateur qui l'a permise.
- **Entrées.** L'action exacte et ses arguments (destinataire, montant, date, texte…) ; les derniers messages de l'utilisateur (quelques messages récents, sur une fenêtre limitée dans le temps) ; le message du bot auquel l'utilisateur répondait ; ses règles (A2) ; pour une routine, son instruction et l'heure prévue ; pour du travail de fond, la consigne permanente (A2).
- **Sorties.** « exécuter » avec une citation (ou la mention « simple lecture / brouillon »), ou « demander ». Le serveur vérifie que la citation figure **mot pour mot** dans ce qui a été montré au vérificateur ; une citation absente ou inventée → on demande (ou, sans personne pour répondre, on n'exécute pas).
- **Règles.**
  - Le vérificateur ne voit **jamais** les pages, e‑mails, fichiers ou résultats d'outils : seules les paroles de l'utilisateur font autorité.
  - Lectures, recherches, filtres, navigation et brouillons passent par défaut ; tout ce qui envoie, publie, supprime, paie, réserve ou change un réglage doit être couvert.
  - Hors du périmètre : un autre site ou destinataire, un abonnement, un nouveau compte, une publication, une suppression non nommée, un changement de compte, l'envoi de données personnelles inutiles.
  - Les termes explicites (montants, devises, dates, heures, conditions, corrections ultérieures) sont comparés à l'action, y compris à travers les langues ; un écart → question.
  - Après vérification, si l'instruction ou les arguments ont changé, l'ancienne proposition est rejetée (pas de question sur une version périmée).
  - Les messages d'un tour arrêté ou échoué chez le fournisseur ne comptent jamais comme autorisation.
  - Si le vérificateur ne sait pas répondre : on demande en conversation, on n'exécute pas en arrière‑plan.
- **Cas limites.** Après l'échec net d'une appli, le bot peut passer par le site web du même service pour le même résultat, même compte, mêmes termes, sans redemander. Une demande d'aide (« occupe‑t’en ») n'autorise pas un engagement non choisi (réclamation, envoi) : le bot prépare puis demande. Mentionner un domaine n'est pas un consentement.
- **Intégration Sklubot.** Remplace ou complète les trois niveaux d'autonomie par un quatrième mode « selon mes mots » (c'est le « mode Auto avec relecteur » prévu en vague 5). Le relecteur peut utiliser un petit modèle ou le modèle du bot au plus bas niveau de réflexion ; il se combine avec la règle actuelle « après contenu extérieur, redemander ». Le journal d'activité affiche la citation à côté de chaque action.

### A2. Règles en langage naturel et consignes permanentes — importance : **haute**

- **Ce que l'utilisateur obtient.** Il dit une fois « demande‑moi toujours avant d'écrire hors de mon entreprise » ou « tu peux répondre à mon propriétaire au sujet des réparations sans me demander », et c'est appliqué partout : discussion, tâches, routines, travail de fond. Et une **consigne permanente** pour le travail déclenché par un événement : « chaque fois qu'Ana envoie une facture, transfère‑la à la compta ».
- **Entrées / sorties.** Texte libre de l'utilisateur → liste de règles consultable, modifiable, effaçable en discutant (« montre mes règles », « retire ma règle sur le loyer »).
- **Règles.**
  - Une règle « demander d'abord » l'emporte sur tout, y compris sur une demande explicite et sur les lectures.
  - Une règle « vas‑y » ne couvre que l'action et la cible qu'elle nomme, et jamais les réglages du bot lui‑même (routines, limites, mémoire, règles).
  - Des « oui » répétés ne créent pas une règle ; le bot **propose une fois** d'arrêter de demander pour un cas qui reviendra.
  - Toute modification des règles par le bot passe par le vérificateur, qui voit l'ancienne version : il redemande si le bot ajoute quelque chose de non demandé.
  - La consigne permanente ne voit jamais l'e‑mail déclencheur ; une variante (autre adresse) → question. Conseil affiché : nommer précisément l'action et la cible (un faux e‑mail « d'Ana » ne pourra alors aller qu'à la compta).
- **Intégration Sklubot.** Par bot (et option « pour toute l'équipe »), à côté des consignes permanentes existantes. Les déclencheurs natifs (e‑mail entrant, message Slack) s'en servent comme seule autorité.

### A3. Approbation liée à l'action exacte, exécution unique, résultat « incertain » — importance : **haute**

- **Ce que l'utilisateur obtient.** Une carte qui montre exactement ce qui partira (compte, destinataires, objet, texte tel qu'il sera envoyé, montant), un « oui » qui exécute **cette** action **une** fois, et jamais de double envoi, même avec deux onglets ou une coupure.
- **Règles.**
  - L'action et ses arguments sont enregistrés avec la question ; le libellé du bouton ne peut pas les modifier. Si le texte de la question ne peut pas être vérifié, on ne demande pas plutôt que d'afficher des données brutes.
  - Avant chaque exécution privée (saisie de mot de passe, code, carte) ou action approuvée, le serveur enregistre une « réservation » unique. États : en cours → envoyé, ou en cours → **incertain**. Après un redémarrage, tout ce qui était en cours devient incertain ; rien n'est rejoué. « Envoyé » ne veut pas dire « réussi » : le bot relit la page ou l'appli.
  - Une seule question en attente par tâche (sous‑assistants compris) ; les actions lancées entre‑temps ne partent pas.
  - La réponse est interprétée seule (sans voir la question) : oui / non / autre, dans n'importe quelle langue ; un 👍/👎 sur la carte vaut oui/non. Un « oui, mais… », une question ou une pièce jointe ferme la carte **sans** exécuter.
  - Une réponse vaut pour la question la plus récente que l'utilisateur avait vue, pas une arrivée après.
  - La carte reste dans la discussion, grisée, avec l'issue : en cours, fait, annulé, expiré, « a peut‑être été exécuté », non confirmé par l'appli.
  - Arrêter après le début → « a peut‑être été exécuté » ; un résultat tardif met la carte à jour.
  - Pour une suppression définitive, la carte montre la cible vérifiée (expéditeur, objet) ; si la cible ne peut pas être identifiée, on ne propose pas la suppression.
- **Intégration Sklubot.** Renforce les cartes d'approbation existantes et la reprise après redémarrage : ajouter l'état « incertain » et l'interdiction de rejouer.

### A4. Tâches de fond suivies depuis la discussion — importance : **haute**

- **Ce que l'utilisateur obtient.** La discussion principale reste libre pendant que le bot mène plusieurs travaux. Une question simple reçoit une réponse directe ; un travail substantiel (recherche multi‑sources, comparaison, rapport) ou une attente extérieure (une réponse, une personne) devient automatiquement une **tâche** avec sa carte.
- **Carte de tâche.** Titre court (renommable sans changer l'objectif), état, ligne « maintenant » (étape en cours, site ou appli), « attend qui et comment », « prochaine vérification », « terminé quand… », plan en liste à cocher, activité (étapes et outils, jamais le raisonnement privé), commandes exécutées.
- **États.** En file, en cours, besoin de toi, en attente de quelqu'un, revérification planifiée, terminé, arrêté, échoué.
- **Règles.**
  - Répondre à un message d'une tâche la corrige ou la complète ; un message sans cible va à la discussion principale ; si la cible est ambiguë, le bot demande.
  - Une correction est reçue au prochain point d'arrêt sûr (affiché comme « mise à jour en attente ») ; une action extérieure déjà partie peut finir.
  - Arrêt d'une seule tâche (et de ses aides) ou de tout ; reprise d'une tâche finie en répondant à l'un de ses messages.
  - Une tâche échouée le dit en nommant la tâche et la cause ; une tâche sans plan ni résultat passe en « besoin de toi ».
  - Une tâche terminée propose « en faire une routine ».
  - Le résultat va où l'utilisateur l'attend : dans l'appli concernée (feuille, document, brouillons) si c'est là qu'il vit, sinon un document Markdown + un court message avec la conclusion principale.
  - Toutes les tâches partagent l'ordinateur et la mémoire, chacune a son dossier de travail et son propre historique.
- **Intégration Sklubot.** Étend le suivi « en cours / en attente / terminé » existant et les assistants temporaires : vraies tâches persistantes par bot, routage des réponses par fil (la vague 1 prévoit les fils de réponse), pastille dans la zone de saisie.

### A5. Point d'étape de dépense par tâche — importance : **moyenne**

- **Comportement.** Quand une tâche (aides comprises, sur plusieurs jours) a dépensé plus qu'un seuil (5 $ par défaut, réglable en discutant) depuis le dernier message de l'utilisateur à cette tâche, elle s'arrête avant l'étape suivante, donne le coût et ce que continuer ferait, et demande. Oui → elle repart jusqu'au prochain seuil ; non → arrêt.
- **Règles.** Les vérifications d'autorisation comptent dans la dépense. Avec un abonnement (sans coût réel), le seuil compte au prix public estimé et la carte le précise. Une action déjà commencée se termine avant le point d'étape.
- **Intégration Sklubot.** S'ajoute au budget mensuel et au garde‑fou anti‑boucle ; s'applique aussi aux routines et aux bots en travail de fond.

### A6. Préparation discrète et « coups de coude » (proactivité) — importance : **haute**

- **Ce que l'utilisateur obtient.** Le bot lit de lui‑même les sources connectées, prépare **en privé** un travail complet (brouillon de réponse, comparaison, aide à la décision, avec références, montants, dates et ce qu'il n'a pas pu confirmer) et n'envoie un message court que si ça vaut une interruption : ce qui a changé, ce qui est prêt, et au plus une question (« je l'envoie ? »). Un lien ouvre le travail préparé.
- **Entrées.** Nouveaux e‑mails (vérifiés toutes les 15 min), changements d'agenda (toutes les 30 min, sans appel au modèle), événements des autres applis ; ce que l'utilisateur a dit valoir une interruption (« préviens‑moi quand un client écrit »).
- **Règles.**
  - Démarrage seulement sur un besoin concret (demande sans réponse, engagement, problème, risque financier, crédit récupérable, sujet à surveiller). Une idée ou une mise à jour de routine ne déclenche rien.
  - Le préparateur ne peut que lire, consulter la mémoire et enregistrer en privé : ni envoyer, ni réserver, ni acheter, ni supprimer, ni créer de brouillon dans les applis. Envoyer un brouillon démarre une nouvelle demande soumise à A1.
  - Une affaire = un enregistrement unique (clé stable + élément source) ; un seul message par affaire, un nouveau seulement si les éléments changent vraiment (échéance avancée, nouvelle option).
  - Réponses en langage libre : montre‑moi, envoie, rappelle‑moi ce soir (report), c'est réglé (clôture), pas intéressé (rejet, ne revient que sur vrai changement), pas utile (retour noté). Seuls les messages de l'utilisateur agissent ; le silence ne compte pas et le bot ne relance pas.
  - Heures calmes (22 h–8 h par défaut) : tout attend, sauf affaire à fort impact, bien étayée, dont l'échéance tombe avant la fin des heures calmes ; les changements sont regroupés ensuite.
  - « Moins de ça », « mets la préparation en pause / reprends‑la ».
  - Les faits cités sont relus par le serveur (ou doivent avoir été lus très récemment) avant envoi.
  - Le premier message d'un type précise une fois qu'il continuera ainsi et comment l'arrêter.
  - Budget mensuel séparé (5 $ par défaut), avec **réservation du coût maximal estimé avant chaque requête** ; un modèle sans prix connu bloque la préparation. Désactivée par défaut pour un nouveau profil.
  - Les brouillons fermés sont supprimés après 30 jours (l'état « fermé » est gardé pour ne pas ressortir). Retirer un compte supprime ce qui en venait.
- **Intégration Sklubot.** Généralise la « chasse aux pépites » et les points réguliers du bot principal : un bot « veilleur » (ou le bot principal) avec outils en lecture seule, branché sur les déclencheurs natifs existants, notifications push, heures calmes déjà présentes.

### A7. Routines plus économes et plus transparentes — importance : **moyenne**

- **Comportement à ajouter.**
  - **Veilles sautées sans appel au modèle** : une routine qui attend un changement (une réponse, un événement) mémorise les comptes qu'elle surveille ; avant chaque exécution, le serveur vérifie s'il y a du nouveau et saute l'exécution sinon. La première exécution et celle qui suit un échec ont toujours lieu. Les rappels, résumés et sites ne sautent pas.
  - Une seule exécution à la fois : une routine récurrente saute ses échéances pendant une exécution active ; une ponctuelle attend.
  - « Lancer maintenant » ne change pas la prochaine échéance et ne réactive pas une routine en pause.
  - Une exécution qui échoue envoie un court message nommant la routine et la cause.
  - Retard annoncé : au‑delà de 10 min de retard, l'instruction mentionne l'heure prévue, l'heure réelle et le nombre d'échéances sautées.
  - Pas de doublon : une routine identique (même instruction, heure, conversation) déjà active est conservée au lieu d'en créer une copie.
  - Coût mensuel projeté par routine récurrente, annoncé à la création ou au changement d'horaire.
  - Une routine répond dans le canal où elle a été créée (Telegram → Telegram).
  - Résumés et rappels arrivent à chaque fois ; une veille ne parle que s'il y a quelque chose.
  - Une routine ne peut pas créer d'autres routines.
  - Après un travail ponctuel qui reviendra, le bot propose **une fois** de le refaire régulièrement.
  - Édition avec aperçu de la prochaine exécution et « annuler » tant qu'aucun changement plus récent ne l'a remplacé.
- **Intégration Sklubot.** S'ajoute aux routines existantes (cron, webhook, surveillance de page, rattrapage).

### A8. Mémoire mieux encadrée — importance : **haute**

- **Ce que l'utilisateur obtient.** Une mémoire visible note par note, avec la phrase d'origine, et qu'un e‑mail ou une page ne peut pas empoisonner.
- **Règles.**
  - Les notes ne viennent **que** des messages de l'utilisateur et de ce qu'il saisit lui‑même ; jamais des réponses du bot, des pages, des e‑mails ou des résultats d'outils.
  - Catégories : sur toi, préférences, personnes, habitudes, leçons.
  - Statuts : mentionné une fois (utilisé avec prudence) → appris (répété dans un second message) → confirmé (par l'utilisateur) ; « mis de côté » (remplacé, expiré, archivé) au lieu d'être effacé, avec restauration possible.
  - Une note devinée à partir d'un seul message, sans détail factuel, non répétée pendant 60 jours, passe en « mis de côté ».
  - Date de fin optionnelle par note ; archivage ; oubli immédiat.
  - Sujets sensibles (santé, religion, politique, sexualité, identité de genre, origine, statut migratoire, casier) non appris sauf réglage explicite.
  - Apprentissage de fond environ toutes les heures, par lots ; chaque ajout cite le message et un extrait mot pour mot qui doit s'y trouver ; ignore les messages longs, avec pièces jointes, trop récents (< 10 min), contenant des secrets ou issus d'un tour arrêté.
  - Écriture avec contrôle de version pour qu'un écrivain en retard n'écrase pas une version plus récente.
  - Confirmation courte seulement quand l'utilisateur demande explicitement de retenir.
  - **Import depuis un autre assistant** : une invite à copier dans un autre assistant, dont on recolle la réponse ; liste des notes trouvées à cocher ; doublons et lignes ressemblant à un mot de passe ou un numéro de carte ignorés. **Export** en Markdown.
  - **Style d'écriture** appris depuis les e‑mails envoyés (sans citations, noms ni faits), remplacé à chaque mise à jour.
  - La mémoire n'autorise jamais une action.
- **Intégration Sklubot.** Améliore l'apprentissage automatique et le dédoublonnage existants ; panneau mémoire par bot avec filtres par statut et lien vers le message source.

### A9. Compétences apprises toutes seules — importance : **moyenne**

- **Comportement.** Après une tâche en plusieurs étapes ou avec contournement, le bot rédige la procédure (étapes sur le site ou l'appli, pièges, vérification finale), la réutilise la fois suivante et la corrige quand le site change.
- **Règles.** Avant enregistrement, noms, adresses, coordonnées, numéros de commande ou de compte, montants et contenus de messages sont remplacés par des repères. Une compétence apprise est traitée comme **contenu extérieur** (une page a pu l'influencer) et n'autorise rien. Pas d'apprentissage si la sauvegarde mémoire est coupée ou si l'utilisateur dit de ne pas retenir cette tâche. Toutes visibles, modifiables, oubliables.
- **Intégration Sklubot.** Complète les compétences écrites par l'utilisateur (vague 1 « apprendre une compétence par démonstration »).

### A10. Guides de tâches chargés à la demande — importance : **moyenne**

- **Comportement.** L'invite du bot ne contient que la liste des noms et descriptions de guides ; le bot lit le guide complet quand la tâche correspond, et une annexe seulement si le guide dit qu'elle s'applique. Une trentaine de domaines (courses, voyages, factures et abonnements, démarches administratives, support client, ventes, recrutement, recherche, tableurs, documents et formulaires…).
- **Règles.** Un guide n'ajoute ni outil, ni accès, ni permission ; il ne peut pas autoriser à rejouer une action incertaine. Lecture limitée au dossier du guide.
- **Intégration Sklubot.** Applique ce chargement progressif aux compétences existantes (réduit la taille de l'invite et le coût) ; nous écrivons nos propres guides.

### A11. Codes de vérification et e‑mails sensibles gérés en privé — importance : **haute**

- **Comportement.**
  - Quand un site envoie un code par e‑mail, le serveur le récupère dans la boîte connectée en vérifiant expéditeur, destinataire, heure (seulement les e‑mails arrivés après la saisie des identifiants ou le début de la tâche, avec une petite marge) et compte, attend jusqu'à une minute, et le saisit sans que le modèle le voie.
  - Sinon l'utilisateur peut envoyer le code **seul** dans la discussion (y compris Telegram) : il est saisi en privé et retiré de l'historique. Tant qu'un code est attendu, un message qui mélange code et autres mots, ou un autre nombre de 3 chiffres ou plus, est refusé et non montré au modèle, avec demande de renvoyer le code seul.
  - Chaque e‑mail lu via les applis est d'abord vérifié séparément : s'il donne accès à un compte (code à usage unique, lien magique, réinitialisation de mot de passe, mot de passe provisoire, codes de secours, clé d'API), son contenu est masqué au modèle. Un simple reçu ou une alerte sans code reste visible. Échec de vérification → masqué.
- **Intégration Sklubot.** Complète le coffre (TOTP déjà présent) et Gmail/Outlook intégrés.

### A12. Paiement par carte du coffre, approuvé un par un — importance : **moyenne**

- **Comportement.** Le bot remplit tout le panier ; au moment de payer, une demande unique est liée à : la carte et sa version, la boutique (origine de la page), la page exacte, l'origine réelle de chaque champ carte (y compris dans les cadres), le bouton choisi, le montant et la devise affichés. L'utilisateur ouvre un panneau, vérifie, saisit le **cryptogramme** (jamais enregistré, jamais vu du modèle) et valide.
- **Règles.** Demande caduque si nouvelle demande, nouveau message dans la même conversation, carte modifiée, ou arrêt. « Carte envoyée » ≠ « payé » : le bot lit la page de la boutique ; en cas d'interruption, « résultat inconnu ». Jamais depuis Telegram : il faut ouvrir l'appli. Le modèle ne voit que nom, réseau, 4 derniers chiffres et expiration.
- **Intégration Sklubot.** Donne une voie gratuite aux « paiements » de la vague 7 sans fournisseur de cartes virtuelles ; s'appuie sur l'ordinateur du bot et sur la prise de main existante.

### A13. Contrôle des clics « qui engagent » dans le navigateur — importance : **moyenne**

- **Comportement.** Ouvrir, lire, taper sans valider, scripts en lecture seule : libres. Clic, touche Entrée, choix d'option, case, glisser, envoi de fichier, acceptation d'une boîte de dialogue : soumis à A1, qui voit le site, l'adresse, le libellé du contrôle, ce qui a été saisi sur la page, et pour un formulaire la méthode et l'adresse d'envoi (jamais le texte de la page). Bandeau cookies (choix le moins partageur), ajout au panier, étapes intermédiaires : lecture. Étape finale, envoi, commande, paiement, réservation, suppression, réglage enregistré : action.
- **Règles.** Un « oui » vaut pour un clic, seulement si la page, le contrôle et le formulaire sont toujours les mêmes. Contrôle sans libellé : seulement dans une mission sur ce site et si même le pire effet reste dans le périmètre.
- **Intégration Sklubot.** Plus délicat avec un bureau complet piloté par captures que par un navigateur instrumenté : à appliquer au moins aux actions du navigateur Chromium du bot, en gardant la règle « après contenu extérieur ».

### A14. Journal d'utilisation détaillé et exportable — importance : **moyenne**

- **Comportement.** Liste par jour des demandes et exécutions (origine : routine, vérification d'activité, tâche lancée par le bot), et pour chacune le pas‑à‑pas : appels au modèle (modèle, jetons, coût), actions (cible + mots qui l'ont autorisée, ou « tu as approuvé »), commandes (statut, sortie conservée), aides en retrait. Export CSV complet ; graphique et prévision du mois ; part du travail de fond. Questions en langage libre (« qu'as‑tu fait aujourd'hui ? », « as‑tu payé quelque chose cette semaine ? ») répondues depuis ces enregistrements ; relevé mensuel en PDF sur demande dans Telegram.
- **Règles.** Secrets connus retirés avant enregistrement ; chaque révélation d'un secret du coffre est journalisée ; à la limite mensuelle, le bot ne fait plus que répondre pour changer la limite (déjà proche de Sklubot).
- **Intégration Sklubot.** Enrichit le journal d'activité non modifiable et le compteur de coût par bot.

### A15. Fichiers locaux de l'utilisateur avec garde‑fous — importance : **moyenne**

- **Comportement.** Lister, lire (texte limité), copier vers l'ordinateur du bot, créer un dossier, écrire, modifier un passage exact, copier depuis l'ordinateur du bot, déplacer/renommer par lots sans écraser, mettre à la corbeille.
- **Règles.** Dossier personnel et disques externes seulement ; refus systématique des fichiers et dossiers cachés, des dossiers système de l'utilisateur, des sauvegardes, des fichiers qui contiennent typiquement des secrets (clés, certificats, bases de mots de passe, fichiers d'environnement…) et d'une **liste de dossiers interdits** que l'utilisateur alimente en discutant mais que **seul lui** peut vider dans les réglages. Jamais de suppression définitive : l'ancienne version va à la corbeille. Pas de création d'exécutables ni de raccourcis. Jamais depuis un travail lancé par le bot lui‑même (un e‑mail d'inconnu ne peut pas faire lire les documents). Ouvrir un fichier demande les mots de l'utilisateur ; lister est une lecture.
- **Intégration Sklubot.** Famille d'outils « Mes fichiers » sur le Relais (ordinateur de l'utilisateur), plus sûre et plus fine que la commande libre.

### A16. Connecteurs créés à la demande : API HTTP et outil en ligne de commande — importance : **moyenne**

- **Comportement.** Pour un service absent du catalogue, le bot propose une « voie d'accès » (serveur MCP, API HTTP, ou outil en ligne de commande) et envoie un lien vers une page privée où l'utilisateur colle le jeton. Le serveur ajoute le jeton à chaque appel ; il est retiré des résultats sous toutes ses formes (brute, échappée, encodée) ; un fichier renvoyé qui le contient est retenu.
- **Règles pour l'outil en ligne de commande.** Source déclarée (paquet npm, PyPI, ou téléchargement HTTPS avec empreinte facultative), variables d'identifiants nommées avec des suffixes de type jeton/clé/secret (jamais une variable qui charge du code), installation scellée sous un utilisateur dédié, environnement reconstruit à chaque exécution, aucun programme écrit par le modèle ne reçoit le jeton. Un appel à une voie non enregistrée est refusé.
- **Intégration Sklubot.** Prolonge le catalogue d'applis et l'usage sécurisé de secrets en en‑tête déjà présent.

### A17. Canal WhatsApp et commandes de canal — importance : **moyenne**

- **Comportement.** WhatsApp par code QR (numéro du bot séparé ou discussion avec soi‑même ; seuls les messages du numéro personnel déclaré sont acceptés ; groupes, statuts et historique ignorés) ou par l'API Cloud officielle. Dans Telegram/WhatsApp : commandes « tâches », « état », « stop » (répondu à un message de tâche → seulement elle), « usage », « mémoire » ; réactions dans les deux sens (👍/👎 sur une demande d'accord = oui/non) ; 👀 sur un message reçu pendant le travail ; section de progression mise à jour en place ; étapes privées (connexion, paiement, prise de main) jamais dans le canal : renvoi vers l'appli puis réponse dans le canal d'origine ; pas de renvoi automatique d'un message dont l'envoi est incertain.
- **Intégration Sklubot.** S'ajoute à Telegram par bot.

### A18. Réponses visuelles riches et panneau d'aperçu de fichiers — importance : **basse**

- **Comportement.** Cartes de lieux (vue d'ensemble numérotée + carte chargée seulement sur clic), vols (dates, numéros, escales visibles, absence d'info ≠ vol direct), plans de sièges, comparatifs de lieux, graphiques interactifs (barres, courbes, secteurs, navigation clavier). Panneau latéral pour images, audio avec forme d'onde, PDF, documents texte et présentations, tableurs (premières lignes), Markdown/HTML (HTML exécuté en bac à sable sans réseau), archives (liste). Navigation entre fichiers de la conversation.
- **Intégration Sklubot.** Complète les pages publiées et la bibliothèque de fichiers.

### A19. Idées de premières tâches à l'accueil — importance : **moyenne**

- **Comportement.** Pendant la préparation de l'ordinateur, si l'utilisateur connecte sa messagerie, le bot lit un petit échantillon récent et propose des cartes d'idées (une ponctuelle, deux récurrentes, puis des classiques : point du matin, bilan du vendredi). Il nomme jusqu'à trois applis dont l'utilisateur reçoit des notifications et qu'il gagnerait à connecter. Rien n'est envoyé, rien n'est lancé tant qu'une idée n'est pas choisie ; pas de préparation pour une réunion déjà commencée ou annulée. L'accueil peut être rejoué sans perdre les connexions.
- **Intégration Sklubot.** Premier lancement et création d'un bot.

### A20. Petits comportements de fiabilité — importance : **basse**

- Prise de main du navigateur réservée 30 min maximum ; « rendre la main » ne poste pas de message au nom de l'utilisateur ; reconnexion de la vue sans répéter la dernière saisie.
- Défi anti‑robot : jusqu'à trois essais réfléchis, arrêt sur blocage ou limite, puis passage de main en disant ce qui a été tenté.
- Validation sur un autre appareil : relecture de la page toutes les 15 s, huit fois au plus.
- Clés d'accès (passkeys) désactivées dans le navigateur du bot : échec immédiat plutôt qu'une invite invisible.
- Service de connexion saturé (réponses « trop de requêtes » / « indisponible ») : pause des lectures de fond, durée suivant l'en‑tête de nouvel essai ou doublée à chaque refus avec plafond.
- Erreurs temporaires du modèle : trois nouvelles tentatives au plus, affichées dans la ligne d'état ; aucune nouvelle tentative pour un outil ou une action.
- Ligne d'état qui nomme l'appli ou le site actif, signale l'attente du modèle au‑delà d'une minute et la durée de silence, sans jamais deviner l'heure de fin.

### A21. Script d'outils en bac à sable (« appels groupés ») — importance : **basse**

- **Comportement.** Le modèle peut écrire un petit script (sans réseau, fichiers ni minuteries) qui appelle plusieurs outils en parallèle et trie leurs résultats, pour économiser des allers‑retours. Chaque appel interne passe les mêmes contrôles qu'un appel direct ; si l'un demande l'accord, les suivants n'agissent pas.
- **Intégration Sklubot.** Optimisation de coût pour les bots en mode clé d'API.

### A22. Banc d'essai de bout en bout mesurant ce qui a vraiment changé — importance : **basse**

- **Comportement.** Des centaines de missions dans de fausses applis et faux sites, plusieurs passages chacune, en vérifiant l'état final (tâche réussie, action dangereuse exécutée ou non) plutôt que la réponse du bot ; tests de mémoire et de fausses mémoires.
- **Intégration Sklubot.** Étend nos tests avec modèle simulé à des essais réels avec modèle choisi.

---

## B) À ne pas intégrer, et pourquoi

| Élément de nod | Raison |
|---|---|
| Un seul propriétaire, un seul assistant, une seule conversation | Sklubot repose sur une **équipe** de bots, des salons et des rôles ; nous gardons ce modèle (les idées ci‑dessus s'appliquent par bot). |
| Application de bureau qui fait tourner l'assistant en local (virtualisation, démarrage à l'ouverture de session, menu système) | Sklubot est un serveur auto‑hébergé (VPS, Coolify) avec appli Android et Relais ; dupliquer une appli de bureau complète coûterait beaucoup pour peu de gain. |
| Conteneur navigateur séparé de l'espace de travail, un navigateur par sous‑tâche (4 max) | Notre ordinateur par bot avec bureau graphique et écran en direct couvre le besoin ; garder notre architecture. |
| Passage obligé par un service de connexion d'applis tiers hébergé par l'éditeur | Sklubot a déjà ses applis intégrées (OAuth direct) et MCP ; ajouter un intermédiaire réduirait la confidentialité. |
| Télémétrie d'usage activée par défaut et envoi optionnel de traces de conversation pseudonymisées à l'éditeur | Contraire à notre promesse « tout reste chez toi ». L'idée du nettoyage en couches (secrets, e‑mails, téléphones, cartes, IBAN, identifiants nationaux) peut toutefois servir pour notre export de rapports de bug. |
| Modèles de décision spécialisés externes pour le vérificateur | Dépendance payante ; un petit modèle généraliste ou le modèle du bot suffit (voir C). |
| Import direct depuis l'appli 1Password | Logiciel propriétaire et local seulement ; notre import CSV couvre le besoin. |
| Construction de workflows n8n intégrée au produit | Spécifique à n8n ; un utilisateur de n8n peut déjà brancher son serveur MCP comme application. Au plus, une compétence d'exemple. |
| Hébergement communautaire sur une offre de VM payante | Notre installation VPS en une commande suffit. |
| Voix locale reposant sur un composant GPL | Incompatible avec notre licence MIT ; nous restons sur la voix du navigateur (ou une alternative non GPL). |
| Limite de taille de mémoire par fichier unique | Détail d'implémentation lié à leur stockage ; Sklubot stocke en SQLite. |

---

## C) Dépendances payantes ou propriétaires et alternatives libres

| Dépendance dans nod | Pourquoi c'est un problème | Alternative gratuite / libre pour Sklubot |
|---|---|---|
| Service de connexion d'applis tiers (hébergé par défaut par l'éditeur ; rétention zéro complète réservée à une offre entreprise) | Jetons d'accès stockés chez un tiers ; quotas partagés ; coût | Nos applis intégrées par OAuth direct (Google, Microsoft, Slack) et serveurs MCP officiels ou auto‑hébergés |
| Modèles de décision commerciaux pour le vérificateur (via un agrégateur ou une clé dédiée) | Payant, données envoyées à un tiers | Petit modèle du même fournisseur ou modèle local (Ollama, llama.cpp) ; à défaut le modèle du bot au plus bas niveau de réflexion |
| Abonnement ChatGPT comme moteur | Propriétaire, conditions changeantes | Déjà couvert chez nous (Codex / Claude Code sur abonnement) ; modèles locaux compatibles OpenAI |
| Synthèse et transcription vocales commerciales (OpenAI, agrégateur, ElevenLabs) | Payant à l'usage | Voix du navigateur (déjà en place) ; Whisper (whisper.cpp) et Piper en local |
| WhatsApp : API Cloud de Meta (compte développeur, numéro professionnel, fenêtre de 24 h) ou client non officiel par QR | API officielle payante et contraignante ; client non officiel contraire aux conditions de WhatsApp (risque de blocage du compte) | Telegram (gratuit, déjà en place) ; Matrix/Element ou Signal via un pont auto‑hébergé ; WhatsApp seulement en option, avec avertissement clair |
| Appli 1Password | Propriétaire | Import CSV (déjà en place) ; Bitwarden/Vaultwarden en libre |
| Télémétrie et collecte de traces chez l'éditeur | Fuite de métadonnées | Aucune télémétrie ; journaux locaux uniquement |
| Hébergement sur VM payante (guide communautaire) | Coût mensuel | Notre VPS au choix ou machine personnelle |
| Cartes : OpenStreetMap | Libre (pas de souci), chargement seulement sur clic | Même approche possible |
| Validation de numéros de téléphone (bibliothèque publique de Google) | Libre (Apache) | Utilisable pour le nettoyage des exports si besoin |
| Paiement en ligne | Aucun prestataire : saisie de la carte par le serveur sur la page du marchand | Même approche gratuite (A12) plutôt qu'un fournisseur de cartes virtuelles |

## Mise à jour du 21/11/2026 (commit `1b42e68`, relu au commit `0f9de28`)

Ajouts décrits dans `docs/audits/AUDIT-NOD.md` § 2, lignes 1-14, 20, 22, 29, 40-47, 50, 52-53, 57-62, 63-66, 68 :
pilotage des applis natives par l'arbre d'accessibilité avec applis toujours refusées et garde des champs mot de passe
(1-14) ; ligne d'activité toujours visible (20) ; répondre à un message ou à une sélection (22) ; carte « Signaler un
problème » (29) ; routines lisibles — piste des retards / sauts / échecs, activité en direct, arrêt d'une seule
exécution, « a besoin de toi », « lancer maintenant » refusé sur une modification non relue, corrections partielles,
aperçu sans enregistrer, approbation d'une consigne complète (40-47) ; un modèle par type de travail, par tâche et par
routine (50) ; vérification de santé du modèle et arrêt du travail automatique sur un modèle en échec (52-53) ;
corrections du vérificateur d'actions (57-62) ; format ouvert de connecteurs avec preuves, adresse MCP privée tapée par
l'utilisateur, renommage, repli HTTP+SSE (63-66) ; Telegram complet (68).

Depuis la décision du propriétaire du 22/11/2026, le code de nod (Apache-2.0) peut être réutilisé avec attribution
(`docs/CLEANROOM.md`, `THIRD_PARTY_NOTICES.md`). L'état de chaque point est tenu dans `docs/COUVERTURE.md` § « nod —
mise à jour du 21/11 ».
