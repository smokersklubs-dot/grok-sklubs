# Audit — Open Generative AI (Anil-matcha/Open-Generative-AI) face à Sklubot

Dépôt lu : commit `6f726e6539b06bb2f4288f20480c116e7173a06d` (23 nov. 2026), clone superficiel, rien n'a été exécuté. Les 3 sous-modules (Vibe-Workflow, Open-Poe-AI, Open-AI-Design-Agent) n'ont **pas** été clonés : seuls leurs points d'appel dans ce dépôt ont été lus.
Côté Sklubot : lecture seule du code. Aucun test n'a été lancé : la consigne de cette mission interdit de lancer du code qui importe le serveur Sklubot.

**Compte (tableau des fonctions, 58 lignes)** : FAIT 9 · PARTIEL 13 · MANQUANT 14 · DIFFÉRENT 9 · NON REPRIS 13

---

## 1. Ce que c'est, en une phrase

Une **interface graphique** (Next.js pour le web, Electron pour le bureau) branchée sur **MuAPI** (`api.muapi.ai`), un **revendeur payant** qui donne accès à plus de 600 modèles d'image, de vidéo et de son. Ce n'est pas un moteur vidéo. Presque tout ce que l'appli fait passe par la clé MuAPI de l'utilisateur et se paie à chaque génération. Seule exception : un petit moteur local, uniquement dans l'appli de bureau (voir 1.3).

### 1.1 Licence

- `LICENSE` : **MIT License**, « Copyright (c) 2026 Open Generative AI Contributors ». Ça permet de réutiliser, modifier et revendre le code, à condition de garder l'avis de copyright et l'avis MIT.
- Les sous-modules ont leur propre licence (non vérifiée) : Vibe-Workflow (SamurAIGPT), Open-Poe-AI, Open-AI-Design-Agent.
- Les modèles téléchargés en local ont aussi leur propre licence (SDXL : CreativeML Open RAIL++-M ; Realistic Vision, Anything v5, DreamShaper : licences de type RAIL sur Hugging Face ; Z-Image : à vérifier). Wan2GP (deepbeepmeep) n'est pas inclus : l'utilisateur l'installe lui-même, et sa licence n'a pas été vérifiée.
- Les vignettes et vidéos de démo sont chargées depuis `cdn.muapi.ai` et `d3adwkbyhxyrtq.cloudfront.net`. Elles ne sont pas sous MIT : **ne pas les reprendre**.

### 1.2 Comment la vidéo est générée (chemin principal, payant)

- Client : `packages/studio/src/muapi.js`. Envoi avec `POST {BASE}/api/v1/{endpoint}` et l'en-tête `x-api-key: <clé MuAPI>`, qui renvoie un `request_id`. Ensuite, l'appli interroge `GET /api/v1/predictions/{id}/result` toutes les 2 s, jusqu'à 900 fois, soit environ 30 min (`utils/generationLifecycle.js:31-80`). Une erreur 5xx relance la question ; un statut `failed/error/cancelled` arrête. Si MuAPI annonce un remboursement, il est affiché (`appendGenerationRefundNotice`).
- Envoi de fichiers : `POST /api/v1/upload_file` (`muapi.js:369`), donc **les images, vidéos et voix de l'utilisateur partent chez MuAPI**.
- Solde : `GET /api/v1/account/balance`, demandé toutes les 30 s (`components/StandaloneShell.js:451,629`).
- En mode web, `middleware.js` et `app/api/**/route.js` font un simple relais vers `api.muapi.ai` (pour contourner CORS). La clé vient du navigateur (`localStorage`). Il n'y a pas de clé serveur partagée.
- Catalogue : `packages/studio/src/models.js` (42 304 lignes, 592 endpoints). Il porte les noms Kling, Veo 3/3.1/4, Sora, Seedance 2/2.5 (dont « VIP »), Wan 2.x/3.0, MiniMax Hailuo/H3, Vidu, PixVerse, LTX, Grok Imagine, Midjourney v7/v8/Niji, Flux, Nano Banana, GPT Image, Topaz, etc. Chaque modèle est un endpoint MuAPI, pas l'API officielle du fournisseur.
- Ateliers (« studios ») qui appellent MuAPI : Image, Vidéo, Audio, AI Clipping (`ai-clipping`), Vibe Motion (`runMotionGraphics`), Lip Sync (9 modèles : Infinite Talk, Wan 2.2 S2V, LTX lipsync, Sync, LatentSync, Creatify, Veed…), Body Swap/Recast, Motion Control (Seedance 2.5 / Kling), Marketing (Seedance 2 VIP omni-reference), Cinema (Image + mots-clés caméra), AI Influencer, Layers (décomposition, upscalers Topaz/SeedVR2), Workflows (hébergés chez MuAPI), Agents (hébergés chez MuAPI), Design Agent.

