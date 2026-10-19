// Small stdio MCP adapter over the pinned Ruflo task and memory handlers.
// Unlike a client-only allowlist, this server refuses every unlisted tool.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { RUFLO_TOOLS, RUFLO_VERSION, rufloClientPath } from "./ruflo.ts";

interface Tool { name: string; description?: string; inputSchema: object; handler: (args: Record<string, unknown>) => Promise<unknown> }
export async function loadRufloTools(root: string): Promise<Tool[]> {
  const pkg = JSON.parse(await readFile(join(root, "node_modules", "@claude-flow", "cli", "package.json"), "utf8"));
  if (pkg.version !== RUFLO_VERSION) throw new Error("Ruflo version differs from the tested integration.");
  // Dependency diagnostics must never corrupt JSON-RPC stdout.
  console.log = (...args: unknown[]) => console.error(...args);
  const task = await import(pathToFileURL(rufloClientPath(root, "task")).href);
  const memory = await import(pathToFileURL(rufloClientPath(root, "memory")).href);
  const tools: Tool[] = [...task.taskTools, ...memory.memoryTools].filter((tool: Tool) => RUFLO_TOOLS.includes(tool.name));
  if (tools.length !== RUFLO_TOOLS.length) throw new Error("Required Ruflo tools are missing.");
  return tools;
}
export async function handleRufloRequest(request: { id?: string | number; method: string; params?: Record<string, unknown> }, tools: Tool[]) {
  if (request.id === undefined) return;
  const result = (value: unknown) => ({ jsonrpc: "2.0", id: request.id, result: value });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: request.id, error: { code, message } });
  if (request.method === "initialize") return result({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jarvis-ruflo", version: RUFLO_VERSION } });
  if (request.method === "ping") return result({});
  if (request.method === "tools/list") return result({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (request.method !== "tools/call") return error(-32601, "Method not supported.");
  const name = request.params?.name;
  const tool = tools.find(t => t.name === name && RUFLO_TOOLS.includes(t.name));
  if (!tool) return error(-32602, "Tool is not enabled for Jarvis.");
  const args = request.params?.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 24000) return error(-32602, "Invalid or oversized tool arguments.");
  // The upstream stats tool accepts arbitrary database paths; keep it project-local.
  if ("dbPath" in args) return error(-32602, "Database path overrides are not enabled.");
  const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
  if (schema.required?.some(key => !(key in args)) || Object.keys(args).some(key => !Object.hasOwn(schema.properties ?? {}, key))) return error(-32602, "Unknown or missing arguments.");
  try {
    const value = await tool.handler(args as Record<string, unknown>);
    return result({ content: [{ type: "text", text: JSON.stringify(value) }], ...(value && typeof value === "object" && "success" in value && value.success === false ? { isError: true } : {}) });
  } catch { return result({ isError: true, content: [{ type: "text", text: "Ruflo operation failed; inspect local runtime diagnostics." }] }); }
}
if (import.meta.main) {
  const root = process.env.JARVIS_RUFLO_ROOT;
  if (!root) throw new Error("Ruflo runtime is not configured.");
  const tools = await loadRufloTools(root);
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      if (line.length > 30000) throw new Error("Request too large");
      const response = await handleRufloRequest(JSON.parse(line), tools);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid request." } }) + "\n"); }
  }
  process.exit(0);
}
