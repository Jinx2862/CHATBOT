"""
main.py
────────────────────────────────────────────────────────────
FastAPI application entry point.
Mounts the voice pipeline routes and serves the static frontend.
────────────────────────────────────────────────────────────
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from routes.voice import router as voice_router

# ── Load env vars ─────────────────────────────────────────────────────────────
load_dotenv()

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO if os.getenv("DEBUG", "true").lower() == "true" else logging.WARNING,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── App lifespan (startup/shutdown hooks) ─────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("━" * 60)
    logger.info("  Maitri Voice Chatbot — Starting up")
    logger.info(f"  API Key set: {'✅' if os.getenv('GOOGLE_API_KEY') else '❌ MISSING'}")
    logger.info(f"  Chatbot URL: {os.getenv('CHATBOT_API_URL') or '⚠️  Mock mode (no URL set)'}")
    logger.info("━" * 60)
    yield
    logger.info("Voice Chatbot — Shutting down")


# ── Create FastAPI app ────────────────────────────────────────────────────────
app = FastAPI(
    title="Maitri Voice Chatbot API",
    description=(
        "Multilingual voice chatbot for maitri.maharashtra.gov.in. "
        "Supports Marathi, Hindi, and English voice interactions."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI at /docs
    redoc_url="/redoc",     # ReDoc at /redoc
)

# ── CORS middleware ───────────────────────────────────────────────────────────
# Adjust allow_origins in production to your actual domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # Change to ["https://yourdomain.com"] in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount voice routes ────────────────────────────────────────────────────────
app.include_router(voice_router)

# ── Mount static frontend files ───────────────────────────────────────────────
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
if os.path.exists(PUBLIC_DIR):
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")
    logger.info(f"Serving frontend from: {PUBLIC_DIR}")
else:
    logger.warning(f"Public directory not found at: {PUBLIC_DIR}")


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "ok",
        "service": "maitri-voice-chatbot",
        "google_api_key": "set" if os.getenv("GOOGLE_API_KEY") else "missing",
        "bot_url": os.getenv("CHATBOT_API_URL") or "mock_mode",
    }


# ── Run directly ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("APP_HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", 8000)),
        reload=os.getenv("DEBUG", "true").lower() == "true",
        log_level="info",
    )
