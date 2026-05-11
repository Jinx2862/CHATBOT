import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";
import rateLimit from "express-rate-limit";
import faqRoutes from "./routes/faqRoutes";
import chatRoutes from "./routes/chatRoutes";
import formRoutes from "./routes/formRoutes";
import { addSubmission } from "./services/formSubmissionStore";
import { warmUp } from "./services/chatService";

const app = express();
const PORT = process.env.PORT ?? 3000;
const VOICE_SERVER_URL = process.env.VOICE_SERVER_URL ?? "http://127.0.0.1:8000";

app.use(cors());

// ── Rate limiters ─────────────────────────────────────────────────────────────
const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment before sending another message." },
});
const chatInitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many session requests. Please wait a moment." },
});
const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many voice requests. Please wait a moment." },
});

// Proxy /api/voice/* to the Python voice server (must be before body parsers)
app.use(
  "/api/voice",
  voiceLimiter,
  createProxyMiddleware({
    target: `${VOICE_SERVER_URL}/api/voice`,
    changeOrigin: true,
    on: {
      error: (_err, _req, res) => {
        (res as express.Response).status(502).json({
          error: "Voice server is not running. Start the Python server first (cd MyBot && python main.py).",
        });
      },
    },
  })
);

app.use(express.json());

// Static files for demo (e.g. demo.html)
app.use(express.static(path.join(process.cwd(), "public")));

app.use("/api/faq", faqRoutes);
app.use("/api/chat/init", chatInitLimiter);
app.use("/api/chat/message", chatMessageLimiter);
app.use("/api/chat", chatRoutes);
app.use("/api/forms", formRoutes);

// Form submissions: save to JSON (user-registration submitUrl can point here).
app.post("/api/register", (req, res) => {
  try {
    const submission = addSubmission("user-registration", req.body);
    res.status(201).json({ ok: true, id: submission.id, message: "Registration received." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, async () => {
  console.log(`FAQ Chatbot API listening on http://localhost:${PORT}`);
  console.log(`Demo: http://localhost:${PORT}/demo.html`);
  console.log(`Voice proxy: /api/voice/* → ${VOICE_SERVER_URL} (start Python server for voice)`);

  // Pre-load caches for fast first request
  try {
    await warmUp();
  } catch (err) {
    console.warn("[Warm-up] Partial failure (non-fatal):", err);
  }
});
