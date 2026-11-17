# Piper text-to-speech HTTP server (OHF-Voice/piper1-gpl, GPL-3.0, run as its own service), for Sklubot's server voice
# (on by default in docker-compose.coolify.yml / docker-compose.vps.yml, internal network "voice" only).
# Interface: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md — POST /synthesize {"text": …} → WAV.
# Pinned: Python base image and piper-tts version. The voice is downloaded once at build time (rhasspy/piper-voices).
# Default voice fr_FR-siwis-medium: one female French (France) speaker, 22.05 kHz; dataset SIWIS (University of Edinburgh
# DataShare 10283/2353), licence CC BY 4.0 — model card: https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD
# Another voice: docker compose build --build-arg PIPER_VOICE=en_US-lessac-medium piper (check its MODEL_CARD licence).
# VOICE_LOCAL=0 (SKLUBOT_VOICE_LOCAL=0): the server stays idle (a few MB) instead of loading the voice.
FROM python:3.12.12-slim-bookworm
ARG PIPER_VERSION=1.8.0
ARG PIPER_VOICE=fr_FR-siwis-medium
RUN pip install --no-cache-dir "piper-tts[http]==${PIPER_VERSION}"
WORKDIR /voices
RUN python3 -m piper.download_voices "${PIPER_VOICE}"
ENV PIPER_VOICE=${PIPER_VOICE}
EXPOSE 5000
USER nobody
CMD ["sh", "-c", "if [ \"$VOICE_LOCAL\" = 0 ]; then echo 'SKLUBOT_VOICE_LOCAL=0: idle.'; exec sleep infinity; fi; exec python3 -m piper.http_server -m \"$PIPER_VOICE\" --data-dir /voices --host 0.0.0.0 --port 5000"]
