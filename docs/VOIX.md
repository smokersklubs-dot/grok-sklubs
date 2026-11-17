# Voix des bots

Chaque bot répond en appel avec **sa propre voix**, sans réglage. Ce document liste les voix gratuites livrées avec
Sklubot, leurs licences, la mémoire qu'elles prennent, et comment donner des voix Fish Audio aux bots.

## Comment un bot reçoit sa voix

1. **Voix choisie** dans les réglages du bot (Fish Audio, Kokoro ou une voix gratuite Piper) : c'est elle.
2. Sinon, **voix automatique gratuite** (`server/src/voice/autovoice.ts`) : une voix de **Kokoro** d'abord (meilleure
   qualité, quand le Kokoro du serveur répond), puis de **Piper**, différente pour chaque bot du compte :
   - **stable** : tirée de l'identifiant du bot (empreinte FNV-1a), les bots étant pris dans l'ordre de création, donc un
     nouveau bot ne change jamais la voix des autres ;
   - **distincte** : une voix déjà prise par un autre bot du compte est sautée ; une fois toutes prises, les mêmes voix
     reviennent avec un autre débit et une autre expressivité (`length_scale`, `noise_scale`, `noise_w_scale`) ;
   - **féminine ou masculine** selon un indice : prénom du bot (liste de prénoms courants), libellé (« assistante »,
     « directrice »…), ou nom de la voix du navigateur qu'il avait ; sans indice, au hasard (stable) ;
   - **langue** : celle du bot, sinon celle du compte. Français : la seule voix française de Kokoro (`ff_siwis`) puis
     les voix françaises de Piper ; anglais : les voix Kokoro (af_/am_/bf_/bm_) puis celles de Piper ; espagnol,
     italien, portugais, hindi, japonais, mandarin : les voix Kokoro ; une autre langue prend celle du compte ;
   - **Kokoro absent ou en panne** : les bots reçoivent des voix Piper (même règle) jusqu'à son retour — vérifié en
     arrière-plan toutes les 30 secondes, comme whisper et Piper.
   La voix automatique s'applique tant que le compte parle avec Piper (le défaut) et qu'aucune voix unique n'a été tapée
   dans Réglages → Voix. Rien n'est écrit en base : supprimer un bot peut seulement changer la voix d'un bot créé après
   lui et qui avait dû céder sa voix à celui-ci.
3. Sinon, la voix par défaut du compte (Réglages → Voix).

## Kokoro (actif par défaut)

