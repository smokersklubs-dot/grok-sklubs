---
name: Préparer la publication d'une appli
description: Avant d'envoyer l'appli iOS ou Android d'un client sur l'App Store ou Google Play, ou après un refus - trouver le projet, y chercher les causes de refus habituelles, passer les vérifications que seule une personne peut faire, écrire un plan de corrections classé par gravité, et donner un verdict qui n'est jamais « prête » tant qu'un point critique reste.
---

> Adaptée d'app-store-compliance (github.com/mjmirza/app-store-compliance, commit 943e855 du 12/08/2026, avant son changement de licence ; © 2026 Mirza Iqbal ; code MIT, contenu CC BY 4.0). Modifiée pour Sklubot (22/11/2026) : condensée en une méthode qu'un bot Sklubot suit sur le projet du client dans son propre ordinateur ; les scripts, fichiers de données et moniteurs d'origine ne sont pas repris (le bot vérifie en lisant le projet et les pages officielles des boutiques) ; traduite en français. Les règles des boutiques changent : vérifie toujours les pages officielles du moment.

# Préparer la publication d'une appli

Pour l'appli mobile d'un client (iOS, Android, Expo, Flutter, Capacitor) sur le point d'être envoyée sur l'App Store ou Google Play, ou qui vient d'être refusée. C'est une aide à la décision, pas un avis juridique ; ce sont les boutiques qui décident.

## 1. Trouver le projet et les règles

- Le dossier du projet (demande-le au patron, ou prends le dépôt confié au bot), ses plateformes et le type d'appli (jeu, santé, finance, enfants, réseau avec publications des utilisateurs, IA qui génère du contenu…).
- Les règles : lis les pages officielles du moment avec web_fetch, jamais de mémoire : les App Store Review Guidelines d'Apple (developer.apple.com/app-store/review/guidelines/) et les règles du programme pour les développeurs de Google Play (support.google.com/googleplay/android-developer). Note la date de lecture.

## 2. Vérifier le projet (en le lisant, sans le modifier)

Cherche dans les fichiers les causes de refus habituelles et note chaque problème avec son fichier :
- création de compte sans moyen de supprimer le compte depuis l'appli ;
- écran de connexion sans compte de démonstration écrit pour les testeurs de la boutique ;
- paiements de contenus numériques qui contournent le système d'achat de la boutique là où il est obligatoire ;
- autorisations (appareil photo, position, contacts, micro) sans raison claire montrée à l'utilisateur ;
- une IA qui génère du contenu sans moyen de signaler une réponse choquante ;
- des publications d'utilisateurs sans signalement, blocage ni modération ;
- un lien vers la politique de confidentialité absent ou cassé ; le manifeste de confidentialité d'Apple (`PrivacyInfo.xcprivacy`) absent sur iOS ;
- un niveau d'API Android visé plus bas que ce que Google Play exige aujourd'hui ;
- des écrans pas finis, des textes provisoires, les mots « bêta » ou « test », des plantages que tu peux reproduire.

## 3. Les vérifications que seule une personne peut faire

Demande au patron (ou vérifie avec lui) — chaque réponse va dans le rapport :
- Le serveur est-il en ligne, et le restera-t-il pendant tout l'examen ?
- Un compte de démonstration qui marche est-il écrit dans les notes pour les testeurs ?
- Les étiquettes de confidentialité d'Apple et le formulaire « Sécurité des données » de Google correspondent-ils à ce que fait vraiment l'appli, **y compris chaque bibliothèque tierce** ? (Première cause de refus sur les deux boutiques.)
- Les captures montrent-elles l'appli en usage, pas un écran de démarrage ou de connexion ? La fiche ne promet-elle que ce que fait l'appli ?
- Nouveau compte Google personnel : le test fermé (12 testeurs pendant 14 jours) est-il fait ?
- Questions de classification par âge remplies ; pour des utilisateurs en Europe, aux États-Unis ou ailleurs, les règles locales (mention de l'IA, accessibilité, vie privée des enfants, vérification de l'âge) — les boutiques ne les vérifient pas.

## 4. Le plan de corrections

Une ligne par problème : gravité (critique, haute, moyenne), plateforme, règle citée (numéro et lien), correction concrète, fichier ou réglage à changer. Les critiques d'abord. Chaque point critique bloque la sortie.

## 5. Le verdict

- **Prête à envoyer** seulement quand aucun point critique ne reste. **N'écris jamais « prête » tant qu'un point critique reste**, même si le patron est pressé : dis « bloquée » et liste ce qui reste, numéroté.
- **Non vérifié** : ce que tu n'as pas pu vérifier (pas d'accès, pas de réponse) est dit comme tel, jamais compté comme bon.
- Envoyer l'appli (téléverser une version, la soumettre à l'examen) est l'acte du patron, ou demande son accord à chaque fois.

## 6. Après un refus

Lis le numéro exact de la règle citée par la boutique, corrige d'abord cette cause, explique la correction dans la réponse à l'examinateur, et ne renvoie jamais la même version sans changement (sur Google Play, un renvoi négligent peut mener à la suspension du compte). Les deux vérifications qui règlent la plupart des refus : un compte de démonstration qui marche avec un serveur en ligne, et des déclarations de confidentialité qui correspondent à l'appli.
