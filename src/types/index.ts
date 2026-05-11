/** Single FAQ entry: question and answer (markdown allowed, may include links). */
export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

/** Chat message in history. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/** Chat session: id, messages, optional user identifier, optional form-filling state. */
export interface ChatSession {
  sessionId: string;
  userId?: string;
  ip?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Set when bot asked an offer (e.g. "Would you like to register?") so next "yes" can start the form. */
  offeredFormId?: string;
  /** When user is filling a form via chat: which form and which step. */
  formState?: FormState;
}

/** In-progress form filling: form id, current field index, collected data. */
export interface FormState {
  formId: string;
  stepIndex: number;
  data: Record<string, string>;
  /** Language the user used when starting the form. */
  userLang?: "mr" | "hi" | "en";
}

/** Validation rules for a form field (from form definition JSON). */
export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: boolean;
}

/** Single field in a form definition. */
export interface FormFieldDef {
  key: string;
  label: string;
  label_mr?: string;
  label_hi?: string;
  type: "text" | "email" | "tel" | "number" | "date";
  required?: boolean;
  validation?: FieldValidation;
}

/** Form definition (from forms/*.json). */
export interface FormDefinition {
  id: string;
  name: string;
  submitUrl: string;
  submitMethod?: "POST" | "PUT";
  /** Phrases that start this form when user says them (e.g. "register", "i would like to register"). */
  triggerPhrases: string[];
  /** Optional question bot can ask to offer the form (e.g. "Would you like to register?"). */
  offerQuestion?: string;
  /** Alternative: list of offer phrases; if reply contains any, set offeredFormId. */
  offerQuestions?: string[];
  fields: FormFieldDef[];
}
