import { Router, Request, Response } from "express";
import {
  initChat,
  endChat,
  getSession,
  getChatHistory,
  sendMessage,
  suggestQuestions,
  formatReplyToHtml,
} from "../services/chatService";

const router = Router();

/** POST /api/chat/init - Create a chat session. Body: { ip?, userId? }. */
router.post("/init", (req: Request, res: Response) => {
  try {
    const { ip, userId } = req.body;
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
    const session = initChat(ip ?? clientIp, userId);
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/chat/end - End a chat session. Body: { sessionId }. */
router.post("/end", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const ended = endChat(sessionId);
    if (!ended) return res.status(404).json({ error: "Session not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/chat/message - Send a message and get reply. Body: { sessionId, message }. */
router.post("/message", async (req: Request, res: Response) => {
  try {
    const { sessionId, message, language } = req.body;
    if (!sessionId || message === undefined) {
      return res.status(400).json({ error: "sessionId and message are required" });
    }
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const reply = await sendMessage(sessionId, String(message), language ? String(language) : undefined);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/chat/history/:sessionId - Get chat history for a session. Assistant messages are returned as HTML (lists/links). */
router.get("/history/:sessionId", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const messages = getChatHistory(sessionId).map((m) =>
      m.role === "assistant" ? { ...m, content: formatReplyToHtml(m.content) } : m
    );
    res.json({ sessionId, messages });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/chat/suggest/:sessionId? - Suggest questions. Query: limit (optional). */
router.get("/suggest/:sessionId?", (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId ?? "";
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 5, 20);
    const questions = suggestQuestions(sessionId, limit);
    res.json({ suggestions: questions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
