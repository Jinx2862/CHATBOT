import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import * as path from "path";
import fs from "fs";
import { getFaqContextText, getAllFaqEntries } from "./faqService";
import {
  getFormById,
  loadFormDefinitions,
  matchFormTrigger,
  detectOfferedForm,
  validateFieldValue,
  getNextFormQuestion,
  submitForm,
} from "./formService";
import { ChatSession, ChatMessage } from "../types";

/** Ollama base URL (default local). Override with OLLAMA_BASE_URL. */
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";

/** Detect if user message is likely Marathi or Hindi (Devanagari script). */
function detectLanguage(text: string): "mr" | "hi" | "en" {
  // Marathi-specific characters (ळ, ऱ) or common Marathi words
  if (/[\u0900-\u097F]/.test(text)) {
    if (/[ळऱ]/.test(text) || /(?:आहे|करा|नाही|काय|कसे|माहिती|मला)/.test(text)) return "mr";
    return "hi";
  }
  return "en";
}

/** Get the out-of-FAQ reply in the user's language. */
export function getOutOfFaqReply(userMessage: string): string {
  const lang = detectLanguage(userMessage);
  if (lang === "mr") {
    return "मी फक्त आमच्या FAQ वर आधारित प्रश्नांची उत्तरे देऊ शकतो. माझ्याकडे या प्रश्नाचे उत्तर नाही. कृपया FAQ यादी तपासा किंवा आम्ही ज्या विषयांवर माहिती देतो त्याबद्दल विचारा.";
  }
  if (lang === "hi") {
    return "मैं केवल हमारे FAQ के आधार पर प्रश्नों का उत्तर दे सकती हूँ। मेरे पास इस प्रश्न का उत्तर नहीं है। कृपया FAQ सूची देखें या हमारे विषयों से संबंधित कुछ पूछें।";
  }
  return "I can only answer questions based on our FAQ. I don't have an answer to that. Please check the FAQ list or ask something related to the topics we cover.";
}

/** Kept for backward compat. */
export const OUT_OF_FAQ_REPLY =
  "I can only answer questions based on our FAQ. I don't have an answer to that. Please check the FAQ list or ask something related to the topics we cover.";

/** Escape HTML entities so output is safe for innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert reply text to HTML: markdown links -> <a>, lists/steps -> <ul>/<ol><li>.
 * Safe for use in innerHTML (only allowed tags are produced by this function).
 */
export function formatReplyToHtml(text: string): string {
  if (!text || typeof text !== "string") return "";
  // 1) Escape entire string first so we don't inject script; then links and list content are safe.
  let out = escapeHtml(text);
  // 2) Replace markdown links [label](url). Only allow http(s) URLs. Label and url are already escaped.
  out = out.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, label, url) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return `[${label}](${url})`;
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // 3) Split into lines and convert list/steps blocks to HTML lists
  const lines = out.split(/\n/);
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const stepMatch = line.match(/^\s*Step\s+\d+[.:]\s*(.*)$/i);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "").trim());
        i++;
      }
      result.push("<ul>", ...items.map((item) => `<li>${item}</li>`), "</ul>");
      continue;
    }
    if (olMatch || stepMatch) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].match(/^\s*\d+\.\s+/) || lines[i].match(/^\s*Step\s+\d+[.:]\s*/i))) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").replace(/^\s*Step\s+\d+[.:]\s*/i, "").trim());
        i++;
      }
      result.push("<ol>", ...items.map((item) => `<li>${item}</li>`), "</ol>");
      continue;
    }
    result.push(line);
    i++;
  }
  return result.join("\n");
}

const SYSTEM_PROMPT_BASE = `You are a FAQ-only assistant named Maitri. Answer ONLY using the FAQ content below. Never use outside knowledge.

RULES:
- Use ONLY the FAQ content as your source. Do NOT guess, infer, or add anything not explicitly stated.
- Find the most relevant Q&A in the FAQ, then base your answer directly on that answer text.
- If the answer is not in the FAQ, say exactly: "I can only answer questions from the provided FAQ content."
- Always answer in the precise requested language.
- Keep answers concise. Copy URLs and links exactly as written in the FAQ. Do not paraphrase URLs.
- Use markdown lists ("- " or "1. ") when the answer has multiple points.

FAQ CONTENT:
`;

/** In-memory store: sessionId -> ChatSession */
const sessions = new Map<string, ChatSession>();

