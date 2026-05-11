import * as fs from "fs";
import * as path from "path";
import { FaqEntry } from "../types";

const FAQ_HEADER = "# FAQ\n\n";

/** Default path to FAQ markdown file (project root). */
export function getFaqPath(): string {
  return path.resolve(process.cwd(), "FAQ.md");
}

/** Read and parse FAQ.md into FaqEntry array. */
export function getAllFaqEntries(faqPath?: string): FaqEntry[] {
  const filePath = faqPath ?? getFaqPath();
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  return parseFaqMarkdown(raw);
}

/** Parse markdown content into FaqEntry[]. Expects "## Q: ... A: ..." blocks. */
export function parseFaqMarkdown(content: string): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/^# FAQ\s*\n+/i, "");
  const blocks = normalized.split(/\n##\s*Q:\s*/).filter((b) => b.trim());
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    const aIdx = block.search(/\n\s*A:\s*/);
    if (aIdx === -1) continue;
    const question = block.slice(0, aIdx).trim();
    const answer = block.slice(aIdx).replace(/^\n\s*A:\s*/, "").trim();
    entries.push({
      id: `faq-${i}`,
      question,
      answer,
    });
  }
  return entries;
}

/** Serialize FaqEntry[] back to FAQ markdown. */
export function serializeFaqMarkdown(entries: FaqEntry[]): string {
  const blocks = entries.map(
    (e) => `## Q: ${e.question}\nA: ${e.answer}`
  );
  return FAQ_HEADER + blocks.join("\n\n");
}

/** Write FAQ markdown to file. */
function writeFaqFile(content: string, faqPath?: string): void {
  const filePath = faqPath ?? getFaqPath();
  fs.writeFileSync(filePath, content, "utf-8");
}

/** Add a new Q&A to FAQ. Returns the new entry with id. */
export function addFaqEntry(
  question: string,
  answer: string,
  faqPath?: string
): FaqEntry {
  const entries = getAllFaqEntries(faqPath);
  const newEntry: FaqEntry = {
    id: `faq-${entries.length}`,
    question: question.trim(),
    answer: answer.trim(),
  };
  entries.push(newEntry);
  writeFaqFile(serializeFaqMarkdown(entries), faqPath);
  return newEntry;
}

/** Delete FAQ entry by id (e.g. "faq-0"). Returns true if found and removed. */
export function deleteFaqEntry(id: string, faqPath?: string): boolean {
  const entries = getAllFaqEntries(faqPath).filter((e) => e.id !== id);
  if (entries.length === getAllFaqEntries(faqPath).length) return false;
  writeFaqFile(serializeFaqMarkdown(entries), faqPath);
  return true;
}

/** Update FAQ entry by id. Returns the updated entry or null if not found. */
export function updateFaqEntry(
  id: string,
  updates: { question?: string; answer?: string },
  faqPath?: string
): FaqEntry | null {
  const entries = getAllFaqEntries(faqPath);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  if (updates.question !== undefined) entries[idx].question = updates.question.trim();
  if (updates.answer !== undefined) entries[idx].answer = updates.answer.trim();
  writeFaqFile(serializeFaqMarkdown(entries), faqPath);
  return entries[idx];
}

/** Get full FAQ text for use as context (e.g. for LangChain). */
export function getFaqContextText(faqPath?: string): string {
  const entries = getAllFaqEntries(faqPath);
  return entries
    .map((e) => `Q: ${e.question}\nA: ${e.answer}`)
    .join("\n\n");
}
