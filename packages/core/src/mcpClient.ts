import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getToolDefinition } from "./tools";
import type { ToolContext, ToolName, ToolResult } from "./types";

type TextContent = {
  type: "text";
  text: string;
};

type McpToolRuntimeConfig = {
  command?: string;
  args?: string[];
  cwd?: string;
  toolTimeoutMs?: number;
};

export type McpToolRuntime = {
  listTools: () => Promise<string[]>;
  callTool: <T>(tool: ToolName, input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult<T>>;
  close: () => Promise<void>;
};

const coreSourceDir = path.dirname(fileURLToPath(import.meta.url));

const findRepoRoot = () => {
  let current = coreSourceDir;

  while (current !== path.dirname(current)) {
    const packageJson = path.join(current, "package.json");

    if (existsSync(packageJson) && existsSync(path.join(current, "packages", "mcp-server"))) {
      return current;
    }

    current = path.dirname(current);
  }

  return process.cwd();
};

const defaultServerCommand = () => (process.platform === "win32" ? "npm.cmd" : "npm");

const defaultServerArgs = () => ["run", "start", "--workspace", "@aiops-sentinel/mcp-server", "--silent"];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时：${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const parseToolResult = <T>(rawResult: Awaited<ReturnType<Client["callTool"]>>): ToolResult<T> => {
  if ("structuredContent" in rawResult && rawResult.structuredContent) {
    return rawResult.structuredContent as unknown as ToolResult<T>;
  }

  const content = "content" in rawResult && Array.isArray(rawResult.content) ? rawResult.content : [];
  const textContent = content.find((item): item is TextContent => {
    return typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item;
  });

  if (textContent) {
    return JSON.parse(textContent.text) as ToolResult<T>;
  }

  throw new Error("MCP tool result did not include structuredContent or JSON text content");
};

export const createMcpToolRuntime = async (config: McpToolRuntimeConfig = {}): Promise<McpToolRuntime> => {
  const client = new Client({
    name: "aiops-sentinel-agent-runtime",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: config.command ?? process.env.AIOPS_MCP_COMMAND ?? defaultServerCommand(),
    args: config.args ?? defaultServerArgs(),
    cwd: config.cwd ?? process.env.AIOPS_MCP_CWD ?? findRepoRoot(),
    stderr: "pipe"
  });

  await client.connect(transport);
  const toolTimeoutMs = config.toolTimeoutMs ?? Number(process.env.AIOPS_TOOL_TIMEOUT_MS ?? 5000);

  return {
    listTools: async () => {
      const result = await client.listTools();
      return result.tools.map((tool) => tool.name);
    },
    callTool: async <T>(tool: ToolName, input: Record<string, unknown>, context: ToolContext) => {
      const startedAt = Date.now();
      const definition = getToolDefinition(tool);

      try {
        const result = await withTimeout(
          client.callTool({
            name: definition.mcpName,
            arguments: {
              ...input,
              context
            }
          }),
          toolTimeoutMs,
          `${definition.mcpName} MCP Tool`
        );
        const parsed = parseToolResult<T>(result);

        return {
          ...parsed,
          source: "mcp",
          latencyMs: parsed.latencyMs || Date.now() - startedAt
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "MCP Tool 调用失败",
          source: "mcp",
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString()
        };
      }
    },
    close: async () => {
      await client.close();
    }
  };
};
