# Piper text-to-speech HTTP server (OHF-Voice/piper1-gpl, GPL-3.0, run as its own service), for Sklubot's server voice
# (on by default in docker-compose.coolify.yml / docker-compose.vps.yml, internal network "voice" only).
# Interface (piper-tts 1.8.0, docs/API_HTTP.md and src/piper/http_server.py at tag v1.8.0):
#   POST /synthesize {"text", "voice"?, "speaker_id"?, "length_scale"?, "noise_scale"?, "noise_w_scale"?} → WAV;
#   GET /voices lists the models of --data-dir. ONE process serves every model below: a model is loaded the first time a
#   request names it ("voice"), then kept in memory; an unknown name falls back to the default voice (-m).
# Pinned: Python base image and piper-tts version. The voices are downloaded once at build time (rhasspy/piper-voices).
#
# Voices shipped (each MODEL_CARD checked on https://huggingface.co/rhasspy/piper-voices, 2026-11-17; commercial use
# allowed; list, speakers and attributions in docs/VOIX.md and server/src/voice/piper.ts):
#   fr_FR-siwis-medium  1 female speaker   CC BY 4.0     SIWIS (University of Edinburgh DataShare 10283/2353) — default
#   fr_FR-upmc-medium   2 speakers (F, M)  CC BY-SA 4.0  UPMC "pierre" (github.com/marytts/upmc-pierre-data)
#   fr_FR-mls-medium    125 speakers       CC BY 4.0     Multilingual LibriSpeech (openslr.org/94)
#   en_GB-vctk-medium   109 speakers       CC BY 4.0     CSTR VCTK corpus (University of Edinburgh)
# Not shipped: fr_FR-tom-medium (AGPLv3), en_US-ryan-*, en_GB-semaine-medium (CC BY-NC-SA, no commercial use).
#
# Memory (measured with piper-tts 1.8.0 on CPU, RSS): ~160 MB idle with the default voice, ~210 MB after its first
# sentence; each other model adds ~150-190 MB once a bot uses it (all four: ~690 MB, ~890 MB after long texts). Capped
# by PIPER_MEM_LIMIT in the compose files (default 1200m). Image: ~290 MB of models.
# Fewer voices (less disk and RAM): docker compose build --build-arg PIPER_VOICES="fr_FR-siwis-medium fr_FR-upmc-medium" piper
# (the first one is the default voice; bots are then only given voices of the models present — GET /voices).
# VOICE_LOCAL=0 (SKLUBOT_VOICE_LOCAL=0): the server stays idle (a few MB) instead of loading the voice.
FROM python:3.12.12-slim-bookworm
ARG PIPER_VERSION=1.8.0
ARG PIPER_VOICES="fr_FR-siwis-medium fr_FR-upmc-medium fr_FR-mls-medium en_GB-vctk-medium"
RUN pip install --no-cache-dir "piper-tts[http]==${PIPER_VERSION}"
WORKDIR /voices
# Word splitting of PIPER_VOICES is wanted here (one argument per voice).
RUN python3 -m piper.download_voices ${PIPER_VOICES} && set -- ${PIPER_VOICES} && echo "$1" > /voices/DEFAULT_VOICE
EXPOSE 5000
USER nobody
CMD ["sh", "-c", "if [ \"$VOICE_LOCAL\" = 0 ]; then echo 'SKLUBOT_VOICE_LOCAL=0: idle.'; exec sleep infinity; fi; v=\"${PIPER_VOICE:-$(cat /voices/DEFAULT_VOICE)}\"; exec python3 -m piper.http_server -m \"$v\" --data-dir /voices --host 0.0.0.0 --port 5000"]
