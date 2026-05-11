import * as fs from "fs";
import * as path from "path";
import { FormDefinition, FormFieldDef, FormState } from "../types";

const FORMS_DIR = process.env.FORMS_DIR ?? path.resolve(process.cwd(), "forms");

/** Cached form definitions — loaded once from disk, reused on every call. */
let cachedForms: FormDefinition[] | null = null;

/** Load all form definitions from the forms directory (*.json). Uses in-memory cache. */
export function loadFormDefinitions(): FormDefinition[] {
  if (cachedForms !== null) return cachedForms;

  const definitions: FormDefinition[] = [];
  if (!fs.existsSync(FORMS_DIR)) return definitions;
  const files = fs.readdirSync(FORMS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const filePath = path.join(FORMS_DIR, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as FormDefinition;
      if (parsed.id && parsed.submitUrl && Array.isArray(parsed.fields) && Array.isArray(parsed.triggerPhrases)) {
        definitions.push(parsed);
      }
    } catch {
      // Skip invalid or unreadable form files
    }
  }
  cachedForms = definitions;
  console.log(`[Forms Cache] Loaded ${definitions.length} form definition(s)`);
  return definitions;
}

/** Force reload form definitions from disk (call after adding/editing form JSON files). */
export function reloadFormDefinitions(): FormDefinition[] {
  cachedForms = null;
  return loadFormDefinitions();
}

/** Get a single form by id. */
export function getFormById(formId: string): FormDefinition | undefined {
  return loadFormDefinitions().find((f) => f.id === formId);
}

/** Normalize user input for trigger matching: lowercase, trim. */
export function normalizeForTrigger(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Check if user message matches any form's trigger phrases (or "yes" when form was offered). */
export function matchFormTrigger(
  userMessage: string,
  offeredFormId?: string
): FormDefinition | undefined {
  const normalized = normalizeForTrigger(userMessage);
  const forms = loadFormDefinitions();
  if (offeredFormId && (normalized === "yes" || normalized === "yes please" || normalized === "y")) {
    const form = forms.find((f) => f.id === offeredFormId);
    if (form) return form;
  }
  for (const form of forms) {
    for (const phrase of form.triggerPhrases || []) {
      const normalizedPhrase = normalizeForTrigger(phrase);
      if (!normalizedPhrase) continue;

      // Exact match always works
      if (normalized === normalizedPhrase) return form;

      // For longer phrases (4+ words), allow substring matching but only
      // on word boundaries to prevent partial-word false positives
      // (e.g. "हां" matching inside "कहां").
      // Short phrases (1-3 words like "register", "हां", "sign up") require exact match only.
      const wordCount = normalizedPhrase.split(/\s+/).length;
      if (wordCount >= 4 && normalized.includes(normalizedPhrase)) {
        return form;
      }
    }
  }
  return undefined;
}

/** Check if assistant reply contains a form's offer question (so we can set offeredFormId). */
export function detectOfferedForm(assistantReply: string): FormDefinition | undefined {
  const forms = loadFormDefinitions();
  const reply = assistantReply.trim().toLowerCase();
  for (const form of forms) {
    const questions = form.offerQuestions?.length
      ? form.offerQuestions
      : form.offerQuestion
        ? [form.offerQuestion]
        : [];
    for (const q of questions) {
      if (q && reply.includes(q.trim().toLowerCase())) return form;
    }
  }
  return undefined;
}

export interface ValidationResult {
  error?: string;
  /** Value to store (e.g. parsed date, or "" for optional invalid). */
  normalizedValue?: string;
}

/** Try to parse various date inputs into YYYY-MM-DD. */
function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Already YYYY-MM-DD
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    const month = parseInt(m!, 10);
    const day = parseInt(d!, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return s;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // MM/DD/YYYY
  const mdy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // Month name: Jan 15 1990, 15 Jan 1990, January 15, 1990, 15th January 1990
  const months: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
    nov: "11", november: "11", dec: "12", december: "12",
  };
  const clean = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1");
  const parts = clean.split(/[\s,]+/).filter(Boolean);
  if (parts.length >= 3) {
    let year: string | null = null;
    let month: string | null = null;
    let day: string | null = null;
    for (const p of parts) {
      const lower = p.toLowerCase();
      if (months[lower]) month = months[lower];
      else if (/^\d{4}$/.test(p)) year = p;
      else if (/^\d{1,2}$/.test(p) && parseInt(p, 10) <= 31) day = p.padStart(2, "0");
    }
    if (year && month && day) return `${year}-${month}-${day}`;
  }
  return null;
}

