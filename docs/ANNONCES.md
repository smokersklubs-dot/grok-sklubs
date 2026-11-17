# Annonces

*Pour informer les testeurs et les utilisateurs d'un serveur Sklubot. Code : `server/src/announcements.ts` (règles), `server/src/announceroutes.ts` (routes), `server/src/announcetext.ts` (types et texte partagés avec l'application), `web/src/components/AnnouncementCard.tsx` et `AnnouncementsView.tsx`.*

## Qui écrit, qui lit

- **Écrire** : la personne qui gère le serveur (le premier compte) et, en mode hébergé, les opérateurs. Pour tous les autres, la page « Annonces » et ses routes (`/api/announcements-admin…`) n'existent pas (404), comme la Surveillance.
- **Lire** : tout le monde, les comptes d'une formule (mode hébergé), les membres d'un espace (et son propriétaire), ou des comptes précis (par leur e-mail, 200 au plus).
- Une annonce a un **type** (info, nouveauté, maintenance, important), un **titre** (80 caractères), un **texte** (1 000 caractères, 30 lignes), un **lien** facultatif avec le texte de son bouton, un **début** (maintenant ou programmé, au plus un an à l'avance) et une **fin** facultative (au plus un an après le début).
- Côté lecteur : une carte en haut d'**Aujourd'hui**, une **cloche** dans la barre latérale avec le nombre de non-lues, et pour une maintenance un **bandeau** en haut de toutes les pages si l'auteur le demande. Chacun ferme une annonce pour lui seul ; une annonce **importante** reste comptée jusqu'à « J'ai lu ».

## Notifications

Une annonce peut partir en **notification** et/ou par **e-mail** (seulement si le serveur a un compte SMTP) : une fois par lecteur et par canal (table `announcement_sends`, écrite avant l'envoi). Le lecteur peut couper les annonces (Réglages → Notifications : « Annonces », et « Annonces aussi par e-mail ») ; pendant ses heures calmes, rien ne part : l'envoi attend la fin des heures calmes (jusqu'à 3 jours après le début). Modifier une annonce déjà envoyée ne la renvoie pas.

## Limites

30 créations, modifications ou archivages par auteur et par heure ; 10 annonces avec notification ou e-mail en 24 heures sur le serveur ; 200 annonces non archivées ; 500 notifications et 60 e-mails par passage (un passage par minute, le reste au suivant). Côté lecteur : 120 actions par minute.

## Sécurité

- **Texte simple seulement** : les balises HTML sont refusées à l'enregistrement, les caractères de contrôle et d'inversion de sens d'écriture retirés. L'application affiche le titre, le texte et le bouton avec des nœuds de texte (jamais du HTML ni du Markdown) ; seuls les retours à la ligne sont gardés.
- **Liens en https seulement**, vérifiés avec le constructeur `URL` au serveur et dans l'application (pas de `javascript:`, `data:`, `http:`, ni d'adresse avec identifiant) ; ouverts dans un nouvel onglet avec `rel="noopener noreferrer"`. Dans le texte, seules les adresses `https://` deviennent des liens.
- La politique de sécurité du contenu (CSP) de l'application ne change pas : une annonce ne charge ni n'exécute rien.

## Pourquoi pas de flux distant

OpenMausBot publie ses annonces dans un fichier JSON de son dépôt GitHub, que chaque installation télécharge (Apache-2.0 ; nous n'avons repris que les idées). Sklubot ne va **rien chercher à l'extérieur** : les annonces sont écrites sur le serveur par ceux qui l'administrent déjà, et gardées dans sa base. C'est plus simple (ni téléchargement, ni cache, ni repli) et plus sûr : pas de requête sortante, pas de second auteur (quiconque peut fusionner dans un dépôt), pas de contenu qu'aucune personne de ce serveur n'a écrit, et chaque changement est dans le journal de la page (et dans le journal d'administration en mode hébergé).