**Coût.** Ce n'est pas écrit dans le dépôt, sauf « Insufficient credits… top up at muapi.ai » (`src/lib/muapi.js:9`) et l'offre marque blanche « à partir de 49 $/mois » (README). La page publique `muapi.ai/pricing`, lue le 23 nov. 2026, indique un **paiement à la génération**. Exemples : Veo 3 texte→vidéo 2,50 $ (fast 0,60 $), Kling 2.1 master T2V 1,20 $, I2V pro 0,40 $, Wan 2.2 T2V/I2V 0,30 $, Wan 2.2 5B fast 0,016 $, Qwen Image 0,03 $, Veed lipsync 0,52 $/min. La page ne mentionne pas d'offre gratuite. **Avant de générer, l'interface n'affiche aucun prix.** `estimateV2VCost()` existe (`muapi.js:235`, appel `POST /api/v1/models/{endpoint}/estimate-cost`), mais aucun composant ne l'appelle (grep : aucun usage hors `muapi.js`). Seul le solde est affiché.

### 1.3 Ce qui marche sans service payant (appli de bureau seulement)

- **sd.cpp** (stable-diffusion.cpp, MIT). Le binaire est téléchargé depuis les releases GitHub du projet ou de `leejet/stable-diffusion.cpp` (`electron/lib/localInference.js:161,280`). Les poids viennent de Hugging Face (`electron/lib/modelCatalog.js`). **Images seulement** : SD 1.5 (DreamShaper 8, Realistic Vision 5.1, Anything v5), SDXL Base 1.0, Z-Image Turbo/Base. Point faible : **aucune vérification d'empreinte (sha256) des téléchargements** (grep `sha|checksum|integrity` vide dans `localInferenceDownload.js`).
- **Wan2GP** (à installer soi-même, carte NVIDIA ou AMD obligatoire). L'appli lance `wgp.py --process settings.json` dans le dossier de l'utilisateur (`electron/lib/wan2gpLocal.js`), ou parle au serveur MCP de WanGP sur une autre machine (`electron/lib/wan2gpMcp.js`, Streamable HTTP, protocole 2025-06-18). Modèles : Wan 2.1 1.3B (environ 8 Go de VRAM, 480p), Wan 2.2 14B T2V/I2V, Hunyuan Video 1.5, LTX-2 22B distilled, Flux.1 Dev, Qwen Image 20B. C'est **la seule vidéo sans paiement**, et elle demande un GPU.
- La version web n'utilise jamais le local.

### 1.4 Problèmes à dire clairement