// ── Session Cleanup (prevent unbounded memory growth) ────────────────────────
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    const lastActivity = new Date(session.updatedAt).getTime();
    if (now - lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0 || sessions.size > 0) {
    console.log(`[Sessions] Cleanup: removed ${cleaned} expired, ${sessions.size} active`);
  }
}, SESSION_CLEANUP_INTERVAL_MS);

/** Create a unique session id from IP or userId. */
export function createSessionId(ip?: string, userId?: string): string {
  const part = (userId || ip || `anon-${Date.now()}`).trim();
  return `session-${part}-${Date.now()}`;
}

/** Initialize a new chat session. Returns sessionId. */
export function initChat(ip?: string, userId?: string): ChatSession {
  const sessionId = createSessionId(ip, userId);
  const now = new Date().toISOString();
  const session: ChatSession = {
    sessionId,
    userId: userId?.trim() || undefined,
    ip: ip?.trim() || undefined,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(sessionId, session);
  return session;
}

/** End (delete) a chat session. Returns true if it existed. */
export function endChat(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/** Get session by id, or undefined. */
export function getSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId);
}

/** Get chat history for a session. */
export function getChatHistory(sessionId: string): ChatMessage[] {
  const session = sessions.get(sessionId);
  return session ? [...session.messages] : [];
}

/** Append a message to session and update timestamp. */
function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const msg: ChatMessage = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(msg);
  session.updatedAt = new Date().toISOString();
}

/** Build LangChain messages from session history + new user message. Answers in requested language. */
function buildMessages(
  history: ChatMessage[],
  userContent: string,
  faqContext: string,
  userLang: "mr" | "hi" | "en"
): (HumanMessage | AIMessage | SystemMessage)[] {
  const systemContent = SYSTEM_PROMPT_BASE + (faqContext || "(FAQ is empty.)");
  const msgs: (HumanMessage | AIMessage | SystemMessage)[] = [
    new SystemMessage(systemContent),
  ];
  for (const m of history) {
    if (m.role === "user") msgs.push(new HumanMessage(m.content));
    else msgs.push(new AIMessage(m.content));
  }
  const langName = userLang === "hi" ? "Hindi" : userLang === "mr" ? "Marathi" : "English";
  msgs.push(new HumanMessage(`[Answer strictly in ${langName} only, using exactly the FAQ content above] ${userContent}`));
  return msgs;
}

/** Cached FAQ text — read from disk once, reused on every request. */
let faqTextCache: string | null = null;
function getCachedFaqText(): string {
  if (faqTextCache === null) {
    faqTextCache = getFaqContextText();
    console.log(`[FAQ Cache] Loaded FAQ text (${faqTextCache.length} chars)`);
  }
  return faqTextCache;
}

// ── Persistent Gemini Response Cache ─────────────────────────────────────────
// Survives server restarts by saving to data/response_cache.json.

const geminiResponseCache = new Map<string, string>();
const CACHE_MAX = 500;
const RESPONSE_CACHE_FILE = path.resolve(process.cwd(), "data", "response_cache.json");
let cacheFlushTimer: ReturnType<typeof setTimeout> | null = null;
let cacheDirty = false;

/** Load response cache from disk (called during warm-up). */
function loadResponseCache(): void {
  try {
    if (fs.existsSync(RESPONSE_CACHE_FILE)) {
      const raw = fs.readFileSync(RESPONSE_CACHE_FILE, "utf-8");
      const data: Record<string, string> = JSON.parse(raw);
      let count = 0;
      for (const [key, value] of Object.entries(data)) {
        if (count >= CACHE_MAX) break;
        geminiResponseCache.set(key, value);
        count++;
      }
      console.log(`[Response Cache] Loaded ${count} cached responses from disk`);
    }
  } catch (err) {
    console.warn("[Response Cache] Could not load from disk:", err);
  }
}

/** Save response cache to disk (debounced, runs at most every 60s). */
function scheduleFlushCache(): void {
  cacheDirty = true;
  if (cacheFlushTimer) return; // already scheduled
  cacheFlushTimer = setTimeout(() => {
    cacheFlushTimer = null;
    if (!cacheDirty) return;
    flushCacheNow();
  }, 60_000);
}

