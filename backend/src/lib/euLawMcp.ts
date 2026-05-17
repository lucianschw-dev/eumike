// EU-law MCP HTTP client.
//
// Talks to the standalone eu-law MCP server (the one in
// backend/mcp-servers/eu-law/, running on its own port — default 4040)
// over the Model Context Protocol's Streamable HTTP transport.
//
// Used by routes/euLawChat.ts to dispatch EU-law tool calls. Stateless:
// every call does its own initialize → tools/call handshake. That's
// slightly wasteful (one extra round-trip per call) but keeps this file
// trivial — no session state to manage, no reconnect logic.
//
// Environment:
//   EU_LAW_MCP_URL — the base URL of the MCP endpoint, e.g.
//                    http://localhost:4040/mcp. Required.

const MCP_URL = process.env.EU_LAW_MCP_URL ?? "http://localhost:4040/mcp";

// Names of the 4 tools the MCP server exposes. Hand-coded here (matches
// the schemas declared in routes/euLawChat.ts) so chatTools.ts can route
// tool calls without a tools/list round-trip at startup.
export const EU_LAW_TOOL_NAMES = [
    "eu_get_document_by_celex",
    "eu_get_document_by_ecli",
    "eu_get_document_by_eli",
    "eu_verify_citation",
] as const;

export type EuLawToolName = (typeof EU_LAW_TOOL_NAMES)[number];

type JsonRpcOk<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcErr = { jsonrpc: "2.0"; id: number; error: { code: number; message: string } };
type JsonRpcResponse<T> = JsonRpcOk<T> | JsonRpcErr;

type ToolCallResult = {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
};

// Parse either a plain JSON body or an SSE-formatted "data: {...}" line.
// The MCP Streamable HTTP transport may return either depending on whether
// the server chose to upgrade to a stream — both are valid per the spec.
function parseRpcBody<T>(body: string): JsonRpcResponse<T> {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) {
        return JSON.parse(trimmed) as JsonRpcResponse<T>;
    }
    for (const line of trimmed.split("\n")) {
        const t = line.trim();
        if (t.startsWith("data:")) {
            return JSON.parse(t.slice(5).trim()) as JsonRpcResponse<T>;
        }
    }
    throw new Error(`MCP: malformed response: ${trimmed.slice(0, 200)}`);
}

async function rpc<T>(
    method: string,
    params: Record<string, unknown>,
    id: number,
): Promise<T> {
    const res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    const text = await res.text();
    if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const parsed = parseRpcBody<T>(text);
    if ("error" in parsed) {
        throw new Error(`MCP RPC error ${parsed.error.code}: ${parsed.error.message}`);
    }
    return parsed.result;
}

/**
 * Call a single EU-law MCP tool by name. Returns the textual content of
 * the first text part of the tool's response. The MCP server's tools all
 * return their payload as JSON-stringified text in a single content part.
 */
export async function callEuLawTool(
    name: EuLawToolName,
    args: Record<string, unknown>,
): Promise<string> {
    // Initialize (Streamable HTTP requires this even in stateless mode).
    await rpc<unknown>(
        "initialize",
        {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "eu-mike-backend", version: "0.1.0" },
        },
        1,
    );

    const result = await rpc<ToolCallResult>(
        "tools/call",
        { name, arguments: args },
        2,
    );

    const textParts = (result.content ?? [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string);
    return textParts.join("\n") || "[no content]";
}

/**
 * Dispatcher matching the shape chatTools.ts's `mcpTools.dispatch` expects:
 * takes an array of tool calls, returns an array of results keyed by
 * tool_call_id. Errors are caught per-call so one bad call doesn't poison
 * a batch.
 */
export async function dispatchEuLawCalls(
    calls: { id: string; name: string; input: Record<string, unknown> }[],
): Promise<{ tool_call_id: string; content: string }[]> {
    const out: { tool_call_id: string; content: string }[] = [];
    for (const c of calls) {
        try {
            const text = await callEuLawTool(c.name as EuLawToolName, c.input);
            out.push({ tool_call_id: c.id, content: text });
        } catch (err) {
            out.push({
                tool_call_id: c.id,
                content: JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                }),
            });
        }
    }
    return out;
}
