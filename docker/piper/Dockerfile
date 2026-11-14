# Piper text-to-speech HTTP server (OHF-Voice/piper1-gpl), for Sklubot's server voice (compose profile "voice").
# Interface: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md — POST /synthesize {"text": …} → WAV.
# Pinned: Python base image and piper-tts version. The voice is downloaded once at build time.
FROM python:3.12.12-slim-bookworm
ARG PIPER_VERSION=1.8.0
ARG PIPER_VOICE=fr_FR-siwis-medium
RUN pip install --no-cache-dir "piper-tts[http]==${PIPER_VERSION}"
WORKDIR /voices
RUN python3 -m piper.download_voices "${PIPER_VOICE}"
ENV PIPER_VOICE=${PIPER_VOICE}
EXPOSE 5000
USER nobody
CMD ["sh", "-c", "python3 -m piper.http_server -m \"$PIPER_VOICE\" --data-dir /voices --host 0.0.0.0 --port 5000"]
