import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "@/lib/config";
import { createNowsdkMcpServer, NOWSDK_TOOL_NAMES, NOWSDK_BUILD_TOOL } from "@/lib/nowsdk/mcp";

export interface RunAgentInput {
  systemPrompt: string;
  userPrompt: string;
  maxTurns: number;
  withTools: boolean;
  /** Also allow WebSearch / WebFetch (Architect research). Implies withTools. */
  webTools?: boolean;
  /** Also allow the `build` tool (Developer — compile draft code). Implies withTools. */
  buildTool?: boolean;
  /** The ticket's resolved FluentProject directory. Required whenever any of
   *  withTools/webTools/buildTool is set — every nowsdk MCP tool (explain,
   *  query, build) runs `now-sdk` against a specific project. */
  projectDir?: string;
  model?: string;
}

const WEB_TOOLS = ["WebSearch", "WebFetch"];

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface RunAgentResult {
  text: string;
  toolCalls: ToolCall[];
  numTurns: number;
  costUsd: number;
}

/**
 * Run one pipeline agent as a single-shot Claude Agent SDK query.
 *
 * - `systemPrompt` is a plain string → it fully replaces the default system prompt.
 * - `tools: []` removes every built-in tool; tool-using agents get only the
 *   in-process `nowsdk` MCP server (explain / query / build), pinned to `projectDir`.
 * - `settingSources: []` keeps the agent isolated from repo CLAUDE.md / AGENTS.md
 *   / settings.
 * Throws on an error result or empty output so the orchestrator can mark the
 * step FAILED.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { systemPrompt, userPrompt, maxTurns, withTools, webTools, buildTool, projectDir } = input;
  const model = input.model ?? config.ANTHROPIC_MODEL;
  const needsNowsdk = withTools || webTools || buildTool;
  if (needsNowsdk && !projectDir) {
    throw new Error("runAgent: projectDir is required when withTools/webTools/buildTool is set");
  }

  const toolCalls: ToolCall[] = [];
  const assistantText: string[] = [];
  let finalText = "";
  let numTurns = 0;
  let costUsd = 0;

  const iterator = query({
    prompt: userPrompt,
    options: {
      model,
      systemPrompt,
      maxTurns,
      // `tools` is the base set of built-ins: [] disables all; webTools re-adds
      // just WebSearch/WebFetch for the Architect's research.
      tools: webTools ? WEB_TOOLS : [],
      settingSources: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(needsNowsdk
        ? {
            mcpServers: { nowsdk: createNowsdkMcpServer(projectDir!) },
            allowedTools: [
              ...NOWSDK_TOOL_NAMES,
              ...(buildTool ? [NOWSDK_BUILD_TOOL] : []),
              ...(webTools ? WEB_TOOLS : []),
            ],
          }
        : {}),
    },
  });

  try {
    for await (const message of iterator) {
      if (message.type === "assistant") {
        if (message.error) {
          throw new Error(`assistant error: ${message.error}`);
        }
        for (const block of message.message.content) {
          if (block.type === "text") assistantText.push(block.text);
          else if (block.type === "tool_use") {
            toolCalls.push({ name: block.name, input: block.input });
          }
        }
      } else if (message.type === "result") {
        numTurns = message.num_turns ?? 0;
        costUsd = message.total_cost_usd ?? 0;
        if (message.subtype === "success") {
          finalText = message.result ?? "";
        } else {
          const partial = assistantText.join("\n").trim();
          throw new Error(
            `agent run failed: ${message.subtype} ` +
              `(after ${numTurns} turns, ${toolCalls.length} tool calls, ` +
              `${partial.length} chars of partial output)`,
          );
        }
      }
    }
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const text = (finalText || assistantText.join("\n")).trim();
  if (!text) {
    throw new Error("agent produced no output");
  }

  return { text, toolCalls, numTurns, costUsd };
}
