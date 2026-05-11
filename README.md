# FAQ Chatbot

TypeScript chatbot that answers from a markdown FAQ using LangChain and local Ollama. REST API for chat and FAQ management.

## Setup

```bash
npm install
```

Use **local Ollama** for the chat model. Install [Ollama](https://ollama.ai/) and pull a model:

```bash
ollama pull llama3.2
```

Optional env (or `.env`): `OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.2`).

## Run

```bash
npm run dev
```

- API: http://localhost:3000
- Demo UI: http://localhost:3000/demo.html

## API

### FAQ

- `GET /api/faq` – list all FAQ entries
- `POST /api/faq` – add entry `{ "question", "answer" }`
- `PUT /api/faq/:id` – update entry `{ "question?", "answer?" }`
- `DELETE /api/faq/:id` – delete entry

### Chat

- `POST /api/chat/init` – create session `{ "ip?", "userId?" }` → returns `{ sessionId, ... }`
- `POST /api/chat/end` – end session `{ "sessionId" }`
- `POST /api/chat/message` – send message `{ "sessionId", "message" }` → `{ "reply" }`
- `GET /api/chat/history/:sessionId` – get messages
- `GET /api/chat/suggest?limit=5` – suggested questions from FAQ and form triggers

## Form-by-chat

Users can submit forms (e.g. registration) by chatting: the bot asks for each field one by one, validates, then POSTs to your URL.

1. **Trigger** – User says e.g. "I would like to register" or "register", or replies "yes" after the bot asks "Would you like to register?"
2. **Flow** – Bot asks each field from the form definition; user can say "cancel" to exit.
3. **Submit** – When all fields are collected, the bot sends a JSON body to the form’s `submitUrl`.

Put one or more JSON form definitions in the **`forms/`** folder (or set `FORMS_DIR`). Example `forms/user-registration.json`:

```json
{
  "id": "user-registration",
  "name": "User Registration",
  "submitUrl": "http://localhost:3000/api/register",
  "submitMethod": "POST",
  "triggerPhrases": ["register", "i would like to register", "sign up", "yes"],
  "offerQuestion": "Would you like to register?",
  "fields": [
    { "key": "fullName", "label": "What is your full name?", "type": "text", "required": true, "validation": { "minLength": 2, "maxLength": 100 } },
    { "key": "email", "label": "What is your email address?", "type": "email", "required": true },
    { "key": "phone", "label": "Phone number? (optional)", "type": "tel", "required": false }
  ]
}
```

Field `type`: `text`, `email`, `tel`, `number`, `date`. Optional `validation`: `minLength`, `maxLength`, `pattern` (regex). **Form submission API (JSON file as DB):**

- `POST /api/forms/submit` – Body: `{ "formId", "data" }`. Saves to `data/submissions.json`.
- `GET /api/forms/submissions?formId=user-registration` – List stored submissions (optional `formId` filter).
- `POST /api/register` – Same as above with `formId` fixed to `user-registration` (for backward compatibility). Body = form data only.

Set `FORMS_DATA_DIR` to change the storage directory (default `data/`).

## FAQ format

`FAQ.md` in project root:

```markdown
# FAQ

## Q: Your question?
A: Your answer. [Link](url) optional.
```

## Build

```bash
npm run build
npm start
```
