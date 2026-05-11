"""
services/translate.py
────────────────────────────────────────────────────────────
Free Translation using deep-translator (Google Translator API).
Handles:
  1. Language detection from text
  2. Translation to English (for chatbot processing)
  3. Translation back to original language (for user response)
────────────────────────────────────────────────────────────
"""

import logging
from deep_translator import GoogleTranslator, single_detection

logger = logging.getLogger(__name__)

# ── Language display names (for UI/logging) ───────────────────────────────────
LANGUAGE_NAMES = {
    "mr": "Marathi",
    "hi": "Hindi",
    "en": "English",
}

NORMALIZE_LANG = {
    "mr-IN": "mr",
    "hi-IN": "hi",
    "en-IN": "en",
    "en-US": "en",
    "en-GB": "en",
}

def _normalize(lang_code: str) -> str:
    """Strip region suffix: 'mr-IN' → 'mr', 'hi-IN' → 'hi'"""
    return NORMALIZE_LANG.get(lang_code, lang_code.split("-")[0].lower())

async def detect_language(text: str) -> dict:
    # deep-translator single_detection Uses Google detect API
    try:
        lang_code = single_detection(text, api_key=None) # doesn't need key
    except Exception as e:
        logger.warning(f"Detection failed: {e}. Defaulting to English.")
        lang_code = "en"
    
    lang_code = _normalize(lang_code)
    logger.info(f"Detected language: {lang_code}")
    
    return {
        "language": lang_code,
        "language_name": LANGUAGE_NAMES.get(lang_code, lang_code),
        "confidence": 1.0,  # Free layer doesn't return confidence easily
    }

async def translate_to_english(text: str, source_language: str) -> dict:
    source = _normalize(source_language)
    if source == "en":
        return {
            "original_text": text,
            "translated_text": text,
            "source_language": "en",
            "target_language": "en",
            "was_translated": False,
        }
    
    try:
        translator = GoogleTranslator(source=source, target='en')
        translated = translator.translate(text)
    except Exception as e:
        logger.error(f"Translation to English failed: {e}")
        translated = text
        
    logger.info(f"Translated ({source} → en): '{text[:60]}...' → '{translated[:60]}...'")
    
    return {
        "original_text": text,
        "translated_text": translated,
        "source_language": source,
        "target_language": "en",
        "was_translated": True,
    }

async def translate_from_english(text: str, target_language: str) -> dict:
    target = _normalize(target_language)
    if target == "en":
        return {
            "original_text": text,
            "translated_text": text,
            "source_language": "en",
            "target_language": "en",
            "was_translated": False,
        }
    
    try:
        translator = GoogleTranslator(source='en', target=target)
        translated = translator.translate(text)
    except Exception as e:
        logger.error(f"Translation from English failed: {e}")
        translated = text
        
    logger.info(f"Translated (en → {target}): '{text[:60]}...' → '{translated[:60]}...'")
    return {
        "original_text": text,
        "translated_text": translated,
        "source_language": "en",
        "target_language": target,
        "was_translated": True,
    }
