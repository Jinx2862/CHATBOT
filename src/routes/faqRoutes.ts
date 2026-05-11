import { Router, Request, Response } from "express";
import {
  getAllFaqEntries,
  addFaqEntry,
  updateFaqEntry,
  deleteFaqEntry,
} from "../services/faqService";

const router = Router();

/** GET /api/faq - Get all FAQ questions (and answers). */
router.get("/", (_req: Request, res: Response) => {
  try {
    const entries = getAllFaqEntries();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/faq - Add a new question/answer. Body: { question, answer }. */
router.post("/", (req: Request, res: Response) => {
  try {
    const { question, answer } = req.body;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: "question and answer are required" });
    }
    const entry = addFaqEntry(question, answer);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** PUT /api/faq/:id - Update an existing FAQ entry. Body: { question?, answer? }. */
router.put("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body;
    const entry = updateFaqEntry(id, { question, answer });
    if (!entry) return res.status(404).json({ error: "FAQ entry not found" });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/faq/:id - Delete an FAQ entry. */
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const removed = deleteFaqEntry(id);
    if (!removed) return res.status(404).json({ error: "FAQ entry not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
