"""
bot/chatbot_interface.py  — UPDATED for real bot
"""

import logging
import httpx
import os
import re
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from typing import Optional, Tuple

load_dotenv()
logger = logging.getLogger(__name__)

# ── Set this in your .env ────────────────────────────────────────────────────
# CHATBOT_API_URL=http://localhost:3000   ← the Node.js bot's base URL
# ─────────────────────────────────────────────────────────────────────────────
CHATBOT_API_URL = os.getenv("CHATBOT_API_URL", "http://localhost:3000")




async def _init_session() -> str:
    """Create a new chat session. Returns sessionId."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(f"{CHATBOT_API_URL}/api/chat/init", json={})
        res.raise_for_status()
        data = res.json()
        return data["sessionId"]


async def _get_session_id(session_id: Optional[str] = None) -> str:
    """Return existing session or create a new one."""
    if not session_id:
        session_id = await _init_session()
        logger.info(f"New chat session created: {session_id}")
    return session_id


def _html_to_plain_text(html: str) -> str:
    """
    Strip HTML tags from bot reply so TTS reads clean text using BeautifulSoup.
    """
    if not html:
        return ""
    
    soup = BeautifulSoup(html, "html.parser")
    
    # Format list items as bullets
    for li in soup.find_all("li"):
        li.insert_before("• ")
        li.insert_after("\n")
        
    text = soup.get_text(separator="\n", strip=True)
    # Clean up excessive newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


async def get_bot_response(user_message: str, current_session: Optional[str] = None, language: Optional[str] = None) -> Tuple[str, str]:
    """
    Send a message to the real bot and return plain-text response and session_id.
    Called with English text, returns (English text, session_id).
    """
    session_id = await _get_session_id(current_session)

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            payload = {
                "sessionId": session_id,
                "message": user_message,
            }
            if language:
                payload["language"] = language
                
            res = await client.post(
                f"{CHATBOT_API_URL}/api/chat/message",
                json=payload
            )
            res.raise_for_status()
            data = res.json()

        html_reply = data.get("reply", "")
        plain_reply = _html_to_plain_text(html_reply)
        logger.info(f"Bot reply: '{plain_reply[:80]}...'")
        return plain_reply, session_id

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            # Session expired — reset and retry once
            logger.warning("Session not found, resetting...")
            return await get_bot_response(user_message, None)
        raise RuntimeError(f"Bot API error: {e.response.status_code}")

    except httpx.TimeoutException:
        raise RuntimeError(
            "The chatbot server took too long to respond. "
            "If using the local fallback model, it may take over a minute to generate Marathi/Hindi text."
        )
    except httpx.RequestError:
        raise RuntimeError(
            "Could not connect to the chatbot server. "
            "Make sure the Node.js bot is running on "
            f"{CHATBOT_API_URL}"
        )