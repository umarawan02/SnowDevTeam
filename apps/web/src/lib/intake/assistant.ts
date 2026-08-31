import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

// Node runtime only (uses the Node Anthropic SDK). Not the agent SDK — this is a
// cheap multi-turn chat, ~1024 tokens per reply.

const PROMPT = (() => {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "agents", "prompts", "intake-assistant.md"),
    (() => {
      try {
        return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "intake-assistant.md");
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`intake-assistant.md not found. Looked in:\n${candidates.join("\n")}`);
  return fs.readFileSync(found, "utf8").trim();
})();

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

/** A streaming assistant reply for the given transcript. */
export function streamIntakeReply(messages: ChatMessage[]) {
  return anthropic().messages.stream({
    model: config.ANTHROPIC_MODEL,
    system: PROMPT,
    max_tokens: 1024,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
}