function flushCacheNow(): void {
  try {
    const dataDir = path.dirname(RESPONSE_CACHE_FILE);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const data = Object.fromEntries(geminiResponseCache);
    fs.writeFileSync(RESPONSE_CACHE_FILE, JSON.stringify(data), "utf-8");
    cacheDirty = false;
    console.log(`[Response Cache] Flushed ${geminiResponseCache.size} entries to disk`);
  } catch (err) {
    console.warn("[Response Cache] Could not save to disk:", err);
  }
}

// Flush cache on process exit (graceful shutdown)
process.on("SIGINT", () => { flushCacheNow(); process.exit(0); });
process.on("SIGTERM", () => { flushCacheNow(); process.exit(0); });
process.on("exit", () => { if (cacheDirty) flushCacheNow(); });

function getCacheKey(lang: string, question: string, history: ChatMessage[]): string {
  const histStr = history.slice(-2).map(m => m.content).join("::");
  return `${lang}::${question.trim().toLowerCase()}::${histStr}`;
}

/** Make a single Gemini API call. Returns the response text or null. */
async function callGeminiApi(prompt: string): Promise<string | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
    }
  );

  if (res.status === 429) return "__RATE_LIMITED__";
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[Gemini] HTTP ${res.status}: ${errText}`);
    return null;
  }

  const data = await res.json() as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

/**
 * Call Gemini with automatic one-retry on 429 (rate limit).
 * Waits 2 seconds before retrying so the rate-limit window can reset.
 */
async function callGeminiWithRetry(prompt: string): Promise<string | null> {
  const result = await callGeminiApi(prompt);
  if (result !== "__RATE_LIMITED__") return result;

  console.warn("[Gemini] Rate limited (429) — retrying in 2s...");
  await new Promise(r => setTimeout(r, 2000));

  const retry = await callGeminiApi(prompt);
  if (retry === "__RATE_LIMITED__") {
    console.warn("[Gemini] Still rate limited after retry — falling back to Ollama");
    return null;
  }
  return retry;
}

/**
 * Single Gemini call that BOTH answers from the FAQ AND translates
 * into the user's language in one shot.
 *
 * Speed wins vs old approach:
 *  - English:        1 call  (was 2: answer + no-op translate)
 *  - Hindi/Marathi:  1 call  (was 2: answer-in-English + translate)
 *
 * Falls back gracefully: returns null so Ollama can handle it.
 */
async function getGeminiReply(
  userQuestion: string,
  faqContext: string,
  history: ChatMessage[],
  userLang: "en" | "hi" | "mr"
): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const langName = userLang === "hi" ? "Hindi (हिंदी)" : userLang === "mr" ? "Marathi (मराठी)" : "English";
    const noAnswerMsg =
      userLang === "hi"
        ? "मुझे खेद है, इस प्रश्न का उत्तर FAQ में उपलब्ध नहीं है।"
        : userLang === "mr"
        ? "मला माफ करा, या प्रश्नाचे उत्तर FAQ मध्ये उपलब्ध नाही."
        : "I can only answer questions from the provided FAQ content.";

    const historyText = history.slice(-4)
      .map(m => `${m.role === "user" ? "User" : "Maitri"}: ${m.content}`)
      .join("\n");

    const prompt = `You are Maitri, a FAQ-only assistant. You MUST reply in ${langName} ONLY.

=== LANGUAGE DIRECTIVE (HIGHEST PRIORITY) ===
YOUR RESPONSE MUST BE WRITTEN ENTIRELY IN ${langName.toUpperCase()}.
${userLang === "hi" ? `- Use "आप" as honorific (never "आपलोगों" or "तुम")
- Use female verb forms: "सकती हूँ" not "सकता हूँ", "बता सकती हूँ", "जा सकती हैं"
- Do NOT start with "हाइ", "हेलो", or any transliterated English` : ""}
${userLang === "mr" ? `- Use "आपण" as honorific
- Use female verb forms: "सांगू शकते", "करू शकते", "आहे"
- Do NOT start with "हाय" or any English greeting` : ""}

=== CONTENT ACCURACY RULES ===
- Answer ONLY from the FAQ content below. Do NOT use outside knowledge.
- Find the Q&A that best matches the question and reproduce that answer FAITHFULLY.
- Do NOT paraphrase or omit numbers, thresholds, zone names, or structured data.
- If no FAQ entry answers the question, reply exactly: "${noAnswerMsg}"
- Copy all URLs exactly as they appear in the FAQ.
- Use markdown bullet lists when the FAQ answer contains multiple items.

