// Model choices offered in the Agent editor. "" means "use the app-wide default"
// (config.ANTHROPIC_MODEL). Client-safe: no server imports.

export const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export const MODEL_VALUES = MODEL_CHOICES.map((c) => c.value);

/** Short human label for a model id, e.g. "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return "Sonnet 5";
  return MODEL_CHOICES.find((c) => c.value === id)?.label ?? id.replace(/^claude-/, "");
}
