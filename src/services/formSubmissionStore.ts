import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.FORMS_DATA_DIR ?? path.resolve(process.cwd(), "data");
const SUBMISSIONS_FILE = path.join(DATA_DIR, "submissions.json");

export interface StoredSubmission {
  id: string;
  formId: string;
  data: Record<string, string>;
  submittedAt: string;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readSubmissions(): StoredSubmission[] {
  ensureDataDir();
  if (!fs.existsSync(SUBMISSIONS_FILE)) return [];
  try {
    const raw = fs.readFileSync(SUBMISSIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeSubmissions(list: StoredSubmission[]): void {
  ensureDataDir();
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2), "utf-8");
}

/** Add a form submission and save to JSON file. Returns the stored submission. */
export function addSubmission(formId: string, data: Record<string, string>): StoredSubmission {
  const list = readSubmissions();
  const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const submission: StoredSubmission = {
    id,
    formId,
    data,
    submittedAt: new Date().toISOString(),
  };
  list.push(submission);
  writeSubmissions(list);
  return submission;
}

/** Get all submissions, optionally filtered by formId. */
export function getSubmissions(formId?: string): StoredSubmission[] {
  const list = readSubmissions();
  if (formId) return list.filter((s) => s.formId === formId);
  return list;
}