=== TERMS TO NEVER TRANSLATE (copy exactly from FAQ) ===
FCI, MOU, MIDC, NRI, FDI, PSI, DIC, GM, INR, G2B, RO, "PSI 2019 Scheme",
"Magnetic Maharashtra", "Davos", Zone A/B/C/D/D+, "naxal areas",
"Minimum FCI:", "Minimum Direct Employment:", "Ultra-Mega:", "Mega Projects:",
all numeric values (e.g. "INR 4,000 Cr", "4,000 persons"), all URLs,
MAITRI, MAITRI Portal, MIDC, Maharashtra

FAQ CONTENT:
${faqContext}

${historyText ? `RECENT CONVERSATION:\n${historyText}\n\n` : ""}User: ${userQuestion}
Maitri (reply in ${langName} only):`;

    // Check cache first — avoids API call entirely for repeated questions
    const cacheKey = getCacheKey(userLang, userQuestion, history);
    if (geminiResponseCache.has(cacheKey)) {
      console.log(`[Gemini] Cache hit for "${userQuestion.slice(0, 40)}..." (${userLang})`);
      return geminiResponseCache.get(cacheKey)!;
    }

    const answer = await callGeminiWithRetry(prompt);
    if (answer) {
      console.log(`[Gemini] Answered in ${userLang} ✓`);
      // Store in cache; evict oldest if at capacity
      if (geminiResponseCache.size >= CACHE_MAX) {
        const firstKey = geminiResponseCache.keys().next().value;
        if (firstKey) geminiResponseCache.delete(firstKey);
      }
      geminiResponseCache.set(cacheKey, answer);
      scheduleFlushCache();
      return answer;
    }
    return null;
  } catch (err) {
    console.warn("[Gemini] Failed:", err);
    return null;
  }
}

/**
 * Translate English text to Hindi or Marathi using Gemini Flash.
 * Falls back to MyMemory (free, no key) if Gemini is unavailable.
 * Returns the original English text if both fail.
 */
async function translateReply(
  englishText: string,
  lang: "hi" | "mr"
): Promise<string> {
  const langCode = lang === "hi" ? "hi" : "mr";
  const langFull = lang === "hi" ? "Hindi" : "Marathi";

  // ── Primary: Gemini Flash ────────────────────────────────────────────────
  if (GOOGLE_API_KEY) {
    try {
      const prompt = lang === "hi"
        ? `Translate the following English text to formal Hindi (हिंदी). Rules:\n- Use "आप" as honorific, never "आपलोगों" or "तुम"\n- Do NOT start with "हाइ", "हेलो", or any English greeting\n- Use female verb forms: "सकती हूँ" not "सकता हूँ"\n- Keep proper nouns (MAITRI, Portal) unchanged\n- Return ONLY the translated text, nothing else\n\nText:\n${englishText}`
        : `Translate the following English text to formal Marathi (मराठी). Rules:\n- Use "आपण" as honorific\n- Use female verb forms: "सांगू शकते", "करू शकते"\n- Keep proper nouns (MAITRI, Portal) unchanged\n- Return ONLY the translated text, nothing else\n\nText:\n${englishText}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const translated: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (translated.trim()) {
          console.log(`[Translation] Gemini → ${langFull} successful`);
          return translated.trim();
        }
      } else {
        console.warn(`[Translation] Gemini returned ${res.status}, trying fallback`);
      }
    } catch (err) {
      console.warn("[Translation] Gemini failed:", err);
    }
  }

  // ── Fallback: MyMemory free API (no key required) ────────────────────────
  try {
    const encoded = encodeURIComponent(englishText.slice(0, 500)); // MyMemory limit
    const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|${langCode}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as any;
      const translated: string = data?.responseData?.translatedText ?? "";
      if (translated.trim() && !translated.includes("MYMEMORY WARNING")) {
        console.log(`[Translation] MyMemory → ${langFull} successful`);
        return translated.trim();
      }
    }
  } catch (err) {
    console.warn("[Translation] MyMemory fallback failed:", err);
  }

  // ── Final fallback: return original English ──────────────────────────────
  console.warn(`[Translation] All translation methods failed, returning English`);
  return englishText;
}

interface VectorDoc {
  pageContent: string;
  embedding: number[];
}