/** True if field is name-like (key or label contains "name"). */
function isNameLikeField(field: FormFieldDef): boolean {
  const k = field.key.toLowerCase();
  const l = field.label.toLowerCase();
  return k.includes("name") || l.includes("name");
}

/** True if input looks like only numbers (digits/spaces). */
function isOnlyNumbers(s: string): boolean {
  return /^[\d\s]+$/.test(s.trim()) && s.trim().length > 0;
}

/** Validate a single field value. Returns { error } if invalid, or { normalizedValue } to store. */
export function validateFieldValue(value: string, field: FormFieldDef): ValidationResult {
  const v = value.trim();
  if (field.required && !v) return { error: `Please provide ${field.label.toLowerCase()}` };
  if (!v) return { normalizedValue: "" }; // optional and empty is ok

  const val = field.validation || {};
  if (val.minLength != null && v.length < val.minLength) {
    return { error: `Please enter at least ${val.minLength} characters.` };
  }
  if (val.maxLength != null && v.length > val.maxLength) {
    return { error: `Please enter at most ${val.maxLength} characters.` };
  }
  if (val.pattern) {
    try {
      const re = new RegExp(val.pattern);
      if (!re.test(v)) return { error: "Invalid format. Please try again." };
    } catch {
      // ignore invalid pattern
    }
  }

  switch (field.type) {
    case "text": {
      if (isNameLikeField(field) && isOnlyNumbers(v)) {
        return { error: "Please enter a name, not numbers." };
      }
      return { normalizedValue: v };
    }
    case "email": {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(v)) return { error: "Please enter a valid email address." };
      return { normalizedValue: v };
    }
    case "tel": {
      const telRe = /^[\d\s\-+()]+$/;
      if (!telRe.test(v)) {
        if (field.required) return { error: "Please enter a valid phone number." };
        return { normalizedValue: "" }; // optional: ignore invalid
      }
      return { normalizedValue: v };
    }
    case "number": {
      if (Number.isNaN(Number(v))) return { error: "Please enter a valid number." };
      return { normalizedValue: v };
    }
    case "date": {
      const parsed = parseFlexibleDate(v);
      if (parsed) return { normalizedValue: parsed };
      if (field.required) return { error: "Please enter a valid date (e.g. 15 Jan 1990 or 1990-01-15)." };
      return { normalizedValue: "" }; // optional: skip invalid
    }
    default:
      return { normalizedValue: v };
  }
}

/** Get the next question for the current form state, or null if form is complete. */
export function getNextFormQuestion(form: FormDefinition, state: FormState): string | null {
  const fields = form.fields;
  for (let i = state.stepIndex; i < fields.length; i++) {
    const field = fields[i];
    if (state.data[field.key] == null || state.data[field.key] === "") {
      return field.label;
    }
  }
  return null;
}

/** Submit collected form data to the form's submitUrl. Returns success message or throws. */
export async function submitForm(
  form: FormDefinition,
  data: Record<string, string>
): Promise<string> {
  const method = form.submitMethod ?? "POST";
  const res = await fetch(form.submitUrl, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Form submission failed (${res.status}): ${text || res.statusText}`);
  }
  return `Thank you. Your ${form.name} has been submitted successfully.`;
}
