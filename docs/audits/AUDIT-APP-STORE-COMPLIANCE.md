# Audit complet : app-store-compliance (mjmirza) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `mjmirza/app-store-compliance`, commit `45248a7` (22/11/2026), v2.5.0, 141 fichiers. Rien n'a été exécuté.

Type : **outil + compétence + base de connaissances**. Un guide de conformité avant envoi sur l'App Store (Apple) et Google Play :
- `agent-os/skill/SKILL.md` : audit en 5 étapes (trouver le projet et les références → scan automatique → contrôles humains → plan de corrections classé → si déjà rejeté, plan d'appel) ;
- `agent-os/hooks/app-store-compliance-guard.sh` : **garde** qui scanne un projet iOS/Android/Expo/Flutter/Capacitor et **bloque la commande d'envoi** (crochet avant commande shell) s'il reste un risque critique ; verdict `CLEAR.` / `BLOCKED.` / `NOT CHECKED.` ;
- `data/` : **124 motifs de rejet** (Apple 62, Google 43, les deux 13, web 6 ; 38 critiques, 65 hauts), 113 recettes de détection, 111 échéances réglementaires, registre de 14 décisions ;
- `docs/` (~35 documents) et `references/` (10 types d'appli, 9 familles de règles) : Apple, Google Play, autres boutiques, UE (AI Act, DMA, DSA, accessibilité), monde (COPPA, lois d'âge des États américains…), plateformes, sécurité, vie privée, erreurs fréquentes et appels ;
- ~20 scripts Python (bibliothèque standard seulement) : audit de la fiche (textes), audit d'accessibilité, validation du manifeste de confidentialité Apple, audit de version (code de sortie 0/2/3), **moniteurs** (exigences Apple via leur flux RSS, Android, IA, vie privée, sécurité, réglementaire), échéances, balayage d'une flotte d'applis, **vérification des citations**, gabarits (notes pour la relecture, fichier de préparation, dérogations).

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 9 |
| PARTIEL | 8 |
| MANQUANT | 17 |
| DIFFÉRENT | 3 |
| NON REPRIS | 6 |
| **Total** | **43** |

Compétence (paquet) : 1 compétence → **IDÉE** seulement pour la version actuelle (licence non libre, voir § 1) ; **ADAPTER** possible depuis une version antérieure au 24/08/2026 (MIT + CC BY 4.0).

Lecture rapide : deux usages pour Sklubot.
1. **Pour Sklubot lui-même** (l'appli mobile Expo publiée sur Google Play, puis l'App Store) : `mobile/STORE.md` est **déjà très complet** (fiche, sécurité des données, permissions vérifiées, vidéo du service micro, serveur de démonstration, test fermé 12 testeurs / 14 jours, suppression de compte). Écarts trouvés : **signalement d'une réponse IA choquante dans l'appli** (attendu par les règles sur les applis d'IA générative), **manifeste de confidentialité Apple** (`PrivacyInfo.xcprivacy`) non mentionné pour iOS, et pas de contrôle automatique avant envoi.
2. **Pour les clients** dont un bot prépare une appli : Sklubot n'a aucune compétence « publier une appli ». Une compétence d'audit (texte) serait utile, mais la licence actuelle impose prudence.

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Dépôt entier (version actuelle 2.5.0, depuis 2.0.0 du 16/10/2026) | **OpenRoots Agent License 2.3** (`LICENSE`, `NOTICE` ; SPDX `LicenseRef-OpenRoots-ORA-2.3`) | Licence **non libre au sens OSI**. Gratuite pour particuliers, associations, écoles, administrations, et entreprises **≤ 20 M USD** de chiffre d'affaires annuel ; au-delà, redevance de 0,5 % du chiffre d'affaires attribuable au-dessus du seuil (plafond 250 000 USD/an), déclarée chaque trimestre. **L'entraînement d'IA n'est pas accordé** (licence « Compute » séparée). Pas de bascule vers une licence libre. Le texte légal fait foi (à une adresse externe, non lue ici). |
| Versions **avant le 24/08/2026** | **MIT** (code) + **CC BY 4.0** (contenu) (`NOTICE`) | Réutilisables librement avec attribution. La 1.0.0 date du 06/06/2026 (`CHANGELOG.md` l.307). Aucune étiquette `v1.x` publiée (seules `v2.0.0` à `v2.5.0` existent, `git ls-remote`) : il faudrait retrouver le dernier commit avant le 24/08/2026 (non vérifié). |
| Versions du 24 au 27/08/2026 | ORA 1.0 (bascule Apache-2.0 en 2029) | — |

**Conséquence pour Sklubot** : l'import GitHub de Sklubot classerait cette licence comme « restrictive / non reconnue » (non cochée d'avance, `docs/COMPETENCES.md` § 2). Le propriétaire est sans doute sous le seuil de 20 M USD, mais : (a) Sklubot hébergé **redistribue** les compétences à des clients dont certains pourraient dépasser le seuil, (b) la clause « Compute » n'est pas claire pour un usage comme contexte d'agent. **Recommandation** : ne pas copier le texte de la version actuelle ; soit réécrire à partir des sources officielles (règles Apple / Google, citées dans le dépôt), soit partir d'une version MIT/CC BY d'avant le 24/08/2026. Ceci n'est pas un avis juridique.

---

## 2. Tableau des fonctions

Preuves Sklubot : `mobile/STORE.md` (165 lignes : fiche Play l.9-40, classification l.42-50, sécurité des données l.52-70, permissions l.75-85, vidéo du service micro l.89, accès pour la relecture / serveur de démonstration `DEMO_MODE=1` l.95-97, test fermé l.130 et l.144-145, iPhone plus tard l.151-165), `mobile/app.config.ts` (bloc `ios` l.37), tests `mobile/__tests__/` (10 fichiers, aucun sur la conformité).

### 2.1 Pour l'appli mobile de Sklubot

| # | Point vérifié par le dépôt | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| C1 | **Compte de démonstration + serveur en ligne** pendant toute la relecture (1re cause de rejet sur les deux boutiques). | FAIT | `STORE.md` l.95-97 (serveur de démonstration https, `DEMO_MODE=1`) | Vérifier que le serveur de démo reste en ligne pendant la relecture (pas de surveillance trouvée). | S |
| C2 | **Déclaration de confidentialité = comportement réel, SDK compris** (2e cause). | FAIT | `STORE.md` l.52-70, « conforme au code » ; permissions vérifiées par `aapt2` l.75 | Pas de contrôle automatique qui recompare à chaque version. | S |
| C3 | Suppression de compte dans l'appli et sur le web. | FAIT | `STORE.md` l.58 | — | — |
| C4 | Service de premier plan typé (microphone) + vidéo de justification. | FAIT | `STORE.md` l.80-89 | — | — |
| C5 | Test fermé 12 testeurs × 14 jours (compte personnel récent). | FAIT | `STORE.md` l.130, l.144-145 | — | — |
| C6 | Captures montrant l'appli en usage (pas l'écran de connexion). | PARTIEL | `mobile/store/` : `00-signin.png` en premier | Mettre la capture de connexion en dernier ou la retirer. | S |
| C7 | La fiche ne promet que ce que fait l'appli ; pas de mention d'autres plateformes ; limites de caractères. | FAIT | Nom 30/30, description courte 80/80 (`STORE.md` l.11-14) | — | — |
| C8 | **Applis d'IA générative : modération, signalement et blocage des réponses IA comme du contenu utilisateur** (`references/guidelines/by-app-type/ai-and-generative-apps.md` l.8). | MANQUANT | Aucun bouton « signaler cette réponse » trouvé dans `mobile/src` ni `web/src` (recherche « signaler / report ») | Risque de rejet ou de retrait sur Google Play (règle sur le contenu généré par IA). Ajouter « Signaler » sur un message de bot (envoyé au propriétaire du serveur / à l'opérateur en mode hébergé). | M |
| C9 | Classification d'âge : questions 2026 d'Apple ; IARC sur Play. | PARTIEL | IARC traité (`STORE.md` l.42-50) | Questions d'âge Apple 2026 non traitées (iOS « plus tard »). | S |
| C10 | **Manifeste de confidentialité Apple** (`PrivacyInfo.xcprivacy`, API « à raison requise », domaines de suivi, manifestes signés des SDK) — imposé à l'envoi depuis 2024. | MANQUANT | `STORE.md` l.151-165 ne le mentionne pas ; rien dans `app.config.ts` (recherche `privacyManifests`) | Expo sait générer ce fichier (`ios.privacyManifests` dans la config) : à ajouter avant l'envoi iOS (vérifier la doc Expo). | S |
| C11 | Notes pour la relecture (gabarit). | PARTIEL | Instructions d'accès `STORE.md` l.95 | Pas de gabarit de « notes pour la relecture » App Store. | S |
| C12 | Exigences réglementaires UE pour une appli qui touche des Européens : **AI Act** (transparence : dire qu'on parle à une IA), **accessibilité (EAA)**, statut de commerçant **DSA** sur les boutiques. | PARTIEL | Les bots sont présentés comme des IA (fiche) ; accessibilité non auditée | Statut « commerçant » DSA à déclarer dans les boutiques (nom, adresse, contact) : non mentionné. | S |
| C13 | Applis qui exigent un compte / un serveur : expliquer clairement l'accès (Apple 2.1, 4.2 « fonctionnalité minimale »). | PARTIEL | Description : « Il te faut un serveur Sklubot » | Risque Apple 4.2 (« client léger d'un service ») : préparer l'argumentaire et la démo. | S |
| C14 | Variante « complet » (accessibilité pour piloter le téléphone) hors boutique. | FAIT | `STORE.md` l.3-5 | — | — |
| C15 | Contrôle automatique avant envoi (garde qui bloque l'envoi si risque critique). | MANQUANT | — | Script de vérification dans `mobile/` (permissions attendues, cible API, manifeste iOS, présence de la politique de confidentialité) lancé avant `eas submit`. | M |

### 2.2 Fonctions du dépôt (pour les clients de Sklubot)

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| F1 | Compétence d'audit en 5 étapes, sortie = tableau classé (motif, plateforme, règle citée, gravité, correction, fichier) + verdict ; **jamais « prêt » tant qu'un critique reste**. | MANQUANT | Aucune compétence « publier une appli » dans la bibliothèque | Compétence réécrite (voir licence). | M |
| F2 | Garde shell multi-frameworks (Xcode, Android, Expo, RN, Flutter, Capacitor, Ionic), détecte le type de projet, verdict `NOT CHECKED` si rien à scanner (au lieu d'un faux « tout va bien »). | MANQUANT | — | Le principe « pas de projet trouvé ≠ propre » vaut pour tous les contrôles de Sklubot (cf. contrôle des compétences : « Rien à signaler ne veut pas dire sûr », `docs/COMPETENCES.md` § 4). | M |
| F3 | Crochet « avant commande » qui **bloque la commande d'envoi** vers les boutiques tant que le scan n'est pas propre. | DIFFÉRENT | Sklubot : cartes d'accord sur les actions externes (`server/src/agent/irreversible.ts`) | L'envoi sur une boutique par un bot passerait par une carte d'accord ; un contrôle automatique avant la carte serait un plus. | M |
| F4 | Fichier de préparation `.app-review-readiness.json` : contrôles humains (démo, déclaration de confidentialité…) marqués `pass/fail`, lus par la garde. | MANQUANT | — | Bonne idée : une **liste de contrôle cochée par l'humain** que l'outil lit. | S |
| F5 | Audit de la fiche (`metadata-audit.py`) : limites de caractères, mention d'autres plateformes, fonctions futures, critiques d'Apple, grossièretés, classements/prix, mots-clés, politique de confidentialité et conditions d'abonnement manquantes, IA pour la Chine, URL malformées ; `--propose` écrit des corrections sans toucher l'original. | MANQUANT | — | Utile au bot qui rédige une fiche de boutique. | S |
| F6 | `pull-metadata.sh` : récupère la fiche en ligne via le CLI `asc`. | NON REPRIS | — | Outil tiers avec identifiants Apple. | — |
| F7 | Audit de version (`release-audit.py`) : code 0 prêt, 2 bloqué, 3 incomplet (scan raté ou fiche non auditée). | MANQUANT | — | Le code « incomplet » distinct de « prêt » est une bonne pratique. | S |
| F8 | Audit d'accessibilité (`accessibility-audit.py`) : tailles de police en `sp`, étiquettes, contrastes… | MANQUANT | — | — | S |
| F9 | Validation du manifeste de confidentialité Apple (`validate-privacy-manifest.py`). | MANQUANT | — | Voir C10. | S |
| F10 | **Moniteurs** des exigences (Apple via flux RSS officiel, Android, IA, vie privée, sécurité, réglementaire) : impact sur le dépôt, fichiers touchés, tâches de migration, brouillon de PR ; mode simulation ; jamais d'écriture (test `monitor-no-write`). | PARTIEL | Routines + recherche approfondie | Une routine « veille des règles des boutiques » pour le propriétaire de Sklubot : à créer. | S |
| F11 | `deadline-checker.py` + 111 échéances réglementaires datées ; frise générée. | MANQUANT | — | Données sous licence ORA (version actuelle). | S |
| F12 | `fleet-sweep.py` : audit de plusieurs applis d'un coup (`fleet.example.json`). | NON REPRIS | — | Hors besoin. | — |
| F13 | **Vérification des citations** (`verify-citations.py`) : chaque règle citée doit renvoyer à une source officielle d'une liste autorisée (`.citation-allowlist`). | PARTIEL | Recherche approfondie : citations vérifiées mot pour mot (`server/src/researchevidence.ts` l.122) | Pas de liste d'hôtes « sources officielles » pour les sujets juridiques/règlementaires. | S |
| F14 | Registre des décisions (`ruling-register`), dérogations (`waivers.example.json`) avec raison écrite. | MANQUANT | — | « Déroger par écrit avec une raison » existe aussi chez Hallmark : idée pour les contrôles Sklubot. | S |
| F15 | Évaluation : 32 cas de référence (`evals/gold-cases.json`), tableau de score. | MANQUANT | — | — | M |
| F16 | `check-docs.py` : échoue si un document cite un lien, un titre, un script ou une option qui n'existe pas. | MANQUANT | — | Utile pour les docs françaises de Sklubot (`docs/*.md` citent beaucoup de fichiers et de lignes). | S |
| F17 | Installation pour 12 outils de code (Claude Code, Codex, Gemini, Cursor, Copilot, Grok…), fusion propre des configs, désinstallation qui restaure à l'identique, `doctor`. | NON REPRIS | Bibliothèque Sklubot | — | — |
| F18 | Mode « si tu n'es pas développeur » dans le README (la checklist à la main). | FAIT | Sklubot écrit pour les non-développeurs (`mobile/STORE.md` en français simple) | — | — |
| F19 | CI : refus des commits « attribués à une IA », fermeture des PR de robots inconnus. | NON REPRIS | — | Politique propre au dépôt. | — |
| F20 | Règle « ne jamais renvoyer une version inchangée après un rejet » + plan d'appel. | MANQUANT | — | À mettre dans `STORE.md` (section « Si Google/Apple refuse »). | S |
| F21 | Autres boutiques (Samsung, Huawei, Amazon…) : `docs/OTHER-STORES.md`. | NON REPRIS | — | Hors besoin actuel. | — |
| F22 | Applis Mac, VPN, jeux, santé, finance/crypto, enfants, réseaux sociaux, abonnements : fiches par type. | MANQUANT | — | Pour la compétence client (F1). | S |
| F23 | Pas d'appel réseau sauf les moniteurs (flux RSS Apple) ; bibliothèque standard Python seulement. | FAIT (compatible) | Python 3.11 sur le bureau (`docker/desktop/Dockerfile` l.15) | — | — |
| F24 | Simulation d'avis (`monitor-simulated-notice`) pour tester sans réseau. | FAIT (principe) | Sklubot teste ses routines en mode démo | — | — |
| F25 | Gabarit `REVIEW-NOTES-TEMPLATE.md`. | PARTIEL | `STORE.md` l.95 | Voir C11. | S |
| F26 | Conformité « applis Expo/RN sans dossier natif » = `NOT CHECKED` (pas de faux succès). | DIFFÉRENT | — | Projet Sklubot : dossier `android/` présent, iOS non généré. | — |
| F27 | Sanctions/embargos à jour (correction OFAC Syrie, v2.0.0). | NON REPRIS | — | Hors sujet. | — |
| F28 | Lien `docs/llms.txt` pour les agents. | NON REPRIS | — | — | — |

---

## 3. Sur l'ordinateur du bot ?

- **Techniquement oui** : `bash` + Python 3 bibliothèque standard (le bureau a Python 3.11), aucune dépendance, aucun envoi de données sauf les moniteurs qui lisent le flux RSS d'Apple. La garde se lance sur un dossier : `bash app-store-compliance-guard.sh /chemin/appli`.
- **Ce que l'outil rend** : une liste de risques classés (critique / haut / moyen) avec l'identifiant du motif, la règle citée, la correction et le fichier, puis `CLEAR.` / `BLOCKED.` / `NOT CHECKED.` (codes 0 / 2 / 1). **Équivalent Sklubot** : aucun.
- **Mais licence** : la version actuelle est sous ORA 2.3 (§ 1). Ne pas l'installer dans l'image distribuée à tous les clients ; si le propriétaire veut l'utiliser pour **sa propre** appli, il peut le lancer lui-même (usage gratuit sous le seuil), sans redistribution.

---

## 4. Écarts de comportement

1. **Envoyer l'appli Sklubot sur Google Play.** Le dépôt : garde automatique + 2 contrôles humains prioritaires (démo, déclaration) + fichier de préparation coché + audit de la fiche, verdict avant l'envoi. Sklubot : `STORE.md` couvre déjà presque tout **à la main**, mais rien ne recontrôle à chaque nouvelle version (une nouvelle permission ajoutée par une dépendance passerait inaperçue jusqu'au rejet). **Correctif** : petit script `mobile/scripts/store-check` (permissions attendues vs `aapt2 dump permissions`, cible API, version, présence de l'URL de confidentialité) avant chaque envoi (M).
2. **Réponses IA choquantes.** Le dépôt rappelle que les applis d'IA générative doivent permettre de **signaler** une réponse. Sklubot n'a pas ce bouton. **Correctif** : action « Signaler » sur un message de bot (mobile + web), qui crée une entrée visible du propriétaire/opérateur, avec la réponse et le contexte (M).
3. **« Rien trouvé » ≠ « propre ».** La garde rend `NOT CHECKED` quand elle ne trouve pas de projet. Les contrôles de Sklubot disent déjà « rien à signaler ne veut pas dire sûr » pour les compétences ; à généraliser aux futurs contrôles de pages (cf. AUDIT-HALLMARK) (S).

---

## 5. À faire (classé)

1. Bouton **« Signaler cette réponse »** sur les messages de bot (mobile + web), remontée au propriétaire/opérateur — **M**.
2. Ajouter `PrivacyInfo.xcprivacy` (via la config Expo) et les questions d'âge Apple 2026 à la section iPhone de `mobile/STORE.md` — **S**. — **FAIT (2026-11-23)** : `mobile/store/privacy-manifest.json` → `ios.privacyManifests` (copie `store/PrivacyInfo.xcprivacy`), réponses d'âge et confidentialité dans `mobile/STORE.md`, contrôle `npm run store:check`
3. Script de contrôle avant envoi pour l'appli mobile (permissions, cible API, manifeste iOS, URL de confidentialité, captures sans écran de connexion en premier) — **M**.
4. Ajouter à `STORE.md` : statut de commerçant DSA, gabarit de notes pour la relecture Apple, argumentaire « client d'un serveur » (Apple 4.2), règle « jamais renvoyer une version inchangée après un rejet » — **S**.
5. Surveiller la disponibilité du serveur de démonstration pendant la relecture (routine ou moniteur) — **S**. — **FAIT (2026-11-23)**
6. **Fait le 22/11/2026** (`publier-une-appli`, depuis le commit MIT/CC BY 943e855 du 12/08/2026). Compétence client **« Préparer la publication d'une appli »** réécrite depuis les règles officielles (ou depuis une version MIT/CC BY antérieure au 24/08/2026), avec la règle « jamais prêt tant qu'un critique reste » — **M**.
7. Routine de veille « règles des boutiques » (flux RSS officiel Apple, blog Android) pour le propriétaire — **S**. — **FAIT (2026-11-25)** : `npm run store:rules` dans `mobile/` (date « Last Updated » des App Review Guidelines et bandeau du centre des règles Google Play, comparée à `mobile/store/rules-watch.json` ; code 2 si changement), à lancer par une tâche planifiée ; guide `docs/BOUTIQUES.md`
8. Contrôleur de docs (liens, chemins de fichiers, numéros de ligne cités dans `docs/*.md`) — **S**. — **FAIT (2026-11-23)**

## 6. Non vérifié

- Le texte légal canonique de l'ORA 2.3 (adresse externe) n'a pas été lu ; seul le résumé du dépôt l'a été. Ce n'est pas un avis juridique.
- Le dernier commit sous MIT/CC BY (avant le 24/08/2026) a été identifié le 22/11/2026 : `943e8556c567950db3e9fd1f9a52ddb1b2e0ba3a` (12/08/2026) ; le passage à l'ORA est le commit `ee18281` du 24/08/2026.
- Les 124 motifs et 113 recettes n'ont pas été lus un par un ; seuls les compteurs, un motif et les fiches IA/vie privée l'ont été.
- Le contenu exact de la règle Google Play sur le contenu généré par IA n'a pas été relu à la source officielle dans ce passage.
- Si l'appli Sklubot a un moyen de signalement ailleurs que sous les mots « signaler/report » : non vérifié en profondeur.
