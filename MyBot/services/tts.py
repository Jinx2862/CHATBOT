"""
services/tts.py
────────────────────────────────────────────────────────────
Text-to-Speech service using Sarvam AI (Bulbul v3).
Converts a text string → WAV audio bytes.
Bulbul v3 supports 30+ natural-sounding human voices
for Indian languages including Marathi, Hindi, and English.
────────────────────────────────────────────────────────────
"""

import base64
import os
import logging
from sarvamai import SarvamAI
from sarvamai.core import ApiError

logger = logging.getLogger(__name__)

# Short code → Sarvam BCP-47 language code
LANGUAGE_CODE_MAP = {
    "mr": "mr-IN",
    "hi": "hi-IN",
    "en": "en-IN",
    "mr-IN": "mr-IN",
    "hi-IN": "hi-IN",
    "en-IN": "en-IN",
    "en-US": "en-IN",
}

# Default speakers per language — configurable via .env
# Override with: SARVAM_SPEAKER_MR, SARVAM_SPEAKER_HI, SARVAM_SPEAKER_EN
DEFAULT_SPEAKERS = {
    "mr-IN": "neha",   # natural female Marathi voice
    "hi-IN": "neha",   # natural female Hindi voice
    "en-IN": "neha",   # natural female English (Indian accent) voice
}

MAX_TTS_CHARS = 2000   # Bulbul v3 REST API supports up to 2500 chars


def _get_client() -> SarvamAI:
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError(
            "SARVAM_API_KEY is not set. "
            "Get your key at https://dashboard.sarvam.ai and add it to MyBot/.env"
        )
    return SarvamAI(api_subscription_key=api_key)


def _get_speaker(lang_code: str) -> str:
    """Return the configured speaker for this language, falling back to default."""
    env_key_map = {
        "mr-IN": "SARVAM_SPEAKER_MR",
        "hi-IN": "SARVAM_SPEAKER_HI",
        "en-IN": "SARVAM_SPEAKER_EN",
    }
    env_key = env_key_map.get(lang_code)
    if env_key:
        return os.getenv(env_key, DEFAULT_SPEAKERS.get(lang_code, "meera"))
    return DEFAULT_SPEAKERS.get(lang_code, "meera")


def text_to_speech(text: str, language_code: str) -> bytes:
    """
    Convert text to speech using Sarvam AI Bulbul v3.

    Args:
        text:          The text to speak (plain text, no HTML).
        language_code: Short code ('mr', 'hi', 'en') or BCP-47 ('mr-IN', etc.)

    Returns:
        Raw WAV audio bytes.
    """
    if not text or not text.strip():
        raise ValueError("Cannot convert empty text to speech.")

    # Normalize language code
    lang = language_code.split("-")[0].lower()
    sarvam_lang = LANGUAGE_CODE_MAP.get(language_code) \
               or LANGUAGE_CODE_MAP.get(lang) \
               or "en-IN"

    speaker = _get_speaker(sarvam_lang)

    # Truncate gracefully if over limit (Bulbul has a 2500-char max)
    text_to_send = text.strip()
    if len(text_to_send) > MAX_TTS_CHARS:
        text_to_send = text_to_send[:MAX_TTS_CHARS]
        # Find the last logical sentence break
        last_break = max(
            text_to_send.rfind("."),
            text_to_send.rfind("\n"),
            text_to_send.rfind("।"),
            text_to_send.rfind("?"),
            text_to_send.rfind("!")
        )
        if last_break > 0:
            text_to_send = text_to_send[:last_break+1]

    logger.info(
        f"Sarvam TTS: lang={sarvam_lang}, speaker={speaker}, "
        f"chars={len(text_to_send)}: '{text_to_send[:60]}...'"
    )

    client = _get_client()

    try:
        response = client.text_to_speech.convert(
            text=text_to_send,
            target_language_code=sarvam_lang,
            model="bulbul:v3",
            speaker=speaker,
        )
    except ApiError as e:
        if e.status_code == 403:
            raise RuntimeError("Invalid SARVAM_API_KEY. Check your credentials.")
        elif e.status_code == 429:
            raise RuntimeError("Sarvam API rate limit exceeded. Please try again shortly.")
        elif e.status_code == 422:
            raise RuntimeError(f"Sarvam TTS parameter error: {e.body}")
        else:
            raise RuntimeError(f"Sarvam TTS error {e.status_code}: {e.body}")
    except Exception as e:
        raise RuntimeError(f"Sarvam TTS request failed: {e}")

    # response.audios is a list of base64-encoded audio strings
    if not response.audios:
        raise RuntimeError("Sarvam TTS returned no audio data.")

    audio_bytes = base64.b64decode(response.audios[0])
    logger.info(f"Sarvam TTS: audio generated successfully ({len(audio_bytes)} bytes, WAV)")
    return audio_bytes