function cosineSimilarity(A: number[], B: number[]) {
  let dotProduct = 0; let normA = 0; let normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

let vectorStoreCache: VectorDoc[] | null = null;
const VECTOR_STORE_FILE = path.resolve(__dirname, "../../vector_store.json");

async function getVectorContext(query: string): Promise<string> {
  try {
    if (!vectorStoreCache) {
      if (!fs.existsSync(VECTOR_STORE_FILE)) {
         return "(Vector Database not found. Please run the ingestion script.)";
      }
      const data = await fs.promises.readFile(VECTOR_STORE_FILE, "utf8");
      vectorStoreCache = JSON.parse(data);
    }
    const embeddings = new OllamaEmbeddings({
      baseUrl: OLLAMA_BASE_URL,
      model: "bge-m3",
    });
    const queryVector = await embeddings.embedQuery(query);
    
    const scoredDocs = vectorStoreCache!.map(doc => ({
      content: doc.pageContent,
      score: cosineSimilarity(queryVector, doc.embedding)
    }));
    
    scoredDocs.sort((a, b) => b.score - a.score);
    return scoredDocs.slice(0, 3).map((r) => r.content).join("\n\n---\n\n");
  } catch (err) {
    console.error("Vector DB missing or failed to load. Run ingestion script first.", err);
    return "(Vector Database not found. Please run the ingestion script.)";
  }
}

/** Guard: ask the model if the user question is answerable from the FAQ. Returns true only if FAQ has content and model says YES. */
async function isQuestionAnswerableFromFaq(
  userQuestion: string,
  faqContext: string
): Promise<boolean> {
  if (!faqContext || faqContext.includes("(FAQ is empty.)")) return false;
  const model = new ChatOllama({
    baseUrl: OLLAMA_BASE_URL,
    model: OLLAMA_MODEL,
    temperature: 0,
  });
  const system = `You are a strict classifier. Your ONLY job is to decide if the user's question can be answered using ONLY the FAQ text provided.
FAQ text (your only source):
---
${faqContext}
---
User question: "${userQuestion}"
Can the user's question be answered using ONLY the FAQ text above? Reply with exactly one word: YES or NO.`;
  const response = await model.invoke([new SystemMessage(system), new HumanMessage("Is it answerable from the FAQ? Reply YES or NO only.")]);
  const text = (typeof response.content === "string" ? response.content : String(response.content)).trim().toUpperCase();
  return text.startsWith("YES");
}

/** Normalize for cancel/skip detection. */
function normalizeMessage(text: string): string {
  return text.trim().toLowerCase();
}

/** Get the field label in the user's language. */
function getFieldLabel(field: { label: string; label_mr?: string; label_hi?: string }, lang?: string): string {
  if (lang === "mr" && field.label_mr) return field.label_mr;
  if (lang === "hi" && field.label_hi) return field.label_hi;
  return field.label;
}

/** Get multilingual cancel message. */
function getCancelMsg(lang?: string): string {
  if (lang === "mr") return "फॉर्म रद्द केला. तुम्ही कधीही 'नोंदणी' म्हणून पुन्हा सुरू करू शकता.";
  if (lang === "hi") return "फॉर्म रद्द किया गया। आप कभी भी 'पंजीकरण' कहकर दोबारा शुरू कर सकते हैं।";
  return "Form cancelled. You can start again anytime by saying you'd like to register.";
}

/** Get multilingual success message. */
function getSuccessMsg(formName: string, lang?: string): string {
  if (lang === "mr") return `धन्यवाद. तुमची ${formName} यशस्वीरित्या सबमिट झाली आहे.`;
  if (lang === "hi") return `धन्यवाद। आपका ${formName} सफलतापूर्वक जमा हो गया है।`;
  return `Thank you. Your ${formName} has been submitted successfully.`;
}

/** Get multilingual error message for form submit failure. */
function getSubmitErrorMsg(lang?: string, detail?: string): string {
  if (lang === "mr") return `क्षमस्व, फॉर्म सबमिट करता आला नाही. कृपया नंतर पुन्हा प्रयत्न करा.${detail ? ` (${detail})` : ""}`;
  if (lang === "hi") return `क्षमा करें, फॉर्म जमा नहीं हो सका। कृपया बाद में पुनः प्रयास करें।${detail ? ` (${detail})` : ""}`;
  return `Sorry, we couldn't submit the form right now. Please try again later.${detail ? ` (${detail})` : ""}`;
}

/** Check if text is a cancel command in any language. */
function isCancelCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return ["cancel", "nevermind", "stop", "रद्द", "रद्द करा", "थांबा", "बंद करो", "रोको"].includes(normalized);
}

