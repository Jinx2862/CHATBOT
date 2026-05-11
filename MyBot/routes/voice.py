"""
routes/voice.py
────────────────────────────────────────────────────────────
Main voice pipeline route.

POST /api/voice
  - Accepts audio file upload from browser
  - Runs the full STT → Translate → Bot → Translate → TTS pipeline
  - Returns MP3 audio + JSON metadata

POST /api/voice/text
  - Accepts plain text (typed input as fallback)
  - Runs Translate → Bot → Translate → TTS pipeline (no STT)
  - Returns MP3 audio + JSON metadata

GET /api/voice/languages
  - Returns list of supported languages
────────────────────────────────────────────────────────────
"""

import logging
import base64
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Tuple

from services.stt import transcribe_audio
from services.translate import detect_language, translate_to_english, translate_from_english
from services.tts import text_to_speech
from bot.chatbot_interface import get_bot_response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])

SUPPORTED_LANGUAGES = {
    "mr": "Marathi",
    "hi": "Hindi",
    "en": "English",
}


# ── Request/Response models ───────────────────────────────────────────────────

class TextChatRequest(BaseModel):
    text: str
    language: Optional[str] = None   # BCP-47 code. If None, auto-detects
    session_id: Optional[str] = None # Current session ID


class VoiceResponse(BaseModel):
    # Audio response (base64 encoded MP3)
    audio_base64: str
    audio_mime_type: str = "audio/mpeg"
    session_id: Optional[str] = None  # Session to track history

    # Text at each stage (useful for UI display & debugging)
    original_transcript: str          # What user said (in their language)
    english_query: str                # What was sent to the bot (English)
    english_answer: str               # What the bot replied (English)
    translated_answer: str            # Final answer in user's language

    # Language metadata
    detected_language: str            # 'mr', 'hi', 'en'
    detected_language_name: str       # 'Marathi', 'Hindi', 'English'
    stt_confidence: Optional[float]   # STT confidence score (0–1)


# ── Route 1: Voice input ──────────────────────────────────────────────────────

@router.post("", response_model=VoiceResponse)
@router.post("/", response_model=VoiceResponse)
async def voice_chat(
    audio: UploadFile = File(..., description="Audio file from browser (webm/ogg/wav)"),
    language: Optional[str] = Form(None, description="BCP-47 language hint (mr/hi/en)"),
    session_id: Optional[str] = Form(None, description="Current session ID to maintain history"),
):
    """
    Full voice pipeline:
    Audio → STT → Detect Lang → Translate → Bot → Translate → TTS → Audio
    """
    logger.info(f"Voice request received | file={audio.filename} | "
                f"content_type={audio.content_type} | lang_hint={language}")

    # ── Step 1: Read uploaded audio ───────────────────────────────────────────
    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")
        if len(audio_bytes) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(status_code=413, detail="Audio file too large (max 10MB).")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read audio file: {e}")

    # Determine audio format from content type
    audio_format = _get_audio_format(audio.content_type or "")

    # ── Step 2: Speech-to-Text ────────────────────────────────────────────────
    try:
        stt_result = transcribe_audio(
            audio_bytes=audio_bytes,
            language_code=language,
            audio_format=audio_format,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Audio processing failed: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))

    transcript = stt_result["transcript"]
    stt_language = stt_result["detected_language"]  # e.g. 'mr-IN'
    stt_confidence = stt_result["confidence"]

    logger.info(f"STT result: '{transcript}' [{stt_language}] ({stt_confidence})")

    # ── Step 3: Detect language (use STT result, or run detection on transcript) ──
    if stt_language:
        lang_result = {
            "language": _normalize_lang(stt_language),
            "language_name": SUPPORTED_LANGUAGES.get(
                _normalize_lang(stt_language), stt_language
            ),
        }
    else:
        lang_result = await detect_language(transcript)

    user_language = lang_result["language"]   # 'mr', 'hi', or 'en'
    user_language_name = lang_result["language_name"]

    # ── Steps 4–7: The core pipeline ─────────────────────────────────────────
    english_query, english_answer, translated_answer, audio_bytes_out, new_session_id = \
        await _run_core_pipeline(transcript, user_language, session_id)

    # ── Step 8: Encode audio as base64 for JSON response ─────────────────────
    audio_b64 = base64.b64encode(audio_bytes_out).decode("utf-8")

    return VoiceResponse(
        audio_base64=audio_b64,
        session_id=new_session_id,
        original_transcript=transcript,
        english_query=english_query,
        english_answer=english_answer,
        translated_answer=translated_answer,
        detected_language=user_language,
        detected_language_name=user_language_name,
        stt_confidence=stt_confidence,
    )


