// EU-law MCP server entry point.
//
// Exposes 4 tools over the Model Context Protocol's Streamable HTTP transport:
//   - eu_verify_citation        (regex-only)
//   - eu_get_document_by_celex  (EUR-Lex HTML fetch)
//   - eu_get_document_by_ecli   (EUR-Lex HTML fetch)
//   - eu_get_document_by_eli    (EUR-Lex HTML fetch)
//
// Search-by-keyword tools were removed from v1: CELLAR's SPARQL endpoint
// proved unreliable in practice, and EUR-Lex's REST API doesn't expose a
// clean public search. The LLM resolves citations through user input or
// external search, then uses the document fetchers.
//
// Run with:
//   PORT=4040 node dist/index.js
//
// Health endpoint at /health. MCP endpoint at /mcp (POST).

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
    runGetDocumentByCelex,
    getDocumentByCelexSchema,
} from "./tools/getDocumentByCelex";
import {
    runGetDocumentByEcli,
    getDocumentByEcliSchema,
} from "./tools/getDocumentByEcli";
import {
    runGetDocumentByEli,
    getDocumentByEliSchema,
} from "./tools/getDocumentByEli";
import {
    runVerifyCitation,
    verifyCitationSchema,
} from "./tools/verifyCitation";

export function buildMcpServer(): McpServer {
    const server = new McpServer({
        name: "eu-law",
        version: "0.1.0",
    });

    server.registerTool(
        "eu_get_document_by_celex",
        {
            description:
                "Fetch the full text of an EU legal document by its CELEX number " +
                "(e.g. 32016R0679 for the GDPR, 62018CJ0311 for Schrems II). " +
                "Returns title, body text, and a EUR-Lex source URL. Use format='text' " +
                "for clean plain text, 'html' for the raw structured document.",
            inputSchema: getDocumentByCelexSchema.shape as any,
        },
        (async (args: any) => {
            const result = await runGetDocumentByCelex(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }) as any,
    );

    server.registerTool(
        "eu_get_document_by_ecli",
        {
            description:
                "Fetch a CJEU/GC judgment by its ECLI (e.g. ECLI:EU:C:2020:559 " +
                "for Schrems II). Returns title, body text, and a EUR-Lex source URL.",
            inputSchema: getDocumentByEcliSchema.shape as any,
        },
        (async (args: any) => {
            const result = await runGetDocumentByEcli(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }) as any,
    );

    server.registerTool(
        "eu_get_document_by_eli",
        {
            description:
                "Fetch an EU act by its ELI URL (European Legislation Identifier), " +
                "e.g. http://data.europa.eu/eli/reg/2016/679/oj for the GDPR.",
            inputSchema: getDocumentByEliSchema.shape as any,
        },
        (async (args: any) => {
            const result = await runGetDocumentByEli(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }) as any,
    );

    server.registerTool(
        "eu_verify_citation",
        {
            description:
                "Check whether a citation string is a valid CELEX number or ECLI. " +
                "Returns canonical identifiers and a confidence score. Does NOT " +
                "resolve free-text citations like 'Case C-403/03' or " +
                "'Regulation (EU) 2016/679' — those return low confidence with " +
                "guidance to use the document fetch tools instead.",
            inputSchema: verifyCitationSchema.shape as any,
        },
        (async (args: any) => {
            const result = await runVerifyCitation(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }) as any,
    );

    return server;
}

export function buildApp(): express.Express {
    const app = express();
    app.use(express.json({ limit: "1mb" }));

    app.get("/health", (_req, res) => {
        res.json({ status: "ok", server: "eu-law-mcp", version: "0.1.0" });
    });

    app.post("/mcp", async (req: Request, res: Response) => {
        const server = buildMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });

        res.on("close", () => {
            transport.close().catch(() => undefined);
            server.close().catch(() => undefined);
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error("[eu-law-mcp] request error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message:
                            err instanceof Error ? err.message : "internal error",
                    },
                    id: null,
                });
            }
        }
    });

    app.get("/mcp", (_req, res) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "GET not supported in stateless mode" },
            id: null,
        });
    });

    return app;
}

if (require.main === module) {
    const port = parseInt(process.env.PORT ?? "4040", 10);
    const app = buildApp();
    app.listen(port, () => {
        console.log(
            JSON.stringify({
                event: "eu-law-mcp.listening",
                port,
                instance: randomUUID(),
            }),
        );
    });
}