1. **Suppression de filigrane.** Il y a un vrai outil : `video-watermark-remover` (« Remove watermarks, logos, captions… », `models.js:32827`), plus `seedance-2.0-watermark-remover` et `seedance-2-video-watermark-remover-pro` (« Remove SD 2.0 watermarks… LaMa inpainting », `models.js:33116,33158`). Il est rangé dans le groupe « removeWatermark » de l'écran Vidéo (`seedanceModels.js:174-175`, `VideoStudio.jsx:550,738`). Ces outils retirent la marque « fait par IA » des vidéos Seedance : c'est contraire au principe de l'étiquette IA de Sklubot, et probablement à l'article 50 de l'AI Act européen et aux conditions de ByteDance. Le catalogue « Apps » fait aussi la promotion de « ClearMark AI — Automated watermark removal » (`AppsStudio.jsx:102`). **EXCLU.**
2. **Filtres retirés, assumé.** Le README vend « no content filters, no guardrails, no prompt rejections » et met en avant une vidéo « Best Uncensored AI models for hacking ». Des modèles « Spicy » sont décrits comme « reduced content-safety filtering » (`models.js:30210`), avec des profils spicy pour Wan, MiniMax H3 et Seedance (`alibabaModels.js`, `minimaxModels.js`), et Grok Imagine en mode `spicy` (`models.js:86`). **EXCLU.**
3. **Imitation de personnes sans consentement.** Body Swap/Recast (`RecastStudio.jsx`, `processRecast`), Motion Control « objects_swap » (remplacer les personnages d'une vidéo filmée), Lip Sync sur la vidéo de n'importe qui, AI Influencer à partir d'une photo. **Aucun contrôle de consentement nulle part** (grep `consent` vide).
4. **Origine des modèles douteuse.** Midjourney v7/v8/Niji n'a pas d'API publique officielle connue ; on les trouve pourtant (`models.js:2816-2996`). Sora et Veo 3.1 sont toujours proposés, alors que Sklubot note que l'API vidéo d'OpenAI a fermé le 24 sept. 2026 et que Veo 3.1 preview a fermé le 22 oct. 2026 (`server/src/video.ts:26-28`). Les variantes « VIP », « Intl », « Spicy », « Kinovi character » ne figurent pas dans les API publiques des fournisseurs. Pour au moins une partie du catalogue, il faut donc supposer une **revente non officielle ou un passage par des comptes grand public** : non vérifiable depuis le dépôt. Les prix inférieurs à fal.ai/Replicate vont dans le même sens, sans le prouver.
5. **Vie privée.** Le README dit « Your data stays local », c'est faux pour le chemin cloud : chaque fichier envoyé, chaque prompt et chaque résultat passe par MuAPI. La clé est stockée en clair dans `localStorage`.
6. Le README est surtout un **support commercial** pour MuAPI (marque blanche, revente) ; les mentions « Open-source alternative to HF AI » et « Higgsfield-like » renvoient à une marque tierce : ne pas reprendre ce texte.

---

## 2. Tableau des fonctions et équivalent Sklubot

Tailles : S = moins d'un jour, M = quelques jours, L = plus d'une semaine.

| Domaine | Fonction (Open Generative AI) | Statut Sklubot | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Vidéo | Texte → vidéo | FAIT | `server/src/agent/tools.ts:348` (`video_generate`), `server/src/video.ts:90,120` (xAI Grok Imagine, Gemini Omni Flash) ; test `server/test/wave7.test.ts`, `waveA.test.ts` | 2 fournisseurs au lieu de centaines ; clés de l'opérateur seulement (env) | — |
| Vidéo | Image → vidéo (image de départ) | FAIT | `tools.ts:353` `reference_image`, `video.ts:95,125` ; test wave7 (non relu en détail) | Pas d'image de fin ni d'images clés | — |
| Vidéo | Plusieurs références (jusqu'à 9 images, 3 vidéos, 3 sons) | MANQUANT | — | Une seule image d'entrée | M |
| Vidéo | Prolonger une vidéo (extend) | MANQUANT | — | — | M |
| Vidéo | Choix du modèle par l'utilisateur dans une liste | PARTIEL | `video.ts:30-47` : variable d'env `VIDEO_PROVIDER` | Pas de choix par génération dans l'interface ni pour le bot | M |
| Vidéo | Réglages selon le modèle (durée, format, résolution, qualité, audio) | PARTIEL | `tools.ts:350-353` : durée, 16:9/9:16/1:1 | Pas de résolution, de qualité, de seed, de négatif ni d'audio natif | S |
| Vidéo | Vidéo locale gratuite (Wan2GP sur GPU) | MANQUANT | — (`video.ts:153` : démo ffmpeg seulement) | Fournisseur « Wan2GP MCP » sur la machine GPU du propriétaire | M |
| Vidéo | Montage multi-pistes | DIFFÉRENT (mieux) | `server/src/videostudio.ts:187`, `web/src/components/StudioEditor.tsx`, `studiomp4.ts` ; test `studio-layers.test.ts`, `studio-workflows.test.ts` | OGAI n'a aucun montage ; Sklubot a 60 plans, 48 clips, LRC, voix | — |
| Vidéo | Export MP4 en file d'attente persistante | FAIT | `server/src/studioqueue.ts`, `studiomp4.ts` ; test `studio-workflows.test.ts` (partiel) | — | — |
| Vidéo | Reprendre un travail en cours après rechargement (pending jobs) | PARTIEL | Studio : la file reprend l'export depuis le début (`docs/STUDIO-VIDEO.md`). `video_generate` : pas de reprise par `request_id` | Retenir le `request_id` du fournisseur et reprendre l'interrogation après un redémarrage (OGAI : `src/lib/pendingJobs.js`) | M |
| Vidéo | Suivi de progression | FAIT | `tools.ts:378` `setLive … filming %`, `video.ts:115` | — | — |
| Vidéo | Délai max / relance sur 5xx pendant le suivi | FAIT | `video.ts:75-117` (5 s puis 10 s, 20 min, relance sur 5xx/429) | OGAI : 30 min ; même logique | — |
| Vidéo | Bascule vers un autre fournisseur | FAIT | `tools.ts:391-412` (sans doubler un travail qui peut encore finir) | OGAI ne l'a pas | — |
| Vidéo | Suppression de filigrane | NON REPRIS | — | Retire l'étiquette IA, contraire à l'AI Act et aux conditions du fournisseur | — |
| Vidéo | Ajouter son propre filigrane / logo | MANQUANT | (le Studio peut superposer une image, `studioclips.ts`) | Préréglage « logo » simple | S |
| Vidéo | Sous-titres IA (`ai-captions`) | PARTIEL | `web/src/components/StudioSubtitles.tsx` | Pas de transcription automatique d'une vidéo importée vérifiée ici | M |
| Vidéo | AI Clipping (extraire les temps forts d'une vidéo longue) | MANQUANT | — | Transcription + choix de passages + découpe ffmpeg en local | M |
| Vidéo | Vibe Motion (motion graphics générés) | DIFFÉRENT | `server/src/studiotechniques.ts`, `videoworkflows.ts` : 9 techniques rendues en local | Pas de génération par modèle ; local et gratuit | — |
| Vidéo | Motion Control (transfert de mouvement d'une vidéo) | MANQUANT (seulement via Higgsfield) | Higgsfield `motion_control` via connecteur (`server/src/catalog.ts:150`) | Pas de chemin natif | L |
| Vidéo | Body Swap / Recast | NON REPRIS sans consentement ; MANQUANT avec | `server/src/agent/consent.ts:19` couvre `face_swap`, mais pas `recast` ni `body_swap` | Ajouter `recast|body_?swap|motion_?control|replace_?(object|character)` au filtre | S |
| Vidéo | Cinema Studio (caméra, objectif, focale, ouverture → mots du prompt) | MANQUANT | — | Petite liste de « mots caméra » pour le prompt (texte maison, pas les images) | S |
| Vidéo | Marketing Studio (pub à partir de photos produit) | PARTIEL | Higgsfield `ads_studio_*` via connecteur ; Studio pour le montage | Pas de modèle natif | M |
| Lip sync | Portrait + son → vidéo parlante | PARTIEL | Seulement via le connecteur Higgsfield ou Fish Audio ; le consentement s'applique (`consent.ts:19` `lip_?sync|talking_?…|avatar`) ; test `security-lot1.test.ts:107` | Pas de chemin natif | M |
| Lip sync | Vidéo + son → vidéo synchronisée | PARTIEL | idem | idem | M |
| Lip sync | Contrôle de consentement | DIFFÉRENT (Sklubot mieux) | `consent.ts:30-45`, branché dans `authorize.ts:10` | OGAI n'en a aucun | — |
| Image | Texte → image | FAIT | `tools.ts:307`, `server/src/images.ts:18` (format OpenAI `images/generations`) ; test `dsbot-images.test.ts` | Un seul fournisseur configuré par l'admin | — |
| Image | Image → image / retouche (jusqu'à 14 références) | MANQUANT | — (`images.ts` n'a pas d'`images/edits`) | Retouche avec image(s) d'entrée | M |
| Image | Choix du modèle, format, qualité, résolution | PARTIEL | `images.ts:12-14` (env `IMAGE_MODEL`) | Pas de format ni de qualité dans l'outil | S |
| Image | Agrandissement (upscale Topaz/SeedVR2) | MANQUANT (seulement via Higgsfield `upscale_image`) | — | — | M |
| Image | Décomposition en calques (Layers) | MANQUANT | — | — | L |
| Image | Dessin / masque (DrawModal) | MANQUANT | — | Inpainting avec masque | L |
| Image | Moteur local sd.cpp (SD 1.5 / SDXL / Z-Image) | MANQUANT | — | Option bureau Linux / compagnon : image gratuite sur CPU ou GPU | L |
| Image | AI Influencer (persona cohérente) | NON REPRIS tel quel | `consent.ts:19` capte `ai_influencer` | Seulement à partir de sa propre image, avec la carte de consentement | — |
| Son | Musique et effets sonores générés | MANQUANT (Fish Audio connecteur : effets) | `server/src/voice/*` (Piper/Kokoro TTS) | Musique générée | M |
| Son | Voix off (TTS) | DIFFÉRENT (mieux) | `server/src/voice/piper.ts`, `kokoro.ts`, Studio « Lire les titres en voix off » | OGAI passe par MuAPI ; Sklubot reste local | — |
| Son | Clonage de voix | DIFFÉRENT | Fish Audio par connecteur + carte de consentement `consent.ts:19` | — | — |
| Étiquette IA | Marque IA dans le fichier | DIFFÉRENT (Sklubot seul) | `aivideo.ts:79` (XMP IPTC dans MP4), `aimedia.ts:31` (images) ; test `ai-video-label.test.ts:32-77` | OGAI n'en a aucune et propose même de l'enlever | — |
| Étiquette IA | Étiquette sur les médias récupérés par `media_save` (Higgsfield…) | MANQUANT | `tools.ts:417-439` : `storeBytes` sans `labelAiVideo`/`labelAiImage` | Une vidéo Higgsfield arrive **sans** marque IA | S |
| Étiquette IA | Étiquette imposée dans un montage qui contient un clip généré | PARTIEL | `videostudio.ts:198,238` : `aiLabel` optionnel, au choix du bot ou de l'utilisateur | Forcer `aiLabel` quand un clip vient de `videos/` généré | S |
| Coût | Solde affiché | PARTIEL | Sklubot : dépense et budget (`server/src/thirdparty.ts`, `credits.ts`) | Pas de solde du compte fournisseur (non applicable pour xAI/Gemini) | — |
| Coût | Prix annoncé avant chaque génération | PARTIEL | `tools.ts:358-365` : prix sur la carte seulement si l'admin a défini `VIDEO_PRICE_USD`, sinon « prix inconnu » | Estimation par fournisseur et par paramètres (MuAPI a `estimate-cost`) ; la carte n'apparaît que la 1re fois par bot (« Toujours ») | M |
| Coût | Plafond, réservation, pas de double facturation | DIFFÉRENT (Sklubot mieux) | `thirdparty.ts:62-104` reserve/settle/release, clé d'idempotence `tools.ts:395` ; test `credits.test.ts` | **Faille** : sans `VIDEO_PRICE_USD` et sans plafond journalier, `maxUsd = 0` (`tools.ts:395`), donc les budgets mensuel et d'usage ne bloquent rien avant l'appel | S |
| Coût | Approbation des images payantes | MANQUANT | `tools.ts:307-320` : `image_generate` sans gate ni réservation (seulement `meterOperatorUse` en hébergé) | Gate + réservation comme pour la vidéo | S |
| Coût | Remboursement signalé à l'utilisateur | MANQUANT | `tools.ts:398-402` : `release` silencieux pour l'utilisateur | Petit message « rien n'a été facturé » (déjà dit pour l'échec global) | S |
| Clés | Clé de l'utilisateur (BYOK) saisie dans l'interface | PARTIEL | Connecteurs API avec le jeton du propriétaire dans le coffre (`apiconnectors.ts:9-24`, `apipresets.ts`) ; **mais** `video.ts:37-47` et `images.ts:10-15` ne lisent que les clés de l'env (opérateur) | Clé vidéo/image par compte dans un formulaire ; en hébergé, un plan « byok » n'a **aucune** vidéo native (`hosted.ts:477`) | M |
| Galerie | Historique des générations | DIFFÉRENT | Bibliothèque du bot `videos/`, `images/`, messages du chat | OGAI : `localStorage` du navigateur ; Sklubot : serveur (mieux) | — |
| Galerie | Réutiliser des fichiers déjà envoyés (upload history picker) | PARTIEL | Bibliothèque du bot, `reference_image` par chemin | Pas de sélecteur visuel dans un écran « générer » | S |
| Galerie | Téléchargement en un clic | FAIT | pièces jointes du chat / Studio | — | — |
| Interface | Écran « générer » dédié (prompt + réglages + résultat) | MANQUANT | Tout passe par le chat ou le Studio de montage | Petit panneau « Générer un clip » dans le Studio, qui appelle le même outil | M |
| Interface | Glisser-déposer de fichiers | FAIT (chat/Studio) | `web/src/components/StudioClips.tsx` | — | — |
| Interface | Bascule texte→X / image→X automatique selon l'entrée | PARTIEL | `video.ts:95` (image facultative) | — | S |
| Interface | Multilingue | DIFFÉRENT | Sklubot fr/en ; OGAI en/zh | — | — |
| Workflows | Chaînes de nœuds (Vibe-Workflow) hébergées chez MuAPI | DIFFÉRENT | Routines, chantiers et Studio de Sklubot (non comparés en détail) | OGAI s'appuie sur le cloud MuAPI | — |
| Workflows | Modèles de workflows communautaires | NON REPRIS | — | Hébergé et payant chez MuAPI | — |
| Agents | Agent créatif conversationnel | DIFFÉRENT | Le bot Sklubot lui-même (`video_studio_create`, `video_generate`) | — | — |
| Agents | Design Agent (canevas) | NON REPRIS | sous-module, service MuAPI | — | — |
| Apps | Annuaire « Explore Apps » (liens vercel, revente) | NON REPRIS | — | Publicité, et une app de suppression de filigrane | — |
| Apps | Page MCP & CLI (MuAPI MCP `api.muapi.ai/mcp`) | NON REPRIS tel quel | — | Possible plus tard comme connecteur MCP officiel s'il existe, avec la clé du propriétaire | — |
| Bureau | Appli Electron, installeurs mac/win/linux, profil AppArmor | DIFFÉRENT | Compagnon Electron Sklubot (`companion/`) | — | — |
| Sécurité | En-têtes CSP, relais sans cookie | FAIT (côté Sklubot, autrement) | `guardedFetch` (`server/src/net.ts`), pas de SSRF sur l'adresse du résultat (`video.ts:80`) | — | — |
| Sécurité | Empreinte des téléchargements de modèles | NON REPRIS (OGAI ne le fait pas) | Sklubot vérifie les empreintes Git des guides (`docs/STUDIO-VIDEO.md`) | Si on ajoute un moteur local : sha256 obligatoire | — |
| Contenu | Modèles « spicy » / sans filtre | NON REPRIS | — | Choix de sécurité | — |
| Contenu | Midjourney / modèles sans API officielle | NON REPRIS | — | API non officielle probable | — |

---

## 3. Écarts de comportement (parcours principaux)

1. **Demander une vidéo.** OGAI : l'utilisateur choisit un modèle et clique sur Générer, sans voir de prix ; en cas d'échec il voit « Generation failed: … » et « Refunded N credits ». Sklubot : le bot appelle `video_generate`. La 1re fois, une carte « Autoriser … Facturé par xAI » s'affiche (`tools.ts:358`), avec un prix seulement si `VIDEO_PRICE_USD` est défini. Ensuite, « Toujours » laisse le bot continuer sans plus rien demander. **Correctif** : estimer par fournisseur, durée et résolution (table de prix par modèle, tenue par l'admin ou lue chez le fournisseur quand il existe un endpoint officiel d'estimation), afficher le prix **à chaque** génération au-delà d'un seuil, et réserver au moins `DEFAULT_MAX_COST_USD` quand le prix est inconnu (aujourd'hui `0`, `tools.ts:395`).
2. **Le serveur redémarre pendant une génération.** OGAI garde le `request_id` dans `localStorage` (`src/lib/pendingJobs.js`) et reprend l'interrogation au rechargement, donc la vidéo payée n'est pas perdue. Sklubot : le tour est coupé ; la réservation reste « reserved » jusqu'à ce que le tour soit rejoué, et l'id xAI est perdu, donc **une vidéo payée peut être perdue**. **Correctif** : écrire `request_id` et fournisseur dans `tool_spend` dès l'envoi, puis reprendre au démarrage (M).
3. **Échec chez un fournisseur.** OGAI : arrêt immédiat. Sklubot : bascule vers le suivant sans doubler un travail qui peut encore finir (`tools.ts:398-402`) : c'est mieux.
4. **Délai.** OGAI : 30 min. Sklubot : 20 min, puis le message « xAI may still finish it, but I stopped waiting » (`video.ts:117`) : pas de reprise possible, même problème qu'au point 2.
5. **Étiquette IA.** OGAI n'en met aucune et propose de l'effacer. Sklubot étiquette `video_generate`, `image_generate` et le MP4 du Studio quand `aiLabel` est coché. **Trous** : `media_save` (vidéos Higgsfield) n'étiquette pas (`tools.ts:417-439`), et un montage qui contient un clip généré peut sortir sans étiquette (`videostudio.ts:198`). Les deux correctifs sont de taille S.
6. **Copier un visage ou une voix.** OGAI ne demande rien. Sklubot affiche une carte unique, impossible à passer en « Toujours » (`consent.ts`), mais seulement d'après le **nom** de l'action : `recast`, `body_swap`, `motion_control`, `objects_swap`, `replace_character` et les appels `api_send` vers un endpoint de lip sync ne sont pas captés. **Correctif** : élargir l'expression, et tester aussi le chemin de l'endpoint pour `api_send` (S).
7. **Clé du fournisseur.** OGAI : la clé de l'utilisateur dans son navigateur. Sklubot : clés de l'opérateur dans l'env pour la vidéo et l'image ; en mode hébergé avec un plan « byok », la vidéo native est refusée (`hosted.ts:477`). Un utilisateur hébergé ne peut donc faire de vidéo qu'avec Higgsfield. **Correctif** : un « fournisseur vidéo/image » par compte, avec la clé saisie par le propriétaire dans un formulaire (coffre, lié à l'hôte, invisible pour le bot), qui passe avant les clés de l'opérateur (M).

---

## 4. Plan d'intégration dans Sklubot

### 4.1 Ce qu'on peut reprendre directement (MIT, avec attribution)

Ajouter dans `THIRD_PARTY_NOTICES` (ou équivalent) : « Portions adapted from Open Generative AI, MIT License, Copyright (c) 2026 Open Generative AI Contributors, https://github.com/Anil-matcha/Open-Generative-AI/tree/6f726e6539b06bb2f4288f20480c116e7173a06d ».

| Élément | Fichier source | Usage dans Sklubot | Tag |
|---|---|---|---|
| Client MCP WanGP (initialisation, RPC Streamable HTTP, suivi de progression, correspondance des phases) | `electron/lib/wan2gpMcp.js` (193 lignes) | Nouveau fournisseur `wan2gp` dans `server/src/video.ts`, adresse MCP sur la machine GPU du propriétaire : **vidéo gratuite** (Wan 2.1/2.2, Hunyuan 1.5, LTX-2) | REUSE |
| Catalogue Wan2GP (model_type, VRAM, résolutions) et contrôle de disponibilité | `electron/lib/wan2gpCatalog.js`, `wan2gpModelAvailability.js` | Liste des modèles locaux proposés au bot | REUSE |
| Analyse de la sortie de `wgp.py` (progression, résumé d'échec) | `electron/lib/wan2gpOutput.js` | Si Wan2GP tourne sur le bureau Linux du bot (GPU requis) | REUSE |
| Boucle d'interrogation : 5xx relancé, statuts succès/échec, remboursement signalé | `packages/studio/src/utils/generationLifecycle.js` | Comparer avec `video.ts` ; reprendre l'idée du message de remboursement | REUSE (petit) |
| Persistance des travaux en cours | `src/lib/pendingJobs.js` (33 lignes) | Idée : `request_id` gardé côté serveur dans `tool_spend` | IDEA |
| Liste de mots caméra (objectif, focale, ouverture → mots du prompt) | `src/lib/promptUtils.js` | Aide au prompt de `video_generate` (texte réécrit, **pas** les images `public/assets/cinema/*`) | REUSE (texte court) / IDEA |
| Description des réglages par modèle (durée, format, résolution, nombre d'images max) | `packages/studio/src/modelCapabilities.js`, `imageInputContracts.js` | Modèle de schéma pour exposer les réglages par fournisseur | IDEA |
| Moteur local d'images sd.cpp (téléchargement, chemins, lancement) | `electron/lib/localInference*.js` | Option pour le compagnon ou le bureau : image gratuite. **Ajouter sha256** avant de l'utiliser | REUSE (avec correctif) |
| Sélecteur multi-images avec numéros d'ordre | `src/components/UploadPicker.js` | Choisir des références dans la bibliothèque du bot | IDEA |

### 4.2 Comment le brancher

1. **Fournisseur dans le studio et dans `video_generate`**. Étendre `VideoProviderId` avec `wan2gp` (local) et éventuellement `muapi` (voir 4.3). Choix du fournisseur et du modèle exposés à l'outil (`provider`, `model`, `resolution`), en gardant la bascule actuelle.
2. **Clé du propriétaire, jamais celle de l'opérateur en mode hébergé**. Nouveau type « fournisseur média » par compte : formulaire Réglages → Création, jeton dans le coffre lié à l'hôte (même règle que `apiconnectors.ts`), jamais visible par le bot. En mode hébergé, refuser toute clé MuAPI ou média de l'opérateur pour ce chemin. L'adresse Wan2GP MCP est une donnée du compte et ne passe que par `guardedFetch` (LAN autorisé seulement pour ce fournisseur, sur choix explicite du propriétaire).
3. **Prix annoncé et accord avant de dépenser**. Avant chaque appel payant : estimation (table par modèle et par durée ; pour MuAPI, appel `POST /api/v1/models/{endpoint}/estimate-cost` s'il est retenu), carte avec le prix, réservation de ce montant (jamais `0`), puis règlement au coût réel. « Toujours » seulement en dessous d'un seuil fixé par le propriétaire. Wan2GP : 0 $, pas de carte d'argent.
4. **Étiquette IA gardée** : `labelAiVideo`/`labelAiImage` sur toute sortie de fournisseur, y compris `media_save` ; `aiLabel` forcé dans un montage qui utilise un clip généré.
5. **Consentement gardé** : toute action image→vidéo, lip sync, recast ou motion transfer à partir de la photo ou de la vidéo d'une personne passe par `cloneConsent`. Élargir `CLONE_ACTION` et ajouter un champ « personne réelle ? » à l'outil.
6. **Reprise** : `request_id` gardé en base, reprise au démarrage, aucune double facturation (idempotence déjà en place).

### 4.3 Exclu (à ne pas reprendre)

- Tous les endpoints `*watermark-remover*` et l'app « ClearMark ».
- Les profils et modèles « spicy », les modes « no filter », le texte publicitaire « uncensored ».
- Body Swap, Recast, objects_swap, AI Influencer, lip sync sur un tiers **sans** carte de consentement.
- Midjourney et tout endpoint sans API officielle documentée du fournisseur. **MuAPI lui-même est un revendeur dont l'origine des modèles n'est pas vérifiable** : au mieux, connecteur facultatif, avec la clé du propriétaire, liste blanche limitée aux modèles open-weight (Wan, LTX, Hunyuan, Qwen, Flux schnell/dev selon licence), et un avertissement « service tiers revendeur ». Pour les modèles propriétaires, préférer les API officielles (xAI, Gemini, Kling, MiniMax, ByteDance ModelArk…).
- Les vignettes et vidéos des CDN MuAPI, les textes du README, le nom et le logo du produit.
- La clé en `localStorage` et le relais Next.js ouvert.

---

## 5. À faire, par ordre de valeur

1. ~~Réserver au moins `DEFAULT_MAX_COST_USD` quand le prix vidéo est inconnu, au lieu de `0` (`tools.ts:395`). **S**~~ — **Fait 23/11** : plafond par fournisseur et par durée (`mediacost.ts`).
2. ~~Mettre l'étiquette IA sur les vidéos et images de `media_save` (Higgsfield et autres apps). **S**~~ — **Fait 23/11** (`aiprovenance.ts`, provenance existante gardée).
3. ~~Ajouter une approbation et une réservation à `image_generate` (aujourd'hui aucune). **S**~~ — **Fait 23/11** (`agent/tools-media.ts`).
4. ~~Élargir `CLONE_ACTION` (`recast`, `body_swap`, `motion_control`, `objects_swap`, `replace_character`) et tester les endpoints `api_send`. **S**~~ — **Fait 23/11** (`agent/consent.ts`, + `real_person`).
5. Forcer `aiLabel` quand un montage contient un clip généré. **S**
6. ~~Clé vidéo et image du propriétaire par compte (formulaire et coffre), prioritaire, obligatoire en hébergé byok. **M**~~ — **Fait 23/11** (`mediakeys.ts`, Réglages → Clés → Création ; compte réel à essayer).
7. ~~Fournisseur gratuit Wan2GP par MCP (reprise MIT de `wan2gpMcp.js` + catalogue). **M**~~ — **Fait 23/11** (`wan2gp.ts`, Relais `gpu.http` ou adresse ; vrai Wan2GP à essayer).
8. ~~Prix estimé affiché avant **chaque** génération au-delà d'un seuil, table de prix par modèle. **M**~~ — **Fait 23/11** (plafonds par fournisseur, « Toujours » seulement ≤ 0,10 $ connu ; pas de table de prix par modèle copiée).
9. Garder le `request_id` et reprendre le suivi après un redémarrage ou un délai dépassé (pas de vidéo payée perdue). **M** — **Fait pour Wan2GP 23/11** (`mediajobs.ts`) ; reste : xAI.
10. Retouche d'image avec image(s) d'entrée (`images/edits` officiel). **M**
11. Plusieurs références, image de fin et prolongation pour les fournisseurs officiels qui les documentent. **M**
12. Panneau « Générer un clip » dans le Studio (prompt, réglages, prix, résultat dans les médias du montage). **M**
13. AI Clipping local (transcription, choix de passages, découpe ffmpeg). **M**
14. ~~Aide « mots caméra » pour les prompts vidéo. **S**~~ — **Fait 23/11** (`camerawords.ts`).
15. Option moteur image local sd.cpp avec vérification sha256. **L**
16. Agrandissement d'image ou de vidéo par API officielle. **M**

---

## 6. Non vérifié

- Le contenu et les licences des sous-modules (Vibe-Workflow, Open-Poe-AI, Open-AI-Design-Agent) : non clonés.
- Les conditions d'utilisation de MuAPI et l'origine réelle de ses modèles (comptes officiels ou non) ; seule la page de prix a été lue.
- La licence de Wan2GP et celles des poids Z-Image.
- Les tests Sklubot : non lancés (interdit par la consigne). Les fichiers de test cités ont été repérés par grep ; seuls `ai-video-label.test.ts` et `security-lot1.test.ts:107` ont été ouverts.
- Le comportement réel des écrans Sklubot (aucune capture prise).
- La qualité ou la vitesse réelles de Wan2GP et sd.cpp (rien n'a été exécuté).
