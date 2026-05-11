# Maitri Voice Chatbot 🎙️
Multilingual voice chatbot for [maitri.maharashtra.gov.in](https://maitri.maharashtra.gov.in)  
Supports **Marathi**, **Hindi**, and **English** voice interactions.

---

## Project Structure

```
voice-chatbot/
├── main.py                    ← FastAPI app entry point
├── requirements.txt
├── .env.example               ← Copy to .env and fill in your keys
│
├── routes/
│   └── voice.py               ← POST /api/voice (main pipeline)
│
├── services/
│   ├── stt.py                 ← Google Speech-to-Text
│   ├── translate.py           ← Google Translate
│   └── tts.py                 ← Google Text-to-Speech
│
├── bot/
│   └── chatbot_interface.py   ← 🔌 Plug your real bot here
│
└── public/
    ├── index.html
    ├── voice-chat.js
    └── voice-chat.css
```

---

## Setup Guide

### Step 1 — Prerequisites

```bash
# Python 3.9 or higher required
python --version

# Install ffmpeg (required for audio conversion)
# Ubuntu/Debian:
sudo apt install ffmpeg

# macOS:
brew install ffmpeg

# Windows:
choco install ffmpeg
```

### Step 2 — Install Python dependencies

```bash
cd voice-chatbot
pip install -r requirements.txt
```

### Step 3 — Set up Google Cloud APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project or use an existing one
3. Enable these **3 APIs**:
   - `Cloud Speech-to-Text API`
   - `Cloud Translation API`
   - `Cloud Text-to-Speech API`
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → API Key**
6. (Recommended) Restrict the key to the 3 APIs above

### Step 4 — Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_CLOUD_PROJECT=your_project_id_here
```

### Step 5 — Run the server

```bash
python main.py
```

Open your browser at: **http://localhost:8000**  
API docs available at: **http://localhost:8000/docs**

---

## Connecting Your Real Chatbot

When you get access to the existing Maitri chatbot, open `bot/chatbot_interface.py` and update the `get_bot_response()` function:

```python
# Option A: If your bot has an HTTP API
# Set in .env:
#   CHATBOT_API_URL=https://your-bot-endpoint.com/api/chat
#   CHATBOT_API_KEY=your_bot_api_key
# Then uncomment this line in get_bot_response():
#   return await _call_real_bot_api(user_message)

# Option B: If your bot is a Python class/function
from your_bot_module import YourBot
bot = YourBot()

async def get_bot_response(user_message: str) -> str:
    return bot.respond(user_message)
```

> ✅ You only change **this one function**. Everything else stays the same.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/voice/` | Voice input → voice output |
| `POST` | `/api/voice/text` | Text input → voice output |
| `GET`  | `/api/voice/languages` | List supported languages |
| `GET`  | `/health` | Health check |

### POST /api/voice/
- **Input**: `multipart/form-data` with `audio` file + optional `language` field
- **Output**: JSON with `audio_base64`, transcript, and translation data

### POST /api/voice/text
```json
{
  "text": "माझे अर्ज कसे करावे?",
  "language": "mr"
}
```

---

## Supported Languages

| Language | Code | Voice Used |
|----------|------|------------|
| Marathi  | `mr` | mr-IN-Standard-A |
| Hindi    | `hi` | hi-IN-Neural2-A |
| English  | `en` | en-IN-Neural2-A |

---

## Production Notes

- Change `allow_origins=["*"]` in `main.py` to your actual domain
- Use a service account JSON instead of an API key for better security
- Set `DEBUG=false` in `.env` for production
- Deploy using `gunicorn` + `uvicorn` workers:
  ```bash
  gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker
  ```
