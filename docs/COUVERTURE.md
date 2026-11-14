# Couverture des cahiers des charges (salle blanche)

Vérification faite dans le code (pas dans la doc), fonction par fonction, sur les 5 cahiers des charges de `docs/cleanroom/`.

| Cahier | Fait | Partiel | Manquant | Différent exprès | Total |
|---|---|---|---|---|---|
| 01 — produit de base | 50 | 3 | 5 | 11 | 69 |
| 02 — capacités (inventaire large) | 21 | 32 | 34 | 3 | 90 |
| 03 — capacités (inventaire large) | 19 | 35 | 25 | 4 | 83 |
| 04 — documentation publique | 36 | 38 | 43 | 3 | 120 |
| 05 — évolutions du successeur | 26 | 9 | 2 | 12 | 49 |
| **Total** | **152** | **117** | **109** | **33** | **411** |

Le produit de base (01, 05) est presque complet ; les écarts viennent surtout des inventaires larges : équipe et entreprise, canaux, voix, paiements.

## Plan de rattrapage (par vagues, une à la fois)

| Vague | Contenu |
|---|---|
| 1 (en cours) | Réactions, réponses et fils · vidéo (Higgsfield en priorité, OpenAI/Google en secours) · apprendre une compétence par démonstration |
| 2 | Gmail, Google Agenda, Drive, Outlook, Slack au catalogue · déclencheurs natifs (e-mail entrant, message Slack) · plusieurs comptes étiquetés par appli |
| 3 | Notifications push (Web Push) · le bot demande la prise de main (CAPTCHA, 2FA) et attend · coffre étendu (clés API en saisie sécurisée, codes TOTP, génération de mot de passe, import CSV) · épingles, sections, masquer, dupliquer, marquer non lu · palette de commandes et recherche dans la discussion |
| 4 | Fiabilité : modèles de secours ordonnés, nouvelles tentatives, reprise après coupure, messages de progression, rappels de travail bloqué, garde anti-boucle plus fine · pages privées/lien et éditions ciblées · bibliothèque de compétences et profil partagés entre bots · un bot qui crée des bots / se met à jour · recherche X |
| 5 | Mode « Auto » avec relecteur automatique et règles en langage naturel · routines : retard affiché, quotas, surveillance de commandes |
| 6 | Voix temps réel avec interruption (fournisseur vocal) · e-mail propre au bot · bots partagés entre plusieurs personnes, rôles, administration |
| 7 | Avec fournisseur externe : appels téléphoniques, réunions, paiements et cartes virtuelles · applis natives iOS / bureau |