# ── Route 2: Text input (typed fallback, no STT needed) ──────────────────────

@router.post("/text", response_model=VoiceResponse)
async def text_chat(request: TextChatRequest):
    """
    Text → Translate → Bot → Translate → TTS → Audio
    Useful as a fallback when mic is not available.
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    logger.info(f"Text request: '{text}' | lang={request.language}")

    # Detect language if not provided
    if request.language:
        user_language = _normalize_lang(request.language)
    else:
        lang_result = await detect_language(text)
        user_language = lang_result["language"]

    user_language_name = SUPPORTED_LANGUAGES.get(user_language, user_language)

    # Run core pipeline
    english_query, english_answer, translated_answer, audio_bytes_out, new_session_id = \
        await _run_core_pipeline(text, user_language, request.session_id)

    audio_b64 = base64.b64encode(audio_bytes_out).decode("utf-8")

    return VoiceResponse(
        audio_base64=audio_b64,
        session_id=new_session_id,
        original_transcript=text,
        english_query=english_query,
        english_answer=english_answer,
        translated_answer=translated_answer,
        detected_language=user_language,
        detected_language_name=user_language_name,
        stt_confidence=None,
    )


# ── Route 3: Supported languages ─────────────────────────────────────────────

@router.get("/languages")
async def get_supported_languages():
    """Returns the list of supported languages."""
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }


# ── Core pipeline (shared by both routes) ────────────────────────────────────

async def _run_core_pipeline(
    user_text: str,
    user_language: str,
    session_id: Optional[str] = None,
) -> Tuple[str, str, str, bytes, str]:
    """
    Shared pipeline:
      1. Pass user text directly to bot in native language
      2. Get bot native response
      3. Convert to speech directly

    Returns:
        (english_query, english_answer, translated_answer, mp3_audio_bytes, session_id)
        Note: We return native text for all fields to maintain schema structure for frontend.
    """

    # Step 1: Get bot response natively
    try:
        native_answer, active_session_id = await get_bot_response(user_text, session_id, user_language)
        logger.info(f"Bot native answer: '{native_answer[:80]}...'")
    except Exception as e:
        logger.error(f"Bot error: {e}")
        raise HTTPException(status_code=502, detail=f"Chatbot error: {e}")

    # Step 2: Text to Speech
    try:
        audio_bytes = text_to_speech(native_answer, user_language)
    except Exception as e:
        logger.error(f"TTS failed: {e}")
        raise HTTPException(status_code=502, detail=f"Text-to-speech error: {e}")

    # Return native_answer for English fields so UI doesn't break
    return user_text, native_answer, native_answer, audio_bytes, active_session_id


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_audio_format(content_type: str) -> str:
    """Map MIME type to pydub format string."""
    mapping = {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/wave": "wav",
        "audio/mpeg": "mp3",
        "audio/mp4": "mp4",
        "audio/x-m4a": "m4a",
        "video/webm": "webm",   # Some browsers send this for audio/webm
    }
    return mapping.get(content_type.lower().split(";")[0].strip(), "webm")


def _normalize_lang(code: str) -> str:
    """'mr-IN' → 'mr', 'hi-IN' → 'hi', 'en-US' → 'en'"""
    mapping = {
        "mr-IN": "mr", "hi-IN": "hi",
        "en-IN": "en", "en-US": "en", "en-GB": "en",
    }
    return mapping.get(code, code.split("-")[0].lower())