Kokoro-FastAPI (Apache-2.0), image CPU officielle épinglée `ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0`, modèle
Kokoro-82M et ses voix (Apache-2.0, <https://huggingface.co/hexgrad/Kokoro-82M>) inclus dans l'image. Voix données
automatiquement, meilleures d'abord (notes de `VOICES.md` du modèle) : anglais féminines af_heart, af_bella,
af_nicole, bf_emma, af_aoede, af_kore, af_sarah, af_alloy, af_nova, bf_isabella, af_sky, bf_alice, bf_lily ; anglais
masculines am_fenrir, am_michael, am_puck, bm_fable, bm_george, bm_lewis, am_echo, am_eric, am_liam, am_onyx,
bm_daniel ; français ff_siwis (données SIWIS, CC BY 4.0) ; espagnol ef_dora, em_alex ; italien if_sara, im_nicola ;
portugais pf_dora, pm_alex ; hindi hf_alpha, hf_beta, hm_omega, hm_psi ; japonais jf_alpha, jf_gongitsune, jf_nezumi,
jf_tebukuro, jm_kumo ; mandarin zf_xiaobei, zf_xiaoni, zf_xiaoxiao, zf_xiaoyi, zm_yunjian, zm_yunxi, zm_yunxia,
zm_yunyang. Écartées : les voix « santa ».

Service `kokoro` des fichiers compose : sans profil, réseau interne `voice` seulement, `read_only` avec des tmpfs
pour `/tmp` (mélanges de voix), `/app/api/temp_files` (lecteur web de l'image) et le dossier personnel, aucun privilège,
`pids_limit` 256, `cpu_shares` 512, `DOWNLOAD_MODEL=false` et `HF_HUB_OFFLINE=1` (rien n'est téléchargé : il n'a pas
Internet). Veille : `SKLUBOT_KOKORO=0` (Kokoro seul) ou `SKLUBOT_VOICE_LOCAL=0` (toute la voix locale) — le conteneur
dort au lieu de charger le modèle, et l'application n'utilise plus son adresse. `deploy/install.sh` et
`deploy/update.sh` mettent `SKLUBOT_KOKORO=0` sous 3,5 Go de mémoire.

## Voix gratuites livrées (Piper, `docker/piper`)

Licences relues sur chaque fiche `MODEL_CARD` de <https://huggingface.co/rhasspy/piper-voices> le 17/11/2026. Seules
des licences qui permettent l'usage commercial sont livrées.

| Modèle | Locuteurs | Licence | Données | Fiche |
|---|---:|---|---|---|
| `fr_FR-siwis-medium` (voix par défaut) | 1 (F) | CC BY 4.0 | SIWIS, University of Edinburgh (DataShare 10283/2353) ; affiné depuis hifi_tts_92 (Hi-Fi TTS, CC BY 4.0) | [fiche](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD) |
| `fr_FR-upmc-medium` | 2 (Jessica F, Pierre M) | CC BY-SA 4.0 | UPMC « pierre », MaryTTS (github.com/marytts/upmc-pierre-data) | [fiche](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD) |
| `fr_FR-mls-medium` | 125 | CC BY 4.0 | Multilingual LibriSpeech (openslr.org/94) | [fiche](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/mls/medium/MODEL_CARD) |
| `en_GB-vctk-medium` | 109 | CC BY 4.0 | CSTR VCTK, University of Edinburgh | [fiche](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/vctk/medium/MODEL_CARD) |

Moteur : Piper (`piper-tts` 1.8.0, OHF-Voice/piper1-gpl, GPL-3.0), lancé comme service séparé : Sklubot ne fait que
lui envoyer du texte en HTTP.

**Partage à l'identique (CC BY-SA, `fr_FR-upmc-medium`)** : la condition porte sur le modèle et ses dérivés. Sklubot
redistribue le modèle tel quel, avec sa licence et cette attribution ; la parole produite sert d'audio dans un appel et
ne fait pas de Sklubot un dérivé du modèle. (Lecture de la licence, pas un avis juridique.)

**Écartés** : `fr_FR-tom-medium` (AGPLv3), `en_US-ryan-*` et `en_GB-semaine-medium` (CC BY-NC-SA : pas d'usage
commercial), `en_US-lessac-*` (licence Blizzard 2013, recherche). `fr_FR-gilles-low` (CC0) est permis mais pas livré
(qualité basse, 16 kHz, et chaque modèle coûte de la mémoire) ; l'ajouter avec `PIPER_VOICES` si besoin.

### Les 36 voix du catalogue (`server/src/voice/piper.ts`)

Les prénoms sont inventés (ce ne sont pas ceux des lecteurs des corpus). Le genre a été classé d'après la hauteur
médiane de la voix (F0) mesurée sur une phrase synthétisée : moins de 125 Hz → masculine, plus de 190 Hz → féminine ;
les locuteurs entre les deux ne sont pas retenus.

- **Français, féminines** : Siwis (siwis), Jessica (upmc #0), Camille, Léa, Chloé, Manon, Inès, Margaux, Juliette,
  Alix (mls #19, 69, 18, 3, 14, 62, 22, 25).
- **Français, masculines** : Pierre (upmc #1), Antoine, Hugo, Louis, Mathis, Gabriel, Arthur, Jules, Raphaël, Victor
  (mls #6, 52, 80, 36, 16, 13, 0, 10, 42).
- **Anglais (britannique), féminines** : Emma, Olivia, Grace, Sophie, Lucy, Ella, Amelia, Isla (vctk #74, 90, 3, 17,
  18, 11, 6, 1).
- **Anglais (britannique), masculines** : Oliver, Harry, George, Jack, Noah, Leo, Henry, Thomas (vctk #102, 97, 20,
  26, 12, 7, 95, 60).

### Requête envoyée à Piper

`POST /synthesize` avec `{ text, voice, speaker_id?, length_scale?, noise_scale?, noise_w_scale? }` (champs de
`docs/API_HTTP.md` et `src/piper/http_server.py` de piper1-gpl au tag v1.8.0). Un seul processus sert tous les
modèles : chacun est chargé à la première phrase qui le nomme, puis reste en mémoire. Un nom inconnu retombe sur la
voix par défaut. Sklubot lit `GET /voices` (toutes les 10 minutes) pour ne donner que des voix présentes.

### Mémoire (mesurée, CPU, piper-tts 1.8.0)

| État | RSS |
|---|---:|
| Démarré, voix par défaut chargée | ≈ 160 Mo |
| Après une première phrase | ≈ 210 Mo |
| + `fr_FR-upmc-medium` | ≈ 370 Mo |
| + `fr_FR-mls-medium` | ≈ 560 Mo |
| + `en_GB-vctk-medium` (les quatre) | ≈ 690 Mo |
| Les quatre, après de longs textes | ≈ 890 Mo |

Kokoro : ≈ 1 à 1,5 Go en marche (estimation : modèle de 82 M paramètres + PyTorch CPU ; non mesuré ici), plafond
`KOKORO_MEM_LIMIT` 2 Go. **Toute la voix** (whisper `base` 0,3 à 0,5 Go + Piper 0,2 à 0,9 Go + Kokoro 1 à 1,5 Go) :
≈ 1,5 à 3 Go ; sans Kokoro ≈ 0,5 à 1,4 Go.

Plafond `PIPER_MEM_LIMIT` : 1200 Mo par défaut (il était de 768 Mo pour une seule voix). Un compte francophone n'utilise
en général que les trois modèles français (≈ 560 Mo). Image : ≈ 290 Mo de modèles. Moins de voix :
`docker compose -f docker-compose.vps.yml build --build-arg PIPER_VOICES="fr_FR-siwis-medium fr_FR-upmc-medium" piper`
(la première est la voix par défaut).

## Voix Fish Audio pour tous les bots (payant, en un clic)

Avec une clé Fish Audio enregistrée (Réglages → Voix), le bouton **« Donner une voix Fish à tous mes bots »** propose
une voix différente par bot, populaire, dans sa langue, et du même genre quand c'est possible
(`server/src/voice/fishbulk.ts`). Proposer ne fait que lire la bibliothèque publique (`GET /model`, gratuit) : **aucun
crédit n'est dépensé et rien n'est enregistré avant ta confirmation**. « Écouter » fabrique un court échantillon (un
clic = une petite dépense Fish Audio, comme dans le choix de voix d'un bot).

Sont écartées : les voix qui imitent une personne réelle ou un personnage protégé (célébrités, politiques,
streamers, personnages de dessins animés, de jeux ou de films, titres du type « Prénom Nom ») et les voix de fantaisie
(ASMR, cris, chant…). Sont préférées : les voix marquées conversation, professionnelle, narration, assistant, calme,
chaleureuse…

## API

Voir [API.md](API.md#server-mediated-voice-servervoice) : `GET /voice/bots`, `GET /voice/piper/voices`,
`POST /voice/fish/bulk/propose`, `POST /voice/fish/bulk/apply`, et `provider: "piper"` dans les routes de voix par bot.
