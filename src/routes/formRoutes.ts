import { Router, Request, Response } from "express";
import { addSubmission, getSubmissions } from "../services/formSubmissionStore";

const router = Router();

/** POST /api/forms/submit - Store a form submission. Body: { formId, data }. */
router.post("/submit", (req: Request, res: Response) => {
  try {
    const { formId, data } = req.body;
    if (!formId || typeof data !== "object" || data === null) {
      return res.status(400).json({ error: "formId and data (object) are required" });
    }
    const submission = addSubmission(formId, data);
    res.status(201).json({ ok: true, id: submission.id, submittedAt: submission.submittedAt });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/forms/submissions - List stored submissions. Query: formId (optional). */
router.get("/submissions", (req: Request, res: Response) => {
  try {
    const formId = req.query.formId as string | undefined;
    const list = getSubmissions(formId);
    res.json({ submissions: list });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
