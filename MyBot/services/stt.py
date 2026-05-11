"""
services/stt.py
────────────────────────────────────────────────────────────
Speech-to-Text service using Sarvam AI (Saaras v3).
Converts an audio blob (webm/wav/ogg/mp4) into text.
Saaras v3 natively accepts all browser audio formats —
no pydub conversion needed.
────────────────────────────────────────────────────────────
"""

import io
import os
import logging
from sarvamai import SarvamAI
from sarvamai.core import ApiError

logger = logging.getLogger(__name__)

# BCP-47 short code → Sarvam full language code
LANGUAGE_CODE_MAP = {
    "mr": "mr-IN",
    "hi": "hi-IN",
    "en": "en-IN",
    "en-IN": "en-IN",
    "en-US": "en-IN",  # Sarvam uses en-IN for all English variants
}

def _get_client() -> SarvamAI:
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError(
            "SARVAM_API_KEY is not set. "
            "Get your key at https://dashboard.sarvam.ai and add it to MyBot/.env"
        )
    return SarvamAI(api_subscription_key=api_key)


def transcribe_audio(
    audio_bytes: bytes,
    language_code: str | None = None,
    audio_format: str = "webm",
) -> dict:
    """
    Transcribe audio bytes using Sarvam AI Saaras v3.

    Sarvam accepts webm, ogg, mp4, wav, mp3 directly —
    no format conversion needed.

    Returns:
        {
            "transcript": str,
            "detected_language": str,   # e.g. "mr-IN"
            "confidence": float         # always 0.99 (Sarvam REST doesn't return it)
        }
    """
    # Resolve language hint
    sarvam_lang = LANGUAGE_CODE_MAP.get(language_code or "mr", "mr-IN")

    # Map format to a sensible MIME filename extension for the upload
    ext_map = {
        "webm": "webm", "ogg": "ogg", "mp4": "mp4",
        "wav": "wav", "mp3": "mp3", "m4a": "m4a",
    }
    ext = ext_map.get(audio_format, "webm")
    filename = f"audio.{ext}"

    logger.info(f"Sending audio to Sarvam Saaras v3 [lang={sarvam_lang}] ({len(audio_bytes)} bytes)")

    client = _get_client()

    try:
        response = client.speech_to_text.transcribe(
            file=(filename, io.BytesIO(audio_bytes)),
            model="saaras:v3",
            mode="transcribe",
            language_code=sarvam_lang,
        )
    except ApiError as e:
        if e.status_code == 422:
            raise RuntimeError(
                "Sarvam STT could not process audio. "
                "The audio may be too short, silent, or in an unsupported format."
            )
        elif e.status_code == 403:
            raise RuntimeError("Invalid SARVAM_API_KEY. Check your credentials.")
        elif e.status_code == 429:
            raise RuntimeError("Sarvam API rate limit exceeded. Please try again shortly.")
        else:
            raise RuntimeError(f"Sarvam STT error {e.status_code}: {e.body}")
    except Exception as e:
        raise RuntimeError(f"Sarvam STT request failed: {e}")

    transcript = response.transcript or ""
    detected = getattr(response, "language_code", sarvam_lang) or sarvam_lang

    logger.info(f"Sarvam STT transcript: '{transcript}' [detected={detected}]")

    return {
        "transcript": transcript,
        "detected_language": detected,
        "confidence": None,  # Sarvam REST API does not return a confidence score
    }
