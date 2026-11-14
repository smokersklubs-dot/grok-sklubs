# 08 — « treg » : cahier des charges fonctionnel issu de l'étude

## Source étudiée

| Élément | Valeur |
|---|---|
| Dépôt | dépôt public GitHub de Superdesign nommé « treg » |
| Commit étudié | `bcdad8d7f6454a7ee7d90ea1d1ae2cade3a0bf6d` |
| Date du commit | 14/11/2026, 10:29 (UTC) |
| Licence | **Licence maison** : Apache License 2.0 **plus des « conditions additionnelles »** qui priment sur Apache. Elles interdisent d'utiliser le logiciel (original ou modifié) pour fournir un service hébergé, géré ou intégré à des tiers (SaaS, registre géré, composant d'un produit vendu) sans accord écrit de l'éditeur, et cèdent à l'éditeur un droit d'usage commercial sur les contributions. |
| Statut | Service hébergé en production par l'éditeur ; auto-hébergement possible pour sa propre équipe |

**Ce que la licence implique pour nous.** À cause de la restriction d'usage (« pas de service hébergé pour des tiers »), ce n'est **pas** une licence open source reconnue par l'OSI : c'est du code « source disponible ». Reprendre son code dans Sklubot (qui est distribué sous MIT et peut être hébergé pour d'autres) serait juridiquement risqué. **Nous ne reprenons que des idées et des comportements**, décrits avec nos mots : ni code, ni textes, ni noms de commandes ou d'en-têtes, ni maquettes, ni images. Les idées et fonctionnalités en tant que telles ne sont pas protégées par le droit d'auteur.

Méthode : lecture seule de la documentation livrée avec le dépôt (présentation, guide d'usage, notes de conception, journal des changements, recettes de travail) et survol de l'arborescence. Rien n'a été installé ni exécuté. Le clone a été supprimé après l'étude.

## Ce qu'est treg, en bref

treg se présente comme un **« routeur d'outils » pour agents IA** : avec une seule adresse et un seul jeton, un agent peut appeler un **catalogue de milliers de points d'accès payants** de nombreux fournisseurs (SEO et liens entrants, réseaux sociaux et tendances, enrichissement de personnes et d'entreprises, publicité, extraction de pages, génération d'images, de vidéos et de voix), **facturés à l'appel** sur un solde prépayé, sans s'inscrire chez chaque fournisseur. La seconde moitié du produit est un **coffre d'équipe** : les clés, connexions OAuth, outils en ligne de commande et compétences d'une équipe deviennent appelables par l'agent de chaque membre, **la clé ne quittant jamais le serveur** (un relais fidèle injecte l'authentification côté serveur et transmet tout le reste tel quel).

Il n'y a **pas de génération d'interfaces ou de design** dans ce dépôt, malgré l'éditeur : le seul document « design » décrit la charte de leur propre tableau de bord.

Comparé à Sklubot : nous avons déjà le coffre (secrets liés à des hôtes, jamais vus du modèle), les connecteurs MCP et OAuth avec renouvellement, les connecteurs d'API proposés par le bot, les compétences partagées, le budget et les points de contrôle de dépense, le journal d'usage. treg va **plus loin sur trois points** qui nous intéressent : (1) faire passer les appels réseau des programmes du bot par un relais qui injecte la clé, ce qui résout notre refus actuel de donner des secrets au terminal ; (2) le choix et l'enchaînement de plusieurs fournisseurs pour une même tâche, avec plafond de coût par appel et transparence sur qui a servi ; (3) la surveillance active de la santé des identifiants.

---

## A) Fonctions à intégrer

Chaque fiche décrit le comportement attendu, pas une implémentation.

### A1. Relais d'identifiants pour l'ordinateur du bot — importance : **haute**

- **Ce que l'utilisateur obtient.** Un script, un programme ou un outil en ligne de commande lancé par le bot **dans son ordinateur Linux** peut appeler une API pour laquelle l'utilisateur a enregistré une clé (Stripe, GitHub, un service SEO…), **sans que la clé entre jamais dans l'ordinateur du bot**. Le bot écrit la requête « normale » vers l'hôte réel ; Sklubot l'intercepte à la sortie et ajoute l'authentification côté serveur.
- **Entrées.** Une requête sortante de l'ordinateur du bot (méthode, hôte, chemin, paramètres, corps) ; la liste des secrets du coffre avec leurs hôtes liés, leur en-tête et leur préfixe ; les réglages d'autonomie et les règles du bot.
- **Sorties.** La réponse du fournisseur, inchangée ; une ligne dans le journal d'usage (bot, hôte, méthode, statut, secret utilisé — jamais sa valeur).
- **Règles.**
  - Seules les requêtes vers un **hôte lié à un secret** sont interceptées et complétées ; toutes les autres sortent sans être déchiffrées ni modifiées (tunnel aveugle, pas de certificat fabriqué pour elles).
  - Le relais **transmet fidèlement** méthode, chemin, paramètres (y compris répétés), en-têtes et corps ; il ne retire que ses propres en-têtes de contrôle et les en-têtes de transport. Il ne « modélise » pas l'API : un changement côté fournisseur ne le casse pas.
  - Le jeton qui identifie le bot auprès du relais est propre à l'ordinateur, révocable, et retiré avant l'envoi au fournisseur.
  - Mêmes garde-fous que l'outil d'usage de secret existant : https seulement, redirections non suivies vers un autre hôte, accord avant la première utilisation de chaque secret, et à chaque fois après du contenu extérieur pour une écriture (méthodes autres que lecture).
  - Toute valeur de secret qui réapparaîtrait dans une réponse est masquée avant d'atteindre le modèle.
  - Jamais vers une adresse locale ou privée (même règle que les lectures de pages).
- **Cas limites.** Programme qui ignore le proxy : la requête part sans clé et échoue en 401 ; le bot reçoit une explication (« ce programme n'utilise pas le relais ») plutôt qu'un échec muet. Deux secrets pour le même hôte : le bot doit choisir lequel par son nom ; sinon on demande. Requête en flux (téléversement long) : transmise en flux sans tout charger en mémoire. Secret supprimé pendant une exécution : les requêtes suivantes partent sans clé et sont signalées.
- **Place dans Sklubot.** Comble l'écart documenté (« les secrets ne sont pas proposés aux commandes du terminal ») sans l'affaiblir : c'est justement l'injection hors du conteneur qui rend la liaison à un hôte possible. Réglage par bot « Mes clés utilisables par les programmes de l'ordinateur » (désactivé par défaut).

### A2. Santé des identifiants (vérification active et alerte) — importance : **haute**

- **Ce que l'utilisateur obtient.** Une vue « état de mes clés et connexions » qui dit, pour chaque secret du coffre, connecteur d'API, application intégrée et connecteur MCP : **fonctionne / à reconnecter / clé refusée / jamais vérifié**, avec la date du dernier contrôle ; et une notification dès qu'une connexion casse, **avant** qu'une routine échoue dessus.
- **Entrées.** La liste des identifiants ; pour chacun, une requête de contrôle en lecture seule et sans coût (connue pour les applications du catalogue, ou déduite d'un point d'accès déclaré « de contrôle » pour un connecteur d'API) ; une fréquence (par défaut une fois par jour, et à la demande).
- **Sorties.** Un état par identifiant, une ligne au journal d'activité, une notification push (et Telegram si relié) en cas de passage de « fonctionne » à « cassé ».
- **Règles.**
  - **Vérifier à l'enregistrement** : une clé tapée par l'utilisateur est essayée auprès du fournisseur avant d'être acceptée ; si le contrôle échoue, on l'indique clairement et on propose « enregistrer quand même ».
  - Les connexions OAuth renouvelables sont renouvelées avant expiration ; un jeton simple (non renouvelable) collé à la main est signalé « à recoller à son expiration ».
  - Un contrôle ne fait jamais d'écriture et ne coûte rien ; un identifiant sans contrôle possible reste « jamais vérifié » plutôt que d'inventer un appel.
  - Une seule alerte par passage à l'état cassé (pas de répétition quotidienne).
- **Cas limites.** Fournisseur indisponible (5xx, délai) : état « incertain », pas « cassé », nouvel essai plus tard. Limite de débit atteinte : ne compte pas comme une panne. Routine liée à un identifiant cassé : marquée « en pause — connexion à refaire » avec un bouton.
- **Place dans Sklubot.** Prolonge l'état « se reconnecter » qui existe déjà pour OAuth et la notification push existante. Le rapport quotidien peut aussi alimenter les points réguliers du bot principal.

### A3. Tâches à plusieurs fournisseurs : ordre, cascade et transparence — importance : **moyenne**

- **Ce que l'utilisateur obtient.** Pour une tâche courante (recherche web, lecture d'une page difficile, recherche d'une adresse e-mail professionnelle, transcription…), le bot n'a pas à connaître le fournisseur : Sklubot essaie les moyens disponibles **dans un ordre annoncé**, passe au suivant en cas d'échec ou de résultat vide, et dit **qui a répondu, ce qui a été essayé et ce que ça a coûté**.
- **Entrées.** La tâche et ses paramètres ; les moyens disponibles pour cette tâche (application connectée de l'utilisateur, connecteur MCP, connecteur d'API, service gratuit comme SearXNG ou la lecture de page, navigateur de l'ordinateur du bot) ; un plafond de coût pour l'appel ; des préférences facultatives (« préférer X », « exclure Y », « s'arrêter au premier résultat »).
- **Sorties.** Le résultat, plus un résumé : moyen qui a servi, moyens essayés et pourquoi ils ont été écartés (erreur, vide, trop cher), coût total.
- **Règles.**
  - **Ordre par défaut : d'abord ce que l'utilisateur possède déjà** (ses comptes et clés, jamais facturés en plus), puis le gratuit, puis le payant du moins cher au plus cher. Le bot ne bascule **jamais en silence** vers un moyen payant que l'utilisateur n'a pas activé.
  - Une erreur du fournisseur (5xx, panne) ou un résultat vide fait passer au suivant ; une erreur de la requête elle-même (paramètre invalide) **arrête** la cascade, car le suivant échouerait aussi.
  - Au plus deux moyens supplémentaires par appel, et jamais au-delà du plafond de coût.
  - Un filtre que le moyen retenu n'a pas pu appliquer est **signalé** dans le résultat (option « strict » : refuser plutôt que répondre sans le filtre).
  - Option « confirmer » pour les données sensibles à l'erreur (une adresse e-mail) : n'accepter un résultat que si un second moyen donne le même ; sinon le rendre marqué « non confirmé ».
  - Travail asynchrone (génération vidéo, extraction longue) : on suit la tâche jusqu'à un délai ; au-delà on rend « en cours » avec une référence à suivre, et on **ne lance pas** un autre moyen payant tant que le premier peut encore aboutir.
- **Cas limites.** Aucun moyen disponible : le bot explique quoi connecter (carte de connexion), sans erreur sèche. Tous vides : « rien trouvé » avec la liste de ce qui a été essayé. Plafond trop bas pour le premier moyen payant : refus clair avec le coût estimé.
- **Place dans Sklubot.** Généralise ce que fait déjà la recherche web (Claude nativement, sinon Brave ou SearXNG) et la vidéo (Higgsfield, puis secours). Le résumé « servi par… » s'affiche dans l'étape d'outil repliable.

### A4. Coût annoncé avant l'appel et refus lisibles par le bot — importance : **moyenne**

- **Ce que l'utilisateur obtient.** Avant une étape payante d'un outil tiers (génération vidéo, enrichissement, données SEO), le bot connaît et **annonce le coût estimé** ; un dépassement de budget produit une réponse que le bot comprend et sur laquelle il agit (proposer de relever, attendre, choisir moins cher) au lieu d'un échec confus.
- **Entrées.** Le prix connu de l'action (déclaré dans le catalogue ou le connecteur, ou renvoyé par un devis du fournisseur), le plafond par appel, le budget restant du bot et du compte.
- **Sorties.** Une estimation avant l'appel ; après l'appel, le coût réel inscrit au journal d'usage ; en cas de refus, une réponse structurée : budget restant, coût estimé, action proposée (carte de point de contrôle de dépense).
- **Règles.**
  - Une action payante **sans prix connu** n'est pas lancée automatiquement : on demande.
  - Le coût est compté en très petites unités entières (fractions de centime), jamais en virgule flottante, pour que les petits appels répétés s'additionnent juste.
  - Réserver le montant maximal avant l'appel, puis régler le montant réel et libérer la différence ; un appel échoué côté fournisseur ne coûte rien quand le fournisseur ne facture pas les échecs.
  - Une même requête renvoyée (nouvel essai après coupure) avec la même clé d'idempotence ne coûte pas deux fois et rend le même résultat.
  - Plafond **quotidien** facultatif par bot sur les dépenses d'outils tiers, en plus du budget mensuel.
- **Cas limites.** Devis impossible (fournisseur muet) : on demande avant de lancer. Prix qui change entre devis et appel : nouveau devis si l'écart dépasse le plafond.
- **Place dans Sklubot.** S'appuie sur les points de contrôle de dépense, le budget mensuel et le journal d'usage existants ; étend leur périmètre des jetons de modèle aux outils tiers payants.

### A5. Mémoire des réponses (cache respectueux des conditions) — importance : **moyenne**

- **Ce que l'utilisateur obtient.** Une routine ou un bot qui redemande la même donnée (le profil d'une entreprise, les liens d'un domaine) dans un délai court ne la repaie pas : la dernière réponse utile est resservie, avec la mention de son âge.
- **Entrées.** La requête normalisée (outil, paramètres), la réponse, son horodatage, la politique de conservation de l'outil.
- **Sorties.** La réponse en mémoire si elle est fraîche, marquée « resservie, obtenue il y a N heures » ; sinon un vrai appel.
- **Règles.**
  - Seules les **lectures de données** sont gardées : jamais une action qui modifie quelque chose, jamais l'état d'une tâche en cours (un « en cours » resservi bloquerait tout), jamais une information sur le compte de l'utilisateur (solde, quotas).
  - Chaque outil a une politique : **interdit** (les conditions du fournisseur l'excluent), **temporaire** (durée maximale), ou **conservé**. En l'absence de politique : temporaire et court. Une politique « interdit » est toujours respectée.
  - L'utilisateur ou le bot peut demander « donnée fraîche » pour forcer un vrai appel.
  - Chaque compte ne voit que ses propres réponses.
- **Cas limites.** Réponse d'erreur ou vide : jamais gardée comme « utile ». Paramètres équivalents dans un autre ordre : même entrée.
- **Place dans Sklubot.** Complète l'option des routines « ne rien faire si rien n'a changé » ; réduit le coût des routines qui interrogent des connecteurs payants.

### A6. Import d'un projet : clés d'un fichier d'environnement et dossier de compétences — importance : **moyenne**

- **Ce que l'utilisateur obtient.** L'utilisateur dépose un fichier d'environnement ou un dossier de compétences ; Sklubot montre **d'abord un aperçu** de ce qu'il va créer (quels secrets, liés à quels hôtes ; quelles compétences), puis l'importe en une fois.
- **Entrées.** Le contenu du fichier (noms de variables et valeurs) ; une table de correspondance « nom de variable → fournisseur → hôte, en-tête et préfixe » pour quelques dizaines de fournisseurs courants ; un dossier contenant des fiches de compétences.
- **Sorties.** Des éléments du coffre de type « secret » liés à leurs hôtes, des compétences partagées ou propres à un bot, un rapport (créés, ignorés, à compléter).
- **Règles.**
  - L'aperçu ne montre **jamais les valeurs**, seulement les noms et les hôtes devinés.
  - Une variable non reconnue n'est pas importée d'office : l'utilisateur précise l'hôte ou l'écarte.
  - Importer deux fois ne crée pas de doublons ; une option « remplacer » met à jour les valeurs existantes.
  - Chaque clé importée passe par la vérification de A2.
  - Les valeurs ne transitent ni par la discussion ni par le modèle.
- **Cas limites.** Fichier contenant des variables qui ne sont pas des secrets (port, mode) : ignorées. Compétence qui mentionne une clé en clair dans son texte : alerte et proposition de la déplacer dans le coffre.
- **Place dans Sklubot.** Rejoint l'import CSV du coffre et l'import de compétence depuis une adresse ; utile à la mise en route.

### A7. Outil composé, vérifié à l'enregistrement — importance : **moyenne**

- **Ce que l'utilisateur obtient.** Une compétence répétitive (« chercher l'entreprise, puis le décideur, puis son e-mail, puis le vérifier ») devient un **outil appelable** par tous les bots, qui s'exécute de façon déterministe, sans repasser par le modèle à chaque étape.
- **Entrées.** Un contrat (nom, description, paramètres d'entrée, forme du résultat) ; soit une liste d'étapes (appels d'outils avec passage de valeurs), soit un petit script ; des exemples d'entrées ; la liste des hôtes que l'outil a le droit de joindre ; facultativement un tableau de données qui voyage avec l'outil (une feuille devient un outil sans base de données).
- **Sorties.** Un nouvel outil dans la liste des bots ; pour chaque exécution : résultat, durée, étapes, coût.
- **Règles.**
  - À l'enregistrement, les exemples sont **exécutés une fois pour de vrai** ; l'outil n'est disponible que si ce contrôle réussit.
  - Un script tourne dans un processus séparé **sans réseau propre** : sa seule sortie est la passerelle d'appels d'outils de Sklubot, donc approbations, règles, budget et journal s'appliquent à chaque étape.
  - L'outil ne peut joindre que les hôtes qu'il déclare ; il n'emporte jamais les clés : chaque étape utilise les identifiants du compte.
  - Les étapes qui écrivent restent soumises aux approbations habituelles.
- **Cas limites.** Une étape échoue : arrêt avec le numéro de l'étape et la raison, rien de fait au-delà. Outil modifié : nouvelle version, l'ancienne reste disponible jusqu'au contrôle réussi de la nouvelle.
- **Place dans Sklubot.** Prolonge les compétences apprises (proposées par le bot puis enregistrées) en leur donnant une forme exécutable ; la vérification à l'enregistrement s'aligne sur la règle « pas d'impasse ».

### A8. Lien public temporaire pour un fichier de référence — importance : **moyenne**

- **Ce que l'utilisateur obtient.** Quand un service de génération (vidéo, voix, image) exige l'**adresse publique** d'une image ou d'un clip de référence, le bot peut publier un fichier de sa bibliothèque à une adresse temporaire que le service peut télécharger.
- **Entrées.** Un fichier de la bibliothèque du bot ; une durée de vie.
- **Sorties.** Une adresse publique non devinable, valable pendant la durée choisie, puis supprimée.
- **Règles.** Taille et types de fichiers limités (images, audio, vidéo) ; durée courte par défaut (une heure), maximum un jour ; accord avant la première publication si le tour a lu du contenu extérieur ; liste des liens actifs avec bouton « retirer » ; jamais un lien ou fichier spécial de la bibliothèque.
- **Cas limites.** Service qui vérifie l'adresse avant de télécharger (requête de test) : l'adresse répond correctement à cette vérification. Lien expiré pendant une génération longue : la génération échoue avec un message clair et une proposition de republier.
- **Place dans Sklubot.** S'appuie sur les pages publiques révocables existantes ; utile au flux vidéo (Higgsfield et secours).

### A9. Recherche d'outil par la tâche — importance : **basse**

- **Ce que l'utilisateur obtient.** Le bot (et l'utilisateur dans le catalogue d'applications) trouve un outil en décrivant **ce qu'il veut faire** (« trouver l'e-mail professionnel de quelqu'un »), pas le nom d'un fournisseur ; les résultats affichent ce que fait l'outil, son coût et un exemple de réponse.
- **Entrées.** Une phrase ; l'ensemble des outils disponibles (applications intégrées, connecteurs, connecteurs d'API, outils composés).
- **Sorties.** Une liste classée, avec pour chaque outil : à quoi il sert, s'il est déjà connecté, gratuit ou payant, prix, exemple.
- **Règles.** La recherche par mots-clés reste le socle ; un tri par pertinence (petit modèle ou embeddings locaux) peut s'ajouter mais, s'il tombe en panne, on rend la liste par mots-clés sans erreur. Un outil peut déclarer des paramètres stricts : un paramètre inconnu ou hors limites est refusé avant l'appel, en nommant le paramètre, sans rien facturer.
- **Place dans Sklubot.** Utile surtout quand le nombre d'outils d'un bot devient grand (catalogue + MCP + API) ; évite de tout charger dans le prompt.

### A10. Recettes de travail prêtes à l'emploi — importance : **basse**

- **Ce que l'utilisateur obtient.** Quelques guides livrés avec Sklubot pour des travaux complets : repérer des acheteurs à partir de signaux publics (plaintes, recrutements, levées de fonds) puis les qualifier ; transformer une offre d'emploi en liste courte de candidats argumentée ; lire le web quand les outils habituels échouent, en commençant par le gratuit.
- **Règles communes reprises de l'étude.** Annoncer le coût estimé avant chaque étape payante ; s'arrêter aux points de choix et laisser l'utilisateur décider ; écarter le bruit (une liste de signaux n'est pas une liste de prospects) ; rendre un résultat classé avec, pour chaque ligne, la source et une phrase « pourquoi maintenant » ; **dire la couverture** (« 1 180 trouvés, 800 avec e-mail ») ; un plafond de dépense par élément.
- **Place dans Sklubot.** Les « guides » existent déjà ; ce sont des contenus, écrits par nous. Attention au RGPD pour tout ce qui touche aux données personnelles (voir B).

---

## B) À ne pas intégrer, et pourquoi

| Élément de treg | Pourquoi pas |
|---|---|
| Place de marché hébergée avec solde prépayé, marge sur chaque appel, paiement par carte, crédit offert, recharge automatique | Sklubot est auto-hébergé avec les clés de l'utilisateur ; revendre l'accès à des comptes de fournisseurs est un autre métier (contrats, fraude, fiscalité) et serait contraire aux conditions de la plupart des fournisseurs. |
| Rémunération des auteurs d'outils composés (prix par appel, par résultat, en pourcentage), pages publiques et vitrine classée | Pas de place de marché chez nous ; on ne garde que l'outil composé (A7). |
| Catalogue de milliers de points d'accès servis avec les clés de l'éditeur | Dépend de comptes payants détenus par l'éditeur ; chez nous l'utilisateur connecte ses propres comptes. |
| Enrichissement de personnes (e-mails et téléphones personnels, vérification de lignes) en masse, extraction de plateformes sociales chinoises et occidentales | Fort risque juridique (RGPD, conditions d'utilisation des plateformes) ; on ne l'ajoute pas comme fonction intégrée. Un utilisateur peut toujours connecter un service conforme par MCP ou connecteur d'API. |
| Exécution de logiciels en ligne de commande avec la clé placée dans leur environnement | La clé entrerait dans l'ordinateur du bot et pourrait y être copiée ; l'éditeur lui-même a désactivé l'exécution côté serveur. Les outils qui respectent un proxy passent par A1. |
| Équipes multiples, rôles, invitations, accès par membre, authentification d'entreprise et synchronisation d'annuaire, périmètres par client | Hors de notre périmètre actuel (une personne, ses bots) ; les bots partagés sont prévus en vague 6 et feront l'objet de leur propre spec. |
| Arènes de comparaison publiques (plusieurs fournisseurs sur la même entrée, votes, classements) et fournisseur « fantôme » mesuré sur le trafic réel | Outils d'opérateur de place de marché. Le besoin réel chez nous (savoir quel moyen marche) est couvert par le résumé « servi par / essayé » de A3. |
| Rejeu d'échanges enregistrés pour prouver qu'une modification ne change pas la facturation | Outillage interne de l'éditeur. |
| Module de mémoire par « juge » qui garde les phrases jugées préférences durables | Sklubot a déjà l'apprentissage automatique après les conversations, avec dédoublonnage et niveau de confiance. |
| Réponses converties en lignes et colonnes pour un module de tableur | Faible valeur ; nos pages et tableaux de bord publiés couvrent l'affichage tabulaire. |
| Mesure d'audience anonyme de l'outil en ligne de commande, demandes d'avis après chaque appel, formulaire de retours | Sklubot n'envoie rien à l'extérieur ; nous avons déjà les réactions de retour dans la discussion. |
| Distribution par places d'extensions d'assistants de code | Sans rapport avec notre produit. |
| Contrôle anti-robot à l'inscription, limites de débit par adresse IP derrière un CDN | Utile à un service public ouvert ; Sklubot ferme les inscriptions après le premier compte. |

---

## C) Dépendances payantes ou propriétaires, et alternatives gratuites

| Dépendance de treg | Rôle | Alternative gratuite ou déjà présente |
|---|---|---|
| Fournisseurs de données payants (Semrush, Moz, Crunchbase, Apollo, Hunter, DataForSEO, etc.) | Contenu du catalogue | Comptes de l'utilisateur via nos connecteurs ; pour le web : SearXNG, palier gratuit de Brave, lecture de page, navigateur de l'ordinateur du bot ; Crawl4AI (libre) pour l'extraction |
| Paiement en ligne (Stripe) | Recharge du solde | Inutile (pas de revente) |
| Envoi d'e-mails transactionnels (Resend) | Codes de connexion, invitations | Inutile : lien de connexion d'opérateur déjà en place |
| Authentification d'entreprise (WorkOS) | SSO, annuaire | Hors périmètre |
| Hébergement géré (Render), stockage objet (Cloudflare R2), stockage clé-valeur compatible Redis | Production de l'éditeur | Notre serveur unique, disque local et SQLite ; MinIO si un stockage objet devient nécessaire |
| Mesure d'audience (PostHog), chat d'assistance (Intercom), anti-robot (Cloudflare Turnstile) | Service public | Aucun besoin |
| API de « juge » propriétaire pour classer les outils par pertinence | Recherche par la tâche (A9) | Le modèle déjà configuré du bot, ou des embeddings locaux ; repli par mots-clés |
| OpenRouter, synthèse vocale Fish Audio, génération vidéo tierce | Modèles et médias du catalogue | Nos fournisseurs de modèles configurés ; synthèse vocale du navigateur ou Piper (libre) ; vidéo via Higgsfield déjà intégré ; ffmpeg (libre) pour le montage ; whisper.cpp (libre) pour les sous-titres |