/** Check if text is purely a greeting message. */
function isGreetingCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, '');
  const greetings = [
    "hi", "hello", "hey", "greetings", "good morning", "good afternoon", "good evening",
    "namaskar", "namaste", "hi there", "hello there",
    "नमस्कार", "नमस्ते", "प्रणाम", "हाय", "हॅलो", "हे", "सुप्रभात", "शुभ प्रभात", "शुभ संध्या"
  ];
  return greetings.includes(normalized);
}

/** Get multilingual greeting message. */
function getGreetingReply(lang?: string): string {
  if (lang === "mr") return "नमस्कार! मी आपल्याला कशी मदत करू शकते? आपल्याला काही प्रश्न आहेत का?";
  if (lang === "hi") return "नमस्ते! मैं आपकी कैसे मदद कर सकती हूँ? क्या आपके पास कोई प्रश्न है जिसका आप उत्तर चाहते हैं?";
  return "Hello! How can I assist you today? Do you have any questions you would like me to answer?";
}


/** Handle form-filling flow: validate answer, store, ask next or submit. Returns assistant reply or null if not in form flow. */
async function handleFormFlow(
  sessionId: string,
  userContent: string
): Promise<string | null> {
  const session = sessions.get(sessionId);
  if (!session?.formState) return null;

  const form = getFormById(session.formState.formId);
  if (!form) {
    session.formState = undefined;
    return null;
  }

  const userLang = session.formState.userLang || "en";

  if (isCancelCommand(userContent)) {
    session.formState = undefined;
    const msg = getCancelMsg(userLang);
    appendMessage(sessionId, "assistant", msg);
    return formatReplyToHtml(msg);
  }

  const fields = form.fields;
  const stepIndex = session.formState.stepIndex;
  if (stepIndex >= fields.length) return null;

  const field = fields[stepIndex];
  const result = validateFieldValue(userContent, field);
  if (result.error) {
    const localLabel = getFieldLabel(field, userLang);
    const askAgain = `${result.error} ${localLabel}`;
    appendMessage(sessionId, "assistant", askAgain);
    return formatReplyToHtml(askAgain);
  }

  const valueToStore = result.normalizedValue !== undefined ? result.normalizedValue : userContent.trim();
  session.formState.data[field.key] = valueToStore;
  session.formState.stepIndex = stepIndex + 1;

  // Check next question - use localized labels
  const nextFieldIndex = session.formState.stepIndex;
  let nextQuestion: string | null = null;
  for (let i = nextFieldIndex; i < form.fields.length; i++) {
    const f = form.fields[i];
    if (session.formState.data[f.key] == null || session.formState.data[f.key] === "") {
      nextQuestion = getFieldLabel(f, userLang);
      break;
    }
  }

  if (nextQuestion) {
    appendMessage(sessionId, "assistant", nextQuestion);
    return formatReplyToHtml(nextQuestion);
  }

  try {
    const successMsg = getSuccessMsg(form.name, userLang);
    // Still submit via the original submitForm for the HTTP POST
    await submitForm(form, session.formState.data);
    session.formState = undefined;
    appendMessage(sessionId, "assistant", successMsg);
    return formatReplyToHtml(successMsg);
  } catch (err) {
    const errMsg = getSubmitErrorMsg(userLang, err instanceof Error ? err.message : String(err));
    appendMessage(sessionId, "assistant", errMsg);
    return formatReplyToHtml(errMsg);
  }
}

/** Start a form: set formState with user language and return the first question. */
function startForm(sessionId: string, formId: string, userMessage?: string): string {
  const form = getFormById(formId);
  if (!form) throw new Error("Form not found");
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const userLang = userMessage ? detectLanguage(userMessage) : "en";
  session.formState = { formId, stepIndex: 0, data: {}, userLang };
  session.offeredFormId = undefined;
  const firstQuestion = getFieldLabel(form.fields[0] ?? { label: "Let's get started." }, userLang);
  appendMessage(sessionId, "assistant", firstQuestion);
  return formatReplyToHtml(firstQuestion);
}

