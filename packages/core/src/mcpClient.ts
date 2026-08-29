import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolContext, ToolName, ToolResult } from "./types";

type TextContent = {
  type: "text";
  text: string;
};

type McpToolRuntimeConfig = {
  command?: string;
  args?: string[];
  cwd?: string;
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

  return {
    listTools: async () => {
      const result = await client.listTools();
      return result.tools.map((tool) => tool.name);
    },
    callTool: async <T>(tool: ToolName, input: Record<string, unknown>, context: ToolContext) => {
      const result = await client.callTool({
        name: tool,
        arguments: {
          ...input,
          context
        }
      });

      return parseToolResult<T>(result);
    },
    close: async () => {
      await client.close();
    }
  };
};
