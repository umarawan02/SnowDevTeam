import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "@/lib/config";
import { createNowsdkMcpServer, type NowsdkServerOpts, NOWSDK_TOOL_NAMES, NOWSDK_BUILD_TOOL } from "@/lib/nowsdk/mcp";
import { createNativeMcpServer, type NativeServerOpts, NATIVE_TOOL_NAMES } from "@/lib/nativeengine/mcp";

export interface RunAgentInput {
  systemPrompt: string;
  userPrompt: string;
  maxTurns: number;
  withTools: boolean;
  /** Also allow WebSearch / WebFetch (Architect research). Implies withTools. */
  webTools?: boolean;
  /** Also allow the `build` tool (Developer — compile draft code). Implies withTools. */
  buildTool?: boolean;
  /** The ticket's Fluent project + ticket dir — Fluent tier only. Required
   *  whenever withTools/buildTool is set on a Fluent ticket. */
  nowsdk?: NowsdkServerOpts;
  /** The ticket's instance + native dir — native tier only. When set, the
   *  native MCP server (query / table_spec / validate_plan) is mounted instead
   *  of the now-sdk one. */
  native?: NativeServerOpts;
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
  const { systemPrompt, userPrompt, maxTurns, withTools, webTools, buildTool, nowsdk, native } = input;
  const model = input.model ?? config.ANTHROPIC_MODEL;
  // A tool-using stage gets exactly one MCP server: `native` for a native-tier
  // ticket (query / table_spec / validate_plan — all read-only), else `nowsdk`
  // (explain / query / build) for the Fluent tier. WebSearch / WebFetch need
  // neither.
  const wantsTools = withTools || buildTool;
  const useNative = wantsTools && !!native;
  const useNowsdk = wantsTools && !native && !!nowsdk;
  if (wantsTools && !native && !nowsdk) {
    console.warn("[runAgent] tool-using stage with neither `native` nor `nowsdk` — running without MCP tools");
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
      ...(useNative
        ? {
            mcpServers: { native: createNativeMcpServer(native!) },
            allowedTools: [...NATIVE_TOOL_NAMES, ...(webTools ? WEB_TOOLS : [])],
          }
        : useNowsdk
          ? {
              mcpServers: { nowsdk: createNowsdkMcpServer(nowsdk!) },
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