/** Send user message, get assistant reply, persist both. Returns assistant reply text. Handles form flow and FAQ. */
export async function sendMessage(
  sessionId: string,
  userContent: string,
  langHint?: string
): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  appendMessage(sessionId, "user", userContent);

  // 1) If currently filling a form, handle as form answer (validate, next question, or submit).
  const formReply = await handleFormFlow(sessionId, userContent);
  if (formReply !== null) return formReply;

  // 2) If user said "yes" after we offered a form, or said a trigger phrase, start that form.
  const matchedForm = matchFormTrigger(userContent, session.offeredFormId);
  if (matchedForm) {
    return startForm(sessionId, matchedForm.id, userContent);
  }

  // 3) Intercept greetings.
  if (isGreetingCommand(userContent)) {
    const userLang = (langHint as "mr" | "hi" | "en") ?? detectLanguage(userContent);
    const greetingReply = getGreetingReply(userLang);
    appendMessage(sessionId, "assistant", greetingReply);
    return formatReplyToHtml(greetingReply);
  }

  // Load FAQ text from cache (no disk read on repeat requests)
  const faqText = getCachedFaqText();

  // When Gemini is available, skip the vector search entirely —
  // Gemini reads the full FAQ directly so the embedding lookup is unnecessary.
  // When Gemini is NOT available we still run the vector search for Ollama.
  let combinedContext = faqText || "(FAQ is empty.)";
  if (!GOOGLE_API_KEY) {
    // Ollama fallback path: augment with vector context
    const vectorContext = await getVectorContext(userContent);
    if (vectorContext && !vectorContext.includes("(Vector Database not found")) {
      combinedContext += "\n\n=== Portal Information (Supplementary) ===\n" + vectorContext;
    }
  }

  // Detect the user's language
  const userLangGuess = (langHint as "mr" | "hi" | "en") || detectLanguage(userContent);

  // Single Gemini call: answers in the user's language directly (answer + translate in one shot)
  // Fallback: two-step Ollama path (answer English → no translation for now)
  let finalReply = await getGeminiReply(userContent, combinedContext, session.messages.slice(0, -1), userLangGuess);

  if (!finalReply) {
    console.warn("[Answer] Falling back to Ollama (qwen2.5:3b)");
    const vectorContext = await getVectorContext(userContent);
    if (vectorContext && !vectorContext.includes("(Vector Database not found")) {
      combinedContext += "\n\n=== Portal Information (Supplementary) ===\n" + vectorContext;
    }
    const model = new ChatOllama({ baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL, temperature: 0.2 });
    const messages = buildMessages(session.messages.slice(0, -1), userContent, combinedContext, userLangGuess as "mr" | "hi" | "en");
    const response = await model.invoke(messages);
    finalReply = typeof response.content === "string" ? response.content : String(response.content);
  }

  appendMessage(sessionId, "assistant", finalReply);

  // If the reply contains an offer question (e.g. "Would you like to register?"), set offeredFormId.
  const offeredForm = detectOfferedForm(finalReply);
  if (offeredForm) session.offeredFormId = offeredForm.id;

  return formatReplyToHtml(finalReply);
}

/** Suggest a few questions from the FAQ and form triggers (e.g. "I would like to register"). */
export function suggestQuestions(_sessionId: string, limit: number = 5): string[] {
  const entries = getAllFaqEntries();
  let questions = entries.map((e) => e.question);
  const forms = loadFormDefinitions();
  for (const form of forms) {
    if (form.triggerPhrases?.length) {
      questions = questions.concat(
        form.triggerPhrases.filter((p) => p.length > 2 && p !== "yes" && p !== "y")
      );
    }
  }
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(limit, questions.length));
}

// ── Warm-up: pre-load all caches for fast first request ─────────────────────

export async function warmUp(): Promise<void> {
  console.log("[Warm-up] Pre-loading caches...");

  // 1. FAQ text
  getCachedFaqText();

  // 2. Gemini response cache from disk
  loadResponseCache();

  // 3. Form definitions
  loadFormDefinitions();

  // 4. Vector store (load into memory, skip if file doesn't exist)
  try {
    if (fs.existsSync(VECTOR_STORE_FILE)) {
      const data = await fs.promises.readFile(VECTOR_STORE_FILE, "utf8");
      vectorStoreCache = JSON.parse(data);
      console.log(`[Warm-up] Vector store loaded (${vectorStoreCache!.length} docs)`);
    }
  } catch (err) {
    console.warn("[Warm-up] Vector store not loaded (non-fatal):", err);
  }

  console.log("[Warm-up] All caches ready ✓");
}
